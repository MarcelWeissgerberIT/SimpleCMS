/**
 * One Script — the lexer. Source text → tokens with their places. Strict mode (the parser) throws a
 * ScriptError at the first bad character; tolerant mode (the editor's highlighter) never throws and
 * also returns comments and error tokens, so every character of the source belongs to some token or
 * to whitespace.
 *
 * Newlines end statements; inside ( … ) and [ … ] they are only whitespace (a { } block in there
 * counts them again: `list.map(fn(x) { … })` over several lines).
 */
import { ScriptError, type Pos } from './errors'
import type { RefKind } from './ast'

export const KEYWORDS = new Set(['let', 'if', 'else', 'for', 'in', 'fn', 'return', 'and', 'or', 'not', 'true', 'false', 'null', 'while', 'break', 'continue'])

export type TokType = 'num' | 'dur' | 'str' | 'ident' | 'kw' | 'ref' | 'op' | 'nl' | 'eof' | 'comment' | 'error'

/** A piece of an interpolated string: literal text, or the source of a `{…}` expression and where it starts. */
export type StrPart = string | { src: string; offset: number; line: number; col: number }

export interface Token {
  type: TokType
  /** the raw text */
  text: string
  pos: Pos
  /** num: number · dur: { days, ms } · str: parts · ident: name · ref: { kind, id, label } */
  value?: unknown
  /** ident: written in backticks */
  quoted?: boolean
  /** str: the quote character */
  quote?: '"' | "'"
}

export interface RefValue {
  kind: RefKind
  id: string | null
  label: string
}

const OPS = ['=>', '==', '!=', '<=', '>=', '(', ')', '[', ']', '{', '}', ',', '.', ':', ';', '=', '<', '>', '+', '-', '*', '/', '%', '!']

const isIdStart = (c: string) => /[\p{L}_]/u.test(c)
const isIdPart = (c: string) => /[\p{L}\p{N}_]/u.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'

const DUR_UNITS: Record<string, { days: number; ms: number }> = {
  w: { days: 7, ms: 0 },
  d: { days: 1, ms: 0 },
  h: { days: 0, ms: 3_600_000 },
  m: { days: 0, ms: 60_000 },
  s: { days: 0, ms: 1000 },
  ms: { days: 0, ms: 1 },
}

export const MAX_SOURCE = 200_000

export interface LexOptions {
  /** never throw: bad input becomes 'error' tokens; comments are returned too */
  tolerant?: boolean
  /** where `src` starts inside a larger source (interpolations) */
  base?: { offset: number; line: number; col: number }
}

