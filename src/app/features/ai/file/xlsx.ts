/**
 * Tables from files, here in the browser (no AI, nothing sent): CSV / TSV text and Excel workbooks (.xlsx:
 * fflate + DOMParser over the sheet XML — shared strings, inline strings, numbers, booleans, errors; dates
 * by their number format → yyyy-mm-dd [hh:mm]; percent formats → "25%"). Hidden sheets are left out.
 *
 * A sheet is its first non-empty row as the header and the rows below it (empty rows and trailing empty
 * columns dropped), at most DATA_MAX_ROWS × DATA_MAX_COLS; `total` keeps the row count before the cap.
 */
import { unzipSync } from 'fflate'
import { parseCSV } from '../../io/import/csv'
import { FileLoadError } from './load'

export const DATA_MAX_ROWS = 5000
export const DATA_MAX_COLS = 40
export const DATA_MAX_SHEETS = 20
/** Unpacked XML at most (a zip bomb stops here). */
const XML_MAX = 120 * 1024 * 1024

export interface DataSheet {
  name: string
  header: string[]
  rows: string[][]
  /** data rows in the file (rows.length unless capped) */
  total: number
}

/** First non-empty row → header; empty rows and trailing empty columns out; capped. */
export function toSheet(name: string, grid: string[][]): DataSheet | null {
  const rows = grid.map((r) => r.map((c) => (c ?? '').replace(/\r\n?/g, '\n'))).filter((r) => r.some((c) => c.trim()))
  if (!rows.length) return null
  let width = 0
  for (const r of rows) for (let i = r.length - 1; i >= width; i--) if (r[i]?.trim()) width = i + 1
  width = Math.min(DATA_MAX_COLS, Math.max(1, width))
  const fit = (r: string[]) => Array.from({ length: width }, (_, i) => (r[i] ?? '').trim())
  const [head, ...body] = rows
  return { name, header: fit(head), rows: body.slice(0, DATA_MAX_ROWS).map(fit), total: body.length }
}

/** A CSV / TSV file's table (delimiter sniffed: comma, semicolon, tab). */
export function csvSheet(name: string, text: string): DataSheet | null {
  return toSheet(name, parseCSV(text))
}

/* ------------------------------------------------------------------ */
/* Excel                                                                */
/* ------------------------------------------------------------------ */

const kids = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])
const child = (el: Element | null | undefined, name: string): Element | null => kids(el).find((c) => c.localName === name) ?? null
const attr = (el: Element | null | undefined, local: string): string | null => {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value
  return null
}

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

/** The visible text of a string item (rich runs joined, phonetic hints left out). */
function itemText(si: Element): string {
  let out = ''
  for (const c of kids(si)) {
    if (c.localName === 't') out += c.textContent ?? ''
    else if (c.localName === 'r') out += child(c, 't')?.textContent ?? ''
  }
  return out
}

type NumKind = 'date' | 'datetime' | 'time' | 'percent' | null

