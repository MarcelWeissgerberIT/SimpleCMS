/**
 * SPREADSHEETS — public API (re-exported from features/index.ts).
 *
 *  Engine (pure, safe: no eval / Function; limits: formula 8k chars, depth 64, 2M steps per
 *  recalculation, custom-function call depth 32, text 32k, ranges capped to the sheet):
 *   - registerFunctions / getFunction / listFunctions / setCustomFunctions (custom functions:
 *     names may not shadow built-ins) · registryVersion / subscribeRegistry
 *   - callFunction(name, args) · evaluateExpr(expr, params) — no cells (test bench, database formulas)
 *   - Value types (number | text | boolean | blank | error | range | dataset) + helpers
 *   - Workbook (dependency graph, incremental recalculation), formatValue, reference adjustment
 *
 *  Block (`spreadsheet` node, attrs: id, title, sheets, active, datasets, charts):
 *   - readAttrs(attrs) / newSpreadsheetAttrs(name): typed + sanitized attrs
 *   - readSheetData(attrs, ref): computed values of 'B2:D9', "'Q1'!A1:C4", 'DS(…)' or a dataset name
 *   - spreadsheetMarkdown / spreadsheetHTML: exports with computed values
 *   - loadSheetBlock(): the grid UI (lazy chunk)
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { SpreadsheetAttrs } from './model'

export * from './engine'
export {
  readAttrs,
  newSpreadsheetAttrs,
  newSheet,
  datasetNameProblem,
  activeSheet,
  colWidth,
  DS_COLORS,
  LIMITS as SHEET_LIMITS,
  DEFAULT_ROWS,
  DEFAULT_COLS,
  type SpreadsheetAttrs,
  type SheetData,
  type SheetCell,
  type DatasetDef,
  type SheetChart,
  type Align,
} from './model'
export { readSheetData, workbookOf, displayGrid, usedSize, syncCustomFunctions, type DisplayCell } from './compute'
export { spreadsheetHTML, spreadsheetMarkdown, spreadsheetText, sheetCsv, sheetLabel } from './static'

/** Props of the grid UI (the editor's node view renders it). */
export interface SheetBlockProps {
  /** the node's attrs (sanitized inside) */
  attrs: Record<string, unknown>
  /** write attrs (one undo step) */
  update: (patch: Partial<Omit<SpreadsheetAttrs, 'id'>>) => void
  editable: boolean
  /** the TipTap editor (undo / redo, focus) */
  editor: Editor
  /** page the block lives on (charts placed as blocks point here) */
  pageId: string | null
  /** insert a block right after this one */
  insertAfter: (json: JSONContent) => void
}

/** The grid UI, a lazy chunk: loadSheetBlock().then((m) => m.SheetBlock). */
export const loadSheetBlock = () => import('./ui/SheetBlock')
