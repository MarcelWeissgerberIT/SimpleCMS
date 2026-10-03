/**
 * Lookup & reference. These need ONE rectangle: a range or a single-area dataset (a dataset with
 * several areas is #VALUE!).
 */
import type { Area, CellValue, FnSpec, Value } from '../types'
import { compare, isErr, rangeValue, singleArea, toScalar } from '../values'
import { arg, def, err, globMatch, hasWildcard, int } from './helpers'

const ANY = (name: string, opts?: { optional?: boolean }) => arg(name, 'any', opts)
const RANGE = (name: string, opts?: { optional?: boolean }) => arg(name, 'range', opts)
const NUMA = (name: string, opts?: { optional?: boolean }) => arg(name, 'number', opts)

const MULTI = () => err('#VALUE!', 'this function needs one rectangle — the dataset has several areas')

function area(v: Value | undefined): Area | ReturnType<typeof err> {
  if (v === undefined) return err('#VALUE!')
  if (isErr(v)) return v
  return singleArea(v) ?? MULTI()
}

/** Exact equality for lookups (text: case-insensitive, wildcards when `wild`). */
function same(cell: CellValue, target: CellValue, wild: boolean): boolean {
  if (isErr(cell) || cell === null) return target === null ? false : false
  if (typeof target === 'string' && typeof cell === 'string') return wild && hasWildcard(target) ? globMatch(target, cell) : cell.toLowerCase() === target.toLowerCase()
  if (typeof target !== typeof cell) return false
  return compare(cell, target as Exclude<CellValue, { kind: 'error' }>) === 0
}

const comparable = (cell: CellValue, target: CellValue) =>
  cell !== null && !isErr(cell) && (typeof cell === typeof target || (typeof cell === 'number' && typeof target === 'number'))

/** Index (0-based) in a vector: exact (0), largest ≤ (1, ascending), smallest ≥ (-1, descending). */
function find(vec: CellValue[], target: CellValue, mode: 0 | 1 | -1, wild = true): number {
  if (mode === 0) return vec.findIndex((c) => same(c, target, wild))
  let hit = -1
  for (let i = 0; i < vec.length; i++) {
    const c = vec[i]
    if (!comparable(c, target)) continue
    const d = compare(c as never, target as never)
    if (mode === 1) {
      if (d <= 0) hit = i
      else break
    } else {
      if (d >= 0) hit = i
      else break
    }
  }
  return hit
}

const column = (a: Area, c: number) => a.values.map((row) => row[c] ?? null)
const row = (a: Area, r: number) => a.values[r] ?? []

