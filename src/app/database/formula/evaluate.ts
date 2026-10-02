/**
 * Formula evaluator: walks the AST from parse.ts. Pure, sandboxed (no eval / Function).
 */
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInQuarters,
  differenceInWeeks,
  differenceInYears,
  format as fmt,
  startOfDay,
} from 'date-fns'
import { de as deLocale, enUS } from 'date-fns/locale'
import { FormulaError, type Node } from './parse'

export type FValue = number | string | boolean | Date | null | FValue[]

export interface EvalEnv {
  /** Resolve prop("Name"); throw FormulaError('unknownProperty') when missing. */
  prop: (name: string) => FValue
  now: number
  lang: 'en' | 'de'
}

const MAX_STR = 100_000

export const isDate = (v: unknown): v is Date => v instanceof Date

/** End of a date-range value. prop() of a range yields its start (like Notion); dateEnd() reads this. */
const RANGE_END = new WeakMap<Date, Date>()
export function withRangeEnd(start: Date, end: Date | null): Date {
  if (end) RANGE_END.set(start, end)
  return start
}

function num(v: FValue, pos: number, fn?: string): number {
  if (v === null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') throw new FormulaError('expectedNumber', { got: 'boolean', fn: fn ?? '' }, pos)
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'))
    if (v.trim() !== '' && Number.isFinite(n)) return n
    throw new FormulaError('expectedNumber', { got: 'text', fn: fn ?? '' }, pos)
  }
  throw new FormulaError('expectedNumber', { got: isDate(v) ? 'date' : 'list', fn: fn ?? '' }, pos)
}

function date(v: FValue, pos: number, fn: string): Date {
  if (isDate(v)) return v
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof v === 'number') return new Date(v)
  throw new FormulaError('expectedDate', { fn }, pos)
}

export function truthy(v: FValue): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (isDate(v)) return true
  return !!v
}

/** Pretty number: avoid float noise like 0.30000000000000004. */
export function numToText(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : ''
  return String(Number(n.toPrecision(12)))
}

export function toText(v: FValue, lang: 'en' | 'de' = 'en'): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return numToText(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (isDate(v)) return fmt(v, hasTime(v) ? 'PP p' : 'PP', { locale: lang === 'de' ? deLocale : enUS })
  return v.map((x) => toText(x, lang)).join(', ')
}

const hasTime = (d: Date) => d.getHours() !== 0 || d.getMinutes() !== 0

function eq(a: FValue, b: FValue): boolean {
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime()
  if (Array.isArray(a) || Array.isArray(b)) return toText(a) === toText(b)
  if (a === null || b === null) return (a ?? '') === (b ?? '')
  return a === b
}

function cmp(a: FValue, b: FValue, pos: number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (isDate(a) && isDate(b)) return a.getTime() - b.getTime()
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1
  if ((typeof a === 'number' && typeof b === 'string') || (typeof a === 'string' && typeof b === 'number')) return num(a, pos) - num(b, pos)
  throw new FormulaError('cannotCompare', undefined, pos)
}

type Unit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes'
function unit(v: FValue, pos: number): Unit {
  const u = String(v ?? '').toLowerCase().replace(/s$/, '')
  const map: Record<string, Unit> = {
    year: 'years',
    quarter: 'quarters',
    month: 'months',
    week: 'weeks',
    day: 'days',
    hour: 'hours',
    minute: 'minutes',
    jahr: 'years',
    jahre: 'years',
    quartal: 'quarters',
    quartale: 'quarters',
    monat: 'months',
    monate: 'months',
    woche: 'weeks',
    wochen: 'weeks',
    tag: 'days',
    tage: 'days',
    stunde: 'hours',
    stunden: 'hours',
    minuten: 'minutes',
  }
  const r = map[u]
  if (!r) throw new FormulaError('badUnit', { unit: String(v) }, pos)
  return r
}

const ADD: Record<Unit, (d: Date, n: number) => Date> = {
  years: addYears,
  quarters: addQuarters,
  months: addMonths,
  weeks: addWeeks,
  days: addDays,
  hours: addHours,
  minutes: addMinutes,
}
const DIFF: Record<Unit, (a: Date, b: Date) => number> = {
  years: differenceInYears,
  quarters: differenceInQuarters,
  months: differenceInMonths,
  weeks: differenceInWeeks,
  days: differenceInCalendarDays,
  hours: differenceInHours,
  minutes: differenceInMinutes,
}

