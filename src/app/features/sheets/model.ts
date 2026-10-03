/**
 * The `spreadsheet` node's attrs: types, defaults and the sanitizer every copy from outside goes
 * through (paste, sync, import, team documents). Bounded sizes, known keys only, fresh objects.
 */
import type { ColorName } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { newId } from '../../lib/ids'
import { colIndex, colName, isA1Like, MAX_COLS, MAX_ROWS, parseA1, parseRect, type CellFormat } from './engine'
import { getFunction } from './engine'

export type Align = 'left' | 'center' | 'right'

export interface SheetCell {
  /** raw input: a value or a formula ("=SUM(A1:A3)") */
  v?: string
  fmt?: CellFormat
  b?: boolean
  i?: boolean
  align?: Align
}

export interface SheetData {
  id: string
  name: string
  rows: number
  cols: number
  /** by address ("A1") */
  cells: Record<string, SheetCell>
  /** by column letter ("A") */
  colWidths: Record<string, number>
  frozenRows?: number
}

export interface DatasetDef {
  id: string
  /** letters, digits, _ ; unique; not a function name; not A1-like */
  name: string
  color: ColorName
  /** sheet = sheet id (survives renames); ref = 'A1:A10' | 'B:B' | 'C3' */
  ranges: Array<{ sheet: string; ref: string }>
}

/** A chart of the spreadsheet (spec: the charts module's ChartSpec, source.kind 'inline'). */
export interface SheetChart {
  id: string
  /** sheet id: the chart sits under that sheet's grid */
  sheet: string
  spec: Record<string, unknown> & { source?: { kind?: string; ref?: string } }
}

export interface SpreadsheetAttrs {
  id: string | null
  title: string
  sheets: SheetData[]
  active: string
  datasets: DatasetDef[]
  charts: SheetChart[]
}

export const LIMITS = {
  sheets: 50,
  datasets: 100,
  datasetRanges: 32,
  charts: 50,
  name: 64,
  title: 200,
  value: 32_000,
  colWidth: { min: 36, max: 800 },
  frozenRows: 10,
} as const

export const DEFAULT_ROWS = 20
export const DEFAULT_COLS = 8
export const DEFAULT_WIDTH = 104
export const ROW_HEIGHT = 28

/** Colours for datasets / formula groups: the content palette without default (orange last — signal orange is the active cell). */
export const DS_COLORS: ColorName[] = ['blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray', 'orange']

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const FORMATS = new Set(['auto', 'number', 'percent', 'currency', 'date', 'text'])
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const safeId = (v: unknown): string => (typeof v === 'string' && SAFE_ID.test(v) && !RESERVED.has(v) ? v : newId())
const clampInt = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d)

/** Dataset names: letters, digits, _ (starting with a letter / _), ≤ 32, not A1-like, not TRUE/FALSE, not a function. */
export function datasetNameProblem(name: string, others: DatasetDef[], selfId?: string): 'empty' | 'chars' | 'cell' | 'function' | 'taken' | null {
  if (!name) return 'empty'
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name)) return 'chars'
  if (isA1Like(name) || /^[A-Za-z]{1,3}$/.test(name) || /^(TRUE|FALSE)$/i.test(name)) return 'cell'
  if (getFunction(name)) return 'function'
  if (others.some((d) => d.id !== selfId && d.name.toLowerCase() === name.toLowerCase())) return 'taken'
  return null
}

function readFormat(raw: unknown): CellFormat | undefined {
  if (!isObj(raw)) return undefined
  const type = own(raw, 'type')
  if (typeof type !== 'string' || !FORMATS.has(type) || type === 'auto') {
    const dec = own(raw, 'decimals')
    return typeof dec === 'number' ? { type: 'auto', decimals: clampInt(dec, 0, 10, 2) } : undefined
  }
  const fmt: CellFormat = { type: type as CellFormat['type'] }
  const dec = own(raw, 'decimals')
  if (typeof dec === 'number') fmt.decimals = clampInt(dec, 0, 10, 2)
  const cur = own(raw, 'currency')
  if (type === 'currency') fmt.currency = cur === 'USD' ? 'USD' : 'EUR'
  return fmt
}

function readCell(raw: unknown): SheetCell | null {
  if (!isObj(raw)) return typeof raw === 'string' && raw ? { v: raw.slice(0, LIMITS.value) } : null
  const out: SheetCell = {}
  const v = own(raw, 'v')
  if (typeof v === 'string' && v) out.v = v.slice(0, LIMITS.value)
  else if (typeof v === 'number' && Number.isFinite(v)) out.v = String(v)
  const fmt = readFormat(own(raw, 'fmt'))
  if (fmt) out.fmt = fmt
  if (own(raw, 'b') === true) out.b = true
  if (own(raw, 'i') === true) out.i = true
  const align = own(raw, 'align')
  if (align === 'left' || align === 'center' || align === 'right') out.align = align
  return Object.keys(out).length ? out : null
}

