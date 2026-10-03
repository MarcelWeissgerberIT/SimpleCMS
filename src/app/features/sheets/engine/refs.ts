/** A1 notation: column letters, cell / range references, sheet-name quoting. All indices 0-based. */

/** Sheet size limits (a block is a document element, not a database). */
export const MAX_ROWS = 2000
export const MAX_COLS = 100

export function colName(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function colIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const a1 = (row: number, col: number): string => `${colName(col)}${row + 1}`

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/
const RANGE_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})$/
const COLS_RE = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/

/** "B3" → { row: 2, col: 1 } (null when it isn't a cell address). */
export function parseA1(s: string): { row: number; col: number } | null {
  const m = CELL_RE.exec(s.trim())
  if (!m) return null
  const row = Number(m[2]) - 1
  const col = colIndex(m[1])
  return row >= 0 && col >= 0 ? { row, col } : null
}

/** A rectangle (inclusive bounds). `bottom` is Infinity for whole columns ("B:B"). */
export interface Rect {
  top: number
  left: number
  bottom: number
  right: number
}

/** 'A1:A10' | 'B:B' | 'C3' → a rectangle (normalised: top ≤ bottom, left ≤ right). */
export function parseRect(s: string): Rect | null {
  const t = s.trim()
  let m = RANGE_RE.exec(t)
  if (m) {
    const r1 = Number(m[2]) - 1
    const r2 = Number(m[4]) - 1
    const c1 = colIndex(m[1])
    const c2 = colIndex(m[3])
    if (r1 < 0 || r2 < 0) return null
    return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) }
  }
  m = COLS_RE.exec(t)
  if (m) {
    const c1 = colIndex(m[1])
    const c2 = colIndex(m[2])
    return { top: 0, bottom: Infinity, left: Math.min(c1, c2), right: Math.max(c1, c2) }
  }
  const c = parseA1(t)
  return c ? { top: c.row, bottom: c.row, left: c.col, right: c.col } : null
}

/** A rectangle as A1 text ('C3', 'A1:B4', 'B:B'). */
export function rectText(r: Rect): string {
  if (r.bottom === Infinity) return `${colName(r.left)}:${colName(r.right)}`
  if (r.top === r.bottom && r.left === r.right) return a1(r.top, r.left)
  return `${a1(r.top, r.left)}:${a1(r.bottom, r.right)}`
}

/** Looks like a cell address (dataset names must not). */
export const isA1Like = (s: string): boolean => CELL_RE.test(s) || /^R\d+C\d+$/i.test(s)

/** Sheet name as it must be written in a formula: quoted unless it is a plain identifier. */
export function quoteSheet(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !CELL_RE.test(name) && !/^(TRUE|FALSE)$/i.test(name)) return name
  return `'${name.replace(/'/g, "''")}'`
}

export const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()
