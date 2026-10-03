/** Agenda read-outs: mono day stamps, times, period titles. */
import { format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'
import { dayToDate } from './model'

const loc = (lang: Lang) => (lang === 'de' ? de : enUS)
const undot = (s: string) => s.replace(/\./g, '')

/** First day of the week: Monday in German, Sunday in English (same as the database calendar). */
export const weekStart = (lang: Lang): 0 | 1 => (lang === 'de' ? 1 : 0)

/** "FRI 09 OCT" / "FR 09 OKT" */
export function fmtDayStamp(day: number, lang: Lang): string {
  const d = dayToDate(day)
  return undot(format(d, lang === 'de' ? 'EEEEEE dd MMM' : 'EEE dd MMM', { locale: loc(lang) })).toUpperCase()
}

/** "09 OCT" */
export function fmtShortDay(day: number, lang: Lang): string {
  return undot(format(dayToDate(day), 'dd MMM', { locale: loc(lang) })).toUpperCase()
}

/** Weekday column head: "MON" / "MO" (narrow: "M") */
export function fmtWeekday(day: number, lang: Lang, narrow = false): string {
  return undot(format(dayToDate(day), narrow ? 'EEEEE' : lang === 'de' ? 'EEEEEE' : 'EEE', { locale: loc(lang) })).toUpperCase()
}

/** "14:30" → "2:30 PM" (en) / "14:30" (de) */
export function fmtTime(hhmm: string, lang: Lang): string {
  if (lang === 'de') return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}

/** Hour label in the week grid: "9am" / "09" */
export function fmtHour(h: number, lang: Lang): string {
  if (lang === 'de') return String(h).padStart(2, '0')
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
}

/** "October" */
export function fmtMonth(day: number, lang: Lang): string {
  return format(dayToDate(day), 'LLLL', { locale: loc(lang) })
}

export function fmtYear(day: number): string {
  return format(dayToDate(day), 'yyyy')
}

export function isoWeekOf(day: number): number {
  return Number(format(dayToDate(day), 'I'))
}
