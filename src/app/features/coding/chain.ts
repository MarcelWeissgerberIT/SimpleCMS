/**
 * Work orders (Prüfaufträge) — the chain engine's core (spec §2.10), pure: `nextMove(world)` decides the ONE next thing
 * for a request's chain from a snapshot of the facts; the app sink (B7: hooks beside spawnFollowUps, `startAt`, the
 * catch-up pass, under the Web Lock `one-order-chain:<scope>:<row>`) builds the world, carries out the move under the
 * order writer and writes the record. Nothing here reads the store, the clock or this device's records.
 *
 * Record-authoritative: the chain is this device's record (`OrderChain.steps`, in step order) — never the Prüfauftrag
 * relation or the Schritt number on the task rows. A task that carries the relation but is not in the record is never
 * started (`strayRows`); a renumbered Schritt changes nothing.
 *
 * The five outcomes, checked in this order:
 *  1. halt (sticky — once halted the engine only waits, whatever the Status says, until resumeChain):
 *     the Status set to Angehalten (by any writer) · the Status set to Fertig by anyone but the chain's own end ('finished'
 *     — while this device asks "end the chain?" it waits) · the request trashed or gone · its Status options missing · a step
 *     ejected · a step trashed or gone that the chain still needs (a step whose successor started is no longer needed,
 *     whether it still exists or not) — a step this tab has not seen yet while the chain is young is arriving from
 *     another tab (it waits), never gone · a parked step out of its park stage (or running) without the engine having started it ("ran out of
 *     order") · a parked step's project that now hands new tasks to the worker at once · the chain budget reached before
 *     the next step starts (never mid-step) · a step to start whose project has no stage to start it in.
 *  2. card (VON HAND; the chain waits, it is not halted) — before the next step n+1 starts: step n done without
 *     evidence (only `coding` = this device's worker, `you` via none / 'ui' / 'preflight', and `terminal` count) ·
 *     after an analysis step with "Stop after the analysis" on, unless the approval that finished it showed step n+1 in
 *     full (`sawNext`) · step n+1's pipeline line (start: true) or its Approvals changed since confirm · a page step n+1
 *     takes along changed since confirm by someone other than the person · step n+1 waits for Confirm or is not trusted
 *     here (no chain write ever ends that wait — the card renders the task's version; its ↵ confirms it, then goes on) ·
 *     the Grundlage step n+1 would take carries a write by someone other than the chain, the person or this device's
 *     worker since step n started ('basis' — the card shows the Grundlage).
 *     A press on a card (`ChainPress`) passes the reasons that card showed — never 'confirm' (that needs the version
 *     confirmed: the facts then say trusted), and never 'ref' / 'basis' by itself: those are pinned to exactly what the
 *     card rendered (the pages' and the Grundlage's fingerprints) and come back when the text moved on since.
 * A Status (Angehalten / Fertig) older than the chain's latest start or resume is a store lagging behind another tab:
 * it waits ('settling', ≤ SETTLE_MS), never halts.
 *  3. advance step n+1 (step 01 once `startAt` is reached): the Grundlage (orders/basis.ts) from step n — or the line
 *     "skipped" —, a QA step takes the coding step's branch, Stage → its start stage. Decided from the RECORD, never from
 *     a store that may lag behind another tab's: a step the record marks started (`advanced`) whose move never landed
 *     (no `moved` mark — the tab that wrote ahead went away) and that still stands in its park stage is moved again
 *     (`again`: the move is idempotent; the budget is checked again). A step the record says was moved that stands in
 *     its park stage is either this tab's store lagging (it waits, 'settling') or put back by someone other than the
 *     chain (`back` recorded where it happened, or still there after SETTLE_MS): a halt ('putBack') — never a restart.
 *  4. done: every step done (or skipped) → Status Fertig.
 *  5. wait: otherwise (a step runs, waits at a gate, has a question, failed …; step 01's countdown).
 *
 * The parked-start guard: a step is created PARKED in its project's first stage (`startStageOf(…, false)`); a project
 * whose first stage hands new tasks to the worker at once is unusable for chains (`chainProjectProblem` — before
 * anything is created) and halts a chain that has parked steps in it; tasks.ts `setParkedGuard` keeps the worker from
 * taking a parked step at all.
 */
import type { ID, OrderStatusKey } from '../../store/types'
import type { Writer } from '../../store/writer'
import { stageNeeds, type StageKind } from './protocol'
import type { OrderChain, OrderChainStep, OrderDoneBy, OrderHaltWhy, OrderKind, OrderRecord } from './orders/types'
import { landsOn, startStageOf, type ResolvedStage, type StageApprovals } from './stages'

