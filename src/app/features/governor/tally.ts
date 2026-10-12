/**
 * The Regler's running totals — the pure core (no storage, no channel; totals.ts drives it, a Node spec too).
 *
 * Per scope (a workspace's member on this device) a Tally holds today's spend as: the last full read of the ledger's day
 * (ledgerDay) + this tab's entries metered since (by id) + the other tabs' deltas since (once per batch id). Before the
 * first read the localStorage cache of the scope is a lower bound (`known` false). The month = its closed days (records
 * in one-governor, read by loadMonth) + today; until those are read, a lower bound from the cache or the last day roll.
 * Every call rolls the day first (O(1)): a new local day starts at 0 and asks for a read.
 */
import type { LedgerEntry } from '@/shared/ai/types'
import type { LedgerDelta } from './ledger'
import { dayOf, monthOf } from './clock'

/** localStorage `one.governor.today:<scope>` — the synchronous lower bound after boot. */
export interface TodayCache {
  day: string
  usd: number
  unpriced: number
  month: string
  monthUsd: number
  at: number
}

export interface Tally {
  scope: string
  day: string
  /** the last full read of the day (null: none yet) */
  read: { usd: number; unpriced: number; ids: Set<string>; at: number } | null
  /** this tab's entries of the day not in the read: id → usd (null: unpriced) */
  own: Map<string, number | null>
  /** the other tabs' deltas of the day not in the read, by batch id */
  batches: Map<string, { usd: number; unpriced: number; at: number }>
  /** batch ids heard this day (a batch heard twice counts once) */
  seen: Set<string>
  /** the month's closed days (null: not read for this day yet) */
  closed: number | null
  /** a lower bound for them until read (the cache, or the day that rolled into them) */
  closedFloor: number
  /** a lower bound for today until the first read (the cache) */
  floor: { usd: number; unpriced: number }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** A cache as stored (null: none, or not one). */
export function readTodayCache(v: unknown): TodayCache | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const c = v as Record<string, unknown>
  if (typeof c.day !== 'string' || !DAY_RE.test(c.day)) return null
  return { day: c.day, usd: num(c.usd), unpriced: Math.floor(num(c.unpriced)), month: monthOf(c.day), monthUsd: Math.max(num(c.monthUsd), num(c.usd)), at: num(c.at) }
}

/** A scope's tally at `now`, seeded from its cache (a cache of another day or month gives what it still can). */
export function newTally(scope: string, now: number, cache?: TodayCache | null): Tally {
  const day = dayOf(now)
  const t: Tally = { scope, day, read: null, own: new Map(), batches: new Map(), seen: new Set(), closed: null, closedFloor: 0, floor: { usd: 0, unpriced: 0 } }
  if (cache && cache.day === day) {
    t.floor = { usd: cache.usd, unpriced: cache.unpriced }
    t.closedFloor = Math.max(0, cache.monthUsd - cache.usd)
  } else if (cache && cache.day < day && cache.month === monthOf(day)) {
    // every day of that cache is closed now
    t.closedFloor = cache.monthUsd
  }
  return t
}

/** Today's spend of a tally (priced sum, unpriced count). */
export function todayOf(t: Tally): { usd: number; unpriced: number } {
  let ownUsd = 0
  let ownUn = 0
  for (const v of t.own.values()) {
    if (v === null) ownUn += 1
    else ownUsd += v
  }
  let bUsd = 0
  let bUn = 0
  for (const b of t.batches.values()) {
    bUsd += b.usd
    bUn += b.unpriced
  }
  if (t.read) return { usd: t.read.usd + ownUsd + bUsd, unpriced: t.read.unpriced + ownUn + bUn }
  // before the first read: never below the cache, never below what this tab saw
  return { usd: Math.max(t.floor.usd, ownUsd + bUsd), unpriced: Math.max(t.floor.unpriced, ownUn + bUn) }
}

/** The month's spend (closed days + today). */
export const monthSpentOf = (t: Tally): number => (t.closed ?? t.closedFloor) + todayOf(t).usd

/** A new local day: today starts at 0, the day that ended moves into the month's closed part. True: rolled (read again). */
export function rollTally(t: Tally, now: number): boolean {
  const day = dayOf(now)
  if (day === t.day) return false
  const ended = todayOf(t).usd
  const sameMonth = monthOf(day) === monthOf(t.day)
  t.closedFloor = sameMonth ? (t.closed ?? t.closedFloor) + ended : 0
  t.closed = null
  t.day = day
  t.read = null
  t.own.clear()
  t.batches.clear()
  t.seen.clear()
  t.floor = { usd: 0, unpriced: 0 }
  return true
}

/** This tab metered an entry of this scope. */
export function meterTally(t: Tally, e: Pick<LedgerEntry, 'id' | 'at' | 'usd'>, now: number): void {
  rollTally(t, now)
  if (dayOf(e.at) !== t.day || t.read?.ids.has(e.id)) return
  t.own.set(e.id, e.usd === null ? null : Math.max(0, e.usd))
}

