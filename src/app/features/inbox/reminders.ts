/**
 * Reminder codes — the one definition (date mentions `attrs.reminder`, DateValue.reminder).
 *
 * A code is relative to the date it belongs to:
 *   'at'                 at the time of the event; a date without a time: on the day at 09:00
 *   '-<n><m|h|d|w>'      n minutes / hours / days / weeks before; a date without a time counts
 *                        from 09:00 of that day ("-1d" = the day before at 09:00)
 * Dates are local wall-clock strings: "2026-10-05" or "2026-10-05T14:30" (no time zone).
 * Anything else (null, '', junk) means "no reminder".
 */
import { addMinutes, addHours, addDays, addWeeks, format, isValid } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'

export type ReminderUnit = 'm' | 'h' | 'd' | 'w'

export interface ParsedReminder {
  /** how far before the base time (0 = at it) */
  n: number
  unit: ReminderUnit
}

/** Reminders of a date WITH a time, in menu order. */
export const TIMED_REMINDERS = ['at', '-5m', '-10m', '-15m', '-30m', '-1h', '-2h', '-1d', '-2d', '-1w'] as const
/** Reminders of a date WITHOUT a time (base: 09:00 on the day), in menu order. */
export const DAY_REMINDERS = ['at', '-1d', '-2d', '-1w'] as const
/** The hour an all-day date reminds at. */
export const DAY_REMINDER_HOUR = 9

const CODE = /^-(\d{1,3})(m|h|d|w)$/

export function parseReminder(code: unknown): ParsedReminder | null {
  if (code === 'at') return { n: 0, unit: 'm' }
  if (typeof code !== 'string') return null
  const m = CODE.exec(code)
  if (!m) return null
  const n = Number(m[1])
  if (!n) return { n: 0, unit: 'm' }
  return { n, unit: m[2] as ReminderUnit }
}

export function isReminderCode(code: unknown): code is string {
  return parseReminder(code) !== null
}

/** A valid code or null (for reading attrs / property values written by anyone). */
export function normalizeReminder(code: unknown): string | null {
  return isReminderCode(code) ? code : null
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/

/** Does a stored date string carry a time ("…T14:30")? */
export function hasTime(iso: string): boolean {
  return !!ISO.exec(iso)?.[4]
}

/** Local Date of a stored date string (all-day dates: midnight), or null. */
export function parseIsoLocal(iso: string | null | undefined): Date | null {
  const m = iso ? ISO.exec(iso) : null
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0)
  return isValid(d) ? d : null
}

/** When a reminder fires (ms), or null for a missing / invalid date or code. */
export function reminderDueAt(iso: string | null | undefined, code: unknown): number | null {
  const r = parseReminder(code)
  const base = parseIsoLocal(iso)
  if (!r || !base) return null
  if (!hasTime(iso!)) base.setHours(DAY_REMINDER_HOUR, 0, 0, 0)
  const back = -r.n
  const due = r.unit === 'm' ? addMinutes(base, back) : r.unit === 'h' ? addHours(base, back) : r.unit === 'd' ? addDays(base, back) : addWeeks(base, back)
  return due.getTime()
}

/** The codes a menu offers for a date (with / without time); an unusual current code stays listed. */
export function reminderOptions(timed: boolean, current?: string | null): string[] {
  const list: string[] = [...(timed ? TIMED_REMINDERS : DAY_REMINDERS)]
  if (current && isReminderCode(current) && !list.includes(current)) list.push(current)
  return list
}

type T = (key: string, vars?: Record<string, string | number>) => string

/**
 * "15 minutes before" / "On the day (09:00)" … `timed`: the date has a time.
 * Keys: inbox.remind.* (features/inbox/messages.ts).
 */
export function reminderLabel(code: string | null | undefined, timed: boolean, t: T): string {
  const r = parseReminder(code)
  if (!r) return t('inbox.remind.none')
  const at = `${String(DAY_REMINDER_HOUR).padStart(2, '0')}:00`
  if (r.n === 0) return timed ? t('inbox.remind.at') : t('inbox.remind.onDay', { time: at })
  const unit = { m: 'min', h: 'hour', d: 'day', w: 'week' }[r.unit]
  const text = t(`inbox.remind.${unit}${r.n === 1 ? '.one' : ''}`, { n: r.n })
  // minutes / hours before an all-day date count from 09:00 too — say so
  return timed ? text : t('inbox.remind.dayAt', { text, time: at })
}

/** "Mon 5 Oct, 09:00" — when a reminder fires, in the plate style of the app. */
export function formatDue(ms: number, lang: Lang): string {
  return format(ms, lang === 'de' ? 'EEE d. MMM, HH:mm' : 'EEE d MMM, HH:mm', { locale: lang === 'de' ? de : enUS })
}
