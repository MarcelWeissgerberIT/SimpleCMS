/**
 * Computing a spreadsheet's values outside the grid UI: exports (Markdown, HTML), static renders,
 * charts (readSheetData). One workbook per attrs object (memoised), custom functions taken from
 * the workspace before computing.
 */
import { useWorkspace } from '../../store/store'
import type { CustomFunction } from '../../store/types'
import {
  a1,
  BOOL_TEXT,
  cellsOf,
  formatValue,
  isDataset,
  isErr,
  isRange,
  setCustomFunctions,
  Workbook,
  type Area,
  type CellValue,
  type DatasetSource,
  type SheetSource,
  type Value,
  type ValueHint,
} from './engine'
import { readAttrs, type SheetData, type SpreadsheetAttrs } from './model'

type Lang = 'en' | 'de'

let syncedFunctions: Record<string, CustomFunction> | undefined | null = null

/** Register the workspace's custom functions with the engine when they changed (cheap identity check). */
export function syncCustomFunctions(): void {
  const fns = useWorkspace.getState().functions
  if (fns === syncedFunctions) return
  syncedFunctions = fns
  setCustomFunctions(Object.values(fns ?? {}))
}

export const sheetSources = (a: SpreadsheetAttrs): SheetSource[] => a.sheets.map((s) => ({ id: s.id, name: s.name, rows: s.rows, cols: s.cols, cells: s.cells }))
export const datasetSources = (a: SpreadsheetAttrs): DatasetSource[] => a.datasets.map((d) => ({ id: d.id, name: d.name, ranges: d.ranges }))

const books = new WeakMap<SpreadsheetAttrs, Workbook>()
/** by block id: successive versions of a block's attrs recalculate incrementally (charts, exports) */
const byBlock = new Map<string, Workbook>()
const BLOCKS_KEPT = 16

/** The computed workbook of a block's attrs (kept per block id, else per attrs object). */
export function workbookOf(attrs: SpreadsheetAttrs, lang: Lang = currentLang()): Workbook {
  syncCustomFunctions()
  let wb = attrs.id ? byBlock.get(attrs.id) : books.get(attrs)
  if (!wb || wb.lang !== lang) {
    wb = new Workbook({ lang })
    if (attrs.id) {
      byBlock.set(attrs.id, wb)
      if (byBlock.size > BLOCKS_KEPT) byBlock.delete(byBlock.keys().next().value!)
    } else books.set(attrs, wb)
  } else if (attrs.id) {
    // most recently used last
    byBlock.delete(attrs.id)
    byBlock.set(attrs.id, wb)
  }
  wb.sync(sheetSources(attrs), datasetSources(attrs))
  return wb
}

export const currentLang = (): Lang => useWorkspace.getState().settings.language

/** The used part of a sheet: up to the last row / column holding something (at least 1×1). */
export function usedSize(sheet: SheetData): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  for (const addr of Object.keys(sheet.cells)) {
    if (!sheet.cells[addr]?.v) continue
    const m = /^([A-Z]+)(\d+)$/.exec(addr)
    if (!m) continue
    let c = 0
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64
    rows = Math.max(rows, Number(m[2]))
    cols = Math.max(cols, c)
  }
  return { rows: Math.min(rows, sheet.rows), cols: Math.min(cols, sheet.cols) }
}

export interface DisplayCell {
  text: string
  align: 'left' | 'center' | 'right'
  b?: boolean
  i?: boolean
  error?: boolean
}

/** Default alignment: numbers right, text left, booleans / errors centred. */
export function autoAlign(v: CellValue): DisplayCell['align'] {
  if (typeof v === 'number') return 'right'
  if (typeof v === 'boolean' || isErr(v)) return 'center'
  return 'left'
}

/** What every used cell of a sheet shows (static renders, Markdown, CSV). */
export function displayGrid(attrs: SpreadsheetAttrs, sheet: SheetData, lang: Lang = currentLang()): DisplayCell[][] {
  const wb = workbookOf(attrs, lang)
  const { rows, cols } = usedSize(sheet)
  const out: DisplayCell[][] = []
  for (let r = 0; r < rows; r++) {
    const row: DisplayCell[] = []
    for (let c = 0; c < cols; c++) {
      const cell = sheet.cells[a1(r, c)]
      const info = wb.get(sheet.id, r, c)
      row.push({
        text: formatValue(info.value, cell?.fmt, info.hint, lang),
        align: cell?.align ?? autoAlign(info.value),
        b: cell?.b,
        i: cell?.i,
        error: isErr(info.value),
      })
    }
    out.push(row)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Charts: values of a reference                                       */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0')

/** A computed value as chart input: errors → null, dates → "2026-10-03". */
function chartCell(v: CellValue, hint: ValueHint, lang: Lang): number | string | boolean | null {
  if (v === null || isErr(v)) return null
  if (typeof v === 'number' && (hint === 'date' || hint === 'datetime')) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (typeof v === 'boolean') return BOOL_TEXT[lang][v ? 0 : 1]
  return v
}

function areaRows(wb: Workbook, a: Area, lang: Lang): Array<Array<number | string | boolean | null>> {
  return a.values.map((row, r) => row.map((v, c) => chartCell(v, a.sheetId ? wb.hint(a.sheetId, a.top + r, a.left + c) : null, lang)))
}

/**
 * Computed values for an A1 range ("B2:D9"), a cross-sheet ref ("'Q1 Budget'!A1:C4"), DS(...)
 * (several areas stacked in order, narrower ones padded) or a named dataset ("Revenue" /
 * "DS(Revenue)"). Unqualified refs read the active sheet (or `opts.sheetId`). `error`: a plain-language reason.
 */
export function readSheetData(rawAttrs: Record<string, unknown> | SpreadsheetAttrs, ref: string, opts: { lang?: Lang; sheetId?: string } = {}): { values: Array<Array<number | string | boolean | null>>; error?: string } {
  const attrs = readAttrs(rawAttrs)
  const sheetId = opts.sheetId && attrs.sheets.some((s) => s.id === opts.sheetId) ? opts.sheetId : attrs.active
  const lang = opts.lang ?? currentLang()
  const body = (ref ?? '').trim().replace(/^=/, '')
  if (!body) return { values: [], error: 'No range selected.' }
  const wb = workbookOf(attrs, lang)
  const v: Value = wb.evaluate(body, sheetId)
  if (isErr(v)) return { values: [], error: v.msg ? `${v.code} — ${v.msg}` : v.code }
  if (isRange(v)) return { values: areaRows(wb, v, lang) }
  if (isDataset(v)) {
    const rows = v.areas.flatMap((a) => areaRows(wb, a, lang))
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
    return { values: rows.map((r) => (r.length < width ? [...r, ...new Array(width - r.length).fill(null)] : r)) }
  }
  return { values: [[chartCell(v, null, lang)]] }
}

/** Every cell value of a reference, flat (status line, tests). */
export function flatValues(v: Value): CellValue[] {
  return [...cellsOf(v)]
}
