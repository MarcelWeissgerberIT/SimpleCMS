/**
 * One Script — runtime values and their rules (truth, equality, order, display). Pure: dates are
 * local wall-clock time like everything in One (`today()` = this device's midnight).
 *
 *   number · text · yes/no (boolean) · null · date / datetime (SDate) · duration (SDuration) ·
 *   list (array) · record (SRecord) · function (Closure / NativeFn) · One objects (HostObject:
 *   pages, rows, databases, queries, people … — defined by the runtime)
 */
import { addDays, differenceInCalendarDays, format as formatDate, startOfDay } from 'date-fns'
import { ScriptError, type Pos } from './errors'
import type { Block, Expr, Param } from './ast'

/** A date (all-day: `time` false, `t` = local midnight) or a datetime; `end` for date ranges. */
export class SDate {
  constructor(
    readonly t: number,
    readonly time: boolean,
    readonly end: SDate | null = null,
  ) {}
  get date(): Date {
    return new Date(this.t)
  }
  static day(d: Date): SDate {
    return new SDate(startOfDay(d).getTime(), false)
  }
  static at(d: Date): SDate {
    return new SDate(d.getTime(), true)
  }
}

/** A duration: whole calendar days (+ weeks) and a fixed part in ms (hours, minutes, seconds). */
export class SDuration {
  constructor(
    readonly days: number,
    readonly ms: number,
  ) {}
  get total(): number {
    return this.days * 86_400_000 + this.ms
  }
}

/** A record `{to: "a@b.c", subject: "Hi"}` — fields keep their order. */
export class SRecord {
  readonly fields: Map<string, Value>
  constructor(entries?: Iterable<[string, Value]>) {
    this.fields = new Map(entries)
  }
  get(name: string): Value | undefined {
    return this.fields.get(name)
  }
}

/** A function written in the script (fn / lambda) with the scope it was made in. */
export class Closure {
  constructor(
    readonly name: string | null,
    readonly params: Param[],
    readonly body: Expr | Block,
    /** the interpreter's scope (opaque here) */
    readonly env: unknown,
  ) {}
}

/** A lazily evaluated argument (where / sort / select …): the expression and how it was written. */
export interface Thunk {
  node: Expr
  /** `.sort(Due desc)` */
  order: 'asc' | 'desc' | null
  /** the source text of the expression (column names of select) */
  text: string
  /** where it was written (the interpreter's scope, opaque here) */
  env: unknown
}

export interface Args {
  pos: Value[]
  named: Map<string, Value>
  /** lazy natives: the unevaluated arguments instead */
  thunks: Thunk[]
  namedThunks: Map<string, Thunk>
}

/** What a native function gets besides its arguments. */
export interface CallCtx {
  /** the name it was called by (messages) */
  name: string
  pos: Pos
  signal: AbortSignal | null
  lang: 'en' | 'de'
  /** evaluate a lazy argument as is */
  eval(thunk: Thunk): Promise<Value>
  /** evaluate a lazy argument for one item: its fields / properties are names there, `it` is the item; a function is called with it */
  evalFor(thunk: Thunk, item: Value): Promise<Value>
  /** call a script function (or a native) */
  call(fn: Value, args: Value[]): Promise<Value>
  /** count work a native does in a loop (step budget, Stop) */
  step(): Promise<void>
  /** waiting for the person (a dialog): the time budget doesn't run meanwhile */
  waitUser<T>(p: Promise<T>): Promise<T>
  /** print / log to the run's console */
  print(values: Value[], kind: 'print' | 'log'): void | Promise<void>
  /** the run's limits (natives that build lists / texts check them) */
  limits: { list: number; text: number }
  /** the runtime's services (host objects reach the One side through it) */
  host: unknown
}

export interface NativeFn {
  kind: 'native'
  name: string
  /** arguments arrive unevaluated (Args.thunks) */
  lazy?: boolean
  /** properties of the function value itself (`page.current`) */
  members?: Record<string, () => Value | Promise<Value>>
  call(args: Args, ctx: CallCtx): Value | Promise<Value>
}

