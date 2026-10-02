// STUB — replaced by the editor area.
import type { Extensions, JSONContent } from '@tiptap/core'
import { plainText } from '../store/store'

export function getExtensions(_opts: { readOnly?: boolean } = {}): Extensions {
  return []
}

export function markdownToDoc(md: string): JSONContent {
  return { type: 'doc', content: md.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) }
}

export function docToMarkdown(doc: JSONContent | null): string {
  return plainText(doc)
}

export function docToHTML(doc: JSONContent | null): string {
  return `<p>${plainText(doc)}</p>`
}
