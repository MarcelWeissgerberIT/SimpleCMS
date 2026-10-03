/**
 * Markdown for people (clipboard) and for Claude (AI input).
 * The editor's serializer already writes readable Markdown — "A & B \<tag>", code verbatim — so the
 * text is used as is (decoding it again would turn a literal "&amp;" into "\&").
 */
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown } from '../../editor'

export function toMarkdown(doc: JSONContent | null): string {
  return docToMarkdown(doc)
}

/**
 * "# Title" + body. The title goes through the same serializer as a heading node, so a title like
 * "Q&A <draft>" stays text ("# Q&A \<draft>") instead of turning into raw HTML.
 */
export function pageToMarkdown(title: string, doc: JSONContent | null): string {
  const text = title.replace(/\s+/g, ' ').trim()
  const body = toMarkdown(doc).trim()
  if (!text) return body ? body + '\n' : ''
  const head = docToMarkdown({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] }] }).trim()
  return [head || `# ${text}`, body].filter(Boolean).join('\n\n') + '\n'
}
