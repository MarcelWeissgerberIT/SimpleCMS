/**
 * Coding tasks that wait on the person — what the Preflight lamps Gate · Coding question · Task failed count, read
 * without walking the page map: the rows come from the shared row index (store/rowIndex.ts), the run states from
 * `useCodingLocal` (loaded for all tasks with ONE IndexedDB read, loadTasks), the phase from the task panel's own
 * `taskPhase`.
 *
 * A task counts when its phase is gate · intake · question · failed · stopped, or when it waits for "Confirm on this
 * device". Confirm counts only on the worker's device: coding is switched on here, the task needs a trusted version
 * (trust.ts needsConfirm: team, or local and an agent wrote it) AND it waits at a gate or its next step lands on the
 * worker. Everywhere else `confirm` is null.
 *
 * Trust is a SHA-256 over the task, its pipeline and the pages it refers to (trust.ts versionOf) — never computed while
 * counting. It is kept per page object (a WeakMap) while the database and every referenced page are the same objects;
 * a miss is checked again 2 s after the last relevant change (typing in a task page re-reads nothing until then), a
 * newly trusted version (trustRev) at once. Until a check answers, the last answer for that task stands.
 */
import { onRowsChanged, rowIdsOf, type RowsChange } from '../../store/rowIndex'
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page } from '../../store/types'
import { codingProps, pipelineDbIds, readPipeline, stageOfRow } from './schema'
import { loadTasks, taskLocal, useCodingLocal } from './local'
import { needsConfirm, trustState } from './trust'
import { refIdsOf } from './refs'
import { landsOn, taskPhase, type TaskPhase } from './terminal'
import { isRunning } from './service'
import { useCoding } from './state'

export interface WaitingTask {
  id: ID
  phase: TaskPhase
  stageId: ID | null
  /** TaskLocal.at — when this device last changed the task's run state (0: never) */
  at: number
  /** waits for "Confirm on this device" (true) / trusted (false) / not checked yet or not relevant here (null) */
  confirm: boolean | null
  /** the first 8 hex digits of the version checked (trusted or not); null when not checked */
  version8: string | null
  /** its next step would run on the worker (an automatic stage, or "Run now") */
  landsOnWorker: boolean
}

const WAITS: ReadonlySet<TaskPhase> = new Set<TaskPhase>(['gate', 'intake', 'question', 'failed', 'stopped'])
/** a content / reference change is checked this long after the last one */
const SETTLE_MS = 2000

interface Memo {
  db: Database | undefined
  refs: Page[]
  rev: number
  ok: boolean
  version: string
}

const memo = new WeakMap<Page, Memo>()
/** the newest answer per task — stands while a re-check waits */
const lastKnown = new Map<ID, { ok: boolean; version: string }>()
/** the pages the counted tasks refer to (a change of one re-checks) */
let refWatch = new Set<ID>()

/* ---------------- pipeline databases (cached: re-read on a schema, structure or scope change) */

let pipes: { databases: Record<ID, Database>; ids: ID[] } | null = null

function pipelineIdsNow(): ID[] {
  const databases = useWorkspace.getState().databases
  // the cache is cleared by the change events — only while they are listened to
  if (pipes && pipes.databases === databases && listeners.size) return pipes.ids
  const ids = pipelineDbIds()
  pipes = { databases, ids }
  return ids
}

/* ---------------- the read */

function memoFor(page: Page, s: { pages: Record<ID, Page>; databases: Record<ID, Database> }, rev: number): Memo | null {
  const m = memo.get(page)
  if (!m || m.rev !== rev || m.db !== s.databases[page.databaseId ?? '']) return null
  const ids = refIdsOf(page)
  if (ids.length !== m.refs.length) return null
  for (let i = 0; i < ids.length; i++) if (s.pages[ids[i]] !== m.refs[i]) return null
  return m
}

/** Does this task's Confirm count on this device right now? */
const confirmMatters = (row: Page, phase: TaskPhase, lands: boolean) => needsConfirm(row) && (phase === 'gate' || (lands && phase !== 'done' && phase !== 'running'))

let misses = false

function compute(): WaitingTask[] {
  const s = useWorkspace.getState()
  const enabled = useCoding.getState().enabled
  const rev = useCodingLocal.getState().trustRev
  const out: WaitingTask[] = []
  const watch = new Set<ID>()
  const rows: ID[] = []
  for (const dbId of pipelineIdsNow()) {
    const db = s.databases[dbId]
    if (!db) continue
    const props = codingProps(db)
    const pipeline = readPipeline(db)
    for (const id of rowIdsOf(dbId)) {
      const row = s.pages[id]
      if (!row) continue
      rows.push(id)
      const stage = stageOfRow(pipeline, props, row)
      const local = taskLocal(id)
      const phase = taskPhase(stage, local, isRunning(id))
      const lands = landsOn(pipeline, stage, !!local.runNow) === 'worker'
      let confirm: boolean | null = null
      let version8: string | null = null
      if (enabled && confirmMatters(row, phase, lands)) {
        for (const r of refIdsOf(row)) watch.add(r)
        const m = memoFor(row, s, rev)
        if (!m) misses = true
        const known = m ?? lastKnown.get(id)
        if (known) {
          confirm = !known.ok
          version8 = known.version.slice(0, 8)
        }
      }
      if (!WAITS.has(phase) && confirm !== true) continue
      out.push({ id, phase, stageId: stage?.id ?? null, at: local.at ?? 0, confirm, version8, landsOnWorker: lands })
    }
  }
  refWatch = watch
  // run states not loaded yet: one read for all (the useCodingLocal change tells the listeners)
  void loadTasks(rows)
  return out
}

