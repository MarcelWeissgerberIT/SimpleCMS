/**
 * AutoComplete of cell values (Excel / Sheets behaviour) and the "Pick from list" entries: the
 * text entries of a column. Numbers, dates, booleans, formulas and blanks never take part.
 */
import type { CellFormat } from './format'
import { canonicalInput, literal } from './input'
import { a1 } from './refs'

/** The cells of a sheet as stored (the block's SheetData fits). */
export interface ColumnSource {
  rows: number
  cells: Record<string, { v?: string; fmt?: CellFormat } | undefined>
}

/** The text a cell holds ("'007" → "007"), or null for blanks, formulas and non-text values. */
export function cellText(cell: { v?: string; fmt?: CellFormat } | undefined): string | null {
  const raw = cell?.v
  if (!raw || raw[0] === '=') return null
  const { value } = literal(raw, cell.fmt?.type)
  return typeof value === 'string' && value.trim() ? value : null
}

const filled = (s: ColumnSource, r: number, c: number) => !!s.cells[a1(r, c)]?.v

/** Distinct texts, first spelling wins (case-insensitive). */
function distinct(list: string[]): string[] {
  const seen = new Set<string>()
  return list.filter((x) => {
    const k = x.toLocaleLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * The text entries of the contiguous data region of column `col` around `row` (the cells right
 * above and below it up to the first blank), the cell itself left out — nearest first, the row
 * above before the row below.
 */
export function columnEntries(s: ColumnSource, row: number, col: number): string[] {
  const out: string[] = []
  let up = row - 1
  let down = row + 1
  let goUp = up >= 0 && filled(s, up, col)
  let goDown = down < s.rows && filled(s, down, col)
  while (goUp || goDown) {
    if (goUp) {
      const t = cellText(s.cells[a1(up, col)])
      if (t !== null) out.push(t)
      up--
      goUp = up >= 0 && filled(s, up, col)
    }
    if (goDown) {
      const t = cellText(s.cells[a1(down, col)])
      if (t !== null) out.push(t)
      down++
      goDown = down < s.rows && filled(s, down, col)
    }
  }
  return distinct(out)
}

/**
 * The entry that completes what was typed: the nearest one starting with it (case-insensitive),
 * nothing when the typed text is empty, a formula, a number / date / boolean, forced text ("'"),
 * or already one of the entries.
 */
export function completeEntry(entries: string[], typed: string, lang: 'en' | 'de'): string | null {
  return completeEntries(entries, typed, lang, 1)[0] ?? null
}

/**
 * Every entry that completes what was typed (the touch suggestion strip), nearest first — the
 * same rules as completeEntry, whose proposal is the first of them.
 */
export function completeEntries(entries: string[], typed: string, lang: 'en' | 'de', max = Infinity): string[] {
  if (!typed || typed[0] === '=' || typed[0] === "'" || !entries.length) return []
  const canon = canonicalInput(typed, lang)
  if (canon.fmt || typeof literal(canon.v).value !== 'string') return []
  const low = typed.toLocaleLowerCase()
  if (entries.some((e) => e.toLocaleLowerCase() === low)) return []
  const out: string[] = []
  for (const e of entries) {
    if (out.length >= max) break
    if (e.length > typed.length && e.toLocaleLowerCase().startsWith(low)) out.push(e)
  }
  return out
}

/**
 * "Pick from list" (Alt+↓): the distinct texts of the cell's data region, sorted; the whole
 * column when the region has none.
 */
export function pickEntries(s: ColumnSource, row: number, col: number, lang: 'en' | 'de'): string[] {
  let list = columnEntries(s, row, col)
  if (!list.length) {
    const all: string[] = []
    for (let r = 0; r < s.rows; r++) {
      if (r === row) continue
      const t = cellText(s.cells[a1(r, col)])
      if (t !== null) all.push(t)
    }
    list = distinct(all)
  }
  const coll = new Intl.Collator(lang === 'de' ? 'de-DE' : 'en-US', { sensitivity: 'base', numeric: true })
  return [...list].sort(coll.compare)
}
