/**
 * One Script — the parser: tokens → syntax tree (Pratt parser for expressions, recursive descent for
 * statements). Throws a ScriptError with line:col at the first problem.
 *
 * Notes on the grammar (docs: help article "one-script"):
 *  - statements end at a newline or `;`; a line that starts with `.` continues the expression above
 *    (method chains), and so does a line that ends with an operator or a comma inside ( ) / [ ];
 *  - `=` is equality inside expressions (`Status = "Open"`); only a statement `x = …` assigns;
 *  - `{` after `if` / `for` / `while` / `fn` / `=>` starts a block, elsewhere a record `{to: x}`
 *    (after `=>`: a record when it starts with `name:`).
 */
import { ScriptError, type Pos } from './errors'
import { tokenize, MAX_SOURCE, type RefValue, type StrPart, type Token } from './lexer'
import type { Arg, BinaryOp, Block, Expr, Param, Program, Stmt } from './ast'

const BP: Record<string, number> = {
  or: 10,
  and: 20,
  '=': 40,
  '==': 40,
  '!=': 40,
  '<': 40,
  '<=': 40,
  '>': 40,
  '>=': 40,
  in: 40,
  '+': 50,
  '-': 50,
  '*': 60,
  '/': 60,
  '%': 60,
}
const NOT_BP = 30
const UNARY_BP = 70
const POSTFIX_BP = 80

const span = (a: Pos, b: Pos): Pos => ({ start: a.start, end: b.end, line: a.line, col: a.col })

const describe = (t: Token): string => (t.type === 'eof' ? 'the end' : t.type === 'nl' ? 'a line break' : JSON.stringify(t.text.length > 24 ? `${t.text.slice(0, 24)}…` : t.text))

class Parser {
  private toks: Token[]
  private i = 0
  readonly source: string

  constructor(source: string, toks: Token[]) {
    this.source = source
    this.toks = toks
  }

  /* ---------------------------------------------------------------- tokens */

