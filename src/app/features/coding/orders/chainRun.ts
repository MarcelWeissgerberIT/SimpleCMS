/**
 * Work orders — the chain engine's app side, the sink (spec §2.10): the world `nextMove` (coding/chain.ts) decides on,
 * the parked-start guard, the done evidence, the catch-up passes, and the moves themselves.
 *
 *  - `chainWorld(row, record)`: the facts of every step of this device's record (the store, this device's run state and
 *    trust) — never the Prüfauftrag relation or the Schritt number on the rows. A page a step takes along counts as
 *    changed when its FINGERPRINT (fingerprint.ts: title + text — never the tab-local contentRev) differs from the
 *    step's pin, and as changed by someone else when an outside write to it was recorded, an agent's stamp is on it,
 *    or its newest text is not the person's own on this device. A step absent here that this tab never held, while the
 *    chain is young (< SETTLE_MS), is arriving from the tab that made it — never "gone". The Grundlage a step would take
 *    is fingerprinted when its source carries an outside write (`basisForeign`).
 *  - The parked-start guard (tasks.ts setParkedGuard): a step of a chain on this device that the chain has not started
 *    (not in `advanced`, not skipped) — or that the record says started but that still stands in its park stage (the
 *    move did not happen) — is never handed to the worker. Read from this tab's copy of the records (all of this scope's
 *    are read at start, the channel keeps them current); until they are read, every task that carries a work order's
 *    relation is held.
 *  - Outside writes (the same subscriber, in the tab where they happen — never a replay from another tab): a write by
 *    someone other than the chain, the person or this device's worker (an agent, the bridge, the sync, an automation, a
 *    script, another device …) to a started step's text, a page a step takes along or a replan's basis step is recorded
 *    (`OrderChain.foreign`) — the Grundlage / ref card shows it before it goes on; a moved step put back into its park
 *    stage by someone other than the chain is recorded (`back`) — the chain halts ('putBack'), never starts it over.
 *  - The done evidence: a store subscriber reads, synchronously inside the write, who moved a chain step into a done
 *    stage in THIS tab (the worker's stage `coding`, an approval `you~ui` / `you~preflight` / `terminal`, a board drag
 *    `you`, an agent, an automation …) and records it as `doneBy[n]` (withDone); an approval whose surface showed the
 *    next step in full (tasks.ts approvalSawNext) marks it (`sawNext` / `seenNext`). A replay from another tab or a
 *    change from the server records nothing (the origin tab writes the record; in a team the worker device then asks).
 *  - The catch-up: every running chain at start, when the worker comes online, after the hooks beside spawnFollowUps
 *    (tasks.ts setChainHook: finishStage / approveTask reached done) and — debounced — after any change of a chain step
 *    or its request row. A done step without recorded evidence waits ≤ 2 s once for a record another tab announces
 *    before its card shows.
 *  - `runChain(row, press?)`: under the Web Lock `one-order-chain:<scope>:<row>` — reads the record again, builds the
 *    world, asks `nextMove` and acts: a halt (sticky: the record's `halted`, Status → Angehalten by the order writer
 *    `#s`), an advance (write-ahead `advanced`, then under `keepTrust` as `order:<row>:<run>#a<n>`: the Grundlage into
 *    the step's slot — a copy, replacing the slot or an earlier copy, never appended —, a QA step's shared branch, the
 *    Stage; then `moved` — still under the lock, so no other tab ever moves it again from a lagging store), the end
 *    (record 'done', Status → Fertig), a card (published for the plate; the chain waits), a countdown
 *    (scheduled). Never a write past a task's wait for Confirm: the engine raises the 'confirm' card, and the move checks
 *    again synchronously right before it writes. A VON HAND key on a card passes the reasons it showed (`press`): an
 *    accepted pipeline change or page revision is pinned again first.
 *  - In a team only the device with the worker link advances (the world's `here`); halts and cards are this device's.
 *  - Notifications (coding/notify.ts, `one.coding.notify`): "Weiter mit Schritt 02?", "Kette angehalten", "Prüfauftrag
 *    PA-12 fertig" — once each.
 */
import { create } from 'zustand'
import { pageChanges, useWorkspace, type WorkspaceState } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { isApplyingRemote } from '../../../store/persistence'
import type { Database, ID, Page } from '../../../store/types'
import { currentWriter, inPersonEvent, type Writer } from '../../../store/writer'
import { isApplyingCloudChange, useCloud } from '../../../cloud'
import { currentLang, t } from '../../../i18n'
import { agentIdOf } from '../../agents/attribution'
import { ejectHeardWithin, isEjectWriter, isSettled } from '../../recorder/settled'
import { useCoding } from '../state'
import { workerOnline } from '../link'
import { codingProps, inTeam, kindOfDb, optionName, readPipeline, stageOfRow } from '../schema'
import { approvalSawNext, approvalsOf, moveTask, setChainHook, setParkedGuard } from '../tasks'
import { loadTask, taskLocal } from '../local'
import { isTrusted, keepTrust, writeEndsConfirm } from '../trust'
import { notifyAway } from '../notify'
import { pipelineLine, startStageOf } from '../stages'
import { doneEvidence, nextMove, parksNewTasks, SETTLE_MS, withAdvance, withBack, withBasisSeen, withDone, withForeign, withHalt, withLine, withMoved, withoutForeign, withPassed, withRefs, withSeenNext, type ChainMove, type ChainPress, type ChainTaskFacts, type ChainWorld } from '../chain'
import { basisBlock, basisText, placeBasis, skippedBlock } from './basis'
import { pageFp, textFp } from './fingerprint'
import { originByPerson } from './autoCore'
import { chainWords, stepNo } from './words'
import { orderConfigUsable, readOrderConfig } from './config'
import { orderCode, orderStatusKey, writeOrderStatus } from './db'
import { loadOrderRecord, ORDERS_CHANNEL, orderScope, patchOrderRecord, recordRowIds, useOrderRecords } from './records'
import { ORDER_LIMITS, type OrderChain, type OrderChainStep, type OrderDoneBy, type OrderRecord } from './types'