const BUILTIN: Record<number, NumKind> = { 9: 'percent', 10: 'percent', 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time' }

/** What a number format shows: a date, a time, both, a percentage — or a plain number (null). */
function formatKind(code: string): NumKind {
  // quoted text, [colours] / [$-locale] and escaped characters do not count
  const f = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase()
  if (f.includes('%')) return 'percent'
  const date = /[dy]/.test(f) || /(^|[^h:])m{3,}/.test(f)
  const time = /[hs]/.test(f)
  if (date && time) return 'datetime'
  if (date) return 'date'
  if (time) return 'time'
  return null
}

/** Each cell style's number kind (styles.xml cellXfs → numFmtId → built-in or own format). */
function readStyles(doc: Document | null): NumKind[] {
  const root = doc?.documentElement
  const own = new Map<number, NumKind>()
  for (const f of kids(child(root, 'numFmts'))) own.set(Number(attr(f, 'numFmtId')), formatKind(attr(f, 'formatCode') ?? ''))
  return kids(child(root, 'cellXfs')).map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? 0)
    return own.has(id) ? own.get(id)! : (BUILTIN[id] ?? null)
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An Excel serial date (1900 system; 1904 when the workbook says so) → yyyy-mm-dd [hh:mm]. */
function serialDate(v: number, kind: 'date' | 'datetime' | 'time', date1904: boolean): string {
  const ms = Math.round((v + (date1904 ? 24107 : 0) - 25569) * 86_400_000)
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return String(v)
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return kind === 'date' ? day : kind === 'time' ? time : `${day} ${time}`
}

/** A number as written: at most 15 significant digits (0.1 + 0.2 stays 0.3). */
const numText = (v: number) => String(Number(v.toPrecision(15)))

const colIndex = (ref: string): number => {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function sheetGrid(doc: Document, strings: string[], styles: NumKind[], date1904: boolean): string[][] {
  const data = child(doc.documentElement, 'sheetData')
  const grid: string[][] = []
  let rowNo = 0
  for (const row of kids(data)) {
    if (row.localName !== 'row') continue
    const r = Number(attr(row, 'r') ?? rowNo + 1) - 1
    rowNo = r + 1
    if (r > DATA_MAX_ROWS + 200) break
    const cells: string[] = []
    let col = 0
    for (const c of kids(row)) {
      if (c.localName !== 'c') continue
      const ref = attr(c, 'r')
      col = ref ? colIndex(ref) : col
      if (col >= DATA_MAX_COLS * 2) break
      const type = attr(c, 't') ?? 'n'
      const raw = child(c, 'v')?.textContent ?? ''
      let text = ''
      if (type === 's') text = strings[Number(raw)] ?? ''
      else if (type === 'inlineStr') text = itemText(child(c, 'is') ?? c)
      else if (type === 'str' || type === 'e') text = raw
      else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE'
      else if (raw.trim()) {
        const v = Number(raw)
        const kind = styles[Number(attr(c, 's') ?? 0)] ?? null
        if (!Number.isFinite(v)) text = raw
        else if (kind === 'percent') text = `${numText(v * 100)}%`
        else if (kind) text = serialDate(v, kind, date1904)
        else text = numText(v)
      }
      cells[col] = text
      col++
    }
    grid[r] = Array.from(cells, (x) => x ?? '')
  }
  return Array.from(grid, (x) => x ?? [])
}

/** The visible sheets of an .xlsx workbook. Throws FileLoadError('unreadable') for anything that is not one. */
export function xlsxSheets(bytes: Uint8Array): DataSheet[] {
  let files: Record<string, Uint8Array>
  try {
    let total = 0
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name)) return false
        total += f.originalSize
        if (total > XML_MAX) throw new FileLoadError({ issue: 'too_large', bytes: total, max: XML_MAX })
        return true
      },
    })
  } catch (e) {
    if (e instanceof FileLoadError) throw e
    throw new FileLoadError('unreadable', 'not a zip')
  }
  const book = parseXml(files['xl/workbook.xml'])
  if (!book) throw new FileLoadError('unreadable', 'no xl/workbook.xml')
  const rels = new Map<string, string>()
  for (const r of kids(parseXml(files['xl/_rels/workbook.xml.rels'])?.documentElement)) {
    const target = (attr(r, 'Target') ?? '').replace(/^\/?xl\//, '').replace(/^\//, '')
    rels.set(attr(r, 'Id') ?? '', `xl/${target}`)
  }
  const strings = kids(parseXml(files['xl/sharedStrings.xml'])?.documentElement)
    .filter((si) => si.localName === 'si')
    .map(itemText)
  const styles = readStyles(parseXml(files['xl/styles.xml']))
  const date1904 = /^(1|true)$/i.test(attr(child(book.documentElement, 'workbookPr'), 'date1904') ?? '')
  const out: DataSheet[] = []
  for (const s of kids(child(book.documentElement, 'sheets'))) {
    if (out.length >= DATA_MAX_SHEETS) break
    if (s.localName !== 'sheet' || /hidden/i.test(attr(s, 'state') ?? '')) continue
    const path = rels.get(attr(s, 'id') ?? '')
    const xml = path ? parseXml(files[path]) : null
    if (!xml) continue
    const sheet = toSheet(attr(s, 'name') ?? `Sheet ${out.length + 1}`, sheetGrid(xml, strings, styles, date1904))
    if (sheet) out.push(sheet)
  }
  return out
}
