/**
 * The AI menu and task blocks (P2) — pure helpers over the editor's doc:
 *  - replaceRange(doc, from, to): what Replace may cover — the range as it is when it holds no task; grown to whole
 *    outermost tasks when it starts at a task's very beginning / ends at its very end; null when it cuts into a task
 *    (starts after the first word of a task, ends before its last) — the P1 reason, Replace stays off.
 *  - rangeDoc(doc, from, to): the blocks of a range as a doc (the `known` a Replace settles against — read NOW).
 *  - echoedIds(markdown): the task ids Claude wrote back (`{#wi_…}`): a Replace is only allowed when every one of them is a
 *    task the range holds now (a task deleted meanwhile → Insert below instead).
 *  - insideTaskOrTable(doc, pos): a position inside a task or a table (an answer holding a task never lands there).
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { holdsItem, WORK_ITEM } from '../../editor'

const clamp = (doc: PMNode, n: number) => Math.max(0, Math.min(n, doc.content.size))

/** Inline content (text, a mention …) in [from, to)? */
function inlineBetween(doc: PMNode, from: number, to: number): boolean {
  if (from >= to) return false
  let hit = false
  doc.nodesBetween(from, to, (n, pos) => {
    if (hit) return false
    if (n.isInline && pos < to && pos + n.nodeSize > from) hit = true
    return !hit
  })
  return hit
}

export function replaceRange(doc: PMNode, from: number, to: number): { from: number; to: number; holds: boolean } | null {
  const a = clamp(doc, from)
  const b = clamp(doc, Math.max(from, to))
  if (!holdsItem(doc, a, b)) return { from: a, to: b, holds: false }
  let f = a
  let t = b
  const $a = doc.resolve(a)
  for (let d = 1; d <= $a.depth; d++) {
    if ($a.node(d).type.name !== WORK_ITEM) continue
    const start = $a.before(d)
    // a word of the task before the range: it cuts into the task
    if (inlineBetween(doc, start, a)) return null
    f = start
    break
  }
  const $b = doc.resolve(b)
  for (let d = 1; d <= $b.depth; d++) {
    if ($b.node(d).type.name !== WORK_ITEM) continue
    const end = $b.after(d)
    if (inlineBetween(doc, b, end)) return null
    t = end
    break
  }
  return { from: f, to: t, holds: true }
}

/** The blocks of [from, to) as a doc (a partial first / last block as its part). */
export function rangeDoc(doc: PMNode, from: number, to: number): JSONContent {
  try {
    const slice = doc.slice(clamp(doc, from), clamp(doc, to))
    const json = (slice.content.toJSON() as JSONContent[] | null) ?? []
    const first = slice.content.firstChild
    return first?.isInline ? { type: 'doc', content: [{ type: 'paragraph', content: json }] } : { type: 'doc', content: json }
  } catch {
    return { type: 'doc', content: [] }
  }
}

/** The task ids an answer writes back (`> [!TODO] Title {#wi_…}`), each once. */
export function echoedIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\{#(wi_[A-Za-z0-9_-]{10})(?=[\s}])/g)].map((m) => m[1]))]
}

/** Inside a task or a table? */
export function insideTaskOrTable(doc: PMNode, pos: number): boolean {
  const $p = doc.resolve(clamp(doc, pos))
  for (let d = 1; d <= $p.depth; d++) {
    const name = $p.node(d).type.name
    if (name === WORK_ITEM || name === 'table') return true
  }
  return false
}