const ws = () => useWorkspace.getState()
const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/** The content origin of what the chain writes into a step page (the Grundlage). */
export const ORDER_ORIGIN = 'order'

/* ------------------------------------------------------------------ the world */

/** The person's own text by its content origin — autoCore.ts's one rule (no origin: no evidence, foreign here). */
const byPerson = originByPerson

const missing: ChainTaskFacts = { exists: false, trashed: false, stage: null, stageKind: null, parkStage: null, startStage: null, startsAtOnce: false, state: 'idle', line: '', approvals: 'all', endsConfirm: false, trusted: false, repo: null, branch: null, spentUsd: 0 }

/**
 * Chain steps this tab's store has held (a step absent now that was here is gone — deleted, or removed by a replay of
 * another tab's deletion; one never seen here may still be on its way from the tab that made it).
 */
const seenHere = new Set<ID>()

/**
 * What the engine knows about one task of the chain now. `young`: the chain was confirmed / started so recently that a
 * step another tab created may not have reached this tab's store yet — absent and never seen here, it is arriving.
 */
export async function taskFacts(id: ID, young = false): Promise<ChainTaskFacts> {
  const s = ws()
  const page = s.pages[id]
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page) return { ...missing, gone: seenHere.has(id) || !young }
  seenHere.add(id)
  if (!db || !kindOfDb(db.id)) return { ...missing, gone: true }
  const trashed = page.trashed || isEffectivelyTrashed(s.pages, id)
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  const stage = stageOfRow(pipeline, props, page)
  const repo = optionName(db, props.repo, props.repo ? page.properties[props.repo] : null)
  const branchRaw = props.branch ? page.properties[props.branch] : null
  await loadTask(id)
  const local = taskLocal(id)
  const approvals = approvalsOf(local, page.createdAt)
  const running = useCoding.getState().busy.some((b) => b.taskId === id)
  const trusted = trashed ? false : await isTrusted(id)
  return {
    exists: true,
    trashed,
    stage: stage?.id ?? null,
    stageKind: stage?.kind ?? null,
    parkStage: startStageOf(pipeline, !!repo, false)?.id ?? null,
    startStage: startStageOf(pipeline, !!repo, true)?.id ?? null,
    startsAtOnce: !parksNewTasks(pipeline),
    state: running ? 'running' : local.state,
    line: pipelineLine(pipeline, !!repo, true, approvals),
    approvals,
    // a write here would end a wait for Confirm — only while there is one (a version this device trusts has none left)
    endsConfirm: writeEndsConfirm(page) && !trusted,
    trusted,
    changedBy: agentIdOf(page.updatedBy) ? page.updatedBy : null,
    repo,
    branch: typeof branchRaw === 'string' && branchRaw.trim() ? branchRaw.trim() : null,
    spentUsd: typeof local.spentUsd === 'number' && local.spentUsd > 0 ? local.spentUsd : 0,
  }
}

/** The step whose result step `n` takes as its Grundlage (null: none — the first step, or the one before was skipped). */
export function basisSource(chain: OrderChain, n: number): ID | null {
  const steps = [...chain.steps].sort((a, b) => a.n - b.n)
  const i = steps.findIndex((s) => s.n === n)
  if (i < 0) return null
  const prev = i > 0 ? steps[i - 1]! : null
  if (prev) return (chain.skipped ?? []).includes(prev.n) ? null : prev.id
  return chain.basis?.id ?? null
}

/** The fingerprint of the Grundlage step `n` would take now — what a card shows of it ('' : none). */
export async function basisFpNow(chain: OrderChain, n: number): Promise<string> {
  const block = basisPreview(chain, n)
  return block ? textFp(basisText(block)) : ''
}

/**
 * Per step not started yet: its Grundlage carries an outside write (`OrderChain.foreign` of its source) that no card
 * showed as it is now (`basisSeen`).
 */
async function basisForeignOf(chain: OrderChain | undefined): Promise<Record<number, boolean>> {
  const out: Record<number, boolean> = {}
  if (!chain?.foreign) return out
  for (const st of chain.steps) {
    if (chain.advanced?.[st.n] !== undefined || (chain.skipped ?? []).includes(st.n)) continue
    const src = basisSource(chain, st.n)
    if (!src || chain.foreign[src] === undefined) continue
    out[st.n] = (await basisFpNow(chain, st.n)) !== chain.basisSeen?.[st.n]
  }
  return out
}

/** Requests this tab asks "end the chain?" about right now (the request was set to Fertig while it ran — trigger.ts). */
const asking = new Set<ID>()
export function holdFinishing(rowId: ID, on: boolean): void {
  if (on) asking.add(rowId)
  else asking.delete(rowId)
  kick(rowId)
}

/**
 * Did an eject take step `n`'s creation back (Orders B13)? The record's mark (eject.ts settleEjectedOrder), or the eject's
 * settled mark on its unit `order:<row>:<run>#c<n>` / `#a<n>` — set in every tab the moment the eject settles, before
 * the record is written and before the eject's write reaches another tab's store.
 */
