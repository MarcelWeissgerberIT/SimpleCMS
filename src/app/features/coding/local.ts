/**
 * Coding pipeline — what this device keeps per task (IndexedDB "one-coding" / "kv"; never synced, wiped with
 * a team workspace's copy — cloud/device.ts):
 *   <scope>|log|<taskId>    LogLine[] (the last LOG_MAX lines)
 *   <scope>|task|<taskId>   TaskLocal — run state, the question, answers, rework note, plan, summary, the
 *                           newest diff / git state and test output, "Run now"
 *   <scope>|trust           hashes of task versions written or confirmed here (team workspaces)
 *   <scope>|mcpTouched|<taskId>  true: an MCP write moved the task's version here (local workspaces; trust.ts
 *                           needsConfirm — the task waits for Confirm like an agent's; Confirm removes it)
 *   <scope>|fileTouched|<taskId> true: the folder / GitHub pick-up wrote or made the task here (local workspaces; the
 *                           same wait; Confirm or the person's own edit in the editor removes it)
 * <scope> = "local:local" / "cloud:<workspace id>". Without IndexedDB everything stays in memory.
 * A task state written here is announced on BroadcastChannel "one-coding-tasks"; a tab holding that task reads it
 * again (the newer by `at` wins; a state held only as loadTasks' snapshot always loses to what is stored).
 */
import { create } from 'zustand'
import { createStore, del, get, getMany, keys, set as idbSet, update, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'
import type { ID } from '../../store/types'
import { LOG_MAX, type GitInfo, type LogLine, type TestResult } from './protocol'

/** What this device knows about a task's run (the row holds what everyone sees). */
export interface TaskLocal {
  /** idle · running (the worker has it) · question (waits for an answer) · failed · stopped */
  state: 'idle' | 'running' | 'question' | 'failed' | 'stopped'
  stageId?: ID | null
  /** the worker's run of that stage (store/writer.ts coding:<task>:<run>): one id per stage execution, minted at the claim */
  run?: string | null
  error?: string | null
  question?: string | null
  /** answers given in the current stage */
  answers?: Array<{ q: string; a: string; stageId: ID }>
  /** the newest rework note for a stage */
  rework?: { stageId: ID; text: string } | null
  /** run once even when the stage is not automatic (Run now / Retry / an answer) */
  runNow?: boolean
  plan?: string | null
  /** a hash of the plan's section on the task page right after the worker wrote it (an edit of the section since: it differs) */
  planSig?: string | null
  summary?: string | null
  test?: TestResult | null
  git?: GitInfo | null
  url?: string | null
  /** failed test runs since the last pass (the second one goes to the review gate) */
  testFailures?: number
  /** which gates this task stops at on this device (absent = this device's default, tasks.ts approvalsOf) */
  approvals?: 'all' | 'review' | 'none'
  /**
   * the model every Claude Code stage of this task runs with on this device (protocol.ts MODEL_NAME) — absent: as the
   * pipeline says (each stage's own, else the worker's default). Never synced, so no one else can set it.
   */
  model?: string
  /** the follow-up tasks this device created from this one (Business analysis → Coding / QA, QA → Coding) */
  spawned?: Partial<Record<'coding' | 'qa', ID>>
  /** the newest review document (a doc stage with output 'review') — Post review / a git 'comment' stage sends it */
  review?: { text: string; at: number } | null
  /** output 'pages': stage id → the documentation page this device made (a re-run updates its pages) */
  docPages?: Record<ID, ID>
  /** output 'stories': the coding project this device made from the task's stories */
  storiesDb?: ID | null
  /** the worker's finishIds this device applied (the last 20): a retried outcome is answered, not applied twice */
  finished?: string[]
  /** worker 1.11.0: the stage stopped at its step limit (`turns` of `max`) — Continue runs it on from the worktree */
  stepLimit?: { stageId: ID; turns: number; max: number } | null
  /** Continue was pressed: the next run of that stage goes on from the worktree (TaskPayload.resume) */
  resume?: boolean
  /**
   * the Claude Code cost this device's worker reported for the task, summed — finishStage adds each report beside the
   * Cost field (which other writers can change; wired with the chain budget, orders slice B7): a work order's chain
   * budget counts only this, never the Cost field. Never synced.
   */
  spentUsd?: number
  /** worker 1.11.0: the last Claude Code stage's permission requests (the panel's summary line) */
  permissions?: { stageId: ID; asked: number; allowed: number; refused: number } | null
  at?: number
}

export const scope = (): string => {
  const ref = activeWorkspace()
  return `${ref.kind}:${ref.id}`
}

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-coding', 'kv'))
}

