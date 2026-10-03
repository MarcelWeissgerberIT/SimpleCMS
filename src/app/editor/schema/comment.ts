/**
 * `comment` mark (attrs: id) — the anchor of a comment thread (Page.comments, same id).
 * The mark itself renders unstyled; the live editor highlights it with decorations
 * (../comments/plugin.ts), so resolved threads, foreign ids and read-only renders stay plain.
 * Overlapping threads are allowed (excludes: ''); typing at its edge never extends it.
 */
import { Mark, mergeAttributes, type JSONContent } from '@tiptap/core'

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  spanning: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment'),
        renderHTML: (a) => (a.id ? { 'data-comment': String(a.id) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'cmark' }), 0]
  },
  // never reached in practice (docToMarkdown strips comments first): plain text
  renderMarkdown(node, h) {
    return h.renderChildren(node.content ?? [])
  },
})

type Marks = NonNullable<JSONContent['marks']>
const sameMarks = (a: JSONContent['marks'], b: JSONContent['marks']) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/** Join neighbouring text nodes that ended up with the same marks. */
function joinText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev && prev.type === 'text' && n.type === 'text' && sameMarks(prev.marks, n.marks)) out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (n.text ?? '') }
    else out.push(n)
  }
  return out
}

/** The doc without comment anchors (for anything that leaves the device). Same object when there are none. */
export function stripComments(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    if (n.marks?.some((m) => m.type === 'comment')) {
      const marks: Marks = n.marks.filter((m) => m.type !== 'comment')
      out = { ...n, marks }
      if (!marks.length) delete out.marks
    }
    if (out.content) {
      const kids = out.content.map(walk)
      if (kids.some((k, i) => k !== out.content![i])) out = { ...out, content: joinText(kids) }
    }
    return out
  }
  return walk(doc)
}

/** Ids of all comment threads anchored in a doc (JSON). */
export function commentIdsIn(doc: JSONContent | null | undefined): Set<string> {
  const ids = new Set<string>()
  const walk = (n: JSONContent) => {
    n.marks?.forEach((m) => m.type === 'comment' && typeof m.attrs?.id === 'string' && ids.add(m.attrs.id))
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return ids
}
