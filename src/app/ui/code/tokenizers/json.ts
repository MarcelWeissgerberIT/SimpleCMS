/**
 * JSON for the code area (pure): the tokenizer (keys apart from string values; // and /* *\/ comments are
 * read, JSONC-style), the first syntax error with its place (`jsonError`), and where a value sits in the text
 * (`jsonPathRange`) — so a caller that checks a configuration against its own schema can put its messages
 * on the exact key or value (CodeMarker).
 */
import type { CodeToken } from '../types'
import { lineColAt, lineStarts } from '../lines'

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD = /[A-Za-z_$][\w$]*/y

/** The end of the string starting at i (the closing quote included; an unclosed one ends at the line end). */
function stringEnd(code: string, i: number): { end: number; closed: boolean } {
  let j = i + 1
  while (j < code.length && code[j] !== '\n') {
    if (code[j] === '\\') j += 2
    else if (code[j] === '"') return { end: j + 1, closed: true }
    else j++
  }
  return { end: Math.min(j, code.length), closed: false }
}

/** Skips whitespace and comments from i. */
function skip(code: string, i: number): number {
  for (;;) {
    while (i < code.length && isWs(code[i])) i++
    if (code.startsWith('//', i)) {
      const nl = code.indexOf('\n', i)
      i = nl < 0 ? code.length : nl
    } else if (code.startsWith('/*', i)) {
      const close = code.indexOf('*/', i + 2)
      i = close < 0 ? code.length : close + 2
    } else return i
  }
}

export function tokenizeJson(code: string): CodeToken[] {
  const out: CodeToken[] = []
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if (isWs(c)) {
      i++
      continue
    }
    if (code.startsWith('//', i) || code.startsWith('/*', i)) {
      const end = skip(code, i)
      // skip() also eats the whitespace after the comment
      let e = end
      while (e > i && isWs(code[e - 1])) e--
      out.push({ start: i, end: e, cls: 'comment' })
      i = end
      continue
    }
    if (c === '"') {
      const s = stringEnd(code, i)
      const key = s.closed && code[skip(code, s.end)] === ':'
      out.push({ start: i, end: s.end, cls: s.closed ? (key ? 'key' : 'str') : 'err' })
      i = s.end
      continue
    }
    if (c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':') {
      out.push({ start: i, end: i + 1, cls: 'punct' })
      i++
      continue
    }
    NUM.lastIndex = i
    const n = NUM.exec(code)
    if (n && n[0].length && !/[\w.]/.test(code[i + n[0].length] ?? '')) {
      out.push({ start: i, end: i + n[0].length, cls: 'num' })
      i += n[0].length
      continue
    }
    WORD.lastIndex = i
    const w = WORD.exec(code)
    if (w) {
      out.push({ start: i, end: i + w[0].length, cls: w[0] === 'true' || w[0] === 'false' || w[0] === 'null' ? 'lit' : 'err' })
      i += w[0].length
      continue
    }
    // anything else: up to the next space or structural character
    let j = i + 1
    while (j < code.length && !isWs(code[j]) && !'{}[],:"'.includes(code[j])) j++
    out.push({ start: i, end: j, cls: 'err' })
    i = j
  }
  return out
}

/* ------------------------------------------------------------------ the parser (errors + places) */

export type JsonErrorCode = 'unexpected' | 'end' | 'unterminated' | 'colon' | 'commaOrClose' | 'key' | 'trailing' | 'trailingComma' | 'duplicate'

export interface JsonError {
  code: JsonErrorCode
  /** offsets of what is wrong */
  start: number
  end: number
  line: number
  col: number
  endCol: number
  /** the text found there (empty at the end) */
  found: string
}

type PathKey = string | number
interface Place {
  /** the key's quotes included (properties only) */
  key?: { start: number; end: number }
  value: { start: number; end: number }
}

class Fail extends Error {
  constructor(
    readonly code: JsonErrorCode,
    readonly start: number,
    readonly end: number,
  ) {
    super(code)
  }
}