interface LocalState {
  /** `<scope>|<taskId>` → state */
  tasks: Record<string, TaskLocal>
  /** `<scope>|<taskId>` → log lines */
  logs: Record<string, LogLine[]>
  /** bumped whenever this device trusts another task version (Confirm, an action, a carried trust): trust readouts re-check */
  trustRev: number
}

export const useCodingLocal = create<LocalState>()(() => ({ tasks: {}, logs: {}, trustRev: 0 }))

const memKey = (taskId: ID, s = scope()) => `${s}|${taskId}`
const loaded = new Set<string>()

async function read<T>(key: string): Promise<T | undefined> {
  const store = kv()
  if (!store) return undefined
  try {
    return await get<T>(key, store)
  } catch {
    noDb = true
    return undefined
  }
}

async function write(key: string, value: unknown): Promise<void> {
  const store = kv()
  if (!store) return
  try {
    await idbSet(key, value, store)
  } catch {
    noDb = true
  }
}

/**
 * Task states this tab holds only as loadTasks' snapshot (never patched here since): a later read lets the stored value
 * win — another tab (the one connected to the worker) may have written a newer state meanwhile.
 */
const snapshot = new Set<string>()

/**
 * The state to hold after a read: the stored one when memory is only a snapshot of an older read, else the newer of
 * the two by `at` (memory patched here after the stored one was written wins, as it always did).
 */
export function newerTask(stored: unknown, mem: TaskLocal | undefined, snapshotOnly: boolean): TaskLocal {
  const st = stored && typeof stored === 'object' ? (stored as TaskLocal) : null
  if (!st) return mem ?? { state: 'idle' }
  if (!mem || snapshotOnly) return st
  return (st.at ?? 0) > (mem.at ?? 0) ? st : { ...st, ...mem }
}

/** loads under way: a second caller waits for the same read */
const loading = new Map<string, Promise<void>>()

/** Load a task's state and log into memory (once per task and workspace; a load under way is waited for). */
export function loadTask(taskId: ID): Promise<void> {
  const key = memKey(taskId)
  if (loaded.has(key)) return loading.get(key) ?? Promise.resolve()
  loaded.add(key)
  const p = readTask(taskId).finally(() => loading.delete(key))
  loading.set(key, p)
  return p
}

async function readTask(taskId: ID): Promise<void> {
  const s = scope()
  const key = memKey(taskId, s)
  // a tab that holds task states hears the other tabs' writes
  taskChannel()
  const [task, log] = await Promise.all([read<TaskLocal>(`${s}|task|${taskId}`), read<LogLine[]>(`${s}|log|${taskId}`)])
  useCodingLocal.setState((st) => {
    const next = newerTask(task, st.tasks[key], snapshot.has(key))
    snapshot.delete(key)
    return {
      tasks: { ...st.tasks, [key]: next },
      logs: { ...st.logs, [key]: [...(Array.isArray(log) ? log : []), ...(st.logs[key] ?? [])].slice(-LOG_MAX) },
    }
  })
}

/** Task states loaded by loadTasks (their logs are not: loadTask still loads those). */
const statesLoaded = new Set<string>()

