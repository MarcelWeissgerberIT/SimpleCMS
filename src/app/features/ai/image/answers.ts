/**
 * Claude's answers about an image → what goes into the page (pure):
 *  - parseDescription: { alt, caption }
 *  - parseTables: the tables (rows padded to the header, capped); tablesMarkdown for Copy
 *  - tableBlocks: real `table` blocks (header row) — one per table, a title line above each when several
 *  - spreadsheetJson: one `spreadsheet` block, a sheet per table, numbers as numbers (canonical input)
 *  - tablePlan: one table as a "Turn into database" plan (todb/plan.ts builds the database from it)
 */
import type { JSONContent } from '@tiptap/core'
import { canonicalInput, colName, MAX_COLS, MAX_ROWS, newSheet, type SheetCell, type SheetData } from '../../sheets'
import { decimalStyleOf, parseDateValue, parseNumber } from '../../io/import/csv'
import { TITLE_NAME, type PlanColumn, type PlanEntry, type TablePlan } from '../todb/plan'

export interface ImageDescription {
  alt: string
  caption: string
}

export interface ImageTable {
  title: string
  header: string[]
  rows: string[][]
}

const MAX_TABLES = 20
const MAX_TABLE_ROWS = 500
const MAX_TABLE_COLS = 40
const MAX_CELL = 2000

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function json(raw: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(raw.trim()) as unknown
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Alt text + caption, or null when the answer is not the JSON asked for. */
export function parseDescription(raw: string): ImageDescription | null {
  const d = json(raw)
  if (!d) return null
  const alt = line(d.alt, 500)
  const caption = line(d.caption, 500)
  return alt || caption ? { alt, caption } : null
}

/** The tables of the answer ([] = none found), or null when it is not the JSON asked for. */
export function parseTables(raw: string): ImageTable[] | null {
  const d = json(raw)
  if (!d || !Array.isArray(d.tables)) return null
  const out: ImageTable[] = []
  for (const x of d.tables) {
    if (out.length >= MAX_TABLES) break
    if (!x || typeof x !== 'object') continue
    const tb = x as Record<string, unknown>
    let header = Array.isArray(tb.header) ? tb.header.slice(0, MAX_TABLE_COLS).map((h) => line(h, 200)) : []
    const rows = (Array.isArray(tb.rows) ? tb.rows : [])
      .filter((r): r is unknown[] => Array.isArray(r))
      .slice(0, MAX_TABLE_ROWS)
      .map((r) => r.slice(0, MAX_TABLE_COLS).map((c) => (typeof c === 'number' ? String(c) : line(c, MAX_CELL))))
      .filter((r) => r.some(Boolean))
    const width = Math.max(header.length, ...rows.map((r) => r.length))
    if (!width || (!rows.length && !header.some(Boolean))) continue
    // a row longer than the header: the header grows (named later), short rows get empty cells
    header = Array.from({ length: width }, (_, i) => header[i] ?? '')
    out.push({ title: line(tb.title, 200), header, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) })
  }
  return out
}

/** Header names for display: empty ones become "Column 3" (in the given words). */
export function headerNames(table: ImageTable, column: (n: number) => string): string[] {
  return table.header.map((h, i) => h || column(i + 1))
}

const cellMd = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|') || ' '

