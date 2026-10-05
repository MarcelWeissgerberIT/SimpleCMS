/**
 * One Script — the tree-walking interpreter (async: every step may wait for One or for the person).
 * No eval, no Function constructor, no dynamic import: the script only reaches what the runtime hands
 * in as globals (natives and One objects).
 *
 * Limits (all checked while running): a step budget, a wall-clock budget (default 60 s — time spent
 * waiting for the person doesn't count; `onTimeout` may grant one more budget), call depth, list and
 * text sizes. Stop = the AbortSignal: the run ends at the next step or await.
 */
import { ScriptError, type Pos } from './errors'
import type { Arg, Block, Expr, Program, Stmt } from './ast'
import { BUILTINS, builtinMethod, builtinProp, normName } from './builtins'
import {
  Closure,
  HostObject,
  SDate,
  SDuration,
  SRecord,
  addDuration,
  compare,
  equals,
  isCallable,
  isNative,
  matches,
  toText,
  truthy,
  typeName,
  type Args,
  type CallCtx,
  type NativeFn,
  type Thunk,
  type Value,
} from './values'
import { differenceInCalendarDays } from 'date-fns'

export interface Limits {
  /** evaluation steps per run */
  steps: number
  /** wall-clock budget in ms (waiting for the person does not count) */
  ms: number
  /** nested function calls */
  depth: number
  /** items in one list */
  list: number
  /** characters in one text */
  text: number
}

export const DEFAULT_LIMITS: Limits = { steps: 5_000_000, ms: 60_000, depth: 200, list: 100_000, text: 2_000_000 }

export interface RefInput {
  kind: 'p' | 'u' | 'a' | 's' | 'name'
  id: string | null
  label: string
}

export interface InterpOptions {
  /** global names the runtime adds (page, db, mail …); builtins are always there */
  globals?: Record<string, Value>
  /** a name nobody defined: the runtime may still know it (the workspace's custom functions) */
  fallback?: (name: string) => Value | undefined
  /** @ references → One objects */
  resolveRef?: (ref: RefInput, ctx: CallCtx) => Value | Promise<Value>
  limits?: Partial<Limits>
  signal?: AbortSignal | null
  lang?: 'en' | 'de'
  /** the time budget ran out: true = one more budget (asked once per run) */
  onTimeout?: () => Promise<boolean>
  /** print / log */
  onPrint?: (values: Value[], kind: 'print' | 'log', ctx: CallCtx) => void | Promise<void>
  /** the runtime's services, handed to natives as ctx.host */
  host?: unknown
}

const MISSING = Symbol('missing')
type Lookup = Value | typeof MISSING

class Env {
  readonly vars = new Map<string, Value>()
  constructor(
    readonly parent: Env | null,
    /** names of an item inside where / sort / select (a row's properties, a record's fields) */
    readonly scope: ((name: string) => Value | undefined | Promise<Value | undefined>) | null = null,
    /** the item's own error for a name nobody knows ("Tasks has no property X") */
    readonly miss: ((name: string) => ScriptError | undefined) | null = null,
  ) {}
}

class ReturnSignal {
  constructor(readonly value: Value) {}
}
class BreakSignal {
  constructor(readonly pos: Pos) {}
}
class ContinueSignal {
  constructor(readonly pos: Pos) {}
}

const YIELD_MS = 40

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0))

export class Interpreter {
  readonly limits: Limits
  readonly lang: 'en' | 'de'
  private readonly opts: InterpOptions
  private readonly globals: Map<string, Value>
  private readonly root: Env
  private steps = 0
  private startedAt = Date.now()
  private paused = 0
  private lastYield = Date.now()
  private budget: number
  private extended = false
  private depth = 0
  /** value of the last top-level expression statement (a query's result) */
  last: Value = null

