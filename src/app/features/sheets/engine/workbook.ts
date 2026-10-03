/**
 * A workbook: the cells of every sheet of one spreadsheet block, their values, and the dependency
 * graph between them.
 *
 *  - Dependencies are static (references, ranges, DS(...), named datasets): every formula registers
 *    the rectangles it reads in a per-column index, so "who reads this cell" is a short lookup.
 *  - sync() diffs the new cell inputs against the last ones and recalculates only the changed
 *    cells and everything downstream of them, in topological order (Kahn). Cells left over are in
 *    a cycle (Tarjan) → #CYCLE!; cells downstream of a cycle are evaluated after it.
 *  - Structure changes (sheets added / renamed / resized, datasets, the function set) rebuild.
 *  - One recalculation has a step budget; when it runs out, the cells not yet done show #NUM!.
 */
import type { Node } from './parser'
import { parseFormula, walk } from './parser'
import { ParseError } from './lexer'
import { evalFormula, evalNode, inferHint, LimitError, MAX_STEPS, refRect, type Env, type Resolver } from './evaluate'
import { literal } from './input'
import { MAX_COLS, parseA1, parseRect, type Rect } from './refs'
import { getFunction, registryVersion } from './registry'
import type { CellFormat } from './format'
import type { CellValue, ErrorValue, Value, ValueHint } from './types'
import { err } from './values'

export interface CellSource {
  v?: string
  fmt?: CellFormat
}

export interface SheetSource {
  id: string
  name: string
  rows: number
  cols: number
  cells: Record<string, CellSource>
}

export interface DatasetSource {
  id: string
  name: string
  ranges: Array<{ sheet: string; ref: string }>
}

interface Dep {
  cell: Cell
  sheetId: string
  top: number
  bottom: number
}

interface Cell {
  sheetId: string
  row: number
  col: number
  raw: string
  fmtType: string
  ast: Node | null
  perr: ErrorValue | null
  deps: Array<{ key: string; dep: Dep }>
  value: CellValue
  hint: ValueHint
  volatile: boolean
}

interface SheetState {
  id: string
  name: string
  rows: number
  cols: number
  cells: Map<number, Cell>
}

const STRIDE = 1024
const ckey = (row: number, col: number) => row * STRIDE + col
const colKey = (sheetId: string, col: number) => `${sheetId}\u0001${col}`

export interface CellInfo {
  value: CellValue
  hint: ValueHint
  formula: boolean
}

const EMPTY: CellInfo = { value: null, hint: null, formula: false }

export class Workbook implements Resolver {
  private sheets = new Map<string, SheetState>()
  private names = new Map<string, string>()
  private datasets = new Map<string, Array<{ sheetId: string; rect: Rect }>>()
  private byCol = new Map<string, Set<Dep>>()
  private shape = ''
  private reg = -1
  private now = new Date()
  /** bumps after every recalculation */
  version = 0
  lang: 'en' | 'de'
  maxSteps: number

  constructor(opts: { lang?: 'en' | 'de'; maxSteps?: number } = {}) {
    this.lang = opts.lang ?? 'en'
    this.maxSteps = opts.maxSteps ?? MAX_STEPS
  }

  /* ---------------- Resolver ---------------- */

  sheetId(name: string): string | null {
    return this.names.get(name.toLocaleLowerCase()) ?? null
  }

  size(sheetId: string): { rows: number; cols: number } | null {
    const s = this.sheets.get(sheetId)
    return s ? { rows: s.rows, cols: s.cols } : null
  }

  value(sheetId: string, row: number, col: number): CellValue {
    return this.sheets.get(sheetId)?.cells.get(ckey(row, col))?.value ?? null
  }

  hint(sheetId: string, row: number, col: number): ValueHint {
    const c = this.sheets.get(sheetId)?.cells.get(ckey(row, col))
    if (!c) return null
    if (c.fmtType === 'date') return 'date'
    return c.hint
  }

  dataset(name: string): Array<{ sheetId: string; rect: Rect }> | null {
    return this.datasets.get(name.toLocaleLowerCase()) ?? null
  }

  /* ---------------- reading ---------------- */

  get(sheetId: string, row: number, col: number): CellInfo {
    const c = this.sheets.get(sheetId)?.cells.get(ckey(row, col))
    return c ? { value: c.value, hint: this.hint(sheetId, row, col), formula: !!c.ast || !!c.perr } : EMPTY
  }

