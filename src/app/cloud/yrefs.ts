/**
 * Bridge writes keep Y's attribute objects (B3, docs/CLOUD.md § Realtime documents).
 *
 * A content change made without an editor (writeItems with no editor open, the agenda's move, the card's Mark done,
 * a people merge — every bridge writer) reaches the page's Y document through `prosemirrorJSONToYXmlFragment`
 * (y-tiptap `updateYFragment`), which writes an attribute when `yAttrs[key] !== pAttrs[key]` — BY REFERENCE. The
 * JSON comes from the store (structured clones: IndexedDB, the content cache), so every object / array attribute
 * of a changed node is a different object and would be written again — overwriting a member's concurrent change of
 * `people` while this tab only changed `status`.
 *
 * `keepYRefs(json, frag)`: every node with a block id whose Y element (same id, same node name) holds a deep-equal
 * object / array attribute gets THAT Y value — y-tiptap then sees no change for it. Pure: a new tree with
 * structural sharing, the input never mutated (store content is frozen). Iterative.
 */
import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { deepEqual } from '../store/merge'

/** The fragment's elements by their `id` attribute (the first one wins; block ids are unique per doc). */
function elementsById(frag: Y.XmlFragment): Map<string, Y.XmlElement> {
  const out = new Map<string, Y.XmlElement>()
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [frag]
  while (stack.length) {
    const n = stack.pop()!
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue
      const id = c.getAttribute('id')
      if (typeof id === 'string' && id && !out.has(id)) out.set(id, c)
      stack.push(c)
    }
  }
  return out
}

/** A node's attrs with Y's own objects for the deep-equal object / array values (same attrs object when none). */
function attrsWithRefs(attrs: Record<string, unknown>, el: Y.XmlElement): Record<string, unknown> {
  let out: Record<string, unknown> | null = null
  const y = el.getAttributes() as Record<string, unknown>
  for (const key of Object.keys(attrs)) {
    const v = attrs[key]
    if (!v || typeof v !== 'object') continue
    const yv = y[key]
    if (yv === v || !yv || typeof yv !== 'object' || !deepEqual(v, yv)) continue
    out ??= { ...attrs }
    out[key] = yv
  }
  return out ?? attrs
}

export function keepYRefs(json: JSONContent, frag: Y.XmlFragment): JSONContent {
  const byId = elementsById(frag)
  if (!byId.size) return json
  type Frame = { n: JSONContent; i: number; out: unknown[] | null }
  const stack: Frame[] = [{ n: json, i: 0, out: null }]
  let result = json
  while (stack.length) {
    const f = stack[stack.length - 1]
    const kids = Array.isArray(f.n.content) ? (f.n.content as unknown[]) : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (c && typeof c === 'object' && (c as JSONContent).type !== 'text') stack.push({ n: c as JSONContent, i: 0, out: null })
      else if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    let node: JSONContent = f.out ? { ...f.n, content: f.out as JSONContent[] } : f.n
    const id = node.attrs?.id
    if (typeof id === 'string' && id) {
      const el = byId.get(id)
      if (el && el.nodeName === node.type) {
        const attrs = attrsWithRefs(node.attrs!, el)
        if (attrs !== node.attrs) node = { ...node, attrs }
      }
    }
    const parent = stack[stack.length - 1]
    if (!parent) {
      result = node
      break
    }
    if (node !== f.n && !parent.out) parent.out = (parent.n.content as unknown[]).slice(0, parent.i - 1)
    if (parent.out) parent.out.push(node)
  }
  return result
}
