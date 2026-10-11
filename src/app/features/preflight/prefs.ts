/**
 * Preflight's small records in localStorage (per device; never synced, exported or backed up):
 *  - one.preflight.prefs = { on, at, hold, test } — device-wide, written only by PreflightSettings
 *  - one.preflight.today:<scope> = the Preflight day (held / shown / lamp test / the new lamps at the last fold)
 *  - one.preflight.last:<scope> = the lit lamps when last counted (ids and levels only)
 *  - one.preflight.hidden:<scope> = lamps hidden on this device
 *  - one.preflight.lastScope = { [workspace ref]: member scope } — the boot hold before the cloud boot ended
 * Every read and write is wrapped: a browser that refuses storage keeps the values in memory for this tab.
 * Pure apart from localStorage (no store, no brand module) — the sanitizers run in the Node spec.
 */
import { DEFAULT_AT, parseAt } from './day'
import type { LampId } from './registry'
import type { LastCache, Level, PreflightPrefs, TodayRecord } from './types'

export const PREFS_KEY = 'one.preflight.prefs'
export const LAST_SCOPE_KEY = 'one.preflight.lastScope'
export const todayKey = (scope: string) => `one.preflight.today:${scope}`
export const lastKey = (scope: string) => `one.preflight.last:${scope}`
export const hiddenKey = (scope: string) => `one.preflight.hidden:${scope}`
export const ackKey = (scope: string) => `one.preflight.ack:${scope}`

export const DEFAULT_PREFS: PreflightPrefs = { on: true, at: DEFAULT_AT, hold: true, test: true }

const memory = new Map<string, string>()

export function readRaw(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    /* refused: memory below */
  }
  return memory.get(key) ?? null
}

export function writeRaw(key: string, value: string | null): void {
  if (value === null) memory.delete(key)
  else memory.set(key, value)
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* refused: kept in memory for this tab */
  }
}

function readJson(key: string): unknown {
  const raw = readRaw(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/* ---------------- device preferences */

/** Sanitize stored preferences: unknown or bad fields fall back to the defaults. */
export function sanitizePrefs(raw: unknown): PreflightPrefs {
  const r = isObj(raw) ? raw : {}
  return {
    on: typeof r.on === 'boolean' ? r.on : DEFAULT_PREFS.on,
    at: typeof r.at === 'string' && parseAt(r.at) !== null ? r.at : DEFAULT_PREFS.at,
    hold: typeof r.hold === 'boolean' ? r.hold : DEFAULT_PREFS.hold,
    test: typeof r.test === 'boolean' ? r.test : DEFAULT_PREFS.test,
  }
}

export function readPrefs(): PreflightPrefs {
  return sanitizePrefs(readJson(PREFS_KEY))
}

const prefListeners = new Set<() => void>()

/** Change this device's preferences (PreflightSettings only). */
export function writePrefs(patch: Partial<PreflightPrefs>): PreflightPrefs {
  const next = sanitizePrefs({ ...readPrefs(), ...patch })
  writeRaw(PREFS_KEY, JSON.stringify(next))
  emitPrefs()
  return next
}

function emitPrefs(): void {
  for (const fn of prefListeners) {
    try {
      fn()
    } catch (e) {
      console.warn('[one] preflight prefs listener failed', e)
    }
  }
}

let storageHooked = false
/** Called when the preferences change here or in another tab. */
export function onPrefsChanged(fn: () => void): () => void {
  prefListeners.add(fn)
  if (!storageHooked && typeof window !== 'undefined') {
    storageHooked = true
    window.addEventListener('storage', (e) => {
      if (e.key === PREFS_KEY) emitPrefs()
    })
  }
  return () => {
    prefListeners.delete(fn)
  }
}

/* ---------------- the Preflight day */

const LEVELS: ReadonlySet<string> = new Set(['dark', 'amber', 'red', 'grey'])
const lampIds = (v: unknown, max = 64): LampId[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120).slice(0, max) : [])

/** A day record; another day's (or a bad one) reads as `{ day, base: [] }`. */
export function sanitizeToday(raw: unknown, day: string): TodayRecord {
  if (!isObj(raw) || raw.day !== day) return { day, base: [] }
  return {
    day,
    ...(raw.held === true ? { held: true as const } : {}),
    ...(raw.shown === true ? { shown: true as const } : {}),
    ...(raw.test === 'ran' || raw.test === 'skipped' || raw.test === 'off' ? { test: raw.test } : {}),
    base: lampIds(raw.base),
  }
}

export function readToday(scope: string, day: string): TodayRecord {
  return sanitizeToday(readJson(todayKey(scope)), day)
}

/** The stored record as it is (its own day), for the boot hold. */
export function readTodayAny(scope: string): TodayRecord | null {
  const raw = readJson(todayKey(scope))
  return isObj(raw) && typeof raw.day === 'string' ? sanitizeToday(raw, raw.day) : null
}

export function writeToday(scope: string, rec: TodayRecord): void {
  writeRaw(todayKey(scope), JSON.stringify(rec))
}

/* ---------------- the last count */

export function sanitizeLast(raw: unknown): LastCache | null {
  if (!isObj(raw) || typeof raw.at !== 'number' || !Array.isArray(raw.lamps)) return null
  const lamps: Array<[LampId, Level]> = []
  for (const e of raw.lamps.slice(0, 64)) {
    if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && LEVELS.has(e[1])) lamps.push([e[0], e[1] as Level])
  }
  return { at: raw.at, lamps }
}

export function readLast(scope: string): LastCache | null {
  return sanitizeLast(readJson(lastKey(scope)))
}

export function writeLast(scope: string, last: LastCache): void {
  writeRaw(lastKey(scope), JSON.stringify(last))
}

/* ---------------- hidden on this device */

export function readHidden(scope: string): LampId[] {
  return lampIds(readJson(hiddenKey(scope)))
}

export function writeHidden(scope: string, ids: LampId[]): void {
  writeRaw(hiddenKey(scope), ids.length ? JSON.stringify(lampIds(ids)) : null)
}

/* ---------------- the member scope last used per workspace */

const LAST_SCOPES_MAX = 20

export function readLastScope(workspace: string): string | null {
  const raw = readJson(LAST_SCOPE_KEY)
  return isObj(raw) && typeof raw[workspace] === 'string' ? (raw[workspace] as string) : null
}

export function writeLastScope(workspace: string, scope: string): void {
  const raw = readJson(LAST_SCOPE_KEY)
  const cur: Record<string, string> = {}
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') cur[k] = v
  if (cur[workspace] === scope) return
  delete cur[workspace]
  const entries = [...Object.entries(cur), [workspace, scope] as [string, string]].slice(-LAST_SCOPES_MAX)
  writeRaw(LAST_SCOPE_KEY, JSON.stringify(Object.fromEntries(entries)))
}

/** Forget a workspace's last scope (its device copy was wiped). */
export function dropLastScope(workspace: string): void {
  const raw = readJson(LAST_SCOPE_KEY)
  if (!isObj(raw) || !(workspace in raw)) return
  const cur = { ...raw }
  delete cur[workspace]
  writeRaw(LAST_SCOPE_KEY, Object.keys(cur).length ? JSON.stringify(cur) : null)
}