  /** Error details of a cell (tooltips). */
  error(sheetId: string, row: number, col: number): ErrorValue | null {
    const c = this.sheets.get(sheetId)?.cells.get(ckey(row, col))
    const v = c?.value
    return v && typeof v === 'object' ? v : null
  }

  formulaCount(sheetId: string): number {
    let n = 0
    for (const c of this.sheets.get(sheetId)?.cells.values() ?? []) if (c.ast || c.perr) n++
    return n
  }

  /* ---------------- loading ---------------- */

  /** Bring the workbook up to date with these inputs (incremental when only cells changed). */
  sync(sheets: SheetSource[], datasets: DatasetSource[] = []): void {
    const shape = JSON.stringify([sheets.map((s) => [s.id, s.name, s.rows, s.cols]), datasets.map((d) => [d.name, d.ranges])])
    if (shape !== this.shape || this.reg !== registryVersion()) return this.load(sheets, datasets, shape)
    const changed: Cell[] = []
    const cleared: Array<{ sheetId: string; row: number; col: number }> = []
    for (const src of sheets) {
      const st = this.sheets.get(src.id)!
      const seen = new Set<number>()
      for (const [addr, c] of Object.entries(src.cells)) {
        const pos = parseA1(addr)
        if (!pos || pos.row >= st.rows || pos.col >= st.cols) continue
        const k = ckey(pos.row, pos.col)
        seen.add(k)
        const raw = c?.v ?? ''
        const fmtType = c?.fmt?.type ?? 'auto'
        const cur = st.cells.get(k)
        if (cur && cur.raw === raw && cur.fmtType === fmtType) continue
        if (!cur && !raw) continue
        if (cur) this.unregister(cur)
        if (!raw && fmtType === 'auto') {
          st.cells.delete(k)
          cleared.push({ sheetId: src.id, row: pos.row, col: pos.col })
          continue
        }
        const cell = this.makeCell(src.id, pos.row, pos.col, raw, fmtType)
        st.cells.set(k, cell)
        changed.push(cell)
      }
      for (const [k, cur] of [...st.cells]) {
        if (seen.has(k)) continue
        this.unregister(cur)
        st.cells.delete(k)
        cleared.push({ sheetId: src.id, row: cur.row, col: cur.col })
      }
    }
    if (!changed.length && !cleared.length) return
    for (const c of changed) this.register(c)
    this.recalc(changed, cleared)
  }

  private load(sheets: SheetSource[], datasets: DatasetSource[], shape: string): void {
    this.shape = shape
    this.reg = registryVersion()
    this.now = new Date()
    this.sheets.clear()
    this.names.clear()
    this.byCol.clear()
    this.datasets.clear()
    for (const src of sheets) {
      this.sheets.set(src.id, { id: src.id, name: src.name, rows: src.rows, cols: Math.min(src.cols, MAX_COLS), cells: new Map() })
      if (!this.names.has(src.name.toLocaleLowerCase())) this.names.set(src.name.toLocaleLowerCase(), src.id)
    }
    for (const d of datasets) {
      const list: Array<{ sheetId: string; rect: Rect }> = []
      for (const r of d.ranges) {
        const rect = parseRect(r.ref)
        if (rect && this.sheets.has(r.sheet)) list.push({ sheetId: r.sheet, rect })
      }
      if (!this.datasets.has(d.name.toLocaleLowerCase())) this.datasets.set(d.name.toLocaleLowerCase(), list)
    }
    const all: Cell[] = []
    for (const src of sheets) {
      const st = this.sheets.get(src.id)!
      for (const [addr, c] of Object.entries(src.cells)) {
        const pos = parseA1(addr)
        const raw = c?.v ?? ''
        const fmtType = c?.fmt?.type ?? 'auto'
        if (!pos || pos.row >= st.rows || pos.col >= st.cols || (!raw && fmtType === 'auto')) continue
        const cell = this.makeCell(src.id, pos.row, pos.col, raw, fmtType)
        st.cells.set(ckey(pos.row, pos.col), cell)
        all.push(cell)
      }
    }
    for (const c of all) this.register(c)
    this.evaluateAll(all.filter((c) => c.ast))
  }