/** Reads the whole text; returns the places of every value by path. Throws Fail at the first error. */
function parse(code: string, places: Map<string, Place> | null, strictDuplicates: boolean): void {
  let i = 0
  const tokenEnd = (at: number) => {
    let j = at + 1
    while (j < code.length && !isWs(code[j]) && !'{}[],:'.includes(code[j])) j++
    return j
  }
  const value = (path: PathKey[], key?: Place['key']): void => {
    i = skip(code, i)
    if (i >= code.length) throw new Fail('end', i, i)
    const start = i
    const c = code[i]
    if (c === '{') {
      i++
      const seen = new Set<string>()
      i = skip(code, i)
      if (code[i] === '}') i++
      else
        for (;;) {
          i = skip(code, i)
          if (code[i] !== '"') throw new Fail(i >= code.length ? 'end' : 'key', i, i >= code.length ? i : tokenEnd(i))
          const ks = i
          const s = stringEnd(code, i)
          if (!s.closed) throw new Fail('unterminated', ks, s.end)
          let name: string
          try {
            name = JSON.parse(code.slice(ks, s.end)) as string
          } catch {
            throw new Fail('unexpected', ks, s.end)
          }
          if (strictDuplicates && seen.has(name)) throw new Fail('duplicate', ks, s.end)
          seen.add(name)
          i = skip(code, s.end)
          if (code[i] !== ':') throw new Fail(i >= code.length ? 'end' : 'colon', i, i >= code.length ? i : tokenEnd(i))
          i++
          value([...path, name], { start: ks, end: s.end })
          i = skip(code, i)
          if (code[i] === ',') {
            const comma = i
            i = skip(code, i + 1)
            if (code[i] === '}') throw new Fail('trailingComma', comma, comma + 1)
            continue
          }
          if (code[i] === '}') {
            i++
            break
          }
          throw new Fail(i >= code.length ? 'end' : 'commaOrClose', i, i >= code.length ? i : tokenEnd(i))
        }
    } else if (c === '[') {
      i++
      i = skip(code, i)
      if (code[i] === ']') i++
      else
        for (let n = 0; ; n++) {
          value([...path, n])
          i = skip(code, i)
          if (code[i] === ',') {
            const comma = i
            i = skip(code, i + 1)
            if (code[i] === ']') throw new Fail('trailingComma', comma, comma + 1)
            continue
          }
          if (code[i] === ']') {
            i++
            break
          }
          throw new Fail(i >= code.length ? 'end' : 'commaOrClose', i, i >= code.length ? i : tokenEnd(i))
        }
    } else if (c === '"') {
      const s = stringEnd(code, i)
      if (!s.closed) throw new Fail('unterminated', i, s.end)
      try {
        JSON.parse(code.slice(i, s.end))
      } catch {
        throw new Fail('unexpected', i, s.end)
      }
      i = s.end
    } else {
      NUM.lastIndex = i
      const n = NUM.exec(code)
      WORD.lastIndex = i
      const w = WORD.exec(code)
      if (n && n[0].length && !/[\w.]/.test(code[i + n[0].length] ?? '')) i += n[0].length
      else if (w && (w[0] === 'true' || w[0] === 'false' || w[0] === 'null')) i += w[0].length
      else throw new Fail('unexpected', i, tokenEnd(i))
    }
    places?.set(JSON.stringify(path), { key, value: { start, end: i } })
  }
  value([])
  i = skip(code, i)
  if (i < code.length) throw new Fail('trailing', i, tokenEnd(i))
}

/**
 * The first syntax error of a JSON text, or null when it is valid. Comments are allowed (JSONC); `strict` also
 * refuses a key used twice in one object.
 */
export function jsonError(code: string, opts: { strict?: boolean } = {}): JsonError | null {
  if (!code.trim()) return null
  try {
    parse(code, null, !!opts.strict)
    return null
  } catch (e) {
    if (!(e instanceof Fail)) throw e
    const starts = lineStarts(code)
    const at = lineColAt(starts, e.start)
    const endAt = lineColAt(starts, Math.max(e.start, e.end))
    return { code: e.code, start: e.start, end: e.end, line: at.line, col: at.col, endCol: endAt.line === at.line ? endAt.col : at.col + 1, found: code.slice(e.start, e.end) }
  }
}

/**
 * Where the value at a path sits (["requires", "tools", 1] → the second tool's string), or with `on: 'key'`
 * its key. Null when the text does not parse or has no such path. Line / col are 1-based, endCol exclusive.
 */
export function jsonPathRange(code: string, path: PathKey[], on: 'value' | 'key' = 'value'): { line: number; col: number; endLine: number; endCol: number } | null {
  const places = new Map<string, Place>()
  try {
    parse(code, places, false)
  } catch {
    return null
  }
  const p = places.get(JSON.stringify(path))
  if (!p) return null
  const r = on === 'key' && p.key ? p.key : p.value
  const starts = lineStarts(code)
  const a = lineColAt(starts, r.start)
  const b = lineColAt(starts, r.end)
  return { line: a.line, col: a.col, endLine: b.line, endCol: b.col }
}
