/**
 * Markdown for people (clipboard) and for Claude (AI input).
 * The editor's serializer writes text as HTML entities ("A &amp; B &lt;tag&gt;"); Markdown wants
 * the characters themselves. Code spans and fenced code are left untouched (they are not escaped).
 */
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown } from '../../editor'

const ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#39|#x27|#34|#x22);/g
const CHAR: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#34': '"', '#x22': '"' }

function decodeText(s: string, lineStart: boolean): string {
  return s.replace(ENTITY, (_m, name: string, offset: number, all: string) => {
    if (name === 'lt') {
      // "<" followed by a tag-like character would turn into raw HTML: keep it escaped the Markdown way
      return /[A-Za-z/!?]/.test(all.charAt(offset + 4)) ? '\\<' : '<'
    }
    if (name === 'gt') {
      // a ">" opening a line would start a quote
      return lineStart && !all.slice(0, offset).trim() ? '\\>' : '>'
    }
    return CHAR[name] ?? _m
  })
}

/** Inline code spans (`…`, ``…``) keep their text verbatim. */
function decodeLine(line: string): string {
  const span = /(`+)([\s\S]*?[^`])\1(?!`)/g
  let out = ''
  let last = 0
  for (let m = span.exec(line); m; m = span.exec(line)) {
    out += decodeText(line.slice(last, m.index), last === 0) + m[0]
    last = m.index + m[0].length
  }
  return out + decodeText(line.slice(last), last === 0)
}

export function unescapeMarkdown(md: string): string {
  let fence: string | null = null
  return md
    .split('\n')
    .map((line) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null
        return line
      }
      if (m) {
        fence = m[1]
        return line
      }
      return decodeLine(line)
    })
    .join('\n')
}

/** docToMarkdown without HTML entities. */
export function toMarkdown(doc: JSONContent | null): string {
  return unescapeMarkdown(docToMarkdown(doc))
}