  private makeCell(sheetId: string, row: number, col: number, raw: string, fmtType: string): Cell {
    const cell: Cell = { sheetId, row, col, raw, fmtType, ast: null, perr: null, deps: [], value: null, hint: null, volatile: false }
    if (fmtType !== 'text' && raw.length > 1 && raw[0] === '=') {
      try {
        cell.ast = parseFormula(raw.slice(1))
        walk(cell.ast, (n) => {
          if (n.k === 'call' && getFunction(n.name)?.volatile) cell.volatile = true
        })
      } catch (e) {
        cell.perr = err('#ERROR!', e instanceof ParseError ? e.message : 'invalid formula')
        cell.value = cell.perr
      }
    } else {
      const lit = literal(raw, fmtType as CellFormat['type'])
      cell.value = lit.value
      cell.hint = lit.hint
    }
    return cell
  }

  /* ---------------- dependency index ---------------- */

  private rectsOf(cell: Cell): Array<{ sheetId: string; rect: Rect }> {
    const out: Array<{ sheetId: string; rect: Rect }> = []
    if (!cell.ast) return out
    walk(cell.ast, (n, parent) => {
      if (n.k === 'ref') {
        const at = refRect(n, this, cell.sheetId)
        if (at) out.push(at)
      } else if ((n.k === 'name' || n.k === 'str') && parent?.k === 'call' && parent.name === 'DS') {
        const list = this.dataset(n.k === 'name' ? n.name : n.v)
        if (list) out.push(...list)
      }
    })
    return out
  }

  private register(cell: Cell): void {
    for (const { sheetId, rect } of this.rectsOf(cell)) {
      const dep: Dep = { cell, sheetId, top: rect.top, bottom: rect.bottom }
      const right = Math.min(rect.right, MAX_COLS - 1)
      for (let c = rect.left; c <= right; c++) {
        const key = colKey(sheetId, c)
        let set = this.byCol.get(key)
        if (!set) this.byCol.set(key, (set = new Set()))
        set.add(dep)
        cell.deps.push({ key, dep })
      }
    }
  }

  private unregister(cell: Cell): void {
    for (const { key, dep } of cell.deps) this.byCol.get(key)?.delete(dep)
    cell.deps = []
  }

  /** Formula cells that read this position. */
  private readers(sheetId: string, row: number, col: number): Cell[] {
    const set = this.byCol.get(colKey(sheetId, col))
    if (!set) return []
    const out: Cell[] = []
    for (const d of set) if (row >= d.top && row <= d.bottom) out.push(d.cell)
    return out
  }

  /* ---------------- recalculation ---------------- */

  private recalc(changed: Cell[], cleared: Array<{ sheetId: string; row: number; col: number }>): void {
    const affected = new Set<Cell>()
    const queue: Cell[] = []
    const add = (c: Cell) => {
      if (!c.ast || affected.has(c)) return
      affected.add(c)
      queue.push(c)
    }
    for (const c of changed) {
      add(c)
      for (const r of this.readers(c.sheetId, c.row, c.col)) add(r)
    }
    for (const p of cleared) for (const r of this.readers(p.sheetId, p.row, p.col)) add(r)
    for (let i = 0; i < queue.length; i++) for (const r of this.readers(queue[i].sheetId, queue[i].row, queue[i].col)) add(r)
    this.evaluateAll([...affected])
  }

  /** Evaluate formula cells in dependency order; cycles → #CYCLE!. */
  private evaluateAll(cells: Cell[]): void {
    const inSet = new Set(cells)
    const out = new Map<Cell, Cell[]>()
    const indeg = new Map<Cell, number>()
    for (const c of cells) indeg.set(c, 0)
    for (const c of cells) {
      const readers = this.readers(c.sheetId, c.row, c.col).filter((r) => inSet.has(r))
      const uniq = [...new Set(readers)]
      out.set(c, uniq)
      for (const r of uniq) indeg.set(r, indeg.get(r)! + 1)
    }
    const env: Env = { res: this, sheetId: '', now: this.now, lang: this.lang, budget: { left: this.maxSteps }, depth: 0 }
    const done = new Set<Cell>()
    let limit = false
    const run = (start: Cell[], deg: Map<Cell, number>) => {
      const q = [...start]
      for (let i = 0; i < q.length; i++) {
        const c = q[i]
        done.add(c)
        if (this.evalCell(c, env, limit)) limit = true
        for (const r of out.get(c) ?? []) {
          if (done.has(r)) continue
          const d = deg.get(r)! - 1
          deg.set(r, d)
          if (d === 0) q.push(r)
        }
      }
    }
    run(cells.filter((c) => indeg.get(c) === 0), indeg)
    if (done.size < cells.length) {
      const rest = cells.filter((c) => !done.has(c))
      const cyclic = this.cycles(rest, out, done)
      for (const c of cyclic) {
        c.value = err('#CYCLE!', 'the formula refers to itself, directly or through other cells')
        c.hint = null
        done.add(c)
      }
      // downstream of a cycle: only edges from cells still pending count
      const deg = new Map<Cell, number>()
      for (const c of rest) if (!done.has(c)) deg.set(c, 0)
      for (const c of rest) {
        if (done.has(c)) continue
        for (const r of out.get(c) ?? []) if (deg.has(r)) deg.set(r, deg.get(r)! + 1)
      }
      run([...deg.keys()].filter((c) => deg.get(c) === 0), deg)
      for (const c of rest) if (!done.has(c)) c.value = err('#CYCLE!', 'depends on a circular reference')
    }
    this.version++
  }

