/**
 * Numbers, units and times on the deck, in the UI's language: "41.208" / "41,208", "52 Vorgänge" / "1 Vorgang",
 * "Fr 09.10." / "Fri 9 Oct", "07:30:00".
 */
import { format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang, Translate } from '@/shared/i18n'

const numberFormats = new Map<Lang, Intl.NumberFormat>()

export function fmtNum(n: number, lang: Lang): string {
  let f = numberFormats.get(lang)
  if (!f) numberFormats.set(lang, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US')))
  return f.format(n)
}

/** "<key>.one" for 1. */
export const pl = (key: string, n: number): string => (n === 1 ? `${key}.one` : key)

/** A count with its unit: unit('ops', 52) → "52 Vorgänge". */
export function unit(t: Translate, lang: Lang, kind: 'ops' | 'places' | 'rows' | 'pages' | 'days', n: number): string {
  return t(pl(`features.recorder.unit.${kind}`, n), { n: fmtNum(n, lang) })
}

const locale = (lang: Lang) => (lang === 'de' ? de : enUS)

/** "Fr 09.10." / "Fri 9 Oct" */
export const fmtDayShort = (t: Translate, lang: Lang, at: number): string => format(at, t('features.recorder.fmt.day'), { locale: locale(lang) })
/** "Freitag, 9. Oktober" / "Friday 9 October" */
export const fmtDayLong = (t: Translate, lang: Lang, at: number): string => format(at, t('features.recorder.fmt.dayLong'), { locale: locale(lang) })
/** "Do 09" / "Thu 09" */
export const fmtStripDay = (t: Translate, lang: Lang, at: number): string => format(at, t('features.recorder.fmt.stripDay'), { locale: locale(lang) })

const two = (n: number) => String(n).padStart(2, '0')
/** "07:30:00" */
export function hms(at: number): string {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/** "07:30" */
export function hm(at: number): string {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
/** A time span to the second, shared parts once: "07:31:12–14", "07:31:12–07:33:02", "07:31:21". */
export function hmsSpan(a: number, b: number): string {
  const x = hms(a)
  const y = hms(b)
  if (x === y) return x
  return x.slice(0, 6) === y.slice(0, 6) ? `${x}–${y.slice(6)}` : `${x}–${y}`
}
/** ":32" */
export const mm = (at: number): string => `:${two(new Date(at).getMinutes())}`
/** a lane count, two digits at least: "06" */
export const count2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** "1,5 MB" / "1.5 MB" */
export function fmtSize(n: number, lang: Lang): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`
}
