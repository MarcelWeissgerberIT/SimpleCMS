/** Math + finance basics. */
import type { FnSpec } from '../types'
import { num } from '../values'
import { arg, def, err, int, isErr, n, numbers, roundTo } from './helpers'

const NUM = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'number', opts)

const round = (mode: 'round' | 'up' | 'down') => (a: Parameters<FnSpec['impl']>[0]) => {
  const x = n(a[0])
  if (isErr(x)) return x
  const d = int(a[1], 0)
  if (isErr(d)) return d
  return roundTo(x, d, mode)
}

export const mathFunctions: FnSpec[] = [
  def('SUM', 'math', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Adds numbers, cells, ranges and datasets.', 'Addiert Zahlen, Zellen, Bereiche und Datenbereiche.', '=SUM(A1:A10)', (a, ctx) => {
    const xs = numbers(a, ctx)
    if (isErr(xs)) return xs
    let t = 0
    for (const x of xs) t += x
    return num(t)
  }, { keywords: 'SUMME total add plus summe' }),
  def('PRODUCT', 'math', [NUM('number1'), NUM('number2', { optional: true, repeat: true })], 'Multiplies all numbers.', 'Multipliziert alle Zahlen.', '=PRODUCT(A1:A4)', (a, ctx) => {
    const xs = numbers(a, ctx)
    if (isErr(xs)) return xs
    if (!xs.length) return 0
    let p = 1
    for (const x of xs) p *= x
    return num(p)
  }, { keywords: 'PRODUKT multiply multiplizieren' }),
  def('ROUND', 'math', [NUM('number'), NUM('digits', { optional: true })], 'Rounds to a number of decimals (half away from zero).', 'Rundet auf eine Anzahl Nachkommastellen (kaufmännisch).', '=ROUND(2.345; 2)', round('round'), { keywords: 'RUNDEN' }),
  def('ROUNDUP', 'math', [NUM('number'), NUM('digits', { optional: true })], 'Rounds away from zero.', 'Rundet von null weg (auf).', '=ROUNDUP(2.341; 2)', round('up'), { keywords: 'AUFRUNDEN' }),
  def('ROUNDDOWN', 'math', [NUM('number'), NUM('digits', { optional: true })], 'Rounds towards zero.', 'Rundet zur Null hin (ab).', '=ROUNDDOWN(2.349; 2)', round('down'), { keywords: 'ABRUNDEN' }),
  def('INT', 'math', [NUM('number')], 'Rounds down to the nearest integer.', 'Rundet auf die nächstkleinere ganze Zahl ab.', '=INT(-2.5)', (a) => {
    const x = n(a[0])
    return isErr(x) ? x : Math.floor(x)
  }, { keywords: 'GANZZAHL integer' }),
  def('ABS', 'math', [NUM('number')], 'Absolute value.', 'Absolutwert (Betrag).', '=ABS(-4)', (a) => {
    const x = n(a[0])
    return isErr(x) ? x : Math.abs(x)
  }, { keywords: 'betrag absolute' }),
  def('SQRT', 'math', [NUM('number')], 'Square root.', 'Quadratwurzel.', '=SQRT(16)', (a) => {
    const x = n(a[0])
    if (isErr(x)) return x
    return x < 0 ? err('#NUM!', 'square root of a negative number') : Math.sqrt(x)
  }, { keywords: 'WURZEL root' }),
  def('POWER', 'math', [NUM('number'), NUM('power')], 'A number raised to a power.', 'Potenz einer Zahl.', '=POWER(2; 10)', (a) => {
    const x = n(a[0])
    const y = n(a[1])
    if (isErr(x)) return x
    if (isErr(y)) return y
    if (x === 0 && y < 0) return err('#DIV/0!')
    return num(Math.pow(x, y))
  }, { keywords: 'POTENZ exponent hoch' }),
  def('MOD', 'math', [NUM('number'), NUM('divisor')], 'Remainder after division (sign of the divisor).', 'Rest einer Division (Vorzeichen des Divisors).', '=MOD(10; 3)', (a) => {
    const x = n(a[0])
    const d = n(a[1])
    if (isErr(x)) return x
    if (isErr(d)) return d
    if (d === 0) return err('#DIV/0!')
    return num(x - d * Math.floor(x / d))
  }, { keywords: 'REST remainder modulo' }),
  def('CEILING', 'math', [NUM('number'), NUM('significance', { optional: true })], 'Rounds up to the nearest multiple.', 'Rundet auf das nächste Vielfache auf.', '=CEILING(23; 5)', (a) => {
    const x = n(a[0])
    const sig = n(a[1], 1)
    if (isErr(x)) return x
    if (isErr(sig)) return sig
    if (sig === 0) return 0
    if (x > 0 && sig < 0) return err('#NUM!')
    return num(roundTo(Math.ceil(Number((x / sig).toPrecision(15))) * sig, 10))
  }, { keywords: 'OBERGRENZE' }),
  def('FLOOR', 'math', [NUM('number'), NUM('significance', { optional: true })], 'Rounds down to the nearest multiple.', 'Rundet auf das nächste Vielfache ab.', '=FLOOR(23; 5)', (a) => {
    const x = n(a[0])
    const sig = n(a[1], 1)
    if (isErr(x)) return x
    if (isErr(sig)) return sig
    if (sig === 0) return err('#DIV/0!')
    if (x > 0 && sig < 0) return err('#NUM!')
    return num(roundTo(Math.floor(Number((x / sig).toPrecision(15))) * sig, 10))
  }, { keywords: 'UNTERGRENZE' }),
  def('PI', 'math', [], 'The number π (3.14159…).', 'Die Zahl π (3,14159…).', '=PI()*2', () => Math.PI),
  // finance basics (category math: the browser lists them there)
  def('PMT', 'math', [NUM('rate'), NUM('nper'), NUM('pv'), NUM('fv', { optional: true }), NUM('type', { optional: true })], 'Payment per period of a loan (finance).', 'Zahlung pro Periode eines Kredits (Finanzen).', '=PMT(5%/12; 36; 10000)', (a) => {
    const [r, np, pv, fv, ty] = [n(a[0]), n(a[1]), n(a[2]), n(a[3], 0), n(a[4], 0)]
    for (const x of [r, np, pv, fv, ty]) if (isErr(x)) return x
    const [rate, nper, p, f, t] = [r, np, pv, fv, ty] as number[]
    if (nper === 0) return err('#NUM!')
    if (rate === 0) return num(-(p + f) / nper)
    const k = Math.pow(1 + rate, nper)
    return num((-rate * (f + p * k)) / ((1 + rate * (t ? 1 : 0)) * (k - 1)))
  }, { keywords: 'RMZ loan annuity rate kredit rate annuität finance finanzen' }),
  def('FV', 'math', [NUM('rate'), NUM('nper'), NUM('pmt'), NUM('pv', { optional: true }), NUM('type', { optional: true })], 'Future value of an investment (finance).', 'Zukunftswert einer Investition (Finanzen).', '=FV(3%; 10; -100)', (a) => {
    const [r, np, pm, pv, ty] = [n(a[0]), n(a[1]), n(a[2]), n(a[3], 0), n(a[4], 0)]
    for (const x of [r, np, pm, pv, ty]) if (isErr(x)) return x
    const [rate, nper, pmt, p, t] = [r, np, pm, pv, ty] as number[]
    if (rate === 0) return num(-(p + pmt * nper))
    const k = Math.pow(1 + rate, nper)
    return num(-(p * k + (pmt * (1 + rate * (t ? 1 : 0)) * (k - 1)) / rate))
  }, { keywords: 'ZW future value zukunftswert savings sparen finance finanzen' }),
  def('NPV', 'math', [NUM('rate'), NUM('value1'), NUM('value2', { optional: true, repeat: true })], 'Net present value of future cash flows (finance).', 'Nettobarwert künftiger Zahlungen (Finanzen).', '=NPV(8%; B2:B6)', (a, ctx) => {
    const r = n(a[0])
    if (isErr(r)) return r
    const xs = numbers(a.slice(1), ctx)
    if (isErr(xs)) return xs
    let t = 0
    xs.forEach((x, i) => (t += x / Math.pow(1 + r, i + 1)))
    return num(t)
  }, { keywords: 'NBW net present value barwert finance finanzen' }),
]
