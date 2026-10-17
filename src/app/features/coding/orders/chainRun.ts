/**
 * Work orders — the chain engine's app side (spec §2.10), the part B6 needs: the world `nextMove` (coding/chain.ts)
 * decides on, the parked-start guard, step 01's start after the 10 s count, and the halts. B7 adds the rest of the sink
 * (the moves of later steps with their Grundlage, the done evidence, the catch-up pass, the cards).
 *
 *  - `chainWorld(row, record)`: the facts of every step of this device's record (the store, this device's run state and
 *    trust) — never the Prüfauftrag relation or the Schritt number on the rows.
 *  - The parked-start guard (tasks.ts setParkedGuard): a step of a chain on this device that the chain has not started
 *    (not in `advanced`, not skipped) is never handed to the worker — whatever stage it stands in, "Run now" or not. Read
 *    from this tab's copy of the records (all of this scope's are read at start, the channel keeps them current); until
 *    they are read, every task that carries a work order's relation is held.
 *  - `runChain(row)`: under the Web Lock `one-order-chain:<scope>:<row>` — reads the record again, builds the world, asks
 *    `nextMove` and acts on: a halt (sticky: the record's `halted`, Status → Angehalten by the order writer `#s`), the
 *    start of the chain's FIRST step once `startAt` is reached (write-ahead `advanced`, then Stage → its start stage under
 *    `keepTrust` as `order:<row>:<run>#a<n>`), a countdown still running (scheduled). Later steps, cards and the end are
 *    B7's: here they wait.
 *  - The countdown: every running record whose first step has not started is scheduled at its `startAt` in every tab of
 *    this device that holds it (the lock and the write-ahead make a second start a no-op); `startNow(row)` (↵ jetzt) moves
 *    `startAt` to now. At start (startChains): all records of this scope are read; a record left 'creating' by a closed
 *    tab is finished or marked interrupted (confirm.ts finishCreates).
 */
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import type { ID, Page } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import { agentIdOf } from '../../agents/attribution'
import { useCoding } from '../state'
import { codingProps, kindOfDb, optionName, readPipeline, stageOfRow } from '../schema'
import { approvalsOf, moveTask, setParkedGuard } from '../tasks'
import { loadTask, scope, taskLocal } from '../local'
import { isTrusted, keepTrust, writeEndsConfirm } from '../trust'
import { pipelineLine, startStageOf } from '../stages'
import { nextMove, parksNewTasks, withAdvance, withHalt, type ChainMove, type ChainTaskFacts, type ChainWorld } from '../chain'
import { orderConfigUsable, readOrderConfig } from './config'
import { orderStatusKey, writeOrderStatus } from './db'
import { loadOrderRecord, ORDERS_CHANNEL, patchOrderRecord, recordRowIds, useOrderRecords } from './records'
import type { OrderChain, OrderRecord } from './types'

const ws = () => useWorkspace.getState()
const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/* ------------------------------------------------------------------ the world */

/** Origins of a page's text that are not the person's own typing here (a ref changed by one of them asks — B7 refines). */
const FOREIGN_ORIGINS = new Set(['ai', 'sync', 'file', 'import', 'share', 'mail', 'clip', 'coding', 'mcp', 'synced', 'template'])

const missing: ChainTaskFacts = { exists: false, trashed: false, stage: null, stageKind: null, parkStage: null, startStage: null, startsAtOnce: false, state: 'idle', line: '', approvals: 'all', endsConfirm: false, trusted: false, repo: null, branch: null, spentUsd: 0 }

/** What the engine knows about one task of the chain now. */
export async function taskFacts(id: ID): Promise<ChainTaskFacts> {
  const s = ws()
  const page = s.pages[id]
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page || !db || !kindOfDb(db.id)) return missing
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
    endsConfirm: writeEndsConfirm(page),
    trusted: trashed ? false : await isTrusted(id),
    changedBy: agentIdOf(page.updatedBy) ? page.updatedBy : null,
    repo,
    branch: typeof branchRaw === 'string' && branchRaw.trim() ? branchRaw.trim() : null,
    spentUsd: typeof local.spentUsd === 'number' && local.spentUsd > 0 ? local.spentUsd : 0,
  }
}

/** The facts of a request's chain on this device (`record` = this device's record of it). */
export async function chainWorld(rowId: ID, record: OrderRecord, now = Date.now()): Promise<ChainWorld> {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  const tasks: ChainWorld['tasks'] = {}
  const refs: ChainWorld['refs'] = {}
  for (const step of record.chain?.steps ?? []) {
    tasks[step.id] = await taskFacts(step.id)
    for (const id of Object.keys(step.refs)) {
      const p = s.pages[id]
      if (p) refs[id] = { rev: p.contentRev, foreign: !!agentIdOf(p.updatedBy) || FOREIGN_ORIGINS.has(p.contentOrigin ?? '') }
    }
  }
  return {
    now,
    record,
    request: { live: !!row && !row.trashed && !isEffectivelyTrashed(s.pages, rowId), status: orderStatusKey(rowId), usable: orderConfigUsable(readOrderConfig(db)) },
    tasks,
    refs,
  }
}

/* ------------------------------------------------------------------ the parked-start guard */

/** Steps of a chain the chain has not started (they wait in their park stage). */
export function parkedOf(chain: OrderChain | undefined): ID[] {
  if (!chain) return []
  const skipped = new Set(chain.skipped ?? [])
  return chain.steps.filter((s) => chain.advanced?.[s.n] === undefined && !skipped.has(s.n)).map((s) => s.id)
}

