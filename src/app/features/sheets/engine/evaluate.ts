/**
 * The interpreter: walks a formula AST (or a custom function's expression tree) and returns a
 * Value. Bounded work: a step budget per recalculation, custom-function call depth 32, text
 * length 32k. Errors are values (#DIV/0! …), never exceptions — except the budget, which stops
 * the whole recalculation (LimitError).
 */
import type { CustomFunction, FnExpr } from '../../../store/types'
import type { Node } from './parser'
import { MAX_COLS, MAX_ROWS, type Rect } from './refs'
import { bindCustomInvoker, getFunction } from './registry'
import type { Area, CellValue, DatasetValue, FnCtx, RangeValue, Value, ValueHint } from './types'
import { compare, err, isDataset, isErr, isMulti, isRange, num, rangeValue, text, toBool, toNumber, toScalar, toText } from './values'

export const MAX_STEPS = 2_000_000
export const MAX_CALL_DEPTH = 32

/** Where cell references point: the workbook (null in custom-function bodies / database formulas). */
export interface Resolver {
  /** sheet id for a sheet name written in a formula (case-insensitive), null when there is none */
  sheetId(name: string): string | null
  size(sheetId: string): { rows: number; cols: number } | null
  value(sheetId: string, row: number, col: number): CellValue
  hint?(sheetId: string, row: number, col: number): ValueHint
  /** a named dataset's areas, null when no dataset has that name */
  dataset(name: string): Array<{ sheetId: string; rect: Rect }> | null
}

export interface Budget {
  left: number
}

export interface Env {
  res: Resolver | null
  sheetId: string
  now: Date
  lang: 'en' | 'de'
  budget: Budget
  depth: number
  params?: Map<string, Value>
}

export class LimitError extends Error {}

export function newEnv(partial: Partial<Env> = {}): Env {
  return { res: null, sheetId: '', now: new Date(), lang: 'en', budget: { left: MAX_STEPS }, depth: 0, ...partial }
}

function tick(env: Env, n = 1) {
  env.budget.left -= n
  if (env.budget.left < 0) throw new LimitError('calculation limit reached')
}

