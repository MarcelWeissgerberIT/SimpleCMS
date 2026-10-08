/**
 * Bracket pairs of a text (pure): ( [ { and their closers, outside strings, comments and inline code (the
 * tokens say where those are). A closer that does not fit the innermost opener closes the nearest opener of
 * its kind further out; every opener it skips is unmatched — "t.set(" left open shows on its own line, not
 * only where the parser gave up.
 */
import type { CodeToken, SynClass } from './types'

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
/** inside these a bracket is text */
const OPAQUE = new Set<SynClass>(['str', 'comment', 'code', 'regex', 'ph', 'ref', 'link', 'tool'])

export interface Brackets {
  /** offset → offset of its partner (both directions) */
  pairs: Map<number, number>
  /** offsets of brackets without a partner (openers and closers) */
  unmatched: number[]
}

export function scanBrackets(code: string, tokens: CodeToken[] = []): Brackets {
  const pairs = new Map<number, number>()
  const unmatched: number[] = []
  const stack: number[] = []
  let ti = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (!(c in OPEN) && !(c in CLOSE)) continue
    while (ti < tokens.length && tokens[ti].end <= i) ti++
    const tk = tokens[ti]
    if (tk && tk.start <= i && OPAQUE.has(tk.cls)) continue
    if (c in OPEN) {
      stack.push(i)
      continue
    }
    const want = CLOSE[c]
    let at = stack.length - 1
    while (at >= 0 && code[stack[at]] !== want) at--
    if (at < 0) {
      unmatched.push(i)
      continue
    }
    for (let k = stack.length - 1; k > at; k--) unmatched.push(stack[k])
    pairs.set(stack[at], i)
    pairs.set(i, stack[at])
    stack.length = at
  }
  unmatched.push(...stack)
  unmatched.sort((a, b) => a - b)
  return { pairs, unmatched }
}

/** The bracket pair at a caret: the bracket right before it, else the one right after it. */
export function pairAt(b: Brackets, code: string, caret: number): [number, number] | null {
  for (const at of [caret - 1, caret]) {
    if (at < 0 || at >= code.length) continue
    const other = b.pairs.get(at)
    if (other !== undefined) return [Math.min(at, other), Math.max(at, other)]
  }
  return null
}

export const isOpener = (c: string) => c in OPEN