/* ------------------------------------------------------------------ the world */

/** What the engine knows about one task of the chain (the sink reads it from the store, this device's state and trust). */
export interface ChainTaskFacts {
  /** Fresh host verification receipt for a delivery QA task (legacy steps do not require it). */
  verified?: boolean
  /** false: no such row here (deleted for good, or not arrived in this tab yet) */
  exists: boolean
  /**
   * with `exists` false: known gone — this tab had the page, or the chain is older than SETTLE_MS (a page created in
   * another tab has reached this one by then). Absent and not gone: still arriving — the chain waits, never halts.
   */
  gone?: boolean
  /** in the trash (itself or a page above it) */
  trashed: boolean
  /** an eject took it (or its creation) back */
  ejected?: boolean
  /** the stage it stands in now, and that stage's kind */
  stage: ID | null
  stageKind: StageKind | null
  /** where a step waits until the chain starts it: the stage a new task is made in (stages.ts startStageOf(…, false)) */
  parkStage: ID | null
  /** where the chain moves it to start it (startStageOf(pipeline, repo, true)) */
  startStage: ID | null
  /** its project would hand a newly made task to the worker at once (parksNewTasks false) */
  startsAtOnce: boolean
  /** this device's run state (local.ts TaskLocal.state) */
  state: 'idle' | 'running' | 'question' | 'failed' | 'stopped'
  /** its pipeline line now (stages.ts pipelineLine, start: true, with its Approvals on this device) */
  line: string
  approvals: StageApprovals
  /** a write from this tab would end its wait for Confirm (terminal.ts taskWriteEndsConfirm) */
  endsConfirm: boolean
  /** this device may run it as it is (trust.ts isTrusted) */
  trusted: boolean
  /** the agent that changed it last (its label), when one did — the confirm card names it */
  changedBy?: string | null
  repo: string | null
  branch: string | null
  /** the Claude Code cost this device's worker reported for it (TaskLocal.spentUsd) */
  spentUsd: number
}

/** A page a step takes along, now. */
export interface ChainRefFacts {
  /** its fingerprint now (orders/fingerprint.ts pageFp: title + text) — compared with the step's pin */
  fp: string
  /** its newest write was not the person's own on this device (a recorded outside write, another origin, an agent's stamp …) */
  foreign: boolean
}

export interface ChainWorld {
  now: number
  /** this device's record of the request (the engine acts only on a 'running' one) */
  record: OrderRecord
  request: {
    /** the row is there and not in the trash */
    live: boolean
    /** its Status, by the config's option ids (null: none of them) */
    status: OrderStatusKey | null
    /** the config is readable and names every Status option (config.ts orderConfigUsable) */
    usable: boolean
    /** when the row was last written as this tab holds it (Page.updatedAt) — a Status older than the chain's start lags */
    at?: number
  }
  /** per task id of the record */
  tasks: Record<ID, ChainTaskFacts>
  /** per page id the steps take along */
  refs: Record<ID, ChainRefFacts>
  /**
   * may this tab move steps (absent: yes) — in a team only the device with the worker link and the chain's record
   * advances; elsewhere the chain waits ('elsewhere'): such a device follows only the request (its Status — a halt, the
   * end, the trash); halts and cards about the steps are the worker device's (Orders B12).
   */
  here?: { advance: boolean }
  /**
   * per step n not started yet: the Grundlage it would take carries an outside write that no card showed yet (the sink
   * fingerprints it against `OrderChain.basisSeen[n]`)
   */
  basisForeign?: Record<number, boolean>
  /** this tab asks the person right now whether the request set to Fertig ends the chain (trigger.ts askFinish) */
  asking?: boolean
}

/** A store lagging behind another tab's save catches up within this (ms); after it, what it shows counts. */
export const SETTLE_MS = 60_000
/** "End the chain?" — a question this device opened holds the chain this long at most (a tab closed while asking). */
export const FINISH_ASK_MS = 10 * 60_000

/* ------------------------------------------------------------------ the outcomes */

/** Why a card asks before the next step starts. */
export type ChainCardWhy = 'evidence' | 'checkpoint' | 'basis' | 'drift' | 'ref' | 'confirm'
/** The card reasons a press can pass (a Confirm wait needs the version confirmed). */
export type ChainPassable = Exclude<ChainCardWhy, 'confirm'>
export const CARD_ORDER: readonly ChainCardWhy[] = ['evidence', 'checkpoint', 'basis', 'drift', 'ref', 'confirm']