/**
 * Another tab wrote entries: 'added' (counted), 'dup' (that batch was heard already), 'read' (an older tab's ping
 * without a delta — read the day again), 'skip' (another day's).
 */
export function deltaTally(t: Tally, d: LedgerDelta, now: number): 'added' | 'dup' | 'read' | 'skip' {
  rollTally(t, now)
  if (d.batch === null || d.day === null) return 'read'
  if (d.day !== t.day) return 'skip'
  if (t.seen.has(d.batch)) return 'dup'
  t.seen.add(d.batch)
  t.batches.set(d.batch, { usd: Math.max(0, d.usd), unpriced: Math.max(0, d.unpriced), at: now })
  return 'added'
}

/**
 * A full read of `day` (started at `startedAt`) replaces the counted day: this tab's entries it holds leave `own`; the
 * deltas heard before it started leave `batches` (it holds them). Deltas heard while it ran stay — counted twice at most
 * until the next read (the brake errs on the safe side). Ignored when the day rolled meanwhile. True: applied.
 */
export function readTally(t: Tally, day: string, entries: ReadonlyArray<Pick<LedgerEntry, 'id' | 'usd'>>, startedAt: number, now: number): boolean {
  rollTally(t, now)
  if (day !== t.day) return false
  let usd = 0
  let unpriced = 0
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) continue
    ids.add(e.id)
    if (e.usd === null) unpriced += 1
    else usd += Math.max(0, e.usd)
  }
  t.read = { usd, unpriced, ids, at: startedAt }
  for (const id of ids) t.own.delete(id)
  for (const [batch, b] of t.batches) if (b.at < startedAt) t.batches.delete(batch)
  t.floor = { usd: 0, unpriced: 0 }
  return true
}

/** A ledger read of one day (ledger.ts ledgerDayRead): `complete` false = the store did not answer, the entries are this tab's memory only. */
export interface DayRead {
  entries: ReadonlyArray<Pick<LedgerEntry, 'id' | 'usd'>>
  complete: boolean
}

/**
 * A day's read as the totals take it: only a complete read replaces the day (readTally). A memory-only read is no total —
 * the floor (the cache) and the deltas heard stay, and nothing goes into the cache. True: applied.
 */
export const applyDayRead = (t: Tally, day: string, read: DayRead, startedAt: number, now: number): boolean =>
  read.complete && readTally(t, day, read.entries, startedAt, now)

/** A closed day's record in `one-governor` (`<scope>|day|<yyyy-MM-dd>`). */
export interface DayRecord {
  usd: number
  unpriced: number
}

export const readDayRecord = (v: unknown): DayRecord | null => {
  const r = v as Partial<DayRecord> | null
  return r && typeof r.usd === 'number' && Number.isFinite(r.usd) && r.usd >= 0 ? { usd: r.usd, unpriced: typeof r.unpriced === 'number' ? r.unpriced : 0 } : null
}

/**
 * The month's closed days of one scope: a stored record where there is one, else the day read from the ledger. Only a
 * complete read becomes a record to store (`fresh` — a closed day never changes, so a wrong record would stay for good);
 * `complete` false: some day could not be read in full — `sum` is then no total of the closed days (closedTally must not
 * take it; the floor stays).
 */
export async function closedDaysOf(days: readonly string[], stored: readonly unknown[], readDay: (day: string) => Promise<DayRead>): Promise<{ sum: number; fresh: Array<[string, DayRecord]>; complete: boolean }> {
  let sum = 0
  let complete = true
  const fresh: Array<[string, DayRecord]> = []
  for (const [i, d] of days.entries()) {
    const rec = readDayRecord(stored[i])
    if (rec) {
      sum += rec.usd
      continue
    }
    const read = await readDay(d)
    const r: DayRecord = { usd: 0, unpriced: 0 }
    for (const e of read.entries) {
      if (e.usd === null) r.unpriced += 1
      else r.usd += Math.max(0, e.usd)
    }
    sum += r.usd
    if (read.complete) fresh.push([d, r])
    else complete = false
  }
  return { sum, fresh, complete }
}

/** The month's closed days were read for `day` (ignored when the day rolled meanwhile). */
export function closedTally(t: Tally, day: string, usd: number, now: number): boolean {
  rollTally(t, now)
  if (day !== t.day) return false
  t.closed = Math.max(0, usd)
  return true
}

/** What goes into the scope's localStorage cache. */
export function cacheOf(t: Tally, now: number): TodayCache {
  const today = todayOf(t)
  return { day: t.day, usd: today.usd, unpriced: today.unpriced, month: monthOf(t.day), monthUsd: monthSpentOf(t), at: now }
}

/** The device line's sum over its scopes' tallies (today, month). */
export function sumTallies(list: readonly Tally[]): { today: number; month: number } {
  let today = 0
  let month = 0
  for (const t of list) {
    today += todayOf(t).usd
    month += monthSpentOf(t)
  }
  return { today, month }
}

/** Has the day been read in full (the dial drops its "≈")? */
export const tallyKnown = (t: Tally): boolean => t.read !== null
