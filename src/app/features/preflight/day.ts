/**
 * The Preflight day (pure): a day begins at the set time (default 07:00), so 06:30 still belongs to yesterday. Local
 * wall-clock arithmetic throughout (never "now − 7 h" in milliseconds), so a daylight-saving switch moves nothing.
 */

export const DEFAULT_AT = '07:00'

/** 'HH:mm' → minutes after midnight (null: not a time). */
export function parseAt(at: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The Preflight day of `now` (yyyy-MM-dd): the local date, one day earlier before the set time. */
export function preflightDay(now: number, at: string = DEFAULT_AT): string {
  const start = parseAt(at) ?? parseAt(DEFAULT_AT)!
  const d = new Date(now)
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (minutes < start) return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1))
  return dateKey(d)
}

/** When the next Preflight day begins (ms): today at the set time when that is still ahead, else tomorrow. */
export function nextOpenAt(now: number, at: string = DEFAULT_AT): number {
  const start = parseAt(at) ?? parseAt(DEFAULT_AT)!
  const d = new Date(now)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(start / 60), start % 60).getTime()
  if (today > now) return today
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, Math.floor(start / 60), start % 60).getTime()
}

/** Monday–Friday dates from the day of `from` (exclusive) to the day of `to` (inclusive), local time. */
export function workingDaysBetween(from: number, to: number): number {
  if (!(to > from)) return 0
  const a = new Date(from)
  const b = new Date(to)
  let d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1)
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  let n = 0
  for (let i = 0; i < 400 && d.getTime() <= end; i++) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) n++
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
  return n
}
