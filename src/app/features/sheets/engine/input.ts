/**
 * What a person types into a cell → the stored raw input (canonical, language-neutral) and what
 * a stored raw input means (number, percent, date, boolean, text).
 *
 * Stored forms: "1234.5", "12.5%", "2026-10-03", "2026-10-03 14:30", "TRUE", "'=not a formula", text.
 */
import type { CellFormat, FormatType } from './format'
import type { Scalar, ValueHint } from './types'
import { parseNumeric, serialOf } from './values'

export interface Literal {
  value: Scalar
  hint: ValueHint
}

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** The value of a stored, non-formula input. */
export function literal(raw: string, fmt?: FormatType): Literal {
  if (raw === '') return { value: null, hint: null }
  if (fmt === 'text') return { value: raw, hint: null }
  if (raw[0] === "'") return { value: raw.slice(1), hint: null }
  const t = raw.trim()
  if (/^(TRUE|FALSE)$/i.test(t)) return { value: t.toUpperCase() === 'TRUE', hint: null }
  if (NUM.test(t)) return { value: Number(t), hint: null }
  if (t.endsWith('%') && NUM.test(t.slice(0, -1).trim())) return { value: Number(t.slice(0, -1).trim()) / 100, hint: 'percent' }
  const d = ISO.exec(t)
  if (d) {
    const n = parseNumeric(t)
    if (n !== null) return { value: n, hint: d[4] ? 'datetime' : 'date' }
  }
  return { value: raw, hint: null }
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (y: number, m: number, d: number) => (serialOf(y, m, d) === null ? null : `${y}-${pad(m)}-${pad(d)}`)
const fullYear = (y: number) => (y < 100 ? 2000 + y : y)

/** Locale number text → canonical ("1.234,5" → "1234.5" in German, "1,234.5" → "1234.5" in English). */
function canonicalNumber(s: string, lang: 'en' | 'de'): string | null {
  const t = s.replace(/[\s  ]/g, '')
  if (NUM.test(t)) {
    // "1.234" in German is one thousand two hundred thirty-four
    if (lang === 'de' && /^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) return t.replace(/\./g, '')
    return t
  }
  if (lang === 'de') {
    if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^[+-]?\d+,\d+$/.test(t)) return t.replace(/\./g, '').replace(',', '.')
  } else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return t.replace(/,/g, '')
  return null
}

/**
 * Canonicalise typed input. Returns the raw text to store and, for currency input ("€ 1.200",
 * "$5"), the format to apply.
 */
export function canonicalInput(typed: string, lang: 'en' | 'de'): { v: string; fmt?: CellFormat } {
  const s = typed
  const t = s.trim()
  if (!t || t[0] === '=' || t[0] === "'") return { v: t ? s : '' }
  if (/^(WAHR|TRUE)$/i.test(t)) return { v: 'TRUE' }
  if (/^(FALSCH|FALSE)$/i.test(t)) return { v: 'FALSE' }
  const n = canonicalNumber(t, lang)
  if (n !== null) return { v: n }
  if (/%$/.test(t)) {
    const p = canonicalNumber(t.slice(0, -1), lang)
    if (p !== null) return { v: `${p}%` }
  }
  const cur = /^([€$])\s*([+-]?[\d.,\s]+)$/.exec(t) ?? /^([+-]?[\d.,\s]+?)\s*([€$])$/.exec(t)
  if (cur) {
    const sym = cur[1] === '€' || cur[1] === '$' ? cur[1] : cur[2]
    const amount = canonicalNumber(cur[1] === sym ? cur[2] : cur[1], lang)
    if (amount !== null) return { v: amount, fmt: { type: 'currency', currency: sym === '$' ? 'USD' : 'EUR' } }
  }
  const iso = ISO.exec(t)
  if (iso && isoDate(+iso[1], +iso[2], +iso[3])) return { v: iso[4] ? `${isoDate(+iso[1], +iso[2], +iso[3])} ${pad(+iso[4])}:${iso[5]}` : isoDate(+iso[1], +iso[2], +iso[3])! }
  // 3.10.2026 (German) · 10/3/2026 (English) · either with a two-digit year
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t)
  if (de) {
    const d = isoDate(fullYear(+de[3]), +de[2], +de[1])
    if (d) return { v: d }
  }
  const en = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  if (en) {
    const d = lang === 'de' ? isoDate(fullYear(+en[3]), +en[2], +en[1]) : isoDate(fullYear(+en[3]), +en[1], +en[2])
    if (d) return { v: d }
  }
  return { v: s }
}

/** Raw input as the editor shows it again (canonical; "'" kept so text stays text). */
export const editText = (raw: string | undefined): string => raw ?? ''
