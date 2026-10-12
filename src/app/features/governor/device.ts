/**
 * The person's own line for this browser (Regler G-D2, owner decision 1) and the ledger scopes metered here:
 *  - localStorage `one.governor.device` = { v: 1, day?, month?, at } — every workspace and member signed in in this
 *    browser counts against it (keys are per browser: a team workspace inherits the local key). Never synced, never in a
 *    backup; it survives the local reset like one.textScale. Written only by setDeviceLimit() (Settings › KI); the store
 *    then re-stamps the device generation (B1: stampDeviceGen()).
 *  - localStorage `one.governor.scopes` = [{ scope, last }] (≤ 50, seen within 35 days): which scopes this browser
 *    metered, so the device-wide sum can read each one's day (totals.ts, only while a device limit is set).
 * Storage refused or unreadable → no limit, no scopes (a request is never failed for its bookkeeping). Pure apart from
 * the storage handed in (Node specs pass their own).
 */
import { isReadableDeviceGovernor, sanitizeDeviceGovernor, type DeviceGovernor } from '@/shared/ai/governor'
import type { Unreadable } from '@/shared/ai/route'
import { dayOf } from './clock'

export const DEVICE_KEY = 'one.governor.device'
export const SCOPES_KEY = 'one.governor.scopes'
export const MAX_SCOPES = 50
export const SCOPE_DAYS = 35
const DAY_MS = 86_400_000

/**
 * Owner decision 1 (Regler design § 20, built with the recommendation — pending confirmation): the personal line counts
 * every workspace of this browser. false: it counts the open workspace only (deviceLineScopes returns just that one).
 */
export const DEVICE_LINE_SPANS_BROWSER = true

/** The storage the functions read and write (window.localStorage by default; a spec hands in its own). */
export interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function localKV(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readJson(kv: KV | null, key: string): unknown {
  try {
    const raw = kv?.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : undefined
  } catch {
    return undefined
  }
}

function write(kv: KV | null, key: string, value: unknown): boolean {
  if (!kv) return false
  try {
    if (value === undefined) kv.removeItem(key)
    else kv.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** The stored line as every reader keeps it (a newer build's value: unreadable — kept, never written over). */
export const readDeviceLimit = (kv: KV | null = localKV()): DeviceGovernor | Unreadable | undefined => sanitizeDeviceGovernor(readJson(kv, DEVICE_KEY))

/** The line this build acts on (undefined: none — no day or month limit — or one it cannot read). */
export function deviceLimitOf(kv: KV | null = localKV()): DeviceGovernor | undefined {
  const d = readDeviceLimit(kv)
  return isReadableDeviceGovernor(d) && (d.day !== undefined || d.month !== undefined) ? d : undefined
}

export type DeviceLimitResult = { ok: true; value: DeviceGovernor | undefined } | { ok: false; why: 'newer' | 'storage' }

/**
 * Set (or with null / both absent: remove) the person's line — the store-free part; Settings › KI then calls the store's
 * stampDeviceGen() under { kind: 'you', via: 'ui' } (B1). Refused over a value a newer build wrote.
 */
export function setDeviceLimit(next: { day?: number | null; month?: number | null } | null, kv: KV | null = localKV(), now = Date.now()): DeviceLimitResult {
  const stored = readDeviceLimit(kv)
  if (stored && !isReadableDeviceGovernor(stored)) return { ok: false, why: 'newer' }
  // a later slice's keys stay — also when the limit goes (the value then holds them alone)
  const { v: _v, day: _day, month: _month, at: _at, ...extras } = stored ?? ({ v: 1 } as DeviceGovernor)
  const limits = next ? { ...(next.day != null ? { day: next.day } : {}), ...(next.month != null ? { month: next.month } : {}) } : {}
  const value = sanitizeDeviceGovernor({ ...extras, v: 1, ...limits, at: now })
  const clean = isReadableDeviceGovernor(value) ? value : undefined
  return write(kv, DEVICE_KEY, clean) ? { ok: true, value: clean } : { ok: false, why: 'storage' }
}

/* ------------------------------------------------------------------ */
/* Scopes metered in this browser                                       */
/* ------------------------------------------------------------------ */

export interface ScopeSeen {
  scope: string
  /** the last local day an entry of it was metered here */
  last: string
}

const SCOPE_RE = /^[a-z]+:[A-Za-z0-9_:.-]{1,160}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function readScopes(kv: KV | null): ScopeSeen[] {
  const v = readJson(kv, SCOPES_KEY)
  if (!Array.isArray(v)) return []
  const out: ScopeSeen[] = []
  for (const x of v) {
    const s = x as Partial<ScopeSeen> | null
    if (!s || typeof s.scope !== 'string' || !SCOPE_RE.test(s.scope) || typeof s.last !== 'string' || !DAY_RE.test(s.last)) continue
    if (!out.some((o) => o.scope === s.scope)) out.push({ scope: s.scope, last: s.last })
  }
  return out
}

/** Scopes metered here within 35 days, newest first (this tab's own included once it metered). */
export function knownScopes(now = Date.now(), kv: KV | null = localKV()): ScopeSeen[] {
  const cutoff = dayOf(now - SCOPE_DAYS * DAY_MS)
  return readScopes(kv)
    .filter((s) => s.last >= cutoff)
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
}

/** A scope metered today (totals.ts calls it on the first meter of a scope each day). False: not written. */
export function noteScope(scope: string, now = Date.now(), kv: KV | null = localKV()): boolean {
  if (!SCOPE_RE.test(scope)) return false
  const day = dayOf(now)
  const rest = knownScopes(now, kv).filter((s) => s.scope !== scope)
  return write(kv, SCOPES_KEY, [{ scope, last: day }, ...rest].slice(0, MAX_SCOPES))
}

/** Forget scopes (a workspace's copy removed from this browser, cloud/device.ts). */
export function forgetScopes(drop: (scope: string) => boolean, kv: KV | null = localKV()): void {
  const all = readScopes(kv)
  const keep = all.filter((s) => !drop(s.scope))
  if (keep.length !== all.length) write(kv, SCOPES_KEY, keep.length ? keep : undefined)
}

/**
 * The scopes the personal line counts — owner decision 1: every scope metered in this browser (and the open one), else
 * the open one only. `current` null (a team account not known yet): the others alone.
 */
export function deviceLineScopes(current: string | null, known: readonly ScopeSeen[]): string[] {
  if (!DEVICE_LINE_SPANS_BROWSER) return current ? [current] : []
  const out = current ? [current] : []
  for (const s of known) if (!out.includes(s.scope)) out.push(s.scope)
  return out
}
