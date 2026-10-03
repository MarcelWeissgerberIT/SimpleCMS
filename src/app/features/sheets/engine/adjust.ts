/**
 * Reference adjustment: rows / columns inserted or deleted, cells copied or filled, sheets renamed
 * or deleted. Works on the tokens, so only the references change — the author's spacing,
 * separators and casing stay as they were. Deleted targets become #REF!.
 */
import { lex, type RefPart, type RefTok } from './lexer'
import { colName, MAX_COLS, MAX_ROWS, parseRect, quoteSheet, rectText, sameName, type Rect } from './refs'

export interface StructOp {
  kind: 'insert' | 'delete'
  axis: 'row' | 'col'
  /** sheet whose rows / columns change */
  sheetId: string
  at: number
  count: number
}

type RefShape = Pick<RefTok, 'sheet' | 'a' | 'b' | 'cols'>

function partText(p: RefPart, cols: boolean): string {
  return `${p.colAbs ? '$' : ''}${colName(p.col)}${cols ? '' : `${p.rowAbs ? '$' : ''}${p.row + 1}`}`
}

export function refText(t: RefShape): string {
  const sheet = t.sheet !== null ? `${quoteSheet(t.sheet)}!` : ''
  return `${sheet}${partText(t.a, t.cols)}${t.b ? `:${partText(t.b, t.cols)}` : ''}`
}

/**
 * Rewrite every reference of an expression (no leading "="). `fn` returns the new reference,
 * null for #REF!, or undefined to keep it.
 */
export function rewriteRefs(body: string, fn: (t: RefTok) => RefShape | null | undefined): string {
  if (!body) return body
  const toks = lex(body, true)
  let out = ''
  let last = 0
  for (const t of toks) {
    if (t.t !== 'ref') continue
    const next = fn(t)
    if (next === undefined) continue
    out += body.slice(last, t.s) + (next === null ? '#REF!' : refText(next))
    last = t.e
  }
  return last ? out + body.slice(last) : body
}

/** Same for a cell input: only formulas ("=…") change. */
export function rewriteFormula(raw: string, fn: (t: RefTok) => RefShape | null | undefined): string {
  if (raw.length < 2 || raw[0] !== '=') return raw
  const body = rewriteRefs(raw.slice(1), fn)
  return body === raw.slice(1) ? raw : `=${body}`
}

const clonePart = (p: RefPart): RefPart => ({ ...p })

/** One axis of a reference after an insert / delete: [first, last] → new bounds, or null (deleted). */
function shiftSpan(first: number, last: number, op: StructOp): [number, number] | null {
  const { at, count } = op
  if (op.kind === 'insert') {
    const f = first >= at ? first + count : first
    const l = last >= at ? last + count : last
    const max = op.axis === 'row' ? MAX_ROWS : MAX_COLS
    if (f >= max) return null
    return [f, Math.min(l, max - 1)]
  }
  const end = at + count
  if (first >= end) return [first - count, last - count]
  if (last < at) return [first, last]
  const f = first < at ? first : at
  const l = last >= end ? last - count : at - 1
  return l < f ? null : [f, l]
}

/** A reference after rows / columns of `op.sheetId` changed; `targetsSheet`: does it point there? */
function structRef(t: RefTok, op: StructOp, targetsSheet: boolean): RefShape | null | undefined {
  if (!targetsSheet) return undefined
  const a = clonePart(t.a)
  const b = t.b ? clonePart(t.b) : null
  if (op.axis === 'row') {
    if (t.cols) return undefined
    const top = b ? Math.min(a.row, b.row) : a.row
    const bottom = b ? Math.max(a.row, b.row) : a.row
    const span = shiftSpan(top, bottom, op)
    if (!span) return null
    if (!b) a.row = span[0]
    else if (a.row <= b.row) [a.row, b.row] = span
    else [b.row, a.row] = span
  } else {
    const left = b ? Math.min(a.col, b.col) : a.col
    const right = b ? Math.max(a.col, b.col) : a.col
    const span = shiftSpan(left, right, op)
    if (!span) return null
    if (!b) a.col = span[0]
    else if (a.col <= b.col) [a.col, b.col] = span
    else [b.col, a.col] = span
  }
  return { sheet: t.sheet, a, b, cols: t.cols }
}

/**
 * A formula after rows / columns were inserted or deleted. `formulaSheet`: the sheet the formula
 * lives on; `sheetIdOf`: resolves a sheet name written in a formula.
 */
export function adjustFormula(raw: string, formulaSheet: string, op: StructOp, sheetIdOf: (name: string) => string | null): string {
  return rewriteFormula(raw, (t) => structRef(t, op, (t.sheet === null ? formulaSheet : sheetIdOf(t.sheet)) === op.sheetId))
}

/** Same for an expression without "=" (chart sources: 'A1:C10', 'DS(A1:A5; C1:C5)'). */
export function adjustExpression(body: string, formulaSheet: string, op: StructOp, sheetIdOf: (name: string) => string | null): string {
  return rewriteRefs(body, (t) => structRef(t, op, (t.sheet === null ? formulaSheet : sheetIdOf(t.sheet)) === op.sheetId))
}

/** A formula copied by (dr, dc): relative parts move, $absolute parts stay; off the sheet → #REF!. */
export function shiftFormula(raw: string, dr: number, dc: number): string {
  if (!dr && !dc) return raw
  return rewriteFormula(raw, (t) => {
    const move = (p: RefPart): RefPart | null => {
      const q = { ...p }
      if (!t.cols && !q.rowAbs) q.row += dr
      if (!q.colAbs) q.col += dc
      if (q.col < 0 || q.col >= MAX_COLS || (!t.cols && (q.row < 0 || q.row >= MAX_ROWS))) return null
      return q
    }
    const a = move(t.a)
    const b = t.b ? move(t.b) : null
    if (!a || (t.b && !b)) return null
    return { sheet: t.sheet, a, b, cols: t.cols }
  })
}

/** References to a renamed sheet follow the new name. */
export function renameSheetRefs(raw: string, from: string, to: string): string {
  return rewriteFormula(raw, (t) => (t.sheet !== null && sameName(t.sheet, from) ? { ...t, sheet: to } : undefined))
}

export function renameSheetInExpression(body: string, from: string, to: string): string {
  return rewriteRefs(body, (t) => (t.sheet !== null && sameName(t.sheet, from) ? { ...t, sheet: to } : undefined))
}

/** References to a deleted sheet become #REF!. */
export function dropSheetRefs(raw: string, name: string): string {
  return rewriteFormula(raw, (t) => (t.sheet !== null && sameName(t.sheet, name) ? null : undefined))
}

/** A stored range ('A1:A10', 'B:B', 'C3') after an insert / delete on its sheet; null when it is gone. */
export function adjustRect(ref: string, op: StructOp): string | null {
  const r = parseRect(ref)
  if (!r) return null
  const out: Rect = { ...r }
  if (op.axis === 'row') {
    if (r.bottom === Infinity) return ref
    const span = shiftSpan(r.top, r.bottom, op)
    if (!span) return null
    ;[out.top, out.bottom] = span
  } else {
    const span = shiftSpan(r.left, r.right, op)
    if (!span) return null
    ;[out.left, out.right] = span
  }
  return rectText(out)
}
