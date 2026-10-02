/**
 * Formula language: tokenizer + Pratt parser → AST. No eval / Function anywhere.
 *
 *   prop("Price") * 1.19
 *   if(prop("Done"), "✓", concat("due ", formatDate(prop("Due"))))
 *   prop("Status") == "Done" and not empty(prop("Owner"))
 *   x > 3 ? "big" : "small"
 */

export interface Span {
  s: number
  e: number
}

export type Node =
  | ({ k: 'num'; v: number } & Span)
  | ({ k: 'str'; v: string } & Span)
  | ({ k: 'bool'; v: boolean } & Span)
  | ({ k: 'call'; name: string; args: Node[] } & Span)
  | ({ k: 'unary'; op: '-' | '!'; arg: Node } & Span)
  | ({ k: 'bin'; op: string; l: Node; r: Node } & Span)
  | ({ k: 'tern'; c: Node; a: Node; b: Node } & Span)

/** Error with an i18n code (database.formula.err.<code>) and an optional source position. */
export class FormulaError extends Error {
  code: string
  vars?: Record<string, string | number>
  pos?: number
  constructor(code: string, vars?: Record<string, string | number>, pos?: number) {
    super(code)
    this.code = code
    this.vars = vars
    this.pos = pos
  }
}

type Tok = { t: 'num'; v: number; s: number; e: number } | { t: 'str' | 'id' | 'op'; v: string; s: number; e: number } | { t: 'eof'; v: ''; s: number; e: number }

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '(', ')', ',', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':', '=']
const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '„': '“', '‘': '’' }

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(c === '.' ? src[i + 1] ?? '' : c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]), s: i, e: i + m[0].length })
      i += m[0].length
      continue
    }
    if (QUOTES[c]) {
      const close = QUOTES[c]
      let j = i + 1
      let str = ''
      while (j < src.length && src[j] !== close && !(c === '“' && src[j] === '"')) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]
          str += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else str += src[j++]
      }
      if (j >= src.length) throw new FormulaError('unterminatedString', undefined, i)
      out.push({ t: 'str', v: str, s: i, e: j + 1 })
      i = j + 1
      continue
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      const m = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0], s: i, e: i + m[0].length })
      i += m[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op, s: i, e: i + op.length })
      i += op.length
      continue
    }
    throw new FormulaError('unexpectedChar', { char: c }, i)
  }
  out.push({ t: 'eof', v: '', s: src.length, e: src.length })
  return out
}

/** Function arity table (min, max; -1 = variadic). Implementations live in evaluate.ts. */
export const ARITY: Record<string, [number, number]> = {
  prop: [1, 1],
  if: [3, 3],
  and: [1, -1],
  or: [1, -1],
  not: [1, 1],
  concat: [1, -1],
  join: [2, 2],
  length: [1, 1],
  contains: [2, 2],
  replace: [3, 3],
  replaceAll: [3, 3],
  lower: [1, 1],
  upper: [1, 1],
  trim: [1, 1],
  slice: [2, 3],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  sqrt: [1, 1],
  pow: [2, 2],
  min: [1, -1],
  max: [1, -1],
  sum: [1, -1],
  now: [0, 0],
  today: [0, 0],
  dateAdd: [3, 3],
  dateSubtract: [3, 3],
  dateBetween: [3, 3],
  dateStart: [1, 1],
  dateEnd: [1, 1],
  formatDate: [1, 2],
  year: [1, 1],
  month: [1, 1],
  date: [1, 1],
  empty: [1, 1],
  toNumber: [1, 1],
  format: [1, 1],
}

const FN_LOOKUP = new Map(Object.keys(ARITY).map((k) => [k.toLowerCase(), k]))

const BP: Record<string, number> = {
  '?': 1,
  '||': 2,
  or: 2,
  '&&': 3,
  and: 3,
  '==': 4,
  '!=': 4,
  '=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '^': 8,
}

const MAX_DEPTH = 120

