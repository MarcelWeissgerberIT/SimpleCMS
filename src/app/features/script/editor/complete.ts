/**
 * One Script editor — what to offer at the caret, without running anything (pure: tokens in, a context
 * and candidates out; the workspace comes in through WsInfo).
 *
 *  - Type inference over the tokens: `db(@X)` is a query of X, `.where(…)` / `.sort(…)` keep it one,
 *    `.rows` are its rows, `.first` one row; `let a = …` carries the type, `for t in <rows of X>` makes
 *    t a row of X, a lambda / `it` inside `.where(…)` / `.map(…)` is one item; texts, numbers, dates,
 *    lists, records (with their fields), groups.
 *  - Contexts: @ references · members after "." (only what the value has; a row's properties first) ·
 *    names (variables, functions, keywords, snippets; inside where / sort / select … the database's
 *    properties; at the start of an argument of set / add `Property: `, of mail.send `to: ` …) ·
 *    values after `Status = ` / `Status != ` / `set(Status: ` (options as texts, true / false, date
 *    presets, people, related titles), also inside a text that is being typed there.
 *  - Signature help (the call around the caret, the argument at it) and the doc of the name at a place.
 */
import { KEYWORDS, type RefValue, type Token } from '../lang'
import { GLOBAL_FUNCTIONS, MEMBERS, memberDocKeys, type FnInfo, type MemberKind, type Ret } from '../catalog'
import type { Analysis } from './analyze'
import { SNIPPETS } from './snippets'
import { NO_WS, T, dbOf, elemOf, memberKindOf, propByName, propTy, type DbRef, type PropInfo, type Ty, type WsInfo } from './types'

const INF = Number.MAX_SAFE_INTEGER
const norm = (s: string) => s.toLowerCase().replace(/_/g, '')
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c)
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u
/** A property name as code: bare when it can be, else in backticks. */
export const nameCode = (n: string) => (IDENT.test(n) && !KEYWORDS.has(n) ? n : `\`${n.replace(/`/g, '')}\``)
/** A text literal for a value (double quotes unless it holds `{` or `"`). */
export const textCode = (s: string) => (/[{"\\]/.test(s) ? `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : `"${s}"`)

const CMP = new Set(['=', '==', '!=', '<', '<=', '>', '>='])
const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])
const BASE_RET = new Set<Ret>(['page', 'person', 'text', 'number', 'bool', 'date', 'duration'])

/* ------------------------------------------------------------------ tokens without comments, brackets matched */

interface View {
  toks: Token[]
  /** the partner of each bracket (-1: none) */
  match: Int32Array
}

const views = new WeakMap<Analysis, View>()

function viewOf(a: Analysis): View {
  const hit = views.get(a)
  if (hit) return hit
  const toks = a.tokens.filter((t) => t.type !== 'comment')
  const match = new Int32Array(toks.length).fill(-1)
  const stack: number[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'op') continue
    if (OPENERS.has(t.text)) stack.push(i)
    else if (CLOSERS.has(t.text)) {
      const want = t.text === ')' ? '(' : t.text === ']' ? '[' : '{'
      for (let s = stack.length - 1; s >= 0; s--) {
        if (toks[stack[s]].text !== want) continue
        match[stack[s]] = i
        match[i] = stack[s]
        stack.length = s
        break
      }
    }
  }
  const v = { toks, match }
  views.set(a, v)
  return v
}