/** The tables as Markdown (Copy). */
export function tablesMarkdown(tables: ImageTable[], column: (n: number) => string): string {
  return tables
    .map((tb) => {
      const head = headerNames(tb, column)
      const rows = [`| ${head.map(cellMd).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...tb.rows.map((r) => `| ${r.map(cellMd).join(' | ')} |`)]
      return [tb.title ? `**${tb.title}**` : '', rows.join('\n')].filter(Boolean).join('\n\n')
    })
    .join('\n\n')
}

const para = (text: string, bold = false): JSONContent =>
  text ? { type: 'paragraph', content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] } : { type: 'paragraph' }

const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({ type, content: [para(text)] })

/** `table` blocks with a header row; with several tables, each gets its title as a bold line above it. */
export function tableBlocks(tables: ImageTable[], column: (n: number) => string): JSONContent[] {
  const out: JSONContent[] = []
  for (const tb of tables) {
    if (tables.length > 1 && tb.title) out.push(para(tb.title, true))
    out.push({
      type: 'table',
      content: [
        { type: 'tableRow', content: headerNames(tb, column).map((h) => cell('tableHeader', h)) },
        ...tb.rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) })),
      ],
    })
  }
  return out
}

/** What a cell holds in a spreadsheet: numbers / dates canonical, text that looks like a formula kept as text. */
function sheetInput(text: string, lang: 'en' | 'de'): SheetCell | null {
  const s = text.trim()
  if (!s) return null
  if (s[0] === '=' || s[0] === "'") return { v: `'${s}` }
  const c = canonicalInput(s, lang)
  return c.fmt ? { v: c.v, fmt: c.fmt } : { v: c.v }
}

/** Which number style the table's cells use ("1,5" → German, "1.5" / "1,250" → English). */
function tableLang(tb: ImageTable): 'en' | 'de' {
  const numeric = tb.rows.flat().filter((c) => /^[-+]?[\d.,\s  ]+%?$/.test(c.trim()) && /\d/.test(c))
  return numeric.length && decimalStyleOf(numeric, ';') === 'comma' ? 'de' : 'en'
}

/** One `spreadsheet` block: a sheet per table (bold header row, frozen), numbers as numbers. */
export function spreadsheetJson(tables: ImageTable[], names: { sheet: (n: number) => string; column: (n: number) => string }): JSONContent {
  const used = new Set<string>()
  const sheets: SheetData[] = tables.map((tb, i) => {
    let name = (tb.title || names.sheet(i + 1)).replace(/[[\]*?:/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || names.sheet(i + 1)
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 36)} ${n}`
    used.add(name.toLowerCase())
    const cols = Math.min(MAX_COLS, tb.header.length)
    const rows = Math.min(MAX_ROWS - 1, tb.rows.length)
    const sheet = newSheet(name, Math.max(15, rows + 3), Math.max(8, cols + 1))
    const lang = tableLang(tb)
    headerNames(tb, names.column)
      .slice(0, cols)
      .forEach((h, c) => (sheet.cells[`${colName(c)}1`] = { v: h[0] === '=' || h[0] === "'" ? `'${h}` : h, b: true }))
    tb.rows.slice(0, rows).forEach((r, ri) =>
      r.slice(0, cols).forEach((text, c) => {
        const v = sheetInput(text, lang)
        if (v) sheet.cells[`${colName(c)}${ri + 2}`] = v
      }),
    )
    // the first column holds the labels: a little wider
    sheet.colWidths.A = 140
    sheet.frozenRows = 1
    return sheet
  })
  return { type: 'spreadsheet', attrs: { title: tables.length === 1 ? tables[0].title : '', sheets, active: sheets[0]?.id ?? '', datasets: [], charts: [] } }
}

const isNumber = (v: string) => !!(parseNumber(v, 'dot') ?? parseNumber(v, 'comma'))

/**
 * One table as a database plan: the first column names the entries (the title property takes its
 * header), the others become columns — numbers, dates, a select for few repeated values, else text.
 */
export function tablePlan(tb: ImageTable, names: { untitled: string; column: (n: number) => string }): { plan: TablePlan; titleName: string } {
  const head = headerNames(tb, names.column)
  const used = new Set<string>([TITLE_NAME.toLowerCase()])
  const columns: PlanColumn[] = head.slice(1).map((h, i) => {
    let name = h
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${h} ${n}`
    used.add(name.toLowerCase())
    const vals = tb.rows.map((r) => r[i + 1]?.trim() ?? '').filter(Boolean)
    const distinct = [...new Set(vals)]
    let type: PlanColumn['type'] = 'text'
    if (vals.length && vals.every(isNumber)) type = 'number'
    else if (vals.length && vals.every((v) => parseDateValue(v, false))) type = 'date'
    else if (vals.length >= 4 && distinct.length <= Math.min(8, vals.length / 2) && distinct.every((v) => v.length <= 40)) type = 'select'
    return { name, type, options: type === 'select' ? distinct : [] }
  })
  const entries: PlanEntry[] = tb.rows.map((r) => {
    const values: PlanEntry['values'] = {}
    columns.forEach((c, i) => {
      const v = r[i + 1]?.trim()
      if (v) values[c.name] = v
    })
    return { title: r[0]?.trim() ?? '', values, body: null }
  })
  // a table stays a table (the preview offers Group by → Board); the image itself stays: "1 block kept"
  return {
    plan: { title: tb.title || names.untitled, columns, entries, groupBy: null, keep: [0] },
    titleName: head[0] || TITLE_NAME,
  }
}
