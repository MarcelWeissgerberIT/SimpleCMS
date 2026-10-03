/** Value constructors, type tests and Excel-style coercions. */
import type { Area, CellValue, DatasetValue, ErrorCode, ErrorValue, RangeValue, Scalar, Value } from './types'

export const MAX_STRING = 32_000

const ERRORS = new Map<string, ErrorValue>()
/** An error value (shared instances when there is no message). */
export function err(code: ErrorCode, msg?: string): ErrorValue {
  if (msg) return Object.freeze({ kind: 'error', code, msg })
  let e = ERRORS.get(code)
  if (!e) ERRORS.set(code, (e = Object.freeze({ kind: 'error', code })))
  return e
}

export const ERROR_CODES: ErrorCode[] = ['#DIV/0!', '#REF!', '#NAME?', '#VALUE!', '#N/A', '#CYCLE!', '#NUM!', '#ERROR!']

export const isErr = (v: unknown): v is ErrorValue => !!v && typeof v === 'object' && (v as ErrorValue).kind === 'error'
export const isRange = (v: unknown): v is RangeValue => !!v && typeof v === 'object' && (v as RangeValue).kind === 'range'
export const isDataset = (v: unknown): v is DatasetValue => !!v && typeof v === 'object' && (v as DatasetValue).kind === 'dataset'
/** A range or a dataset (anything that holds several cells). */
export const isMulti = (v: unknown): v is RangeValue | DatasetValue => isRange(v) || isDataset(v)

export function rangeValue(a: Area): RangeValue {
  return { kind: 'range', sheetId: a.sheetId, top: a.top, left: a.left, rows: a.rows, cols: a.cols, values: a.values }
}

/** A dataset of loose values (custom-function test bench): one column, one area. */
export function datasetOf(values: CellValue[], sheetId = ''): DatasetValue {
  return { kind: 'dataset', areas: [{ sheetId, top: 0, left: 0, rows: values.length, cols: values.length ? 1 : 0, values: values.map((v) => [v]) }] }
}

/** The areas of a range / dataset (a scalar becomes a 1×1 area of its own). */
export function areasOf(v: Value): Area[] {
  if (isDataset(v)) return v.areas
  if (isRange(v)) return [v]
  return [{ sheetId: '', top: 0, left: 0, rows: 1, cols: 1, values: [[v]] }]
}

/** The one rectangle of a range or single-area dataset (VLOOKUP, INDEX …); null for several areas. */
export function singleArea(v: Value): Area | null {
  if (isRange(v)) return v
  if (isDataset(v)) return v.areas.length === 1 ? v.areas[0] : null
  return { sheetId: '', top: 0, left: 0, rows: 1, cols: 1, values: [[v as CellValue]] }
}

/**
 * Every cell of ranges / datasets in order (row by row, area by area); a cell shared by two
 * areas of a dataset is visited once.
 */
export function* cellsOf(v: Value): Generator<CellValue> {
  if (isRange(v)) {
    for (const row of v.values) for (const c of row) yield c
    return
  }
  if (isDataset(v)) {
    const seen = v.areas.length > 1 ? new Set<string>() : null
    for (const a of v.areas) {
      for (let r = 0; r < a.rows; r++)
        for (let c = 0; c < a.cols; c++) {
          if (seen) {
            const k = `${a.sheetId}|${a.top + r}|${a.left + c}`
            if (seen.has(k)) continue
            seen.add(k)
          }
          yield a.values[r]?.[c] ?? null
        }
    }
    return
  }
  yield v
}

/** A single value: 1×1 ranges / datasets unwrap, bigger ones are #VALUE! (no implicit intersection). */
export function toScalar(v: Value): CellValue {
  if (isRange(v)) return v.rows === 1 && v.cols === 1 ? (v.values[0]?.[0] ?? null) : err('#VALUE!', 'a range where one value was expected')
  if (isDataset(v)) {
    const cells = [...cellsOf(v)]
    return cells.length === 1 ? cells[0] : err('#VALUE!', 'a dataset where one value was expected')
  }
  return v
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** Numeric text ("12", "1.5e3", "12%", "2026-10-03") → number; null when it isn't numeric. */
export function parseNumeric(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (NUM_RE.test(t)) return Number(t)
  if (t.endsWith('%')) {
    const n = t.slice(0, -1).trim()
    return NUM_RE.test(n) ? Number(n) / 100 : null
  }
  const d = ISO_DATE_RE.exec(t)
  if (d) {
    const serial = serialOf(+d[1], +d[2], +d[3])
    if (serial === null) return null
    return serial + (d[4] ? (+d[4] * 3600 + +d[5] * 60 + (d[6] ? +d[6] : 0)) / 86400 : 0)
  }
  return null
}

/** Days since 1899-12-30 (the spreadsheet date serial); null for an impossible date. */
export function serialOf(y: number, m: number, d: number): number | null {
  if (![y, m, d].every(Number.isFinite)) return null
  const t = Date.UTC(y, m - 1, d)
  if (!Number.isFinite(t)) return null
  const dt = new Date(t)
  // reject 2026-02-31 in parsed text (DATE() normalises on its own)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return Math.round((t - EPOCH) / DAY)
}

export const DAY = 86_400_000
export const EPOCH = Date.UTC(1899, 11, 30)

export function toNumber(v: Value): number | ErrorValue {
  const s = toScalar(v)
  if (s === null) return 0
  if (typeof s === 'number') return s
  if (typeof s === 'boolean') return s ? 1 : 0
  if (typeof s === 'string') {
    const n = parseNumeric(s)
    return n === null ? err('#VALUE!', `"${s.slice(0, 40)}" is not a number`) : n
  }
  return s
}

/** General number → text (up to 15 significant digits, no grouping, "." decimals). */
export function numberText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n)
  const p = Number(n.toPrecision(15))
  return String(p)
}

export function toText(v: Value): string | ErrorValue {
  const s = toScalar(v)
  if (s === null) return ''
  if (typeof s === 'string') return s
  if (typeof s === 'number') return numberText(s)
  if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE'
  return s
}

export function toBool(v: Value): boolean | ErrorValue {
  const s = toScalar(v)
  if (s === null) return false
  if (typeof s === 'boolean') return s
  if (typeof s === 'number') return s !== 0
  if (typeof s === 'string') {
    const u = s.trim().toUpperCase()
    if (u === 'TRUE' || u === 'WAHR') return true
    if (u === 'FALSE' || u === 'FALSCH') return false
    return err('#VALUE!', 'not TRUE or FALSE')
  }
  return s
}

/** A finite number result, #NUM! otherwise. */
export function num(n: number): number | ErrorValue {
  return Number.isFinite(n) ? n : err('#NUM!', 'the result is not a finite number')
}

/** A text result within the length limit. */
export function text(s: string): string | ErrorValue {
  return s.length > MAX_STRING ? err('#VALUE!', 'text longer than 32,000 characters') : s
}

/** The first error among values (or null). */
export function firstError(...vals: unknown[]): ErrorValue | null {
  for (const v of vals) if (isErr(v)) return v
  return null
}

/** Type rank for comparisons: numbers < text < booleans (Excel). */
function rank(v: Scalar): number {
  return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0
}

/** Excel comparison (text case-insensitive; blank equals 0 / "" / FALSE). */
export function compare(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x === y ? 0 : x < y ? -1 : 1
  }
  return Number(a) - Number(b)
}
