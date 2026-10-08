/** Line arithmetic for the code area (pure): offsets ⇄ line / column, tokens cut into lines. */
import type { CodeMarker, CodeToken, SynClass } from './types'

/** The offset each line starts at (line 1 = index 0). */
export function lineStarts(code: string): number[] {
  const out = [0]
  for (let i = code.indexOf('\n'); i >= 0; i = code.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

/** 0-based line of an offset (binary search). */
export function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 1-based line and column of an offset. */
export function lineColAt(starts: number[], offset: number): { line: number; col: number } {
  const i = lineIndexAt(starts, offset)
  return { line: i + 1, col: offset - starts[i] + 1 }
}

/** The offset of a 1-based line / column, clamped into the text. */
export function offsetAt(code: string, starts: number[], line: number, col: number): number {
  const i = Math.max(0, Math.min(starts.length - 1, line - 1))
  const end = i + 1 < starts.length ? starts[i + 1] - 1 : code.length
  return Math.max(starts[i], Math.min(end, starts[i] + Math.max(0, col - 1)))
}

export interface LineSeg {
  /** relative to the line */
  start: number
  end: number
  cls: SynClass
}

/** Tokens cut into lines (offsets relative to each line); a token over several lines gets a piece on each. */
export function tokensByLine(code: string, starts: number[], tokens: CodeToken[]): LineSeg[][] {
  const out: LineSeg[][] = starts.map(() => [])
  for (const tk of tokens) {
    if (tk.end <= tk.start) continue
    let li = lineIndexAt(starts, tk.start)
    let from = tk.start
    while (from < tk.end && li < starts.length) {
      const lineEnd = li + 1 < starts.length ? starts[li + 1] - 1 : code.length
      const to = Math.min(tk.end, lineEnd)
      if (to > from) out[li].push({ start: from - starts[li], end: to - starts[li], cls: tk.cls })
      li++
      from = li < starts.length ? starts[li] : tk.end
    }
  }
  return out
}

const WORD = /[\p{L}\p{N}_$]/u

/** The [from, to) offsets a marker covers (clamped; at least one character where the line has one). */
export function markerRange(code: string, starts: number[], m: CodeMarker): { from: number; to: number } {
  const from = offsetAt(code, starts, m.line, m.col)
  let to: number
  if (m.endCol !== undefined) to = offsetAt(code, starts, m.endLine ?? m.line, m.endCol)
  else {
    to = from
    while (to < code.length && WORD.test(code[to])) to++
    if (to === from && from < code.length && code[from] !== '\n') to = from + 1
  }
  return { from, to: Math.max(from, to) }
}

/** Tokens with some ranges taking precedence (placeholders): the tokens are cut around them. Both sorted. */
export function withRanges(tokens: CodeToken[], ranges: Array<{ start: number; end: number }>, cls: SynClass): CodeToken[] {
  if (!ranges.length) return tokens
  const out: CodeToken[] = []
  let p = 0
  for (const tk of tokens) {
    let s = tk.start
    while (p < ranges.length && ranges[p].end <= s) p++
    for (let q = p; q < ranges.length && ranges[q].start < tk.end; q++) {
      if (ranges[q].start > s) out.push({ start: s, end: ranges[q].start, cls: tk.cls })
      s = Math.max(s, ranges[q].end)
    }
    if (s < tk.end) out.push({ start: s, end: tk.end, cls: tk.cls })
  }
  for (const r of ranges) out.push({ start: r.start, end: r.end, cls })
  return out.sort((a, b) => a.start - b.start)
}
