/**
 * Money in the UI's language — what Claude costs, in US dollars: "$3.00" in English, "3,00 $" in German (the sign
 * after the amount, kept on its line with a no-break space); less than a cent reads "< $0.01" / "< 0,01 $".
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
