/**
 * Formula parser: tokens → AST (precedence climbing, Excel's operator order). Limits: 8,000
 * characters, nesting depth 64. Throws ParseError (the cell shows #ERROR!).
 *
 *   negation  >  %  >  ^  >  * /  >  + -  >  &  >  = <> < <= > >=
 */
import { lex, ParseError, type RefPart, type Tok } from './lexer'
import type { ErrorCode } from './types'

export const MAX_FORMULA = 8000
export const MAX_DEPTH = 64

export interface Span {
  s: number
  e: number
}

export type Node =
  | ({ k: 'num'; v: number } & Span)
  | ({ k: 'str'; v: string } & Span)
  | ({ k: 'bool'; v: boolean } & Span)
  | ({ k: 'err'; code: ErrorCode } & Span)
  | ({ k: 'ref'; sheet: string | null; a: RefPart; b: RefPart | null; cols: boolean } & Span)
  | ({ k: 'name'; name: string } & Span)
  | ({ k: 'blank' } & Span)
  | ({ k: 'call'; name: string; args: Node[] } & Span)
  | ({ k: 'neg'; arg: Node } & Span)
  | ({ k: 'pct'; arg: Node } & Span)
  | ({ k: 'bin'; op: string; l: Node; r: Node } & Span)

const BINARY: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

/** Parse a formula body (text after "="). */
export function parseFormula(body: string): Node {
  if (body.length > MAX_FORMULA) throw new ParseError('formula longer than 8,000 characters', 0)
  const toks = lex(body)
  let i = 0
  let depth = 0
  const peek = (): Tok => toks[i]
  const next = (): Tok => toks[i++]
  const enter = (at: number) => {
    if (++depth > MAX_DEPTH) throw new ParseError('formula nested too deeply', at)
  }

  const binary = (minPrec: number): Node => {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t.t !== 'op' || !(t.v in BINARY)) break
      const prec = BINARY[t.v]
      if (prec < minPrec) break
      next()
      enter(t.s)
      // all binary operators are left-associative in spreadsheets (2^3^2 = 64)
      const right = binary(prec + 1)
      depth--
      left = { k: 'bin', op: t.v, l: left, r: right, s: left.s, e: right.e }
    }
    return left
  }

  const unary = (): Node => {
    const t = peek()
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      next()
      enter(t.s)
      const arg = unary()
      depth--
      return t.v === '-' ? { k: 'neg', arg, s: t.s, e: arg.e } : { ...arg, s: t.s }
    }
    let node = primary()
    while (peek().t === 'op' && peek().v === '%') {
      const p = next()
      node = { k: 'pct', arg: node, s: node.s, e: p.e }
    }
    return node
  }

  const primary = (): Node => {
    const t = next()
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, s: t.s, e: t.e }
      case 'str':
        return { k: 'str', v: t.v, s: t.s, e: t.e }
      case 'bool':
        return { k: 'bool', v: t.v, s: t.s, e: t.e }
      case 'err':
        return { k: 'err', code: t.v, s: t.s, e: t.e }
      case 'ref':
        return { k: 'ref', sheet: t.sheet, a: t.a, b: t.b, cols: t.cols, s: t.s, e: t.e }
      case 'name':
        return { k: 'name', name: t.v, s: t.s, e: t.e }
      case 'lp': {
        enter(t.s)
        const inner = binary(1)
        depth--
        const close = next()
        if (close.t !== 'rp') throw new ParseError('missing ")"', close.s)
        return { ...inner, s: t.s, e: close.e }
      }
      case 'fn': {
        const open = next()
        if (open.t !== 'lp') throw new ParseError('missing "("', open.s)
        enter(t.s)
        const args: Node[] = []
        if (peek().t === 'rp') {
          const close = next()
          depth--
          return { k: 'call', name: t.v, args, s: t.s, e: close.e }
        }
        for (;;) {
          const p = peek()
          // empty argument: IF(A1;;1)
          if (p.t === 'sep' || p.t === 'rp') args.push({ k: 'blank', s: p.s, e: p.s })
          else args.push(binary(1))
          if (args.length > 255) throw new ParseError('more than 255 arguments', p.s)
          const sep = next()
          if (sep.t === 'rp') {
            depth--
            return { k: 'call', name: t.v, args, s: t.s, e: sep.e }
          }
          if (sep.t !== 'sep') throw new ParseError('expected ";" or ")"', sep.s)
        }
      }
      case 'eof':
        throw new ParseError('unexpected end of formula', t.s)
      default:
        throw new ParseError(`unexpected "${'v' in t ? t.v : ''}"`, t.s)
    }
  }

  if (peek().t === 'eof') throw new ParseError('empty formula', 0)
  const root = binary(1)
  const rest = peek()
  if (rest.t !== 'eof') throw new ParseError(`unexpected "${'v' in rest ? rest.v : ''}"`, rest.s)
  return root
}

/** Visit every node (pre-order). */
export function walk(node: Node, fn: (n: Node, parent: Node | null) => void, parent: Node | null = null): void {
  fn(node, parent)
  if (node.k === 'call') for (const a of node.args) walk(a, fn, node)
  else if (node.k === 'neg' || node.k === 'pct') walk(node.arg, fn, node)
  else if (node.k === 'bin') {
    walk(node.l, fn, node)
    walk(node.r, fn, node)
  }
}