/**
 * 'arriving': a step created in another tab has not reached this tab's store yet · 'settling': this tab's store shows
 * something older than the record (a moved step still parked, a Status from before the chain's start) · 'finishing':
 * the request was set to Fertig and this device asks whether that ends the chain
 */
export type ChainWaitWhy = 'inactive' | 'halted' | 'startAt' | 'running' | 'question' | 'failed' | 'stopped' | 'gate' | 'import' | 'queued' | 'elsewhere' | 'arriving' | 'settling' | 'finishing'

export type ChainMove =
  | { kind: 'halt'; why: OrderHaltWhy; step?: number }
  | {
      kind: 'card'
      /** the first reason (CARD_ORDER) — `all` lists every one, the card shows them all */
      why: ChainCardWhy
      all: ChainCardWhy[]
      /** the step that would start */
      step: number
      /** the step before it (null: it is the first) */
      from: number | null
      /** evidence: who moved step `from` to done, as recorded (null: nobody recorded it here) */
      by?: OrderDoneBy | null
      /** drift: what changed since confirm */
      drift?: Array<'line' | 'approvals'>
      /** ref: the pages that changed */
      refs?: ID[]
      /** basis: the step whose result goes in carries an outside write (its task) */
      source?: ID
      /** confirm: the agent that changed the step, when one did */
      agent?: string | null
    }
  | {
      kind: 'advance'
      step: number
      /** the stage it moves to */
      to: ID
      /** the step whose result goes in (null: the first step) */
      from: number | null
      /**
       * 'copy': step `from`'s result — with `from` null: the result of the older chain's step this chain was planned
       * again from (`OrderChain.basis`) · 'skipped': the line "step n skipped — no basis" · 'none': the first step
       */
      basis: 'copy' | 'skipped' | 'none'
      /** a QA step takes the coding step's branch (null: none) */
      branch: string | null
      /** the record had started it already; it still stood parked — the move again */
      again: boolean
    }
  | { kind: 'done' }
  | { kind: 'wait'; why: ChainWaitWhy; step?: number; at?: number }

/**
 * A VON HAND key on a card for step `step`: it passes the reasons the card showed. `refs` / `basis`: the fingerprints of
 * the pages and of the Grundlage exactly as the card rendered them — only those are pinned (a newer write shows again).
 */
export interface ChainPress {
  step: number
  passes: readonly ChainPassable[]
  refs?: Record<ID, string>
  basis?: string
}

/* ------------------------------------------------------------------ evidence */

/**
 * What the done subscriber records when a step reaches done (at the move, in the tab that made it): the writer's kind
 * — and for the person how ('ui', 'preflight' …). `sawNext`: the surface that approved it rendered step n+1 in full.
 */
export function doneEvidence(w: Writer | null, at: number, sawNext = false): OrderDoneBy {
  if (!w) return { kind: 'unknown', at }
  return { kind: w.kind, ...(w.kind === 'you' && w.via ? { via: w.via } : {}), at, ...(sawNext ? { sawNext: true } : {}) }
}

/** May the chain go on by itself after this done move? Only this device's worker, the person on the panel / Preflight, the terminal. */
export function givesEvidence(d: OrderDoneBy | null | undefined): boolean {
  if (!d) return false
  if (d.kind === 'coding' || d.kind === 'terminal') return true
  return d.kind === 'you' && (d.via === undefined || d.via === 'ui' || d.via === 'preflight')
}

/* ------------------------------------------------------------------ the parked-start guard */

/** Does a project park a newly made task (it waits in its first stage until someone starts it)? */
export const parksNewTasks = (pipeline: ResolvedStage[]): boolean => pipeline.length > 0 && landsOn(pipeline, startStageOf(pipeline, false, false)) === 'waits'

export type ChainProjectProblem = 'empty' | 'locked' | 'stories' | 'startsAtOnce' | 'noStart' | 'needs'

/**
 * Why a project cannot take chain steps (null: it can) — spec §2.2 item 6: no stages · locked without the chain roles
 * (ensureChainProps impossible) · a Business analysis project that makes stories (the chain would build twice) · its
 * first stage hands new tasks to the worker at once (a parked step would run) · no stage to start a step in · stages
 * the connected worker cannot run (`caps`: its capabilities; null: not known — not checked here).
 */
