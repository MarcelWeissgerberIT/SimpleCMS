/**
 * Coding pipeline — what this device keeps per task (IndexedDB "one-coding" / "kv"; never synced, wiped with
 * a team workspace's copy — cloud/device.ts):
 *   <scope>|log|<taskId>    LogLine[] (the last LOG_MAX lines)
 *   <scope>|task|<taskId>   TaskLocal — run state, the question, answers, rework note, plan, summary, the
 *                           newest diff / git state and test output, "Run now"
 *   <scope>|trust           hashes of task versions written or confirmed here (team workspaces)
 * <scope> = "local:local" / "cloud:<workspace id>". Without IndexedDB everything stays in memory.
 */
import { create } from 'zustand'
import { createStore, get, set as idbSet, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'
import type { ID } from '../../store/types'
import { LOG_MAX, type GitInfo, type LogLine, type TestResult } from './protocol'

/** What this device knows about a task's run (the row holds what everyone sees). */
export interface TaskLocal {
  /** idle · running (the worker has it) · question (waits for an answer) · failed · stopped */
  state: 'idle' | 'running' | 'question' | 'failed' | 'stopped'
  stageId?: ID | null
  error?: string | null
  question?: string | null
  /** answers given in the current stage */
  answers?: Array<{ q: string; a: string; stageId: ID }>
  /** the newest rework note for a stage */
  rework?: { stageId: ID; text: string } | null
  /** run once even when the stage is not automatic (Run now / Retry / an answer) */
  runNow?: boolean
  plan?: string | null
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
}

export const useCodingLocal = create<LocalState>()(() => ({ tasks: {}, logs: {} }))

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

/** Load a task's state and log into memory (once per task and workspace). */
export async function loadTask(taskId: ID): Promise<void> {
  const s = scope()
  const key = memKey(taskId, s)
  if (loaded.has(key)) return
  loaded.add(key)
  const [task, log] = await Promise.all([read<TaskLocal>(`${s}|task|${taskId}`), read<LogLine[]>(`${s}|log|${taskId}`)])
  useCodingLocal.setState((st) => ({
    tasks: { ...st.tasks, [key]: { ...(task && typeof task === 'object' ? task : { state: 'idle' }), ...st.tasks[key] } },
    logs: { ...st.logs, [key]: [...(Array.isArray(log) ? log : []), ...(st.logs[key] ?? [])].slice(-LOG_MAX) },
  }))
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

/** Change a task's state (memory now, IndexedDB right after). */
export async function patchTask(taskId: ID, patch: Partial<TaskLocal>): Promise<TaskLocal> {
  const s = scope()
  await loadTask(taskId)
  const key = memKey(taskId, s)
  const next: TaskLocal = { ...(useCodingLocal.getState().tasks[key] ?? { state: 'idle' }), ...patch, at: Date.now() }
  useCodingLocal.setState((st) => ({ tasks: { ...st.tasks, [key]: next } }))
  await write(`${s}|task|${taskId}`, next)
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

export async function trustedHashes(): Promise<Set<string>> {
  const s = scope()
  if (trustCache?.scope === s) return trustCache.set
  const list = await read<string[]>(`${s}|trust`)
  trustCache = { scope: s, set: new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []) }
  return trustCache.set
}

export async function addTrusted(hash: string): Promise<void> {
  const set = await trustedHashes()
  if (set.has(hash)) return
  set.add(hash)
  const list = [...set].slice(-MAX_TRUST)
  await write(`${scope()}|trust`, list)
}