export function stepEjected(rowId: ID, chain: OrderChain, n: number): boolean {
  if (chain.ejected?.[n] !== undefined) return true
  const key = `order:${rowId}:${chain.run}`
  return isSettled(key, `c${n}`) || isSettled(key, `a${n}`)
}

/** The facts of a request's chain on this device (`record` = this device's record of it). */
export async function chainWorld(rowId: ID, record: OrderRecord, now = Date.now()): Promise<ChainWorld> {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  const chain = record.chain
  // a step made in another tab reaches this one with that tab's save: absent and never seen here while young, it arrives
  const young = !!chain && now - Math.max(chain.confirmedAt, chain.startAt - ORDER_LIMITS.startDelayMs) < SETTLE_MS
  const tasks: ChainWorld['tasks'] = {}
  const refs: ChainWorld['refs'] = {}
  for (const step of chain?.steps ?? []) {
    tasks[step.id] = await taskFacts(step.id, young)
    // Orders B13: an eject took its creation back — the record's mark, or (before the record says so, in this tab or
    // another) the eject's settled mark on its unit
    if (chain && stepEjected(rowId, chain, step.n)) tasks[step.id] = { ...tasks[step.id]!, ejected: true }
    for (const id of Object.keys(step.refs)) {
      const p = s.pages[id]
      // foreign: an outside write recorded where it happened, an agent's stamp, or text not from a person's editor here
      if (p && !refs[id]) refs[id] = { fp: await pageFp(p), foreign: chain?.foreign?.[id] !== undefined || !!agentIdOf(p.updatedBy) || !byPerson(p.contentOrigin) }
    }
  }
  return {
    now,
    record,
    request: { live: !!row && !row.trashed && !isEffectivelyTrashed(s.pages, rowId), status: orderStatusKey(rowId), usable: orderConfigUsable(readOrderConfig(db)), ...(row ? { at: row.updatedAt } : {}) },
    tasks,
    refs,
    // a team: only the device with the worker link moves a step
    here: { advance: !inTeam() || workerOnline() },
    basisForeign: await basisForeignOf(chain),
    asking: asking.has(rowId),
  }
}

/**
 * What a card for step `n` would show now, as fingerprints (the seam's stand-in for a card that rendered it): every page
 * the step takes along, its Grundlage.
 */
export async function shownNow(chain: OrderChain, n: number): Promise<{ refs: Record<ID, string>; basis: string }> {
  const step = chain.steps.find((s) => s.n === n)
  const refs: Record<ID, string> = {}
  for (const id of Object.keys(step?.refs ?? {})) refs[id] = await pageFp(ws().pages[id])
  return { refs, basis: await basisFpNow(chain, n) }
}

/* ------------------------------------------------------------------ the steps this tab knows */

/** Steps of a chain the chain has not started (they wait in their park stage). */
export function parkedOf(chain: OrderChain | undefined): ID[] {
  if (!chain) return []
  const skipped = new Set(chain.skipped ?? [])
  return chain.steps.filter((s) => chain.advanced?.[s.n] === undefined && !skipped.has(s.n)).map((s) => s.id)
}

/** Steps the record says started (the move may not have happened yet: still in their park stage — held all the same). */
const startedOf = (chain: OrderChain | undefined): ID[] => (chain ? chain.steps.filter((s) => chain.advanced?.[s.n] !== undefined && !(chain.skipped ?? []).includes(s.n)).map((s) => s.id) : [])

interface StepAt {
  row: ID
  n: number
  run: string
}

interface Index {
  of: unknown
  scope: string
  /** parked steps of every record of this scope (an older chain's too) */
  parked: Set<ID>
  /** steps the record started — held while they still stand in their park stage */
  started: Set<ID>
  /** steps of running / halted chains → their request (the done subscriber, the catch-up) */
  steps: Map<ID, StepAt>
  /** requests with a running or halted chain here */
  rows: Set<ID>
  /** pages those chains take along (refs) or copy from (a replan's basis step) → their requests (outside writes recorded) */
  watch: Map<ID, Array<{ row: ID; run: string }>>
}

let loaded = false
let index: Index | null = null

/** What this tab knows of the records of this scope (cached per records object). */
function indexNow(): Index {
  const recs = useOrderRecords.getState().recs
  const sc = orderScope()
  if (index?.of === recs && index.scope === sc) return index
  const out: Index = { of: recs, scope: sc, parked: new Set(), started: new Set(), steps: new Map(), rows: new Set(), watch: new Map() }
  const prefix = `${sc}|`
  for (const [key, rec] of Object.entries(recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable') continue
    const row = key.slice(prefix.length)
    for (const id of parkedOf(rec.chain)) out.parked.add(id)
    for (const id of startedOf(rec.chain)) out.started.add(id)
    // an older chain this one replaced: its steps went to the trash at the start — held all the same
    for (const id of parkedOf(rec.chain?.replaced?.chain)) out.parked.add(id)
    // a chain a replan stands beside (a draft over a running one): its parked steps stay held too
    if (rec.chain && (rec.state === 'running' || rec.state === 'halted' || rec.state === 'draft')) {
      const run = rec.chain.run
      for (const s of rec.chain.steps) out.steps.set(s.id, { row, n: s.n, run })
      for (const id of new Set([...rec.chain.steps.flatMap((s) => Object.keys(s.refs)), ...(rec.chain.basis ? [rec.chain.basis.id] : [])])) out.watch.set(id, [...(out.watch.get(id) ?? []), { row, run }])
      if (rec.state !== 'draft') out.rows.add(row)
    }
  }
  index = out
  return out
}

/** Does this task carry a work order's relation (before the records are read: held, never handed out on a doubt)? */
function carriesOrder(page: Page | undefined): boolean {
  const db = page?.databaseId ? ws().databases[page.databaseId] : undefined
  if (!page || !db) return false
  const prop = codingProps(db).order
  const v = prop ? page.properties[prop] : undefined
  return Array.isArray(v) && v.length > 0
}

/** Does the task still stand in its park stage (the first stage a new task is made in)? */
function inParkStage(taskId: ID): boolean {
  const s = ws()
  const page = s.pages[taskId]
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page || !db) return false
  const props = codingProps(db)
  const pipeline = readPipeline(db)
  const repo = props.repo ? page.properties[props.repo] : null
  return stageOfRow(pipeline, props, page)?.id === startStageOf(pipeline, !!repo, false)?.id
}