export function chainProjectProblem(p: { kind: OrderKind; pipeline: ResolvedStage[]; locked: boolean; hasRoles: boolean; repo: boolean; caps: ReadonlySet<string> | null }): ChainProjectProblem | null {
  if (!p.pipeline.length) return 'empty'
  if (p.locked && !p.hasRoles) return 'locked'
  if (p.kind === 'spec' && p.pipeline.some((s) => s.kind === 'doc' && s.output === 'stories')) return 'stories'
  if (!parksNewTasks(p.pipeline)) return 'startsAtOnce'
  const start = startStageOf(p.pipeline, p.repo, true)
  if (!start || start.id === p.pipeline[0]!.id) return 'noStart'
  if (p.caps && p.pipeline.some((st) => stageNeeds(st).some((need) => !p.caps!.has(need)))) return 'needs'
  return null
}

/* ------------------------------------------------------------------ the engine */

const byN = (a: OrderChainStep, b: OrderChainStep) => a.n - b.n

/** The chain's steps in order. */
export const chainSteps = (chain: OrderChain): OrderChainStep[] => [...chain.steps].sort(byN)

/** Tasks that carry the request's relation but are not part of its chain on this device (the plate warns; never started). */
export const strayRows = (chain: OrderChain | undefined, carriers: readonly ID[]): ID[] => {
  const ids = new Set((chain?.steps ?? []).map((s) => s.id))
  return carriers.filter((id) => !ids.has(id))
}

/** What the chain has spent: this device's worker reports of every step (never the Cost fields). */
export function chainSpent(world: Pick<ChainWorld, 'record' | 'tasks'>): number {
  let sum = 0
  for (const s of world.record.chain?.steps ?? []) sum += Math.max(0, world.tasks[s.id]?.spentUsd ?? 0)
  return sum
}

const waitWhy = (f: ChainTaskFacts): ChainWaitWhy => {
  if (f.state === 'running' || f.state === 'question' || f.state === 'failed' || f.state === 'stopped') return f.state
  if (f.stageKind === 'gate') return 'gate'
  if (f.stageKind === 'import') return 'import'
  return 'queued'
}

