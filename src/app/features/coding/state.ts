/**
 * Coding pipeline — this tab's link to the worker (useCoding) and this device's settings (localStorage
 * 'one.coding': per browser, never part of the workspace, never synced).
 */
import { create } from 'zustand'
import { WORKER_DEFAULT_PORT, type BusyTask, type WorkerInfo } from './protocol'

export const CODING_STORAGE_KEY = 'one.coding'

export interface CodingSettings {
  /** "Connect to a coding worker on this computer" */
  enabled: boolean
  port: number
}

export const DEFAULT_CODING: CodingSettings = { enabled: false, port: WORKER_DEFAULT_PORT }

export const validPort = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null
}

export function loadCodingSettings(): CodingSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CODING_STORAGE_KEY) ?? 'null') as Partial<CodingSettings> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CODING }
    return { enabled: raw.enabled === true, port: validPort(raw.port) ?? WORKER_DEFAULT_PORT }
  } catch {
    return { ...DEFAULT_CODING }
  }
}

export function saveCodingSettings(s: CodingSettings): void {
  try {
    window.localStorage.setItem(CODING_STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* private mode: this tab keeps it */
  }
}

/**
 * off · connecting · waiting (no worker yet, retrying) · connected · replaced (a newer tab took over) ·
 * refused (the worker serves another workspace, or none) · blocked (the browser refuses the connection)
 */
export type CodingConn = 'off' | 'connecting' | 'waiting' | 'connected' | 'replaced' | 'refused' | 'blocked'

export interface CodingState extends CodingSettings {
  conn: CodingConn
  refused: 'workspace' | 'unbound' | null
  worker: WorkerInfo | null
  busy: BusyTask[]
  spentToday: number
}

export const useCoding = create<CodingState>()(() => ({
  ...loadCodingSettings(),
  conn: 'off',
  refused: null,
  worker: null,
  busy: [],
  spentToday: 0,
}))