function readSheet(raw: unknown, index: number, names: Set<string>): SheetData | null {
  if (!isObj(raw)) return null
  const rows = clampInt(own(raw, 'rows'), 1, MAX_ROWS, DEFAULT_ROWS)
  const cols = clampInt(own(raw, 'cols'), 1, MAX_COLS, DEFAULT_COLS)
  let name = str(own(raw, 'name'), LIMITS.name).trim() || `Sheet ${index + 1}`
  if (names.has(name.toLowerCase())) {
    let n = 2
    while (names.has(`${name} (${n})`.toLowerCase())) n++
    name = `${name} (${n})`
  }
  names.add(name.toLowerCase())
  const cells: Record<string, SheetCell> = {}
  const rawCells = own(raw, 'cells')
  if (isObj(rawCells)) {
    for (const addr of Object.keys(rawCells)) {
      const pos = parseA1(addr)
      if (!pos || pos.row >= rows || pos.col >= cols) continue
      const c = readCell(own(rawCells, addr))
      if (c) cells[`${colName(pos.col)}${pos.row + 1}`] = c
    }
  }
  const colWidths: Record<string, number> = {}
  const rawW = own(raw, 'colWidths')
  if (isObj(rawW)) {
    for (const k of Object.keys(rawW)) {
      if (!/^[A-Z]{1,3}$/.test(k) || colIndex(k) >= cols) continue
      const w = own(rawW, k)
      if (typeof w === 'number' && Number.isFinite(w)) colWidths[k] = clampInt(w, LIMITS.colWidth.min, LIMITS.colWidth.max, DEFAULT_WIDTH)
    }
  }
  const sheet: SheetData = { id: safeId(own(raw, 'id')), name, rows, cols, cells, colWidths }
  const frozen = clampInt(own(raw, 'frozenRows'), 0, LIMITS.frozenRows, 0)
  if (frozen) sheet.frozenRows = frozen
  return sheet
}

function readDatasets(raw: unknown, sheets: SheetData[]): DatasetDef[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(sheets.map((s) => s.id))
  const out: DatasetDef[] = []
  for (const d of raw.slice(0, LIMITS.datasets)) {
    if (!isObj(d)) continue
    const name = str(own(d, 'name'), 32)
    if (datasetNameProblem(name, out)) continue
    const color = COLOR_NAMES.includes(own(d, 'color') as ColorName) ? (own(d, 'color') as ColorName) : 'blue'
    const ranges: DatasetDef['ranges'] = []
    const rr = own(d, 'ranges')
    if (Array.isArray(rr)) {
      for (const r of rr.slice(0, LIMITS.datasetRanges)) {
        if (!isObj(r)) continue
        const sheet = own(r, 'sheet')
        const ref = own(r, 'ref')
        if (typeof sheet === 'string' && ids.has(sheet) && typeof ref === 'string' && parseRect(ref)) ranges.push({ sheet, ref: ref.toUpperCase().replace(/\$/g, '') })
      }
    }
    out.push({ id: safeId(own(d, 'id')), name, color, ranges })
  }
  return out
}

function plainJson(v: unknown, depth = 0): unknown {
  if (depth > 8) return null
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'string' ? v.slice(0, 2000) : v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => plainJson(x, depth + 1))
  if (isObj(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).slice(0, 50)) if (!RESERVED.has(k)) out[k] = plainJson(own(v, k), depth + 1)
    return out
  }
  return null
}

function readCharts(raw: unknown, sheets: SheetData[]): SheetChart[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(sheets.map((s) => s.id))
  const out: SheetChart[] = []
  for (const c of raw.slice(0, LIMITS.charts)) {
    if (!isObj(c)) continue
    const sheet = own(c, 'sheet')
    const spec = plainJson(own(c, 'spec'))
    if (typeof sheet !== 'string' || !ids.has(sheet) || !isObj(spec)) continue
    out.push({ id: safeId(own(c, 'id')), sheet, spec: spec as SheetChart['spec'] })
  }
  return out
}

const cache = new WeakMap<object, SpreadsheetAttrs>()

/** Typed, sanitized attrs (memoised per attrs object). */
export function readAttrs(raw: Record<string, unknown> | null | undefined): SpreadsheetAttrs {
  if (raw && cache.has(raw)) return cache.get(raw)!
  const src = isObj(raw) ? raw : {}
  const names = new Set<string>()
  const sheetsRaw = own(src, 'sheets')
  const list = typeof sheetsRaw === 'string' ? safeParse(sheetsRaw) : sheetsRaw
  const sheets: SheetData[] = []
  const ids = new Set<string>()
  if (Array.isArray(list)) {
    for (const s of list.slice(0, LIMITS.sheets)) {
      const sheet = readSheet(s, sheets.length, names)
      if (!sheet) continue
      if (ids.has(sheet.id)) sheet.id = newId()
      ids.add(sheet.id)
      sheets.push(sheet)
    }
  }
  if (!sheets.length) sheets.push(newSheet('Sheet 1'))
  const active = own(src, 'active')
  const dsRaw = own(src, 'datasets')
  const chRaw = own(src, 'charts')
  const out: SpreadsheetAttrs = {
    id: typeof own(src, 'id') === 'string' && own(src, 'id') ? (own(src, 'id') as string) : null,
    title: str(own(src, 'title'), LIMITS.title),
    sheets,
    active: typeof active === 'string' && sheets.some((s) => s.id === active) ? active : sheets[0].id,
    datasets: readDatasets(typeof dsRaw === 'string' ? safeParse(dsRaw) : dsRaw, sheets),
    charts: readCharts(typeof chRaw === 'string' ? safeParse(chRaw) : chRaw, sheets),
  }
  if (raw) cache.set(raw, out)
  return out
}

function safeParse(s: string): unknown {
  if (s.length > 20_000_000) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export function newSheet(name: string, rows = DEFAULT_ROWS, cols = DEFAULT_COLS): SheetData {
  return { id: newId(), name, rows, cols, cells: {}, colWidths: {} }
}

/** Attrs of a new block (sheet name in the UI language). */
export function newSpreadsheetAttrs(sheetName: string): Omit<SpreadsheetAttrs, 'id'> {
  const sheet = newSheet(sheetName)
  return { title: '', sheets: [sheet], active: sheet.id, datasets: [], charts: [] }
}

export const colWidth = (sheet: SheetData, col: number): number => sheet.colWidths[colName(col)] ?? DEFAULT_WIDTH

export const activeSheet = (a: SpreadsheetAttrs): SheetData => a.sheets.find((s) => s.id === a.active) ?? a.sheets[0]