function parkedGuard(taskId: ID): boolean {
  if (!loaded) return carriesOrder(ws().pages[taskId])
  const idx = indexNow()
  return idx.parked.has(taskId) || (idx.started.has(taskId) && inParkStage(taskId))
}

/* ------------------------------------------------------------------ locks, writers */

const chainLock = (rowId: ID) => `one-order-chain:${orderScope()}:${rowId}`

export async function withChainLock<T>(rowId: ID, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return (await locks.request(chainLock(rowId), fn)) as T
}

/** The order writer of a chain (`order:<row>:<run>[#<change>]`). */
export const orderWriter = (rowId: ID, run: string, change?: string): Writer => ({ kind: 'order', row: rowId, run, ...(change ? { change } : {}) })

/* ------------------------------------------------------------------ what the plate reads */

export interface ChainView {
  /** the newest move of the request's chain in this tab */
  move: ChainMove
  at: number
}

/** The newest move per request (the plate's card, the Laufleiste's lines). */
export const useChainMoves = create<{ moves: Record<ID, ChainView> }>()(() => ({ moves: {} }))

const publish = (rowId: ID, move: ChainMove | null) =>
  useChainMoves.setState((st) => {
    if (!move) {
      if (!(rowId in st.moves)) return st
      const moves = { ...st.moves }
      delete moves[rowId]
      return { moves }
    }
    return { moves: { ...st.moves, [rowId]: { move, at: Date.now() } } }
  })

/** The request as people read it ("PA-12"), else its title. */
const codeOf = (rowId: ID) => orderCode(rowId) ?? (ws().pages[rowId]?.title.trim() || t('common.untitled'))

/** Once per thing to say (a card of a step, a halt, the end). */
const told = new Set<string>()
function tell(key: string, rowId: ID, message: string): void {
  if (told.has(key)) return
  told.add(key)
  notifyAway(rowId, message)
}

/* ------------------------------------------------------------------ the done evidence */

/** Evidence writes not stored yet, per request (runChain waits for them). */
const evidence = new Map<ID, Promise<unknown>>()

function queueEvidence(rowId: ID, write: () => Promise<unknown>): void {
  const before = evidence.get(rowId) ?? Promise.resolve()
  const next = before.then(write, write).catch(() => undefined)
  evidence.set(rowId, next)
  void next.finally(() => {
    if (evidence.get(rowId) === next) evidence.delete(rowId)
  })
}

/**
 * The writer of the write happening now, as the done subscriber reads it: the open frame; a replay from another tab or a
 * change from the server is no one's here (null — the origin tab records it); without a frame, a trusted event of the
 * person is `you~ui`, anything else is unknown (no evidence).
 */
function writerNow(): Writer | null {
  if (isApplyingRemote() || isApplyingCloudChange()) return null
  const w = currentWriter()
  if (w) return w.kind === 'system' && w.why === 'tab' ? null : w
  return inPersonEvent() ? { kind: 'you', via: 'ui' } : { kind: 'unknown' }
}

/** The stage a pipeline row stands in, and the stage a new task waits in (cached per database object). */
const pipelines = new WeakMap<Database, { props: ReturnType<typeof codingProps>; pipeline: ReturnType<typeof readPipeline> }>()
function stageInfo(page: Page | undefined, s: Pick<WorkspaceState, 'databases'>): { id: ID; kind: string; park: ID | null } | null {
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page || !db) return null
  let p = pipelines.get(db)
  if (!p) {
    p = { props: codingProps(db), pipeline: readPipeline(db) }
    pipelines.set(db, p)
  }
  const stage = stageOfRow(p.pipeline, p.props, page)
  if (!stage) return null
  const repo = p.props.repo ? page.properties[p.props.repo] : null
  return { id: stage.id, kind: stage.kind, park: startStageOf(p.pipeline, !!repo, false)?.id ?? null }
}

/** Writers whose text may go on to Claude Code without a card: the chain, the person (an editor here), this device's worker … */
const INSIDE = new Set<Writer['kind']>(['you', 'editor', 'coding', 'order', 'terminal', 'ai', 'system', 'eject', 'rewind'])

/**
 * Who wrote what happens now, for the outside-write record: null = no one outside (the person, the chain, this device's
 * worker …) or a replay from another tab of this device (that tab records it); else the outside writer's kind — an
 * agent, the bridge, the sync, an automation, a script, a change from another device ('remote') …
 */
function outsideWriter(): string | null {
  if (isApplyingRemote()) return null
  if (isApplyingCloudChange()) return 'remote'
  const w = currentWriter()
  if (!w) return inPersonEvent() ? null : 'unknown'
  if (isEjectWriter(w)) return null
  return INSIDE.has(w.kind) ? null : w.kind
}

