/**
 * Coding pipeline — this tab's link to the worker (useCoding) and this device's settings (localStorage
 * 'one.coding': per browser, never part of the workspace, never synced, never in a backup).
 *
 * `pairs`: the pairing secret of the worker downloaded for each workspace on this device (download.ts). A
 * new download replaces it — the old file stops pairing. The tab says hello with it; a worker.json worker
 * ignores it, a downloaded one refuses every tab without it.
 *
 * Cloud (team workspaces, docs/CODING.md § Cloud worker): `via[<team:id>] = 'cloud'` — this device reaches its
 * worker through the team server; `cloudPairs[<team:id>].tokens`: the token ids of this device's cloud downloads
 * whose worker may still connect (newest first, at most MAX_CLOUD_KEYS) — ids only: each one's pairing key is a
 * non-extractable WebCrypto key in IndexedDB (cloudKeys.ts). The worker token itself is only ever in the
 * downloaded file, the pairing secret only in the file and (non-extractable) on this device.
 */
import { create } from 'zustand'
import { PAIR_SECRET, WORKER_DEFAULT_PORT, WORKSPACE_ID, type BusyTask, type IntakeState, type RefusedReason, type TaskProgress, type WorkerInfo } from './protocol'

export const CODING_STORAGE_KEY = 'one.coding'

export interface WorkerPair {
  secret: string
  /** when the worker was downloaded (ms) */
  at: number
}

/** The cloud workers downloaded on this device for a workspace: their token ids (never a token, never a secret). */
export interface CloudPair {
  /** newest first: the last download, then older ones whose worker still works (the active one until a newer connects) */
  tokens: string[]
  /** when the last one was downloaded (ms) */
  at: number
}

/** Downloads per workspace this device keeps keys for (in practice two: the working one and a fresh download). */
export const MAX_CLOUD_KEYS = 4

/** A pairing secret an earlier build kept in localStorage (moved into IndexedDB as a non-extractable key on start). */
export interface LegacyCloudSecret {
  workspace: string
  token: string
  secret: string
}

export interface CodingSettings {
  /** "Connect to a coding worker on this computer" (switched on by a download) */
  enabled: boolean
  port: number
  /** workspace id → the pairing secret of its downloaded worker */
  pairs: Record<string, WorkerPair>
  /** team workspace id → 'cloud': this device reaches its worker through the team server (absent: Local) */
  via: Record<string, 'cloud'>
  /** team workspace id → the cloud worker downloaded on this device */
  cloudPairs: Record<string, CloudPair>
}

export const DEFAULT_CODING: CodingSettings = { enabled: false, port: WORKER_DEFAULT_PORT, pairs: {}, via: {}, cloudPairs: {} }

const MAX_PAIRS = 20
const TEAM_ID = /^team:[A-Za-z0-9_-]{1,64}$/
const TOKEN_ID = /^[A-Za-z0-9_-]{1,64}$/

function readVia(raw: unknown): Record<string, 'cloud'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const list = Object.entries(raw as Record<string, unknown>).filter(([id, v]) => TEAM_ID.test(id) && v === 'cloud')
  return Object.fromEntries(list.slice(0, 50).map(([id]) => [id, 'cloud' as const]))
}

type RawCloudPair = { tokens?: unknown; at?: unknown; token?: unknown; secret?: unknown; prev?: { token?: unknown; secret?: unknown } | null }

const tokenOk = (v: unknown): v is string => typeof v === 'string' && TOKEN_ID.test(v)

function readCloudPairs(raw: unknown): Record<string, CloudPair> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Array<[string, CloudPair]> = []
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as RawCloudPair | null
    if (!TEAM_ID.test(id) || !p || typeof p !== 'object' || typeof p.at !== 'number') continue
    // an earlier build's shape: { token, secret, prev: { token, secret } } — the ids carry over (the secrets move, legacyCloudSecrets)
    const list = Array.isArray(p.tokens) ? p.tokens : [p.token, p.prev?.token]
    const tokens = [...new Set(list.filter(tokenOk))].slice(0, MAX_CLOUD_KEYS)
    if (tokens.length) out.push([id, { tokens, at: p.at }])
  }
  return Object.fromEntries(out.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PAIRS))
}

/** Pairing secrets an earlier build kept in localStorage `one.coding` (each moves into IndexedDB once, then is gone). */
export function legacyCloudSecrets(): LegacyCloudSecret[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CODING_STORAGE_KEY) ?? 'null') as { cloudPairs?: Record<string, RawCloudPair | null> } | null
    const out: LegacyCloudSecret[] = []
    for (const [workspace, p] of Object.entries(raw?.cloudPairs ?? {})) {
      if (!TEAM_ID.test(workspace) || !p || typeof p !== 'object') continue
      for (const [token, secret] of [[p.token, p.secret], [p.prev?.token, p.prev?.secret]] as const) {
        if (tokenOk(token) && typeof secret === 'string' && PAIR_SECRET.test(secret)) out.push({ workspace, token, secret })
      }
    }
    return out
  } catch {
    return []
  }
}

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
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CODING, pairs: {}, via: {}, cloudPairs: {} }
    return { enabled: raw.enabled === true, port: validPort(raw.port) ?? WORKER_DEFAULT_PORT, pairs: readPairs(raw.pairs), via: readVia(raw.via), cloudPairs: readCloudPairs(raw.cloudPairs) }
  } catch {
    return { ...DEFAULT_CODING, pairs: {}, via: {}, cloudPairs: {} }
  }
}

export function saveCodingSettings(s: CodingSettings): void {
  try {
    window.localStorage.setItem(CODING_STORAGE_KEY, JSON.stringify({ enabled: s.enabled, port: s.port, pairs: readPairs(s.pairs), via: readVia(s.via), cloudPairs: readCloudPairs(s.cloudPairs) }))
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

/**
 * Why there is no link: the worker's own refusals (RefusedReason) — and, in cloud mode, the team server's: a viewer
 * runs no tasks · not allowed · no longer a member (or the workspace is gone) · the server has no relay · this
 * device has no download of the member's cloud worker (another device has) · a worker answered that this device did
 * not pair with (its boxes do not open).
 */
export type CodingRefused = RefusedReason | 'viewer' | 'forbidden' | 'removed' | 'relay-off' | 'other-device' | 'worker-unknown'

/** Cloud mode: the relay's view of the member's cloud worker (memory only). */
export interface RelayView {
  online: boolean
  /** a live token exists (active or a fresh download) */
  registered: boolean
  /** the connected worker's token id */
  token: string | null
}

export interface CodingState extends CodingSettings {
  conn: CodingConn
  refused: CodingRefused | null
  /** cloud mode only (null: local, or not known yet) */
  relay: RelayView | null
  /**
   * cloud: another device's worker of the member is online while this device's own newer download has not started —
   * this tab waits for that file (it takes over once it connects) instead of taking the other device's place
   */
  pendingHere: boolean
  /** the worker's droppable events the relay left out since this tab connected (the worker sent more at once than its budget) */
  dropped: number
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
  /** what the connected worker runs, from its last `next` (null: it has not asked yet) — an outdated one is named */
  can: string[] | null
}

export const useCoding = create<CodingState>()(() => ({
  ...loadCodingSettings(),
  conn: 'off',
  refused: null,
  relay: null,
  pendingHere: false,
  dropped: 0,
  refusedPaired: false,
  worker: null,
  busy: [],
  spentToday: 0,
  progress: {},
  intake: {},
  projectRev: 0,
  can: null,
}))
