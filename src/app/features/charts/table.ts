/**
 * Table-shaped data → ChartData: spreadsheet ranges, datasets, the manual grid, pasted TSV.
 * Header row and label column are detected (or forced by spec.labels / spec.seriesIn).
 */
import type { CellValue, ChartData, ChartSeries, ChartSpec } from './types'

const CURRENCY = /[€$£¥₹]/
const UNIT_OF: Record<string, string> = { '€': '€', $: '$', '£': '£', '¥': '¥', '₹': '₹', '%': '%' }

export interface ParsedNumber {
  value: number
  unit?: string
}

/**
 * A number typed the way people type them: "1,200.50", "1.200,50", "12 %", "€ 5", "-3",
 * "(3)" (negative). `lang` decides "1.200" (de: 1200, en: 1.2).
 */
export function parseNumber(raw: unknown, lang: 'en' | 'de' = 'en'): ParsedNumber | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : null
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s || s.length > 40) return null
  let unit: string | undefined
  const sym = s.match(CURRENCY)?.[0] ?? (s.includes('%') ? '%' : undefined)
  if (sym) unit = UNIT_OF[sym]
  s = s.replace(/[€$£¥₹%\s  ']/g, '')
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (/^[+-]/.test(s)) {
    neg = neg !== (s[0] === '-')
    s = s.slice(1)
  }
  if (!/^[\d.,]+([eE][+-]?\d+)?$/.test(s) || !/\d/.test(s)) return null
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    // the later one is the decimal separator
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (comma >= 0) {
    const parts = s.split(',').length
    // "1,200" is 1200 in English; German reads a single comma as the decimal separator ("1,5")
    if (/^\d{1,3}(,\d{3})+$/.test(s) && (lang === 'en' || parts > 2)) s = s.replace(/,/g, '')
    else if (parts === 2) s = s.replace(',', '.')
    else return null
  } else if (dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s) && (lang === 'de' || s.split('.').length > 2)) {
    s = s.replace(/\./g, '')
  }
  if ((s.match(/\./g) ?? []).length > 1) return null
  const value = Number(s)
  if (!Number.isFinite(value)) return null
  return { value: neg ? -value : value, unit }
}

const isBlank = (c: CellValue | undefined) => c === null || c === undefined || (typeof c === 'string' && !c.trim())
const isText = (c: CellValue | undefined, lang: 'en' | 'de') => typeof c === 'string' && !!c.trim() && !parseNumber(c, lang)
const cellText = (c: CellValue | undefined): string => (c === null || c === undefined ? '' : typeof c === 'number' ? String(Number(c.toPrecision(12))) : String(c)).trim()

/** Rectangular, trimmed grid (no fully empty outer rows / columns). */
function tidy(values: CellValue[][]): CellValue[][] {
  const rows = values.filter(Array.isArray)
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  let grid = rows.map((r) => Array.from({ length: width }, (_, j) => (r[j] === undefined ? null : r[j])))
  const emptyRow = (r: CellValue[]) => r.every(isBlank)
  while (grid.length && emptyRow(grid[grid.length - 1])) grid.pop()
  while (grid.length && emptyRow(grid[0])) grid.shift()
  const emptyCol = (j: number) => grid.every((r) => isBlank(r[j]))
  let right = width
  while (right > 0 && emptyCol(right - 1)) right--
  let left = 0
  while (left < right && emptyCol(left)) left++
  if (left || right < width) grid = grid.map((r) => r.slice(left, right))
  return grid
}

/** A text cell above a column that holds numbers, or a text-only first row over numbers. */
function detectHeader(grid: CellValue[][], lang: 'en' | 'de'): boolean {
  if (grid.length < 2) return false
  const below = grid.slice(1)
  if (grid[0].some((c, j) => isText(c, lang) && below.some((r) => !!parseNumber(r[j], lang)))) return true
  return grid[0].every((c) => isBlank(c) || isText(c, lang)) && grid[0].some((c) => isText(c, lang)) && below.some((r) => r.some((c) => !!parseNumber(c, lang)))
}

const transpose = (grid: CellValue[][]): CellValue[][] => (grid[0] ?? []).map((_, j) => grid.map((r) => r[j] ?? null))

