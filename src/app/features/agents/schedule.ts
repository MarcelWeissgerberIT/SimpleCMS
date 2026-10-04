/**
 * Custom agents — schedules (pure). A schedule is wall-clock time in an IANA time zone ("08:00 in
 * Europe/Berlin"), so every device means the same moment. `latestSlot` is the newest due time at or
 * before now (missed slots collapse into it: a run once, never one per missed slot), `nextSlot` the
 * next one after now.
 */
import type { AgentTrigger } from '../../store/types'

export type Schedule = Extract<AgentTrigger, { type: 'schedule' }>

interface Wall {
  y: number
  m: number
  d: number
  h: number
  mi: number
}

const formats = new Map<string, Intl.DateTimeFormat>()
function formatIn(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    formats.set(tz, f)
  }
  return f
}

/** The wall clock in `tz` at the instant `ms`. */
export function wallIn(ms: number, tz: string): Wall {
  const out: Record<string, number> = {}
  for (const p of formatIn(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute }
}

/** How far the wall clock in `tz` is ahead of UTC at `ms` (minutes precision). */
function offsetAt(ms: number, tz: string): number {
  const w = wallIn(ms, tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000
}

/** The instant the wall clock in `tz` shows y-m-d h:mi (a time skipped by a DST change moves forward). */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const first = guess - offsetAt(guess, tz)
  return guess - offsetAt(first, tz)
}

function hm(at: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at)
  if (!m) return [8, 0]
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))]
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Does the calendar day y-m-d carry a slot? */
function onDay(s: Schedule, y: number, m: number, d: number): boolean {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  switch (s.every) {
    case 'weekday':
      return wd >= 1 && wd <= 5
    case 'week':
      return wd === (s.weekday ?? 1)
    case 'month':
      return d === Math.min(s.day ?? 1, daysIn(y, m))
    default:
      return true
  }
}

/** The calendar day `offset` days from y-m-d. */
function shift(y: number, m: number, d: number, offset: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + offset))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** The newest slot at or before `now` (null: none within the last 40 days). */
export function latestSlot(s: Schedule, now: number): number | null {
  const [h, mi] = hm(s.at)
  const w = wallIn(now, s.tz)
  if (s.every === 'hour') {
    let t = zonedTime(w.y, w.m, w.d, w.h, mi, s.tz)
    if (t > now) t -= 3_600_000
    return t
  }
  for (let i = 0; i <= 40; i++) {
    const day = shift(w.y, w.m, w.d, -i)
    if (!onDay(s, day.y, day.m, day.d)) continue
    const t = zonedTime(day.y, day.m, day.d, h, mi, s.tz)
    if (t <= now) return t
  }
  return null
}

/** The first slot after `now` (null: none within the next 40 days). */
export function nextSlot(s: Schedule, now: number): number | null {
  const [h, mi] = hm(s.at)
  const w = wallIn(now, s.tz)
  if (s.every === 'hour') {
    let t = zonedTime(w.y, w.m, w.d, w.h, mi, s.tz)
    if (t <= now) t += 3_600_000
    return t
  }
  for (let i = 0; i <= 40; i++) {
    const day = shift(w.y, w.m, w.d, i)
    if (!onDay(s, day.y, day.m, day.d)) continue
    const t = zonedTime(day.y, day.m, day.d, h, mi, s.tz)
    if (t > now) return t
  }
  return null
}