/**
 * Load the run state of many tasks at once — ONE IndexedDB read (getMany) for every task not loaded yet. For readers
 * that list tasks (the Preflight lamps, coding/waiting.ts); the logs stay unloaded until a task is opened (loadTask).
 */
export async function loadTasks(ids: Iterable<ID>): Promise<void> {
  const s = scope()
  taskChannel()
  const todo: ID[] = []
  for (const id of ids) {
    const key = memKey(id, s)
    if (loaded.has(key) || statesLoaded.has(key)) continue
    statesLoaded.add(key)
    todo.push(id)
  }
  const store = kv()
  if (!todo.length || !store) return
  let values: unknown[] = []
  try {
    values = await getMany(todo.map((id) => `${s}|task|${id}`), store)
  } catch {
    noDb = true
    return
  }
  const found: Record<string, TaskLocal> = {}
  todo.forEach((id, i) => {
    const v = values[i]
    if (v && typeof v === 'object') found[memKey(id, s)] = v as TaskLocal
  })
  if (!Object.keys(found).length) return
  // what this tab holds already wins (as in loadTask); what it takes from here is a snapshot (a later read wins)
  useCodingLocal.setState((st) => {
    const tasks = { ...st.tasks }
    for (const [key, task] of Object.entries(found)) {
      if (!st.tasks[key]) snapshot.add(key)
      tasks[key] = { ...task, ...st.tasks[key] }
    }
    return { tasks }
  })
}

/* ------------------------------------------------------------------ other tabs (BroadcastChannel "one-coding-tasks") */

let taskChan: BroadcastChannel | null | undefined
function taskChannel(): BroadcastChannel | null {
  if (taskChan !== undefined) return taskChan
  try {
    taskChan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-coding-tasks') : null
  } catch {
    taskChan = null
  }
  if (taskChan) taskChan.onmessage = (e: MessageEvent) => void onTaskWritten(e.data)
  return taskChan
}

/** Another tab wrote a task's state: a task held here is read again (the newer by `at` wins; a snapshot always loses). */
async function onTaskWritten(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') return
  const { scope: s, taskId } = msg as { scope?: unknown; taskId?: unknown }
  if (typeof s !== 'string' || typeof taskId !== 'string' || s !== scope()) return
  const key = memKey(taskId, s)
  if (!useCodingLocal.getState().tasks[key]) return
  const stored = await read<TaskLocal>(`${s}|task|${taskId}`)
  useCodingLocal.setState((st) => {
    if (!st.tasks[key]) return st
    const next = newerTask(stored, st.tasks[key], snapshot.has(key))
    snapshot.delete(key)
    return next === st.tasks[key] ? st : { tasks: { ...st.tasks, [key]: next } }
  })
}

export function taskLocal(taskId: ID): TaskLocal {
  return useCodingLocal.getState().tasks[memKey(taskId)] ?? { state: 'idle' }
}

export function useTaskLocal(taskId: ID): TaskLocal {
  const key = memKey(taskId)
  return useCodingLocal((s) => s.tasks[key]) ?? IDLE
}

const IDLE: TaskLocal = { state: 'idle' }
const NO_LINES: LogLine[] = []

export function useTaskLog(taskId: ID): LogLine[] {
  const key = memKey(taskId)
  return useCodingLocal((s) => s.logs[key]) ?? NO_LINES
}

type ApprovalsLevel = NonNullable<TaskLocal['approvals']>
const ownLevel = (t: unknown): ApprovalsLevel | null => {
  const a = t && typeof t === 'object' ? (t as TaskLocal).approvals : undefined
  return a === 'all' || a === 'review' || a === 'none' ? a : null
}

/**
 * Approvals for tasks that hold none of their own on this device (tasks.ts freezeApprovals / the join watch): each task's
 * state is loaded first, then the level is written into its stored state in ONE read-modify-write transaction — nothing
 * else in the state changes (`at` neither: a newer state elsewhere still wins), and a level already stored (a pick,
 * another tab's stamp) stays and is what memory takes. Announced to the other tabs like any task write.
 */