/** After an eject was heard of, replays of another tab's writes run no chain for this long (ms). */
export const EJECT_QUIET_MS = 10_000

/** A chain this record holds that the subscriber still records for. */
const active = (r: OrderRecord | null, run: string): r is OrderRecord & { chain: OrderChain } => !!r?.chain && r.chain.run === run && (r.state === 'running' || r.state === 'halted' || (r.state === 'draft' && !!r.draft?.over))

/**
 * The store subscriber: who moved a chain step to done (recorded), a moved step put back into its park stage by someone
 * other than the chain, an outside write to a page the chain copies or takes along (a started step's text, a ref, a
 * replan's basis step), and a catch-up after any change of a chain.
 */
function onStore(state: WorkspaceState, prev: WorkspaceState): void {
  if (state.pages === prev.pages || !state.ready || !prev.ready || state.epoch !== prev.epoch) return
  // Orders B13: an eject and its Undo never run a chain (recorder/settled.ts isEjectWriter) — no pass, no evidence, no
  // outside write; what the eject took back reaches the chain only through its settle (eject.ts: marks, a halt). A
  // replay of another tab's write right after an eject was heard of may be that eject's (or its Undo's): left alone too
  // (the tab that wrote it runs its own passes)
  if (isEjectWriter(currentWriter()) || (isApplyingRemote() && ejectHeardWithin(EJECT_QUIET_MS))) return
  const idx = indexNow()
  if (!idx.steps.size && !idx.rows.size && !idx.watch.size) return
  const diff = pageChanges(state.pages, prev.pages)
  let who: Writer | null | undefined
  let outside: string | null | undefined
  const outsideNow = () => (outside === undefined ? (outside = outsideWriter()) : outside)
  const textChanged = (id: ID) => {
    const now = state.pages[id]
    const before = prev.pages[id]
    return !!now && !!before && (now.content !== before.content || now.title !== before.title)
  }
  for (const id of [...diff.changed, ...diff.removed]) {
    if (idx.rows.has(id)) kick(id)
    // a page the chain takes along or copies from: an outside write is recorded (the card shows it before it goes on)
    const watched = idx.watch.get(id)
    if (watched) {
      for (const w of watched) kick(w.row)
      if (textChanged(id) && outsideNow()) {
        const at = Date.now()
        for (const w of watched) queueEvidence(w.row, () => patchOrderRecord(w.row, (r) => (active(r, w.run) ? { ...r, chain: withForeign(r.chain, id, at) } : r)))
      }
    }
    const at = idx.steps.get(id)
    if (!at) continue
    kick(at.row)
    const now = state.pages[id]
    const before = prev.pages[id]
    if (before) seenHere.add(id)
    if (!now || !before) continue
    // an outside write to a started step: its result goes on as the next step's Grundlage — recorded
    if (textChanged(id) && outsideNow()) {
      const t0 = Date.now()
      queueEvidence(at.row, () => patchOrderRecord(at.row, (r) => (active(r, at.run) && r.chain.advanced?.[at.n] !== undefined ? { ...r, chain: withForeign(r.chain, id, t0) } : r)))
    }
    if (now.properties === before.properties) continue
    const s1 = stageInfo(now, state)
    const s0 = stageInfo(before, prev)
    if (s1?.id === s0?.id) continue
    if (who === undefined) who = writerNow()
    // a replay from another tab / the server: the tab that made the move records it
    if (who === null || isEjectWriter(who)) continue
    // a moved step put back into its park stage by someone other than this chain: the chain halts (never starts it over)
    if (s1 && s1.id === s1.park && !(who.kind === 'order' && who.row === at.row)) {
      const t1 = Date.now()
      queueEvidence(at.row, () => patchOrderRecord(at.row, (r) => (active(r, at.run) && r.chain.moved?.[at.n] !== undefined ? { ...r, chain: withBack(r.chain, at.n, t1) } : r)))
    }
    if (s1?.kind === s0?.kind) continue
    const seen = approvalSawNext(id)
    if (s1?.kind === 'done') {
      const by: OrderDoneBy = doneEvidence(who.kind === 'unknown' ? null : who, Date.now(), seen)
      queueEvidence(at.row, () => patchOrderRecord(at.row, (r) => (active(r, at.run) ? { ...r, chain: withDone(r.chain, at.n, by) } : r)))
    } else if (seen) queueEvidence(at.row, () => patchOrderRecord(at.row, (r) => (active(r, at.run) ? { ...r, chain: withSeenNext(r.chain, at.n) } : r)))
  }
}

/* ------------------------------------------------------------------ the catch-up */

const kicks = new Map<ID, ReturnType<typeof setTimeout>>()

/** Run a request's chain soon (debounced — a burst of writes runs it once). */
export function kick(rowId: ID, delay = 200): void {
  const prev = kicks.get(rowId)
  if (prev) clearTimeout(prev)
  kicks.set(
    rowId,
    setTimeout(() => {
      kicks.delete(rowId)
      void runChain(rowId)
    }, delay),
  )
}

/** Every chain that runs on this device (at start, when the worker comes online). */
async function catchUp(): Promise<void> {
  for (const rowId of await recordRowIds()) {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    if (rec?.state === 'running') kick(rowId, 50)
  }
}

/** A task reached done here (tasks.ts setChainHook): its chain goes on — after the evidence is stored. */
function onDoneHook(taskId: ID): void {
  const at = indexNow().steps.get(taskId)
  if (at) kick(at.row, 0)
}

