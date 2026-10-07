/**
 * Coding pipeline — this tab's link to the worker (useCoding) and this device's settings (localStorage
 * 'one.coding': per browser, never part of the workspace, never synced, never in a backup).
 *
 * `pairs`: the pairing secret of the worker downloaded for each workspace on this device (download.ts). A
 * new download replaces it — the old file stops pairing. The tab says hello with it; a worker.json worker
 * ignores it, a downloaded one refuses every tab without it.
 */
import { create } from 'zustand'
import { PAIR_SECRET, WORKER_DEFAULT_PORT, WORKSPACE_ID, type BusyTask, type IntakeState, type RefusedReason, type TaskProgress, type WorkerInfo } from './protocol'

export const CODING_STORAGE_KEY = 'one.coding'

export interface WorkerPair {
  secret: string
  /** when the worker was downloaded (ms) */
  at: number
}

export interface CodingSettings {
  /** "Connect to a coding worker on this computer" (switched on by a download) */
  enabled: boolean
  port: number
  /** workspace id → the pairing secret of its downloaded worker */
  pairs: Record<string, WorkerPair>
}

export const DEFAULT_CODING: CodingSettings = { enabled: false, port: WORKER_DEFAULT_PORT, pairs: {} }

const MAX_PAIRS = 20

export const validPort = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null
}

function readPairs(raw: unknown): Record<string, WorkerPair> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const list = Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, WorkerPair] => {
      const v = e[1] as Partial<WorkerPair> | null
      return WORKSPACE_ID.test(e[0]) && !!v && typeof v.secret === 'string' && PAIR_SECRET.test(v.secret) && typeof v.at === 'number'
    })
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_PAIRS)
  return Object.fromEntries(list.map(([id, v]) => [id, { secret: v.secret, at: v.at }]))
}

export function loadCodingSettings(): CodingSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CODING_STORAGE_KEY) ?? 'null') as Partial<CodingSettings> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CODING, pairs: {} }
    return { enabled: raw.enabled === true, port: validPort(raw.port) ?? WORKER_DEFAULT_PORT, pairs: readPairs(raw.pairs) }
  } catch {
    return { ...DEFAULT_CODING, pairs: {} }
  }
}

export function saveCodingSettings(s: CodingSettings): void {
  try {
    window.localStorage.setItem(CODING_STORAGE_KEY, JSON.stringify({ enabled: s.enabled, port: s.port, pairs: readPairs(s.pairs) }))
  } catch {
    /* private mode: this tab keeps it */
  }
}

/**
 * off · connecting · waiting (no worker yet, retrying) · connected · replaced (a newer tab took over) ·
 * refused (another workspace, not bound, or a downloaded worker without this device's pairing) · blocked
 * (the browser refuses the connection)
 */
export type CodingConn = 'off' | 'connecting' | 'waiting' | 'connected' | 'replaced' | 'refused' | 'blocked'

export interface CodingState extends CodingSettings {
  conn: CodingConn
  refused: RefusedReason | null
  /** the refusing worker came ready-paired from a download */
  refusedPaired: boolean
  worker: WorkerInfo | null
  busy: BusyTask[]
  spentToday: number
  /** Claude Code's progress per running task (memory only; gone when its stage ends) */
  progress: Record<string, TaskProgress & { at: number }>
  /** Import stages: the code a task's panel handed the worker (memory only) */
  intake: Record<string, IntakeState & { at: number }>
  /** bumped when this device picks another project (#/coding re-reads its choice) */
  projectRev: number
}

export const useCoding = create<CodingState>()(() => ({
  ...loadCodingSettings(),
  conn: 'off',
  refused: null,
  refusedPaired: false,
  worker: null,
  busy: [],
  spentToday: 0,
  progress: {},
  intake: {},
  projectRev: 0,
}))