/** The index of the first token that starts at or after `offset`. */
function indexAt(v: View, offset: number): number {
  let lo = 0
  let hi = v.toks.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (v.toks[mid].pos.start < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/* ------------------------------------------------------------------ inference */

interface Binding {
  name: string
  ty: Ty | null
  /** visible for token indexes [from, to) */
  from: number
  to: number
}

/** An open call around a place: what is called and what one item of it is. */
export interface Frame {
  open: number
  close: number
  callee: string | null
  member: boolean
  spec: FnInfo | null
  /** the receiver's kind (members) */
  kind: MemberKind | null
  recv: Ty | null
  /** where / sort / map …: one item (a row of X, a record …) */
  item: Ty | null
}

interface Arg {
  name: string | null
  s: number
  e: number
}

class Engine {
  readonly binds: Binding[] = []
  private scanned = -1
  private frames: Frame[] = []

  constructor(
    readonly v: View,
    readonly ws: WsInfo,
  ) {}

  private isOp(k: number, text: string): boolean {
    const t = this.v.toks[k]
    return !!t && t.type === 'op' && t.text === text
  }

  lookup(name: string, at: number): Binding | undefined {
    for (let i = this.binds.length - 1; i >= 0; i--) {
      const b = this.binds[i]
      if (b.name === name && b.from <= at && at < b.to) return b
    }
    return undefined
  }

  /** Variables visible at token index `at` (the latest of each name). */
  visible(at: number): Array<[string, Ty | null]> {
    const seen = new Map<string, Ty | null>()
    for (let i = this.binds.length - 1; i >= 0; i--) {
      const b = this.binds[i]
      if (b.from <= at && at < b.to && !seen.has(b.name)) seen.set(b.name, b.ty)
    }
    return [...seen]
  }

  /* -------------------------------------------------------------- structure */

  /** The end (exclusive) of the statement starting at `i`: a newline / `}` at its depth. */
  stmtEnd(i: number): number {
    const { toks, match } = this.v
    for (let k = i; k < toks.length; k++) {
      const t = toks[k]
      if (t.type === 'nl' && this.isOp(k + 1, '.')) continue
      if (t.type === 'nl' || t.type === 'eof') return k
      if (t.type === 'op' && OPENERS.has(t.text)) {
        if (match[k] < 0) return toks.length - 1
        k = match[k]
        continue
      }
      if (t.type === 'op' && CLOSERS.has(t.text)) return k
    }
    return toks.length - 1
  }

  /** The `{` of a body after `i` (for … in <iter> {), -1 when there is none on the line. */
  private bodyBrace(i: number): number {
    const { toks, match } = this.v
    for (let k = i; k < toks.length; k++) {
      const t = toks[k]
      if (t.type === 'nl' && this.isOp(k + 1, '.')) continue
      if (t.type === 'nl' || t.type === 'eof') return -1
      if (t.type === 'op' && t.text === '{') {
        // a record right after `in` is the iterated value; a `{` after something is the body
        if (k === i) {
          if (match[k] < 0) return -1
          k = match[k]
          continue
        }
        return k
      }
      if (t.type === 'op' && (t.text === '(' || t.text === '[')) {
        if (match[k] < 0) return -1
        k = match[k]
      }
    }
    return -1
  }

  /** Arguments of a call between its brackets: name (named argument) and value range. */
  args(open: number, close: number): Arg[] {
    const { toks, match } = this.v
    const out: Arg[] = []
    let s = open + 1
    const push = (e: number) => {
      if (e <= s) return
      if (toks[s]?.type === 'ident' && this.isOp(s + 1, ':')) out.push({ name: String(toks[s].value), s: s + 2, e })
      else out.push({ name: null, s, e })
    }
    for (let k = open + 1; k < close; k++) {
      const t = toks[k]
      if (t.type === 'op' && OPENERS.has(t.text)) {
        if (match[k] < 0 || match[k] > close) break
        k = match[k]
        continue
      }
      if (t.type === 'op' && t.text === ',') {
        push(k)
        s = k + 1
      }
    }
    push(close)
    return out
  }

  private paramNames(s: number, e: number): string[] {
    const out: string[] = []
    const { toks } = this.v
    for (let k = s; k < e; k++) {
      const t = toks[k]
      if (t.type === 'ident' && (this.isOp(k + 1, ',') || this.isOp(k + 1, ')') || this.isOp(k + 1, '=') || k + 1 === e)) out.push(String(t.value))
    }
    return out
  }

  /** The innermost bracket open around token k (its index), -1 at the top level. */
  enclosingOpen(k: number): number {
    const { toks, match } = this.v
    for (let i = k - 1; i >= 0; i--) {
      const t = toks[i]
      if (t.type !== 'op') continue
      if (CLOSERS.has(t.text)) {
        if (match[i] < 0) continue
        i = match[i]
      } else if (OPENERS.has(t.text)) return i
    }
    return -1
  }

  /** Where the argument holding token k ends inside frame f (a `,` or the frame's `)`). */
  private argEnd(k: number, f: Frame | undefined): number {
    if (!f) return this.stmtEnd(k)
    const { toks, match } = this.v
    const close = f.close < 0 ? INF : f.close
    for (let i = k; i < toks.length && i < close; i++) {
      const t = toks[i]
      if (t.type === 'op' && OPENERS.has(t.text)) {
        if (match[i] < 0) return INF
        i = match[i]
        continue
      }
      if (t.type === 'op' && t.text === ',' && this.enclosingOpen(i) === f.open) return i
    }
    return close
  }

  /* -------------------------------------------------------------- the pass */

  /**
   * Read the code up to token index `upTo` (exclusive): variables, loop variables, parameters, open calls.
   * Brackets closed before `upTo` are stepped over: what is declared inside them is not visible there.
   */
  scan(upTo: number): Frame[] {
    if (this.scanned === upTo) return this.frames
    this.binds.length = 0
    const { toks, match } = this.v
    const frames: Frame[] = []
    const braces: number[] = []
    const blockEnd = () => {
      const b = braces[braces.length - 1]
      return b === undefined || match[b] < 0 ? INF : match[b]
    }
    const bind = (name: string, ty: Ty | null, from: number, to: number) => this.binds.push({ name, ty, from, to })
    for (let k = 0; k < upTo && k < toks.length; k++) {
      const t = toks[k]
      if (t.type === 'op') {
        // a group that is closed before the place: nothing in it is visible there
        if (OPENERS.has(t.text) && match[k] >= 0 && match[k] < upTo && !this.isOp(match[k] + 1, '=>')) {
          k = match[k]
          continue
        }
        if (t.text === '{') braces.push(k)
        else if (t.text === '}') {
          if (braces.length && match[braces[braces.length - 1]] === k) braces.pop()
        } else if (t.text === '(') {
          const m = match[k]
          if (m >= 0 && this.isOp(m + 1, '=>')) {
            // (a, b) => …: the first parameter is the item of the call it is passed to
            const f = frames[frames.length - 1]
            const to = this.argEnd(m + 1, f)
            this.paramNames(k + 1, m).forEach((pn, i) => bind(pn, i === 0 ? (f?.item ?? null) : null, m + 2, to))
          }
          const frame = this.frameAt(k)
          frames.push(frame)
          if (frame.item) bind('it', frame.item, k + 1, frame.close < 0 ? INF : frame.close)
        } else if (t.text === ')') {
          const o = match[k]
          while (frames.length && frames[frames.length - 1].open !== o && frames[frames.length - 1].open > o) frames.pop()
          if (frames.length && frames[frames.length - 1].open === o) frames.pop()
        }
        continue
      }
      if (t.type === 'kw') {
        if (t.text === 'let' && toks[k + 1]?.type === 'ident' && this.isOp(k + 2, '=')) {
          const e = this.stmtEnd(k + 3)
          bind(String(toks[k + 1].value), this.exprType(k + 3, e), e, blockEnd())
        } else if (t.text === 'for') {
          let j = k + 1
          const names: string[] = []
          while (toks[j]?.type === 'ident' || this.isOp(j, ',')) {
            if (toks[j].type === 'ident') names.push(String(toks[j].value))
            j++
          }
          if (toks[j]?.type === 'kw' && toks[j].text === 'in' && names.length) {
            const b = this.bodyBrace(j + 1)
            const iterEnd = b < 0 ? this.stmtEnd(j + 1) : b
            const it = this.exprType(j + 1, iterEnd)
            const from = b < 0 ? iterEnd : b + 1
            const to = b < 0 || match[b] < 0 ? INF : match[b]
            if (names.length === 1) bind(names[0], elemOf(it), from, to)
            else {
              bind(names[0], it?.k === 'record' ? T.text : T.number, from, to)
              bind(names[1], it?.k === 'record' ? null : elemOf(it), from, to)
            }
          }
        } else if (t.text === 'fn') {
          let j = k + 1
          let name: string | null = null
          if (toks[j]?.type === 'ident') {
            name = String(toks[j].value)
            j++
          }
          if (this.isOp(j, '(')) {
            const pc = match[j]
            const body = pc >= 0 && this.isOp(pc + 1, '{') ? pc + 1 : -1
            const to = body < 0 || match[body] < 0 ? INF : match[body]
            if (name) bind(name, T.fn, k, blockEnd())
            const item = name ? null : (frames[frames.length - 1]?.item ?? null)
            this.paramNames(j + 1, pc < 0 ? Math.min(upTo, toks.length) : pc).forEach((pn, i) => bind(pn, i === 0 ? item : null, pc < 0 ? INF : pc + 1, to))
          }
        }
        continue
      }
      if (t.type === 'ident' && this.isOp(k + 1, '=>')) {
        // x => …
        const f = frames[frames.length - 1]
        bind(String(t.value), f?.item ?? null, k + 2, this.argEnd(k, f))
      }
    }
    this.frames = frames
    this.scanned = upTo
    return frames
  }

  /** What the call opened at `k` is. */
  private frameAt(k: number): Frame {
    const { toks, match } = this.v
    const base: Frame = { open: k, close: match[k], callee: null, member: false, spec: null, kind: null, recv: null, item: null }
    const prev = toks[k - 1]
    if (!prev || prev.type !== 'ident') return base
    const name = String(prev.value)
    if (this.isOp(k - 2, '.')) {
      const start = this.chainStart(k - 2)
      const recv = start < 0 ? null : this.chainType(start, k - 2)
      const kind = recv ? memberKindOf(recv) : null
      const spec = this.memberSpec(kind, name, !recv)
      const item = spec?.args === 'item' ? elemOf(recv) : null
      return { ...base, callee: name, member: true, spec, kind, recv, item }
    }
    if (this.lookup(name, k)) return { ...base, callee: name }
    const spec = GLOBAL_FUNCTIONS.find((g) => !g.prop && norm(g.name) === norm(name)) ?? null
    return { ...base, callee: name, spec }
  }

  /** A member by name for a kind of value (unknown kind: the first of the common kinds that has it). */
  memberSpec(kind: MemberKind | null, name: string, loose = false): FnInfo | null {
    const n = norm(name)
    if (kind) return MEMBERS[kind]?.find((f) => norm(f.name) === n) ?? null
    if (!loose) return null
    for (const k of ['query', 'row', 'list', 'text'] as const) {
      const hit = MEMBERS[k].find((f) => norm(f.name) === n)
      if (hit) return hit
    }
    return null
  }

  /* -------------------------------------------------------------- chains */

  /** Where the chain ending before token `end` starts (`db(@X).where(…)` · `t.Status` · `xs[0]`), -1: none. */
  chainStart(end: number): number {
    const { toks, match } = this.v
    let k = end - 1
    let start = -1
    // `db(@X)\n  .where(…)`: a line that starts with "." continues the one before
    const skipNl = () => {
      while (k >= 0 && toks[k].type === 'nl') k--
    }
    skipNl()
    while (k >= 0) {
      const t = toks[k]
      let unit: number
      if (t.type === 'op' && (t.text === ')' || t.text === ']')) {
        const o = match[k]
        if (o < 0) return start
        const before = toks[o - 1]
        if (t.text === ']' && before && (before.type === 'ident' || before.type === 'ref' || before.type === 'str' || (before.type === 'op' && (before.text === ')' || before.text === ']')))) {
          // an index: the value before it belongs to the chain
          k = o - 1
          continue
        }
        unit = t.text === ')' && before?.type === 'ident' ? o - 1 : o
      } else if (t.type === 'ident' || t.type === 'ref' || t.type === 'str' || t.type === 'num' || t.type === 'dur' || (t.type === 'kw' && (t.text === 'true' || t.text === 'false'))) unit = k
      else return start
      start = unit
      if (this.isOp(unit - 1, '.')) {
        k = unit - 2
        skipNl()
        continue
      }
      return start
    }
    return start
  }

  /** The type of an expression between token indexes [i, e). */
  exprType(i: number, e: number): Ty | null {
    const { toks, match } = this.v
    if (i >= e || !toks[i]) return null
    let cmp = false
    let logic = -1
    let mul = false
    const add: number[] = []
    let operand = false
    for (let k = i; k < e; k++) {
      const t = toks[k]
      if (t.type === 'nl') continue
      if (t.type === 'op' && OPENERS.has(t.text)) {
        operand = true
        if (match[k] < 0 || match[k] >= e) break
        k = match[k]
        continue
      }
      if (t.type === 'kw' && (t.text === 'and' || t.text === 'or')) {
        if (logic < 0) logic = k
        operand = false
        continue
      }
      if (t.type === 'kw' && (t.text === 'not' || t.text === 'in')) {
        if (t.text === 'in' || k === i) cmp = true
        operand = false
        continue
      }
      if (t.type === 'op') {
        if (t.text === '=>') return T.fn
        if (CMP.has(t.text)) cmp = true
        else if ((t.text === '+' || t.text === '-') && operand) add.push(k)
        else if (t.text === '*' || t.text === '/' || t.text === '%') mul = true
        if (t.text !== '.') operand = false
        continue
      }
      operand = true
    }
    if (cmp) return T.bool
    if (logic >= 0) return this.exprType(i, logic) ?? this.exprType(logic + 1, e)
    if (mul) return T.number
    if (add.length) {
      const left = this.exprType(i, add[0])
      if (left && ['date', 'text', 'list', 'number', 'duration'].includes(left.k)) return left
      const right = this.exprType(add[0] + 1, add[1] ?? e)
      return right?.k === 'text' ? T.text : (left ?? right)
    }
    if (this.isOp(i, '-')) return this.exprType(i + 1, e)
    return this.chainType(i, e)
  }

  /** The type of a chain [i, e): a value, then .member / .method(…) / [index] steps. */
  chainType(i: number, e: number): Ty | null {
    const { toks, match } = this.v
    const t = toks[i]
    if (!t || i >= e) return null
    let k = i
    let ty: Ty | null = null
    switch (t.type) {
      case 'num':
        ty = T.number
        k++
        break
      case 'dur':
        ty = T.duration
        k++
        break
      case 'str':
        ty = T.text
        k++
        break
      case 'ref':
        ty = this.refTy(t.value as RefValue)
        k++
        break
      case 'kw':
        if (t.text === 'true' || t.text === 'false') {
          ty = T.bool
          k++
          break
        }
        return t.text === 'fn' ? T.fn : null
      case 'ident': {
        const name = String(t.value)
        if (this.isOp(k + 1, '(')) {
          const close = match[k + 1]
          const end = close < 0 || close >= e ? e : close
          ty = this.callTy(name, k + 1, end, i)
          if (end === e) return ty
          k = close + 1
        } else {
          const b = this.lookup(name, i)
          ty = b ? b.ty : t.quoted ? null : this.globalValue(name)
          k++
        }
        break
      }
      case 'op': {
        const m = match[k]
        if (t.text === '(') {
          if (m < 0 || m >= e) return this.exprType(k + 1, e)
          ty = this.exprType(k + 1, m)
        } else if (t.text === '[') {
          if (m < 0 || m >= e) return T.list(null)
          const first = this.args(k, m)[0]
          ty = T.list(first ? this.exprType(first.s, first.e) : null)
        } else if (t.text === '{') {
          if (m < 0 || m >= e) return T.record(null)
          ty = T.record(this.args(k, m).map((a) => [a.name ?? '', this.exprType(a.s, a.e)] as [string, Ty | null]).filter(([n]) => !!n))
        } else return null
        k = m + 1
        break
      }
      default:
        return null
    }
    while (k < e) {
      const s = toks[k]
      if (s.type === 'nl' && this.isOp(k + 1, '.')) {
        k++
        continue
      }
      if (s.type !== 'op') break
      if (s.text === '.') {
        const nm = toks[k + 1]
        if (!nm || k + 1 >= e || (nm.type !== 'ident' && nm.type !== 'kw')) return ty
        const name = String(nm.value ?? nm.text)
        if (this.isOp(k + 2, '(') && k + 2 < e) {
          const close = match[k + 2]
          const end = close < 0 || close >= e ? e : close
          ty = this.memberCallTy(ty, name, k + 2, end)
          if (end === e) return ty
          k = close + 1
        } else {
          ty = this.memberTy(ty, name)
          k += 2
        }
        continue
      }
      if (s.text === '[') {
        const m = match[k]
        const idx = toks[k + 1]
        if (idx?.type === 'num') ty = ty?.k === 'text' ? T.text : elemOf(ty)
        else if (idx?.type === 'str') ty = this.memberTy(ty, (idx.value as unknown[]).filter((x) => typeof x === 'string').join(''))
        else ty = null
        if (m < 0 || m >= e) return ty
        k = m + 1
        continue
      }
      if (s.text === '(') {
        const m = match[k]
        ty = null
        if (m < 0 || m >= e) return ty
        k = m + 1
        continue
      }
      break
    }
    return ty
  }

  private refTy(v: RefValue): Ty | null {
    if (v.kind === 'u') return T.person
    if (v.kind === 'a') return T.agent
    if (v.kind === 's') return T.script
    if (v.kind === 'p' && v.id) {
      const r = this.ws.ref(v.id)
      if (r?.kind === 'database') return T.db({ id: v.id, name: v.label })
      if (r?.kind === 'row') return T.row({ id: r.dbId, name: null })
      return T.page
    }
    const d = this.ws.db(null, v.label)
    return d ? T.db({ id: d.id, name: d.name }) : T.page
  }

  /** A global name used as a value (no call). */
  private globalValue(name: string): Ty | null {
    const n = norm(name)
    if (n === 'mail' || n === 'create' || n === 'http') return { k: 'ns', name: n }
    if (n === 'page') return { k: 'ns', name: 'pagefn' }
    return GLOBAL_FUNCTIONS.some((g) => norm(g.name) === n) ? T.fn : null
  }

  private callTy(name: string, open: number, close: number, at: number): Ty | null {
    if (this.lookup(name, at)) return null
    const f = GLOBAL_FUNCTIONS.find((g) => !g.prop && norm(g.name) === norm(name))
    if (!f?.ret) return null
    const args = this.args(open, close)
    const typeOf = (a: Arg | undefined) => (a ? this.exprType(a.s, a.e) : null)
    switch (f.ret) {
      case 'db': {
        const a = args[0]
        const t = a ? this.v.toks[a.s] : null
        if (t?.type === 'ref') {
          const r = t.value as RefValue
          return T.db({ id: r.kind === 'p' ? r.id : null, name: r.label })
        }
        if (t?.type === 'str') return T.db({ id: null, name: (t.value as unknown[]).filter((x) => typeof x === 'string').join('') })
        const ty = typeOf(a)
        return ty?.k === 'db' ? ty : T.db({ id: null, name: null })
      }
      case 'elem1':
        return elemOf(typeOf(args[0]))
      case 'elem2':
        return elemOf(typeOf(args[1]))
      case 'same1':
        return typeOf(args[0])
      default:
        return this.retTy(f.ret, null, args)
    }
  }

  /** A property of a database the code names. */
  prop(db: { id: string | null; name: string | null } | null, name: string): PropInfo | undefined {
    if (!db) return undefined
    const info = this.ws.db(db.id, db.name)
    return info ? propByName(info, name) : undefined
  }

  memberTy(recv: Ty | null, name: string): Ty | null {
    if (!recv) return null
    if (recv.k === 'row') {
      const p = this.prop(recv.db, name)
      if (p) return propTy(p)
    }
    if (recv.k === 'record' && recv.fields) {
      const f = recv.fields.find(([n]) => n === name) ?? recv.fields.find(([n]) => n.toLowerCase() === name.toLowerCase())
      if (f) return f[1]
    }
    if (recv.k === 'group') {
      const n = norm(name)
      if (n === 'rows') return T.list(recv.of)
      if (n === 'count') return T.number
      return null
    }
    const spec = this.memberSpec(memberKindOf(recv), name)
    return spec?.ret ? this.retTy(spec.ret, recv, null) : null
  }

  private memberCallTy(recv: Ty | null, name: string, open: number, close: number): Ty | null {
    if (!recv) return null
    const spec = this.memberSpec(memberKindOf(recv), name)
    return spec?.ret ? this.retTy(spec.ret, recv, this.args(open, close)) : null
  }

  retTy(ret: Ret, recv: Ty | null, args: Arg[] | null): Ty | null {
    switch (ret) {
      case 'self':
        return recv?.k === 'db' ? T.db(recv.db, true) : recv
      case 'rows':
        return recv?.k === 'db' ? T.list(T.row(recv.db)) : T.list(null)
      case 'row':
        return recv?.k === 'db' ? T.row(recv.db) : null
      case 'elem':
        return elemOf(recv)
      case 'db':
        return recv?.k === 'row' ? T.db(recv.db) : null
      case 'records':
        return T.list(T.record(args ? this.selectFields(recv, args) : null))
      case 'groups':
        return T.list({ k: 'group', of: elemOf(recv) })
      case 'propval': {
        const it = elemOf(recv)
        const a = args?.[0]
        const tk = a ? this.v.toks[a.s] : null
        if (it?.k === 'row' && tk?.type === 'ident' && a!.e === a!.s + 1) {
          const p = this.prop(it.db, String(tk.value))
          return p ? propTy(p) : null
        }
        return null
      }
      case 'list':
        return T.list(null)
      case 'texts':
        return T.list(T.text)
      case 'people':
        return T.list(T.person)
      case 'pages':
        return T.list(T.page)
      case 'record':
        return T.record(null)
      default:
        return BASE_RET.has(ret) ? ({ k: ret } as Ty) : null
    }
  }

  /** The fields of select(…)'s records: plain names keep their property's type. */
  private selectFields(recv: Ty | null, args: Arg[]): Array<[string, Ty | null]> {
    const it = elemOf(recv)
    const { toks } = this.v
    return args.map((a): [string, Ty | null] => {
      if (a.name) return [a.name, this.exprType(a.s, a.e)]
      const tk = toks[a.s]
      if (tk?.type === 'ident' && a.e === a.s + 1) {
        const name = String(tk.value)
        return [name, it?.k === 'row' ? (this.memberTy(it, name) ?? null) : it?.k === 'record' ? this.memberTy(it, name) : null]
      }
      if (this.isOp(a.s + 1, '.') && toks[a.s + 2] && a.e === a.s + 3) return [String(toks[a.s + 2].value ?? toks[a.s + 2].text), null]
      return [toks.slice(a.s, a.e).map((x) => x.text).join(''), null]
    })
  }
}

/* ------------------------------------------------------------------ contexts */

export type CompletionContext =
  | { kind: 'ref'; from: number; to: number; query: string }
  | { kind: 'member'; from: number; to: number; prefix: string; ty: Ty | null; on: MemberKind | null; dbId: string | null; dbName: string | null }
  | {
      kind: 'name'
      from: number
      to: number
      prefix: string
      /** inside where / sort / select …: the database whose properties are plain names */
      propsOf: { dbId: string | null; dbName: string | null } | null
      /** …or the fields of the records */
      fields: string[] | null
      /** the start of an argument with names: set / add (`Property: `), mail.send (`to: `) … */
      named: { props: { dbId: string | null; dbName: string | null } | null; names: string[] } | null
      /** the start of a statement (snippets) */
      stmt: boolean
      /** visible variables and their types */
      vars: Array<[string, Ty | null]>
      /** in an item context: what `it` is */
      item: Ty | null
      forced: boolean
    }
  | { kind: 'value'; from: number; to: number; prefix: string; prop: PropInfo; quoted: boolean; vars: Array<[string, Ty | null]> }
  | null

/** The token the offset falls in (start < offset ≤ end), comments included. */
function tokenAt(a: Analysis, offset: number): Token | null {
  for (const t of a.tokens) if (t.pos.start < offset && offset <= t.pos.end) return t
  return null
}

/**
 * A database property a value is compared with or set to, for the value at token index `k`:
 * `Status = ` / `t.Status != ` (inside where … / on a row) · `set(Status: ` · `add("…", Status: `.
 */
function valueTarget(en: Engine, k: number, frames: Frame[]): PropInfo | null {
  const { toks } = en.v
  const op = toks[k - 1]
  if (!op || op.type !== 'op') return null
  if (op.text === ':') {
    const nameTok = toks[k - 2]
    const f = frames[frames.length - 1]
    if (nameTok?.type !== 'ident' || !f || en.enclosingOpen(k - 2) !== f.open) return null
    if (f.spec?.args !== 'set' && f.spec?.args !== 'add') return null
    return en.prop(dbOf(f.recv), String(nameTok.value)) ?? null
  }
  if (!CMP.has(op.text)) return null
  // `let x = ` / `x = ` (a statement) is no comparison
  const before = toks[k - 3]
  if (op.text === '=' && (!before || before.type === 'nl' || (before.type === 'kw' && before.text === 'let') || (before.type === 'op' && (before.text === '{' || before.text === '}')))) return null
  const left = toks[k - 2]
  if (left?.type !== 'ident') return null
  const name = String(left.value)
  if (en.v.toks[k - 3]?.type === 'op' && en.v.toks[k - 3].text === '.') {
    const start = en.chainStart(k - 3)
    const recv = start < 0 ? null : en.chainType(start, k - 3)
    return recv?.k === 'row' ? (en.prop(recv.db, name) ?? null) : null
  }
  if (en.lookup(name, k - 2)) return null
  for (let i = frames.length - 1; i >= 0; i--) {
    const it = frames[i].item
    if (it?.k === 'row') return en.prop(it.db, name) ?? null
  }
  return null
}

export function completionAt(code: string, a: Analysis, offset: number, ws: WsInfo = NO_WS, forced = false): CompletionContext {
  const tok = tokenAt(a, offset)
  if (tok?.type === 'comment') return null
  const chip = tok?.type === 'ref' && !!(tok.value as RefValue | undefined)?.id
  if (chip) return null
  const v = viewOf(a)
  const en = new Engine(v, ws)

  // inside a text: option values after `Status = "…` / `set(Status: "…`
  const inText = tok && offset > tok.pos.start && ((tok.type === 'str' && offset < tok.pos.end) || (tok.type === 'error' && /^["']/.test(tok.text)))
  if (inText) {
    const k = indexAt(v, tok.pos.start)
    const frames = en.scan(k)
    const prop = valueTarget(en, k, frames)
    if (!prop || !valueOptions(prop, ws).length) return null
    return { kind: 'value', from: tok.pos.start, to: tok.type === 'str' ? tok.pos.end : offset, prefix: code.slice(tok.pos.start + 1, offset), prop, quoted: true, vars: en.visible(k) }
  }
  if (tok?.type === 'str' && offset < tok.pos.end) return null

  // @ references: "@" … caret on one line, no brackets in between
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1
  const before = code.slice(lineStart, offset)
  const at = before.lastIndexOf('@')
  if (at >= 0 && !/[()[\]{},"'`=]/.test(before.slice(at + 1)) && before.slice(at + 1).length <= 60 && (at === 0 || !isWord(before[at - 1]))) {
    const inTok = tokenAt(a, lineStart + at + 1)
    if (!inTok || inTok.type === 'ref' || inTok.type === 'error') return { kind: 'ref', from: lineStart + at, to: offset, query: before.slice(at + 1) }
  }

  // the word being typed
  let s = offset
  while (s > 0 && isWord(code[s - 1])) s--
  const prefix = code.slice(s, offset)
  if (/^\d/.test(prefix)) return null
  if (code[s - 1] === '`') return null

  // members after "."
  if (code[s - 1] === '.') {
    const dot = indexAt(v, s - 1)
    if (!v.toks[dot] || v.toks[dot].text !== '.' || v.toks[dot - 1]?.type === 'num') return null
    en.scan(dot)
    const start = en.chainStart(dot)
    const ty = start < 0 ? null : en.chainType(start, dot)
    const db = dbOf(ty)
    return { kind: 'member', from: s, to: offset, prefix, ty, on: memberKindOf(ty), dbId: db?.id ?? null, dbName: db?.name ?? null }
  }

  const k = indexAt(v, s)
  const frames = en.scan(k)
  const vars = en.visible(k)

  // a value compared with / set to a property
  const prop = valueTarget(en, k, frames)
  if (prop && valueOptions(prop, ws).length && (prefix || forced || /[=:<>\s]$/.test(code.slice(0, offset)))) return { kind: 'value', from: s, to: offset, prefix, prop, quoted: false, vars }

  // names
  const top = frames[frames.length - 1]
  const argStart = !!top && (k === top.open + 1 || (v.toks[k - 1]?.type === 'op' && v.toks[k - 1].text === ',' && en.enclosingOpen(k - 1) === top.open))
  let itemFrame: Frame | null = null
  for (let i = frames.length - 1; i >= 0; i--)
    if (frames[i].item) {
      itemFrame = frames[i]
      break
    }
  const item = itemFrame?.item ?? null
  const propsOf = item?.k === 'row' ? { dbId: item.db.id, dbName: item.db.name } : null
  const fields = item?.k === 'record' && item.fields ? item.fields.map(([n]) => n) : item?.k === 'group' ? ['key', 'rows', 'count'] : null
  let named: Extract<CompletionContext, { kind: 'name' }>['named'] = null
  if (argStart && top?.spec) {
    if (top.spec.args === 'set' || top.spec.args === 'add') {
      const db = dbOf(top.recv)
      named = { props: db ? { dbId: db.id, dbName: db.name } : null, names: top.recv?.k === 'page' ? ['title'] : [] }
    } else if (top.spec.named) named = { props: null, names: top.spec.named }
  }
  const stmt = !code.slice(lineStart, s).trim()
  if (!prefix && !forced) {
    const prev = code[offset - 1]
    if (!(argStart && (prev === '(' || prev === ',' || prev === ' ') && (propsOf || fields || named))) return null
  }
  return { kind: 'name', from: s, to: offset, prefix, propsOf, fields, named, stmt, vars, item, forced }
}

/* ------------------------------------------------------------------ candidates */

export type CandKind = 'prop' | 'field' | 'member' | 'fn' | 'var' | 'kw' | 'snip' | 'option' | 'value' | 'named'

export interface Candidate {
  label: string
  /** the text that replaces the typed part */
  insert: string
  kind: CandKind
  /** a snippet body (with tab stops) instead of plain text */
  snippet?: string
  /** the signature (doc line) */
  sig?: string
  /** i18n keys of the one-line description (the first that exists) */
  doc?: string[]
  /** what it gives (members, variables) */
  ty?: Ty | null
  /** a database property */
  prop?: PropInfo
  score: number
}

/** How well a label matches what was typed: 0 = not at all. */
export function matchScore(label: string, prefix: string): number {
  if (!prefix) return 1
  const l = label.toLowerCase()
  const p = prefix.toLowerCase()
  if (l === p) return 6
  if (l.startsWith(p)) return 5
  if (l.split(/[_\s\-./]+/).some((w) => w.startsWith(p))) return 3
  if (p.length < 3) return 0
  let i = 0
  for (const c of l) if (c === p[i]) i++
  return i === p.length ? 1 : 0
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Values that fit a property (as code). */
export function valueOptions(p: PropInfo, ws: WsInfo): Array<{ label: string; insert: string; kind: CandKind }> {
  switch (p.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return p.options.map((o) => ({ label: o, insert: textCode(o), kind: 'option' }))
    case 'checkbox':
      return ['true', 'false'].map((x) => ({ label: x, insert: x, kind: 'kw' }))
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return ['today()', 'today() + 7d', 'today() - 7d', 'now()', `date("${todayIso()}")`].map((x) => ({ label: x, insert: x, kind: 'value' }))
    case 'person':
      return [{ label: 'me()', insert: 'me()', kind: 'value' as CandKind }, ...ws.people().map((n) => ({ label: n, insert: textCode(n), kind: 'option' as CandKind }))]
    case 'relation':
      return p.target ? ws.titles(p.target).map((n) => ({ label: n, insert: textCode(n), kind: 'option' as CandKind })) : []
    default:
      return []
  }
}

const SNIPPET_SCORE_MIN = 3

function globalCandidates(prefix: string, kindRank: number): Candidate[] {
  const out: Candidate[] = []
  for (const f of GLOBAL_FUNCTIONS) {
    const sc = matchScore(f.name, prefix)
    if (!sc) continue
    const insert = f.prop ? f.name : `${f.name}(`
    out.push({ label: f.name, insert, kind: 'fn', sig: f.sig, doc: [`features.script.fn.${f.name}`], score: sc * 10 - kindRank })
  }
  return out
}

/** The candidates of a context (refs are the editor's: they need the workspace's pages). */
export function candidatesFor(ctx: NonNullable<CompletionContext>, ws: WsInfo = NO_WS, ph: (key: string) => string = (k) => k): Candidate[] {
  const out: Candidate[] = []
  if (ctx.kind === 'ref') return out
  if (ctx.kind === 'member') {
    const ty = ctx.ty
    const kind = ctx.on
    const p = ctx.prefix
    if (ty?.k === 'row') {
      const info = ws.db(ty.db.id, ty.db.name)
      for (const prop of info?.props ?? []) {
        const sc = matchScore(prop.name, p)
        if (sc) out.push({ label: prop.name, insert: nameCode(prop.name), kind: 'prop', prop, ty: propTy(prop), score: sc * 10 + 5 })
      }
    }
    if (ty?.k === 'record' && ty.fields)
      for (const [name, fty] of ty.fields) {
        const sc = matchScore(name, p)
        if (sc) out.push({ label: name, insert: nameCode(name), kind: 'field', ty: fty, score: sc * 10 + 5 })
      }
    const lists = kind ? [kind] : ty ? [] : (['query', 'row', 'text', 'list'] as MemberKind[])
    const en = new Engine({ toks: [], match: new Int32Array(0) }, ws)
    const seen = new Set<string>()
    for (const k of lists)
      for (const f of MEMBERS[k] ?? []) {
        if (seen.has(f.name)) continue
        const sc = matchScore(f.name, p)
        if (!sc) continue
        seen.add(f.name)
        // add() only on the database itself
        if (f.name === 'add' && ty?.k === 'db' && ty.q) continue
        const insert = f.prop ? f.name : `${f.name}(`
        const rty = !ty || !f.ret ? null : f.prop ? en.memberTy(ty, f.name) : en.retTy(f.ret, ty, null)
        out.push({ label: f.name, insert, kind: 'member', sig: f.sig, doc: memberDocKeys(k, f.name), ty: rty, score: sc * 10 })
      }
    return sorted(out)
  }
  if (ctx.kind === 'value') {
    const p = ctx.prefix.replace(/^["']/, '')
    for (const o of valueOptions(ctx.prop, ws)) {
      const sc = matchScore(o.label.replace(/^"|"$/g, ''), p)
      if (sc) out.push({ label: o.kind === 'option' ? o.insert : o.label, insert: o.insert, kind: o.kind, prop: ctx.prop, score: sc * 10 + 5 })
    }
    if (!ctx.quoted && ctx.prefix) {
      for (const [name, ty] of ctx.vars) {
        const sc = matchScore(name, ctx.prefix)
        if (sc) out.push({ label: name, insert: name, kind: 'var', ty, score: sc * 10 })
      }
      out.push(...globalCandidates(ctx.prefix, 2))
    }
    return sorted(out)
  }
  // names
  const p = ctx.prefix
  const contextual = !!(ctx.named || ctx.propsOf || ctx.fields)
  if (ctx.named) {
    const info = ctx.named.props ? ws.db(ctx.named.props.dbId, ctx.named.props.dbName) : null
    for (const prop of info?.props ?? []) {
      if (['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'files'].includes(prop.type)) continue
      const sc = matchScore(prop.name, p)
      if (sc) out.push({ label: `${prop.name}:`, insert: `${nameCode(prop.name)}: `, kind: 'named', prop, score: sc * 10 + 8 })
    }
    for (const n of ctx.named.names) {
      const sc = matchScore(n, p)
      if (sc) out.push({ label: `${n}:`, insert: `${n}: `, kind: 'named', doc: [`features.script.arg.${n}`], score: sc * 10 + 8 })
    }
  }
  if (ctx.propsOf) {
    const info = ws.db(ctx.propsOf.dbId, ctx.propsOf.dbName)
    for (const prop of info?.props ?? []) {
      const sc = matchScore(prop.name, p) || matchScore(nameCode(prop.name), p)
      if (sc) out.push({ label: prop.name, insert: nameCode(prop.name), kind: 'prop', prop, ty: propTy(prop), score: sc * 10 + 6 })
    }
    for (const b of ['title', 'created', 'edited']) {
      const sc = p ? matchScore(b, p) : 0
      if (sc && !info?.props.some((x) => x.name.toLowerCase() === b)) out.push({ label: b, insert: b, kind: 'member', doc: memberDocKeys('row', b), ty: b === 'title' ? T.text : T.date, score: sc * 10 + 2 })
    }
  }
  if (ctx.fields)
    for (const f of ctx.fields) {
      const sc = matchScore(f, p)
      if (sc) out.push({ label: f, insert: nameCode(f), kind: 'field', score: sc * 10 + 6 })
    }
  if (!p && !ctx.forced && contextual) return sorted(out)
  if (ctx.item && matchScore('it', p) && p) out.push({ label: 'it', insert: 'it', kind: 'var', ty: ctx.item, doc: ['features.script.ed.it'], score: matchScore('it', p) * 10 + 3 })
  for (const [name, ty] of ctx.vars) {
    if (name === 'it') continue
    const sc = matchScore(name, p)
    if (sc && name !== p) out.push({ label: name, insert: name, kind: 'var', ty, score: sc * 10 + 4 })
  }
  if (ctx.stmt || ctx.forced)
    for (const sn of SNIPPETS) {
      const sc = matchScore(sn.trigger, p)
      if (sc >= (p ? SNIPPET_SCORE_MIN : 1)) out.push({ label: sn.trigger, insert: '', snippet: sn.body(ph), kind: 'snip', doc: [`features.script.snip.${sn.id}`], score: sc * 10 + (ctx.stmt ? 1 : -3) })
    }
  out.push(...globalCandidates(p, 0))
  for (const kw of KEYWORDS) {
    const sc = matchScore(kw, p)
    if (sc >= 5 && kw !== p) out.push({ label: kw, insert: kw, kind: 'kw', score: sc * 10 - 2 })
  }
  return sorted(out)
}

function sorted(list: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map((x) => x.c)
    .filter((c) => {
      const key = `${c.kind}:${c.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 60)
}

/* ------------------------------------------------------------------ signature help, docs */

export interface CallInfo {
  /** the function or method */
  name: string
  sig: string
  doc: string[]
  /** which argument the caret is in (0-based) */
  index: number
  /** the named argument being written (`to:`) */
  named: string | null
}

/** The call around the caret: its signature and the argument at the caret. */
export function callAt(code: string, a: Analysis, offset: number, ws: WsInfo = NO_WS): CallInfo | null {
  const tok = tokenAt(a, offset)
  if (tok?.type === 'comment') return null
  const v = viewOf(a)
  const en = new Engine(v, ws)
  const k = indexAt(v, offset)
  const frames = en.scan(k)
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    if (!f.spec || f.spec.prop) continue
    // the arguments before the caret at this call's depth
    let index = 0
    let argStart = f.open + 1
    for (let j = f.open + 1; j < k; j++) {
      const t = v.toks[j]
      if (t.type === 'op' && OPENERS.has(t.text)) {
        if (v.match[j] < 0 || v.match[j] >= k) break
        j = v.match[j]
        continue
      }
      if (t.type === 'op' && t.text === ',') {
        index++
        argStart = j + 1
      }
    }
    const nt = v.toks[argStart]
    const named = nt?.type === 'ident' && argStart < k && v.toks[argStart + 1]?.text === ':' ? String(nt.value) : null
    const doc = f.member && f.kind ? memberDocKeys(f.kind, f.spec.name) : [`features.script.fn.${f.spec.name}`]
    return { name: f.spec.name, sig: f.spec.sig, doc, index, named }
  }
  return null
}

/** The parameters of a signature ("mail.send(to: …, subject: …)" → ["to: …", "subject: …"]) with their places in it. */
export function sigParams(sig: string): Array<{ text: string; start: number; end: number }> {
  const open = sig.indexOf('(')
  if (open < 0) return []
  const out: Array<{ text: string; start: number; end: number }> = []
  let depth = 0
  let s = open + 1
  let quote: string | null = null
  for (let i = open + 1; i < sig.length; i++) {
    const c = sig[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--
    else if (c === ',' && depth === 0) {
      out.push({ text: sig.slice(s, i).trim(), start: s + (sig.slice(s, i).length - sig.slice(s, i).trimStart().length), end: i })
      s = i + 1
    } else if (c === ')' && depth === 0) {
      if (sig.slice(s, i).trim()) out.push({ text: sig.slice(s, i).trim(), start: s + (sig.slice(s, i).length - sig.slice(s, i).trimStart().length), end: i })
      break
    }
  }
  return out
}

/** Which parameter of a signature an argument is (repeating `…` parameters take the one before). */
export function activeParam(sig: string, index: number, named: string | null): number {
  const ps = sigParams(sig)
  if (!ps.length) return -1
  if (named) {
    const i = ps.findIndex((p) => p.text.startsWith(`${named}:`))
    if (i >= 0) return i
  }
  if (index < ps.length) return ps[index].text === '…' ? Math.max(0, index - 1) : index
  const dots = ps.findIndex((p) => p.text === '…' || /…\s*$/.test(p.text))
  if (dots >= 0) return ps[dots].text === '…' ? Math.max(0, dots - 1) : dots
  return -1
}

export interface DocInfo {
  from: number
  to: number
  label: string
  sig?: string
  doc?: string[]
  ty?: Ty | null
  prop?: PropInfo
  /** a variable of the script */
  variable?: boolean
}

/** What the name at an offset is (F1 / Mod+I, Ctrl+hover). */
export function docAt(code: string, a: Analysis, offset: number, ws: WsInfo = NO_WS): DocInfo | null {
  const v = viewOf(a)
  const idx = v.toks.findIndex((t) => (t.type === 'ident' || t.type === 'kw') && t.pos.start <= offset && offset <= t.pos.end)
  if (idx < 0) return null
  const t = v.toks[idx]
  const name = String(t.value ?? t.text)
  const base = { from: t.pos.start, to: t.pos.end, label: name }
  const en = new Engine(v, ws)
  const frames = en.scan(idx)
  if (en.v.toks[idx - 1]?.type === 'op' && en.v.toks[idx - 1].text === '.') {
    const start = en.chainStart(idx - 1)
    const recv = start < 0 ? null : en.chainType(start, idx - 1)
    if (recv?.k === 'row') {
      const prop = en.prop(recv.db, name)
      if (prop) return { ...base, prop, ty: propTy(prop) }
    }
    const kind = memberKindOf(recv)
    const spec = en.memberSpec(kind, name, !recv)
    if (spec) return { ...base, label: spec.name, sig: spec.sig, doc: memberDocKeys(kind ?? 'query', spec.name), ty: recv && spec.ret ? en.retTy(spec.ret, recv, null) : null }
    return null
  }
  if (t.type === 'kw') return null
  const b = en.lookup(name, idx)
  if (b) return { ...base, ty: b.ty, variable: true }
  for (let i = frames.length - 1; i >= 0; i--) {
    const it = frames[i].item
    if (it?.k === 'row') {
      const prop = en.prop(it.db, name)
      if (prop) return { ...base, prop, ty: propTy(prop) }
      break
    }
  }
  const f = GLOBAL_FUNCTIONS.find((g) => norm(g.name) === norm(name))
  if (f) return { ...base, label: f.name, sig: f.sig, doc: [`features.script.fn.${f.name}`] }
  return null
}