/* ------------------------------------------------------------------ running the chain */

/** A halt (sticky): the record's `halted`, the Status Angehalten (`#s`) — unless the Status said it already. */
async function halt(rowId: ID, chain: OrderChain, move: Extract<ChainMove, { kind: 'halt' }>, by = 'order'): Promise<void> {
  await patchOrderRecord(rowId, (r) => (r?.chain && r.chain.run === chain.run && (r.state === 'running' || r.state === 'halted') ? { ...r, state: 'halted', chain: withHalt(r.chain, { why: move.why, by, ...(move.step !== undefined ? { step: move.step } : {}) }, Date.now()) } : r))
  // the Status said it already (Angehalten, Fertig — the person ended the chain), or there is none to write
  if (move.why !== 'status' && move.why !== 'statusOption' && move.why !== 'trashed' && move.why !== 'finished') writeOrderStatus(rowId, 'halted', orderWriter(rowId, chain.run, 's'))
  tell(`halt|${rowId}|${chain.run}|${move.why}|${move.step ?? ''}`, rowId, t('features.coding.order.notify.halted', { id: codeOf(rowId), why: t(`features.coding.order.halt.${move.why}`, { n: move.step !== undefined ? stepNo(move.step) : '' }) }))
}

/** The end: every step done — the record 'done', Status → Fertig (`#s`). */
async function finish(rowId: ID, chain: OrderChain): Promise<void> {
  const out = await patchOrderRecord(rowId, (r) => (r?.state === 'running' && r.chain?.run === chain.run ? { ...r, state: 'done' } : r))
  if (out.rec?.state !== 'done') return
  writeOrderStatus(rowId, 'done', orderWriter(rowId, chain.run, 's'))
  tell(`done|${rowId}|${chain.run}`, rowId, t('features.coding.order.notify.done', { id: codeOf(rowId) }))
}

/** The Grundlage for `step` from the step whose result it takes (null: nothing to place). */
function basisFor(chain: OrderChain, step: OrderChainStep, move: Extract<ChainMove, { kind: 'advance' }>): ReturnType<typeof basisBlock>['block'] | null {
  if (!step.basisBlock || move.basis === 'none') return null
  const words = chainWords(t, currentLang())
  if (move.basis === 'skipped') return skippedBlock(step.basisBlock, words.skipped(move.from ?? step.n - 1))
  // step n of this chain — or, for a chain planned again from a done step, that step of the older chain
  const src = move.from !== null ? chain.steps.find((s) => s.n === move.from) : undefined
  const from = src ? { n: src.n, id: src.id, kind: src.kind, drop: [...(src.basisBlock ? [src.basisBlock] : []), ...(src.own ?? [])] } : chain.basis ? { n: chain.basis.n, id: chain.basis.id, kind: chain.basis.kind, drop: chain.basis.drop } : null
  if (!from) return null
  const page = ws().pages[from.id]
  if (!page) return skippedBlock(step.basisBlock, words.skipped(from.n))
  const title = page.title.trim() || t('common.untitled')
  const titleOf = (id: ID) => {
    const p = ws().pages[id]
    return p && !p.private ? p.title.trim() || t('common.untitled') : t('common.untitled')
  }
  return basisBlock({
    id: step.basisBlock,
    heading: words.basisHeading(from.n, from.kind, title),
    content: page.content?.content ?? [],
    drop: new Set(from.drop),
    keep: new Set(Object.keys(step.refs)),
    titleOf,
    cutNote: words.cutNote(from.n),
  }).block
}

/**
 * The Grundlage step `n` would get if it started now (the card shows it before ↵ — what goes along): step n-1's result
 * as a copy, the "skipped" line, or for the first step of a chain planned again the older step's result. null: none.
 */
export function basisPreview(chain: OrderChain, n: number): ReturnType<typeof basisBlock>['block'] | null {
  const steps = [...chain.steps].sort((a, b) => a.n - b.n)
  const i = steps.findIndex((s) => s.n === n)
  if (i < 0) return null
  const prev = i > 0 ? steps[i - 1]! : null
  const skipped = !!prev && (chain.skipped ?? []).includes(prev.n)
  return basisFor(chain, steps[i]!, { kind: 'advance', step: n, to: '', from: prev?.n ?? null, basis: !prev ? (chain.basis ? 'copy' : 'none') : skipped ? 'skipped' : 'copy', branch: null, again: false })
}

/**
 * Start step n (see the head of this file): written ahead in the record, then — only while the task's wait for Confirm
 * would not end and it is trusted — its Grundlage, a QA step's shared branch and its Stage under `#a<n>`.
 */