export async function stampApprovals(levels: ReadonlyArray<readonly [ID, ApprovalsLevel]>): Promise<void> {
  const s = scope()
  const open = () => levels.filter(([id]) => !ownLevel(useCodingLocal.getState().tasks[memKey(id, s)]))
  if (!open().length) return
  await Promise.all(open().map(([id]) => loadTask(id)))
  const todo = open()
  if (!todo.length || scope() !== s) return
  const kept = new Map<ID, ApprovalsLevel>()
  const store = kv()
  if (store) {
    try {
      await store('readwrite', (os) => {
        for (const [id, level] of todo) {
          const key = `${s}|task|${id}`
          const req = os.get(key)
          req.onsuccess = () => {
            const old: unknown = req.result
            const has = ownLevel(old)
            if (has) kept.set(id, has)
            else os.put({ ...(old && typeof old === 'object' ? (old as TaskLocal) : { state: 'idle' }), approvals: level }, key)
          }
        }
        return new Promise<void>((done, fail) => {
          os.transaction.oncomplete = () => done()
          os.transaction.onerror = os.transaction.onabort = () => fail(os.transaction.error)
        })
      })
    } catch {
      noDb = true
    }
  }
  useCodingLocal.setState((st) => {
    const tasks = { ...st.tasks }
    let changed = false
    for (const [id, level] of todo) {
      const key = memKey(id, s)
      const cur = tasks[key]
      if (ownLevel(cur) && !kept.has(id)) continue
      tasks[key] = { ...(cur ?? { state: 'idle' }), approvals: kept.get(id) ?? level }
      changed = true
    }
    return changed ? { tasks } : st
  })
  for (const [id] of todo) {
    try {
      taskChannel()?.postMessage({ scope: s, taskId: id })
    } catch {
      /* closed */
    }
  }
}

/** Change a task's state (memory now, IndexedDB right after). */
export async function patchTask(taskId: ID, patch: Partial<TaskLocal>): Promise<TaskLocal> {
  const s = scope()
  await loadTask(taskId)
  const key = memKey(taskId, s)
  const next: TaskLocal = { ...(useCodingLocal.getState().tasks[key] ?? { state: 'idle' }), ...patch, at: Date.now() }
  snapshot.delete(key)
  useCodingLocal.setState((st) => ({ tasks: { ...st.tasks, [key]: next } }))
  await write(`${s}|task|${taskId}`, next)
  try {
    taskChannel()?.postMessage({ scope: s, taskId })
  } catch {
    /* closed */
  }
  return next
}

/* ------------------------------------------------------------------ log (batched writes) */

const dirtyLogs = new Map<string, { scope: string; taskId: ID }>()
let flushTimer = 0

export function appendLog(taskId: ID, lines: LogLine[]): void {
  if (!lines.length) return
  const s = scope()
  const key = memKey(taskId, s)
  if (!loaded.has(key)) void loadTask(taskId)
  useCodingLocal.setState((st) => ({ logs: { ...st.logs, [key]: [...(st.logs[key] ?? []), ...lines].slice(-LOG_MAX) } }))
  dirtyLogs.set(key, { scope: s, taskId })
  if (!flushTimer) flushTimer = window.setTimeout(flushLogs, 600)
}

export async function flushLogs(): Promise<void> {
  flushTimer = 0
  const jobs = [...dirtyLogs.entries()]
  dirtyLogs.clear()
  await Promise.all(jobs.map(([key, { scope: s, taskId }]) => write(`${s}|log|${taskId}`, useCodingLocal.getState().logs[key] ?? [])))
}

export async function clearLog(taskId: ID): Promise<void> {
  const s = scope()
  const key = memKey(taskId, s)
  useCodingLocal.setState((st) => ({ logs: { ...st.logs, [key]: [] } }))
  await write(`${s}|log|${taskId}`, [])
}

/* ------------------------------------------------------------------ trust (team workspaces) */

