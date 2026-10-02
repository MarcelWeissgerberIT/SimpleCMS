/**
 * Formatting helpers: numbers (formats), dates (locale-aware, relative), ISO helpers.
 */
import { addDays, differenceInCalendarDays, format, isValid, parse, parseISO } from 'date-fns'
import { de as deLocale, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'
import type { DateValue, NumberFormat } from '../../store/types'

export const dfLocale = (lang: Lang) => (lang === 'de' ? deLocale : enUS)
export const weekStartsOn = (lang: Lang): 0 | 1 => (lang === 'de' ? 1 : 0)
const intlLocale = (lang: Lang) => (lang === 'de' ? 'de-DE' : 'en-US')

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(lang: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = lang + JSON.stringify(opts)
  let f = nfCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(lang), opts)
    nfCache.set(key, f)
  }
  return f
}

export function formatNumber(n: number | null | undefined, fmt: NumberFormat | undefined, lang: Lang): string {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  switch (fmt) {
    case 'comma':
      return nf(lang, { maximumFractionDigits: 6 }).format(n)
    case 'percent':
      // Notion semantics: 0.5 → 50 %
      return nf(lang, { style: 'percent', maximumFractionDigits: 2 }).format(n)
    case 'euro':
      return nf(lang, { style: 'currency', currency: 'EUR' }).format(n)
    case 'dollar':
      return nf(lang, { style: 'currency', currency: 'USD' }).format(n)
    case 'pound':
      return nf(lang, { style: 'currency', currency: 'GBP' }).format(n)
    default:
      return String(Number(n.toPrecision(12)))
  }
}

/** Plain grouped number for readouts (counts, calc results). */
export function formatCount(n: number, lang: Lang, digits = 2): string {
  return nf(lang, { maximumFractionDigits: digits }).format(n)
}

/** Ratio 0..1 for bar / ring display: percent values are fractions (0.5 = 50 %), others are divided by 100. */
export function numberRatio(n: number | null | undefined, fmt?: NumberFormat): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, fmt === 'percent' ? n : n / 100))
}

/* ---------------- Dates ---------------- */

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** Parse "2026-10-02" / "2026-10-02T14:30" as local time. */
export function parseLocal(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = parseISO(s)
  return isValid(d) ? d : null
}

export function dateValueStart(v: DateValue | null | undefined): Date | null {
  return v ? parseLocal(v.start) : null
}

export function dateValueEnd(v: DateValue | null | undefined): Date | null {
  return v?.end ? parseLocal(v.end) : null
}

export function isDateValue(v: unknown): v is DateValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'
}

/** "Today", "Tomorrow", "Yesterday" or a short locale date. */
export function formatDay(d: Date, lang: Lang, labels: { today: string; tomorrow: string; yesterday: string }, relative = true): string {
  if (relative) {
    const diff = differenceInCalendarDays(d, new Date())
    if (diff === 0) return labels.today
    if (diff === 1) return labels.tomorrow
    if (diff === -1) return labels.yesterday
  }
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return format(d, sameYear ? (lang === 'de' ? 'd. MMM' : 'MMM d') : lang === 'de' ? 'd. MMM yyyy' : 'MMM d, yyyy', { locale: dfLocale(lang) })
}

export function formatTime(d: Date, lang: Lang): string {
  return format(d, lang === 'de' ? 'HH:mm' : 'h:mm a', { locale: dfLocale(lang) })
}

export function formatDateValue(
  v: DateValue | null | undefined,
  lang: Lang,
  labels: { today: string; tomorrow: string; yesterday: string },
  relative = true,
): string {
  const s = dateValueStart(v)
  if (!s || !v) return ''
  let out = formatDay(s, lang, labels, relative)
  if (v.includeTime) out += ' ' + formatTime(s, lang)
  const e = dateValueEnd(v)
  if (e) {
    out += ' → ' + formatDay(e, lang, labels, relative)
    if (v.includeTime) out += ' ' + formatTime(e, lang)
  }
  return out
}

export function formatTimestamp(ms: number, lang: Lang): string {
  return format(new Date(ms), lang === 'de' ? 'd. MMM yyyy, HH:mm' : 'MMM d, yyyy, h:mm a', { locale: dfLocale(lang) })
}

/** Parse what a user typed into a date field (several formats). */
export function parseTypedDate(text: string, lang: Lang): Date | null {
  const s = text.trim()
  if (!s) return null
  const iso = parseISO(s)
  if (isValid(iso) && /^\d{4}-\d{2}-\d{2}/.test(s)) return iso
  const patterns = lang === 'de' ? ['d.M.yyyy', 'd.M.yy', 'd.M.', 'd. MMM yyyy', 'd. MMMM yyyy', 'd. MMM'] : ['M/d/yyyy', 'M/d/yy', 'MMM d, yyyy', 'MMMM d, yyyy', 'MMM d', 'd MMM yyyy']
  for (const p of patterns) {
    const d = parse(s, p, new Date(), { locale: dfLocale(lang) })
    if (isValid(d)) return d
  }
  return null
}

/** Shift a DateValue by n days (keeps time + range length). */
export function shiftDateValue(v: DateValue, days: number): DateValue {
  const s = parseLocal(v.start)
  if (!s) return v
  const fmtOf = (d: Date) => (v.includeTime ? format(d, "yyyy-MM-dd'T'HH:mm") : format(d, 'yyyy-MM-dd'))
  const e = v.end ? parseLocal(v.end) : null
  return { ...v, start: fmtOf(addDays(s, days)), end: e ? fmtOf(addDays(e, days)) : v.end ?? null }
}

export function isoWithTime(d: Date, withTime: boolean): string {
  return withTime ? format(d, "yyyy-MM-dd'T'HH:mm") : format(d, 'yyyy-MM-dd')
}
