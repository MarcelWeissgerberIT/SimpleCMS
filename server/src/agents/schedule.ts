/**
 * Schedule slots of custom agents (docs/CLOUD.md § Agents › Schedules): wall-clock times in the agent's
 * IANA time zone, computed with Intl only (no time-zone data of our own).
 *
 * - A slot is the instant a schedule fires. `slotAt(trigger, now)` is the latest slot at or before
 *   `now`: the scheduler runs it once (its start is persisted per agent), so a restart never runs a slot
 *   twice and a slot missed while the server was down runs once when it is back — the latest one only.
 * - DST: a wall time skipped by the clock change (02:30 on the spring-forward night) fires at the
 *   instant the clock jumps to (03:30 local); a wall time that occurs twice (autumn) fires once, at its
 *   first occurrence. Hourly schedules fire every real hour at their minute.
 * - `every`: hour (at the minute of `at`) · day · weekday (Mon–Fri) · week (`weekday`, 0 = Sunday … 6) ·
 *   month (`day`, 1–31; months without that day fire on their last day).
 */
import { createHash } from 'node:crypto'
import type { ScheduleTrigger } from './types.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    formatters.set(tz, f)
  }
  return f
}

/** A time zone Intl knows (an IANA name such as "Europe/Berlin", or "UTC"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

export interface Wall {
  y: number
  m: number
  d: number
  h: number
  min: number
  s: number
}

/** The wall clock in `tz` at instant `t`. */
export function wallClock(t: number, tz: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(t))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? NaN)
  const h = get('hour')
  return { y: get('year'), m: get('month'), d: get('day'), h: h === 24 ? 0 : h, min: get('minute'), s: get('second') }
}

/** UTC offset of `tz` at instant `t` (wall clock − UTC), in ms. */
function offsetAt(t: number, tz: string): number {
  const w = wallClock(t, tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000
}

/**
 * The instant of a wall-clock time in `tz`. Skipped by DST → the instant after the jump (02:30 → 03:30);
 * twice by DST → the first occurrence.
 */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const local = Date.UTC(y, m - 1, d, h, min)
  const before = offsetAt(local - 2 * DAY, tz)
  const after = offsetAt(local + 2 * DAY, tz)
  const fits = [local - before, local - after].filter((t) => t + offsetAt(t, tz) === local)
  return fits.length ? Math.min(...fits) : local - before
}

/** "HH:mm" → [hours, minutes], or null. */
export function parseAt(at: unknown): [number, number] | null {
  const m = typeof at === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(at.trim()) : null
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 23 && min <= 59 ? [h, min] : null
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

function dayMatches(tr: ScheduleTrigger, y: number, m: number, d: number, dow: number): boolean {
  switch (tr.every) {
    case 'day':
      return true
    case 'weekday':
      return dow >= 1 && dow <= 5
    case 'week':
      return dow === (tr.weekday ?? 1)
    case 'month':
      return d === Math.min(tr.day ?? 1, daysIn(y, m))
    default:
      return false
  }
}

/** The latest slot of the schedule at or before `now` (ms), or null (none in the last two months). */
export function slotAt(tr: ScheduleTrigger, now: number): number | null {
  const at = parseAt(tr.at)
  if (!at) return null
  const [hh, mm] = at
  if (tr.every === 'hour') {
    // UTC offsets are whole minutes: local minute boundaries are UTC minute boundaries
    const w = wallClock(now, tr.tz)
    const back = (((w.min - mm) % 60) + 60) % 60
    return now - (now % MINUTE) - back * MINUTE
  }
  const w = wallClock(now, tr.tz)
  for (let k = 0; k <= 62; k++) {
    const date = new Date(Date.UTC(w.y, w.m - 1, w.d - k))
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()
    if (!dayMatches(tr, y, m, d, date.getUTCDay())) continue
    const t = zonedTime(y, m, d, hh, mm, tr.tz)
    if (t <= now) return t
  }
  return null
}

/** Names the schedule (what makes its slots): a changed schedule starts over instead of catching up. */
export function scheduleSig(tr: ScheduleTrigger): string {
  const key = JSON.stringify([tr.every, tr.at, tr.every === 'week' ? (tr.weekday ?? 1) : null, tr.every === 'month' ? (tr.day ?? 1) : null, tr.tz])
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export interface SlotState {
  lastSlot: number
  sig: string
  seenAt: number
}

/**
 * What to do with the current slot:
 * - 'run'  — it fires now (and is recorded first, so it never fires twice);
 * - 'mark' — it is recorded without running: it lies before the runtime was switched on, or before the
 *            agent was created / changed (a new or edited agent never fires a slot that already passed);
 * - 'none' — nothing to do (no slot, or this slot was handled already).
 */
export function decideSlot(input: { slot: number | null; state: SlotState | undefined; sig: string; agentUpdatedAt: number; enabledAt: number }): 'run' | 'mark' | 'none' {
  const { slot, state, sig } = input
  if (slot === null) return 'none'
  const same = !!state && state.sig === sig
  if (same && slot <= state.lastSlot) return 'none'
  const fresh = !same || input.agentUpdatedAt > state.seenAt
  const notBefore = Math.max(input.enabledAt, fresh ? input.agentUpdatedAt : -Infinity)
  return slot > notBefore ? 'run' : 'mark'
}

/** "daily 08:00 Europe/Berlin" — how a slot shows as a run's trigger detail. */
export function describeSchedule(tr: ScheduleTrigger): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const when =
    tr.every === 'hour'
      ? `hourly at :${tr.at.slice(-2)}`
      : tr.every === 'day'
        ? `daily ${tr.at}`
        : tr.every === 'weekday'
          ? `weekdays ${tr.at}`
          : tr.every === 'week'
            ? `weekly ${DAYS[tr.weekday ?? 1]} ${tr.at}`
            : `monthly on day ${tr.day ?? 1} ${tr.at}`
  return `${when} ${tr.tz}`
}
