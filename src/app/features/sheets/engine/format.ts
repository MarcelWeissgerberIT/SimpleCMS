/**
 * Showing values: the cell formats (auto, number, percent, currency, date, text) and the format
 * codes of TEXT() ("0.00", "#,##0", "0%", "yyyy-mm-dd", "dd.mm.yyyy", "mmm yyyy" …).
 */
import type { CellValue, ValueHint } from './types'
import { DAY, EPOCH, isErr, numberText } from './values'

export type FormatType = 'auto' | 'number' | 'percent' | 'currency' | 'date' | 'text'
export interface CellFormat {
  type: FormatType
  decimals?: number
  currency?: 'EUR' | 'USD'
}

type Lang = 'en' | 'de'

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(lang: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(opts)}`
  let f = nfCache.get(key)
  if (!f) nfCache.set(key, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', opts)))
  return f
}

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
}
const DAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
}

function parts(serial: number) {
  const ms = Math.round((serial - Math.floor(serial)) * 86400) * 1000
  const dt = new Date(EPOCH + Math.floor(serial) * DAY + ms)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() }
}

const two = (n: number) => String(n).padStart(2, '0')

/** A date serial as a short, unambiguous date ("Oct 3, 2026" / "03.10.2026"), optionally with time. */
export function formatDate(serial: number, lang: Lang, time = false): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return numberText(serial)
  const p = parts(serial)
  const date = lang === 'de' ? `${two(p.d)}.${two(p.m)}.${p.y}` : `${MONTHS.en[p.m - 1].slice(0, 3)} ${p.d}, ${p.y}`
  return time ? `${date} ${two(p.h)}:${two(p.mi)}` : date
}

/** General number: up to 10 decimals, no grouping, locale decimal sign; exponent for huge / tiny values. */
export function formatGeneral(n: number, lang: Lang): string {
  if (n === 0) return '0'
  const a = Math.abs(n)
  let out: string
  if (a >= 1e15 || a < 1e-9) out = n.toExponential(5).replace(/\.?0+e/, 'e')
  else out = String(Number(n.toPrecision(15)))
  if (/\.\d{11,}/.test(out)) out = String(Number(n.toFixed(10)))
  return lang === 'de' ? out.replace('.', ',') : out
}

export const BOOL_TEXT: Record<Lang, [string, string]> = { en: ['TRUE', 'FALSE'], de: ['WAHR', 'FALSCH'] }

/** What a cell shows. */
export function formatValue(v: CellValue, fmt: CellFormat | undefined, hint: ValueHint, lang: Lang): string {
  if (v === null) return ''
  if (isErr(v)) return v.code
  if (typeof v === 'boolean') return BOOL_TEXT[lang][v ? 0 : 1]
  if (typeof v === 'string') return v
  const type = fmt?.type ?? 'auto'
  const dec = fmt?.decimals
  switch (type) {
    case 'number':
      return nf(lang, { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 }).format(v)
    case 'percent':
      return nf(lang, { style: 'percent', minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 0 }).format(v)
    case 'currency':
      return nf(lang, { style: 'currency', currency: fmt?.currency ?? 'EUR', minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 }).format(v)
    case 'date':
      return formatDate(v, lang, v % 1 !== 0)
    case 'text':
      return numberText(v)
  }
  if (hint === 'date') return formatDate(v, lang)
  if (hint === 'datetime') return formatDate(v, lang, true)
  if (hint === 'percent') return nf(lang, { style: 'percent', maximumFractionDigits: 2 }).format(v)
  if (dec !== undefined) return nf(lang, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }).format(v)
  return formatGeneral(v, lang)
}

/* ------------------------------------------------------------------ */
/* TEXT(value; "format code")                                          */
/* ------------------------------------------------------------------ */

const DATE_CODE = /[yYdDhHsS]|(^|[^#0])[mM]/

function formatDateCode(serial: number, code: string, lang: Lang): string {
  const p = parts(serial)
  let out = ''
  let i = 0
  let lastWasHour = false
  while (i < code.length) {
    const rest = code.slice(i)
    const run = /^(y+|m+|d+|h+|s+|AM\/PM)/i.exec(rest)
    if (rest[0] === '"') {
      const end = code.indexOf('"', i + 1)
      out += code.slice(i + 1, end < 0 ? code.length : end)
      i = end < 0 ? code.length : end + 1
      continue
    }
    if (!run) {
      out += rest[0] === '\\' ? (rest[1] ?? '') : rest[0]
      i += rest[0] === '\\' ? 2 : 1
      continue
    }
    const tok = run[1]
    const k = tok[0].toLowerCase()
    const len = tok.length
    if (k === 'y') out += len <= 2 ? two(p.y % 100) : String(p.y)
    else if (k === 'd') out += len === 1 ? String(p.d) : len === 2 ? two(p.d) : len === 3 ? DAYS[lang][p.wd].slice(0, 3) : DAYS[lang][p.wd]
    else if (k === 'h') out += len === 1 ? String(p.h) : two(p.h)
    else if (k === 's') out += len === 1 ? String(p.s) : two(p.s)
    else if (k === 'a') out += p.h < 12 ? 'AM' : 'PM'
    else if (k === 'm') {
      // minutes right after hours or before seconds
      const minutes = lastWasHour || /^m{1,2}:?s/i.test(rest)
      if (minutes && len <= 2) out += len === 1 ? String(p.mi) : two(p.mi)
      else out += len === 1 ? String(p.m) : len === 2 ? two(p.m) : len === 3 ? MONTHS[lang][p.m - 1].slice(0, 3) : MONTHS[lang][p.m - 1]
    }
    lastWasHour = k === 'h' || (lastWasHour && /^[:\s]$/.test(tok))
    i += len
  }
  return out
}

function formatNumberCode(n: number, code: string, lang: Lang): string {
  const sections = code.split(';')
  let c = sections[0]
  let x = n
  if (n < 0 && sections[1] !== undefined) {
    c = sections[1]
    x = -n
  } else if (n === 0 && sections[2] !== undefined) c = sections[2]
  const pct = (c.match(/%/g) ?? []).length
  x = x * Math.pow(100, pct)
  const m = /[#0?][#0?,]*(\.[#0?]*)?/.exec(c)
  if (!m) return c.replace(/"([^"]*)"/g, '$1')
  const spec = m[0]
  const decPart = spec.split('.')[1] ?? ''
  const decimals = decPart.length
  const grouping = spec.split('.')[0].includes(',')
  const minInt = (spec.split('.')[0].match(/0/g) ?? []).length
  let body = nf(lang, { minimumFractionDigits: (decPart.match(/0/g) ?? []).length, maximumFractionDigits: decimals, useGrouping: grouping, minimumIntegerDigits: Math.max(1, Math.min(minInt, 21)) }).format(Math.abs(x))
  if (minInt === 0 && Math.abs(x) < 1) body = body.replace(/^0(?=[.,])/, '')
  if (x < 0 && sections[1] === undefined) body = `-${body}`
  const before = c.slice(0, m.index).replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
  const after = c.slice(m.index + spec.length).replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
  return before + body + after
}

/** TEXT(): a number formatted with a spreadsheet format code. */
export function formatWithCode(v: CellValue, code: string, lang: Lang): string {
  if (typeof v === 'string') return v
  if (v === null) v = 0
  if (typeof v === 'boolean') return BOOL_TEXT[lang][v ? 0 : 1]
  if (isErr(v)) return v.code
  if (DATE_CODE.test(code.replace(/"[^"]*"/g, ''))) return formatDateCode(v, code, lang)
  return formatNumberCode(v, code, lang)
}
