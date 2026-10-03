/**
 * Formula tokenizer. Every token keeps its source span: the parser builds the AST from them, the
 * reference adjuster rewrites ref tokens in place (keeping the author's spacing) and the formula
 * bar colours them. Never executes anything — it only reads characters.
 */
import { colIndex } from './refs'
import type { ErrorCode } from './types'
import { ERROR_CODES } from './values'

export interface RefPart {
  col: number
  /** -1 for whole columns */
  row: number
  colAbs: boolean
  rowAbs: boolean
}

export interface RefTok {
  t: 'ref'
  s: number
  e: number
  /** sheet name as written (unquoted), null = the formula's own sheet */
  sheet: string | null
  a: RefPart
  /** second corner of a range */
  b: RefPart | null
  /** whole columns ("B:B") */
  cols: boolean
}

export type Tok =
  | { t: 'num'; v: number; s: number; e: number }
  | { t: 'str'; v: string; s: number; e: number }
  | { t: 'bool'; v: boolean; s: number; e: number }
  | { t: 'err'; v: ErrorCode; s: number; e: number }
  | RefTok
  | { t: 'fn' | 'name' | 'op' | 'sep'; v: string; s: number; e: number }
  | { t: 'lp' | 'rp' | 'eof'; v: ''; s: number; e: number }
  | { t: 'bad'; v: string; s: number; e: number }

export class ParseError extends Error {
  pos: number
  constructor(msg: string, pos: number) {
    super(msg)
    this.pos = pos
  }
}

const IDENT_START = /[\p{L}_]/u
const IDENT = /^[\p{L}_][\p{L}\p{N}_.]*/u
const NUM = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i
const REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?/
const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/
const AFTER_REF = /[\p{L}\p{N}_.(!$]/u
const OPS2 = ['<>', '<=', '>=']
const OPS1 = '+-*/^&=<>%'

function part(colAbs: string, col: string, rowAbs: string, row: string | null): RefPart {
  return { col: colIndex(col), row: row === null ? -1 : Number(row) - 1, colAbs: colAbs === '$', rowAbs: rowAbs === '$' }
}

/** A reference at `i` (after an optional sheet prefix), or null. */
function readRef(src: string, i: number, sheet: string | null, start: number): RefTok | null {
  const rest = src.slice(i)
  const m = REF.exec(rest)
  if (m && !AFTER_REF.test(rest[m[0].length] ?? '')) {
    const a = part(m[1], m[2], m[3], m[4])
    const b = m[6] ? part(m[5], m[6], m[7], m[8]) : null
    if (a.row < 0 || (b && b.row < 0)) return null
    return { t: 'ref', s: start, e: i + m[0].length, sheet, a, b, cols: false }
  }
  const c = COLS.exec(rest)
  if (c && !AFTER_REF.test(rest[c[0].length] ?? '')) {
    return { t: 'ref', s: start, e: i + c[0].length, sheet, a: part(c[1], c[2], '', null), b: part(c[3], c[4], '', null), cols: true }
  }
  return null
}

/**
 * Tokens of a formula body (without the leading "="). `lenient`: never throws — the rest of the
 * text after a problem becomes one `bad` token (formula bar colouring while typing).
 */
export function lex(src: string, lenient = false): Tok[] {
  const out: Tok[] = []
  let i = 0
  const fail = (msg: string, at: number): never => {
    throw new ParseError(msg, at)
  }
  try {
    while (i < src.length) {
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ') {
        i++
        continue
      }
      // numbers
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const m = NUM.exec(src.slice(i))!
        out.push({ t: 'num', v: Number(m[0]), s: i, e: i + m[0].length })
        i += m[0].length
        continue
      }
      // "text" ("" = a quote)
      if (c === '"') {
        let j = i + 1
        let s = ''
        for (;;) {
          if (j >= src.length) fail('unterminated text', i)
          if (src[j] === '"') {
            if (src[j + 1] === '"') {
              s += '"'
              j += 2
              continue
            }
            break
          }
          s += src[j++]
        }
        out.push({ t: 'str', v: s, s: i, e: j + 1 })
        i = j + 1
        continue
      }
      // 'Sheet name'!A1
      if (c === "'") {
        let j = i + 1
        let name = ''
        for (;;) {
          if (j >= src.length) fail('unterminated sheet name', i)
          if (src[j] === "'") {
            if (src[j + 1] === "'") {
              name += "'"
              j += 2
              continue
            }
            break
          }
          name += src[j++]
        }
        if (src[j + 1] !== '!') fail('sheet name without a reference', i)
        const ref = readRef(src, j + 2, name, i)
        if (!ref) fail('missing reference after the sheet name', j + 2)
        out.push(ref!)
        i = ref!.e
        continue
      }
      // #REF! / #N/A … typed (or left behind by a deleted row)
      if (c === '#') {
        const code = ERROR_CODES.find((x) => src.slice(i, i + x.length).toUpperCase() === x)
        if (!code) fail('unknown error value', i)
        out.push({ t: 'err', v: code!, s: i, e: i + code!.length })
        i += code!.length
        continue
      }
      if (c === '$' || IDENT_START.test(c)) {
        const id = IDENT.exec(src.slice(i))
        // Sheet2!A1
        if (id && src[i + id[0].length] === '!') {
          const ref = readRef(src, i + id[0].length + 1, id[0], i)
          if (!ref) fail('missing reference after the sheet name', i + id[0].length + 1)
          out.push(ref!)
          i = ref!.e
          continue
        }
        const ref = readRef(src, i, null, i)
        if (ref) {
          out.push(ref)
          i = ref.e
          continue
        }
        if (!id) fail('unexpected "$"', i)
        const word = id![0]
        let j = i + word.length
        while (src[j] === ' ') j++
        if (src[j] === '(') out.push({ t: 'fn', v: word.toUpperCase(), s: i, e: i + word.length })
        else if (/^(TRUE|FALSE)$/i.test(word)) out.push({ t: 'bool', v: word.toUpperCase() === 'TRUE', s: i, e: i + word.length })
        else out.push({ t: 'name', v: word, s: i, e: i + word.length })
        i += word.length
        continue
      }
      const op2 = OPS2.find((o) => src.startsWith(o, i))
      if (op2) {
        out.push({ t: 'op', v: op2, s: i, e: i + 2 })
        i += 2
        continue
      }
      if (OPS1.includes(c)) {
        out.push({ t: 'op', v: c, s: i, e: i + 1 })
        i++
        continue
      }
      if (c === ',' || c === ';') {
        out.push({ t: 'sep', v: c, s: i, e: i + 1 })
        i++
        continue
      }
      if (c === '(' || c === ')') {
        out.push({ t: c === '(' ? 'lp' : 'rp', v: '', s: i, e: i + 1 })
        i++
        continue
      }
      fail(`unexpected "${c}"`, i)
    }
  } catch (e) {
    if (!lenient || !(e instanceof ParseError)) throw e
    out.push({ t: 'bad', v: src.slice(i), s: i, e: src.length })
    i = src.length
  }
  out.push({ t: 'eof', v: '', s: src.length, e: src.length })
  return out
}
