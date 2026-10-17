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
 *     the Status set to Angehalten (by any writer) · the request trashed or gone · its Status options missing · a step
 *     ejected · a step trashed or gone that the chain still needs (a done step whose successor started is no longer
 *     needed) · a parked step out of its park stage (or running) without the engine having started it ("ran out of
 *     order") · a parked step's project that now hands new tasks to the worker at once · the chain budget reached before
 *     the next step starts (never mid-step) · a step to start whose project has no stage to start it in.
 *  2. card (VON HAND; the chain waits, it is not halted) — before the next step n+1 starts: step n done without
 *     evidence (only `coding` = this device's worker, `you` via none / 'ui' / 'preflight', and `terminal` count) ·
 *     after an analysis step with "Stop after the analysis" on, unless the approval that finished it showed step n+1 in
 *     full (`sawNext`) · step n+1's pipeline line (start: true) or its Approvals changed since confirm · a page step n+1
 *     takes along changed since confirm by someone other than the person · step n+1 waits for Confirm or is not trusted
 *     here (no chain write ever ends that wait — the card renders the task's version; its ↵ confirms it, then goes on).
 *     A press on a card (`ChainPress`) passes the reasons that card showed — never 'confirm' (that needs the version
 *     confirmed: the facts then say trusted).
 *  3. advance step n+1 (step 01 once `startAt` is reached): the Grundlage (orders/basis.ts) from step n — or the line
 *     "skipped" —, a QA step takes the coding step's branch, Stage → its start stage. A step the record marks started
 *     but that still stands in its park stage is moved again (`again`: the move is idempotent).
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
  /** false: no such row here (deleted for good, never arrived) */
  exists: boolean
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
  rev: number
  /** its newest write was not the person's own on this device (another origin, an agent's stamp …) */
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
  }
  /** per task id of the record */
  tasks: Record<ID, ChainTaskFacts>
  /** per page id the steps take along */
  refs: Record<ID, ChainRefFacts>
}

/* ------------------------------------------------------------------ the outcomes */

/** Why a card asks before the next step starts. */
export type ChainCardWhy = 'evidence' | 'checkpoint' | 'drift' | 'ref' | 'confirm'
/** The card reasons a press can pass (a Confirm wait needs the version confirmed). */
export type ChainPassable = Exclude<ChainCardWhy, 'confirm'>
export const CARD_ORDER: readonly ChainCardWhy[] = ['evidence', 'checkpoint', 'drift', 'ref', 'confirm']

export type ChainWaitWhy = 'inactive' | 'halted' | 'startAt' | 'running' | 'question' | 'failed' | 'stopped' | 'gate' | 'import' | 'queued'

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
      /** 'copy': step `from`'s result · 'skipped': the line "step n skipped — no basis" · 'none': the first step */
      basis: 'copy' | 'skipped' | 'none'
      /** a QA step takes the coding step's branch (null: none) */
      branch: string | null
      /** the record had started it already; it still stood parked — the move again */
      again: boolean
    }
  | { kind: 'done' }
  | { kind: 'wait'; why: ChainWaitWhy; step?: number; at?: number }

/** A VON HAND key on a card for step `step`: it passes the reasons the card showed. */
export interface ChainPress {
  step: number
  passes: readonly ChainPassable[]
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
  const facts = (s: OrderChainStep): ChainTaskFacts | undefined => world.tasks[s.id]
  const finished = (s: OrderChainStep) => {
    const f = facts(s)
    return !!f?.exists && f.stageKind === 'done'
  }
  const started = (s: OrderChainStep) => advanced[s.n] !== undefined

  // 1. halt — the request
  if (request.usable && request.status === 'halted') return { kind: 'halt', why: 'status' }
  if (!request.live) return { kind: 'halt', why: 'trashed' }
  if (!request.usable) return { kind: 'halt', why: 'statusOption' }

  // 1. halt — the steps: ejected, or trashed / gone while the chain still needs them
  for (const s of live) if (facts(s)?.ejected) return { kind: 'halt', why: 'ejected', step: s.n }
  for (let i = 0; i < live.length; i++) {
    const s = live[i]!
    const f = facts(s)
    const next = live[i + 1]
    const needed = !(finished(s) && (!next || started(next)))
    if (needed && (!f || !f.exists || f.trashed)) return { kind: 'halt', why: 'member', step: s.n }
  }
  // 1. halt — parked steps (not started by the engine): out of order, or a project that would start them at once
  for (const s of live) {
    if (started(s)) continue
    const f = facts(s)!
    if (f.stage !== f.parkStage || f.state === 'running') return { kind: 'halt', why: 'outOfOrder', step: s.n }
  }
  for (const s of live) if (!started(s) && facts(s)!.startsAtOnce) return { kind: 'halt', why: 'startsAtOnce', step: s.n }

