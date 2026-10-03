/**
 * Recurring templates — schedule math (pure: no store, no DOM).
 *
 * Everything is local wall-clock time: an occurrence is "2026-10-12T08:00" wherever the device is,
 * and that string (not the instant) identifies it — two devices in different time zones agree on
 * which occurrence a row belongs to. Days are walked as calendar day numbers (UTC based), so DST
 * switches never skip or double a day.
 */
import { getISOWeek } from 'date-fns'
import type { Lang } from '@/shared/i18n'
import type { ID, TemplateRepeat } from '../../store/types'

export type RepeatFreq = TemplateRepeat['freq']

export const REPEAT_FREQS: RepeatFreq[] = ['daily', 'weekdays', 'weekly', 'monthly', 'interval']
export const DEFAULT_REPEAT_TIME = '08:00'
export const DEFAULT_REPEAT_TITLE = '{{name}} — {{date}}'
/** Variables a row title (and text in the template content) may use. */
export const REPEAT_VARIABLES = ['{{date}}', '{{weekday}}', '{{week}}', '{{time}}', '{{name}}'] as const
/** A catch-up creates at most this many of the most recent missed occurrences. */
export const MAX_CATCH_UP = 3

/** Longest stretch scanned for missed occurrences or searched for the next one (days). */
const HORIZON_DAYS = 3700
const DAY_MS = 86_400_000

export interface Occurrence {
  /** The instant (ms) on this device. */
  at: number
  /** Identity: local wall time "YYYY-MM-DDTHH:MM". */
  wall: string
  /** "YYYY-MM-DD" — what a date property is preset to. */
  day: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" of a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Ymd = [number, number, number]

function parseDay(s: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const y = +m[1]
  const mo = +m[2] - 1
  const d = +m[3]
  return mo >= 0 && mo < 12 && d >= 1 && d <= 31 ? [y, mo, d] : null
}

export function parseTime(s: string | null | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '')
  if (!m) return [8, 0]
  return [Math.min(23, +m[1]), Math.min(59, +m[2])]
}

/** Calendar day number (days since 1970-01-01, no DST). */
const dayNum = ([y, m, d]: Ymd) => Math.floor(Date.UTC(y, m, d) / DAY_MS)
const fromDayNum = (n: number): Ymd => {
  const d = new Date(n * DAY_MS)
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
}
const localDayNum = (ms: number) => {
  const d = new Date(ms)
  return dayNum([d.getFullYear(), d.getMonth(), d.getDate()])
}
/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
const weekdayOf = (n: number) => (((n + 4) % 7) + 7) % 7

/** weekly: the chosen days (falls back to the start day's weekday). */
export function weeklyDays(r: TemplateRepeat): number[] {
  const days = (r.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (days.length) return days
  const s = parseDay(r.start)
  return s ? [weekdayOf(dayNum(s))] : [1]
}

export function clampEvery(n: number | undefined): number {
  return Math.min(365, Math.max(1, Math.round(n ?? 2) || 1))
}

export function clampDayOfMonth(n: number | undefined, fallback = 1): number {
  return Math.min(31, Math.max(1, Math.round(n ?? fallback) || 1))
}

function matcher(r: TemplateRepeat, startNum: number): (n: number) => boolean {
  switch (r.freq) {
    case 'daily':
      return () => true
    case 'weekdays':
      return (n) => {
        const wd = weekdayOf(n)
        return wd >= 1 && wd <= 5
      }
    case 'weekly': {
      const days = new Set(weeklyDays(r))
      return (n) => days.has(weekdayOf(n))
    }
    case 'monthly': {
      const dom = clampDayOfMonth(r.dayOfMonth, fromDayNum(startNum)[2])
      return (n) => {
        const [y, m, d] = fromDayNum(n)
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
        return d === Math.min(dom, last)
      }
    }
    case 'interval': {
      const every = clampEvery(r.every)
      return (n) => (n - startNum) % every === 0
    }
    default:
      return () => false
  }
}

/** Walk the occurrences of `r` on the days fromNum…toNum (inclusive, already clipped to start/end). */
function* walk(r: TemplateRepeat, fromNum: number, toNum: number): Generator<Occurrence> {
  const start = parseDay(r.start)
  if (!start) return
  const startNum = dayNum(start)
  const end = parseDay(r.end)
  const first = Math.max(fromNum, startNum)
  const last = Math.min(toNum, end ? dayNum(end) : Infinity)
  const hits = matcher(r, startNum)
  const [hh, mm] = parseTime(r.time)
  for (let n = first; n <= last; n++) {
    if (!hits(n)) continue
    const [y, m, d] = fromDayNum(n)
    const day = `${y}-${pad(m + 1)}-${pad(d)}`
    yield { at: new Date(y, m, d, hh, mm).getTime(), wall: `${day}T${pad(hh)}:${pad(mm)}`, day }
  }
}

/** Occurrences with after < at ≤ until, oldest first. */
export function occurrencesBetween(r: TemplateRepeat, after: number, until: number): Occurrence[] {
  if (!(until > after)) return []
  const to = localDayNum(until)
  const from = Math.max(localDayNum(after), to - HORIZON_DAYS)
  const out: Occurrence[] = []
  for (const o of walk(r, from, to)) if (o.at > after && o.at <= until) out.push(o)
  return out
}

/** The next `count` occurrences strictly after `after`. */
export function upcoming(r: TemplateRepeat, after: number, count = 1): Occurrence[] {
  const from = localDayNum(after)
  const out: Occurrence[] = []
  for (const o of walk(r, from, from + HORIZON_DAYS)) {
    if (o.at <= after) continue
    out.push(o)
    if (out.length >= count) break
  }
  return out
}

/** The next run of a template's repeat as seen now: after max(now, lastRunAt). Null = no further runs. */
export function nextRun(r: TemplateRepeat | null | undefined, now = Date.now()): Occurrence | null {
  if (!r) return null
  return upcoming(r, Math.max(now, r.lastRunAt ?? now), 1)[0] ?? null
}

/** Did the schedule itself change (not just the title / date property)? Then missed runs restart from now. */
export function scheduleChanged(a: TemplateRepeat | null | undefined, b: TemplateRepeat | null | undefined): boolean {
  if (!a || !b) return a !== b
  const key = (r: TemplateRepeat) =>
    JSON.stringify([
      r.freq,
      r.freq === 'weekly' ? [...weeklyDays(r)].sort() : null,
      r.freq === 'monthly' ? clampDayOfMonth(r.dayOfMonth) : null,
      r.freq === 'interval' ? clampEvery(r.every) : null,
      parseTime(r.time),
      r.start,
      r.end ?? null,
    ])
  return key(a) !== key(b)
}

/** A sensible first schedule: weekly on today's weekday at 08:00, starting today. */
export function defaultRepeat(today: Date, dateProperty: ID | null): TemplateRepeat {
  return {
    freq: 'weekly',
    days: [today.getDay()],
    dayOfMonth: today.getDate(),
    every: 2,
    time: DEFAULT_REPEAT_TIME,
    start: dayKey(today),
    end: null,
    title: DEFAULT_REPEAT_TITLE,
    dateProperty,
  }
}

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

/** cyrb53 — a fast 53-bit string hash (public domain). */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Same alphabet as lib/ids (newId). */
const ALPHABET = '0123456789abcdefghijkmnopqrstuvwxyz'
function encode(n: number, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out = ALPHABET[n % ALPHABET.length] + out
    n = Math.floor(n / ALPHABET.length)
  }
  return out
}