let loaded = false
let cache: { of: unknown; scope: string; ids: Set<ID> } | null = null

/** The parked steps of every record of this scope this tab holds. */
function parkedNow(): Set<ID> {
  const recs = useOrderRecords.getState().recs
  const sc = scope()
  if (cache?.of === recs && cache.scope === sc) return cache.ids
  const ids = new Set<ID>()
  const prefix = `${sc}|`
  for (const [key, rec] of Object.entries(recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable') continue
    for (const id of parkedOf(rec.chain)) ids.add(id)
    // an older chain this one replaced: its steps went to the trash at the start — held all the same
    for (const id of parkedOf(rec.chain?.replaced?.chain)) ids.add(id)
  }
  cache = { of: recs, scope: sc, ids }
  return ids
}

/** Does this task carry a work order's relation (before the records are read: held, never handed out on a doubt)? */
function carriesOrder(page: Page | undefined): boolean {
  const db = page?.databaseId ? ws().databases[page.databaseId] : undefined
  if (!page || !db) return false
  const prop = codingProps(db).order
  const v = prop ? page.properties[prop] : undefined
  return Array.isArray(v) && v.length > 0
}

function parkedGuard(taskId: ID): boolean {
  if (!loaded) return carriesOrder(ws().pages[taskId])
  return parkedNow().has(taskId)
}

/* ------------------------------------------------------------------ running the chain */

const chainLock = (rowId: ID) => `one-order-chain:${scope()}:${rowId}`

async function withChainLock<T>(rowId: ID, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return (await locks.request(chainLock(rowId), fn)) as T
}

/** The order writer of a chain (`order:<row>:<run>[#<change>]`). */
export const orderWriter = (rowId: ID, run: string, change?: string): Writer => ({ kind: 'order', row: rowId, run, ...(change ? { change } : {}) })

/** A halt (sticky): the record's `halted`, the Status Angehalten (`#s`) — unless the Status said it already. */
async function halt(rowId: ID, chain: OrderChain, move: Extract<ChainMove, { kind: 'halt' }>): Promise<void> {
  await patchOrderRecord(rowId, (r) => (r?.chain && r.chain.run === chain.run && (r.state === 'running' || r.state === 'halted') ? { ...r, state: 'halted', chain: withHalt(r.chain, { why: move.why, by: 'order', ...(move.step !== undefined ? { step: move.step } : {}) }, Date.now()) } : r))
  if (move.why !== 'status' && move.why !== 'statusOption' && move.why !== 'trashed') writeOrderStatus(rowId, 'halted', orderWriter(rowId, chain.run, 's'))
}

/** The start of the chain's first step: written ahead in the record, then its Stage → its start stage (`#a<n>`). */
async function startFirst(rowId: ID, chain: OrderChain, move: Extract<ChainMove, { kind: 'advance' }>): Promise<boolean> {
  const step = chain.steps.find((s) => s.n === move.step)
  if (!step) return false
  const ahead = await patchOrderRecord(rowId, (r) => (r?.state === 'running' && r.chain?.run === chain.run ? { ...r, chain: withAdvance(r.chain, step.n, Date.now()) } : r))
  if (!ahead.ok || ahead.rec?.chain?.advanced?.[step.n] === undefined) return false
  await keepTrust([step.id], () => moveTask(step.id, move.to), orderWriter(rowId, chain.run, `a${step.n}`))
  return true
}

/**
 * Run a request's chain once (see the head of this file): the move `nextMove` names, as far as B6 carries it out.
 * Resolves the move (null: no running chain here).
 */
export function runChain(rowId: ID): Promise<ChainMove | null> {
  return withChainLock(rowId, async () => {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    if (!rec?.chain || rec.state !== 'running') return null
    const world = await chainWorld(rowId, rec)
    const move = nextMove(world)
    if (move.kind === 'halt') await halt(rowId, rec.chain, move)
    else if (move.kind === 'advance' && move.from === null) await startFirst(rowId, rec.chain, move)
    else if (move.kind === 'wait' && move.why === 'startAt' && move.at !== undefined) schedule(rowId, move.at)
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
  for (const rowId of rows) {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    follow(rowId, rec)
    if (rec?.state === 'creating') creating.push(rowId)
  }
  loaded = true
  cache = null
  if (creating.length) void import('./confirm').then((m) => m.finishCreates(creating)).catch(() => undefined)
}

/** The guard, the countdowns, the records of this scope (once, from startOrders). */
export function startChains(): void {
  if (started || typeof window === 'undefined') return
  started = true
  setParkedGuard(parkedGuard)
  void readAll()
  // another workspace in this tab: its records
  useWorkspace.subscribe((s, prev) => {
    if (s.epoch === prev.epoch && s.ready === prev.ready) return
    if (!s.ready) return
    loaded = false
    cache = null
    for (const id of [...timers.keys()]) unschedule(id)
    void readAll()
  })
  // a record another tab wrote: read it (held or not — the guard needs every one), follow its countdown
  try {
    const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ORDERS_CHANNEL)
    ch?.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as { scope?: unknown; row?: unknown } | null
      if (!m || typeof m.row !== 'string' || m.scope !== scope()) return
      const rowId = m.row
      void loadOrderRecord(rowId, { fresh: true }).then((r) => follow(rowId, asRecord(r)))
    })
  } catch {
    /* no channel: this tab's own records only */
  }
}

/** This tab wrote a record (confirm.ts): follow its countdown. */
export const followRecord = (rowId: ID, rec: OrderRecord | null): void => follow(rowId, rec)