/** Accept moment-style patterns ("MMMM D, YYYY") as well as date-fns ones. */
function normalizePattern(p: string): string {
  return p.replace(/YYYY/g, 'yyyy').replace(/YY/g, 'yy').replace(/\bDD\b/g, 'dd').replace(/\bD\b/g, 'd').replace(/dddd/g, 'EEEE').replace(/\bddd\b/g, 'EEE')
}

const flat = (args: FValue[]): FValue[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]))

export function evaluate(node: Node, env: EvalEnv): FValue {
  const ev = (n: Node): FValue => {
    switch (n.k) {
      case 'num':
      case 'str':
      case 'bool':
        return n.v
      case 'unary': {
        const v = ev(n.arg)
        if (n.op === '!') return !truthy(v)
        return -num(v, n.s)
      }
      case 'tern':
        return truthy(ev(n.c)) ? ev(n.a) : ev(n.b)
      case 'bin':
        return bin(n.op, n.l, n.r, n.s)
      case 'call':
        return call(n.name, n.args, n.s)
    }
  }

  const bin = (op: string, ln: Node, rn: Node, pos: number): FValue => {
    if (op === 'and') return truthy(ev(ln)) && truthy(ev(rn))
    if (op === 'or') return truthy(ev(ln)) || truthy(ev(rn))
    const l = ev(ln)
    const r = ev(rn)
    switch (op) {
      case '+': {
        if (typeof l === 'string' || typeof r === 'string') {
          const s = toText(l, env.lang) + toText(r, env.lang)
          if (s.length > MAX_STR) throw new FormulaError('tooLong', undefined, pos)
          return s
        }
        if (l === null && r === null) return null
        return num(l, ln.s) + num(r, rn.s)
      }
      case '-':
        if (isDate(l) && isDate(r)) return l.getTime() - r.getTime()
        if (l === null && r === null) return null
        return num(l, ln.s) - num(r, rn.s)
      case '*':
        if (l === null && r === null) return null
        return num(l, ln.s) * num(r, rn.s)
      case '/': {
        if (l === null && r === null) return null
        const d = num(r, rn.s)
        if (d === 0) return null
        return num(l, ln.s) / d
      }
      case '%': {
        const d = num(r, rn.s)
        if (d === 0) return null
        return num(l, ln.s) % d
      }
      case '^':
        return Math.pow(num(l, ln.s), num(r, rn.s))
      case '==':
        return eq(l, r)
      case '!=':
        return !eq(l, r)
      case '<':
        return cmp(l, r, pos) < 0
      case '<=':
        return cmp(l, r, pos) <= 0
      case '>':
        return cmp(l, r, pos) > 0
      case '>=':
        return cmp(l, r, pos) >= 0
    }
    throw new FormulaError('unexpectedToken', { token: op }, pos)
  }

  const call = (name: string, argNodes: Node[], pos: number): FValue => {
    // lazy functions
    if (name === 'if') return truthy(ev(argNodes[0])) ? ev(argNodes[1]) : ev(argNodes[2])
    if (name === 'and') return argNodes.every((a) => truthy(ev(a)))
    if (name === 'or') return argNodes.some((a) => truthy(ev(a)))
    const a = argNodes.map(ev)
    const p = (i: number) => argNodes[i]?.s ?? pos
    switch (name) {
      case 'prop': {
        if (typeof a[0] !== 'string') throw new FormulaError('propNeedsName', undefined, pos)
        try {
          return env.prop(a[0])
        } catch (e) {
          if (e instanceof FormulaError && e.pos === undefined) e.pos = pos
          throw e
        }
      }
      case 'not':
        return !truthy(a[0])
      case 'concat': {
        if (a.some(Array.isArray)) return a.flatMap((x) => (Array.isArray(x) ? x : [x]))
        const s = a.map((x) => toText(x, env.lang)).join('')
        if (s.length > MAX_STR) throw new FormulaError('tooLong', undefined, pos)
        return s
      }
      case 'join': {
        const list = Array.isArray(a[0]) ? a[0] : [a[0]]
        return list.map((x) => toText(x, env.lang)).join(toText(a[1], env.lang))
      }
      case 'length':
        return Array.isArray(a[0]) ? a[0].length : toText(a[0], env.lang).length
      case 'contains': {
        const needle = toText(a[1], env.lang)
        if (Array.isArray(a[0])) return a[0].some((x) => toText(x, env.lang) === needle || toText(x, env.lang).includes(needle))
        return toText(a[0], env.lang).includes(needle)
      }
      case 'replace':
        return toText(a[0], env.lang).replace(toText(a[1], env.lang), toText(a[2], env.lang))
      case 'replaceAll': {
        const find = toText(a[1], env.lang)
        if (!find) return toText(a[0], env.lang)
        return toText(a[0], env.lang).split(find).join(toText(a[2], env.lang))
      }
      case 'lower':
        return toText(a[0], env.lang).toLowerCase()
      case 'upper':
        return toText(a[0], env.lang).toUpperCase()
      case 'trim':
        return toText(a[0], env.lang).trim()
      case 'slice': {
        const s = toText(a[0], env.lang)
        return a.length > 2 ? s.slice(num(a[1], p(1)), num(a[2], p(2))) : s.slice(num(a[1], p(1)))
      }
      case 'round': {
        if (a[0] === null) return null
        const places = a.length > 1 ? Math.max(0, Math.min(10, Math.round(num(a[1], p(1))))) : 0
        const f = Math.pow(10, places)
        return Math.round(num(a[0], p(0), 'round') * f) / f
      }
      case 'floor':
        return a[0] === null ? null : Math.floor(num(a[0], p(0), 'floor'))
      case 'ceil':
        return a[0] === null ? null : Math.ceil(num(a[0], p(0), 'ceil'))
      case 'abs':
        return a[0] === null ? null : Math.abs(num(a[0], p(0), 'abs'))
      case 'sqrt':
        return a[0] === null ? null : Math.sqrt(num(a[0], p(0), 'sqrt'))
      case 'pow':
        return Math.pow(num(a[0], p(0), 'pow'), num(a[1], p(1), 'pow'))
      case 'min':
      case 'max':
      case 'sum': {
        const nums = flat(a)
          .filter((x) => x !== null && x !== '')
          .map((x) => num(x, pos, name))
        if (!nums.length) return null
        if (name === 'sum') return nums.reduce((s, x) => s + x, 0)
        return name === 'min' ? Math.min(...nums) : Math.max(...nums)
      }
      case 'now':
        return new Date(env.now)
      case 'today':
        return startOfDay(new Date(env.now))
      case 'dateAdd':
      case 'dateSubtract': {
        if (a[0] === null) return null
        const d = date(a[0], p(0), name)
        const n = num(a[1], p(1), name)
        return ADD[unit(a[2], p(2))](d, name === 'dateAdd' ? n : -n)
      }
      case 'dateBetween': {
        if (a[0] === null || a[1] === null) return null
        return DIFF[unit(a[2], p(2))](date(a[0], p(0), name), date(a[1], p(1), name))
      }
      case 'dateStart':
        return a[0] === null ? null : new Date(date(a[0], p(0), name).getTime())
      case 'dateEnd': {
        if (a[0] === null) return null
        const d = date(a[0], p(0), name)
        return RANGE_END.get(d) ?? d
      }
      case 'formatDate': {
        if (a[0] === null) return ''
        const d = date(a[0], p(0), name)
        const pattern = a.length > 1 ? normalizePattern(toText(a[1], env.lang)) : hasTime(d) ? 'PP p' : 'PP'
        try {
          return fmt(d, pattern, { locale: env.lang === 'de' ? deLocale : enUS })
        } catch {
          throw new FormulaError('badPattern', undefined, p(1))
        }
      }
      case 'year':
        return a[0] === null ? null : date(a[0], p(0), name).getFullYear()
      case 'month':
        return a[0] === null ? null : date(a[0], p(0), name).getMonth() + 1
      case 'date':
        return a[0] === null ? null : date(a[0], p(0), name).getDate()
      case 'empty': {
        const v = a[0]
        return v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v))
      }
      case 'toNumber': {
        const v = a[0]
        if (v === null) return null
        if (typeof v === 'number') return v
        if (typeof v === 'boolean') return v ? 1 : 0
        if (isDate(v)) return v.getTime()
        if (Array.isArray(v)) return v.length
        const n = Number(String(v).trim().replace(',', '.'))
        return String(v).trim() === '' || !Number.isFinite(n) ? null : n
      }
      case 'format':
        return toText(a[0], env.lang)
    }
    throw new FormulaError('unknownFunction', { name }, pos)
  }

  return ev(node)
}