const YEARISH = (c: CellValue) => {
  const n = typeof c === 'number' ? c : typeof c === 'string' ? Number(c.trim()) : NaN
  return Number.isInteger(n) && n >= 1900 && n <= 2100
}

export interface TableOptions {
  lang?: 'en' | 'de'
  /** name for an unnamed series: (n) => "Series 2" */
  seriesName?: (n: number) => string
  /** the series of a text-only table, which counts its values (default "Count" / "Anzahl") */
  countName?: string
}

/**
 * Computed cells → chart data. Default orientation: categories down the first column, one
 * series per further column, names in the header row. `spec.seriesIn: 'rows'` (or
 * `labels: 'firstRow'`) reads it the other way round; `labels: 'none'` numbers the categories.
 */
export function tableToChartData(values: CellValue[][], spec: Partial<Pick<ChartSpec, 'labels' | 'seriesIn' | 'unit'>> = {}, opts: TableOptions = {}): ChartData {
  const lang = opts.lang ?? 'en'
  const name = opts.seriesName ?? ((n: number) => `Series ${n}`)
  let grid = tidy(values ?? [])
  if (!grid.length || !grid[0].length) return { labels: [], series: [] }
  const rowsMode = spec.seriesIn ? spec.seriesIn === 'rows' : spec.labels === 'firstRow'
  if (rowsMode) grid = transpose(grid)

  let header = detectHeader(grid, lang)
  // one data row across several columns (with or without a header) reads as one series
  if (!spec.seriesIn && spec.labels !== 'firstColumn' && grid[0].length >= 2 && grid.length - (header ? 1 : 0) === 1) {
    grid = transpose(grid)
    header = detectHeader(grid, lang)
  }

  const data = header ? grid.slice(1) : grid
  const head = header ? grid[0] : null
  const cols = grid[0].length

  let labelCol = false
  if (spec.labels === 'firstColumn') labelCol = cols >= 1
  else if (spec.labels === 'none') labelCol = false
  else if (cols >= 2) {
    const col0 = data.map((r) => r[0])
    labelCol = col0.some((c) => isText(c, lang)) || (col0.every((c) => isBlank(c) || YEARISH(c)) && col0.some(YEARISH)) || (!!head && isText(head[0], lang) && col0.every((c) => isBlank(c) || !!parseNumber(c, lang)) && cols >= 2 && isSequence(col0, lang))
  }

  const start = labelCol ? 1 : 0
  const series: ChartSeries[] = []
  const units = new Set<string>()
  for (let j = start; j < cols; j++) {
    const vals = data.map((r) => {
      const p = parseNumber(r[j], lang)
      if (p?.unit) units.add(p.unit)
      return p ? p.value : null
    })
    if (vals.every((v) => v === null)) continue
    const title = head ? cellText(head[j]) : ''
    series.push({ name: title || name(series.length + 1), values: vals })
  }
  if (!series.length) return countValues(grid, opts.countName ?? (lang === 'de' ? 'Anzahl' : 'Count'))
  let labels = data.map((r, i) => (labelCol ? cellText(r[0]) : String(i + 1)))

  // drop rows without a label and without any value
  const keep = labels.map((l, i) => !!l || series.some((s) => s.values[i] !== null))
  if (keep.some((k) => !k)) {
    labels = labels.filter((_, i) => keep[i])
    for (const s of series) s.values = s.values.filter((_, i) => keep[i])
  }
  const out: ChartData = { labels, series }
  const unit = spec.unit || (units.size === 1 ? [...units][0] : '')
  if (unit) out.unit = unit
  return out
}

/**
 * A table without a single number ("Done / Open / Done"): how often each value occurs, in the
 * column that groups best — one whose values repeat, with two or more groups when there is one,
 * the fewest groups. A first cell that never repeats over a column that does is its header.
 * Nothing to count when no value repeats (labels typed before their numbers stay "no data yet").
 */