export function parse(src: string): Node {
  if (!src.trim()) throw new FormulaError('emptyFormula', undefined, 0)
  const toks = tokenize(src)
  let i = 0
  let depth = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const expect = (v: string) => {
    const tk = next()
    if (tk.t !== 'op' || tk.v !== v) throw new FormulaError(tk.t === 'eof' ? 'unexpectedEnd' : 'expected', { what: v }, tk.s)
    return tk
  }

  const infixOp = (tk: Tok): string | null => {
    if (tk.t === 'op' && tk.v in BP) return tk.v
    if (tk.t === 'id' && (tk.v === 'and' || tk.v === 'or')) return tk.v
    return null
  }

  const prefix = (): Node => {
    const tk = next()
    if (tk.t === 'num') return { k: 'num', v: tk.v, s: tk.s, e: tk.e }
    if (tk.t === 'str') return { k: 'str', v: tk.v, s: tk.s, e: tk.e }
    if (tk.t === 'op' && tk.v === '(') {
      const inner = expr(0)
      const close = expect(')')
      return { ...inner, s: tk.s, e: close.e }
    }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '!')) {
      const arg = expr(9)
      return { k: 'unary', op: tk.v as '-' | '!', arg, s: tk.s, e: arg.e }
    }
    if (tk.t === 'op' && tk.v === '+') return expr(9)
    if (tk.t === 'id') {
      const lower = tk.v.toLowerCase()
      const isCall = peek().t === 'op' && peek().v === '('
      if (!isCall) {
        if (lower === 'true' || lower === 'false') return { k: 'bool', v: lower === 'true', s: tk.s, e: tk.e }
        if (lower === 'not') {
          const arg = expr(9)
          return { k: 'unary', op: '!', arg, s: tk.s, e: arg.e }
        }
        if (lower === 'pi') return { k: 'num', v: Math.PI, s: tk.s, e: tk.e }
        throw new FormulaError('unknownName', { name: tk.v }, tk.s)
      }
      const name = FN_LOOKUP.get(lower)
      if (!name) throw new FormulaError('unknownFunction', { name: tk.v }, tk.s)
      next() // (
      const args: Node[] = []
      if (!(peek().t === 'op' && peek().v === ')')) {
        for (;;) {
          args.push(expr(0))
          if (peek().t === 'op' && peek().v === ',') {
            next()
            continue
          }
          break
        }
      }
      const close = expect(')')
      const [min, max] = ARITY[name]
      if (args.length < min || (max >= 0 && args.length > max))
        throw new FormulaError('arity', { name, count: max === min ? String(min) : max < 0 ? `${min}+` : `${min}–${max}` }, tk.s)
      return { k: 'call', name, args, s: tk.s, e: close.e }
    }
    if (tk.t === 'eof') throw new FormulaError('unexpectedEnd', undefined, tk.s)
    throw new FormulaError('unexpectedToken', { token: String(tk.v) }, tk.s)
  }

  const expr = (minBp: number): Node => {
    if (++depth > MAX_DEPTH) throw new FormulaError('tooDeep', undefined, peek().s)
    let left = prefix()
    for (;;) {
      const op = infixOp(peek())
      if (!op) break
      const lbp = BP[op]
      if (lbp <= minBp) break
      next()
      if (op === '?') {
        const a = expr(0)
        expect(':')
        const b = expr(0)
        left = { k: 'tern', c: left, a, b, s: left.s, e: b.e }
        continue
      }
      const right = expr(op === '^' ? lbp - 1 : lbp)
      const norm = op === '&&' ? 'and' : op === '||' ? 'or' : op === '=' ? '==' : op
      left = { k: 'bin', op: norm, l: left, r: right, s: left.s, e: right.e }
    }
    depth--
    return left
  }

  const root = expr(0)
  const rest = peek()
  if (rest.t !== 'eof') throw new FormulaError('unexpectedToken', { token: String(rest.v) }, rest.s)
  return root
}

/** All prop("…") names referenced by an AST. */
export function referencedProps(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case 'call':
      if (node.name === 'prop' && node.args[0]?.k === 'str') out.add(node.args[0].v)
      node.args.forEach((a) => referencedProps(a, out))
      break
    case 'unary':
      referencedProps(node.arg, out)
      break
    case 'bin':
      referencedProps(node.l, out)
      referencedProps(node.r, out)
      break
    case 'tern':
      referencedProps(node.c, out)
      referencedProps(node.a, out)
      referencedProps(node.b, out)
      break
  }
  return out
}