const MAX_TRUST = 2000
let trustCache: { scope: string; set: Set<string> } | null = null

/**
 * Another tab of this browser trusted a version (`hash`), or marked / cleared a task an MCP write moved or the pick-up
 * wrote (`touched`, `kind` — absent: 'mcp'):
 * every tab's trust readouts re-check (trustRev).
 */
type TrustMessage = { scope: string; hash: string } | { scope: string; touched: ID; on: boolean; kind?: TouchKind }
let trustChan: BroadcastChannel | null | undefined

function trustChannel(): BroadcastChannel | null {
  if (trustChan !== undefined) return trustChan
  trustChan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-coding-trust') : null
  trustChan?.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as Record<string, unknown> | null
    if (!m || typeof m.scope !== 'string' || m.scope !== scope()) return
    if (typeof m.hash === 'string') {
      if (trustCache?.scope === m.scope) trustCache.set.add(m.hash)
    } else if (typeof m.touched === 'string') {
      // an older tab names no kind: its marks are MCP ones
      const cache = touched[m.kind === 'file' ? 'file' : 'mcp'].cache
      if (cache?.scope === m.scope) {
        if (m.on === true) cache.set.add(m.touched)
        else cache.set.delete(m.touched)
      }
    } else return
    useCodingLocal.setState((st) => ({ trustRev: st.trustRev + 1 }))
  })
  return trustChan
}

export async function trustedHashes(): Promise<Set<string>> {
  trustChannel()
  const s = scope()
  if (trustCache?.scope === s) return trustCache.set
  const list = await read<string[]>(`${s}|trust`)
  // a hash another tab sent while this read went on stays
  const set = new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  if (trustCache?.scope === s) for (const h of trustCache.set) set.add(h)
  trustCache = { scope: s, set }
  return set
}

/**
 * Trust a task version on this device: kept in this tab at once, then added to the stored list in ONE read-modify-write
 * (idb-keyval update — two tabs confirming at the same moment both keep theirs; the newest MAX_TRUST stay), and the
 * other tabs are told (BroadcastChannel "one-coding-trust": their trustRev goes up, their lamps and panels re-check).
 */
export async function addTrusted(hash: string): Promise<void> {
  const s = scope()
  const set = await trustedHashes()
  if (set.has(hash)) return
  set.add(hash)
  useCodingLocal.setState((st) => ({ trustRev: st.trustRev + 1 }))
  const store = kv()
  if (store) {
    try {
      let stored: string[] = []
      await update<unknown>(
        `${s}|trust`,
        (cur) => {
          const list = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string') : []
          stored = list.includes(hash) ? list : [...list, hash].slice(-MAX_TRUST)
          return stored
        },
        store,
      )
      // what other tabs stored meanwhile joins this tab's set
      if (trustCache?.scope === s) for (const h of stored) trustCache.set.add(h)
    } catch {
      noDb = true
    }
  }
  try {
    trustChannel()?.postMessage({ scope: s, hash } satisfies TrustMessage)
  } catch {
    /* closed */
  }
}

/* ------------------------------------------------------------------ tasks written from outside (local workspaces) */

/**
 * Why a task waits for Confirm on this device although nobody else shares the workspace: 'mcp' — an MCP write moved its
 * version (`<scope>|mcpTouched|<id>`); 'file' — the folder / GitHub pick-up wrote it (its text, its title) or made it
 * (`<scope>|fileTouched|<id>`, Prüfaufträge B2). Confirm removes both; the person's own edit in the editor removes 'file'.
 */
export type TouchKind = 'mcp' | 'file'

const touched: Record<TouchKind, { cache: { scope: string; set: Set<ID> } | null; load: { scope: string; job: Promise<Set<ID>> } | null }> = {
  mcp: { cache: null, load: null },
  file: { cache: null, load: null },
}
const touchedKey = (kind: TouchKind, s: string, taskId: ID) => `${s}|${kind}Touched|${taskId}`

