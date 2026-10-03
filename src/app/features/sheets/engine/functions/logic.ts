/**
 * Logic. IF, IFS, IFERROR, IFNA and SWITCH are evaluated lazily by the interpreter (only the
 * chosen branch runs — recursion in custom functions terminates); the impls here are the eager
 * equivalents for direct calls.
 */
import type { CellValue, FnSpec, Value } from '../types'
import { cellsOf, compare, isMulti, toBool, toScalar } from '../values'
import { arg, def, err, isErr } from './helpers'

const ANY = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'any', opts)
const BOOL = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'bool', opts)

/** Booleans of the arguments (ranges: booleans and numbers, text skipped). */
function bools(a: Value[]): boolean[] | CellValue {
  const out: boolean[] = []
  for (const v of a) {
    if (isMulti(v)) {
      for (const c of cellsOf(v)) {
        if (isErr(c)) return c
        if (typeof c === 'boolean') out.push(c)
        else if (typeof c === 'number') out.push(c !== 0)
      }
      continue
    }
    if (v === null) continue
    const x = toBool(v)
    if (isErr(x)) return x
    out.push(x)
  }
  return out.length ? out : err('#VALUE!', 'no logical values')
}

const logical = (fn: (xs: boolean[]) => boolean) => (a: Value[]) => {
  const xs = bools(a)
  return Array.isArray(xs) ? fn(xs) : xs
}

export const logicFunctions: FnSpec[] = [
  def('IF', 'logic', [BOOL('condition'), ANY('value_if_true'), ANY('value_if_false', { optional: true })], 'One value when the condition is TRUE, another when it is FALSE.', 'Ein Wert, wenn die Bedingung WAHR ist, ein anderer, wenn sie FALSCH ist.', '=IF(B2>100; "high"; "low")', (a) => {
    const c = toBool(toScalar(a[0]))
    if (isErr(c)) return c
    return c ? a[1] : a.length > 2 ? a[2] : false
  }, { keywords: 'WENN wenn condition bedingung' }),
  def('IFS', 'logic', [BOOL('condition1'), ANY('value1'), BOOL('condition2', { optional: true, repeat: true }), ANY('value2', { optional: true, repeat: true })], 'The value of the first condition that is TRUE.', 'Der Wert der ersten Bedingung, die WAHR ist.', '=IFS(A1>90; "A"; A1>75; "B"; TRUE; "C")', (a) => {
    if (a.length % 2) return err('#ERROR!', 'IFS takes pairs of condition and value')
    for (let i = 0; i < a.length; i += 2) {
      const c = toBool(toScalar(a[i]))
      if (isErr(c)) return c
      if (c) return a[i + 1]
    }
    return err('#N/A', 'no condition was TRUE')
  }, { keywords: 'WENNS conditions bedingungen' }),
  def('IFERROR', 'logic', [ANY('value'), ANY('value_if_error')], 'The value, or a fallback when it is an error.', 'Der Wert oder ein Ersatz, wenn er ein Fehler ist.', '=IFERROR(A1/B1; 0)', (a) => (isErr(toScalar(a[0])) ? a[1] : a[0]), { keywords: 'WENNFEHLER error fehler fallback' }),
  def('IFNA', 'logic', [ANY('value'), ANY('value_if_na')], 'The value, or a fallback when it is #N/A.', 'Der Wert oder ein Ersatz, wenn er #NV ist.', '=IFNA(VLOOKUP(A1; D:E; 2; FALSE); "–")', (a) => {
    const v = toScalar(a[0])
    return isErr(v) && v.code === '#N/A' ? a[1] : a[0]
  }, { keywords: 'WENNNV not found nicht gefunden' }),
  def('AND', 'logic', [BOOL('logical1'), BOOL('logical2', { optional: true, repeat: true })], 'TRUE when all arguments are TRUE.', 'WAHR, wenn alle Argumente WAHR sind.', '=AND(A1>0; B1>0)', logical((xs) => xs.every(Boolean)), { keywords: 'UND all alle' }),
  def('OR', 'logic', [BOOL('logical1'), BOOL('logical2', { optional: true, repeat: true })], 'TRUE when any argument is TRUE.', 'WAHR, wenn mindestens ein Argument WAHR ist.', '=OR(A1="x"; B1="x")', logical((xs) => xs.some(Boolean)), { keywords: 'ODER any eines' }),
  def('XOR', 'logic', [BOOL('logical1'), BOOL('logical2', { optional: true, repeat: true })], 'TRUE when an odd number of arguments are TRUE.', 'WAHR, wenn eine ungerade Anzahl Argumente WAHR ist.', '=XOR(A1; B1)', logical((xs) => xs.filter(Boolean).length % 2 === 1), { keywords: 'XODER exclusive exklusiv' }),
  def('NOT', 'logic', [BOOL('logical')], 'Reverses TRUE and FALSE.', 'Kehrt WAHR und FALSCH um.', '=NOT(A1)', (a) => {
    const x = toBool(toScalar(a[0]))
    return isErr(x) ? x : !x
  }, { keywords: 'NICHT negate verneinen' }),
  def('SWITCH', 'logic', [ANY('expression'), ANY('case1'), ANY('result1'), ANY('case2_or_default', { optional: true, repeat: true })], 'Compares a value with cases and returns the matching result (last argument: default).', 'Vergleicht einen Wert mit Fällen und liefert das passende Ergebnis (letztes Argument: Standard).', '=SWITCH(A1; 1; "one"; 2; "two"; "many")', (a) => {
    const x = toScalar(a[0])
    if (isErr(x)) return x
    let i = 1
    for (; i + 1 < a.length; i += 2) {
      const v = toScalar(a[i])
      if (isErr(v)) return v
      if (compare(x, v) === 0) return a[i + 1]
    }
    return i < a.length ? a[i] : err('#N/A', 'no case matched')
  }, { keywords: 'ERSTERWERT case fall' }),
]