/** The ONE next move for a request's chain (see the head of this file). `press`: a VON HAND key on a card. */
export function nextMove(world: ChainWorld, press?: ChainPress): ChainMove {
  const { record, request } = world
  const chain = record.chain
  // sticky: once halted, only resumeChain leaves it — whatever the Status says now
  if (record.state === 'halted' || chain?.halted) return { kind: 'wait', why: 'halted' }
  // a request being created, interrupted, done, discarded or only planned: nothing to do
  if (record.state !== 'running' || !chain || !chain.steps.length) return { kind: 'wait', why: 'inactive' }

  const steps = chainSteps(chain)
  const skipped = new Set(chain.skipped ?? [])
  const advanced = chain.advanced ?? {}
  const live = steps.filter((s) => !skipped.has(s.n))
  if (steps.some(s => s.delivery && skipped.has(s.n))) return { kind: 'halt', why: 'member' }
  const facts = (s: OrderChainStep): ChainTaskFacts | undefined => world.tasks[s.id]
  if (steps.some(s => s.delivery && s.kind === 'qa' && steps.some(p => p.kind === 'coding') && facts(s)?.stageKind === 'done' && !facts(s)?.verified)) return { kind: 'halt', why: 'member' }
  const started = (s: OrderChainStep) => advanced[s.n] !== undefined
  // done: in a done stage — or, gone for good, recorded as moved to done
  const finished = (s: OrderChainStep) => {
    const f = facts(s)
    if (f?.exists) return f.stageKind === 'done'
    return !!f?.gone && chain.doneBy[s.n] !== undefined
  }
  // its successor started: it handed its Grundlage on — needed no more, there or not
  const handedOn = (i: number) => !!live[i + 1] && started(live[i + 1]!)
  // still needed by the chain: not handed on, and not the last step done
  const needed = (i: number) => !(handedOn(i) || (!live[i + 1] && finished(live[i]!)))
  // behind the frontier: done, or handed on
  const behind = (i: number) => finished(live[i]!) || handedOn(i)

  // 1. halt — the request. A Status older than the chain's latest start or resume: this tab's store lags behind the tab
  // that wrote Läuft — it settles (never a halt on a stale copy)
  const since = Math.max(chain.confirmedAt, chain.resumedAt ?? 0)
  const lagging = request.at !== undefined && request.at < since && world.now - since < SETTLE_MS
  if (request.usable && (request.status === 'halted' || request.status === 'done') && lagging) return { kind: 'wait', why: 'settling', at: since + SETTLE_MS }
  if (request.usable && request.status === 'halted') return { kind: 'halt', why: 'status' }
  // Fertig by anyone but the chain's own end (that writes the record 'done' first): the chain ends here — while this
  // device asks "end the chain?" it only waits
  // a team (Orders B12): a device without the worker link — its steps all done, the worker device's Fertig is the end
  const steering = !world.here || world.here.advance
  const allBehind = live.every((_s, i) => behind(i))
  if (request.usable && request.status === 'done') {
    if (!steering && allBehind) return { kind: 'done' }
    if (world.asking || (chain.finishing !== undefined && world.now - chain.finishing < FINISH_ASK_MS)) return { kind: 'wait', why: 'finishing' }
    return { kind: 'halt', why: 'finished' }
  }
  if (!request.live) return { kind: 'halt', why: 'trashed' }
  if (!request.usable) return { kind: 'halt', why: 'statusOption' }
  // a team (Orders B12): a device without the worker link only follows the request (its Status — a halt, the end, the
  // trash); what the steps did is the worker device's to judge — it moves them, halts on them and asks its cards (a
  // stale record here never halts a chain the worker device runs on)

  if (!steering) {
    const at = live.findIndex((_s, i) => !behind(i))
    return at < 0 ? { kind: 'wait', why: 'elsewhere' } : { kind: 'wait', why: 'elsewhere', step: live[at]!.n }
  }
  // 1. halt — the steps: ejected, or trashed / gone while the chain still needs them (one not arrived here yet waits)
  for (const s of live) if (facts(s)?.ejected) return { kind: 'halt', why: 'ejected', step: s.n }
  let arriving: number | null = null
  for (let i = 0; i < live.length; i++) {
    if (!needed(i)) continue
    const s = live[i]!
    const f = facts(s)
    if (!f || !f.exists) {
      if (!f || f.gone) return { kind: 'halt', why: 'member', step: s.n }
      arriving ??= s.n
      continue
    }
    if (f.trashed) return { kind: 'halt', why: 'member', step: s.n }
  }
  // 1. halt — parked steps (not started by the engine): out of order, or a project that would start them at once
  for (const s of live) {
    const f = facts(s)
    if (started(s) || !f?.exists) continue
    if (f.stage !== f.parkStage || f.state === 'running') return { kind: 'halt', why: 'outOfOrder', step: s.n }
  }
  for (const s of live) if (!started(s) && facts(s)?.exists && facts(s)!.startsAtOnce) return { kind: 'halt', why: 'startsAtOnce', step: s.n }
  if (arriving !== null) return { kind: 'wait', why: 'arriving', step: arriving }

  // the frontier: the first step not behind it
  const at = live.findIndex((_s, i) => !behind(i))
  // 4. done
  if (at < 0) return { kind: 'done' }
  const cur = live[at]!
  const f = facts(cur)!
  // A skipped dependency never satisfies a delivery contract, including on final QA.
  if (cur.needs?.some(n => skipped.has(n))) return { kind: 'halt', why: 'member', step: cur.n }
  for (const n of cur.needs ?? []) {
    const dependency = steps.find(s => s.n === n)
    if (!dependency) return { kind: 'halt', why: 'member', step: cur.n }
    const df = facts(dependency)
    if (!df || df.stageKind !== 'done') return { kind: 'wait', why: df ? waitWhy(df) : 'elsewhere', step: dependency.n }
  }
  let again = false
  if (started(cur)) {
    if (!(f.stage === f.parkStage && f.state !== 'running')) return { kind: 'wait', why: waitWhy(f), step: cur.n }
    const moved = chain.moved?.[cur.n]
    if (moved !== undefined) {
      // the record says the move landed and it stands parked: put back by someone other than the chain (recorded where it
      // happened, or still so after SETTLE_MS) — halted, never started over; else this tab's store lags behind
      if (chain.back?.[cur.n] !== undefined || world.now - moved >= SETTLE_MS) return { kind: 'halt', why: 'putBack', step: cur.n }
      return { kind: 'wait', why: 'settling', step: cur.n, at: moved + SETTLE_MS }
    }
    // the record started it, the move never landed (the tab that wrote ahead went away): moved again
    again = true
  }

  const idx = steps.findIndex((s) => s.n === cur.n)
  const prev = idx > 0 ? steps[idx - 1]! : null
  // step 01: its countdown (the Undo window)
  if (!prev && !again && world.now < chain.startAt) return { kind: 'wait', why: 'startAt', step: cur.n, at: chain.startAt }
  // 1. halt — before the step starts (a move again too): the budget, a project that cannot start it
  if (chain.budgetUsd !== undefined && chainSpent(world) >= chain.budgetUsd) return { kind: 'halt', why: 'budget', step: cur.n }
  if (!f.startStage || f.startStage === f.parkStage) return { kind: 'halt', why: 'noStart', step: cur.n }

  // 2. cards
  const prevSkipped = !!prev && skipped.has(prev.n)
  const by = prev && !prevSkipped ? (chain.doneBy[prev.n] ?? null) : null
  const all: ChainCardWhy[] = []
  // a reason a VON HAND key passed for this step before stays passed (a Confirm wait that came up after it never brings it back)
  const before = new Set(chain.passed?.[cur.n] ?? [])
  if (prev && !prevSkipped && !again) {
    if (!givesEvidence(by) && !before.has('evidence')) all.push('evidence')
    if (prev.kind === 'spec' && chain.checkpoint && !by?.sawNext && !(chain.seenNext ?? []).includes(prev.n) && !before.has('checkpoint')) all.push('checkpoint')
  }
  // the Grundlage it takes carries an outside write no card showed yet (step n's result, or a replanned chain's basis)
  const source = prev ? (prevSkipped ? null : prev.id) : (chain.basis?.id ?? null)
  if (source && world.basisForeign?.[cur.n]) all.push('basis')
  const drift: Array<'line' | 'approvals'> = []
  if (f.line !== cur.line) drift.push('line')
  if (f.approvals !== cur.approvals) drift.push('approvals')
  if (drift.length) all.push('drift')
  const refs = Object.entries(cur.refs).filter(([id, pin]) => {
    const r = world.refs[id]
    return !!r && r.fp !== pin && r.foreign
  }).map(([id]) => id)
  if (refs.length) all.push('ref')
  if (f.endsConfirm || !f.trusted) all.push('confirm')
  const passed = press && press.step === cur.n ? new Set<ChainCardWhy>(press.passes) : null
  // a press never passes the Confirm wait (whatever a caller hands in): only a confirmed version does — nor a changed
  // page or Grundlage: those were pinned to what the card showed (the sink), so they are gone here unless they moved on
  const open = all.filter((w) => w === 'confirm' || w === 'ref' || w === 'basis' || !passed?.has(w))
  if (open.length)
    return {
      kind: 'card',
      why: open[0]!,
      all: open,
      step: cur.n,
      from: prev?.n ?? null,
      ...(open.includes('evidence') ? { by } : {}),
      ...(open.includes('drift') ? { drift } : {}),
      ...(open.includes('ref') ? { refs } : {}),
      ...(open.includes('basis') && source ? { source } : {}),
      ...(open.includes('confirm') ? { agent: f.changedBy ?? null } : {}),
    }

  // 3. advance — a QA step on the coding step's repo without a branch of its own takes the coding step's
  let branch: string | null = null
  // Confirmed deliveries build sequentially on the latest coding branch of the same repository.
  if (cur.needs && !f.branch && (cur.kind === 'coding' || cur.kind === 'qa')) {
    const prior = live.slice(0, at).reverse().find(s => s.kind === 'coding' && !skipped.has(s.n) && facts(s)?.repo === f.repo)
    if (prior) branch = facts(prior)?.branch ?? null
  }
  if (cur.kind === 'qa' && !f.branch && prev && !prevSkipped && prev.kind === 'coding') {
    const pf = facts(prev)
    if (pf?.branch && pf.repo && pf.repo === f.repo) branch = pf.branch
  }
  return { kind: 'advance', step: cur.n, to: f.startStage, from: prev?.n ?? null, basis: !prev ? (chain.basis ? 'copy' : 'none') : prevSkipped ? 'skipped' : 'copy', branch, again }
}