export const lookupFunctions: FnSpec[] = [
  def('VLOOKUP', 'lookup', [ANY('search_key'), RANGE('table'), NUMA('column'), arg('approximate', 'bool', { optional: true })], 'Looks a value up in the first column of a table and returns a cell of that row.', 'Sucht einen Wert in der ersten Spalte einer Tabelle und liefert eine Zelle dieser Zeile (SVERWEIS).', '=VLOOKUP("Nord"; A2:C9; 3; FALSE)', (a) => {
    const key = toScalar(a[0])
    if (isErr(key)) return key
    const t = area(a[1])
    if (isErr(t)) return t
    const c = int(a[2])
    if (isErr(c)) return c
    if (c < 1) return err('#VALUE!', 'column must be 1 or more')
    if (c > t.cols) return err('#REF!', 'column outside the table')
    const approx = a[3] === undefined || a[3] === null ? true : toScalar(a[3])
    if (isErr(approx)) return approx
    const i = find(column(t, 0), key, approx === false || approx === 0 ? 0 : 1)
    return i < 0 ? err('#N/A', 'not found') : (t.values[i][c - 1] ?? null)
  }, { keywords: 'SVERWEIS lookup suchen verweis' }),
  def('HLOOKUP', 'lookup', [ANY('search_key'), RANGE('table'), NUMA('row'), arg('approximate', 'bool', { optional: true })], 'Looks a value up in the first row of a table and returns a cell of that column.', 'Sucht einen Wert in der ersten Zeile einer Tabelle und liefert eine Zelle dieser Spalte (WVERWEIS).', '=HLOOKUP("Q2"; B1:E5; 3; FALSE)', (a) => {
    const key = toScalar(a[0])
    if (isErr(key)) return key
    const t = area(a[1])
    if (isErr(t)) return t
    const r = int(a[2])
    if (isErr(r)) return r
    if (r < 1) return err('#VALUE!', 'row must be 1 or more')
    if (r > t.rows) return err('#REF!', 'row outside the table')
    const approx = a[3] === undefined || a[3] === null ? true : toScalar(a[3])
    if (isErr(approx)) return approx
    const i = find(row(t, 0), key, approx === false || approx === 0 ? 0 : 1)
    return i < 0 ? err('#N/A', 'not found') : (t.values[r - 1][i] ?? null)
  }, { keywords: 'WVERWEIS lookup suchen verweis' }),
  def('XLOOKUP', 'lookup', [ANY('search_key'), RANGE('lookup_range'), RANGE('result_range'), ANY('if_not_found', { optional: true }), NUMA('match_mode', { optional: true }), NUMA('search_mode', { optional: true })], 'Finds a value in one row or column and returns the matching cell of another (match: 0 exact, -1 next smaller, 1 next larger, 2 wildcards).', 'Findet einen Wert in einer Zeile oder Spalte und liefert die passende Zelle einer anderen (Abgleich: 0 genau, -1 nächstkleiner, 1 nächstgrößer, 2 Platzhalter).', '=XLOOKUP(A1; D2:D9; F2:F9; "–")', (a) => {
    const key = toScalar(a[0])
    if (isErr(key)) return key
    const look = area(a[1])
    if (isErr(look)) return look
    const res = area(a[2])
    if (isErr(res)) return res
    const vertical = look.cols === 1
    if (!vertical && look.rows !== 1) return err('#VALUE!', 'the lookup range must be one row or one column')
    const vec = vertical ? column(look, 0) : row(look, 0)
    if ((vertical ? res.rows : res.cols) !== vec.length) return err('#VALUE!', 'lookup and result ranges differ in size')
    const mm = int(a[4], 0)
    const sm = int(a[5], 1)
    if (isErr(mm)) return mm
    if (isErr(sm)) return sm
    const order = sm < 0 ? vec.map((_, i) => vec.length - 1 - i) : vec.map((_, i) => i)
    let hit = -1
    let best: CellValue = null
    for (const i of order) {
      const c = vec[i]
      if (mm === 0 || mm === 2) {
        if (same(c, key, mm === 2)) {
          hit = i
          break
        }
        continue
      }
      if (same(c, key, false)) {
        hit = i
        break
      }
      if (!comparable(c, key)) continue
      const d = compare(c as never, key as never)
      if (mm === -1 && d < 0 && (best === null || compare(c as never, best as never) > 0)) {
        best = c
        hit = i
      }
      if (mm === 1 && d > 0 && (best === null || compare(c as never, best as never) < 0)) {
        best = c
        hit = i
      }
    }
    if (hit < 0) return a[3] !== undefined && a[3] !== null ? a[3] : err('#N/A', 'not found')
    if (vertical) {
      if (res.cols === 1) return res.values[hit][0] ?? null
      return rangeValue({ sheetId: res.sheetId, top: res.top + hit, left: res.left, rows: 1, cols: res.cols, values: [res.values[hit]] })
    }
    if (res.rows === 1) return res.values[0][hit] ?? null
    return rangeValue({ sheetId: res.sheetId, top: res.top, left: res.left + hit, rows: res.rows, cols: 1, values: res.values.map((r) => [r[hit]]) })
  }, { keywords: 'XVERWEIS lookup suchen verweis' }),
  def('INDEX', 'lookup', [RANGE('range'), NUMA('row'), NUMA('column', { optional: true })], 'The cell at a row and column of a range (from 1).', 'Die Zelle an Zeile und Spalte eines Bereichs (ab 1).', '=INDEX(A2:C9; 3; 2)', (a) => {
    const t = area(a[0])
    if (isErr(t)) return t
    let r = int(a[1], 0)
    let c = int(a[2], 0)
    if (isErr(r)) return r
    if (isErr(c)) return c
    // a single row: one index means the column
    if (a[2] === undefined && t.rows === 1 && t.cols > 1) {
      c = r
      r = 1
    } else if (a[2] === undefined) c = 1
    if (r < 0 || c < 0 || r > t.rows || c > t.cols) return err('#REF!', 'outside the range')
    if (r === 0 && c === 0) return rangeValue(t)
    if (r === 0) return rangeValue({ sheetId: t.sheetId, top: t.top, left: t.left + c - 1, rows: t.rows, cols: 1, values: t.values.map((x) => [x[c - 1]]) })
    if (c === 0) return rangeValue({ sheetId: t.sheetId, top: t.top + r - 1, left: t.left, rows: 1, cols: t.cols, values: [t.values[r - 1]] })
    return t.values[r - 1][c - 1] ?? null
  }, { keywords: 'index position' }),
  def('MATCH', 'lookup', [ANY('search_key'), RANGE('range'), NUMA('type', { optional: true })], 'Position of a value in a row or column (type 0 exact, 1 largest ≤, -1 smallest ≥).', 'Position eines Wertes in einer Zeile oder Spalte (Typ 0 genau, 1 größter ≤, -1 kleinster ≥).', '=MATCH("Nord"; A2:A9; 0)', (a) => {
    const key = toScalar(a[0])
    if (isErr(key)) return key
    const t = area(a[1])
    if (isErr(t)) return t
    if (t.rows !== 1 && t.cols !== 1) return err('#N/A', 'the range must be one row or one column')
    const vec = t.cols === 1 ? column(t, 0) : row(t, 0)
    const ty = int(a[2], 1)
    if (isErr(ty)) return ty
    const i = find(vec, key, ty === 0 ? 0 : ty > 0 ? 1 : -1)
    return i < 0 ? err('#N/A', 'not found') : i + 1
  }, { keywords: 'VERGLEICH position match' }),
  def('ROWS', 'lookup', [RANGE('range')], 'Number of rows of a range.', 'Anzahl der Zeilen eines Bereichs.', '=ROWS(A2:C9)', (a) => {
    const t = area(a[0])
    return isErr(t) ? t : t.rows
  }, { keywords: 'ZEILEN rows count' }),
  def('COLUMNS', 'lookup', [RANGE('range')], 'Number of columns of a range.', 'Anzahl der Spalten eines Bereichs.', '=COLUMNS(A2:C9)', (a) => {
    const t = area(a[0])
    return isErr(t) ? t : t.cols
  }, { keywords: 'SPALTEN columns count' }),
]