function fnCtx(env: Env): FnCtx {
  return { now: env.now, lang: env.lang, depth: env.depth, tick: (n = 1) => tick(env, n) }
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

type RefNode = Extract<Node, { k: 'ref' }>

/** The rectangle a reference covers, capped to its sheet (null: the sheet is gone). */
export function refRect(n: RefNode, res: Resolver, sheetId: string): { sheetId: string; rect: Rect } | null {
  const id = n.sheet === null ? sheetId : res.sheetId(n.sheet)
  if (!id) return null
  const b = n.b ?? n.a
  const top = n.cols ? 0 : Math.min(n.a.row, b.row)
  const bottom = n.cols ? Infinity : Math.max(n.a.row, b.row)
  return { sheetId: id, rect: { top, bottom, left: Math.min(n.a.col, b.col), right: Math.max(n.a.col, b.col) } }
}

/** Cells of a rectangle (capped to the sheet; cells beyond it read as blank). */
export function readArea(res: Resolver, sheetId: string, rect: Rect, env: Env | null): Area | null {
  const size = res.size(sheetId)
  if (!size) return null
  const bottom = Math.min(rect.bottom, size.rows - 1, MAX_ROWS - 1)
  const right = Math.min(rect.right, size.cols - 1, MAX_COLS - 1)
  // a single cell beyond the sheet's edge: blank (the sheet may grow)
  if (rect.top === rect.bottom && rect.left === rect.right && (rect.top > bottom || rect.left > right))
    return { sheetId, top: rect.top, left: rect.left, rows: 1, cols: 1, values: [[null]] }
  const rows = Math.max(0, bottom - rect.top + 1)
  const cols = Math.max(0, right - rect.left + 1)
  if (env) tick(env, 1 + ((rows * cols) >> 3))
  const values: CellValue[][] = []
  for (let r = 0; r < rows; r++) {
    const row: CellValue[] = new Array(cols)
    for (let c = 0; c < cols; c++) row[c] = res.value(sheetId, rect.top + r, rect.left + c)
    values.push(row)
  }
  return { sheetId, top: rect.top, left: rect.left, rows, cols, values }
}

function evalRef(n: RefNode, env: Env): RangeValue | CellValue {
  if (!env.res) return err('#REF!', 'no cells here')
  const at = refRect(n, env.res, env.sheetId)
  if (!at) return err('#REF!', `no sheet named "${n.sheet}"`)
  const area = readArea(env.res, at.sheetId, at.rect, env)
  return area ? rangeValue(area) : err('#REF!', 'the sheet is gone')
}

/* ------------------------------------------------------------------ */
/* Operators                                                           */
/* ------------------------------------------------------------------ */

export function binop(op: string, l: Value, r: Value): Value {
  const a = toScalar(l)
  const b = toScalar(r)
  if (isErr(a)) return a
  if (isErr(b)) return b
  switch (op) {
    case '&': {
      const x = toText(a)
      const y = toText(b)
      return isErr(x) ? x : isErr(y) ? y : text(x + y)
    }
    case '=':
      return compare(a, b) === 0
    case '<>':
      return compare(a, b) !== 0
    case '<':
      return compare(a, b) < 0
    case '<=':
      return compare(a, b) <= 0
    case '>':
      return compare(a, b) > 0
    case '>=':
      return compare(a, b) >= 0
  }
  const x = toNumber(a)
  if (isErr(x)) return x
  const y = toNumber(b)
  if (isErr(y)) return y
  switch (op) {
    case '+':
      return num(x + y)
    case '-':
      return num(x - y)
    case '*':
      return num(x * y)
    case '/':
      return y === 0 ? err('#DIV/0!', 'division by zero') : num(x / y)
    case '^':
      if (x === 0 && y < 0) return err('#DIV/0!', 'division by zero')
      if (x === 0 && y === 0) return err('#NUM!', '0^0 is undefined')
      return num(Math.pow(x, y))
  }
  return err('#ERROR!', `unknown operator ${op}`)
}

function negate(v: Value): Value {
  const n = toNumber(v)
  return isErr(n) ? n : -n
}

/* ------------------------------------------------------------------ */
/* Lazy special forms (shared by formulas and custom-function bodies)  */
/* ------------------------------------------------------------------ */

type Thunk = () => Value

const cond = (v: Value): boolean | CellValue => {
  const s = toScalar(v)
  if (isErr(s)) return s
  const b = toBool(s)
  return b
}

const SPECIAL: Record<string, (args: Thunk[], env: Env) => Value> = {
  IF: (args) => {
    if (args.length < 2 || args.length > 3) return err('#ERROR!', 'IF takes 2 or 3 arguments')
    const c = cond(args[0]())
    if (isErr(c)) return c
    if (c) return args[1]()
    return args.length > 2 ? args[2]() : false
  },
  IFS: (args) => {
    if (args.length < 2 || args.length % 2) return err('#ERROR!', 'IFS takes pairs of condition and value')
    for (let i = 0; i < args.length; i += 2) {
      const c = cond(args[i]())
      if (isErr(c)) return c
      if (c) return args[i + 1]()
    }
    return err('#N/A', 'no condition was TRUE')
  },
  IFERROR: (args) => {
    if (args.length !== 2) return err('#ERROR!', 'IFERROR takes 2 arguments')
    const v = args[0]()
    return isErr(toScalarSafe(v)) ? args[1]() : v
  },
  IFNA: (args) => {
    if (args.length !== 2) return err('#ERROR!', 'IFNA takes 2 arguments')
    const v = args[0]()
    const s = toScalarSafe(v)
    return isErr(s) && s.code === '#N/A' ? args[1]() : v
  },
  SWITCH: (args) => {
    if (args.length < 3) return err('#ERROR!', 'SWITCH takes at least 3 arguments')
    const x = toScalar(args[0]())
    if (isErr(x)) return x
    let i = 1
    for (; i + 1 < args.length; i += 2) {
      const v = toScalar(args[i]())
      if (isErr(v)) return v
      if (compare(x, v) === 0) return args[i + 1]()
    }
    return i < args.length ? args[i]() : err('#N/A', 'no case matched')
  },
}

/** Errors in a range only count when the value is used as one cell. */
function toScalarSafe(v: Value): CellValue {
  return isMulti(v) ? (isRange(v) && v.rows * v.cols === 1 ? v.values[0][0] : null) : v
}

/* ------------------------------------------------------------------ */
/* Datasets                                                            */
/* ------------------------------------------------------------------ */

function datasetFromValues(vals: Value[]): DatasetValue | CellValue {
  const areas: Area[] = []
  for (const v of vals) {
    if (isErr(v)) return v
    if (isDataset(v)) areas.push(...v.areas)
    else if (isRange(v)) areas.push({ sheetId: v.sheetId, top: v.top, left: v.left, rows: v.rows, cols: v.cols, values: v.values })
    else return err('#VALUE!', 'DS takes references, ranges, datasets or dataset names')
  }
  return { kind: 'dataset', areas }
}

function namedDataset(name: string, env: Env): DatasetValue | CellValue {
  const list = env.res?.dataset(name)
  if (!list) return err('#NAME?', `no dataset named "${name}"`)
  if (!list.length) return err('#REF!', `the dataset "${name}" has no cells left`)
  const areas: Area[] = []
  for (const { sheetId, rect } of list) {
    const a = readArea(env.res!, sheetId, rect, env)
    if (!a) return err('#REF!', `a range of "${name}" is on a sheet that is gone`)
    areas.push(a)
  }
  return { kind: 'dataset', areas }
}

function evalDS(args: Node[], env: Env): Value {
  if (!args.length) return err('#ERROR!', 'DS takes at least one reference')
  const vals: Value[] = []
  for (const a of args) {
    tick(env)
    if (a.k === 'name') vals.push(namedDataset(a.name, env))
    else if (a.k === 'str') vals.push(namedDataset(a.v, env))
    else vals.push(evalNode(a, env))
  }
  return datasetFromValues(vals)
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

function invoke(name: string, args: Value[], env: Env): Value {
  const spec = getFunction(name)
  if (!spec) return err('#NAME?', `unknown function ${name}`)
  if (args.length < spec.minArgs || (spec.maxArgs !== null && args.length > spec.maxArgs))
    return err('#ERROR!', `wrong number of arguments for ${spec.name}`)
  if (spec.custom) return callCustom(spec.custom, args, env)
  let out: Value
  try {
    out = spec.impl(args, fnCtx(env))
  } catch (e) {
    if (e instanceof LimitError) throw e
    return err('#VALUE!', `${spec.name} failed`)
  }
  if (typeof out === 'number' && !Number.isFinite(out)) return err('#NUM!', 'the result is not a finite number')
  if (typeof out === 'string') return text(out)
  return out
}

function evalCall(n: Extract<Node, { k: 'call' }>, env: Env): Value {
  if (n.name === 'DS') return evalDS(n.args, env)
  const special = SPECIAL[n.name]
  if (special) return special(n.args.map((a) => () => evalNode(a, env)), env)
  return invoke(n.name, n.args.map((a) => evalNode(a, env)), env)
}

export function evalNode(n: Node, env: Env): Value {
  tick(env)
  switch (n.k) {
    case 'num':
      return n.v
    case 'str':
      return n.v
    case 'bool':
      return n.v
    case 'err':
      return err(n.code)
    case 'blank':
      return null
    case 'ref':
      return evalRef(n, env)
    case 'name':
      return err('#NAME?', `unknown name "${n.name}" (datasets go inside DS(…))`)
    case 'neg':
      return negate(toScalar(evalNode(n.arg, env)))
    case 'pct': {
      const v = toNumber(toScalar(evalNode(n.arg, env)))
      return isErr(v) ? v : v / 100
    }
    case 'bin':
      return binop(n.op, evalNode(n.l, env), evalNode(n.r, env))
    case 'call':
      return evalCall(n, env)
  }
}

/** A cell formula's result: one value (ranges / datasets that aren't one cell are #VALUE!). */
export function evalFormula(ast: Node, env: Env): CellValue {
  const v = evalNode(ast, env)
  if (isRange(v)) return v.rows === 1 && v.cols === 1 ? (v.values[0][0] ?? 0) : err('#VALUE!', 'a range cannot be shown in one cell')
  if (isDataset(v)) return err('#VALUE!', 'a dataset cannot be shown in one cell — use it in a function: SUM(DS(…))')
  return v === null ? 0 : v
}

/* ------------------------------------------------------------------ */
/* Custom functions                                                    */
/* ------------------------------------------------------------------ */

function bindParam(type: string, v: Value): Value {
  if (type === 'range') {
    if (isErr(v)) return v
    if (isDataset(v)) return v
    if (isRange(v)) return { kind: 'dataset', areas: [{ sheetId: v.sheetId, top: v.top, left: v.left, rows: v.rows, cols: v.cols, values: v.values }] }
    return { kind: 'dataset', areas: [{ sheetId: '', top: 0, left: 0, rows: 1, cols: 1, values: [[v]] }] }
  }
  if (isDataset(v)) return type === 'any' ? v : err('#VALUE!', 'a dataset where one value was expected')
  if (isRange(v) && v.rows * v.cols !== 1) return type === 'any' ? v : err('#VALUE!', 'a range where one value was expected')
  const s = toScalar(v)
  if (isErr(s)) return s
  switch (type) {
    case 'number':
    case 'date':
      return toNumber(s)
    case 'text':
      return toText(s)
    case 'bool':
      return toBool(s)
    default:
      return s
  }
}

export function callCustom(fn: CustomFunction, args: Value[], env: Env): Value {
  if (env.depth >= MAX_CALL_DEPTH) return err('#NUM!', 'custom functions call each other more than 32 levels deep')
  if (args.length !== fn.params.length) return err('#ERROR!', `${fn.name} takes ${fn.params.length} arguments`)
  const params = new Map<string, Value>()
  for (let i = 0; i < fn.params.length; i++) {
    const v = bindParam(fn.params[i].type, args[i])
    if (isErr(v) && fn.params[i].type !== 'any') return v
    params.set(fn.params[i].name, v)
  }
  return evalExpr(fn.body, { ...env, params, depth: env.depth + 1 })
}

const OPERATORS = new Set(['+', '-', '*', '/', '^', '&', '=', '<>', '<', '<=', '>', '>='])

/** Evaluate a custom function's body (expression tree) with its parameters bound. */
export function evalExpr(e: FnExpr, env: Env): Value {
  tick(env)
  switch (e.k) {
    case 'num':
      return Number.isFinite(e.v) ? e.v : err('#NUM!')
    case 'str':
      return text(e.v)
    case 'bool':
      return e.v
    case 'param':
      return env.params?.get(e.name) ?? err('#NAME?', `unknown parameter "${e.name}"`)
    case 'call': {
      const name = e.fn.toUpperCase()
      if (OPERATORS.has(name)) {
        if (name === '-' && e.args.length === 1) return negate(toScalar(evalExpr(e.args[0], env)))
        if (e.args.length !== 2) return err('#ERROR!', `${name} takes 2 values`)
        return binop(name, evalExpr(e.args[0], env), evalExpr(e.args[1], env))
      }
      if (name === 'DS') return datasetFromValues(e.args.map((a) => evalExpr(a, env)))
      const special = SPECIAL[name]
      if (special) return special(e.args.map((a) => () => evalExpr(a, env)), env)
      return invoke(name, e.args.map((a) => evalExpr(a, env)), env)
    }
  }
  return err('#ERROR!')
}

bindCustomInvoker((fn, args, ctx) =>
  callCustom(fn, args, { ...newEnv({ now: ctx.now, lang: ctx.lang, depth: ctx.depth }), budget: { left: MAX_STEPS } }),
)

/* ------------------------------------------------------------------ */
/* Outside a sheet (custom-function test bench, database formulas)     */
/* ------------------------------------------------------------------ */

/** Call any function by name with plain values (no cells). Never throws. */
export function callFunction(name: string, args: Value[], opts: { now?: Date; lang?: 'en' | 'de'; maxSteps?: number } = {}): Value {
  const env = newEnv({ now: opts.now ?? new Date(), lang: opts.lang ?? 'en', budget: { left: opts.maxSteps ?? MAX_STEPS } })
  try {
    return invoke(name, args, env)
  } catch (e) {
    return e instanceof LimitError ? err('#NUM!', 'calculation limit reached') : err('#VALUE!')
  }
}

/** Evaluate an expression tree with parameter values (the builder's test bench). Never throws. */
export function evaluateExpr(expr: FnExpr, params: Record<string, Value>, opts: { now?: Date; lang?: 'en' | 'de'; maxSteps?: number } = {}): Value {
  const map = new Map<string, Value>()
  for (const k of Object.keys(params)) map.set(k, params[k])
  const env = newEnv({ now: opts.now ?? new Date(), lang: opts.lang ?? 'en', budget: { left: opts.maxSteps ?? MAX_STEPS }, params: map, depth: 1 })
  try {
    return evalExpr(expr, env)
  } catch (e) {
    return e instanceof LimitError ? err('#NUM!', 'calculation limit reached') : err('#VALUE!')
  }
}

/* ------------------------------------------------------------------ */
/* Display hints                                                       */
/* ------------------------------------------------------------------ */

/** What a formula's result should look like (=TODAY() + 7 → a date). */
export function inferHint(n: Node, res: Resolver | null, sheetId: string): ValueHint {
  switch (n.k) {
    case 'call': {
      const spec = getFunction(n.name)
      if (spec?.returns) return spec.returns
      if (['IF', 'IFERROR', 'IFNA', 'MIN', 'MAX', 'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'INT'].includes(n.name)) {
        const pick = n.name === 'IF' ? n.args[1] : n.args[0]
        return pick ? inferHint(pick, res, sheetId) : null
      }
      if (['VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX'].includes(n.name)) return null
      return null
    }
    case 'ref': {
      if (!res?.hint || n.b) return null
      const id = n.sheet === null ? sheetId : res.sheetId(n.sheet)
      return id ? res.hint(id, n.a.row, n.a.col) : null
    }
    case 'bin': {
      if (n.op !== '+' && n.op !== '-') return null
      const l = inferHint(n.l, res, sheetId)
      const r = inferHint(n.r, res, sheetId)
      const isDate = (h: ValueHint) => h === 'date' || h === 'datetime'
      if (isDate(l) && !isDate(r)) return l
      if (n.op === '+' && isDate(r) && !isDate(l)) return r
      return null
    }
    case 'pct':
      return 'percent'
    default:
      return null
  }
}
