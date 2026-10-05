/**
 * One Script — the built-in library that needs nothing from One: text, numbers, lists, records,
 * dates and durations, print / log. Global functions and methods share their implementations
 * (`upper(s)` = `s.upper()`). Names ignore case and underscores (`days_between` = `daysBetween`).
 *
 * Lazy methods (where, sort, select, map, sum …) get their arguments unevaluated and evaluate them
 * per item: inside them a record's fields and a row's properties are plain names (`Status = "Open"`),
 * `it` is the item, and a function (`x => x.Name`) is called with the item.
 */
import { addMonths, differenceInCalendarDays, format as formatDate, getISODay } from 'date-fns'
import { de as deLocale } from 'date-fns/locale'
import { ScriptError } from './errors'
import {
  SDate,
  SDuration,
  SRecord,
  addDuration,
  equals,
  inspect,
  matches,
  parseDate,
  sortCompare,
  toPlain,
  toText,
  truthy,
  typeName,
  type Args,
  type CallCtx,
  type NativeFn,
  type Thunk,
  type Value,
} from './values'

/** Builtin names compare without case and underscores. */
export const normName = (name: string): string => name.toLowerCase().replace(/_/g, '')

export function native(name: string, call: NativeFn['call'], opts: { lazy?: boolean; members?: NativeFn['members'] } = {}): NativeFn {
  return { kind: 'native', name, call, ...opts }
}

/* ------------------------------------------------------------------ argument helpers */

export function argAt(args: Args, i: number, name?: string): Value {
  if (name && args.named.has(name)) return args.named.get(name)!
  return i < args.pos.length ? args.pos[i] : null
}

export function badArgs(ctx: CallCtx, detail: string): ScriptError {
  return new ScriptError('bad_args', { name: ctx.name, detail }, ctx.pos)
}

export function needNumber(v: Value, ctx: CallCtx, what = 'a number'): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim())
  throw badArgs(ctx, `expected ${what}, got ${typeName(v)}`)
}

export function needText(v: Value, ctx: CallCtx): string {
  if (typeof v === 'string') return v
  if (v === null) return ''
  return toText(v)
}

export function needList(v: Value, ctx: CallCtx): Value[] {
  if (Array.isArray(v)) return v
  if (v === null) return []
  throw badArgs(ctx, `expected a list, got ${typeName(v)}`)
}

export function needDate(v: Value, ctx: CallCtx): SDate {
  if (v instanceof SDate) return v
  if (typeof v === 'string') {
    const d = parseDate(v)
    if (d) return d
  }
  throw badArgs(ctx, `expected a date, got ${typeName(v)}`)
}

export function checkList(list: Value[], ctx: CallCtx): Value[] {
  if (list.length > ctx.limits.list) throw new ScriptError('too_big', { what: 'list', max: ctx.limits.list }, ctx.pos)
  return list
}

export function checkText(s: string, ctx: CallCtx): string {
  if (s.length > ctx.limits.text) throw new ScriptError('too_big', { what: 'text', max: ctx.limits.text }, ctx.pos)
  return s
}

/* ------------------------------------------------------------------ dates */

export function dateFormat(d: SDate, pattern: string | null, ctx: CallCtx): string {
  const p = pattern ?? (d.time ? (ctx.lang === 'de' ? 'dd.MM.yyyy HH:mm' : 'yyyy-MM-dd HH:mm') : ctx.lang === 'de' ? 'dd.MM.yyyy' : 'yyyy-MM-dd')
  try {
    return formatDate(d.date, p, ctx.lang === 'de' ? { locale: deLocale } : undefined)
  } catch {
    throw badArgs(ctx, `"${p}" is not a date pattern (try "dd.MM.yyyy")`)
  }
}

function numberFormat(n: number, places: number | null, ctx: CallCtx): string {
  return n.toLocaleString(ctx.lang === 'de' ? 'de-DE' : 'en-US', places === null ? { maximumFractionDigits: 10 } : { minimumFractionDigits: places, maximumFractionDigits: places })
}

/** format(value, pattern?): dates by a pattern ("dd.MM.yyyy"), numbers with places, anything else as text. */
function formatValue(v: Value, pattern: Value, ctx: CallCtx): string {
  if (v instanceof SDate) return dateFormat(v, pattern === null ? null : needText(pattern, ctx), ctx)
  if (typeof v === 'number') return numberFormat(v, pattern === null ? null : Math.max(0, Math.min(10, Math.round(needNumber(pattern, ctx)))), ctx)
  return toText(v)
}