/**
 * The step that starts once `taskId` (a step of this chain) is done: the next step not skipped, while the chain has
 * not started it yet (null: none — the last step, a step already started, not a step of this chain). A gate whose
 * approval ends step n releases it (coding/terminal.ts planTaskAction: `TaskActionPlan.chain`, VON HAND).
 */
export function chainSuccessor(chain: OrderChain | undefined, taskId: ID): OrderChainStep | null {
  if (!chain) return null
  const steps = chainSteps(chain)
  const at = steps.findIndex((s) => s.id === taskId)
  if (at < 0) return null
  const skipped = new Set(chain.skipped ?? [])
  const next = steps.slice(at + 1).find((s) => !skipped.has(s.n))
  if (!next || chain.advanced?.[next.n] !== undefined) return null
  return next
}

/* ------------------------------------------------------------------ the record (what the sink writes) */

/** Step n reached done: who moved it (written at the move — a later move overwrites it). */
export const withDone = (chain: OrderChain, n: number, by: OrderDoneBy): OrderChain => ({ ...chain, doneBy: { ...chain.doneBy, [n]: by } })

/** Step n's last gate was approved on a surface that showed the next step in full (the analysis checkpoint passes). */
export const withSeenNext = (chain: OrderChain, n: number): OrderChain => ((chain.seenNext ?? []).includes(n) ? chain : { ...chain, seenNext: [...(chain.seenNext ?? []), n].sort((a, b) => a - b) })