  constructor(opts: InterpOptions = {}) {
    this.opts = opts
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits }
    this.budget = this.limits.ms
    this.lang = opts.lang ?? 'en'
    this.globals = new Map(BUILTINS as Map<string, Value>)
    for (const [k, v] of Object.entries(opts.globals ?? {})) this.globals.set(normName(k), v)
    this.root = new Env(null)
  }

  /** Run a program: resolves with the value of its last top-level expression. */
  async run(program: Program): Promise<Value> {
    this.startedAt = Date.now()
    this.last = null
    try {
      await this.execBody(program.body, this.root, true)
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value
      if (e instanceof BreakSignal || e instanceof ContinueSignal) throw new ScriptError('break_outside', {}, e.pos)
      throw e
    }
    return this.last
  }

  /** Evaluate one expression in the program's top scope (after run: its variables are there). */
  async evaluate(expr: Expr): Promise<Value> {
    return this.eval(expr, this.root)
  }

  /** A native's context at the top scope (the runtime evaluates results with it). */
  contextFor(name: string, pos: Pos = { start: 0, end: 0, line: 1, col: 1 }): CallCtx {
    return this.ctx(name, pos, this.root)
  }

  /** Time used so far (ms, waiting for the person excluded). */
  elapsed(): number {
    return Date.now() - this.startedAt - this.paused
  }

  get stepCount(): number {
    return this.steps
  }

  /* ---------------------------------------------------------------- budget */

  private async tick(pos: Pos | null): Promise<void> {
    if (this.opts.signal?.aborted) throw new ScriptError('stopped', {}, pos)
    if (++this.steps > this.limits.steps) throw new ScriptError('steps', { max: this.limits.steps }, pos)
    if ((this.steps & 127) !== 0) return
    // let the page breathe (Stop, repaint) and look at the clock
    if (Date.now() - this.lastYield > YIELD_MS) {
      await macrotask()
      this.lastYield = Date.now()
      if (this.opts.signal?.aborted) throw new ScriptError('stopped', {}, pos)
    }
    if (this.elapsed() > this.budget) {
      if (!this.extended && this.opts.onTimeout) {
        this.extended = true
        const t0 = Date.now()
        const more = await this.opts.onTimeout()
        this.paused += Date.now() - t0
        if (this.opts.signal?.aborted) throw new ScriptError('stopped', {}, pos)
        if (more) {
          this.budget += this.limits.ms
          return
        }
      }
      throw new ScriptError('timeout', { seconds: Math.round(this.budget / 1000) }, pos)
    }
  }

  private async waitUser<T>(p: Promise<T>): Promise<T> {
    const t0 = Date.now()
    try {
      return await p
    } finally {
      this.paused += Date.now() - t0
    }
  }

  /* ---------------------------------------------------------------- statements */

  private async execBody(body: Stmt[], env: Env, top = false): Promise<void> {
    // functions are known in their whole block (a helper may be written below its use)
    for (const s of body) if (s.type === 'FnDecl') env.vars.set(s.name, new Closure(s.name, s.params, s.body, env))
    for (const s of body) await this.exec(s, env, top)
  }

  private async block(b: Block, env: Env): Promise<void> {
    await this.execBody(b.body, new Env(env))
  }

  private async exec(s: Stmt, env: Env, top = false): Promise<void> {
    await this.tick(s.pos)
    switch (s.type) {
      case 'Let':
        env.vars.set(s.name, await this.eval(s.value, env))
        return
      case 'Assign':
        return this.assign(s.target, await this.eval(s.value, env), env)
      case 'ExprStmt': {
        const v = await this.eval(s.expr, env)
        if (top) this.last = v
        return
      }
      case 'If': {
        if (truthy(await this.eval(s.test, env))) return this.block(s.then, env)
        if (s.else?.type === 'If') return this.exec(s.else, env)
        if (s.else) return this.block(s.else, env)
        return
      }
      case 'While':
        while (truthy(await this.eval(s.test, env))) {
          try {
            await this.block(s.body, env)
          } catch (e) {
            if (e instanceof BreakSignal) break
            if (e instanceof ContinueSignal) continue
            throw e
          }
        }
        return
      case 'For': {
        const iter = await this.eval(s.iter, env)
        const items = await this.iterate(iter, s.iter.pos)
        for (const [k, v] of items) {
          const inner = new Env(env)
          inner.vars.set(s.name, v)
          if (s.key) inner.vars.set(s.key, k)
          try {
            await this.execBody(s.body.body, inner)
          } catch (e) {
            if (e instanceof BreakSignal) break
            if (e instanceof ContinueSignal) continue
            throw e
          }
        }
        return
      }
      case 'Return':
        throw new ReturnSignal(s.value ? await this.eval(s.value, env) : null)
      case 'Break':
        throw new BreakSignal(s.pos)
      case 'Continue':
        throw new ContinueSignal(s.pos)
      case 'FnDecl':
        // defined when its block started (execBody)
        return
    }
  }

  private async iterate(v: Value, pos: Pos): Promise<Array<[Value, Value]>> {
    if (Array.isArray(v)) return v.map((x, i) => [i, x])
    if (v instanceof SRecord) return [...v.fields].map(([k, x]) => [k, x] as [Value, Value])
    if (typeof v === 'string') return [...v].map((c, i) => [i, c])
    if (v instanceof HostObject && v.iterate) return (await v.iterate(this.ctx('for', pos, this.root))).map((x, i) => [i, x])
    throw new ScriptError('bad_type', { op: 'for … in', left: typeName(v), right: '' }, pos)
  }

  private async assign(target: Expr, value: Value, env: Env): Promise<void> {
    if (target.type === 'Ident') {
      for (let e: Env | null = env; e; e = e.parent) {
        if (e.vars.has(target.name)) {
          e.vars.set(target.name, value)
          return
        }
      }
      env.vars.set(target.name, value)
      return
    }
    if (target.type === 'Member') {
      const obj = await this.eval(target.object, env)
      if (obj instanceof SRecord) {
        obj.fields.set(target.name, value)
        return
      }
      if (obj instanceof HostObject && obj.setMember) return obj.setMember(target.name, value, this.ctx(target.name, target.pos, env))
      throw new ScriptError('bad_assign', {}, target.pos)
    }
    if (target.type === 'Index') {
      const obj = await this.eval(target.object, env)
      const idx = await this.eval(target.index, env)
      if (Array.isArray(obj) && typeof idx === 'number') {
        const i = idx < 0 ? obj.length + idx : idx
        if (!Number.isInteger(i) || i < 0 || i >= obj.length) throw new ScriptError('index', { index: idx, n: obj.length }, target.pos)
        obj[i] = value
        return
      }
      if (obj instanceof SRecord && typeof idx === 'string') {
        obj.fields.set(idx, value)
        return
      }
      if (obj instanceof HostObject && obj.setMember && typeof idx === 'string') return obj.setMember(idx, value, this.ctx(idx, target.pos, env))
    }
    throw new ScriptError('bad_assign', {}, target.pos)
  }

  /* ---------------------------------------------------------------- expressions */

  private async lookup(name: string, env: Env, pos: Pos): Promise<Value> {
    for (let e: Env | null = env; e; e = e.parent) {
      if (e.vars.has(name)) return e.vars.get(name)!
      if (e.scope) {
        const v = await e.scope(name)
        if (v !== undefined) return v
      }
    }
    const g = this.globals.get(normName(name))
    if (g !== undefined) return g
    const f = this.opts.fallback?.(name)
    if (f !== undefined) return f
    // inside where / sort / select: the item says what is missing (a row: its database has no such property)
    for (let e: Env | null = env; e; e = e.parent) {
      const err = e.miss?.(name)
      if (err) throw err.at(pos)
    }
    throw new ScriptError('unknown_name', { name }, pos)
  }

  private async eval(e: Expr, env: Env): Promise<Value> {
    await this.tick(e.pos)
    switch (e.type) {
      case 'Num':
        return e.value
      case 'Dur':
        return new SDuration(e.days, e.ms)
      case 'Bool':
        return e.value
      case 'Null':
        return null
      case 'Str': {
        let out = ''
        for (const p of e.parts) {
          out += typeof p === 'string' ? p : toText(await this.eval(p, env))
          if (out.length > this.limits.text) throw new ScriptError('too_big', { what: 'text', max: this.limits.text }, e.pos)
        }
        return out
      }
      case 'Ident':
        return this.lookup(e.name, env, e.pos)
      case 'Ref': {
        if (!this.opts.resolveRef) throw new ScriptError('not_found', { what: 'reference', name: e.label }, e.pos)
        try {
          return await this.opts.resolveRef({ kind: e.kind, id: e.id, label: e.label }, this.ctx('@', e.pos, env))
        } catch (err) {
          throw err instanceof ScriptError ? err.at(e.pos) : err
        }
      }
      case 'List': {
        const out: Value[] = []
        for (const it of e.items) out.push(await this.eval(it, env))
        if (out.length > this.limits.list) throw new ScriptError('too_big', { what: 'list', max: this.limits.list }, e.pos)
        return out
      }
      case 'Record': {
        const r = new SRecord()
        for (const en of e.entries) r.fields.set(en.key, await this.eval(en.value, env))
        return r
      }
      case 'Unary': {
        const v = await this.eval(e.arg, env)
        if (e.op === 'not') return !truthy(v)
        if (typeof v === 'number') return -v
        if (v instanceof SDuration) return new SDuration(-v.days, -v.ms)
        throw new ScriptError('bad_type', { op: '-', left: typeName(v), right: '' }, e.pos)
      }
      case 'Logical': {
        const l = await this.eval(e.left, env)
        if (e.op === 'and') return truthy(l) ? this.eval(e.right, env) : l
        return truthy(l) ? l : this.eval(e.right, env)
      }
      case 'Binary':
        return this.binary(e.op, await this.eval(e.left, env), await this.eval(e.right, env), e.pos)
      case 'Member': {
        const obj = await this.eval(e.object, env)
        return this.member(obj, e.name, e.namePos, env)
      }
      case 'Index': {
        const obj = await this.eval(e.object, env)
        const idx = await this.eval(e.index, env)
        return this.index(obj, idx, e.pos, env)
      }
      case 'Lambda':
        return new Closure(e.name, e.params, e.body, env)
      case 'Call':
        return this.callExpr(e, env)
    }
  }

  private async member(obj: Value, name: string, pos: Pos, env: Env): Promise<Value> {
    if (obj instanceof HostObject) {
      const v = await obj.member(name, this.ctx(name, pos, env))
      if (v !== undefined) return v
      throw new ScriptError('no_member', { type: obj.typeName, name }, pos)
    }
    if (isNative(obj) && obj.members) {
      const own = (k: string) => (Object.prototype.hasOwnProperty.call(obj.members, k) ? obj.members![k] : undefined)
      const m = own(name) ?? own(normName(name))
      if (m) return m()
    }
    if (obj === null) throw new ScriptError('no_member', { type: 'null', name }, pos)
    const p = builtinProp(obj, name)
    if (p !== undefined) return p
    const fn = builtinMethod(obj, name)
    if (fn) return fn
    // a record without that field: nothing
    if (obj instanceof SRecord) return null
    throw new ScriptError('no_member', { type: typeName(obj), name }, pos)
  }

  private async index(obj: Value, idx: Value, pos: Pos, env: Env): Promise<Value> {
    if ((Array.isArray(obj) || typeof obj === 'string') && typeof idx === 'number') {
      const items = Array.isArray(obj) ? obj : [...obj]
      const i = idx < 0 ? items.length + idx : idx
      if (!Number.isInteger(i) || i < 0 || i >= items.length) throw new ScriptError('index', { index: idx, n: items.length }, pos)
      return items[i]
    }
    if (typeof idx === 'string') return this.member(obj, idx, pos, env)
    throw new ScriptError('bad_type', { op: '[ ]', left: typeName(obj), right: typeName(idx) }, pos)
  }

  private binary(op: string, l: Value, r: Value, pos: Pos): Value {
    switch (op) {
      case '=':
      case '==':
        return equals(l, r)
      case '!=':
        return !equals(l, r)
      case '<': {
        const c = compare(l, r, op, pos)
        return c !== null && c < 0
      }
      case '<=': {
        const c = compare(l, r, op, pos)
        return c !== null && c <= 0
      }
      case '>': {
        const c = compare(l, r, op, pos)
        return c !== null && c > 0
      }
      case '>=': {
        const c = compare(l, r, op, pos)
        return c !== null && c >= 0
      }
      case 'in': {
        if (Array.isArray(r)) return r.some((x) => matches(x, l))
        if (typeof r === 'string') return typeof l === 'string' && r.toLowerCase().includes(l.toLowerCase())
        if (r instanceof SRecord) return typeof l === 'string' && r.fields.has(l)
        if (r === null) return false
        throw new ScriptError('bad_type', { op, left: typeName(l), right: typeName(r) }, pos)
      }
      case '+': {
        if (typeof l === 'number' && typeof r === 'number') return l + r
        if (typeof l === 'string' || typeof r === 'string') {
          const s = toText(l) + toText(r)
          if (s.length > this.limits.text) throw new ScriptError('too_big', { what: 'text', max: this.limits.text }, pos)
          return s
        }
        if (Array.isArray(l) && Array.isArray(r)) {
          if (l.length + r.length > this.limits.list) throw new ScriptError('too_big', { what: 'list', max: this.limits.list }, pos)
          return [...l, ...r]
        }
        if (l instanceof SDate && r instanceof SDuration) return addDuration(l, r)
        if (l instanceof SDuration && r instanceof SDate) return addDuration(r, l)
        if (l instanceof SDuration && r instanceof SDuration) return new SDuration(l.days + r.days, l.ms + r.ms)
        break
      }
      case '-': {
        if (typeof l === 'number' && typeof r === 'number') return l - r
        if (l instanceof SDate && r instanceof SDuration) return addDuration(l, r, -1)
        if (l instanceof SDate && r instanceof SDate) {
          if (!l.time && !r.time) return new SDuration(differenceInCalendarDays(l.date, r.date), 0)
          return new SDuration(0, l.t - r.t)
        }
        if (l instanceof SDuration && r instanceof SDuration) return new SDuration(l.days - r.days, l.ms - r.ms)
        break
      }
      case '*': {
        if (typeof l === 'number' && typeof r === 'number') return l * r
        if (l instanceof SDuration && typeof r === 'number') return new SDuration(l.days * r, l.ms * r)
        if (typeof l === 'number' && r instanceof SDuration) return new SDuration(r.days * l, r.ms * l)
        break
      }
      case '/': {
        if (typeof l === 'number' && typeof r === 'number') {
          if (r === 0) throw new ScriptError('div_zero', {}, pos)
          return l / r
        }
        if (l instanceof SDuration && typeof r === 'number') {
          if (r === 0) throw new ScriptError('div_zero', {}, pos)
          return new SDuration(0, l.total / r)
        }
        if (l instanceof SDuration && r instanceof SDuration) {
          if (r.total === 0) throw new ScriptError('div_zero', {}, pos)
          return l.total / r.total
        }
        break
      }
      case '%': {
        if (typeof l === 'number' && typeof r === 'number') {
          if (r === 0) throw new ScriptError('div_zero', {}, pos)
          return l % r
        }
        break
      }
    }
    throw new ScriptError('bad_type', { op, left: typeName(l), right: typeName(r) }, pos)
  }

  /* ---------------------------------------------------------------- calls */

  private async callExpr(e: Extract<Expr, { type: 'Call' }>, env: Env): Promise<Value> {
    let fn: Value
    let label: string
    if (e.callee.type === 'Member') {
      const obj = await this.eval(e.callee.object, env)
      const name = e.callee.name
      label = name
      // a record's own field wins over the built-in methods (a function kept in a record)
      const field = obj instanceof SRecord && obj.fields.has(name)
      const method = field ? null : obj instanceof HostObject ? obj.method?.(name) : obj !== null && !isCallable(obj) ? builtinMethod(obj, name) : null
      if (method) fn = method
      else {
        fn = await this.member(obj, name, e.callee.namePos, env)
        // `.count()` for the property `.count`: the value itself
        if (!isCallable(fn) && e.args.length === 0) return fn
      }
    } else {
      fn = await this.eval(e.callee, env)
      label = e.callee.type === 'Ident' ? e.callee.name : 'value'
    }
    if (!isCallable(fn)) throw new ScriptError('not_callable', { name: label }, e.callee.pos)
    const lazy = isNative(fn) && !!fn.lazy
    const args = await this.args(e.args, env, lazy)
    return this.invoke(fn, args, label, e.pos, env)
  }

  private async args(list: Arg[], env: Env, lazy: boolean): Promise<Args> {
    const out: Args = { pos: [], named: new Map(), thunks: [], namedThunks: new Map() }
    for (const a of list) {
      if (lazy) {
        const th: Thunk = { node: a.value, order: a.order, text: this.sourceOf(a.value), env }
        if (a.name) out.namedThunks.set(a.name, th)
        else out.thunks.push(th)
      } else {
        const v = await this.eval(a.value, env)
        if (a.name) out.named.set(a.name, v)
        else out.pos.push(v)
      }
    }
    return out
  }

  private source = ''
  /** The source text the program came from (select column names). */
  setSource(src: string): void {
    this.source = src
  }
  private sourceOf(e: Expr): string {
    return this.source.slice(e.pos.start, e.pos.end)
  }

  private async invoke(fn: Closure | NativeFn, args: Args, label: string, pos: Pos, env: Env): Promise<Value> {
    if (isNative(fn)) {
      try {
        return await fn.call(args, this.ctx(label, pos, env))
      } catch (err) {
        if (err instanceof ScriptError) throw err.at(pos)
        if (err instanceof ReturnSignal || err instanceof BreakSignal || err instanceof ContinueSignal) throw err
        throw new ScriptError('internal', { detail: String((err as Error)?.message ?? err) }, pos)
      }
    }
    return this.callClosure(fn, args.pos, args.named, pos)
  }

  private async callClosure(fn: Closure, pos: Value[], named: Map<string, Value>, at: Pos): Promise<Value> {
    if (this.depth >= this.limits.depth) throw new ScriptError('depth', { max: this.limits.depth }, at)
    const env = new Env(fn.env as Env)
    if (pos.length > fn.params.length) throw new ScriptError('bad_args', { name: fn.name ?? 'fn', detail: `takes ${fn.params.length} argument(s), got ${pos.length}` }, at)
    for (const [k] of named) if (!fn.params.some((p) => p.name === k)) throw new ScriptError('bad_args', { name: fn.name ?? 'fn', detail: `has no parameter ${k}` }, at)
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i]
      let v: Value
      if (i < pos.length) v = pos[i]
      else if (named.has(p.name)) v = named.get(p.name)!
      else v = p.def ? await this.eval(p.def, env) : null
      env.vars.set(p.name, v)
    }
    this.depth++
    try {
      if (fn.body.type === 'Block') {
        try {
          await this.execBody(fn.body.body, env)
        } catch (e) {
          if (e instanceof ReturnSignal) return e.value
          if (e instanceof BreakSignal || e instanceof ContinueSignal) throw new ScriptError('break_outside', {}, e.pos)
          throw e
        }
        return null
      }
      return await this.eval(fn.body, env)
    } finally {
      this.depth--
    }
  }

  /** Call any function value with positional arguments (natives get them evaluated). */
  async callValue(fn: Value, args: Value[], pos: Pos, env: Env = this.root): Promise<Value> {
    if (!isCallable(fn)) throw new ScriptError('not_callable', { name: 'value' }, pos)
    if (fn instanceof Closure) return this.callClosure(fn, args, new Map(), pos)
    return this.invoke(fn, { pos: args, named: new Map(), thunks: [], namedThunks: new Map() }, fn.name, pos, env)
  }

  /** Names of an item inside where / sort / select. */
  private itemScope(item: Value, ctx: CallCtx): ((name: string) => Value | undefined | Promise<Value | undefined>) | null {
    if (item instanceof SRecord)
      return (name) => {
        if (item.fields.has(name)) return item.fields.get(name)!
        for (const [k, v] of item.fields) if (k.toLowerCase() === name.toLowerCase()) return v
        return undefined
      }
    if (item instanceof HostObject) return (name) => item.scope(name, ctx)
    return null
  }

  private ctx(name: string, pos: Pos, env: Env): CallCtx {
    const ctx: CallCtx = {
      name,
      pos,
      signal: this.opts.signal ?? null,
      lang: this.lang,
      host: this.opts.host,
      limits: { list: this.limits.list, text: this.limits.text },
      eval: (th) => this.eval(th.node, th.env as Env),
      evalFor: async (th, item) => {
        const inner = new Env(th.env as Env, this.itemScope(item, ctx), item instanceof HostObject && item.unknownName ? (n) => item.unknownName!(n) : null)
        inner.vars.set('it', item)
        const v = await this.eval(th.node, inner)
        return isCallable(v) ? this.callValue(v, [item], th.node.pos, inner) : v
      },
      call: (fn, args) => this.callValue(fn, args, pos, env),
      step: () => this.tick(pos),
      waitUser: (p) => this.waitUser(p),
      print: (values, kind) => this.opts.onPrint?.(values, kind, ctx),
    }
    return ctx
  }
}