/** A One object (page, row, database, query, person …). The runtime implements them. */
export abstract class HostObject {
  abstract readonly typeName: string
  /** a property or a bound method (NativeFn); undefined = no such member */
  abstract member(name: string, ctx: CallCtx): Value | undefined | Promise<Value | undefined>
  /** `obj.name(…)`: a method by that name (asked first for calls, so a name can be a property and a method) */
  method?(name: string): NativeFn | undefined
  /** names inside where / sort / select for this item (a row's properties); undefined = not one */
  scope(_name: string, _ctx: CallCtx): Value | undefined | Promise<Value | undefined> {
    return undefined
  }
  /** the error for a name nothing knows inside where / sort / select of this item (absent: "Unknown name") */
  unknownName?(name: string): ScriptError | undefined
  /** `obj.name = value` (rows: set a property) — absent: not allowed */
  setMember?(name: string, value: Value, ctx: CallCtx): Promise<void>
  /** `for x in obj` (a query: its rows) — absent: not iterable */
  iterate?(ctx: CallCtx): Promise<Value[]>
  abstract display(): string
  abstract equals(other: Value): boolean
  /** texts a plain text may match in contains() / = (a person's name, a row's title) */
  matchText(): string[] {
    return [this.display()]
  }
  /** plain JSON for results (query tester, MCP) */
  abstract toPlain(): unknown
}

export type Value = number | string | boolean | null | SDate | SDuration | Value[] | SRecord | Closure | NativeFn | HostObject

export const isNative = (v: unknown): v is NativeFn => !!v && typeof v === 'object' && (v as NativeFn).kind === 'native' && typeof (v as NativeFn).call === 'function'
export const isCallable = (v: Value): v is Closure | NativeFn => v instanceof Closure || isNative(v)
export const isList = (v: Value): v is Value[] => Array.isArray(v)

export function typeName(v: Value): string {
  if (v === null) return 'null'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'text'
  if (typeof v === 'boolean') return 'yes/no'
  if (v instanceof SDate) return v.time ? 'datetime' : 'date'
  if (v instanceof SDuration) return 'duration'
  if (Array.isArray(v)) return 'list'
  if (v instanceof SRecord) return 'record'
  if (v instanceof HostObject) return v.typeName
  return 'function'
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

/* ------------------------------------------------------------------ display */

export function numText(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : n > 0 ? '∞' : '-∞'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(12)))
}

export function dateText(d: SDate): string {
  const one = (x: SDate) => formatDate(x.date, x.time ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd')
  return d.end ? `${one(d)} → ${one(d.end)}` : one(d)
}

export function durationText(d: SDuration): string {
  const parts: string[] = []
  let days = d.days
  let ms = d.ms
  const neg = d.total < 0
  if (neg) {
    days = -days
    ms = -ms
  }
  if (days) parts.push(days % 7 === 0 && days >= 7 ? `${days / 7}w` : `${days}d`)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s) parts.push(`${s}s`)
  return (neg ? '-' : '') + (parts.join(' ') || '0d')
}

/** Text of a value inside a text ("{x}", +, join): null → "". */
export function toText(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return numText(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof SDate) return dateText(v)
  if (v instanceof SDuration) return durationText(v)
  if (Array.isArray(v)) return v.map(toText).join(', ')
  if (v instanceof HostObject) return v.display()
  return inspect(v)
}

/** How the console shows a value: texts quoted inside lists and records. */
export function inspect(v: Value, depth = 0): string {
  if (depth > 4) return '…'
  if (v === null) return 'null'
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v
  if (Array.isArray(v)) {
    const shown = v.slice(0, 50).map((x) => inspect(x, depth + 1))
    return `[${shown.join(', ')}${v.length > 50 ? `, … ${v.length - 50} more` : ''}]`
  }
  if (v instanceof SRecord) return `{${[...v.fields].map(([k, x]) => `${/^[\p{L}_][\p{L}\p{N}_]*$/u.test(k) ? k : JSON.stringify(k)}: ${inspect(x, depth + 1)}`).join(', ')}}`
  if (v instanceof Closure) return `fn ${v.name ?? ''}(${v.params.map((p) => p.name).join(', ')})`
  if (isNative(v)) return `fn ${v.name}`
  if (v instanceof HostObject) return v.display()
  if (v instanceof SDate) return dateText(v)
  if (v instanceof SDuration) return durationText(v)
  if (typeof v === 'number' || typeof v === 'boolean') return toText(v)
  // nothing else is a script value (never recurse into toText for it)
  return '?'
}