/** The tasks marked `kind` on this device (read once per workspace; later marks join in memory). */
function loadTouched(kind: TouchKind): Promise<Set<ID>> {
  trustChannel()
  const s = scope()
  const t = touched[kind]
  if (t.cache?.scope === s) return Promise.resolve(t.cache.set)
  if (t.load?.scope === s) return t.load.job
  const job = (async () => {
    const set = new Set<ID>()
    const store = kv()
    const prefix = `${s}|${kind}Touched|`
    if (store) {
      try {
        for (const k of await keys(store)) if (typeof k === 'string' && k.startsWith(prefix)) set.add(k.slice(prefix.length))
      } catch {
        noDb = true
      }
    }
    // marks made while the read went on stay
    if (t.cache?.scope === s) for (const id of t.cache.set) set.add(id)
    t.cache = { scope: s, set }
    return set
  })()
  t.load = { scope: s, job }
  return job
}

/** Synchronous: is this task marked `kind` here? (false until its marks were read) */
const isTouched = (kind: TouchKind, taskId: ID): boolean => touched[kind].cache?.scope === scope() && !!touched[kind].cache?.set.has(taskId)

async function markTouched(kind: TouchKind, ids: ID[]): Promise<void> {
  if (!ids.length) return
  const s = scope()
  const set = await loadTouched(kind)
  const fresh = ids.filter((id) => !set.has(id))
  if (!fresh.length) return
  for (const id of fresh) set.add(id)
  useCodingLocal.setState((st) => ({ trustRev: st.trustRev + 1 }))
  await Promise.all(fresh.map((id) => write(touchedKey(kind, s, id), true)))
  for (const id of fresh) {
    try {
      trustChannel()?.postMessage({ scope: s, touched: id, on: true, kind } satisfies TrustMessage)
    } catch {
      /* closed */
    }
  }
}

async function clearTouched(kind: TouchKind, taskId: ID): Promise<void> {
  const s = scope()
  const set = await loadTouched(kind)
  if (!set.delete(taskId)) return
  useCodingLocal.setState((st) => ({ trustRev: st.trustRev + 1 }))
  const store = kv()
  if (store) {
    try {
      await del(touchedKey(kind, s, taskId), store)
    } catch {
      noDb = true
    }
  }
  try {
    trustChannel()?.postMessage({ scope: s, touched: taskId, on: false, kind } satisfies TrustMessage)
  } catch {
    /* closed */
  }
}

/** The tasks an MCP write moved on this device (read once per workspace; later marks join in memory). */
export const loadMcpTouched = (): Promise<Set<ID>> => loadTouched('mcp')
/** Synchronous: did an MCP write move this task here? (false until loadMcpTouched read the device's marks) */
export const isMcpTouched = (taskId: ID): boolean => isTouched('mcp', taskId)
/** Mark tasks an MCP write moved: they wait for Confirm on this device (trust.ts needsConfirm). */
export const markMcpTouched = (ids: ID[]): Promise<void> => markTouched('mcp', ids)
/** Confirm on this device: the task no longer counts as moved by MCP. */
export const clearMcpTouched = (taskId: ID): Promise<void> => clearTouched('mcp', taskId)

/** The tasks the folder / GitHub pick-up wrote or made on this device (read once per workspace). */
export const loadFileTouched = (): Promise<Set<ID>> => loadTouched('file')
/** Synchronous: did the folder / GitHub pick-up write this task here? (false until loadFileTouched read the marks) */
export const isFileTouched = (taskId: ID): boolean => isTouched('file', taskId)
/** Mark tasks the pick-up wrote or made: they wait for Confirm on this device (trust.ts needsConfirm). */
export const markFileTouched = (ids: ID[]): Promise<void> => markTouched('file', ids)
/** Confirm on this device, or the person's own edit in the editor: the task is theirs again. */
export const clearFileTouched = (taskId: ID): Promise<void> => clearTouched('file', taskId)
