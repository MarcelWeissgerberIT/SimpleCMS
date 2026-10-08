/**
 * A small JSON parser that knows where everything is: the value, plus the position of every value and key by its
 * path (so a schema problem at `$.recipes[0].database.views[2].groupBy` can point at its line), and a parse error
 * with its line and column (codes, translated by the editor). Strict JSON (RFC 8259): no comments, no trailing
 * commas, duplicate keys are an error. Pure; never eval.
 */

export interface JsonPos {
  offset: number
  line: number
  col: number
}

export interface JsonSpan {
  /** where the key starts (object members) */
  key?: JsonPos
  /** where the value starts and ends */
  start: JsonPos
  end: JsonPos
}

export type JsonErrorCode = 'empty' | 'unexpected' | 'end' | 'string' | 'escape' | 'control' | 'number' | 'expectedColon' | 'expectedComma' | 'expectedKey' | 'trailingComma' | 'trailing' | 'duplicateKey' | 'depth'

export interface JsonError {
  code: JsonErrorCode
  /** the character or key it is about */
  near?: string
  pos: JsonPos
}

export interface JsonResult {
  value?: unknown
  error?: JsonError
  /** path key (pathKey) → its span */
  spans: Map<string, JsonSpan>
}

export type JsonPath = Array<string | number>
export const pathKey = (path: JsonPath): string => JSON.stringify(path)

/** `$.recipes[0].database` — how a path reads. */
export function pathText(path: JsonPath): string {
  let out = '$'
  for (const seg of path) out += typeof seg === 'number' ? `[${seg}]` : /^[A-Za-z_$][\w$]*$/.test(seg) ? `.${seg}` : `[${JSON.stringify(seg)}]`
  return out
}

const MAX_DEPTH = 64

class Fail extends Error {
  constructor(readonly e: JsonError) {
    super(e.code)
  }
}

export function parseJson(text: string): JsonResult {
  const spans = new Map<string, JsonSpan>()
  // line starts for offset → line / column
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  const posOf = (offset: number): JsonPos => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { offset, line: lo + 1, col: offset - starts[lo] + 1 }
  }
  let i = 0
  const fail = (code: JsonErrorCode, at = i, near?: string): never => {
    throw new Fail({ code, pos: posOf(Math.min(at, text.length)), ...(near !== undefined ? { near } : {}) })
  }
  const ws = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const charAt = (at: number) => (at < text.length ? text[at] : '')

  const str = (): string => {
    // at the opening quote
    const open = i
    i++
    let out = ''
    for (;;) {
      if (i >= text.length) fail('string', open)
      const c = text[i]
      if (c === '"') {
        i++
        return out
      }
      if (c === '\\') {
        const n = text[i + 1]
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (n === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('escape', i)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else if (n !== undefined && n in map) {
          out += map[n]
          i += 2
        } else fail('escape', i)
        continue
      }
      if (c.charCodeAt(0) < 32) fail(c === '\n' ? 'string' : 'control', c === '\n' ? open : i)
      out += c
      i++
    }
  }

  const num = (): number => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64))
    if (!m || !m[0] || m[0] === '-') fail('number')
    const after = charAt(i + m![0].length)
    if (/[0-9A-Za-z.]/.test(after)) fail('number')
    i += m![0].length
    return Number(m![0])
  }

  const value = (path: JsonPath, depth: number, key?: JsonPos): unknown => {
    ws()
    if (depth > MAX_DEPTH) fail('depth')
    const start = posOf(i)
    const c = charAt(i)
    let v: unknown
    if (c === '{') {
      i++
      // own properties only ("__proto__" stays a plain key, never the prototype)
      const o: Record<string, unknown> = {}
      ws()
      if (charAt(i) === '}') i++
      else
        for (;;) {
          ws()
          if (charAt(i) !== '"') fail(charAt(i) === '}' ? 'trailingComma' : i >= text.length ? 'end' : 'expectedKey', i, charAt(i))
          const kpos = posOf(i)
          const k = str()
          if (Object.prototype.hasOwnProperty.call(o, k)) fail('duplicateKey', kpos.offset, k)
          ws()
          if (charAt(i) !== ':') fail(i >= text.length ? 'end' : 'expectedColon', i, charAt(i))
          i++
          Object.defineProperty(o, k, { value: value([...path, k], depth + 1, kpos), enumerable: true, writable: true, configurable: true })
          ws()
          if (charAt(i) === ',') {
            i++
            continue
          }
          if (charAt(i) === '}') {
            i++
            break
          }
          fail(i >= text.length ? 'end' : 'expectedComma', i, charAt(i))
        }
      v = o
    } else if (c === '[') {
      i++
      const a: unknown[] = []
      ws()
      if (charAt(i) === ']') i++
      else
        for (;;) {
          ws()
          if (charAt(i) === ']') fail('trailingComma')
          a.push(value([...path, a.length], depth + 1))
          ws()
          if (charAt(i) === ',') {
            i++
            continue
          }
          if (charAt(i) === ']') {
            i++
            break
          }
          fail(i >= text.length ? 'end' : 'expectedComma', i, charAt(i))
        }
      v = a
    } else if (c === '"') v = str()
    else if (c === '-' || (c >= '0' && c <= '9')) v = num()
    else if (text.startsWith('true', i)) {
      i += 4
      v = true
    } else if (text.startsWith('false', i)) {
      i += 5
      v = false
    } else if (text.startsWith('null', i)) {
      i += 4
      v = null
    } else if (i >= text.length) fail('end')
    else fail('unexpected', i, c)
    spans.set(pathKey(path), { ...(key ? { key } : {}), start, end: posOf(i) })
    return v
  }

  try {
    ws()
    if (i >= text.length) fail('empty')
    const v = value([], 0)
    ws()
    if (i < text.length) fail('trailing', i, text[i])
    return { value: v, spans }
  } catch (e) {
    if (e instanceof Fail) return { error: e.e, spans }
    throw e
  }
}

/** The span closest to a path: the path itself, else its nearest ancestor that has one. */
export function spanAt(spans: Map<string, JsonSpan>, path: JsonPath): { span: JsonSpan; exact: boolean } | null {
  for (let n = path.length; n >= 0; n--) {
    const s = spans.get(pathKey(path.slice(0, n)))
    if (s) return { span: s, exact: n === path.length }
  }
  return null
}

/** Pretty JSON as the editor shows it (2 spaces). */
export const stringify = (v: unknown): string => JSON.stringify(v, null, 2)