/* ------------------------------------------------------------------ lazy helpers */

/** Evaluate every thunk for an item and say whether all of them hold (and-ed conditions). */
async function holds(thunks: Thunk[], item: Value, ctx: CallCtx): Promise<boolean> {
  for (const th of thunks) if (!truthy(await ctx.evalFor(th, item))) return false
  return true
}

/** The value a key thunk gives for an item (no thunk: the item itself). */
async function keyOf(th: Thunk | undefined, item: Value, ctx: CallCtx): Promise<Value> {
  return th ? ctx.evalFor(th, item) : item
}

/** A column name for select: a name stays a name, an expression its source. */
export function columnName(th: Thunk): string {
  const n = th.node
  if (n.type === 'Ident') return n.name
  if (n.type === 'Member') return n.name
  return th.text.trim()
}

export async function sortBy(list: Value[], args: Args, ctx: CallCtx): Promise<Value[]> {
  const descAll = truthy(args.namedThunks.has('desc') ? await ctx.eval(args.namedThunks.get('desc')!) : null)
  const keys = args.thunks
  const rows: Array<{ item: Value; ks: Value[]; i: number }> = []
  let i = 0
  for (const item of list) {
    await ctx.step()
    const ks: Value[] = []
    if (keys.length) for (const th of keys) ks.push(await ctx.evalFor(th, item))
    else ks.push(item)
    rows.push({ item, ks, i: i++ })
  }
  rows.sort((a, b) => {
    for (let k = 0; k < a.ks.length; k++) {
      const desc = keys[k]?.order === 'desc' || (descAll && keys[k]?.order !== 'asc')
      const x = a.ks[k]
      const y = b.ks[k]
      // empty values last, whatever the direction
      const ex = x === null || x === ''
      const ey = y === null || y === ''
      if (ex || ey) {
        if (ex !== ey) return ex ? 1 : -1
        continue
      }
      const c = sortCompare(x, y)
      if (c) return desc ? -c : c
    }
    return a.i - b.i
  })
  return rows.map((r) => r.item)
}

export async function selectFrom(list: Value[], args: Args, ctx: CallCtx): Promise<Value[]> {
  const cols: Array<[string, Thunk]> = [...args.thunks.map((th): [string, Thunk] => [columnName(th), th]), ...args.namedThunks]
  const out: Value[] = []
  for (const item of list) {
    await ctx.step()
    const rec = new SRecord()
    for (const [name, th] of cols) rec.fields.set(name, await ctx.evalFor(th, item))
    out.push(rec)
  }
  return out
}

export async function groupBy(list: Value[], th: Thunk | undefined, ctx: CallCtx): Promise<Value[]> {
  const groups: Array<{ key: Value; rows: Value[] }> = []
  for (const item of list) {
    await ctx.step()
    const k = await keyOf(th, item, ctx)
    // a multi-value key (tags, people): the item goes into every group
    const ks = Array.isArray(k) ? (k.length ? k : [null]) : [k]
    for (const key of ks) {
      const g = groups.find((x) => equals(x.key, key))
      if (g) g.rows.push(item)
      else groups.push({ key, rows: [item] })
    }
  }
  return groups.map(
    (g) =>
      new SRecord([
        ['key', g.key],
        ['rows', g.rows],
        ['count', g.rows.length],
      ]),
  )
}

