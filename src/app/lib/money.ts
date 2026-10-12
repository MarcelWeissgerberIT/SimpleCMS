/**
 * Money in the UI's language — what AI requests cost, in US dollars: "$3.00" in English, "3,00 $" in German (the sign
 * after the amount, kept on its line with a no-break space); less than a cent reads "< $0.01" / "< 0,01 $" — except on
 * receipts (fmtCost), which show the small amounts themselves.
 */
import type { Lang } from '@/shared/i18n'

const formats: Partial<Record<Lang, Intl.NumberFormat>> = {}

const format = (lang: Lang): Intl.NumberFormat =>
  (formats[lang] ??= new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function fmtUsd(usd: number, lang: Lang): string {
  if (usd > 0 && usd < 0.01) return `< ${format(lang).format(0.01)}`
  return format(lang).format(usd)
}

/** Does the sign come after the amount in this language ("3,00 $")? For a field with the sign beside it. */
export const usdSignAfter = (lang: Lang): boolean => lang === 'de'

const precise: Partial<Record<Lang, Intl.NumberFormat>> = {}
const tiny: Partial<Record<Lang, Intl.NumberFormat>> = {}

/**
 * What one request (or a run of them) cost, as a receipt shows it: two decimals from a dollar on, four below
 * ("$0.0046" · "0,0046 $"), one significant digit below a hundredth of a cent ("$0.00004").
 */
export function fmtCost(usd: number, lang: Lang): string {
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  if (!(usd > 0) || usd >= 1) return format(lang).format(Math.max(0, usd || 0))
  if (usd >= 0.0001) return (precise[lang] ??= new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 4, maximumFractionDigits: 4 })).format(usd)
  return (tiny[lang] ??= new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumSignificantDigits: 1 })).format(usd)
}