/** Plain JSON of a value (results for tools; dates as ISO strings). */
export function toPlain(v: Value): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof SDate) return v.time ? formatDate(v.date, "yyyy-MM-dd'T'HH:mm") : formatDate(v.date, 'yyyy-MM-dd')
  if (v instanceof SDuration) return durationText(v)
  if (Array.isArray(v)) return v.map(toPlain)
  if (v instanceof SRecord) return Object.fromEntries([...v.fields].map(([k, x]) => [k, toPlain(x)]))
  if (v instanceof HostObject) return v.toPlain()
  return inspect(v)
}

/* ------------------------------------------------------------------ dates */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** "2026-10-05" / "2026-10-05T14:30" (local time) → SDate, or null. */
export function parseDate(s: string): SDate | null {
  const m = ISO_DATE.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0, sec ? Number(sec) : 0)
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null
  return new SDate(date.getTime(), !!h)
}

/** A date moved by a duration; a range moves as a whole (start and end). */
export function addDuration(d: SDate, dur: SDuration, sign = 1): SDate {
  let t = d.t
  if (dur.days) t = addDays(new Date(t), sign * dur.days).getTime()
  t += sign * dur.ms
  return new SDate(t, d.time || dur.ms % 86_400_000 !== 0, d.end ? addDuration(d.end, dur, sign) : null)
}

/* ------------------------------------------------------------------ equality and order */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The script's `=`: same value (dates: the same day when one is all-day; lists / records: item by item). */
export function equals(a: Value, b: Value): boolean {
  if (a === b) return true
  if (a === null || b === null) {
    // an empty list / text counts as "nothing" for `= null`
    const other = a === null ? b : a
    return (Array.isArray(other) && other.length === 0) || other === ''
  }
  if (a instanceof SDate || b instanceof SDate) {
    const x = a instanceof SDate ? a : typeof a === 'string' ? parseDate(a) : null
    const y = b instanceof SDate ? b : typeof b === 'string' ? parseDate(b) : null
    if (!x || !y) return false
    if (!x.time || !y.time) return differenceInCalendarDays(x.date, y.date) === 0
    return x.t === y.t
  }
  if (a instanceof SDuration && b instanceof SDuration) return a.total === b.total
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]))
  if (a instanceof SRecord && b instanceof SRecord) {
    if (a.fields.size !== b.fields.size) return false
    for (const [k, v] of a.fields) if (!b.fields.has(k) || !equals(v, b.fields.get(k)!)) return false
    return true
  }
  if (a instanceof HostObject) return a.equals(b)
  if (b instanceof HostObject) return b.equals(a)
  return false
}

/** Loose match for contains() / in: equals, or a text matching a One object's name / a text ignoring case. */
export function matches(item: Value, needle: Value): boolean {
  if (equals(item, needle)) return true
  if (typeof needle === 'string') {
    const n = needle.trim().toLowerCase()
    if (typeof item === 'string') return item.trim().toLowerCase() === n
    if (item instanceof HostObject) return item.matchText().some((s) => s.trim().toLowerCase() === n)
  }
  if (typeof item === 'string' && needle instanceof HostObject) return needle.matchText().some((s) => s.trim().toLowerCase() === item.trim().toLowerCase())
  return false
}

/**
 * Order of two values: <0, 0, >0 — or null when they can't be ordered (nothing involved: every
 * comparison with null is false). Throws for values of different kinds.
 */
export function compare(a: Value, b: Value, op: string, pos: Pos | null): number | null {
  if (a === null || b === null) return null
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (a instanceof SDate || b instanceof SDate) {
    const x = a instanceof SDate ? a : typeof a === 'string' ? parseDate(a) : null
    const y = b instanceof SDate ? b : typeof b === 'string' ? parseDate(b) : null
    if (x && y) {
      if (!x.time || !y.time) return differenceInCalendarDays(x.date, y.date)
      return x.t - y.t
    }
  }
  if (a instanceof SDuration && b instanceof SDuration) return a.total - b.total
  throw new ScriptError('bad_type', { op, left: typeName(a), right: typeName(b) }, pos)
}

/** Sort comparator (empty values last; mixed kinds by kind). */
export function sortCompare(a: Value, b: Value): number {
  const ea = a === null || a === '' || (Array.isArray(a) && !a.length)
  const eb = b === null || b === '' || (Array.isArray(b) && !b.length)
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  if (Array.isArray(a) && Array.isArray(b)) return sortCompare(a[0], b[0])
  if (a instanceof HostObject || b instanceof HostObject) return collator.compare(toText(a), toText(b))
  try {
    return compare(a, b, 'sort', null) ?? 0
  } catch {
    return collator.compare(typeName(a), typeName(b))
  }
}
