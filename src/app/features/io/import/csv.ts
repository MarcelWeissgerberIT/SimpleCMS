/**
 * CSV parsing + column type inference (pure, no DOM — unit-testable in Node).
 * Used for Notion database exports and stand-alone CSV imports.
 */
import type { ColorName, DateValue, NumberFormat, PropertyType, SelectOption, StatusGroup } from '../../../store/types'
import { newId } from '../../../lib/ids'

export type Delimiter = ',' | ';' | '\t'

/** Field delimiter from the header line: "," (default), ";" (German / European Excel) or tab. */
export function sniffDelimiter(input: string): Delimiter {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>
  let inQ = false
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch in counts) counts[ch]++
  }
  return counts[';'] > counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ','
}

/** Undo the spreadsheet formula guard added on export ("'=SUM(…)" → "=SUM(…)", "'\t…" → "\t…"). */
export const unguardCell = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell)

/** Prefix cells a spreadsheet would run as a formula (=, +, -, @ …) — plain numbers stay as they are. */
export function guardCell(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) && !/^[-+]?[\d.,\s]*\d[\d.,\s]*%?$/.test(cell) ? `'${cell}` : cell
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM. Also sniffs ";" / tab delimiters. */
export function parseCSV(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const delim = sniffDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // drop fully empty trailing lines
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) rows.pop()
  return rows
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {}
;[
  ['january', 'jan', 'januar', 'jän'],
  ['february', 'feb', 'februar'],
  ['march', 'mar', 'märz', 'maerz', 'mär', 'mrz'],
  ['april', 'apr'],
  ['may', 'mai'],
  ['june', 'jun', 'juni'],
  ['july', 'jul', 'juli'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct', 'oktober', 'okt'],
  ['november', 'nov'],
  ['december', 'dec', 'dezember', 'dez'],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)))

const pad = (n: number) => String(n).padStart(2, '0')

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

function parseTime(h?: string, min?: string, ampm?: string): string | null {
  if (h === undefined || min === undefined) return null
  let hh = Number(h)
  const mm = Number(min)
  if (ampm) {
    const pm = ampm.replace(/\./g, '').toLowerCase() === 'pm'
    if (hh === 12) hh = pm ? 12 : 0
    else if (pm) hh += 12
  }
  if (hh > 23 || mm > 59) return null
  return `${pad(hh)}:${pad(mm)}`
}