function countValues(grid: CellValue[][], name: string): ChartData {
  let best: { values: string[]; rank: number[] } | null = null
  for (let j = 0; j < (grid[0]?.length ?? 0); j++) {
    const values = grid.map((r) => cellText(r[j]))
    const rest = values.slice(1).filter(Boolean)
    if (values[0] && rest.length > 1 && new Set(rest).size < rest.length && !rest.includes(values[0])) values.shift()
    const filled = values.filter(Boolean)
    const distinct = new Set(filled).size
    if (!distinct) continue
    // a column whose values repeat, then one with ≥ 2 groups, then the fewest groups
    const rank = [distinct < filled.length ? 0 : 1, distinct > 1 ? 0 : 1, distinct]
    if (!best || before(rank, best.rank)) best = { values, rank }
  }
  if (!best || best.rank[0]) return { labels: [], series: [] }
  const counts = new Map<string, number>()
  for (const v of best.values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return { labels: [...counts.keys()], series: [{ name, values: [...counts.values()] }] }
}

/** lexicographic a < b */
function before(a: number[], b: number[]): boolean {
  const i = a.findIndex((x, k) => x !== b[k])
  return i >= 0 && a[i] < b[i]
}

function isSequence(col: CellValue[], lang: 'en' | 'de'): boolean {
  const nums = col.map((c) => parseNumber(c, lang)?.value).filter((v): v is number => v !== undefined)
  if (nums.length < 2 || !nums.every(Number.isInteger)) return false
  for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) return false
  return true
}

/* ------------------------------------------------------------------ */
/* ChartData → table (data table view, TSV, Markdown, frozen snapshot)  */
/* ------------------------------------------------------------------ */

/** Header row + one row per label: [label, value of series 1, …]. */
export function chartDataToRows(data: ChartData, labelHeader = ''): (string | number | null)[][] {
  const head: (string | number | null)[] = [labelHeader, ...data.series.map((s) => s.name)]
  const rows = data.labels.map((l, i) => [l, ...data.series.map((s) => s.values[i] ?? null)])
  return [head, ...rows]
}

const tsvCell = (v: string | number | null) => (v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' '))

export function chartDataToTsv(data: ChartData, labelHeader = ''): string {
  return chartDataToRows(data, labelHeader)
    .map((r) => r.map(tsvCell).join('\t'))
    .join('\n')
}

/** Pasted text (TSV from a spreadsheet, or CSV / semicolon lists, or "label number" lines) → grid rows. */
export function rowsFromText(text: string, maxRows = 400, maxCols = 24): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const split = (sep: string) => lines.slice(0, maxRows).map((l) => l.split(sep).slice(0, maxCols).map((c) => c.trim().replace(/^"(.*)"$/, '$1')))
  if (lines.some((l) => l.includes('\t'))) return split('\t')
  if (lines.every((l) => !l.trim() || l.includes(';'))) return split(';')
  return labelNumberRows(lines.slice(0, maxRows), maxCols) ?? split(',')
}

const NUM = String.raw`\(?[-+]?[€$£¥₹]?\d[\d.,'\u00a0\u202f]*[%€$£¥₹]?\)?`
const NUM_ONLY = new RegExp(`^${NUM}$`)
/** "Jan 12", "Jan: 12 15", "Website relaunch 18.000 €", "Q1 = 1,5" */
const LABEL_NUMBERS = new RegExp(String.raw`^(.*?\S)(?:\s*[:=]\s*|\s+)((?:${NUM})(?:\s+${NUM})*|[€$£¥₹]\s?${NUM}|${NUM}\s?[%€$£¥₹])$`)

/**
 * Lines with a label and trailing numbers, separated by spaces (what a phone's notes app or a
 * copied web page gives). A first line without digits is the header. Null when the text is
 * not like that (≥ 2 such lines, no comma inside a label — "Jan, 12" stays CSV).
 */
function labelNumberRows(lines: string[], maxCols: number): string[][] | null {
  const rows: string[][] = []
  let matched = 0
  let width = 2
  let header: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l) {
      rows.push([''])
      continue
    }
    const m = l.length <= 240 ? LABEL_NUMBERS.exec(l) : null
    if (m && !m[1].includes(',')) {
      const tokens = m[2].split(/\s+/)
      const nums = tokens.length > 1 && tokens.every((x) => NUM_ONLY.test(x)) ? tokens : [m[2]]
      rows.push([m[1], ...nums].slice(0, maxCols))
      width = Math.max(width, Math.min(maxCols, nums.length + 1))
      matched++
    } else if (i === 0 && !/\d/.test(l)) {
      header = l
      rows.push([l])
    } else return null
  }
  if (matched < 2) return null
  if (header !== null) {
    const words = header.split(/\s+/)
    if (words.length === width) rows[0] = words
  }
  return rows
}
