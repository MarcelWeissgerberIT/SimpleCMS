/** Address existing page-table cells without round-tripping a table through model-written Markdown. */
export interface TableNode {
  type?: string
  attrs?: Record<string, any>
  content?: TableNode[]
  text?: string
  marks?: unknown[]
  [k: string]: unknown
}
export const TABLE_CELL_LIMIT = 200
export const TABLE_PATCH_LIMIT = 30
export const TABLE_VALUE_LIMIT = 4000
export class TableCellError extends Error {
  code: 'missing' | 'changed' | 'unsupported' | 'limit' | 'response'
  constructor(code: TableCellError['code']) { super(code); this.code = code; this.name = 'TableCellError' }
}
export interface TableField {
  /** The cell's first paragraph id: present in existing documents, kept on replacement. */
  id: string
  address: string
  row: number
  column: number
  header: boolean
  editable: boolean
  text: string
  node: TableNode
}
export interface TableSnapshot { tableId: string; layout: string; rows: number; columns: number; cells: TableField[] }
export interface CellPatch {
  tableId: string
  layout: string
  cellId: string
  address: string
  before: TableNode
  value: string
}
const CELL = new Set(['tableCell', 'tableHeader'])
const idOf = (n?: TableNode): string => typeof n?.attrs?.id === 'string' ? n.attrs.id : ''
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const key = (v: unknown) => JSON.stringify(v)
export function cellText(n: TableNode): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map(cellText).join(CELL.has(n.type ?? '') ? '\n' : '')
}
function walk(n: TableNode, visit: (n: TableNode) => void) {
  // A synced reference belongs to its original page; never edit its local projection.
  if (n.type === 'syncedBlock' && n.attrs?.sourcePageId) return
  visit(n)
  for (const c of n.content ?? []) walk(c, visit)
}
export function pageTableIds(doc: TableNode): string[] {
  const out: string[] = []
  walk(doc, n => { if (n.type === 'table' && idOf(n)) out.push(idOf(n)) })
  return out
}
const columnName = (column: number): string => {
  let n = column + 1, out = ''
  while (n) { out = String.fromCharCode(65 + (n - 1) % 26) + out; n = Math.floor((n - 1) / 26) }
  return out
}
export function snapshotTable(doc: TableNode, tableId: string): TableSnapshot {
  const found: TableNode[] = [], ids = new Map<string, number>()
  walk(doc, n => { const id = idOf(n); if (id) ids.set(id, (ids.get(id) ?? 0) + 1); if (n.type === 'table' && id === tableId) found.push(n) })
  if (found.length !== 1 || !tableId) throw new TableCellError('missing')
  const table = found[0], rows = table.content ?? [], cells: TableField[] = [], occupied: string[][] = []
  if (!rows.length || rows.length > TABLE_CELL_LIMIT) throw new TableCellError('limit')
  const layout: unknown[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.type !== 'tableRow') throw new TableCellError('unsupported')
    occupied[r] ??= []
    let column = 0
    for (const cell of row.content ?? []) {
      if (!CELL.has(cell.type ?? '')) throw new TableCellError('unsupported')
      while (occupied[r][column]) column++
      const colspan = cell.attrs?.colspan ?? 1, rowspan = cell.attrs?.rowspan ?? 1
      if (!Number.isSafeInteger(colspan) || !Number.isSafeInteger(rowspan) || colspan < 1 || rowspan < 1 || colspan > 50 || r + rowspan > rows.length || column + colspan > 50) throw new TableCellError('unsupported')
      const id = idOf(cell.content?.[0])
      const editable = !!id && ids.get(id) === 1 && !!cell.content?.length && cell.content.every(p => p.type === 'paragraph' && (p.content ?? []).every(x => x.type === 'text' || x.type === 'hardBreak'))
      const address = columnName(column) + (r + 1)
      for (let y = r; y < r + rowspan; y++) {
        occupied[y] ??= []
        for (let x = column; x < column + colspan; x++) {
          if (occupied[y][x]) throw new TableCellError('unsupported')
          occupied[y][x] = address
        }
      }
      cells.push({ id, address, row: r + 1, column: column + 1, header: cell.type === 'tableHeader', editable, text: cellText(cell), node: clone(cell) })
      layout.push([r, column, cell.type, id, colspan, rowspan])
      column += colspan
      if (cells.length > TABLE_CELL_LIMIT) throw new TableCellError('limit')
    }
  }
  const columns = Math.max(...occupied.map(x => x.length))
  if (!columns || occupied.some(row => row.length !== columns || Array.from({ length: columns }, (_, i) => !row[i]).some(Boolean))) throw new TableCellError('unsupported')
  return { tableId, layout: key(layout), rows: rows.length, columns, cells }
}
export function parseCellAnswer(raw: string, allowed: readonly string[]): { cellId: string; value: string }[] {
  if (raw.length > 150_000) throw new TableCellError('limit')
  const text = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  let json: unknown
  try { json = JSON.parse(text) } catch { throw new TableCellError('response') }
  if (!json || typeof json !== 'object' || Array.isArray(json) || Object.keys(json).some(k => k !== 'cells')) throw new TableCellError('response')
  const cells = (json as { cells: unknown }).cells
  if (!Array.isArray(cells) || cells.length > TABLE_PATCH_LIMIT) throw new TableCellError('response')
  const seen = new Set<string>(), permitted = new Set(allowed)
  let chars = 0
  return cells.map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => k !== 'cellId' && k !== 'value') || typeof c.cellId !== 'string' || !permitted.has(c.cellId) || seen.has(c.cellId) || typeof c.value !== 'string' || c.value.length > TABLE_VALUE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c.value)) throw new TableCellError('response')
    seen.add(c.cellId); chars += c.value.length
    if (chars > 16000) throw new TableCellError('limit')
    return { cellId: c.cellId, value: c.value.replace(/\r\n?/g, '\n') }
  })
}
export function planCellPatches(snapshot: TableSnapshot, updates: { cellId: string; value: string }[], allowed = snapshot.cells.filter(c => c.editable).map(c => c.id)): CellPatch[] {
  const validated = parseCellAnswer(JSON.stringify({ cells: updates }), allowed)
  return validated.flatMap(update => {
    const cell = snapshot.cells.find(c => c.id === update.cellId)
    if (!cell?.editable) throw new TableCellError('unsupported')
    return cell.text === update.value ? [] : [{ tableId: snapshot.tableId, layout: snapshot.layout, cellId: cell.id, address: cell.address, before: clone(cell.node), value: update.value }]
  })
}
/** Check topology and the complete target cell, but allow concurrent edits of unrelated cells. */
export function resolveCellPatch(doc: TableNode, patch: CellPatch): { before: TableNode; after: TableNode } {
  const live = snapshotTable(doc, patch.tableId)
  const cell = live.cells.find(c => c.id === patch.cellId)
  if (live.layout !== patch.layout || !cell?.editable || key(cell.node) !== key(patch.before)) throw new TableCellError('changed')
  // Revalidate persisted/untrusted proposals too. No model JSON nodes, Markdown or attributes are ever applied.
  parseCellAnswer(JSON.stringify({ cells: [{ cellId: patch.cellId, value: patch.value }] }), [patch.cellId])
  const paragraph = clone(cell.node.content![0])
  paragraph.content = patch.value.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])])
  return { before: clone(cell.node), after: { ...clone(cell.node), content: [paragraph] } }
}