/**
 * The person accepted the pages step n takes along as the ref card showed them (its ↵): their fingerprints AS RENDERED
 * pinned — a page that moved on since the card rendered it differs from its pin and asks again.
 */
export function withRefs(chain: OrderChain, n: number, fps: Record<ID, string>): OrderChain {
  return { ...chain, steps: chain.steps.map((s) => (s.n === n ? { ...s, refs: Object.fromEntries(Object.keys(s.refs).map((id) => [id, fps[id] ?? s.refs[id]!])) } : s)) }
}

/** The person accepted the Grundlage step n takes, as the card showed it (its fingerprint). */
export const withBasisSeen = (chain: OrderChain, n: number, fp: string): OrderChain => (chain.basisSeen?.[n] === fp ? chain : { ...chain, basisSeen: { ...(chain.basisSeen ?? {}), [n]: fp } })

/** The move of step n landed in the store (written right after it, under the chain's lock). */
export const withMoved = (chain: OrderChain, n: number, at: number): OrderChain => ({ ...chain, moved: { ...(chain.moved ?? {}), [n]: at } })

/** Someone other than the chain put the moved step n back into its park stage (recorded in the tab where it happened). */
export const withBack = (chain: OrderChain, n: number, at: number): OrderChain => (chain.back?.[n] !== undefined ? chain : { ...chain, back: { ...(chain.back ?? {}), [n]: at } })

/** A write by someone other than the chain, the person or this device's worker to a page the chain copies or takes along. */
export const withForeign = (chain: OrderChain, id: ID, at: number): OrderChain => ({ ...chain, foreign: { ...(chain.foreign ?? {}), [id]: at } })

/** Outside writes no longer pending on these pages (a card showed them as they are now). */
export function withoutForeign(chain: OrderChain, ids: readonly ID[]): OrderChain {
  if (!chain.foreign || !ids.some((id) => id in chain.foreign!)) return chain
  const foreign = { ...chain.foreign }
  for (const id of ids) delete foreign[id]
  const { foreign: _f, ...rest } = chain
  return Object.keys(foreign).length ? { ...rest, foreign } : rest
}

/** This device asks "end the chain?" (the request was set to Fertig): the chain waits meanwhile (null: asked). */
export function withFinishing(chain: OrderChain, at: number | null): OrderChain {
  if (at !== null) return { ...chain, finishing: at }
  if (chain.finishing === undefined) return chain
  const { finishing: _f, ...rest } = chain
  return rest
}

/** A VON HAND key on a card for step n passed these reasons (kept: a later Confirm wait never brings them back). */
export function withPassed(chain: OrderChain, n: number, passes: readonly ChainPassable[]): OrderChain {
  const keep = passes.filter((w): w is 'evidence' | 'checkpoint' => w === 'evidence' || w === 'checkpoint')
  if (!keep.length) return chain
  const now = new Set(chain.passed?.[n] ?? [])
  if (keep.every((w) => now.has(w))) return chain
  return { ...chain, passed: { ...(chain.passed ?? {}), [n]: [...new Set([...now, ...keep])] } }
}

/** The engine starts step n (written before the move). */
export const withAdvance = (chain: OrderChain, n: number, at: number): OrderChain => ({ ...chain, advanced: { ...(chain.advanced ?? {}), [n]: at } })

/** Halt (sticky: an existing halt stays as it was). */
export function withHalt(chain: OrderChain, halt: { why: OrderHaltWhy; by: string; step?: number }, at: number): OrderChain {
  if (chain.halted) return chain
  return { ...chain, halted: { at, why: halt.why, by: halt.by, ...(halt.step !== undefined ? { step: halt.step } : {}) } }
}

/**
 * Resume (VON HAND, on the advancing device): the halt is gone; nextMove may raise a card or halt again. A step that was
 * put back into its park stage is moved again (its move marks dropped — the budget is checked before it).
 */