/** Zone suffix we accept and ignore: "Uhr", "Z", "+02:00", "(GMT+2)", "UTC-05:30", "(CEST)" */
const ZONE = String.raw`(?:Uhr|Z|[+-]\d{2}:?\d{2}|\(?(?:GMT|UTC)\s?(?:[+-]\d{1,2}(?::?\d{2})?)?\)?|\(?[A-Z]{2,5}\)?)`
const TIME = String.raw`(?:[ ,T]+(?:at\s+|um\s+)?(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?(?:\s*${ZONE})?)?`
const RE_ISO = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}$`)
const RE_MDY_NAME = new RegExp(String.raw`^([A-Za-zÄÖÜäöü]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${TIME}$`)
const RE_DMY_NAME = new RegExp(String.raw`^(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]+)\.?,?\s+(\d{4})${TIME}$`)
const RE_DOTTED = new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})${TIME}$`)
const RE_SLASH = new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`)

/** Parse one date (no range). `dayFirst` decides ambiguous "01/02/2026". */
export function parseSingleDate(raw: string, dayFirst = false): { date: string; time: string | null } | null {
  const s = raw.trim().replace(/^@/, '')
  if (!s) return null
  let m = s.match(RE_ISO)
  if (m) {
    const date = isoDate(+m[1], +m[2], +m[3])
    return date ? { date, time: parseTime(m[4], m[5], m[6]) } : null
  }
  m = s.match(RE_MDY_NAME)
  if (m && MONTHS[m[1].toLowerCase()]) {
    const date = isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
    return date ? { date, time: parseTime(m[4], m[5], m[6]) } : null
  }
  m = s.match(RE_DMY_NAME)
  if (m && MONTHS[m[2].toLowerCase()]) {
    const date = isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
    return date ? { date, time: parseTime(m[4], m[5], m[6]) } : null
  }
  m = s.match(RE_DOTTED)
  if (m) {
    const date = isoDate(+m[3], +m[2], +m[1])
    return date ? { date, time: parseTime(m[4], m[5], m[6]) } : null
  }
  m = s.match(RE_SLASH)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const df = dayFirst || a > 12
    const date = df ? isoDate(+m[3], b, a) : isoDate(+m[3], a, b)
    return date ? { date, time: parseTime(m[4], m[5], m[6]) } : null
  }
  return null
}

/** Parse a date or a Notion range ("Oct 2, 2026 → Oct 5, 2026"). */
export function parseDateValue(raw: string, dayFirst = false): DateValue | null {
  const parts = raw.split(/\s*(?:→|->|–|—)\s*/)
  if (parts.length > 2) return null
  const a = parseSingleDate(parts[0], dayFirst)
  if (!a) return null
  let end: string | null = null
  let includeTime = !!a.time
  if (parts.length === 2) {
    // "October 2, 2026 2:00 PM → 4:00 PM" (same day, time only)
    const timeOnly = parts[1].trim().match(new RegExp(String.raw`^(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?(?:\s*${ZONE})?$`))
    const b = timeOnly ? { date: a.date, time: parseTime(timeOnly[1], timeOnly[2], timeOnly[3]) } : parseSingleDate(parts[1], dayFirst)
    if (!b) return null
    includeTime = includeTime || !!b.time
    end = b.time && includeTime ? `${b.date}T${b.time}` : b.date
  }
  const start = a.time && includeTime ? `${a.date}T${a.time}` : a.date
  return { start, end, includeTime }
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/** "dot": 1,234.5 (EN) · "comma": 1.234,5 (DE / most of Europe) */
export type DecimalStyle = 'dot' | 'comma'

const SP = ' \\u00a0\\u202f'
const RE_NUM: Record<DecimalStyle, RegExp> = {
  dot: new RegExp(`^([-+]?)\\s*([$€£]?)\\s*([-+]?)(\\d{1,3}(?:[,${SP}]\\d{3})+|\\d+)?(\\.\\d+)?\\s*([$€£%]?)$`),
  comma: new RegExp(`^([-+]?)\\s*([$€£]?)\\s*([-+]?)(\\d{1,3}(?:[.${SP}]\\d{3})+|\\d+)?(,\\d+)?\\s*([$€£%]?)$`),
}

export function parseNumber(raw: string, style: DecimalStyle = 'dot'): { value: number; format: NumberFormat | null } | null {
  const s = raw.trim().replace(/\s*(EUR|USD|GBP)$/i, (_m, c: string) => ({ eur: '€', usd: '$', gbp: '£' })[c.toLowerCase() as 'eur'] ?? '')
  if (!s) return null
  const m = s.match(RE_NUM[style])
  if (!m || (!m[4] && !m[5])) return null
  const intPart = (m[4] ?? '0').replace(/[^\d]/g, '')
  const frac = m[5] ? `.${m[5].slice(1)}` : ''
  let value = Number(`${intPart}${frac}`)
  if (!Number.isFinite(value)) return null
  if (m[1] === '-' || m[3] === '-') value = -value
  const sym = m[2] || m[6]
  const grouped = /\d\D\d{3}/.test(m[4] ?? '')
  const format: NumberFormat | null = sym === '%' ? 'percent' : sym === '$' ? 'dollar' : sym === '€' ? 'euro' : sym === '£' ? 'pound' : grouped ? 'comma' : null
  if (sym === '%') value = value / 100
  return { value, format }
}

/**
 * Decide the decimal style of a column once. Unambiguous values vote ("1.234,5", "3,50" → comma;
 * "1,234.5", "3.50" → dot); "1.200" / "1,200" alone are ambiguous — then a ";" delimiter
 * (European Excel) means comma decimals.
 */
export function decimalStyleOf(values: string[], delimiter: Delimiter = ','): DecimalStyle {
  let comma = 0
  let dot = 0
  for (const raw of values) {
    const v = raw.replace(/[^\d.,]/g, '')
    if (!v) continue
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(v) || /^\d{1,3}(\.\d{3}){2,}$/.test(v) || /^\d+,(\d{1,2}|\d{4,})$/.test(v) || /^\d+\.\d+,\d+$/.test(v)) comma++
    else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(v) || /^\d{1,3}(,\d{3}){2,}$/.test(v) || /^\d+\.(\d{1,2}|\d{4,})$/.test(v) || /^\d+,\d+\.\d+$/.test(v)) dot++
  }
  if (comma !== dot) return comma > dot ? 'comma' : 'dot'
  return delimiter === ';' ? 'comma' : 'dot'
}

/* ------------------------------------------------------------------ */
/* Inference                                                           */
/* ------------------------------------------------------------------ */

export type ColumnType = Extract<PropertyType, 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'checkbox' | 'url' | 'email' | 'files' | 'relation'>

export interface ColumnSpec {
  name: string
  type: ColumnType
  options?: SelectOption[]
  numberFormat?: NumberFormat
  /** numbers: "1.234,5" (comma) vs "1,234.5" (dot) */
  decimal?: DecimalStyle
  /** ambiguous slash dates resolved as D/M/Y */
  dayFirst?: boolean
}

export interface InferContext {
  /** Does this (decoded, relative-to-csv) token name an attachment inside the import? */
  isFile?: (token: string) => boolean
  /** The CSV's field delimiter — ";" hints at European number and date formats. */
  delimiter?: Delimiter
}

const YES = new Set(['yes', 'true', 'ja', 'checked', '✓', '✔', 'x', '[x]'])
const NO = new Set(['no', 'false', 'nein', 'unchecked', '', '[ ]'])
const SELECT_HINT = /^(status|state|stage|phase|priority|prio|priorit[äa]t|type|typ|kind|art|category|kategorie|tags?|labels?|team|area|bereich|owner|assignee|person|people|level|stufe|genre|format|channel|kanal|platform|plattform|sprint|quarter|quartal)$/i
const STATUS_NAME = /^(status|state|stage|zustand)$/i
const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Notion relation cell token: "Title (relative%20path.md)" or "Title (https://www.notion.so/…)" */
export const RELATION_TOKEN = /^(.*?)\s*\(((?:[^()]|\([^()]*\))+?\.md|https?:\/\/(?:www\.)?notion\.so\/[^)\s]+)\)$/

const PALETTE: ColorName[] = ['gray', 'blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red']

export function statusGroupFor(name: string): StatusGroup {
  const n = name.toLowerCase()
  if (/(done|complete|completed|finished|shipped|closed|resolved|erledigt|fertig|abgeschlossen|live|published|veröffentlicht)/.test(n)) return 'done'
  if (/(progress|doing|active|review|testing|started|wip|blocked|arbeit|läuft|laufend|prüfung|in bearbeitung)/.test(n)) return 'in_progress'
  return 'todo'
}

function optionColor(name: string, i: number, status: boolean): ColorName {
  if (status) {
    const g = statusGroupFor(name)
    return g === 'done' ? 'green' : g === 'in_progress' ? 'blue' : 'gray'
  }
  const n = name.toLowerCase()
  if (/^(high|hoch|urgent|dringend|critical|kritisch|p0|p1)$/.test(n)) return 'red'
  if (/^(medium|mittel|normal|p2)$/.test(n)) return 'yellow'
  if (/^(low|niedrig|p3|p4)$/.test(n)) return 'gray'
  return PALETTE[i % PALETTE.length]
}

/** Split a multi-value cell ("a, b, c"). */
export function splitList(raw: string): string[] {
  return raw
    .split(/,\s*(?![^()]*\))/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function makeOptions(names: string[], status: boolean): SelectOption[] {
  return names.map((name, i) => ({ id: newId(), name, color: optionColor(name, i, status), ...(status ? { group: statusGroupFor(name) } : {}) }))
}

/** Infer one column's property type from its values. `index` 0 is always the title. */
export function inferColumn(name: string, values: string[], index: number, ctx: InferContext = {}): ColumnSpec {
  if (index === 0) return { name, type: 'title' }
  const vals = values.map((v) => v.trim())
  const filled = vals.filter((v) => v !== '')
  if (filled.length === 0) return { name, type: 'text' }

  // checkbox
  if (vals.every((v) => YES.has(v.toLowerCase()) || NO.has(v.toLowerCase())) && filled.some((v) => YES.has(v.toLowerCase()) || /^(no|false|nein)$/i.test(v)))
    return { name, type: 'checkbox' }

  // number (decimal comma vs. dot decided once per column)
  const decimal = decimalStyleOf(filled, ctx.delimiter)
  const nums = filled.map((v) => parseNumber(v, decimal))
  if (nums.every(Boolean)) {
    // codes, not quantities: "01067" (postcode), "0301234567" (phone), "007" (id) or 16+ digits (precision)
    if (filled.some((v) => /^[-+]?0\d/.test(v) || v.replace(/\D/g, '').length > 15)) return { name, type: 'text' }
    const formats = nums.map((n) => n!.format).filter(Boolean) as NumberFormat[]
    const numberFormat = formats.length ? mostCommon(formats) : 'number'
    return { name, type: 'number', numberFormat, decimal }
  }

  // date (decide D/M vs M/D for slash dates once per column; European CSVs default to D/M)
  const dayFirst =
    ctx.delimiter === ';' ||
    filled.some((v) => {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/)
      return !!m && +m[1] > 12
    })
  if (filled.every((v) => parseDateValue(v, dayFirst))) return { name, type: 'date', dayFirst }

  if (filled.every((v) => URL_RE.test(v)) && !filled.every((v) => RELATION_TOKEN.test(v))) return { name, type: 'url' }
  if (filled.every((v) => EMAIL_RE.test(v))) return { name, type: 'email' }

  // files: every token is an attachment inside the import (or an image URL)
  if (ctx.isFile && filled.every((v) => splitList(v).every((tok) => ctx.isFile!(tok) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|pdf)(\?\S*)?$/i.test(tok))) && filled.some((v) => splitList(v).some((tok) => ctx.isFile!(tok))))
    return { name, type: 'files' }

  // relation (Notion: "Title (path.md), Other (path.md)")
  if (filled.every((v) => splitList(v).every((tok) => RELATION_TOKEN.test(tok)))) return { name, type: 'relation' }

  const maxLen = Math.max(...filled.map((v) => v.length))
  const hint = SELECT_HINT.test(name.trim())

  // multi select
  if (filled.some((v) => /,\s*/.test(v))) {
    const tokens = filled.flatMap(splitList)
    const distinct = unique(tokens)
    const shortTokens = tokens.every((tok) => tok.length <= 32 && tok.split(/\s+/).length <= 4)
    if (shortTokens && distinct.length <= 60 && (hint || (recombines(filled) && distinct.length < tokens.length && distinct.length <= Math.ceil(tokens.length * 0.8)))) {
      return { name, type: 'multi_select', options: makeOptions(distinct, false) }
    }
  }

  // select / status
  const distinct = unique(filled)
  const short = maxLen <= 40 && filled.every((v) => v.split(/\s+/).length <= 5 && !/[.!?]\s/.test(v))
  if (short && distinct.length <= 24 && (hint || (distinct.length < filled.length && distinct.length <= Math.ceil(filled.length * 0.7)))) {
    const status = STATUS_NAME.test(name.trim())
    return { name, type: status ? 'status' : 'select', options: makeOptions(distinct, status) }
  }
  return { name, type: 'text' }
}

/**
 * Do the comma-separated tokens appear in different combinations? Tags do ("a, b", "a", "b, c");
 * "Smith, John" style names don't — every token always comes with the same partners.
 */
function recombines(values: string[]): boolean {
  const cellOf = new Map<string, string>()
  for (const v of values) {
    const cell = splitList(v)
      .map((x) => x.toLowerCase())
      .join('\u0000')
    for (const tok of cell.split('\u0000')) {
      const seen = cellOf.get(tok)
      if (seen === undefined) cellOf.set(tok, cell)
      else if (seen !== cell) return true
    }
  }
  return false
}

function unique(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    const k = v.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(v)
    }
  }
  return out
}

function mostCommon<T>(arr: T[]): T {
  const m = new Map<T, number>()
  for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Infer all columns of a parsed CSV (first row = header). */
export function inferColumns(table: string[][], ctx: InferContext = {}): ColumnSpec[] {
  const [header = [], ...rows] = table
  const used = new Set<string>()
  return header.map((rawName, i) => {
    let name = rawName.trim() || (i === 0 ? 'Name' : `Column ${i + 1}`)
    // de-duplicate header names
    let n = 2
    const base = name
    while (used.has(name.toLowerCase())) name = `${base} ${n++}`
    used.add(name.toLowerCase())
    return inferColumn(name, rows.map((r) => r[i] ?? ''), i, ctx)
  })
}

/** Convert one raw cell to a stored property value (relations / files are resolved by the caller). */
export function cellValue(spec: ColumnSpec, raw: string): string | number | boolean | null | string[] | DateValue {
  const v = (raw ?? '').trim()
  switch (spec.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return v
    case 'checkbox':
      return YES.has(v.toLowerCase())
    case 'number': {
      const n = parseNumber(v, spec.decimal)
      return n ? n.value : null
    }
    case 'date':
      return v ? parseDateValue(v, spec.dayFirst) : null
    case 'select':
    case 'status': {
      if (!v) return null
      return spec.options?.find((o) => o.name.toLowerCase() === v.toLowerCase())?.id ?? null
    }
    case 'multi_select': {
      const ids: string[] = []
      for (const tok of splitList(v)) {
        const o = spec.options?.find((x) => x.name.toLowerCase() === tok.toLowerCase())
        if (o && !ids.includes(o.id)) ids.push(o.id)
      }
      return ids
    }
    case 'files':
    case 'relation':
      return splitList(v)
  }
}
