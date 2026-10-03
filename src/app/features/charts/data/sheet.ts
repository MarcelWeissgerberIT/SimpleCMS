/**
 * Spreadsheet source: a `spreadsheet` block on any page (found by its `id` attr in the page's
 * stored content — in team workspaces the last known content), read through the spreadsheets
 * area's readSheetData(attrs, ref): computed values of a range, a cross-sheet ref, DS(…) or a
 * named dataset. The spreadsheets module is loaded on first use.
 */
import type { JSONContent } from '@tiptap/core'
import type { ID, Page } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { CellValue } from '../types'

export interface SheetsApi {
  readSheetData: (attrs: Record<string, unknown>, ref: string) => { values: CellValue[][]; error?: string }
}

// resolved at build time: an empty map until the spreadsheets area exists
const modules = import.meta.glob<SheetsApi>('../../sheets/index.ts')
let api: SheetsApi | null = null
let loading: Promise<SheetsApi | null> | null = null
const waiting = new Set<() => void>()

/** The spreadsheets API once loaded (null before / when unavailable). */
export function sheetsApi(): SheetsApi | null {
  if (!api) void loadSheets()
  return api
}

export function sheetsAvailable(): boolean {
  return Object.keys(modules).length > 0
}

export function loadSheets(): Promise<SheetsApi | null> {
  if (api) return Promise.resolve(api)
  const load = Object.values(modules)[0]
  if (!load) return Promise.resolve(null)
  loading ??= load()
    .then((m) => {
      api = typeof m?.readSheetData === 'function' ? m : null
      waiting.forEach((fn) => fn())
      waiting.clear()
      return api
    })
    .catch((err) => {
      console.warn('[charts] spreadsheets unavailable', err)
      loading = null
      return null
    })
  return loading
}

/** Re-render when the spreadsheets module arrives. */
export function onSheetsLoaded(fn: () => void): () => void {
  if (api) return () => {}
  waiting.add(fn)
  return () => waiting.delete(fn)
}

/* ------------------------------------------------------------------ */
/* Finding spreadsheet blocks                                          */
/* ------------------------------------------------------------------ */

export const SHEET_NODE = 'spreadsheet'

export interface SheetInfo {
  id: string
  name: string
}

export interface SpreadsheetRef {
  pageId: ID
  blockId: string
  title: string
  attrs: Record<string, unknown>
  sheets: SheetInfo[]
  datasets: string[]
}

const cache = new WeakMap<JSONContent, Map<string, Record<string, unknown>>>()

/** Spreadsheet blocks of a doc by block id (cached per content object). */
export function spreadsheetsIn(content: JSONContent | null | undefined): Map<string, Record<string, unknown>> {
  if (!content) return new Map()
  const hit = cache.get(content)
  if (hit) return hit
  const out = new Map<string, Record<string, unknown>>()
  const walk = (n: JSONContent) => {
    if (n.type === SHEET_NODE) {
      const id = typeof n.attrs?.id === 'string' ? n.attrs.id : ''
      if (id) out.set(id, (n.attrs ?? {}) as Record<string, unknown>)
      return
    }
    n.content?.forEach(walk)
  }
  walk(content)
  cache.set(content, out)
  return out
}

export function findSpreadsheet(pageId: ID, blockId: string, pages: Record<ID, Page> = useWorkspace.getState().pages): Record<string, unknown> | null {
  const page = pages[pageId]
  if (!page || page.trashed) return null
  return spreadsheetsIn(page.content).get(blockId) ?? null
}

export function sheetList(attrs: Record<string, unknown>): SheetInfo[] {
  const raw = Array.isArray(attrs.sheets) ? attrs.sheets : []
  return raw
    .filter((s): s is { id: string; name: string } => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string')
    .map((s) => ({ id: s.id, name: typeof s.name === 'string' && s.name ? s.name : s.id }))
}

export function datasetNames(attrs: Record<string, unknown>): string[] {
  const raw = Array.isArray(attrs.datasets) ? attrs.datasets : []
  return raw.map((d) => (d && typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string' ? (d as { name: string }).name : '')).filter(Boolean)
}

/** Every spreadsheet block in the live workspace (pickers), page order by title. */
export function allSpreadsheets(): SpreadsheetRef[] {
  const pages = useWorkspace.getState().pages
  const out: SpreadsheetRef[] = []
  for (const p of Object.values(pages)) {
    if (!p.content || p.trashed) continue
    const blocks = spreadsheetsIn(p.content)
    if (!blocks.size || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    for (const [blockId, attrs] of blocks)
      out.push({ pageId: p.id, blockId, title: typeof attrs.title === 'string' ? attrs.title : '', attrs, sheets: sheetList(attrs), datasets: datasetNames(attrs) })
  }
  return out
}

const colName = (n: number): string => {
  let s = ''
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/** "'Sheet name'!A1:D12" — the used cells of a sheet (the active one by default). */
export function usedRange(attrs: Record<string, unknown>, sheetId?: string): string {
  const sheets = Array.isArray(attrs.sheets) ? (attrs.sheets as Array<Record<string, unknown>>) : []
  const sheet = sheets.find((s) => s?.id === (sheetId ?? attrs.active)) ?? sheets[0]
  if (!sheet) return 'A1:A1'
  const cells = (sheet.cells && typeof sheet.cells === 'object' ? sheet.cells : {}) as Record<string, { v?: unknown }>
  let maxR = 0
  let maxC = 0
  for (const [key, cell] of Object.entries(cells)) {
    if (cell?.v === undefined || cell.v === null || cell.v === '') continue
    const m = key.match(/^([A-Z]+)(\d+)$/)
    if (!m) continue
    let c = 0
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
    maxC = Math.max(maxC, c - 1)
    maxR = Math.max(maxR, Number(m[2]))
  }
  const name = typeof sheet.name === 'string' && sheet.name ? sheet.name : ''
  const range = `A1:${colName(maxC)}${Math.max(1, maxR)}`
  return name ? `'${name.replace(/'/g, "''")}'!${range}` : range
}
