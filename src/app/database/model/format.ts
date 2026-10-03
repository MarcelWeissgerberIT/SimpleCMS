/**
 * Formatting helpers: numbers (formats), dates (locale-aware, relative), ISO helpers.
 */
import { addDays, addYears, differenceInCalendarDays, format, isValid, parse, parseISO, startOfDay } from 'date-fns'
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

/** Fraction digits needed to write a tick step exactly (5000 → 0, 2.5 → 1, 0.25 → 2), capped at 4. */
export function stepDecimals(step: number): number {
  for (let d = 0; d < 4; d++) if (Number.isInteger(Number((step * 10 ** d).toPrecision(10)))) return d
  return 4
}

/**
 * One formatter for every tick of a chart axis — same unit, same fraction digits — so the zero
 * tick can never read "0,00 €" next to "10.000". Digits follow the step, not the value: currency
 * axes drop the cents on whole-number steps ("0 € · 10.000 €"), percent axes show whole percents
 * on 10 % steps, plain numbers keep the cell style (no grouping, dot decimal).
 */
export function axisFormatter(step: number, fmt: NumberFormat | undefined, lang: Lang): (v: number) => string {
  const d = stepDecimals(step)
  const fixed = (digits: number): Intl.NumberFormatOptions => ({ minimumFractionDigits: digits, maximumFractionDigits: digits })
  const clean = (v: number) => (Math.abs(v) < step * 1e-6 ? 0 : v) // float drift: 3 × 0.1 must still read "0.3", -0 must read "0"
  switch (fmt) {
    case 'percent': {
      const f = nf(lang, { style: 'percent', ...fixed(Math.max(0, d - 2)) })
      return (v) => f.format(clean(v))
    }
    case 'euro':
    case 'dollar':
    case 'pound': {
      const currency = fmt === 'euro' ? 'EUR' : fmt === 'dollar' ? 'USD' : 'GBP'
      const f = nf(lang, { style: 'currency', currency, ...fixed(d === 0 ? 0 : Math.max(2, d)) })
      return (v) => f.format(clean(v))
    }
    case 'comma': {
      const f = nf(lang, fixed(d))
      return (v) => f.format(clean(v))
    }
    default:
      return (v) => clean(v).toFixed(d)
  }
}

/** Ratio 0..1 for bar / ring display: percent values are fractions (0.5 = 50 %), others are divided by 100. */
export function numberRatio(n: number | null | undefined, fmt?: NumberFormat): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, fmt === 'percent' ? n : n / 100))
}

/**
 * Read a typed / pasted number the way the UI language writes numbers:
 *  de: "1.500" = 1500, "2,5" = 2.5, "1.234,56" = 1234.56
 *  en: "1,500" = 1500, "2.5" = 2.5, "1,234.56" = 1234.56
 * With both marks present the last one is the decimal mark (either language). A lone mark that
 * can't be a thousands separator ("2.5" in de, "2,5" in en) is read as a decimal mark.
 */
export function parseNumberText(s: string, percent: boolean, lang: string): number | null {
  const clean = s.trim().replace(/[\s\u00a0\u202f']/g, '').replace(/[€$£%]/g, '')
  if (!clean) return null
  const group = lang === 'de' ? '.' : ','
  const decimal = lang === 'de' ? ',' : '.'
  let norm: string
  if (clean.includes('.') && clean.includes(',')) {
    const dec = clean.lastIndexOf(',') > clean.lastIndexOf('.') ? ',' : '.'
    norm = clean.split(dec === ',' ? '.' : ',').join('').replace(dec, '.')
  } else if (clean.includes(group) && new RegExp(`^[-+]?[1-9]\\d{0,2}(\\${group}\\d{3})+$`).test(clean)) {
    norm = clean.split(group).join('')
  } else norm = clean.replace(decimal, '.').replace(group, '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(norm)) return null
  const n = Number(norm)
  if (!Number.isFinite(n)) return null
  // percent fields store fractions (like Notion): what you type is what you see — "75" / "75%" → 0.75
  return percent ? n / 100 : n
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

const REL_WORDS: Record<string, number> = { today: 0, heute: 0, tomorrow: 1, morgen: 1, yesterday: -1, gestern: -1 }

/** One side of a typed / pasted date: "Sep 22, 2026", "22.09.2026", "today 9:30", "2026-09-22T09:30". */
function parseDatePart(text: string, lang: Lang): { d: Date; time: boolean } | null {
  let s = text.trim().replace(/,$/, '')
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = parseISO(s)
    return isValid(d) ? { d, time: /T\d{2}:\d{2}/.test(s) } : null
  }
  let hh: number | null = null
  let mm = 0
  const tm = /^(.*?)[,\s]+(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?(?:\s*uhr)?$/i.exec(s)
  if (tm) {
    s = tm[1].trim().replace(/,$/, '')
    hh = Number(tm[2]) % 24
    mm = Number(tm[3])
    const ap = tm[4]?.toLowerCase()
    if (ap === 'p' && hh < 12) hh += 12
    if (ap === 'a' && hh === 12) hh = 0
  }
  const rel = REL_WORDS[s.toLowerCase()]
  const d = rel !== undefined ? addDays(startOfDay(new Date()), rel) : (parseTypedDate(s, lang) ?? parseTypedDate(s, lang === 'de' ? 'en' : 'de'))
  if (!d) return null
  if (hh !== null) d.setHours(hh, mm, 0, 0)
  return { d, time: hh !== null }
}

/**
 * A date (or range) written as text — typed, pasted, or a converted text column: one date, or two
 * joined by "→", " – ", " - " or an ISO interval "/". Accepts both UI languages.
 */
export function parseDateText(text: string, lang: Lang): DateValue | null {
  const s = text.trim()
  if (!s) return null
  const parts = /^\d{4}-\d{2}-\d{2}\S*\/\d{4}-\d{2}-\d{2}\S*$/.test(s) ? s.split('/') : s.split(/\s*→\s*|\s+[–—-]\s+/)
  if (parts.length > 2) return null
  const a = parseDatePart(parts[0], lang)
  if (!a) return null
  const b = parts[1] !== undefined ? parseDatePart(parts[1], lang) : null
  if (parts[1] !== undefined && !b) return null
  const time = a.time || !!b?.time
  let end = b?.d ?? null
  // "Dec 20 → Jan 5": a year-less end before the start belongs to the next year
  if (end && end < a.d && !/\d{4}/.test(parts[1] ?? '')) end = addYears(end, 1)
  return { start: isoWithTime(a.d, time), end: end ? isoWithTime(end, time) : null, ...(time ? { includeTime: true } : {}) }
}

/** A date value as full, unambiguous text (always with the year) that parseDateText reads back. */
export function dateValueText(v: DateValue, lang: Lang): string {
  const pattern = (lang === 'de' ? 'd. MMM yyyy' : 'MMM d, yyyy') + (v.includeTime ? (lang === 'de' ? ' HH:mm' : ' h:mm a') : '')
  const one = (iso: string) => {
    const d = parseLocal(iso)
    return d ? format(d, pattern, { locale: dfLocale(lang) }) : ''
  }
  return v.end ? `${one(v.start)} → ${one(v.end)}` : one(v.start)
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
