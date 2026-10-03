/**
 * Axis maths and number formatting: nice ticks (1 / 2 / 2.5 / 5 × 10ⁿ), integer data never
 * gets fractional ticks, one formatter per axis (unit + digits follow the step).
 */

export interface Ticks {
  min: number
  max: number
  step: number
  ticks: number[]
}

/** 1, 2, 2.5, 5 or 10 × a power of ten ≥ raw. */
export function niceStep(raw: number, integer = false): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  if (integer) step = step < 1 ? 1 : step === 2.5 ? 2 : Math.round(step)
  return step
}

const clean = (v: number, step: number) => {
  const d = stepDecimals(step)
  const r = Number(v.toFixed(Math.min(10, d + 2)))
  return Math.abs(r) < step * 1e-9 ? 0 : r
}

/**
 * Ticks covering [lo, hi] with about `count` intervals. Equal ends grow to a visible range;
 * fixed ends (yMin / yMax set by the user) are kept as they are.
 */
export function niceTicks(lo: number, hi: number, count = 5, opts: { integer?: boolean; fixedMin?: boolean; fixedMax?: boolean } = {}): Ticks {
  let a = Number.isFinite(lo) ? lo : 0
  let b = Number.isFinite(hi) ? hi : 1
  if (a > b) [a, b] = [b, a]
  if (a === b) {
    if (a === 0) b = 1
    else if (a > 0) a = opts.fixedMin ? a : 0
    else b = opts.fixedMax ? b : 0
    if (a === b) b = a + 1
  }
  const step = niceStep((b - a) / Math.max(1, count), opts.integer)
  const min = opts.fixedMin ? a : Math.floor(a / step + 1e-9) * step
  const max = opts.fixedMax ? b : Math.ceil(b / step - 1e-9) * step
  const ticks: number[] = []
  const first = Math.ceil(min / step - 1e-9) * step
  for (let v = first, i = 0; v <= max + step * 1e-6 && i < 50; v += step, i++) ticks.push(clean(v, step))
  if (opts.fixedMin && ticks[0] !== min) ticks.unshift(clean(min, step))
  if (opts.fixedMax && ticks[ticks.length - 1] !== max) ticks.push(clean(max, step))
  return { min: clean(min, step), max: clean(max, step), step, ticks }
}

/** Fraction digits needed to write a step exactly (5000 → 0, 2.5 → 1, 0.25 → 2), capped at 4. */
export function stepDecimals(step: number): number {
  for (let d = 0; d < 4; d++) if (Number.isInteger(Number((step * 10 ** d).toPrecision(10)))) return d
  return 4
}

const CURRENCY_CODE: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY', '₹': 'INR', EUR: 'EUR', USD: 'USD', GBP: 'GBP', CHF: 'CHF' }

export interface FormatOptions {
  lang: 'en' | 'de'
  unit?: string
  /** fixed fraction digits (spec.decimals); default: up to 2 */
  decimals?: number
  /** 12.3K / 1,2 Mio. */
  compact?: boolean
}

const locale = (lang: 'en' | 'de') => (lang === 'de' ? 'de-DE' : 'en-US')

const cache = new Map<string, Intl.NumberFormat>()
function nf(lang: 'en' | 'de', o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(o)}`
  let f = cache.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale(lang), o)
    } catch {
      f = new Intl.NumberFormat(locale(lang))
    }
    cache.set(key, f)
  }
  return f
}

/** A value with its unit: "€1,200" / "1.200 €", "45%", "12 MB". */
export function formatValue(v: number | null | undefined, o: FormatOptions): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞'
  const digits: Intl.NumberFormatOptions =
    o.decimals !== undefined ? { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals } : { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 2 }
  const compact: Intl.NumberFormatOptions = o.compact && Math.abs(v) >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}
  const unit = (o.unit ?? '').trim()
  const code = CURRENCY_CODE[unit]
  if (code) return nf(o.lang, { style: 'currency', currency: code, ...digits, ...(o.decimals === undefined ? { minimumFractionDigits: 0 } : {}), ...compact }).format(v)
  const text = nf(o.lang, { ...digits, ...compact }).format(v)
  if (!unit) return text
  if (unit === '%') return o.lang === 'de' ? `${text} %` : `${text}%`
  return `${text} ${unit}`
}

/** One formatter for every tick of an axis: digits follow the step, never the value. */
export function tickFormatter(step: number, o: FormatOptions): (v: number) => string {
  const big = Math.abs(step) >= 10_000
  const d = big ? 0 : stepDecimals(step)
  return (v) => formatValue(v, { ...o, decimals: o.decimals !== undefined && !big ? Math.max(o.decimals, d) : d, compact: big })
}

/** Rough text widths for layout (no DOM needed: exports and tests use the same numbers). */
export const monoWidth = (s: string, size = 10) => s.length * size * 0.62
export const sansWidth = (s: string, size = 12) => {
  let w = 0
  for (const ch of s) w += /[MWmw@%]/.test(ch) ? 0.82 : /[il.,:;'|!]/.test(ch) ? 0.3 : /[A-Z0-9€$]/.test(ch) ? 0.64 : 0.54
  return w * size
}

/** Shorten to fit `maxChars` with an ellipsis. */
export function clip(s: string, maxChars: number): string {
  if (maxChars <= 1) return s ? '…' : ''
  return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…' : s
}
