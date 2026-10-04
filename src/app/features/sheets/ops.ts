/**
 * Edits of a spreadsheet's attrs (pure: attrs in, attrs patch out). Structural edits keep every
 * reference right: formulas on all sheets, named datasets and chart sources follow inserted /
 * deleted rows and columns and renamed sheets; deleted targets become #REF!.
 */
import { newId } from '../../lib/ids'
import {
  a1,
  adjustExpression,
  adjustFormula,
  adjustRect,
  colIndex,
  colName,
  dropSheetRefs,
  fillLine,
  lex,
  MAX_COLS,
  MAX_ROWS,
  parseA1,
  renameSheetInExpression,
  renameSheetRefs,
  rewriteRefs,
  sameName,
  shiftFormula,
  type FillMode,
  type Rect,
  type StructOp,
} from './engine'
import { LIMITS, type DatasetDef, type SheetCell, type SheetChart, type SheetData, type SpreadsheetAttrs } from './model'

type A = SpreadsheetAttrs
export type Patch = Partial<Omit<A, 'id'>>

export interface Pos {
  r: number
  c: number
}

const sheetOf = (a: A, id: string) => a.sheets.find((s) => s.id === id) ?? null
const mapSheet = (a: A, id: string, fn: (s: SheetData) => SheetData): SheetData[] => a.sheets.map((s) => (s.id === id ? fn(s) : s))

function sheetIdOf(a: A) {
  return (name: string) => a.sheets.find((s) => sameName(s.name, name))?.id ?? null
}

/** Set (or with null: clear) cells of a sheet. Cells left without content and format are dropped. */
export function setCells(a: A, sheetId: string, changes: Record<string, SheetCell | null>): Patch {
  return {
    sheets: mapSheet(a, sheetId, (s) => {
      const cells = { ...s.cells }
      for (const [addr, cell] of Object.entries(changes)) {
        const pos = parseA1(addr)
        if (!pos || pos.row >= s.rows || pos.col >= s.cols) continue
        const clean = cell ? compact(cell) : null
        if (clean) cells[addr] = clean
        else delete cells[addr]
      }
      return { ...s, cells }
    }),
  }
}

function compact(c: SheetCell): SheetCell | null {
  const out: SheetCell = {}
  if (c.v) out.v = c.v.slice(0, LIMITS.value)
  if (c.fmt && (c.fmt.type !== 'auto' || c.fmt.decimals !== undefined)) out.fmt = c.fmt
  if (c.b) out.b = true
  if (c.i) out.i = true
  if (c.align) out.align = c.align
  return Object.keys(out).length ? out : null
}

/** Every formula of every sheet through `fn` (sheet id of the formula's sheet passed along). */
function mapFormulas(sheets: SheetData[], fn: (raw: string, sheetId: string) => string): SheetData[] {
  return sheets.map((s) => {
    let cells: Record<string, SheetCell> | null = null
    for (const [addr, cell] of Object.entries(s.cells)) {
      if (!cell.v || cell.v[0] !== '=') continue
      const next = fn(cell.v, s.id)
      if (next !== cell.v) {
        cells ??= { ...s.cells }
        cells[addr] = { ...cell, v: next }
      }
    }
    return cells ? { ...s, cells } : s
  })
}

function mapChartRefs(charts: SheetChart[], fn: (ref: string, sheetId: string) => string): SheetChart[] {
  return charts.map((ch) => {
    const src = ch.spec.source
    if (!src || typeof src.ref !== 'string') return ch
    const ref = fn(src.ref, ch.sheet)
    return ref === src.ref ? ch : { ...ch, spec: { ...ch.spec, source: { ...src, ref } } }
  })
}

/* ------------------------------------------------------------------ */
/* Rows and columns                                                    */
/* ------------------------------------------------------------------ */

