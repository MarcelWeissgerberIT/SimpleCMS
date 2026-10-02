/**
 * Formula engine entry: compile (cached) + run, plus the function catalog for the editor.
 */
import { FormulaError, parse, referencedProps, type Node } from './parse'
import { evaluate, toText, truthy, isDate, numToText, type EvalEnv, type FValue } from './evaluate'

export { FormulaError, evaluate, toText, truthy, isDate, numToText, referencedProps }
export type { EvalEnv, FValue, Node }

type Compiled = { ast: Node; error?: undefined } | { ast?: undefined; error: FormulaError }
const cache = new Map<string, Compiled>()

export function compile(src: string): Compiled {
  let c = cache.get(src)
  if (!c) {
    try {
      c = { ast: parse(src) }
    } catch (e) {
      c = { error: e instanceof FormulaError ? e : new FormulaError('unknown') }
    }
    if (cache.size > 500) cache.clear()
    cache.set(src, c)
  }
  return c
}

export function runFormula(src: string, env: EvalEnv): FValue | FormulaError {
  const c = compile(src)
  if (c.error) return c.error
  try {
    return evaluate(c.ast, env)
  } catch (e) {
    if (e instanceof FormulaError) return e
    if (e instanceof RangeError) return new FormulaError('tooDeep')
    return new FormulaError('unknown')
  }
}

/** Catalog shown in the formula editor. Descriptions: database.formula.fn.<name>. */
export const FORMULA_CATALOG: Array<{ group: 'logic' | 'text' | 'math' | 'date' | 'other'; name: string; sig: string; insert: string }> = [
  { group: 'other', name: 'prop', sig: 'prop("Name")', insert: 'prop("")' },
  { group: 'logic', name: 'if', sig: 'if(condition, then, else)', insert: 'if(, , )' },
  { group: 'logic', name: 'and', sig: 'and(a, b) · a and b', insert: 'and(, )' },
  { group: 'logic', name: 'or', sig: 'or(a, b) · a or b', insert: 'or(, )' },
  { group: 'logic', name: 'not', sig: 'not(a) · !a', insert: 'not()' },
  { group: 'logic', name: 'empty', sig: 'empty(value)', insert: 'empty()' },
  { group: 'text', name: 'concat', sig: 'concat(a, b, …)', insert: 'concat(, )' },
  { group: 'text', name: 'length', sig: 'length(text)', insert: 'length()' },
  { group: 'text', name: 'contains', sig: 'contains(text, search)', insert: 'contains(, "")' },
  { group: 'text', name: 'replace', sig: 'replace(text, find, with)', insert: 'replace(, "", "")' },
  { group: 'text', name: 'replaceAll', sig: 'replaceAll(text, find, with)', insert: 'replaceAll(, "", "")' },
  { group: 'text', name: 'lower', sig: 'lower(text)', insert: 'lower()' },
  { group: 'text', name: 'upper', sig: 'upper(text)', insert: 'upper()' },
  { group: 'text', name: 'trim', sig: 'trim(text)', insert: 'trim()' },
  { group: 'text', name: 'slice', sig: 'slice(text, start, end?)', insert: 'slice(, 0, 3)' },
  { group: 'text', name: 'format', sig: 'format(value)', insert: 'format()' },
  { group: 'text', name: 'join', sig: 'join(list, separator)', insert: 'join(, ", ")' },
  { group: 'math', name: 'round', sig: 'round(n, places?)', insert: 'round()' },
  { group: 'math', name: 'floor', sig: 'floor(n)', insert: 'floor()' },
  { group: 'math', name: 'ceil', sig: 'ceil(n)', insert: 'ceil()' },
  { group: 'math', name: 'abs', sig: 'abs(n)', insert: 'abs()' },
  { group: 'math', name: 'sqrt', sig: 'sqrt(n)', insert: 'sqrt()' },
  { group: 'math', name: 'pow', sig: 'pow(n, exp) · n ^ exp', insert: 'pow(, 2)' },
  { group: 'math', name: 'min', sig: 'min(a, b, …)', insert: 'min(, )' },
  { group: 'math', name: 'max', sig: 'max(a, b, …)', insert: 'max(, )' },
  { group: 'math', name: 'sum', sig: 'sum(a, b, …)', insert: 'sum(, )' },
  { group: 'math', name: 'toNumber', sig: 'toNumber(value)', insert: 'toNumber()' },
  { group: 'date', name: 'now', sig: 'now()', insert: 'now()' },
  { group: 'date', name: 'today', sig: 'today()', insert: 'today()' },
  { group: 'date', name: 'dateAdd', sig: 'dateAdd(date, n, "days")', insert: 'dateAdd(, 1, "days")' },
  { group: 'date', name: 'dateSubtract', sig: 'dateSubtract(date, n, "days")', insert: 'dateSubtract(, 1, "days")' },
  { group: 'date', name: 'dateBetween', sig: 'dateBetween(a, b, "days")', insert: 'dateBetween(, now(), "days")' },
  { group: 'date', name: 'formatDate', sig: 'formatDate(date, "yyyy-MM-dd")', insert: 'formatDate(, "yyyy-MM-dd")' },
  { group: 'date', name: 'year', sig: 'year(date)', insert: 'year()' },
  { group: 'date', name: 'month', sig: 'month(date)', insert: 'month()' },
  { group: 'date', name: 'date', sig: 'date(date)', insert: 'date()' },
]

/** Result kind of a formula value (for filters / calcs / display). */
export function fvalueKind(v: FValue | FormulaError | undefined): 'number' | 'text' | 'boolean' | 'date' | 'list' | 'empty' | 'error' {
  if (v instanceof FormulaError) return 'error'
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (isDate(v)) return 'date'
  if (Array.isArray(v)) return 'list'
  return 'text'
}
