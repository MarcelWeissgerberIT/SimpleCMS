/**
 * Task block — turning tasks into other blocks and back. Pure (TipTap JSON).
 *
 *  - `itemBlocks(task)`: a task as plain blocks — its title paragraph + its notes, the fields dropped. The
 *    fallback of the creation gate (a copy that may not become a new task), button templates (which never hold
 *    a task) and Backspace on an empty title.
 *  - `unwrapItemsIn(blocks)`: every task in a block list (at any depth) replaced by its `itemBlocks`.
 */
import type { JSONContent } from '@tiptap/core'
import { WORK_ITEM } from './attrs'

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
const isNode = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !Array.isArray(n)

/** A task's title paragraph + notes (the same objects); fields dropped. Never empty. */
export function itemBlocks(task: JSONContent): JSONContent[] {
  const kids = Array.isArray(task.content) ? task.content.filter(isNode) : []
  return kids.length ? kids : [{ type: 'paragraph' }]
}

const SPLICE = '\u0000item'

/**
 * The block list with every task in it — at any depth, synced references included — replaced by its
 * `itemBlocks` (tasks inside a task's notes too). The same array when it holds none; iterative.
 */
export function unwrapItemsIn(list: readonly JSONContent[]): JSONContent[] {
  type Frame = { n: JSONContent; i: number; out: unknown[] | null }
  const root: JSONContent = { type: 'doc', content: list as JSONContent[] }
  const stack: Frame[] = [{ n: root, i: 0, out: null }]
  while (stack.length) {
    const f = stack[stack.length - 1]
    const type = f.n.type ?? ''
    const kids = Array.isArray(f.n.content) && !TEXTBLOCKS.has(type) && !INLINE.has(type) ? (f.n.content as unknown[]) : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (isNode(c) && !INLINE.has(c.type ?? '')) stack.push({ n: c.type === WORK_ITEM ? { type: SPLICE, content: itemBlocks(c) } : c, i: 0, out: null })
      else if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    const parent = stack[stack.length - 1]
    if (!parent) return (f.out as JSONContent[] | null) ?? (list as JSONContent[])
    const splice = f.n.type === SPLICE
    const made: unknown[] = splice ? (f.out ?? (f.n.content as unknown[])) : [f.out ? { ...f.n, content: f.out } : f.n]
    const original = (parent.n.content as unknown[])[parent.i - 1]
    if ((splice || made[0] !== original) && !parent.out) parent.out = (parent.n.content as unknown[]).slice(0, parent.i - 1)
    if (parent.out) parent.out.push(...made)
  }
  return list as JSONContent[]
}