async function advance(rowId: ID, chain: OrderChain, move: Extract<ChainMove, { kind: 'advance' }>): Promise<boolean> {
  const step = chain.steps.find((s) => s.n === move.step)
  if (!step) return false
  // never past the Confirm wait: checked again right before anything is written (the engine's card asks otherwise) — a
  // version this device trusts has no wait left; a write by an agent after this check is caught inside the write
  const page0 = ws().pages[step.id]
  if (!page0 || !(await isTrusted(step.id))) return false
  const checked = ws().pages[step.id]
  // the Grundlage as it will be placed — with an outside write in its source, only exactly as a card showed it
  const block = basisFor(chain, step, move)
  const src = basisSource(chain, step.n)
  if (block && src && chain.foreign?.[src] !== undefined && (await textFp(basisText(block))) !== chain.basisSeen?.[step.n]) return false
  const ahead = await patchOrderRecord(rowId, (r) => (r?.state === 'running' && r.chain?.run === chain.run && !r.chain.halted ? { ...r, chain: withAdvance(r.chain, step.n, Date.now()) } : r))
  if (!ahead.ok || ahead.rec?.chain?.advanced?.[step.n] === undefined) return false
  let moved = false
  await keepTrust(
    [step.id],
    () => {
      const page = ws().pages[step.id]
      const db = page?.databaseId ? ws().databases[page.databaseId] : undefined
      // the same check, synchronously inside the write: changed since it was found trusted (an agent wrote meanwhile) —
      // nothing of the step is written past its wait for Confirm
      if (!page || !db || page.trashed || (page !== checked && writeEndsConfirm(page))) return
      // an eject took its creation back (another tab's store may not show the trash yet): never moved
      if (stepEjected(rowId, chain, step.n)) return
      if (block && step.basisBlock) ws().setContent(step.id, placeBasis(page.content ?? { type: 'doc', content: [] }, step.basisBlock, block), ORDER_ORIGIN)
      const props = codingProps(db)
      if (move.branch && props.branch) {
        const now = page.properties[props.branch]
        if (typeof now !== 'string' || now.trim() !== move.branch) ws().setRowProperty(step.id, props.branch, move.branch)
      }
      moveTask(step.id, move.to)
      moved = true
    },
    orderWriter(rowId, chain.run, `a${step.n}`),
  )
  // the move landed (still under the chain's lock): only a step without this mark is ever moved again — never one a
  // lagging store in another tab still shows parked
  if (moved) await patchOrderRecord(rowId, (r) => (r?.chain?.run === chain.run && r.chain.advanced?.[step.n] !== undefined ? { ...r, chain: withMoved(r.chain, step.n, Date.now()) } : r))
  return moved
}

/**
 * A VON HAND key on a card: a drift it passed is pinned again; a changed page / Grundlage only as the card rendered it
 * (`press.refs` / `press.basis` — fingerprints); the evidence and checkpoint reasons it passed are kept for that step (a
 * Confirm wait that comes up after them never brings them back).
 */
async function accept(rowId: ID, chain: OrderChain, world: ChainWorld, press: ChainPress): Promise<OrderChain> {
  const step = chain.steps.find((s) => s.n === press.step)
  if (!step) return chain
  let next = chain
  const f = world.tasks[step.id]
  if (press.passes.includes('drift') && f && (f.line !== step.line || f.approvals !== step.approvals)) next = withLine(next, step.n, f.line, f.approvals)
  // the pages exactly as the card rendered them are pinned (a page that moved on since asks again); an outside write
  // the card showed is no longer pending
  if (press.passes.includes('ref') && press.refs) {
    const shown = Object.fromEntries(Object.keys(step.refs).flatMap((id) => (press.refs![id] !== undefined ? [[id, press.refs![id]!]] : [])))
    next = withRefs(next, step.n, shown)
    next = withoutForeign(next, Object.keys(shown).filter((id) => world.refs[id]?.fp === shown[id]))
  }
  // the Grundlage as the card showed it (advance places it only while it still is exactly that)
  if (press.passes.includes('basis') && press.basis) next = withBasisSeen(next, step.n, press.basis)
  next = withPassed(next, step.n, press.passes)
  if (next === chain) return chain
  const out = await patchOrderRecord(rowId, (r) => (r?.state === 'running' && r.chain?.run === chain.run ? { ...r, chain: next } : r))
  return out.rec?.chain ?? chain
}

/** Done steps whose card waited once for evidence another tab may still be writing (row|step). */
const waited = new Set<string>()

/**
 * Run a request's chain once (see the head of this file). `press`: a VON HAND key on a card (it passes the reasons that
 * card showed). Resolves the move (null: no running chain here).
 */
export function runChain(rowId: ID, press?: ChainPress): Promise<ChainMove | null> {
  return withChainLock(rowId, async () => {
    await evidence.get(rowId)
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    if (!rec?.chain || rec.state !== 'running') {
      publish(rowId, rec?.chain && (rec.state === 'halted' || rec.state === 'done') ? (rec.state === 'done' ? { kind: 'done' } : { kind: 'wait', why: 'halted' }) : null)
      if (rec?.state !== 'running') unschedule(rowId)
      return null
    }
    let chain = rec.chain
    let world = await chainWorld(rowId, rec)
    if (press) {
      chain = await accept(rowId, chain, world, press)
      if (chain !== rec.chain) world = await chainWorld(rowId, { ...rec, chain })
    }
    let move = nextMove(world, press)
    // a done step without recorded evidence: another tab may be writing it — wait once (≤ 2 s) before the card shows
    if (move.kind === 'card' && move.all.includes('evidence') && !move.by && move.from !== null) {
      const key = `${rowId}|${chain.run}|${move.from}`
      if (!waited.has(key)) {
        waited.add(key)
        kick(rowId, 2000)
        return { kind: 'wait', why: 'queued', step: move.step }
      }
    }
    switch (move.kind) {
      case 'halt':
        await halt(rowId, chain, move)
        break
      case 'advance':
        if (!(await advance(rowId, chain, move))) {
          // the move did not happen (the Confirm wait came in between, the record moved): the next pass decides again
          const again = asRecord(await loadOrderRecord(rowId, { fresh: true }))
          move = again?.state === 'running' && again.chain ? nextMove(await chainWorld(rowId, again)) : move
        }
        break
      case 'done':
        await finish(rowId, chain)
        break
      case 'card':
        tell(`card|${rowId}|${chain.run}|${move.step}|${move.all.join(',')}`, rowId, t('features.coding.order.notify.next', { id: codeOf(rowId), n: stepNo(move.step) }))
        break
      case 'wait':
        if (move.why === 'startAt' && move.at !== undefined) schedule(rowId, move.at)
        // a step on its way from another tab, a store lagging behind: looked at again (it settles, or halts once it is late)
        else if (move.why === 'arriving') kick(rowId, 3000)
        else if (move.why === 'settling') kick(rowId, Math.min(Math.max(1000, (move.at ?? Date.now() + 5000) - Date.now() + 50), 5000))
        break
    }
    publish(rowId, move)
    return move
  })
}