let cache: WaitingTask[] | null = null

/** The tasks that wait on the person (sync, O(pipeline rows); cached between changes while someone listens). */
export function waitingTasks(): WaitingTask[] {
  if (cache && listeners.size) return cache
  misses = false
  const out = compute()
  if (listeners.size) cache = out
  // a task whose trust is not known (or no longer valid) is checked soon: at once when nothing is known about it yet
  if (misses) schedule(0)
  return out
}

/* ---------------- trust checks (outside the read) */

let soon: ReturnType<typeof setTimeout> | undefined
let settle: ReturnType<typeof setTimeout> | undefined
let running = false
let again = false

/** Check the tasks whose trust is unknown: at once (`ms` 0), or `ms` after the LAST call (a debounce). */
function schedule(ms: number): void {
  if (!listeners.size) return
  if (ms <= 0) {
    if (soon === undefined) soon = setTimeout(() => {
      soon = undefined
      void runChecks()
    }, 0)
    return
  }
  if (settle !== undefined) clearTimeout(settle)
  settle = setTimeout(() => {
    settle = undefined
    void runChecks()
  }, ms)
}

/** The tasks whose Confirm counts here and whose kept answer is no longer valid. */
function unchecked(): ID[] {
  const s = useWorkspace.getState()
  const rev = useCodingLocal.getState().trustRev
  const todo: ID[] = []
  for (const dbId of pipelineIdsNow()) {
    const db = s.databases[dbId]
    if (!db) continue
    const props = codingProps(db)
    const pipeline = readPipeline(db)
    for (const id of rowIdsOf(dbId)) {
      const row = s.pages[id]
      if (!row) continue
      const local = taskLocal(id)
      const stage = stageOfRow(pipeline, props, row)
      const lands = landsOn(pipeline, stage, !!local.runNow) === 'worker'
      if (confirmMatters(row, taskPhase(stage, local, isRunning(id)), lands) && !memoFor(row, s, rev)) todo.push(id)
    }
  }
  return todo
}

async function runChecks(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    if (!useCoding.getState().enabled) return
    let changed = false
    for (const id of unchecked()) {
      // the trust revision BEFORE the look: a version trusted meanwhile makes this answer stale (checked again)
      const rev = useCodingLocal.getState().trustRev
      const st = await trustState(id).catch(() => null)
      if (!st) continue
      memo.set(st.page, { db: st.db, refs: st.refs, rev, ok: st.ok, version: st.version })
      const before = lastKnown.get(id)
      if (!before || before.ok !== st.ok || before.version !== st.version) changed = true
      lastKnown.set(id, { ok: st.ok, version: st.version })
    }
    if (changed) fire()
  } finally {
    running = false
    if (again) {
      again = false
      schedule(0)
    }
  }
}

/* ---------------- change events */

const listeners = new Set<() => void>()
let unsubs: Array<() => void> = []

function fire(): void {
  cache = null
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (e) {
      console.warn('[coding] waiting listener failed', e)
    }
  }
}

function onRows(c: RowsChange): void {
  if (c.reset) {
    pipes = null
    lastKnown.clear()
    fire()
    return
  }
  if (c.structure || c.schema.size) pipes = null
  let rows = false
  let content = false
  for (const id of pipelineIdsNow()) {
    if (c.dbs.has(id) || c.schema.has(id)) rows = true
    if (c.contentDbs.has(id)) content = true
  }
  let refs = false
  if (refWatch.size) for (const id of c.changed) if (refWatch.has(id)) refs = true
  if (rows) fire()
  if (rows || content || refs) schedule(SETTLE_MS)
}

function watch(): void {
  unsubs = [
    onRowsChanged(onRows),
    useCodingLocal.subscribe((s, p) => {
      if (s.trustRev !== p.trustRev) {
        fire()
        schedule(0)
      } else if (s.tasks !== p.tasks) fire()
    }),
    useCoding.subscribe((s, p) => {
      if (s.enabled !== p.enabled) {
        fire()
        schedule(0)
      } else if (s.busy !== p.busy) fire()
    }),
  ]
}

/** Listen for changes of the waiting tasks (rows, stages, run states, the worker's busy list, trust answers). */
export function onWaitingChanged(fn: () => void): () => void {
  listeners.add(fn)
  if (listeners.size === 1) watch()
  return () => {
    listeners.delete(fn)
    if (listeners.size) return
    for (const off of unsubs) off()
    unsubs = []
    cache = null
    pipes = null
    if (soon !== undefined) clearTimeout(soon)
    if (settle !== undefined) clearTimeout(settle)
    soon = settle = undefined
  }
}
