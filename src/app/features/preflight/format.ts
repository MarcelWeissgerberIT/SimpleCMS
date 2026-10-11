/**
 * Preflight's formatters (features never import shell/**): cap counts, the day and times in the UI's language.
 * Dates DE "Fr 10.10.", EN "Fri 10 Oct"; times HH:mm in both.
 */
import { format } from 'date-fns'
import { de, enGB } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'
import { currentLang } from '../../i18n'

export { fmtCount } from './lamps'

export function fmtDay(ms: number, lang: Lang): string {
  return lang === 'de' ? format(ms, 'EEEEEE dd.MM.', { locale: de }) : format(ms, 'EEE d MMM', { locale: enGB })
}

export function fmtTime(ms: number): string {
  return format(ms, 'HH:mm')
}

export function fmtNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB').format(n)
}

/** A moment: HH:mm today, else the short date (DE "08.10.", EN "8 Oct"). */
export function fmtWhen(ms: number, now: number, lang: Lang = currentLang()): string {
  const a = new Date(ms)
  const b = new Date(now)
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()) return fmtTime(ms)
  return lang === 'de' ? format(ms, 'dd.MM.') : format(ms, 'd MMM', { locale: enGB })
}