/**
 * The row id of an occurrence: deterministic in (database, template, wall time), shaped like any
 * other id. Every tab and device derives the same id, so an occurrence can only ever exist once.
 */
export function occurrenceRowId(dbId: ID, templateId: ID, wall: string): ID {
  const key = `recurring|${dbId}|${templateId}|${wall}`
  return encode(cyrb53(key, 1), 6) + encode(cyrb53(key, 2), 6)
}

/* ------------------------------------------------------------------ */
/* Text: variables + labels                                            */
/* ------------------------------------------------------------------ */

const locale = (lang: Lang) => (lang === 'de' ? 'de-DE' : 'en-GB')

/** "Mon 12 Oct" / "Mo. 12. Okt." (+ the year when it isn't this year's) — same shape in every ICU build. */
export function formatDay(d: Date, lang: Lang, now = new Date()): string {
  const part = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat(locale(lang), opts).formatToParts(d).find((p) => p.type === type)?.value ?? ''
  const wd = part({ weekday: 'short' }, 'weekday')
  const mon = part({ month: 'short', day: 'numeric' }, 'month')
  const day = d.getDate()
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''
  return lang === 'de' ? `${wd} ${day}. ${mon}${year}` : `${wd} ${day} ${mon}${year}`
}

/** "08:00" (24 h in both languages, like the time input). */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "Mon 12 Oct, 08:00" — the next-run label. */
export function formatRun(at: number, lang: Lang, now = new Date()): string {
  const d = new Date(at)
  return `${formatDay(d, lang, now)}, ${formatTime(d)}`
}

/** Short weekday names Monday-first: [[0..6 index, "Mo"], …] — for the weekly day keys. */
export function weekdayKeys(lang: Lang): Array<{ day: number; short: string; long: string }> {
  const base = new Date(2024, 0, 1) // a Monday
  return [1, 2, 3, 4, 5, 6, 0].map((day, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    const short = new Intl.DateTimeFormat(locale(lang), { weekday: 'short' }).format(d).replace(/\.$/, '').slice(0, 2)
    return { day, short, long: new Intl.DateTimeFormat(locale(lang), { weekday: 'long' }).format(d) }
  })
}

export interface FillVars {
  /** the template's name */
  name: string
  lang: Lang
}

/** Fill {{date}} {{weekday}} {{week}} {{month}} {{year}} {{time}} {{iso}} {{name}}; unknown ones stay. */
export function fillRepeatVars(text: string, at: Date, vars: FillVars): string {
  if (!text.includes('{{')) return text
  const loc = locale(vars.lang)
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => {
    switch (key.toLowerCase()) {
      case 'date':
        // titles keep their shape across the year boundary: no year (use {{year}})
        return formatDay(at, vars.lang, at)
      case 'weekday':
        return new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(at)
      case 'week':
        return String(getISOWeek(at))
      case 'month':
        return new Intl.DateTimeFormat(loc, { month: 'long' }).format(at)
      case 'year':
        return String(at.getFullYear())
      case 'time':
        return formatTime(at)
      case 'iso':
        return dayKey(at)
      case 'name':
        return vars.name
      default:
        return all
    }
  })
}
