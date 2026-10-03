/** Statistics: averages, counting, conditional aggregates. */
import type { CellValue, FnSpec, Value } from '../types'
import { cellsOf, isMulti, num, parseNumeric } from '../values'
import { arg, criterion, def, err, isErr, numbers } from './helpers'

const NUM = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'number', opts)
const RANGE = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'range', opts)

/** Cells of a range / dataset argument as one flat list (scalars: a list of one). */
const cellList = (v: Value): CellValue[] => [...cellsOf(v)]

function aggregate(fn: (xs: number[]) => Value) {
  return (a: Value[], ctx: Parameters<FnSpec['impl']>[1]) => {
    const xs = numbers(a, ctx)
    return isErr(xs) ? xs : fn(xs)
  }
}

/** Pairs of (range, criterion) → which positions match all of them (same-size ranges). */
function matchAll(pairs: Array<[Value, Value]>): boolean[] | CellValue {
  let mask: boolean[] | null = null
  for (const [range, crit] of pairs) {
    if (!isMulti(range) && isErr(range)) return range
    const cells = cellList(range)
    if (mask && cells.length !== mask.length) return err('#VALUE!', 'the ranges have different sizes')
    const test = criterion(crit)
    const m: boolean[] = cells.map((c) => test(c))
    mask = mask ? mask.map((x, i) => x && m[i]) : m
  }
  return mask ?? []
}

function sumWhere(values: Value, mask: boolean[]): number {
  const cells = cellList(values)
  let t = 0
  mask.forEach((ok, i) => {
    const c = cells[i]
    if (ok && typeof c === 'number') t += c
  })
  return t
}