export function withResume(chain: OrderChain, at: number): OrderChain {
  const h = chain.halted
  let next: OrderChain = { ...chain, halted: null, resumedAt: at }
  if (h?.why === 'putBack' && h.step !== undefined) {
    const n = h.step
    const drop = (m: Record<number, number> | undefined) => (m && n in m ? Object.fromEntries(Object.entries(m).filter(([k]) => Number(k) !== n)) : m)
    const moved = drop(next.moved)
    const back = drop(next.back)
    const { moved: _m, back: _b, ...rest } = next
    next = { ...rest, ...(moved && Object.keys(moved).length ? { moved } : {}), ...(back && Object.keys(back).length ? { back } : {}) }
  }
  return next
}

/**
 * Skip step n (VON HAND): it leaves the chain — the next step starts without a Grundlage from it. A halt about that step
 * (ejected, trashed / gone, stopped with ⌘.) is lifted with it.
 */
export function withSkip(chain: OrderChain, n: number): OrderChain {
  const skipped = [...new Set([...(chain.skipped ?? []), n])].sort((a, b) => a - b)
  const lift = chain.halted && chain.halted.step === n && (chain.halted.why === 'member' || chain.halted.why === 'ejected' || chain.halted.why === 'stopped')
  return { ...chain, skipped, ...(lift ? { halted: null } : {}) }
}

/** The person accepted step n's changed pipeline (the drift card's ↵): its line and Approvals as they are now. */
export function withLine(chain: OrderChain, n: number, line: string, approvals: StageApprovals): OrderChain {
  return { ...chain, steps: chain.steps.map((s) => (s.n === n ? { ...s, line, approvals } : s)) }
}

/**
 * Orders B13 — the flight recorder's eject took back the creation of steps `ns` (eject `ejectId`): each is marked (the
 * engine halts on it: 'ejected', S decides). A halt already recorded because one of them went to the trash ('member' —
 * a pass that came before the eject's settle) names the eject instead; any other halt stays as it was (sticky).
 */
export function withEjected(chain: OrderChain, ns: readonly number[], ejectId: string): OrderChain {
  const known = new Set(chain.steps.map((s) => s.n))
  const add = ns.filter((n) => known.has(n) && chain.ejected?.[n] !== ejectId)
  const h = chain.halted
  const upgrade = !!h && h.why === 'member' && h.step !== undefined && ns.includes(h.step)
  if (!add.length && !upgrade) return chain
  const ejected = { ...(chain.ejected ?? {}) }
  for (const n of add) ejected[n] = ejectId
  return { ...chain, ejected, ...(upgrade && h ? { halted: { ...h, why: 'ejected' as const } } : {}) }
}

/**
 * The eject's Undo brought steps `ns` back: the marks THAT eject set go (another eject's stay). The halt stays — an eject
 * and its Undo never advance a chain; ↵ Fortsetzen goes on.
 */
export function withoutEjected(chain: OrderChain, ns: readonly number[], ejectId: string): OrderChain {
  if (!chain.ejected || !ns.some((n) => chain.ejected![n] === ejectId)) return chain
  const ejected = Object.fromEntries(Object.entries(chain.ejected).filter(([k, id]) => !(ns.includes(Number(k)) && id === ejectId)))
  const { ejected: _e, ...rest } = chain
  return Object.keys(ejected).length ? { ...rest, ejected } : rest
}

/** May the chain be resumed now? A halt for the budget stays while the spend is at or above it. */
export function mayResume(world: Pick<ChainWorld, 'record' | 'tasks'>): 'ok' | 'notHalted' | 'budget' {
  const chain = world.record.chain
  if (!chain?.halted) return 'notHalted'
  if (chain.budgetUsd !== undefined && chainSpent(world) >= chain.budgetUsd) return 'budget'
  return 'ok'
}

/** May step n be skipped (S)? A step of the chain not done and not skipped yet that failed, stopped, or is trashed, gone or ejected. */
export function canSkip(world: Pick<ChainWorld, 'record' | 'tasks'>, n: number): boolean {
  const chain = world.record.chain
  const s = chain?.steps.find((x) => x.n === n)
  if (!chain || !s || (chain.skipped ?? []).includes(n)) return false
  const f = world.tasks[s.id]
  if (!f || !f.exists || f.trashed || f.ejected) return true
  if (f.stageKind === 'done') return false
  return f.state === 'failed' || f.state === 'stopped'
}
