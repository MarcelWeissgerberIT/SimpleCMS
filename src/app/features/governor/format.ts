/**
 * The Regler's numbers as the UI shows them (pure: Node specs load it) — money through lib/money.ts (fmtUsd), token
 * counts in the UI's decimal sign: 950 · 15,3k · 68k · 141k · 1,24 Mio. (German) / 950 · 15.3k · 68k · 141k · 1.24M
 * (English); bands "0,30–0,52 $" / "$0.30–0.52"; the lamp's second line "4,12/6 $" / "$4.12/6" (≤ 16 characters). The
 * German sign follows a no-break space, as in fmtUsd.
 */
import type { Lang } from '@/shared/i18n'
import { fmtUsd, displayAmount, moneySymbol } from '../../lib/money'

/** the sign stays on its line (as lib/money.ts writes it) */
const NBSP = '\u00a0'
/** a band never breaks after its dash ("0,30–" / "0,52 $") */
const WJ = '\u2060'

const nums = new Map<string, Intl.NumberFormat>()
function num(lang: Lang, min: number, max = min): Intl.NumberFormat {
  const key = `${lang}:${min}:${max}`
  let f = nums.get(key)
  if (!f) nums.set(key, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: min, maximumFractionDigits: max })))
  return f
}

/** Tokens, short: one decimal below 100k (a trailing zero dropped: "68k"), none from 100k, two from a million. */
export function fmtTok(n: number, lang: Lang): string {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0
  if (v < 1000) return num(lang, 0).format(Math.round(v))
  if (v < 999_500) return `${num(lang, 0, v < 99_950 ? 1 : 0).format(v / 1000)}k`
  return lang === 'de' ? `${num(lang, 2).format(v / 1_000_000)} Mio.` : `${num(lang, 2).format(v / 1_000_000)}M`
}

/** An amount without the sign, two decimals ("0,30" · "0.30"); whole amounts of a limit without decimals ("6"). */
export function fmtNum(usd: number, lang: Lang, whole = false): string {
  const v = displayAmount(Number.isFinite(usd) ? usd : 0)
  return whole && Number.isInteger(v) ? num(lang, 0).format(v) : num(lang, 2).format(v)
}

/** A band "0,30–0,52 $" / "$0.30–0.52" (one amount when both ends round alike; no line break after the dash). */
export function fmtBand(band: { low: number; high: number }, lang: Lang): string {
  const low = fmtNum(band.low, lang)
  const high = fmtNum(band.high, lang)
  if (low === high) return fmtUsd(band.high, lang)
  return lang === 'de' ? `${low}–${WJ}${high}${NBSP}${moneySymbol()}` : `${moneySymbol()}${low}–${WJ}${high}`
}

/** Spend of a limit, short: "4,12/6 $" · "$4.12/6" — the lamp's second line and the phone's status cell. */
export function fmtOf(spent: number, limit: number, lang: Lang): string {
  const s = fmtNum(spent, lang)
  const l = fmtNum(limit, lang, true)
  return lang === 'de' ? `${s}/${l}${NBSP}${moneySymbol()}` : `${moneySymbol()}${s}/${l}`
}

/** A limit as the status cell shows it: whole amounts without decimals ("6 $" · "$6"), others as fmtUsd. */
export function fmtLimit(usd: number, lang: Lang): string {
  if (!Number.isInteger(usd)) return fmtUsd(usd, lang)
  const n = fmtNum(usd, lang, true)
  return lang === 'de' ? `${n}${NBSP}${moneySymbol()}` : `${moneySymbol()}${n}`
}

/** A dial numeral: no trailing zeros ("0,5" · "2" · "1.25"). */
export const fmtScale = (v: number, lang: Lang): string => num(lang, 0, 2).format(Number.isFinite(v) ? v : 0)