export const statsFunctions: FnSpec[] = [
  def('AVERAGE', 'stats', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Arithmetic mean of the numbers.', 'Arithmetisches Mittel der Zahlen.', '=AVERAGE(B2:B9)', aggregate((xs) => (xs.length ? num(xs.reduce((t, x) => t + x, 0) / xs.length) : err('#DIV/0!', 'no numbers'))), { keywords: 'MITTELWERT mean avg durchschnitt' }),
  def('MIN', 'stats', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Smallest number (0 when there are none).', 'Kleinste Zahl (0, wenn es keine gibt).', '=MIN(A1:A10)', aggregate((xs) => xs.reduce((m, x) => (x < m ? x : m), xs.length ? xs[0] : 0)), { keywords: 'minimum kleinste' }),
  def('MAX', 'stats', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Largest number (0 when there are none).', 'Größte Zahl (0, wenn es keine gibt).', '=MAX(A1:A10)', aggregate((xs) => xs.reduce((m, x) => (x > m ? x : m), xs.length ? xs[0] : 0)), { keywords: 'maximum größte' }),
  def('MEDIAN', 'stats', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'The middle value of the numbers.', 'Der mittlere Wert der Zahlen.', '=MEDIAN(A1:A9)', aggregate((xs) => {
    if (!xs.length) return err('#NUM!', 'no numbers')
    const s = [...xs].sort((x, y) => x - y)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }), { keywords: 'median mitte' }),
  def('STDEV', 'stats', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Standard deviation of a sample.', 'Standardabweichung einer Stichprobe.', '=STDEV(A1:A20)', aggregate((xs) => {
    if (xs.length < 2) return err('#DIV/0!', 'needs at least two numbers')
    const mean = xs.reduce((t, x) => t + x, 0) / xs.length
    const v = xs.reduce((t, x) => t + (x - mean) ** 2, 0) / (xs.length - 1)
    return num(Math.sqrt(v))
  }), { keywords: 'STABW standard deviation standardabweichung' }),
  def('COUNT', 'stats', [arg('value1', 'any'), arg('value2', 'any', { optional: true, repeat: true })], 'Counts the numbers.', 'Zählt die Zahlen.', '=COUNT(A1:A10)', (a) => {
    let c = 0
    for (const v of a) {
      if (isMulti(v)) {
        for (const x of cellsOf(v)) if (typeof x === 'number') c++
      } else if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && parseNumeric(v) !== null)) c++
    }
    return c
  }, { keywords: 'ANZAHL count numbers zahlen zählen' }),
  def('COUNTA', 'stats', [arg('value1', 'any'), arg('value2', 'any', { optional: true, repeat: true })], 'Counts the cells that are not empty.', 'Zählt die nicht leeren Zellen.', '=COUNTA(A:A)', (a) => {
    let c = 0
    for (const v of a) {
      if (isMulti(v)) {
        for (const x of cellsOf(v)) if (x !== null) c++
      } else if (v !== null) c++
    }
    return c
  }, { keywords: 'ANZAHL2 count non-empty nicht leer' }),
  def('COUNTBLANK', 'stats', [RANGE('range')], 'Counts the empty cells.', 'Zählt die leeren Zellen.', '=COUNTBLANK(A1:A10)', (a) => {
    let c = 0
    for (const x of cellsOf(a[0])) if (x === null || x === '') c++
    return c
  }, { keywords: 'ANZAHLLEEREZELLEN empty leer' }),
  def('COUNTIF', 'stats', [RANGE('range'), arg('criterion', 'criteria')], 'Counts the cells that meet a criterion (">5", "a*", 10).', 'Zählt die Zellen, die ein Kriterium erfüllen (">5", "a*", 10).', '=COUNTIF(B2:B20; ">100")', (a) => {
    const test = criterion(a[1])
    let c = 0
    for (const x of cellsOf(a[0])) if (test(x)) c++
    return c
  }, { keywords: 'ZÄHLENWENN count if bedingung' }),
  def('COUNTIFS', 'stats', [RANGE('range1'), arg('criterion1', 'criteria'), RANGE('range2', { optional: true, repeat: true }), arg('criterion2', 'criteria', { optional: true, repeat: true })], 'Counts positions that meet all criteria.', 'Zählt Positionen, die alle Kriterien erfüllen.', '=COUNTIFS(A2:A9; "Nord"; B2:B9; ">0")', (a) => {
    if (a.length % 2) return err('#ERROR!', 'COUNTIFS takes pairs of range and criterion')
    const pairs: Array<[Value, Value]> = []
    for (let i = 0; i < a.length; i += 2) pairs.push([a[i], a[i + 1]])
    const mask = matchAll(pairs)
    return Array.isArray(mask) ? mask.filter(Boolean).length : mask
  }, { keywords: 'ZÄHLENWENNS count ifs bedingungen' }),
  def('SUMIF', 'stats', [RANGE('range'), arg('criterion', 'criteria'), RANGE('sum_range', { optional: true })], 'Adds the cells that meet a criterion.', 'Addiert die Zellen, die ein Kriterium erfüllen.', '=SUMIF(A2:A9; "Nord"; C2:C9)', (a) => {
    const mask = matchAll([[a[0], a[1]]])
    if (!Array.isArray(mask)) return mask
    const target = a[2] ?? a[0]
    if (cellList(target).length !== mask.length) return err('#VALUE!', 'the ranges have different sizes')
    return num(sumWhere(target, mask))
  }, { keywords: 'SUMMEWENN sum if bedingung' }),
  def('SUMIFS', 'stats', [RANGE('sum_range'), RANGE('range1'), arg('criterion1', 'criteria'), RANGE('range2', { optional: true, repeat: true }), arg('criterion2', 'criteria', { optional: true, repeat: true })], 'Adds the cells whose positions meet all criteria.', 'Addiert die Zellen, deren Positionen alle Kriterien erfüllen.', '=SUMIFS(C2:C9; A2:A9; "Nord"; B2:B9; ">0")', (a) => {
    if (a.length % 2 === 0) return err('#ERROR!', 'SUMIFS takes a sum range and pairs of range and criterion')
    const pairs: Array<[Value, Value]> = []
    for (let i = 1; i < a.length; i += 2) pairs.push([a[i], a[i + 1]])
    const mask = matchAll(pairs)
    if (!Array.isArray(mask)) return mask
    if (cellList(a[0]).length !== mask.length) return err('#VALUE!', 'the ranges have different sizes')
    return num(sumWhere(a[0], mask))
  }, { keywords: 'SUMMEWENNS sum ifs bedingungen' }),
  def('AVERAGEIF', 'stats', [RANGE('range'), arg('criterion', 'criteria'), RANGE('average_range', { optional: true })], 'Average of the cells that meet a criterion.', 'Mittelwert der Zellen, die ein Kriterium erfüllen.', '=AVERAGEIF(A2:A9; "Nord"; C2:C9)', (a) => {
    const mask = matchAll([[a[0], a[1]]])
    if (!Array.isArray(mask)) return mask
    const cells = cellList(a[2] ?? a[0])
    if (cells.length !== mask.length) return err('#VALUE!', 'the ranges have different sizes')
    let t = 0
    let c = 0
    mask.forEach((ok, i) => {
      const x = cells[i]
      if (ok && typeof x === 'number') {
        t += x
        c++
      }
    })
    return c ? num(t / c) : err('#DIV/0!', 'no matching numbers')
  }, { keywords: 'MITTELWERTWENN average if bedingung' }),
]