/* ------------------------------------------------------------------ the countdown */

const timers = new Map<ID, ReturnType<typeof setTimeout>>()

/** Run the chain at `at` (its first step's start) in this tab. */
export function schedule(rowId: ID, at: number): void {
  const prev = timers.get(rowId)
  if (prev) clearTimeout(prev)
  timers.set(
    rowId,
    setTimeout(() => {
      timers.delete(rowId)
      void runChain(rowId)
    }, Math.max(0, at - Date.now()) + 20),
  )
}

/** Cancel this tab's countdown of a request (its chain was taken back). */
export function unschedule(rowId: ID): void {
  const prev = timers.get(rowId)
  if (prev) clearTimeout(prev)
  timers.delete(rowId)
}

/** The first step of a chain not started yet. */
const firstWaiting = (chain: OrderChain | undefined): boolean => {
  const first = chain ? [...chain.steps].sort((a, b) => a.n - b.n)[0] : undefined
  return !!first && chain!.advanced?.[first.n] === undefined
}

/** A record as this tab now holds it: its countdown scheduled when its first step waits for `startAt`. */
function follow(rowId: ID, rec: OrderRecord | null): void {
  if (rec?.state === 'running' && rec.chain && !rec.chain.halted && firstWaiting(rec.chain)) schedule(rowId, rec.chain.startAt)
  else if (!rec || rec.state !== 'running') unschedule(rowId)
}

/** ↵ jetzt: step 01 starts now (the count is cut short) — only while it has not started. */
export async function startNow(rowId: ID): Promise<ChainMove | null> {
  const now = Date.now()
  await patchOrderRecord(rowId, (r) => (r?.state === 'running' && r.chain && firstWaiting(r.chain) && r.chain.startAt > now ? { ...r, chain: { ...r.chain, startAt: now } } : r))
  unschedule(rowId)
  return runChain(rowId)
}

/* ------------------------------------------------------------------ start */

let started = false

/** Read every record of this scope; follow the running ones; finish (or mark interrupted) what a closed tab left 'creating'. */
async function readAll(): Promise<void> {
  const rows = await recordRowIds()
  const creating: ID[] = []
  const running: ID[] = []
  for (const rowId of rows) {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    follow(rowId, rec)
    if (rec?.state === 'creating') creating.push(rowId)
    if (rec?.state === 'running') running.push(rowId)
  }
  loaded = true
  index = null
  if (creating.length) void import('./confirm').then((m) => m.finishCreates(creating)).catch(() => undefined)
  // the catch-up at start: what happened while no tab ran
  for (const rowId of running) kick(rowId, 50)
}

/** The guard, the done evidence, the countdowns, the catch-up, the records of this scope (once, from startOrders). */
export function startChains(): void {
  if (started || typeof window === 'undefined') return
  started = true
  setParkedGuard(parkedGuard)
  setChainHook(onDoneHook)
  useWorkspace.subscribe(onStore)
  void readAll()
  // another workspace in this tab: its records
  useWorkspace.subscribe((s, prev) => {
    if (s.epoch === prev.epoch && s.ready === prev.ready) return
    if (!s.ready) return
    loaded = false
    index = null
    for (const id of [...timers.keys()]) unschedule(id)
    useChainMoves.setState({ moves: {} })
    void readAll()
  })
  // another member signed in on this browser (a team): their own records (records.ts orderScope)
  useCloud.subscribe((c, prev) => {
    if (c.user?.id === prev.user?.id) return
    loaded = false
    index = null
    for (const id of [...timers.keys()]) unschedule(id)
    useChainMoves.setState({ moves: {} })
    void readAll()
  })
  // the worker came online: the chains go on (what finished meanwhile, a step that waited for it)
  useCoding.subscribe((s, prev) => {
    if (workerOnline(s) && !workerOnline(prev)) void catchUp()
  })
  // a record another tab wrote: read it (held or not — the guard needs every one), follow its countdown
  try {
    const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ORDERS_CHANNEL)
    ch?.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as { scope?: unknown; row?: unknown } | null
      if (!m || typeof m.row !== 'string' || m.scope !== orderScope()) return
      const rowId = m.row
      void loadOrderRecord(rowId, { fresh: true }).then((r) => {
        const rec = asRecord(r)
        follow(rowId, rec)
        if (rec?.state === 'running') kick(rowId)
        else if (rec) publish(rowId, rec.state === 'done' && rec.chain ? { kind: 'done' } : rec.state === 'halted' ? { kind: 'wait', why: 'halted' } : null)
      })
    })
  } catch {
    /* no channel: this tab's own records only */
  }
}

/** This tab wrote a record (confirm.ts, the person's keys): follow its countdown, run it soon. */
export const followRecord = (rowId: ID, rec: OrderRecord | null): void => {
  follow(rowId, rec)
  if (rec?.state === 'running') kick(rowId)
}

/** Halt a chain here (the engine's halt — the person's keys in chainKeys.ts write their own). */
export const haltNow = halt