/** Numbers of a list (by a key): non-numbers are skipped. */
async function numbersOf(list: Value[], th: Thunk | undefined, ctx: CallCtx): Promise<number[]> {
  const out: number[] = []
  for (const item of list) {
    await ctx.step()
    const v = await keyOf(th, item, ctx)
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

async function extreme(list: Value[], th: Thunk | undefined, ctx: CallCtx, sign: 1 | -1): Promise<Value> {
  let best: Value = null
  for (const item of list) {
    await ctx.step()
    const v = await keyOf(th, item, ctx)
    if (v === null || v === '') continue
    if (best === null || sortCompare(v, best) * sign > 0) best = v
  }
  return best
}

/** Aggregations shared by lists and database queries. */
export const aggregate = {
  sum: async (list: Value[], th: Thunk | undefined, ctx: CallCtx) => (await numbersOf(list, th, ctx)).reduce((a, b) => a + b, 0),
  avg: async (list: Value[], th: Thunk | undefined, ctx: CallCtx) => {
    const ns = await numbersOf(list, th, ctx)
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null
  },
  min: (list: Value[], th: Thunk | undefined, ctx: CallCtx) => extreme(list, th, ctx, -1),
  max: (list: Value[], th: Thunk | undefined, ctx: CallCtx) => extreme(list, th, ctx, 1),
}

export async function whereIn(list: Value[], thunks: Thunk[], ctx: CallCtx): Promise<Value[]> {
  const out: Value[] = []
  for (const item of list) {
    await ctx.step()
    if (await holds(thunks, item, ctx)) out.push(item)
  }
  return out
}

/* ------------------------------------------------------------------ methods by kind */

type Method = (self: never, args: Args, ctx: CallCtx) => Value | Promise<Value>
interface MethodDef {
  fn: Method
  lazy?: boolean
}

const m = (fn: (self: never, args: Args, ctx: CallCtx) => Value | Promise<Value>, lazy = false): MethodDef => ({ fn, lazy })

const TEXT_METHODS: Record<string, MethodDef> = {
  upper: m((s: string) => s.toUpperCase()),
  lower: m((s: string) => s.toLowerCase()),
  trim: m((s: string) => s.trim()),
  contains: m((s: string, a, ctx) => s.toLowerCase().includes(needText(argAt(a, 0), ctx).toLowerCase())),
  startswith: m((s: string, a, ctx) => s.toLowerCase().startsWith(needText(argAt(a, 0), ctx).toLowerCase())),
  endswith: m((s: string, a, ctx) => s.toLowerCase().endsWith(needText(argAt(a, 0), ctx).toLowerCase())),
  split: m((s: string, a, ctx) => checkList(argAt(a, 0) === null ? s.split(/\s+/).filter(Boolean) : s.split(needText(argAt(a, 0), ctx)), ctx)),
  replace: m((s: string, a, ctx) => checkText(s.split(needText(argAt(a, 0), ctx)).join(needText(argAt(a, 1), ctx)), ctx)),
  slice: m((s: string, a, ctx) => [...s].slice(needNumber(argAt(a, 0) ?? 0, ctx), argAt(a, 1) === null ? undefined : needNumber(argAt(a, 1), ctx)).join('')),
  lines: m((s: string) => s.split(/\r?\n/)),
  number: m((s: string) => {
    const t = s.trim().replace(/\s/g, '')
    const n = Number(/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''))
    return t && Number.isFinite(n) ? n : null
  }),
  date: m((s: string) => parseDate(s)),
  repeat: m((s: string, a, ctx) => checkText(s.repeat(Math.max(0, Math.min(100_000, needNumber(argAt(a, 0), ctx)))), ctx)),
}

const NUMBER_METHODS: Record<string, MethodDef> = {
  round: m((n: number, a, ctx) => {
    const p = argAt(a, 0) === null ? 0 : Math.max(0, Math.min(10, Math.round(needNumber(argAt(a, 0), ctx))))
    const f = 10 ** p
    return Math.round(n * f) / f
  }),
  floor: m((n: number) => Math.floor(n)),
  ceil: m((n: number) => Math.ceil(n)),
  abs: m((n: number) => Math.abs(n)),
  format: m((n: number, a, ctx) => formatValue(n, argAt(a, 0), ctx)),
}

const LIST_METHODS: Record<string, MethodDef> = {
  map: m(async (list: Value[], a, ctx) => {
    const out: Value[] = []
    for (const item of list) {
      await ctx.step()
      out.push(await ctx.evalFor(a.thunks[0], item))
    }
    return out
  }, true),
  where: m((list: Value[], a, ctx) => whereIn(list, a.thunks, ctx), true),
  filter: m((list: Value[], a, ctx) => whereIn(list, a.thunks, ctx), true),
  find: m(async (list: Value[], a, ctx) => {
    for (const item of list) {
      await ctx.step()
      if (await holds(a.thunks, item, ctx)) return item
    }
    return null
  }, true),
  any: m(async (list: Value[], a, ctx) => {
    for (const item of list) if (await holds(a.thunks, item, ctx)) return true
    return false
  }, true),
  all: m(async (list: Value[], a, ctx) => {
    for (const item of list) if (!(await holds(a.thunks, item, ctx))) return false
    return true
  }, true),
  count: m(async (list: Value[], a, ctx) => (a.thunks.length ? (await whereIn(list, a.thunks, ctx)).length : list.length), true),
  sort: m((list: Value[], a, ctx) => sortBy(list, a, ctx), true),
  select: m((list: Value[], a, ctx) => selectFrom(list, a, ctx), true),
  group: m((list: Value[], a, ctx) => groupBy(list, a.thunks[0], ctx), true),
  sum: m((list: Value[], a, ctx) => aggregate.sum(list, a.thunks[0], ctx), true),
  avg: m((list: Value[], a, ctx) => aggregate.avg(list, a.thunks[0], ctx), true),
  min: m((list: Value[], a, ctx) => aggregate.min(list, a.thunks[0], ctx), true),
  max: m((list: Value[], a, ctx) => aggregate.max(list, a.thunks[0], ctx), true),
  limit: m((list: Value[], a, ctx) => list.slice(0, Math.max(0, needNumber(argAt(a, 0), ctx)))),
  take: m((list: Value[], a, ctx) => list.slice(0, Math.max(0, needNumber(argAt(a, 0), ctx)))),
  skip: m((list: Value[], a, ctx) => list.slice(Math.max(0, needNumber(argAt(a, 0), ctx)))),
  join: m((list: Value[], a, ctx) => checkText(list.map(toText).join(argAt(a, 0) === null ? ', ' : needText(argAt(a, 0), ctx)), ctx)),
  contains: m((list: Value[], a) => list.some((x) => matches(x, argAt(a, 0)))),
  indexof: m((list: Value[], a) => list.findIndex((x) => equals(x, argAt(a, 0)))),
  reverse: m((list: Value[]) => [...list].reverse()),
  unique: m((list: Value[]) => list.filter((x, i) => list.findIndex((y) => equals(x, y)) === i)),
  flat: m((list: Value[], _a, ctx) => checkList(list.flatMap((x) => (Array.isArray(x) ? x : [x])), ctx)),
  push: m((list: Value[], a, ctx) => {
    list.push(...a.pos)
    checkList(list, ctx)
    return list
  }),
}

const RECORD_METHODS: Record<string, MethodDef> = {
  get: m((r: SRecord, a, ctx) => {
    const k = needText(argAt(a, 0), ctx)
    return r.fields.has(k) ? r.fields.get(k)! : argAt(a, 1)
  }),
  has: m((r: SRecord, a, ctx) => r.fields.has(needText(argAt(a, 0), ctx))),
}

const DATE_METHODS: Record<string, MethodDef> = {
  format: m((d: SDate, a, ctx) => dateFormat(d, argAt(a, 0) === null ? null : needText(argAt(a, 0), ctx), ctx)),
}

function textProp(s: string, name: string): Value | undefined {
  if (name === 'length' || name === 'len') return [...s].length
  return undefined
}

function listProp(list: Value[], name: string): Value | undefined {
  switch (name) {
    case 'count':
    case 'length':
    case 'len':
      return list.length
    case 'first':
      return list.length ? list[0] : null
    case 'last':
      return list.length ? list[list.length - 1] : null
  }
  return undefined
}

function dateProp(d: SDate, name: string): Value | undefined {
  const x = d.date
  switch (name) {
    case 'year':
      return x.getFullYear()
    case 'month':
      return x.getMonth() + 1
    case 'day':
      return x.getDate()
    case 'weekday':
      return getISODay(x)
    case 'hour':
      return x.getHours()
    case 'minute':
      return x.getMinutes()
    case 'end':
      return d.end
    case 'start':
      return d.end ? new SDate(d.t, d.time) : d
    case 'date':
      return SDate.day(x)
  }
  return undefined
}

function durationProp(d: SDuration, name: string): Value | undefined {
  switch (name) {
    case 'days':
      return d.total / 86_400_000
    case 'hours':
      return d.total / 3_600_000
    case 'minutes':
      return d.total / 60_000
    case 'seconds':
      return d.total / 1000
  }
  return undefined
}

function tableOf(v: Value): Record<string, MethodDef> | null {
  if (typeof v === 'string') return TEXT_METHODS
  if (typeof v === 'number') return NUMBER_METHODS
  if (Array.isArray(v)) return LIST_METHODS
  if (v instanceof SRecord) return RECORD_METHODS
  if (v instanceof SDate) return DATE_METHODS
  return null
}

/** A method of a built-in value, bound to it (null: none by that name). */
export function builtinMethod(self: Value, name: string): NativeFn | null {
  const def = tableOf(self)?.[normName(name)]
  if (!def) return null
  return native(name, (args, ctx) => def.fn(self as never, args, ctx), { lazy: def.lazy })
}

/** A property of a built-in value (undefined: none by that name). Record fields come first. */
export function builtinProp(self: Value, name: string): Value | undefined {
  const n = normName(name)
  if (self instanceof SRecord) {
    if (self.fields.has(name)) return self.fields.get(name)!
    for (const [k, v] of self.fields) if (k.toLowerCase() === name.toLowerCase()) return v
    if (n === 'keys') return [...self.fields.keys()]
    if (n === 'values') return [...self.fields.values()]
    if (n === 'count' || n === 'length') return self.fields.size
    return undefined
  }
  if (typeof self === 'string') return textProp(self, n)
  if (Array.isArray(self)) return listProp(self, n)
  if (self instanceof SDate) return dateProp(self, n)
  if (self instanceof SDuration) return durationProp(self, n)
  return undefined
}

/** Names offered by autocomplete after "." for built-in values (lists, texts …). */
export const BUILTIN_MEMBER_NAMES = {
  text: ['length', ...Object.keys(TEXT_METHODS)],
  list: ['count', 'first', 'last', ...Object.keys(LIST_METHODS)],
  date: ['year', 'month', 'day', 'weekday', 'hour', 'minute', 'end', 'format'],
}

/* ------------------------------------------------------------------ global functions */

/** Call a method of the first argument (`upper(s)` → `s.upper()`). */
function viaMethod(name: string, lazy = false): NativeFn {
  return native(
    name,
    async (args, ctx) => {
      // lazy: the first argument (the subject) is evaluated here, the rest stay lazy
      const self = lazy ? await ctx.eval(args.thunks[0]) : argAt(args, 0)
      const fn = builtinMethod(self, name)
      if (!fn) throw badArgs(ctx, `cannot be used with ${typeName(self)}`)
      const rest: Args = lazy
        ? { pos: [], named: new Map(), thunks: args.thunks.slice(1), namedThunks: args.namedThunks }
        : { pos: args.pos.slice(1), named: args.named, thunks: [], namedThunks: new Map() }
      return fn.call(rest, ctx)
    },
    { lazy },
  )
}

const dur = (days: number, ms: number) => (v: Value, ctx: CallCtx) => {
  const n = needNumber(v, ctx)
  return new SDuration(days * n, ms * n)
}

function makeDate(args: Args, ctx: CallCtx, time: boolean): Value {
  const a0 = argAt(args, 0)
  if (args.pos.length >= 3) {
    const [y, mo, d, h, mi] = args.pos.map((v) => (v === null ? 0 : needNumber(v, ctx)))
    const date = new Date(y, mo - 1, d, h ?? 0, mi ?? 0)
    if (Number.isNaN(date.getTime())) throw badArgs(ctx, 'not a valid date')
    return time ? SDate.at(date) : SDate.day(date)
  }
  if (a0 instanceof SDate) return time ? new SDate(a0.t, true) : SDate.day(a0.date)
  if (typeof a0 === 'string') {
    const d = parseDate(a0)
    if (!d) throw badArgs(ctx, `"${a0}" is not a date (use "YYYY-MM-DD" or "YYYY-MM-DD HH:mm")`)
    return time || d.time ? d : d
  }
  if (a0 === null) return null
  throw badArgs(ctx, `expected a text like "2026-10-05", got ${typeName(a0)}`)
}

function toNumber(v: Value, ctx: CallCtx): Value {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') return (TEXT_METHODS.number.fn as (s: string, a: Args, c: CallCtx) => Value)(v, { pos: [], named: new Map(), thunks: [], namedThunks: new Map() }, ctx)
  if (v instanceof SDuration) return v.total
  if (v === null) return null
  throw badArgs(ctx, `cannot turn ${typeName(v)} into a number`)
}

const G: NativeFn[] = [
  native('print', async (a, ctx) => {
    await ctx.print(a.pos, 'print')
    return null
  }),
  native('log', async (a, ctx) => {
    await ctx.print(a.pos, 'log')
    return null
  }),
  native('len', (a) => {
    const v = argAt(a, 0)
    if (typeof v === 'string') return [...v].length
    if (Array.isArray(v)) return v.length
    if (v instanceof SRecord) return v.fields.size
    return v === null ? 0 : 1
  }),
  viaMethod('upper'),
  viaMethod('lower'),
  viaMethod('trim'),
  viaMethod('split'),
  viaMethod('replace'),
  viaMethod('slice'),
  viaMethod('lines'),
  native('contains', (a, ctx) => {
    const hay = argAt(a, 0)
    const needle = argAt(a, 1)
    if (Array.isArray(hay)) return hay.some((x) => matches(x, needle))
    if (hay instanceof SRecord) return hay.fields.has(needText(needle, ctx))
    return needText(hay, ctx).toLowerCase().includes(needText(needle, ctx).toLowerCase())
  }),
  viaMethod('starts_with'),
  viaMethod('ends_with'),
  native('join', (a, ctx) => checkText(needList(argAt(a, 0), ctx).map(toText).join(argAt(a, 1) === null ? ', ' : needText(argAt(a, 1), ctx)), ctx)),
  native('round', (a, ctx) => (NUMBER_METHODS.round.fn as (n: number, a: Args, c: CallCtx) => Value)(needNumber(argAt(a, 0), ctx), { ...a, pos: a.pos.slice(1) }, ctx)),
  native('floor', (a, ctx) => Math.floor(needNumber(argAt(a, 0), ctx))),
  native('ceil', (a, ctx) => Math.ceil(needNumber(argAt(a, 0), ctx))),
  native('abs', (a, ctx) => Math.abs(needNumber(argAt(a, 0), ctx))),
  native('min', (a, ctx) => {
    const list = a.pos.length === 1 && Array.isArray(a.pos[0]) ? a.pos[0] : a.pos
    return list.reduce<Value>((best, v) => (v === null ? best : best === null || sortCompare(v, best) < 0 ? v : best), null)
  }),
  native('max', (a, ctx) => {
    const list = a.pos.length === 1 && Array.isArray(a.pos[0]) ? a.pos[0] : a.pos
    return list.reduce<Value>((best, v) => (v === null ? best : best === null || sortCompare(v, best) > 0 ? v : best), null)
  }),
  native('sum', (a) => {
    const list = a.pos.length === 1 && Array.isArray(a.pos[0]) ? a.pos[0] : a.pos
    return list.reduce<number>((s, v) => (typeof v === 'number' && Number.isFinite(v) ? s + v : s), 0)
  }),
  native('avg', (a) => {
    const list = (a.pos.length === 1 && Array.isArray(a.pos[0]) ? a.pos[0] : a.pos).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    return list.length ? list.reduce((s, v) => s + v, 0) / list.length : null
  }),
  native('number', (a, ctx) => toNumber(argAt(a, 0), ctx)),
  native('text', (a) => toText(argAt(a, 0))),
  native('today', () => SDate.day(new Date())),
  native('now', () => SDate.at(new Date())),
  native('date', (a, ctx) => makeDate(a, ctx, false)),
  native('datetime', (a, ctx) => makeDate(a, ctx, true)),
  native('format', (a, ctx) => formatValue(argAt(a, 0), argAt(a, 1), ctx)),
  native('days_between', (a, ctx) => differenceInCalendarDays(needDate(argAt(a, 1), ctx).date, needDate(argAt(a, 0), ctx).date)),
  native('add_days', (a, ctx) => addDuration(needDate(argAt(a, 0), ctx), new SDuration(Math.round(needNumber(argAt(a, 1), ctx)), 0))),
  native('add_months', (a, ctx) => {
    const d = needDate(argAt(a, 0), ctx)
    return new SDate(addMonths(d.date, Math.round(needNumber(argAt(a, 1), ctx))).getTime(), d.time)
  }),
  native('weekday', (a, ctx) => getISODay(needDate(argAt(a, 0), ctx).date)),
  native('weeks', (a, ctx) => dur(7, 0)(argAt(a, 0), ctx)),
  native('days', (a, ctx) => dur(1, 0)(argAt(a, 0), ctx)),
  native('hours', (a, ctx) => dur(0, 3_600_000)(argAt(a, 0), ctx)),
  native('minutes', (a, ctx) => dur(0, 60_000)(argAt(a, 0), ctx)),
  native('range', (a, ctx) => {
    let from = needNumber(argAt(a, 0), ctx)
    let to: number
    if (a.pos.length < 2) {
      to = from
      from = 0
    } else to = needNumber(argAt(a, 1), ctx)
    const step = a.pos.length >= 3 ? needNumber(argAt(a, 2), ctx) : from <= to ? 1 : -1
    if (!step) throw badArgs(ctx, 'the step must not be 0')
    const n = Math.max(0, Math.ceil((to - from) / step))
    if (n > ctx.limits.list) throw new ScriptError('too_big', { what: 'list', max: ctx.limits.list }, ctx.pos)
    return Array.from({ length: n }, (_, i) => from + i * step)
  }),
  native('keys', (a, ctx) => {
    const r = argAt(a, 0)
    if (!(r instanceof SRecord)) throw badArgs(ctx, `expected a record, got ${typeName(r)}`)
    return [...r.fields.keys()]
  }),
  native('values', (a, ctx) => {
    const r = argAt(a, 0)
    if (!(r instanceof SRecord)) throw badArgs(ctx, `expected a record, got ${typeName(r)}`)
    return [...r.fields.values()]
  }),
  native('empty', (a) => !truthy(argAt(a, 0)) && argAt(a, 0) !== 0 && argAt(a, 0) !== false),
  native('type', (a) => typeName(argAt(a, 0))),
  viaMethod('sort', true),
  viaMethod('unique'),
  viaMethod('reverse'),
  native('first', (a, ctx) => {
    const l = needList(argAt(a, 0), ctx)
    return l.length ? l[0] : null
  }),
  native('last', (a, ctx) => {
    const l = needList(argAt(a, 0), ctx)
    return l.length ? l[l.length - 1] : null
  }),
  native('json', (a) => JSON.stringify(toPlain(argAt(a, 0)), null, 2)),
  native('inspect', (a) => inspect(argAt(a, 0))),
  native('error', (a, ctx) => {
    throw new ScriptError('custom', { message: needText(argAt(a, 0), ctx) || 'Error' }, ctx.pos)
  }),
]

/** The built-in global functions by normalized name. */
export const BUILTINS: Map<string, NativeFn> = new Map(G.map((f) => [normName(f.name), f]))

/** Names and signatures for autocomplete / signature help / the reference (args as written). */
export const BUILTIN_SIGNATURES: Record<string, string> = {
  print: 'print(value, …)',
  log: 'log(value, …)',
  len: 'len(value)',
  upper: 'upper(text)',
  lower: 'lower(text)',
  trim: 'trim(text)',
  split: 'split(text, separator?)',
  replace: 'replace(text, find, with)',
  slice: 'slice(text, start, end?)',
  lines: 'lines(text)',
  contains: 'contains(text | list, value)',
  starts_with: 'starts_with(text, start)',
  ends_with: 'ends_with(text, end)',
  join: 'join(list, separator?)',
  round: 'round(number, places?)',
  floor: 'floor(number)',
  ceil: 'ceil(number)',
  abs: 'abs(number)',
  min: 'min(a, b, … | list)',
  max: 'max(a, b, … | list)',
  sum: 'sum(list)',
  avg: 'avg(list)',
  number: 'number(value)',
  text: 'text(value)',
  today: 'today()',
  now: 'now()',
  date: 'date("2026-10-05") · date(year, month, day)',
  datetime: 'datetime("2026-10-05 14:30")',
  format: 'format(value, pattern?)',
  days_between: 'days_between(from, to)',
  add_days: 'add_days(date, n)',
  add_months: 'add_months(date, n)',
  weekday: 'weekday(date)',
  weeks: 'weeks(n)',
  days: 'days(n)',
  hours: 'hours(n)',
  minutes: 'minutes(n)',
  range: 'range(from, to, step?)',
  keys: 'keys(record)',
  values: 'values(record)',
  empty: 'empty(value)',
  type: 'type(value)',
  sort: 'sort(list, key?)',
  unique: 'unique(list)',
  reverse: 'reverse(list)',
  first: 'first(list)',
  last: 'last(list)',
  json: 'json(value)',
  inspect: 'inspect(value)',
  error: 'error(message)',
}

