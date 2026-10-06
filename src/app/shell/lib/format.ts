import { formatDistanceToNowStrict, format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'

export function wordCount(text: string | undefined | null): number {
  if (!text) return 0
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}

/**
 * Reading time at ~220 wpm as a read-out: "—" for an empty page (there is nothing to
 * read, "0 min" would be a false reading), "<1" under a minute, else whole minutes.
 */
export function readingTime(words: number): string {
  if (words <= 0) return '—'
  const min = words / 220
  return min < 1 ? '<1' : String(Math.round(min))
}

/** One formatter per language: toLocaleString() builds a new one per call (the status bar formats on every save). */
const numberFormats = new Map<Lang, Intl.NumberFormat>()

export function fmtNumber(n: number, lang: Lang): string {
  let f = numberFormats.get(lang)
  if (!f) numberFormats.set(lang, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US')))
  return f.format(n)
}

const locale = (lang: Lang) => (lang === 'de' ? de : enUS)

/** "3 min ago" / "vor 3 Minuten"; "just now" under 45 s. */
export function fmtRelative(ts: number, lang: Lang, justNow: string): string {
  if (Date.now() - ts < 45_000) return justNow
  return formatDistanceToNowStrict(ts, { addSuffix: true, locale: locale(lang) })
}

/** "02 OCT 2026 · 14:02" — mono spec-plate style. */
export function fmtStamp(ts: number, lang: Lang): string {
  return format(ts, 'dd MMM yyyy · HH:mm', { locale: locale(lang) }).toUpperCase()
}

/** "02 OCT 2026" — a day in spec-plate style. */
export function fmtDate(ts: number, lang: Lang): string {
  return format(ts, 'dd MMM yyyy', { locale: locale(lang) }).toUpperCase()
}

export function fmtDay(ts: number, lang: Lang): string {
  return format(ts, lang === 'de' ? 'EEE · dd. MMM yyyy' : 'EEE · dd MMM yyyy', { locale: locale(lang) }).toUpperCase()
}

export function isoWeek(ts: number): number {
  return Number(format(ts, 'I'))
}

export function fmtBytes(n: number, lang: Lang): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`
}

/** Message key for a count: "<key>.one" when n is 1 (both EN and DE only distinguish one/other). */
export function plural(key: string, n: number): string {
  return n === 1 ? `${key}.one` : key
}
