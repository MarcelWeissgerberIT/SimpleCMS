/**
 * Money in the UI's language — what AI requests cost, in US dollars: "$3.00" in English, "3,00 $" in German (the sign
 * after the amount, kept on its line with a no-break space); less than a cent reads "< $0.01" / "< 0,01 $" — except on
 * receipts (fmtCost), which show the small amounts themselves.
 */
import type { Lang } from '../../shared/i18n.ts'

export interface MoneyDisplay { currency: 'USD' | 'EUR'; eurPerUsd?: number; date?: string; source?: 'ecb' | 'manual' }
let preferences: () => MoneyDisplay | undefined = () => undefined
/** Store-owned preferences; keeping this formatter independent also lets Node tests use it. */
export const registerMoneyDisplay = (read: () => MoneyDisplay | undefined) => { preferences = read }
export function displayCurrency(): 'USD' | 'EUR' {
  const p = preferences()
  return p?.currency === 'EUR' && Number.isFinite(p.eurPerUsd) && p.eurPerUsd! > 0 ? 'EUR' : 'USD'
}
export const displayAmount = (usd: number): number => displayCurrency() === 'EUR' ? usd * preferences()!.eurPerUsd! : usd
export const moneySymbol = (): string => displayCurrency() === 'EUR' ? '€' : '$'
const formats = new Map<string, Intl.NumberFormat>()
export function formatMoney(usd: number, lang: Lang, digits = 2): string {
  const currency = displayCurrency()
  const key = `${lang}:${currency}:${digits}`
  let f = formats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
    formats.set(key, f)
  }
  return f.format(displayAmount(usd))
}
/** Input is always USD; only its presentation follows this device's preference. */
export function fmtUsd(usd: number, lang: Lang): string {
  const v = displayAmount(usd)
  if (v > 0 && v < 0.01) return `< ${formatMoney(displayCurrency() === 'EUR' ? 0.01 / preferences()!.eurPerUsd! : 0.01, lang)}`
  return formatMoney(usd, lang)
}
export const usdSignAfter = (lang: Lang): boolean => lang === 'de'
export function fmtCost(usd: number, lang: Lang): string {
  const v = displayAmount(usd)
  if (!(v > 0) || v >= 1) return formatMoney(Math.max(0, usd || 0), lang)
  if (v >= 0.0001) return formatMoney(usd, lang, 4)
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: displayCurrency(), currencyDisplay: 'narrowSymbol', maximumSignificantDigits: 1 }).format(v)
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
  const plain = g ? `${g[1]!.replace(/[.,]/g, '')}.${g[2] ?? ''}` : s
  const ok = de ? /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/
  if (!ok.test(plain)) return null
  const n = Number(plain.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