  private get cur(): Token {
    return this.toks[this.i]
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)]
  }
  private next(): Token {
    const t = this.toks[this.i]
    if (this.i < this.toks.length - 1) this.i++
    return t
  }
  private isOp(text: string, t = this.cur): boolean {
    return t.type === 'op' && t.text === text
  }
  private isKw(text: string, t = this.cur): boolean {
    return t.type === 'kw' && t.text === text
  }
  private skipNl(): void {
    while (this.cur.type === 'nl') this.next()
  }
  private expectOp(text: string): Token {
    if (!this.isOp(text)) throw new ScriptError('expected', { expected: JSON.stringify(text), found: describe(this.cur) }, this.cur.pos)
    return this.next()
  }
  private prevPos(): Pos {
    return this.toks[Math.max(0, this.i - 1)].pos
  }

  /* ---------------------------------------------------------------- program */

  program(): Program {
    const body: Stmt[] = []
    this.skipSeparators()
    while (this.cur.type !== 'eof') {
      body.push(this.statement())
      this.endStatement()
    }
    return { type: 'Program', body, source: this.source }
  }

  private skipSeparators(): void {
    while (this.cur.type === 'nl' || this.isOp(';')) this.next()
  }

  private endStatement(): void {
    if (this.cur.type === 'eof' || this.isOp('}')) return
    if (this.cur.type !== 'nl' && !this.isOp(';')) throw new ScriptError('unexpected', { found: describe(this.cur) }, this.cur.pos)
    this.skipSeparators()
  }

  private block(): Block {
    const open = this.expectOp('{')
    const body: Stmt[] = []
    this.skipSeparators()
    while (!this.isOp('}')) {
      if (this.cur.type === 'eof') throw new ScriptError('expected', { expected: '"}"', found: describe(this.cur) }, this.cur.pos)
      body.push(this.statement())
      this.endStatement()
    }
    const close = this.next()
    return { type: 'Block', body, pos: span(open.pos, close.pos) }
  }

  /* ---------------------------------------------------------------- statements */

  private statement(): Stmt {
    const t = this.cur
    if (t.type === 'kw') {
      switch (t.text) {
        case 'let': {
          this.next()
          const name = this.name('a name')
          this.expectOp('=')
          this.skipNl()
          const value = this.expr()
          return { type: 'Let', name: name.name, value, pos: span(t.pos, value.pos) }
        }
        case 'if':
          return this.ifStatement()
        case 'for': {
          this.next()
          let first = this.name('a name')
          let key: string | null = null
          if (this.isOp(',')) {
            this.next()
            key = first.name
            first = this.name('a name')
          }
          if (!this.isKw('in')) throw new ScriptError('expected', { expected: '"in"', found: describe(this.cur) }, this.cur.pos)
          this.next()
          const iter = this.expr()
          const body = this.block()
          return { type: 'For', key, name: first.name, iter, body, pos: span(t.pos, body.pos) }
        }
        case 'while': {
          this.next()
          const test = this.expr()
          const body = this.block()
          return { type: 'While', test, body, pos: span(t.pos, body.pos) }
        }
        case 'return': {
          this.next()
          if (this.cur.type === 'nl' || this.cur.type === 'eof' || this.isOp('}') || this.isOp(';')) return { type: 'Return', value: null, pos: t.pos }
          const value = this.expr()
          return { type: 'Return', value, pos: span(t.pos, value.pos) }
        }
        case 'break':
          this.next()
          return { type: 'Break', pos: t.pos }
        case 'continue':
          this.next()
          return { type: 'Continue', pos: t.pos }
        case 'fn':
          if (this.peek().type === 'ident') {
            this.next()
            const name = this.name('a name')
            const params = this.params()
            const body = this.block()
            return { type: 'FnDecl', name: name.name, params, body, pos: span(t.pos, body.pos) }
          }
      }
    }
    // an expression, or an assignment `target = value` (`=` at the top level of a statement assigns
    // to a name, a field or an item; after anything else it compares: `count(x) = 3` is a yes/no)
    const expr = this.expr(0, false)
    if (this.isOp('=')) {
      if (expr.type !== 'Ident' && expr.type !== 'Member' && expr.type !== 'Index') {
        this.next()
        this.skipNl()
        const right = this.expr(BP['='])
        let cmp: Expr = { type: 'Binary', op: '=', left: expr, right, pos: span(expr.pos, right.pos) }
        // the rest of the line (`a = b and c`) as in any condition
        cmp = this.continueExpr(cmp)
        return { type: 'ExprStmt', expr: cmp, pos: cmp.pos }
      }
      this.next()
      this.skipNl()
      const value = this.expr()
      return { type: 'Assign', target: expr, value, pos: span(expr.pos, value.pos) }
    }
    return { type: 'ExprStmt', expr, pos: expr.pos }
  }

  private ifStatement(): Extract<Stmt, { type: 'If' }> {
    const t = this.next()
    const test = this.expr()
    const then = this.block()
    let otherwise: Block | Extract<Stmt, { type: 'If' }> | null = null
    // `else` may start the next line
    let j = this.i
    while (this.toks[j].type === 'nl') j++
    if (this.isKw('else', this.toks[j])) {
      this.i = j
      this.next()
      otherwise = this.isKw('if') ? this.ifStatement() : this.block()
    }
    return { type: 'If', test, then, else: otherwise, pos: span(t.pos, (otherwise ?? then).pos) }
  }

  private name(what: string): { name: string; pos: Pos } {
    const t = this.cur
    if (t.type !== 'ident') throw new ScriptError('expected', { expected: what, found: describe(t) }, t.pos)
    this.next()
    return { name: t.value as string, pos: t.pos }
  }

  private params(): Param[] {
    this.expectOp('(')
    const out: Param[] = []
    while (!this.isOp(')')) {
      const n = this.name('a parameter name')
      let def: Expr | null = null
      if (this.isOp('=')) {
        this.next()
        def = this.expr()
      }
      out.push({ name: n.name, def, pos: n.pos })
      if (!this.isOp(',')) break
      this.next()
    }
    this.expectOp(')')
    return out
  }

  /* ---------------------------------------------------------------- expressions */

  /**
   * Pratt loop. `eq`: whether `=` is equality here (false at the top of a statement, where it assigns —
   * passed on to the right operands of that statement's operators, reset inside brackets).
   */
  expr(minBp = 0, eq = true): Expr {
    return this.continueExpr(this.prefix(), minBp, eq)
  }

  /** The Pratt loop from an already parsed left operand. */
  private continueExpr(start: Expr, minBp = 0, eq = true): Expr {
    let left = start
    for (;;) {
      let t = this.cur
      // a line that starts with "." continues a method chain
      if (t.type === 'nl') {
        let j = this.i
        while (this.toks[j].type === 'nl') j++
        if (this.isOp('.', this.toks[j])) {
          this.i = j
          t = this.cur
        } else break
      }
      if (this.isOp('(') || this.isOp('.') || this.isOp('[')) {
        if (POSTFIX_BP < minBp) break
        left = this.postfix(left)
        continue
      }
      const op = t.type === 'op' || t.type === 'kw' ? t.text : ''
      const bp = Object.prototype.hasOwnProperty.call(BP, op) ? BP[op] : undefined
      if (bp === undefined || bp <= minBp) break
      if (op === '=' && !eq) break
      this.next()
      this.skipNl()
      const right = this.expr(bp, eq)
      if (op === 'and' || op === 'or') left = { type: 'Logical', op, left, right, pos: span(left.pos, right.pos) }
      else left = { type: 'Binary', op: op as BinaryOp, left, right, pos: span(left.pos, right.pos) }
    }
    return left
  }

  private postfix(left: Expr): Expr {
    const t = this.next()
    if (t.text === '.') {
      const n = this.cur
      if (n.type !== 'ident' && n.type !== 'kw') throw new ScriptError('expected', { expected: 'a name after "."', found: describe(n) }, n.pos)
      this.next()
      const name = n.type === 'ident' ? (n.value as string) : n.text
      return { type: 'Member', object: left, name, namePos: n.pos, pos: span(left.pos, n.pos) }
    }
    if (t.text === '[') {
      const index = this.expr()
      const close = this.expectOp(']')
      return { type: 'Index', object: left, index, pos: span(left.pos, close.pos) }
    }
    // call
    const args: Arg[] = []
    while (!this.isOp(')')) {
      if (this.cur.type === 'eof') throw new ScriptError('expected', { expected: '")"', found: describe(this.cur) }, this.cur.pos)
      args.push(this.arg())
      if (!this.isOp(',')) break
      this.next()
    }
    const close = this.expectOp(')')
    return { type: 'Call', callee: left, args, pos: span(left.pos, close.pos) }
  }

  private arg(): Arg {
    const t = this.cur
    // named: name: value · `Some name`: value · "Some name": value
    if ((t.type === 'ident' || t.type === 'str') && this.isOp(':', this.peek())) {
      if (t.type === 'str' && !(t.value as StrPart[]).every((p) => typeof p === 'string')) throw new ScriptError('expected', { expected: 'a plain name', found: describe(t) }, t.pos)
      this.next()
      this.next()
      const value = this.expr()
      const name = t.type === 'ident' ? (t.value as string) : (t.value as string[]).join('')
      return { name, value, order: null, pos: span(t.pos, value.pos) }
    }
    const value = this.expr()
    // sort sugar: .sort(Due desc)
    const o = this.cur
    if (o.type === 'ident' && (o.text === 'desc' || o.text === 'asc') && (this.isOp(',', this.peek()) || this.isOp(')', this.peek()))) {
      this.next()
      return { name: null, value, order: o.text, pos: span(value.pos, o.pos) }
    }
    return { name: null, value, order: null, pos: value.pos }
  }

  private prefix(): Expr {
    const t = this.cur
    switch (t.type) {
      case 'num':
        this.next()
        return { type: 'Num', value: t.value as number, pos: t.pos }
      case 'dur': {
        this.next()
        const v = t.value as { days: number; ms: number }
        return { type: 'Dur', days: v.days, ms: v.ms, text: t.text, pos: t.pos }
      }
      case 'str':
        this.next()
        return this.string(t)
      case 'ref': {
        this.next()
        const v = t.value as RefValue
        return { type: 'Ref', kind: v.kind, id: v.id, label: v.label, pos: t.pos }
      }
      case 'ident':
        // a lambda: x => …
        if (this.isOp('=>', this.peek())) {
          this.next()
          this.next()
          return this.lambdaBody([{ name: t.value as string, def: null, pos: t.pos }], t.pos)
        }
        this.next()
        return { type: 'Ident', name: t.value as string, quoted: !!t.quoted, pos: t.pos }
      case 'kw':
        switch (t.text) {
          case 'true':
          case 'false':
            this.next()
            return { type: 'Bool', value: t.text === 'true', pos: t.pos }
          case 'null':
            this.next()
            return { type: 'Null', pos: t.pos }
          case 'not': {
            this.next()
            const arg = this.expr(NOT_BP)
            return { type: 'Unary', op: 'not', arg, pos: span(t.pos, arg.pos) }
          }
          case 'fn': {
            this.next()
            const params = this.params()
            const body = this.block()
            return { type: 'Lambda', params, body, name: null, pos: span(t.pos, body.pos) }
          }
        }
        break
      case 'op':
        switch (t.text) {
          case '-': {
            this.next()
            const arg = this.expr(UNARY_BP)
            if (arg.type === 'Num') return { type: 'Num', value: -arg.value, pos: span(t.pos, arg.pos) }
            return { type: 'Unary', op: '-', arg, pos: span(t.pos, arg.pos) }
          }
          case '!': {
            this.next()
            const arg = this.expr(UNARY_BP)
            return { type: 'Unary', op: 'not', arg, pos: span(t.pos, arg.pos) }
          }
          case '(': {
            const lambda = this.tryLambdaParams()
            if (lambda) return lambda
            this.next()
            this.skipNl()
            const inner = this.expr()
            this.skipNl()
            this.expectOp(')')
            return inner
          }
          case '[': {
            this.next()
            const items: Expr[] = []
            while (!this.isOp(']')) {
              if (this.cur.type === 'eof') throw new ScriptError('expected', { expected: '"]"', found: describe(this.cur) }, this.cur.pos)
              items.push(this.expr())
              if (!this.isOp(',')) break
              this.next()
            }
            const close = this.expectOp(']')
            return { type: 'List', items, pos: span(t.pos, close.pos) }
          }
          case '{':
            return this.record()
        }
    }
    throw new ScriptError(t.type === 'eof' || t.type === 'nl' ? 'expected' : 'unexpected', { expected: 'a value', found: describe(t) }, t.pos)
  }

  /** `(a, b) => …` — looks ahead for the matching ")" followed by "=>". */
  private tryLambdaParams(): Expr | null {
    let j = this.i + 1
    let d = 1
    while (j < this.toks.length && d > 0) {
      const tk = this.toks[j]
      if (tk.type === 'eof') return null
      if (tk.type === 'op' && (tk.text === '(' || tk.text === '[' || tk.text === '{')) d++
      if (tk.type === 'op' && (tk.text === ')' || tk.text === ']' || tk.text === '}')) d--
      j++
    }
    if (!this.isOp('=>', this.toks[j])) return null
    const start = this.cur.pos
    const params = this.params()
    this.expectOp('=>')
    return this.lambdaBody(params, start)
  }

  private lambdaBody(params: Param[], start: Pos): Expr {
    this.skipNl()
    if (this.isOp('{')) {
      // a record when it starts with `name:` / "name": (or is empty), else a block
      const a = this.peek()
      const b = this.peek(2)
      const isRecord = this.isOp('}', a) || ((a.type === 'ident' || a.type === 'str') && this.isOp(':', b))
      if (!isRecord) {
        const body = this.block()
        return { type: 'Lambda', params, body, name: null, pos: span(start, body.pos) }
      }
    }
    const body = this.expr()
    return { type: 'Lambda', params, body, name: null, pos: span(start, body.pos) }
  }

  private record(): Expr {
    const open = this.next()
    const entries: Array<{ key: string; value: Expr; pos: Pos }> = []
    this.skipNl()
    while (!this.isOp('}')) {
      const k = this.cur
      let key: string
      if (k.type === 'ident') key = k.value as string
      else if (k.type === 'kw') key = k.text
      else if (k.type === 'str' && (k.value as StrPart[]).every((p) => typeof p === 'string')) key = (k.value as string[]).join('')
      else throw new ScriptError('expected', { expected: 'a field name', found: describe(k) }, k.pos)
      this.next()
      let value: Expr
      if (this.isOp(':')) {
        this.next()
        this.skipNl()
        value = this.expr()
      } else if (k.type === 'ident') {
        // shorthand {to} = {to: to}
        value = { type: 'Ident', name: key, quoted: !!k.quoted, pos: k.pos }
      } else throw new ScriptError('expected', { expected: '":"', found: describe(this.cur) }, this.cur.pos)
      entries.push({ key, value, pos: span(k.pos, value.pos) })
      this.skipNl()
      if (this.isOp(',')) {
        this.next()
        this.skipNl()
      } else if (!this.isOp('}')) throw new ScriptError('expected', { expected: '"," or "}"', found: describe(this.cur) }, this.cur.pos)
    }
    const close = this.next()
    return { type: 'Record', entries, pos: span(open.pos, close.pos) }
  }

  private string(t: Token): Expr {
    const parts: Array<string | Expr> = []
    for (const p of t.value as StrPart[]) {
      if (typeof p === 'string') {
        parts.push(p)
        continue
      }
      if (!p.src.trim()) throw new ScriptError('bad_interpolation', {}, t.pos)
      const sub = new Parser(this.source, tokenize(p.src, { base: { offset: p.offset, line: p.line, col: p.col } }).filter((x) => x.type !== 'nl'))
      const e = sub.expr()
      if (sub.cur.type !== 'eof') throw new ScriptError('bad_interpolation', {}, sub.cur.pos)
      parts.push(e)
    }
    return { type: 'Str', parts, quote: t.quote ?? '"', pos: t.pos }
  }
}

/** Parse a whole script. Throws ScriptError (with line:col) at the first problem. */
export function parse(source: string): Program {
  if (source.length > MAX_SOURCE) throw new ScriptError('too_long', { max: MAX_SOURCE }, { start: 0, end: 0, line: 1, col: 1 })
  return new Parser(source, tokenize(source)).program()
}

/** Parse one expression (the query tester's "evaluate selection"). */
export function parseExpression(source: string): Expr {
  const p = new Parser(source, tokenize(source).filter((t) => t.type !== 'nl'))
  const e = p.expr()
  const rest = (p as unknown as { cur: Token }).cur
  if (rest.type !== 'eof') throw new ScriptError('unexpected', { found: describe(rest) }, rest.pos)
  return e
}

/** The first syntax error of a source, or null. */
export function syntaxError(source: string): ScriptError | null {
  try {
    parse(source)
    return null
  } catch (e) {
    if (e instanceof ScriptError) return e
    return new ScriptError('internal', { detail: String((e as Error)?.message ?? e) })
  }
}