export function tokenize(src: string, opts: LexOptions = {}): Token[] {
  const tolerant = !!opts.tolerant
  const base = opts.base ?? { offset: 0, line: 1, col: 1 }
  const out: Token[] = []
  let i = 0
  let line = base.line
  let col = base.col
  /** open brackets: newlines count at the top level and directly inside { } (blocks), not inside ( ) / [ ] */
  const open: string[] = []

  const posAt = (start: number, sLine: number, sCol: number): Pos => ({ start: base.offset + start, end: base.offset + i, line: sLine, col: sCol })
  const fail = (code: ConstructorParameters<typeof ScriptError>[0], params: Record<string, string | number>, start: number, sLine: number, sCol: number): void => {
    if (!tolerant) throw new ScriptError(code, params, posAt(start, sLine, sCol))
    out.push({ type: 'error', text: src.slice(start, i), pos: posAt(start, sLine, sCol) })
  }
  /** advance one character, keeping line / col */
  const step = () => {
    if (src[i] === '\n') {
      line++
      col = 1
    } else col++
    i++
  }

  while (i < src.length) {
    const c = src[i]
    const start = i
    const sLine = line
    const sCol = col

    // whitespace (newlines count outside brackets)
    if (c === '\n') {
      step()
      const top = open[open.length - 1]
      if ((top === undefined || top === '{') && out.length && out[out.length - 1].type !== 'nl') out.push({ type: 'nl', text: '\n', pos: posAt(start, sLine, sCol) })
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ') {
      step()
      continue
    }

    // comments: # … and // …
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') step()
      if (tolerant) out.push({ type: 'comment', text: src.slice(start, i), pos: posAt(start, sLine, sCol) })
      continue
    }

    // numbers and durations: 12 · 3.5 · 1_000 · 3d · 2h · 30m · 1w · 45s · 500ms
    if (isDigit(c)) {
      while (i < src.length && (isDigit(src[i]) || (src[i] === '_' && isDigit(src[i + 1] ?? '')))) step()
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        step()
        while (i < src.length && (isDigit(src[i]) || (src[i] === '_' && isDigit(src[i + 1] ?? '')))) step()
      }
      const numText = src.slice(start, i)
      const n = Number(numText.replace(/_/g, ''))
      // a unit right after the number (and no further letters): a duration
      let unit = ''
      if (src.startsWith('ms', i) && !isIdPart(src[i + 2] ?? '')) unit = 'ms'
      else if (/[wdhms]/.test(src[i] ?? '') && !isIdPart(src[i + 1] ?? '')) unit = src[i]
      if (unit) {
        for (let k = 0; k < unit.length; k++) step()
        const u = DUR_UNITS[unit]
        out.push({ type: 'dur', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: { days: u.days * n, ms: u.ms * n } })
        continue
      }
      if (isIdPart(src[i] ?? '')) {
        while (i < src.length && isIdPart(src[i])) step()
        fail('bad_number', { text: src.slice(start, i) }, start, sLine, sCol)
        continue
      }
      if (!Number.isFinite(n)) {
        fail('bad_number', { text: numText }, start, sLine, sCol)
        continue
      }
      out.push({ type: 'num', text: numText, pos: posAt(start, sLine, sCol), value: n })
      continue
    }

    // strings: "… {expr} …" (interpolated) and '…' (plain)
    if (c === '"' || c === "'") {
      const quote = c
      step()
      const parts: StrPart[] = []
      let buf = ''
      let closed = false
      while (i < src.length) {
        const ch = src[i]
        if (ch === quote) {
          step()
          closed = true
          break
        }
        if (ch === '\n') break
        if (ch === '\\') {
          const nx = src[i + 1] ?? ''
          const map: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'", '{': '{', '}': '}', '0': '\0' }
          step()
          if (nx in map) {
            buf += map[nx]
            step()
          } else buf += '\\'
          continue
        }
        if (ch === '{' && quote === '"') {
          // find the matching } (strings inside count, nested braces too)
          const exprStart = i + 1
          const eLine = line
          const eCol = col + 1
          let d = 1
          let j = i + 1
          let inStr: string | null = null
          while (j < src.length && src[j] !== '\n') {
            const cj = src[j]
            if (inStr) {
              if (cj === '\\') j++
              else if (cj === inStr) inStr = null
            } else if (cj === '"' || cj === "'") inStr = cj
            else if (cj === '{') d++
            else if (cj === '}' && --d === 0) break
            j++
          }
          if (d !== 0 || j >= src.length || src[j] !== '}') {
            while (i < src.length && src[i] !== '\n' && src[i] !== quote) step()
            fail('bad_interpolation', {}, start, sLine, sCol)
            buf = ''
            closed = true
            if (src[i] === quote) step()
            parts.length = 0
            break
          }
          if (buf) parts.push(buf)
          buf = ''
          parts.push({ src: src.slice(exprStart, j), offset: base.offset + exprStart, line: eLine, col: eCol })
          while (i <= j) step()
          continue
        }
        buf += ch
        step()
      }
      if (!closed) {
        fail('unterminated_string', {}, start, sLine, sCol)
        continue
      }
      if (out.length && out[out.length - 1].type === 'error' && out[out.length - 1].pos.start === base.offset + start) continue
      if (buf || !parts.length) parts.push(buf)
      out.push({ type: 'str', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: parts, quote })
      continue
    }

    // identifiers in backticks: `Fällig am`
    if (c === '`') {
      step()
      while (i < src.length && src[i] !== '`' && src[i] !== '\n') step()
      if (src[i] !== '`') {
        fail('unterminated_ident', {}, start, sLine, sCol)
        continue
      }
      step()
      const name = src.slice(start + 1, i - 1)
      out.push({ type: 'ident', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: name, quoted: true })
      continue
    }

    // @ references: @[Label](p:id) · @Name · @"Some name"
    if (c === '@') {
      step()
      if (src[i] === '[') {
        step()
        let label = ''
        while (i < src.length && src[i] !== ']' && src[i] !== '\n') {
          if (src[i] === '\\' && (src[i + 1] === ']' || src[i + 1] === '\\')) step()
          label += src[i]
          step()
        }
        const m = src[i] === ']' ? /^\]\((p|u|a|s):([\w-]{1,64})\)/.exec(src.slice(i)) : null
        if (!m) {
          while (i < src.length && src[i] !== '\n' && src[i] !== ')' && src[i] !== ' ') step()
          if (src[i] === ')') step()
          fail('bad_ref', {}, start, sLine, sCol)
          continue
        }
        for (let k = 0; k < m[0].length; k++) step()
        out.push({ type: 'ref', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: { kind: m[1] as RefKind, id: m[2], label } satisfies RefValue })
        continue
      }
      if (src[i] === '"') {
        step()
        while (i < src.length && src[i] !== '"' && src[i] !== '\n') step()
        if (src[i] !== '"') {
          fail('bad_ref', {}, start, sLine, sCol)
          continue
        }
        step()
        const label = src.slice(start + 2, i - 1)
        out.push({ type: 'ref', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: { kind: 'name', id: null, label } satisfies RefValue })
        continue
      }
      if (isIdStart(src[i] ?? '')) {
        while (i < src.length && isIdPart(src[i])) step()
        out.push({ type: 'ref', text: src.slice(start, i), pos: posAt(start, sLine, sCol), value: { kind: 'name', id: null, label: src.slice(start + 1, i) } satisfies RefValue })
        continue
      }
      fail('bad_ref', {}, start, sLine, sCol)
      continue
    }

    // identifiers and keywords
    if (isIdStart(c)) {
      while (i < src.length && isIdPart(src[i])) step()
      const word = src.slice(start, i)
      out.push({ type: KEYWORDS.has(word) ? 'kw' : 'ident', text: word, pos: posAt(start, sLine, sCol), value: word })
      continue
    }

    // operators and punctuation
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      for (let k = 0; k < op.length; k++) step()
      if (op === '(' || op === '[' || op === '{') open.push(op)
      else if (op === ')' || op === ']' || op === '}') {
        const want = op === ')' ? '(' : op === ']' ? '[' : '{'
        // a stray closer leaves the others as they are (the parser reports it)
        const at = open.lastIndexOf(want)
        if (at >= 0) open.length = at
      }
      out.push({ type: 'op', text: op, pos: posAt(start, sLine, sCol) })
      continue
    }

    step()
    fail('bad_char', { char: JSON.stringify(c) }, start, sLine, sCol)
  }
  out.push({ type: 'eof', text: '', pos: { start: base.offset + i, end: base.offset + i, line, col } })
  return out
}