function moveCells(s: SheetData, op: StructOp): Record<string, SheetCell> {
  const out: Record<string, SheetCell> = {}
  const end = op.at + op.count
  for (const [addr, cell] of Object.entries(s.cells)) {
    const p = parseA1(addr)
    if (!p) continue
    let { row, col } = p
    const k = op.axis === 'row' ? row : col
    if (op.kind === 'insert') {
      if (k >= op.at) {
        if (op.axis === 'row') row += op.count
        else col += op.count
      }
    } else {
      if (k >= op.at && k < end) continue
      if (k >= end) {
        if (op.axis === 'row') row -= op.count
        else col -= op.count
      }
    }
    if (row < MAX_ROWS && col < MAX_COLS) out[a1(row, col)] = cell
  }
  return out
}

function moveWidths(s: SheetData, op: StructOp): Record<string, number> {
  if (op.axis !== 'col') return s.colWidths
  const out: Record<string, number> = {}
  for (const [k, w] of Object.entries(s.colWidths)) {
    let c = colIndex(k)
    if (op.kind === 'insert' && c >= op.at) c += op.count
    else if (op.kind === 'delete') {
      if (c >= op.at && c < op.at + op.count) continue
      if (c >= op.at + op.count) c -= op.count
    }
    if (c < MAX_COLS) out[colName(c)] = w
  }
  return out
}

