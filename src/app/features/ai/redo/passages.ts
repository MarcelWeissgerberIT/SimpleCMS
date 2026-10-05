/**
 * "Redo with instructions" — the passages: the marked top-level blocks of a page, in document order,
 * numbered. Each goes to Claude as Markdown; inline atoms (page / date / person mentions, inline icons,
 * inline math) travel as tokens ⟦n⟧ and come back as the very same nodes, so a rewrite keeps them.
 * Blocks that are not text (images, databases, embeds, spreadsheets …) are kept out with a reason.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { docToMarkdown, markdownToDoc } from '../../../editor'

/** Block types a rewrite can replace (a Markdown round trip keeps their shape). */
const TEXT_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'callout', 'details', 'table'])
/** Inline nodes that travel as tokens. */
const ATOMS = new Set(['mention', 'icon', 'inlineMath'])

export type SkipReason = 'kind' | 'empty'

export interface RedoPassage {
  /** 1-based, in document order */
  n: number
  /** the block id (the passage is found by it again) */
  key: string
  type: string
  /** Markdown sent to Claude (atoms as ⟦i⟧) */
  markdown: string
  /** the plain text when it was read (a passage whose text changed meanwhile is skipped) */
  anchor: string
  /** the inline atoms by token number */
  atoms: JSONContent[]
  /** not sent: why */
  skip: SkipReason | null
}

const TOKEN = /⟦(\d+)⟧/g
const HAS_TOKEN = /⟦\d+⟧/

/** The block with its inline atoms replaced by ⟦i⟧ text (marks kept). */
function tokenize(json: JSONContent, atoms: JSONContent[]): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (n.type && ATOMS.has(n.type)) {
      atoms.push(n)
      return { type: 'text', text: `⟦${atoms.length}⟧`, ...(n.marks?.length ? { marks: n.marks } : {}) }
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n
  }
  return walk(json)
}

/** Readable label of an atom (the review shows "@Mara" instead of ⟦2⟧). */
export function atomLabel(a: JSONContent | undefined): string {
  if (!a) return ''
  const attrs = a.attrs ?? {}
  if (a.type === 'mention') return `@${String(attrs.label || attrs.id || '')}`
  if (a.type === 'inlineMath') return `$${String(attrs.latex ?? '')}$`
  if (a.type === 'icon') return `:${String(attrs.name ?? '')}:`
  return ''
}

/** Markdown with the tokens shown as their labels. */
export function readable(markdown: string, atoms: JSONContent[]): string {
  return markdown.replace(TOKEN, (m, i: string) => atomLabel(atoms[Number(i) - 1]) || m)
}

const plainOf = (node: PMNode) => node.textBetween(0, node.content.size, '\n', ' ')

/** The passages for these block ids (document order). Ids that are gone are left out. */
export function capturePassages(editor: Editor, ids: string[]): RedoPassage[] {
  const want = new Set(ids)
  const out: RedoPassage[] = []
  editor.state.doc.forEach((node, _pos, i) => {
    const key = typeof node.attrs.id === 'string' && node.attrs.id ? node.attrs.id : `#${i}`
    if (!want.has(key)) return
    const type = node.type.name
    const anchor = plainOf(node)
    const atoms: JSONContent[] = []
    const base = { n: out.length + 1, key, type, anchor, atoms }
    if (!TEXT_TYPES.has(type)) return out.push({ ...base, markdown: '', skip: 'kind' })
    if (!anchor.trim()) return out.push({ ...base, markdown: '', skip: 'empty' })
    const json = tokenize(node.toJSON() as JSONContent, atoms)
    out.push({ ...base, markdown: docToMarkdown({ type: 'doc', content: [json] }).trim(), skip: null })
  })
  return out
}

/** Claude's Markdown for a passage → blocks, the atoms put back, the original block's attrs kept where the type stayed. */
export function passageBlocks(after: string, p: Pick<RedoPassage, 'atoms' | 'type'>, original?: JSONContent): JSONContent[] {
  const doc = markdownToDoc(after)
  const restore = (n: JSONContent): JSONContent[] => {
    if (n.type === 'text' && typeof n.text === 'string' && HAS_TOKEN.test(n.text)) {
      const parts: JSONContent[] = []
      let last = 0
      for (const m of n.text.matchAll(TOKEN)) {
        const at = m.index ?? 0
        if (at > last) parts.push({ ...n, text: n.text.slice(last, at) })
        const atom = p.atoms[Number(m[1]) - 1]
        parts.push(atom ?? { ...n, text: m[0] })
        last = at + m[0].length
      }
      if (last < n.text.length) parts.push({ ...n, text: n.text.slice(last) })
      return parts
    }
    return [n.content ? { ...n, content: n.content.flatMap(restore) } : n]
  }
  const blocks = (doc.content ?? []).flatMap(restore).map((b) => {
    // a fresh block id comes from the editor
    const { id: _id, ...attrs } = (b.attrs ?? {}) as Record<string, unknown>
    void _id
    return { ...b, attrs }
  })
  // one block of the same type: its look stays (callout icon / colour, code language, toggle level …)
  if (original && blocks.length === 1 && blocks[0].type === original.type && original.type !== 'heading') {
    const { id: _id, ...keep } = (original.attrs ?? {}) as Record<string, unknown>
    void _id
    blocks[0] = { ...blocks[0], attrs: { ...blocks[0].attrs, ...keep } }
  }
  return blocks
}
