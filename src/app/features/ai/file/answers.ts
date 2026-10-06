/**
 * A file run's result → what the panel shows and what goes into the page (pure):
 *  - parsePage(output): a converted page { title, doc, images } (local 'page')
 *  - parseSheets(output): the tables of a data file (local 'database' / 'sheet')
 *  - tablesOf(run output): Claude's tables of a PDF ('tables') as sheets
 *  - dataPlan(sheet): one table as a "Turn into database" plan — the column types inferred like a CSV
 *    import (numbers, dates, checkboxes, links, selects, multi-selects; the first column names the entries)
 */
import type { JSONContent } from '@tiptap/core'
import { cellValue, inferColumns, splitList } from '../../io/import/csv'
import { TITLE_NAME, type CellValue, type PlanColumn, type PlanEntry, type TablePlan } from '../todb/plan'
import { parseTables, type ImageTable } from '../image/answers'
import type { DataSheet } from './xlsx'

export interface ParsedPage {
  title: string
  doc: JSONContent
  images: number
  /** PowerPoint: slides · pictures that come along */
  slides?: number
  media?: number
}

function json(raw: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(raw) as unknown
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parsePage(raw: string): ParsedPage | null {
  const d = json(raw)
  const doc = d?.doc as JSONContent | undefined
  if (!d || !doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return null
  return {
    title: typeof d.title === 'string' ? d.title : '',
    doc,
    images: typeof d.images === 'number' ? d.images : 0,
    ...(typeof d.slides === 'number' ? { slides: d.slides, media: typeof d.media === 'number' ? d.media : 0 } : {}),
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x))) : [])

export function parseSheets(raw: string): DataSheet[] | null {
  const d = json(raw)
  if (!d || !Array.isArray(d.sheets)) return null
  return d.sheets
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => {
      const rows = Array.isArray(s.rows) ? s.rows.map(strings) : []
      return { name: typeof s.name === 'string' ? s.name : '', header: strings(s.header), rows, total: typeof s.total === 'number' ? s.total : rows.length }
    })
    .filter((s) => s.header.length)
}

export const tableSheet = (tb: ImageTable): DataSheet => ({ name: tb.title, header: tb.header, rows: tb.rows, total: tb.rows.length })
export const sheetTable = (s: DataSheet): ImageTable => ({ title: s.name, header: s.header, rows: s.rows })

/** Claude's tables (null: not the JSON asked for; [] = none found). */
export function tablesOf(raw: string): DataSheet[] | null {
  const tables = parseTables(raw)
  return tables ? tables.map(tableSheet) : null
}

/** One table as a database plan (header names: empty ones "Column 3"; one clashing with the title renamed). */
export function dataPlan(sheet: DataSheet, names: { untitled: string; column: (n: number) => string }): { plan: TablePlan; titleName: string } {
  const header = sheet.header.map((h, i) => h.trim() || names.column(i + 1))
  const specs = inferColumns([header, ...sheet.rows])
  const used = new Set<string>([TITLE_NAME.toLowerCase()])
  const columns: Array<PlanColumn & { index: number }> = specs.slice(1).map((spec, k) => {
    let name = spec.name
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${spec.name} ${n}`
    used.add(name.toLowerCase())
    const type: PlanColumn['type'] =
      spec.type === 'number' || spec.type === 'date' || spec.type === 'checkbox' || spec.type === 'url' || spec.type === 'multi_select'
        ? spec.type
        : spec.type === 'select' || spec.type === 'status'
          ? 'select'
          : 'text'
    const options = type === 'select' || type === 'multi_select' ? (spec.options ?? []).map((o) => o.name) : []
    return { name, type, options, index: k + 1 }
  })
  const entries: PlanEntry[] = sheet.rows.map((r) => {
    const values: PlanEntry['values'] = {}
    columns.forEach((c) => {
      const raw = (r[c.index] ?? '').trim()
      if (!raw) return
      let v: CellValue = raw
      if (c.type === 'number') {
        const n = cellValue(specs[c.index], raw)
        if (typeof n === 'number') v = n
      } else if (c.type === 'checkbox') v = cellValue(specs[c.index], raw) === true
      else if (c.type === 'multi_select') v = splitList(raw)
      values[c.name] = v
    })
    return { title: (r[0] ?? '').trim(), values, body: null }
  })
  return {
    // the file itself stays on the page: "1 block kept"
    plan: { title: sheet.name.trim() || names.untitled, columns: columns.map(({ index: _i, ...c }) => c), entries, groupBy: null, keep: [0] },
    titleName: specs[0]?.name || TITLE_NAME,
  }
}