/** Insert / delete rows or columns on a sheet. */
export function structural(a: A, op: StructOp): Patch {
  const target = sheetOf(a, op.sheetId)
  if (!target) return {}
  const ids = sheetIdOf(a)
  const max = op.axis === 'row' ? MAX_ROWS : MAX_COLS
  const size = op.axis === 'row' ? target.rows : target.cols
  const count = op.kind === 'insert' ? Math.min(op.count, max - size) : Math.min(op.count, size - op.at, size - 1)
  if (count <= 0) return {}
  const o: StructOp = { ...op, count }
  let sheets = mapSheet(a, op.sheetId, (s) => ({
    ...s,
    cells: moveCells(s, o),
    colWidths: moveWidths(s, o),
    rows: o.axis === 'row' ? s.rows + (o.kind === 'insert' ? count : -count) : s.rows,
    cols: o.axis === 'col' ? s.cols + (o.kind === 'insert' ? count : -count) : s.cols,
  }))
  sheets = mapFormulas(sheets, (raw, sheetId) => adjustFormula(raw, sheetId, o, ids))
  const datasets: DatasetDef[] = a.datasets.map((d) => ({
    ...d,
    ranges: d.ranges.flatMap((r) => {
      if (r.sheet !== o.sheetId) return [r]
      const ref = adjustRect(r.ref, o)
      return ref ? [{ sheet: r.sheet, ref }] : []
    }),
  }))
  const charts = mapChartRefs(a.charts, (ref, sheetId) => adjustExpression(ref, sheetId, o, ids))
  return { sheets, datasets, charts }
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

export function sheetNameProblem(a: A, name: string, selfId?: string): 'empty' | 'taken' | 'chars' | null {
  const n = name.trim()
  if (!n) return 'empty'
  if (n.length > LIMITS.name || /[!'[\]*?:/\\]/.test(n)) return 'chars'
  if (a.sheets.some((s) => s.id !== selfId && sameName(s.name, n))) return 'taken'
  return null
}

/** A free name: "Sheet 3", "Sheet 3 (2)" … */
export function freeName(a: A, base: string): string {
  let name = base
  let i = 2
  while (a.sheets.some((s) => sameName(s.name, name))) name = `${base} (${i++})`
  return name
}

export function addSheet(a: A, name: string, rows = 15, cols = 8): Patch {
  if (a.sheets.length >= LIMITS.sheets) return {}
  const sheet: SheetData = { id: newId(), name: freeName(a, name), rows, cols, cells: {}, colWidths: {} }
  return { sheets: [...a.sheets, sheet], active: sheet.id }
}

export function renameSheet(a: A, sheetId: string, name: string): Patch | null {
  const s = sheetOf(a, sheetId)
  const n = name.trim()
  if (!s || sheetNameProblem(a, n, sheetId)) return null
  if (s.name === n) return {}
  const sheets = mapFormulas(
    a.sheets.map((x) => (x.id === sheetId ? { ...x, name: n } : x)),
    (raw) => renameSheetRefs(raw, s.name, n),
  )
  const charts = mapChartRefs(a.charts, (ref) => renameSheetInExpression(ref, s.name, n))
  return { sheets, charts }
}

export function duplicateSheet(a: A, sheetId: string, copyLabel: string): Patch {
  const s = sheetOf(a, sheetId)
  if (!s || a.sheets.length >= LIMITS.sheets) return {}
  const copy: SheetData = { ...s, id: newId(), name: freeName(a, `${s.name} ${copyLabel}`.slice(0, LIMITS.name)), cells: { ...s.cells }, colWidths: { ...s.colWidths } }
  const i = a.sheets.indexOf(s)
  return { sheets: [...a.sheets.slice(0, i + 1), copy, ...a.sheets.slice(i + 1)], active: copy.id }
}

export function deleteSheet(a: A, sheetId: string): Patch {
  const s = sheetOf(a, sheetId)
  if (!s || a.sheets.length < 2) return {}
  const i = a.sheets.indexOf(s)
  const rest = a.sheets.filter((x) => x.id !== sheetId)
  const sheets = mapFormulas(rest, (raw) => dropSheetRefs(raw, s.name))
  const datasets = a.datasets.map((d) => ({ ...d, ranges: d.ranges.filter((r) => r.sheet !== sheetId) }))
  const charts = mapChartRefs(
    a.charts.filter((c) => c.sheet !== sheetId),
    (ref) => rewriteRefs(ref, (t) => (t.sheet !== null && sameName(t.sheet, s.name) ? null : undefined)),
  )
  const active = a.active === sheetId ? rest[Math.max(0, i - 1)].id : a.active
  return { sheets, datasets, charts, active }
}

export function moveSheet(a: A, sheetId: string, to: number): Patch {
  const i = a.sheets.findIndex((s) => s.id === sheetId)
  const j = Math.max(0, Math.min(a.sheets.length - 1, to))
  if (i < 0 || i === j) return {}
  const sheets = [...a.sheets]
  const [s] = sheets.splice(i, 1)
  sheets.splice(j, 0, s)
  return { sheets }
}

/* ------------------------------------------------------------------ */
/* Copy, fill, paste                                                   */
/* ------------------------------------------------------------------ */

export interface ClipCells {
  /** rows × cols of cells (null = empty) */
  cells: Array<Array<SheetCell | null>>
  /** where they were copied from (internal copies: formulas shift relative to it) */
  origin?: Pos
  /** cut: the source is cleared */
  cut?: { sheetId: string; rect: Rect }
}

/** The cells of a rectangle (for copying). */
export function cellsIn(s: SheetData, rect: Rect): ClipCells {
  const cells: Array<Array<SheetCell | null>> = []
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row: Array<SheetCell | null> = []
    for (let c = rect.left; c <= rect.right; c++) row.push(s.cells[a1(r, c)] ?? null)
    cells.push(row)
  }
  return { cells, origin: { r: rect.top, c: rect.left } }
}

/**
 * Paste a block at `at` (sheet grows when needed). Internal copies shift relative references by
 * the distance moved; a cut moves the formulas unchanged and clears the source.
 */
export function paste(a: A, sheetId: string, at: Pos, clip: ClipCells, opts: { valuesOnly?: boolean } = {}): Patch {
  const s = sheetOf(a, sheetId)
  if (!s || !clip.cells.length) return {}
  const rows = Math.min(MAX_ROWS, Math.max(s.rows, at.r + clip.cells.length))
  const cols = Math.min(MAX_COLS, Math.max(s.cols, at.c + Math.max(...clip.cells.map((r) => r.length))))
  let base: A = a
  if (rows !== s.rows || cols !== s.cols) base = { ...a, sheets: mapSheet(a, sheetId, (x) => ({ ...x, rows, cols })) }
  const changes: Record<string, SheetCell | null> = {}
  if (clip.cut && clip.cut.sheetId === sheetId) {
    for (let r = clip.cut.rect.top; r <= clip.cut.rect.bottom; r++) for (let c = clip.cut.rect.left; c <= clip.cut.rect.right; c++) changes[a1(r, c)] = null
  }
  clip.cells.forEach((row, i) =>
    row.forEach((cell, j) => {
      const r = at.r + i
      const c = at.c + j
      if (r >= rows || c >= cols) return
      if (!cell) {
        changes[a1(r, c)] = null
        return
      }
      let v = cell.v
      if (v && v[0] === '=' && clip.origin && !clip.cut && !opts.valuesOnly) v = shiftFormula(v, r - (clip.origin.r + i), c - (clip.origin.c + j))
      changes[a1(r, c)] = { ...cell, v }
    }),
  )
  let patch = setCells(base, sheetId, changes)
  if (clip.cut && clip.cut.sheetId !== sheetId) patch = { sheets: mapSheet({ ...base, sheets: patch.sheets! }, clip.cut.sheetId, (x) => clearRect(x, clip.cut!.rect)) }
  return patch
}

function clearRect(s: SheetData, rect: Rect): SheetData {
  const cells = { ...s.cells }
  for (let r = rect.top; r <= Math.min(rect.bottom, s.rows - 1); r++) for (let c = rect.left; c <= Math.min(rect.right, s.cols - 1); c++) delete cells[a1(r, c)]
  return { ...s, cells }
}

/** Clear the contents (keep formats) of rectangles. */
export function clearContents(a: A, sheetId: string, rects: Rect[]): Patch {
  const s = sheetOf(a, sheetId)
  if (!s) return {}
  const changes: Record<string, SheetCell | null> = {}
  for (const rect of rects)
    for (let r = rect.top; r <= Math.min(rect.bottom, s.rows - 1); r++)
      for (let c = rect.left; c <= Math.min(rect.right, s.cols - 1); c++) {
        const cell = s.cells[a1(r, c)]
        if (cell?.v) changes[a1(r, c)] = { ...cell, v: undefined }
      }
  return setCells(a, sheetId, changes)
}

/** Ctrl+D / Ctrl+R: the first row (column) of the rectangle copied into the rest, formulas shifted. */
export function fill(a: A, sheetId: string, rect: Rect, dir: 'down' | 'right'): Patch {
  const s = sheetOf(a, sheetId)
  if (!s) return {}
  const changes: Record<string, SheetCell | null> = {}
  for (let r = rect.top; r <= rect.bottom; r++)
    for (let c = rect.left; c <= rect.right; c++) {
      const src = dir === 'down' ? { r: rect.top, c } : { r, c: rect.left }
      if (src.r === r && src.c === c) continue
      const cell = s.cells[a1(src.r, src.c)]
      if (!cell) {
        changes[a1(r, c)] = null
        continue
      }
      const v = cell.v && cell.v[0] === '=' ? shiftFormula(cell.v, r - src.r, c - src.c) : cell.v
      changes[a1(r, c)] = { ...cell, v }
    }
  return setCells(a, sheetId, changes)
}

/* ------------------------------------------------------------------ */
/* AutoFill (fill handle, Fill series)                                 */
/* ------------------------------------------------------------------ */

/** Which way `dest` extends `src` (null: it doesn't). */
export function fillDirection(src: Rect, dest: Rect): 'down' | 'up' | 'right' | 'left' | null {
  if (dest.bottom > src.bottom) return 'down'
  if (dest.top < src.top) return 'up'
  if (dest.right > src.right) return 'right'
  if (dest.left < src.left) return 'left'
  return null
}

/** The cells `src` continues with across `dest` (src ∪ the extension), by address. */
function fillChanges(s: SheetData, src: Rect, dest: Rect, mode: FillMode, lang: 'en' | 'de', firstLineOnly = false): Record<string, SheetCell | null> {
  const dir = fillDirection(src, dest)
  const changes: Record<string, SheetCell | null> = {}
  if (!dir) return changes
  const vertical = dir === 'down' || dir === 'up'
  const len = vertical ? src.bottom - src.top + 1 : src.right - src.left + 1
  const ext = dir === 'down' ? dest.bottom - src.bottom : dir === 'up' ? src.top - dest.top : dir === 'right' ? dest.right - src.right : src.left - dest.left
  const at = Array.from({ length: ext }, (_, i) => (dir === 'down' || dir === 'right' ? len + i : -1 - i))
  const [from, to] = vertical ? [src.left, src.right] : [src.top, src.bottom]
  for (let k = from; k <= (firstLineOnly ? from : to); k++) {
    const seed: Array<SheetCell | null> = []
    for (let i = 0; i < len; i++) seed.push(s.cells[vertical ? a1(src.top + i, k) : a1(k, src.left + i)] ?? null)
    const out = fillLine(seed, at, vertical, mode, lang)
    at.forEach((p, i) => {
      const addr = vertical ? a1(src.top + p, k) : a1(k, src.left + p)
      changes[addr] = out[i]
    })
  }
  return changes
}

/**
 * The fill handle: `src` (the selection) continued across `dest` — series, names, numbered text,
 * dates, shifted formulas, formats — as one patch (one undo step).
 */
export function autoFill(a: A, sheetId: string, src: Rect, dest: Rect, mode: FillMode = 'auto', lang: 'en' | 'de' = 'en'): Patch {
  const s = sheetOf(a, sheetId)
  if (!s) return {}
  const clipped: Rect = { top: Math.max(0, dest.top), left: Math.max(0, dest.left), bottom: Math.min(s.rows - 1, dest.bottom), right: Math.min(s.cols - 1, dest.right) }
  return setCells(a, sheetId, fillChanges(s, src, clipped, mode, lang))
}

/** What the far end of the fill's first line would hold (the drag tooltip). */
export function fillEndCell(a: A, sheetId: string, src: Rect, dest: Rect, mode: FillMode = 'auto', lang: 'en' | 'de' = 'en'): { cell: SheetCell | null; addr: string } | null {
  const s = sheetOf(a, sheetId)
  const dir = fillDirection(src, dest)
  if (!s || !dir) return null
  const addr = dir === 'down' ? a1(dest.bottom, src.left) : dir === 'up' ? a1(dest.top, src.left) : dir === 'right' ? a1(src.top, dest.right) : a1(src.top, dest.left)
  const far: Rect = dir === 'down' ? { ...src, bottom: dest.bottom } : dir === 'up' ? { ...src, top: dest.top } : dir === 'right' ? { ...src, right: dest.right } : { ...src, left: dest.left }
  const changes = fillChanges(s, src, far, mode, lang, true)
  return { cell: changes[addr] ?? null, addr }
}

/**
 * "Fill series": each column of a taller-than-one-row selection (else each row) continues from
 * its leading filled cells to the end of the selection.
 */
export function fillSeriesIn(a: A, sheetId: string, rect: Rect, lang: 'en' | 'de' = 'en'): Patch {
  const s = sheetOf(a, sheetId)
  if (!s) return {}
  const bottom = Math.min(rect.bottom, s.rows - 1)
  const right = Math.min(rect.right, s.cols - 1)
  const vertical = bottom > rect.top
  const changes: Record<string, SheetCell | null> = {}
  const [from, to] = vertical ? [rect.left, right] : [rect.top, bottom]
  const len = vertical ? bottom - rect.top + 1 : right - rect.left + 1
  for (let k = from; k <= to; k++) {
    const addr = (i: number) => (vertical ? a1(rect.top + i, k) : a1(k, rect.left + i))
    let lead = 0
    while (lead < len && s.cells[addr(lead)]?.v) lead++
    if (!lead || lead >= len) continue
    const src: Rect = vertical ? { top: rect.top, bottom: rect.top + lead - 1, left: k, right: k } : { top: k, bottom: k, left: rect.left, right: rect.left + lead - 1 }
    const dest: Rect = vertical ? { ...src, bottom } : { ...src, right }
    Object.assign(changes, fillChanges(s, src, dest, 'series', lang))
  }
  return setCells(a, sheetId, changes)
}

/**
 * Double-click on the fill handle: the last row to fill down to — the end of the data in the
 * column left of the selection (else right of it), from the row below the selection; null when
 * neither has data there.
 */
export function fillDownEnd(s: SheetData, src: Rect): number | null {
  for (const c of [src.left - 1, src.right + 1]) {
    if (c < 0 || c >= s.cols) continue
    let r = src.bottom
    while (r + 1 < s.rows && s.cells[a1(r + 1, c)]?.v) r++
    if (r > src.bottom) return r
  }
  return null
}

/** Format / style patch on every cell of the rectangles. */
export function styleCells(a: A, sheetId: string, rects: Rect[], patch: (cell: SheetCell) => SheetCell): Patch {
  const s = sheetOf(a, sheetId)
  if (!s) return {}
  const changes: Record<string, SheetCell | null> = {}
  for (const rect of rects)
    for (let r = rect.top; r <= Math.min(rect.bottom, s.rows - 1); r++)
      for (let c = rect.left; c <= Math.min(rect.right, s.cols - 1); c++) changes[a1(r, c)] = patch(s.cells[a1(r, c)] ?? {})
  return setCells(a, sheetId, changes)
}

export function setColWidth(a: A, sheetId: string, col: number, width: number): Patch {
  return {
    sheets: mapSheet(a, sheetId, (s) => ({ ...s, colWidths: { ...s.colWidths, [colName(col)]: Math.round(Math.min(LIMITS.colWidth.max, Math.max(LIMITS.colWidth.min, width))) } })),
  }
}

export function setSheet(a: A, sheetId: string, patch: Partial<Pick<SheetData, 'frozenRows' | 'rows' | 'cols'>>): Patch {
  return { sheets: mapSheet(a, sheetId, (s) => ({ ...s, ...patch })) }
}

/* ------------------------------------------------------------------ */
/* Named datasets                                                      */
/* ------------------------------------------------------------------ */

export function upsertDataset(a: A, d: DatasetDef): Patch {
  const exists = a.datasets.some((x) => x.id === d.id)
  if (!exists && a.datasets.length >= LIMITS.datasets) return {}
  return { datasets: exists ? a.datasets.map((x) => (x.id === d.id ? d : x)) : [...a.datasets, d] }
}

/** Name tokens directly inside DS(…) of a formula body: DS(Revenue) / DS("Revenue"). */
function dsNames(body: string): Array<{ s: number; e: number; name: string; quoted: boolean }> {
  const toks = lex(body, true)
  const stack: boolean[] = []
  const out: Array<{ s: number; e: number; name: string; quoted: boolean }> = []
  toks.forEach((t, i) => {
    if (t.t === 'lp') {
      const prev = toks[i - 1]
      stack.push(prev?.t === 'fn' && prev.v === 'DS')
    }
    else if (t.t === 'rp') stack.pop()
    else if ((t.t === 'name' || t.t === 'str') && stack[stack.length - 1]) out.push({ s: t.s, e: t.e, name: t.v, quoted: t.t === 'str' })
  })
  return out
}

/** Rename a dataset; formulas that name it (DS(Old)) follow. */
export function renameDataset(a: A, id: string, name: string): Patch {
  const d = a.datasets.find((x) => x.id === id)
  if (!d || d.name === name) return {}
  const sheets = mapFormulas(a.sheets, (raw) => {
    const hits = dsNames(raw.slice(1)).filter((h) => sameName(h.name, d.name))
    if (!hits.length) return raw
    let body = raw.slice(1)
    for (const h of hits.reverse()) body = body.slice(0, h.s) + (h.quoted ? `"${name}"` : name) + body.slice(h.e)
    return `=${body}`
  })
  return { datasets: a.datasets.map((x) => (x.id === id ? { ...x, name } : x)), sheets }
}

export function deleteDataset(a: A, id: string): Patch {
  return { datasets: a.datasets.filter((d) => d.id !== id) }
}

/** Cells whose formula names a dataset (DS(Name) / DS("Name")). */
export function datasetUsers(a: A, name: string): Array<{ sheetId: string; addr: string }> {
  const out: Array<{ sheetId: string; addr: string }> = []
  for (const s of a.sheets)
    for (const [addr, cell] of Object.entries(s.cells))
      if (cell.v && cell.v[0] === '=' && cell.v.toLowerCase().includes(name.toLowerCase()) && dsNames(cell.v.slice(1)).some((h) => sameName(h.name, name))) out.push({ sheetId: s.id, addr })
  return out
}
