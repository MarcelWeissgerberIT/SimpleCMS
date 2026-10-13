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

/** An amount for a text field in the UI's language, without the sign: "1.50" · "1,50" ('' when not a number). */
export function fmtAmount(n: number, lang: string): string {
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).format(n)
}

/**
 * An amount typed into a field: digits with the UI language's decimal mark — and a dot in any language ("1,5" and
 * "1.5" in German, "1.5" in English); spaces and a "$" around it are ignored. Thousands are grouped the language's way:
 * in German a dot followed by exactly three digits ("1.000" = 1000, "12.345,5"), in English a comma ("1,000" = 1000,
 * "1,000.5") — the first group starts with 1–9 ("0.750" stays 0.75); a single dot with one or two digits ("1.5",
 * "0.75") stays a decimal mark. Anything else is null (the field says so) — never a silent "15" for "1,5", never 1 for
 * "1.000".
 */
export function parseAmount(text: string, lang: string): number | null {
  const s = text.replace(/[\s  ]+/g, '').replace(/^\$|\$$/g, '')
  const de = lang === 'de'
  // grouped thousands: "1.000" · "1.000,5" (German) · "1,000" · "1,000.5" (English)
  const grouped = de ? /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d*))?$/ : /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d*))?$/
  const g = grouped.exec(s)
  const plain = g ? `${g[1].replace(/[.,]/g, '')}.${g[2] ?? ''}` : s
  const ok = de ? /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/
  if (!ok.test(plain)) return null
  const n = Number(plain.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
