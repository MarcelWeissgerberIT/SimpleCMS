import { formatDistanceToNowStrict, format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'

export function wordCount(text: string | undefined | null): number {
  if (!text) return 0
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}

/** Minutes to read at ~220 wpm (min 1 when there is any text). */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / 220))
}

export function fmtNumber(n: number, lang: Lang): string {
  return n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
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
