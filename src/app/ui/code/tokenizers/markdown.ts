/**
 * Markdown-ish text for the code area (pure) — written instructions such as an agent's job: headings, list
 * markers and task boxes, quotes, fenced and inline code, **bold**, *emphasis*, [links](…), open placeholders
 * (the caller's pattern, ui/code/placeholders.ts) and the names of tools the reader knows (the caller's list —
 * an agent's tools plus its MCP servers' tools). Line by line, so 2,000 lines take a millisecond or two.
 */
import type { CodeToken, SynClass, Tokenizer } from '../types'
import { findPlaceholders } from '../placeholders'
import { withRanges } from '../lines'

export interface MarkdownOptions {
  /** names highlighted as tools where they stand as a whole word (case-sensitive) */
  tools?: Iterable<string>
  /** open placeholders; null = none */
  placeholders?: RegExp | null
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^( {0,3})(#{1,6})(?=\s|$)/
const QUOTE = /^( {0,3})(>+)/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?=\s)(\s+\[[ xX]\](?=\s|$))?/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const IDENT = /[A-Za-z_][\w-]*/g
// inline: code spans, bold, emphasis, links (in this order of precedence at the same place)
const INLINE = /(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1|\*\*(?=\S)[^*\n]*?\S\*\*|__(?=\S)[^_\n]*?\S__|(?<![\w*])\*(?=[^\s*])[^*\n]*?[^\s*]\*(?![\w*])|(?<![\w_])_(?=[^\s_])[^_\n]*?[^\s_]_(?![\w_])|\[[^\]\n]+\]\([^)\s]*\)/g

function push(out: CodeToken[], start: number, end: number, cls: SynClass) {
  if (end > start) out.push({ start, end, cls })
}

/** Tool names in plain text between a and b. */
function words(line: string, base: number, a: number, b: number, tools: Set<string>, out: CodeToken[]) {
  if (!tools.size) return
  IDENT.lastIndex = a
  for (let m = IDENT.exec(line); m && m.index < b; m = IDENT.exec(line)) {
    const end = m.index + m[0].length
    if (end > b) break
    if (tools.has(m[0])) push(out, base + m.index, base + end, 'tool')
  }
}

function inline(line: string, base: number, from: number, tools: Set<string>, out: CodeToken[]) {
  INLINE.lastIndex = from
  let at = from
  for (let m = INLINE.exec(line); m; m = INLINE.exec(line)) {
    words(line, base, at, m.index, tools, out)
    const s = m[0]
    const start = base + m.index
    if (s.startsWith('`')) push(out, start, start + s.length, 'code')
    else if (s.startsWith('**') || s.startsWith('__')) push(out, start, start + s.length, 'strong')
    else if (s.startsWith('[')) push(out, start, start + s.length, 'link')
    else push(out, start, start + s.length, 'em')
    at = m.index + s.length
  }
  words(line, base, at, line.length, tools, out)
}

export function markdownTokenizer(opts: MarkdownOptions = {}): Tokenizer {
  const tools = new Set(opts.tools ?? [])
  const pattern = opts.placeholders ?? null
  return (code) => {
    const out: CodeToken[] = []
    let fence: string | null = null
    let base = 0
    for (const line of code.split('\n')) {
      const lineOut: CodeToken[] = []
      const f = FENCE.exec(line)
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) {
          push(lineOut, base, base + line.length, 'meta')
          fence = null
        } else push(lineOut, base, base + line.length, 'code')
      } else if (f) {
        fence = f[1]
        push(lineOut, base, base + line.length, 'meta')
      } else if (RULE.test(line)) push(lineOut, base, base + line.length, 'punct')
      else {
        let from = 0
        const h = HEADING.exec(line)
        const q = QUOTE.exec(line)
        const l = LIST.exec(line)
        if (h) {
          push(lineOut, base + h[1].length, base + h[0].length, 'list')
          // the heading's words, with its inline marks inside
          const inner: CodeToken[] = []
          inline(line, base, h[0].length, tools, inner)
          let at = h[0].length
          for (const tk of inner) {
            push(lineOut, base + at, tk.start, 'head')
            lineOut.push(tk)
            at = tk.end - base
          }
          push(lineOut, base + at, base + line.length, 'head')
          from = line.length
        } else if (q) {
          push(lineOut, base + q[1].length, base + q[0].length, 'list')
          from = q[0].length
        } else if (l) {
          push(lineOut, base + l[1].length, base + l[1].length + l[2].length, 'list')
          if (l[3]) push(lineOut, base + l[0].length - 3, base + l[0].length, 'list')
          from = l[0].length
        }
        if (from < line.length) {
          const inner: CodeToken[] = []
          inline(line, base, from, tools, inner)
          if (q) {
            // a quote's text is a quote where nothing else marks it
            let at = base + from
            for (const tk of inner) {
              push(lineOut, at, tk.start, 'quote')
              lineOut.push(tk)
              at = tk.end
            }
            push(lineOut, at, base + line.length, 'quote')
          } else lineOut.push(...inner)
        }
      }
      const phs = pattern ? findPlaceholders(line, pattern).map((p) => ({ start: base + p.start, end: base + p.end })) : []
      out.push(...withRanges(lineOut, phs, 'ph'))
      base += line.length + 1
    }
    return out
  }
}
