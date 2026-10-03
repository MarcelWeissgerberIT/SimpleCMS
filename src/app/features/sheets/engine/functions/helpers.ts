/** Shared helpers for the built-in library: argument coercion, number collection, criteria. */
import type { CellValue, ErrorValue, FnArg, FnCategory, FnCtx, FnSpec, Value, ValueHint } from '../types'
import { cellsOf, compare, err, isErr, isMulti, parseNumeric, toBool, toNumber, toScalar, toText } from '../values'

/** Compact spec builder: def('SUM', 'math', [args], en, de, example, impl, extra?) */
export function def(
  name: string,
  category: FnCategory,
  args: FnArg[],
  en: string,
  de: string,
  example: string,
  impl: (args: Value[], ctx: FnCtx) => Value,
  extra: { keywords?: string; returns?: ValueHint; volatile?: boolean; min?: number; max?: number | null } = {},
): FnSpec {
  const repeat = args.some((a) => a.repeat)
  const min = extra.min ?? args.filter((a) => !a.optional).length
  const max = extra.max !== undefined ? extra.max : repeat ? 255 : args.length
  return { name, category, minArgs: min, maxArgs: max, args, description: { en, de }, example, impl, keywords: extra.keywords, returns: extra.returns ?? null, volatile: extra.volatile }
}

export const arg = (name: string, type: FnArg['type'], opts: { optional?: boolean; repeat?: boolean } = {}): FnArg => ({ name, type, ...opts })

/** One number argument (errors returned as they are). */
export function n(v: Value | undefined, fallback?: number): number | ErrorValue {
  if (v === undefined || (v === null && fallback !== undefined)) return fallback ?? 0
  return toNumber(v)
}

export function s(v: Value | undefined, fallback = ''): string | ErrorValue {
  if (v === undefined) return fallback
  return toText(v)
}

export function b(v: Value | undefined, fallback = false): boolean | ErrorValue {
  if (v === undefined || v === null) return fallback
  return toBool(v)
}

/** Integer argument (truncated). */
export function int(v: Value | undefined, fallback?: number): number | ErrorValue {
  const x = n(v, fallback)
  return isErr(x) ? x : Math.trunc(x)
}

/**
 * Numbers for aggregates (SUM, AVERAGE …), Excel rules: inside ranges / datasets only numbers
 * count (text, booleans, blanks are skipped; errors propagate); direct arguments are coerced
 * (TRUE = 1, "12" = 12, other text = #VALUE!).
 */
export function numbers(args: Value[], ctx?: FnCtx): number[] | ErrorValue {
  const out: number[] = []
  for (const a of args) {
    if (isMulti(a)) {
      for (const c of cellsOf(a)) {
        if (typeof c === 'number') out.push(c)
        else if (isErr(c)) return c
      }
      ctx?.tick(1 + (out.length >> 6))
      continue
    }
    if (a === null) continue
    const x = toNumber(a)
    if (isErr(x)) return x
    out.push(x)
  }
  return out
}

/** Every cell value of the arguments (ranges / datasets flattened, scalars as they are). */
export function flat(args: Value[]): CellValue[] {
  const out: CellValue[] = []
  for (const a of args) for (const c of cellsOf(a)) out.push(c)
  return out
}

/** A value as one cell (no ranges). */
export const one = (v: Value): CellValue => toScalar(v)

/* ------------------------------------------------------------------ */
/* Criteria (COUNTIF, SUMIF …, and wildcard matching)                  */
/* ------------------------------------------------------------------ */

const ANY = 1
const ONE = 2
type Glob = Array<string | typeof ANY | typeof ONE>

/** "a*b?c" (Excel wildcards, ~ escapes) → pattern items, lower-cased. */
function compileGlob(pattern: string): Glob {
  const out: Glob = []
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '~' && i + 1 < pattern.length) out.push(pattern[++i].toLowerCase())
    else if (c === '*') out.push(ANY)
    else if (c === '?') out.push(ONE)
    else out.push(c.toLowerCase())
  }
  return out
}

/**
 * Wildcard match of the whole text, case-insensitive. Iterative two-pointer matching: O(n·m) at
 * worst — no regular expressions built from user input (no catastrophic backtracking).
 */
export function globMatch(pattern: string | Glob, text: string): boolean {
  const p = typeof pattern === 'string' ? compileGlob(pattern) : pattern
  const t = text.toLowerCase()
  let i = 0
  let j = 0
  let star = -1
  let mark = 0
  while (i < t.length) {
    if (j < p.length && (p[j] === ONE || (p[j] !== ANY && p[j] === t[i]))) {
      i++
      j++
    } else if (j < p.length && p[j] === ANY) {
      star = j++
      mark = i
    } else if (star >= 0) {
      j = star + 1
      i = ++mark
    } else return false
  }
  while (j < p.length && p[j] === ANY) j++
  return j === p.length
}

/** First position (0-based) where the wildcard pattern matches the start of the rest of the text, or -1. */
export function globSearch(pattern: string, text: string, from: number, ctx?: FnCtx): number {
  const p = compileGlob(pattern)
  p.push(ANY)
  for (let i = from; i <= text.length; i++) {
    ctx?.tick(1 + ((text.length - i) >> 4))
    if (globMatch(p, text.slice(i))) return i
  }
  return -1
}

export const hasWildcard = (s: string) => /(^|[^~])[*?]/.test(s)

/** A criterion ("&gt;5", "&lt;&gt;x", "a*", 10, TRUE) as a test. */
export function criterion(raw: Value): (v: CellValue) => boolean {
  const c = toScalar(raw)
  if (isErr(c)) return () => false
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v !== null && !isErr(v) && compare(v, c) === 0
  const str = c ?? ''
  const m = /^(<>|>=|<=|=|>|<)?([\s\S]*)$/.exec(str)!
  const op = m[1] ?? '='
  const rest = m[2]
  const asNum = parseNumeric(rest)
  const target: CellValue = rest === '' ? null : asNum !== null ? asNum : /^(TRUE|FALSE)$/i.test(rest) ? rest.toUpperCase() === 'TRUE' : rest
  if (op === '=' || op === '<>') {
    let eq: (v: CellValue) => boolean
    if (target === null) eq = (v) => v === null || v === ''
    else if (typeof target === 'string' && hasWildcard(target)) {
      const glob = compileGlob(target)
      eq = (v) => typeof v === 'string' && globMatch(glob, v)
    } else if (typeof target === 'string') {
      const t = target.replace(/~([*?~])/g, '$1').toLowerCase()
      eq = (v) => typeof v === 'string' && v.toLowerCase() === t
    } else eq = (v) => v !== null && !isErr(v) && typeof v === typeof target && compare(v, target) === 0
    return op === '=' ? eq : (v) => !eq(v)
  }
  return (v) => {
    if (v === null || isErr(v) || target === null) return false
    if (typeof target === 'number' ? typeof v !== 'number' : typeof v !== typeof target) return false
    const d = compare(v, target)
    return op === '>' ? d > 0 : op === '>=' ? d >= 0 : op === '<' ? d < 0 : d <= 0
  }
}

/** Half away from zero, to `digits` decimals (negative: tens, hundreds …), 15 significant digits. */
export function roundTo(x: number, digits: number, mode: 'round' | 'up' | 'down' = 'round'): number {
  const d = Math.trunc(digits)
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const f = Math.pow(10, Math.abs(d))
  const scaled = Number((d >= 0 ? a * f : a / f).toPrecision(15))
  const r = mode === 'round' ? Math.round(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled)
  return sign * (d >= 0 ? r / f : r * f)
}

export { err, isErr }