  // the frontier: the first step not done
  const at = live.findIndex((s) => !finished(s))
  // 4. done
  if (at < 0) return { kind: 'done' }
  const cur = live[at]!
  const f = facts(cur)!
  const again = started(cur)
  if (again && !(f.stage === f.parkStage && f.state !== 'running')) return { kind: 'wait', why: waitWhy(f), step: cur.n }

  const idx = steps.findIndex((s) => s.n === cur.n)
  const prev = idx > 0 ? steps[idx - 1]! : null
  // step 01: its countdown (the Undo window)
  if (!prev && !again && world.now < chain.startAt) return { kind: 'wait', why: 'startAt', step: cur.n, at: chain.startAt }
  // 1. halt — before the next step starts: the budget, a project that cannot start it
  if (!again && chain.budgetUsd !== undefined && chainSpent(world) >= chain.budgetUsd) return { kind: 'halt', why: 'budget', step: cur.n }
  if (!f.startStage || f.startStage === f.parkStage) return { kind: 'halt', why: 'noStart', step: cur.n }

  // 2. cards
  const prevSkipped = !!prev && skipped.has(prev.n)
  const by = prev && !prevSkipped ? (chain.doneBy[prev.n] ?? null) : null
  const all: ChainCardWhy[] = []
  if (prev && !prevSkipped && !again) {
    if (!givesEvidence(by)) all.push('evidence')
    if (prev.kind === 'spec' && chain.checkpoint && !by?.sawNext) all.push('checkpoint')
  }
  const drift: Array<'line' | 'approvals'> = []
  if (f.line !== cur.line) drift.push('line')
  if (f.approvals !== cur.approvals) drift.push('approvals')
  if (drift.length) all.push('drift')
  const refs = Object.entries(cur.refs).filter(([id, rev]) => {
    const r = world.refs[id]
    return !!r && r.rev !== rev && r.foreign
  }).map(([id]) => id)
  if (refs.length) all.push('ref')
  if (f.endsConfirm || !f.trusted) all.push('confirm')
  const passed = press && press.step === cur.n ? new Set<ChainCardWhy>(press.passes) : null
  // a press never passes the Confirm wait (whatever a caller hands in): only a confirmed version does
  const open = all.filter((w) => w === 'confirm' || !passed?.has(w))
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
      ...(open.includes('confirm') ? { agent: f.changedBy ?? null } : {}),
    }

  // 3. advance — a QA step on the coding step's repo without a branch of its own takes the coding step's
  let branch: string | null = null
  if (cur.kind === 'qa' && !f.branch && prev && !prevSkipped && prev.kind === 'coding') {
    const pf = facts(prev)
    if (pf?.branch && pf.repo && pf.repo === f.repo) branch = pf.branch
  }
  return { kind: 'advance', step: cur.n, to: f.startStage, from: prev?.n ?? null, basis: !prev ? 'none' : prevSkipped ? 'skipped' : 'copy', branch, again }
}

/* ------------------------------------------------------------------ the record (what the sink writes) */

/** Step n reached done: who moved it (written at the move — a later move overwrites it). */
export const withDone = (chain: OrderChain, n: number, by: OrderDoneBy): OrderChain => ({ ...chain, doneBy: { ...chain.doneBy, [n]: by } })

/** The engine starts step n (written before the move). */
export const withAdvance = (chain: OrderChain, n: number, at: number): OrderChain => ({ ...chain, advanced: { ...(chain.advanced ?? {}), [n]: at } })

/** Halt (sticky: an existing halt stays as it was). */
export function withHalt(chain: OrderChain, halt: { why: OrderHaltWhy; by: string; step?: number }, at: number): OrderChain {
  if (chain.halted) return chain
  return { ...chain, halted: { at, why: halt.why, by: halt.by, ...(halt.step !== undefined ? { step: halt.step } : {}) } }
}

/** Resume (VON HAND, on the advancing device): the halt is gone; nextMove may raise a card or halt again. */
export const withResume = (chain: OrderChain, at: number): OrderChain => ({ ...chain, halted: null, resumedAt: at })

/**
 * Skip step n (VON HAND): it leaves the chain — the next step starts without a Grundlage from it. A halt about that step
 * (ejected, trashed / gone) is lifted with it.
 */
export function withSkip(chain: OrderChain, n: number): OrderChain {
  const skipped = [...new Set([...(chain.skipped ?? []), n])].sort((a, b) => a - b)
  const lift = chain.halted && chain.halted.step === n && (chain.halted.why === 'member' || chain.halted.why === 'ejected')
  return { ...chain, skipped, ...(lift ? { halted: null } : {}) }
}

/** The person accepted step n's changed pipeline (the drift card's ↵): its line and Approvals as they are now. */
export function withLine(chain: OrderChain, n: number, line: string, approvals: StageApprovals): OrderChain {
  return { ...chain, steps: chain.steps.map((s) => (s.n === n ? { ...s, line, approvals } : s)) }
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
