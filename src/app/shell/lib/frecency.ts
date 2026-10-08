/**
 * Frecency of page visits — pure (no imports): how often and how lately this device opened a page.
 *
 * A visit adds 1 to a score that halves every 14 days. Coming back counts again once another page was
 * counted in between (and RETURN_MS passed), or once a session (SESSION_MS) is over — staying on a page,
 * reloading it or hopping back and forth does not inflate it. FREQUENT lists pages with 2+ counted visits
 * and a score of 1+, highest first. Stored as {"v":1,"e":{id:[score,time,visits]}} (visits.ts), read back
 * defensively: anything odd is dropped.
 */

export interface Visit {
  /** decayed score at `t` */
  s: number
  /** when the last counted visit was (ms) */
  t: number
  /** counted visits */
  n: number
}

export type VisitMap = Record<string, Visit>

const DAY = 86_400_000
export const HALF_LIFE_MS = 14 * DAY
/** a visit within this time of the last counted one is the same session */
export const SESSION_MS = 15 * 60_000
/** …unless another page was counted in between and this much time passed */
export const RETURN_MS = 2 * 60_000
export const MIN_VISITS = 2
export const MIN_SCORE = 1
export const MAX_ENTRIES = 300
export const KEEP_ENTRIES = 250
export const DROP_SCORE = 0.05
/** stored entries read back at most */
export const MAX_STORED = 400

const ID_RE = /^[\w-]{1,64}$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

/** A map without a prototype: stored ids can never reach Object.prototype. */
export const emptyVisits = (): VisitMap => Object.create(null) as VisitMap

export const validId = (id: string) => ID_RE.test(id) && !RESERVED.has(id)

/** The score at `now` (no decay for a clock that went backwards). */
export function scoreAt(v: Visit, now: number): number {
  return v.s * 2 ** (-Math.max(0, now - v.t) / HALF_LIFE_MS)
}

/**
 * Count a visit. `returning`: another page was counted since this one's last visit. The same object
 * comes back when the visit does not count (callers skip the write).
 */
export function bump(prev: Visit | undefined, now: number, returning = false): Visit {
  if (!prev) return { s: 1, t: now, n: 1 }
  const dt = now - prev.t
  if (dt >= 0 && dt < (returning ? RETURN_MS : SESSION_MS)) return prev
  return { s: scoreAt(prev, now) + 1, t: now, n: prev.n + 1 }
}

/** Drop what has faded; keep the best KEEP_ENTRIES once there are more than MAX_ENTRIES. */
export function prune(map: VisitMap, now: number): VisitMap {
  const live = Object.entries(map).filter(([, v]) => scoreAt(v, now) >= DROP_SCORE)
  if (live.length > MAX_ENTRIES) {
    live.sort((a, b) => scoreAt(b[1], now) - scoreAt(a[1], now) || b[1].t - a[1].t)
    live.length = KEEP_ENTRIES
  }
  const out = emptyVisits()
  for (const [id, v] of live) out[id] = v
  return out
}

/** Page ids for FREQUENT: 2+ visits and a score of 1+, highest score first, then the latest. */
export function rankFrequent(map: VisitMap, now: number): string[] {
  return Object.entries(map)
    .map(([id, v]) => ({ id, v, s: scoreAt(v, now) }))
    .filter((x) => x.v.n >= MIN_VISITS && x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s || b.v.t - a.v.t)
    .map((x) => x.id)
}

/** Read the stored form; junk (another version, bad ids, numbers out of range, too many) → empty. */
export function parseVisits(raw: string | null, now: number): VisitMap {
  const out = emptyVisits()
  if (!raw) return out
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return out
  const e = (data as { e?: unknown }).e
  if (!e || typeof e !== 'object' || Array.isArray(e)) return out
  const list = Object.entries(e as Record<string, unknown>)
  if (list.length > MAX_STORED) return out
  for (const [id, v] of list) {
    if (!validId(id) || !Array.isArray(v) || v.length !== 3) continue
    const [s, t, n] = v as unknown[]
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0 || s > 1e4) continue
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > now + DAY) continue
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1e6) continue
    out[id] = { s, t, n }
  }
  return out
}

/** The stored form (scores to 3 decimals). */
export function serializeVisits(map: VisitMap): string {
  const e: Record<string, [number, number, number]> = {}
  for (const [id, v] of Object.entries(map)) if (validId(id)) e[id] = [Math.round(v.s * 1000) / 1000, Math.round(v.t), v.n]
  return JSON.stringify({ v: 1, e })
}