  /** Cells on a cycle (strongly connected components of size > 1, or reading themselves). */
  private cycles(rest: Cell[], out: Map<Cell, Cell[]>, done: Set<Cell>): Cell[] {
    const index = new Map<Cell, number>()
    const low = new Map<Cell, number>()
    const onStack = new Set<Cell>()
    const stack: Cell[] = []
    const result: Cell[] = []
    let i = 0
    const pending = new Set(rest)
    // iterative Tarjan (deep chains must not overflow the call stack)
    for (const root of rest) {
      if (index.has(root)) continue
      const work: Array<{ v: Cell; it: number }> = [{ v: root, it: 0 }]
      index.set(root, i)
      low.set(root, i++)
      stack.push(root)
      onStack.add(root)
      while (work.length) {
        const top = work[work.length - 1]
        const next = (out.get(top.v) ?? []).filter((w) => pending.has(w) && !done.has(w))
        if (top.it < next.length) {
          const w = next[top.it++]
          if (!index.has(w)) {
            index.set(w, i)
            low.set(w, i++)
            stack.push(w)
            onStack.add(w)
            work.push({ v: w, it: 0 })
          } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!))
          continue
        }
        work.pop()
        if (work.length) {
          const parent = work[work.length - 1].v
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!))
        }
        if (low.get(top.v) === index.get(top.v)) {
          const comp: Cell[] = []
          let w: Cell
          do {
            w = stack.pop()!
            onStack.delete(w)
            comp.push(w)
          } while (w !== top.v)
          if (comp.length > 1 || (out.get(top.v) ?? []).includes(top.v)) result.push(...comp)
        }
      }
    }
    return result
  }

  /** Evaluate one formula cell; true when the step budget ran out. */
  private evalCell(c: Cell, env: Env, limited: boolean): boolean {
    if (!c.ast) return false
    if (limited) {
      c.value = err('#NUM!', 'calculation limit reached')
      return true
    }
    env.sheetId = c.sheetId
    env.depth = 0
    try {
      c.value = evalFormula(c.ast, env)
      c.hint = typeof c.value === 'number' ? inferHint(c.ast, this, c.sheetId) : null
      return false
    } catch (e) {
      c.hint = null
      if (e instanceof LimitError) {
        c.value = err('#NUM!', 'calculation limit reached')
        return true
      }
      console.warn('[sheets] evaluation failed', e)
      c.value = err('#VALUE!')
      return false
    }
  }

  /** Evaluate an expression in the context of a sheet (readSheetData, charts): never throws. */
  evaluate(body: string, sheetId: string): Value {
    return evalExpression(this, body, sheetId)
  }
}

function evalExpression(wb: Workbook, body: string, sheetId: string): Value {
  let ast: Node
  try {
    ast = parseFormula(body)
  } catch (e) {
    return err('#ERROR!', e instanceof ParseError ? e.message : 'invalid reference')
  }
  // a bare dataset name ("Revenue") means DS(Revenue)
  if (ast.k === 'name' && wb.dataset(ast.name)) ast = { k: 'call', name: 'DS', args: [ast], s: ast.s, e: ast.e }
  const env: Env = { res: wb, sheetId, now: new Date(), lang: wb.lang, budget: { left: wb.maxSteps }, depth: 0 }
  try {
    return evalNode(ast, env)
  } catch (e) {
    return e instanceof LimitError ? err('#NUM!', 'calculation limit reached') : err('#VALUE!')
  }
}
