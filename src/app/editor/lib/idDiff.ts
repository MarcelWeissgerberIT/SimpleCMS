/**
 * Block ids are bookkeeping, not content: every editor fills in ids for blocks that have none (convert.ts
 * `withBlockIds`, fresh random ids each time) and writes them once, so two copies of the same text can differ in
 * nothing but their ids. Diffs that skip a block's `id`, and taking another copy's ids over where both hold the same
 * blocks — so a write that only added ids is no change to merge against (PageEditor's external updates).
 */
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { BLOCK_ID_TYPES } from '../schema/base'

const ID_TYPES = new Set<string>(BLOCK_ID_TYPES)

/** Same type, marks and attrs — a block's `id` aside (other attrs named id, e.g. a mention's target, count). */
function sameMarkup(a: PMNode, b: PMNode): boolean {
  if (a.sameMarkup(b)) return true
  return a.type === b.type && ID_TYPES.has(a.type.name) && a.attrs.id !== b.attrs.id && a.hasMarkup(b.type, { ...b.attrs, id: a.attrs.id }, b.marks)
}

/* Fragment.findDiffStart / findDiffEnd (prosemirror-model), with `sameMarkup` above. */

function diffStart(a: Fragment, b: Fragment, pos: number): number | null {
  for (let i = 0; ; i++) {
    if (i === a.childCount || i === b.childCount) return a.childCount === b.childCount ? null : pos
    const x = a.child(i)
    const y = b.child(i)
    if (x === y) {
      pos += x.nodeSize
      continue
    }
    if (!sameMarkup(x, y)) return pos
    if (x.isText && x.text !== y.text) {
      for (let j = 0; x.text![j] === y.text![j]; j++) pos++
      return pos
    }
    if (x.content.size || y.content.size) {
      const inner = diffStart(x.content, y.content, pos + 1)
      if (inner != null) return inner
    }
    pos += x.nodeSize
  }
}

function diffEnd(a: Fragment, b: Fragment, posA: number, posB: number): { a: number; b: number } | null {
  for (let iA = a.childCount, iB = b.childCount; ; ) {
    if (iA === 0 || iB === 0) return iA === iB ? null : { a: posA, b: posB }
    const x = a.child(--iA)
    const y = b.child(--iB)
    const size = x.nodeSize
    if (x === y) {
      posA -= size
      posB -= size
      continue
    }
    if (!sameMarkup(x, y)) return { a: posA, b: posB }
    if (x.isText && x.text !== y.text) {
      const tx = x.text!
      const ty = y.text!
      const min = Math.min(tx.length, ty.length)
      let same = 0
      while (same < min && tx[tx.length - same - 1] === ty[ty.length - same - 1]) {
        same++
        posA--
        posB--
      }
      return { a: posA, b: posB }
    }
    if (x.content.size || y.content.size) {
      const inner = diffEnd(x.content, y.content, posA - 1, posB - 1)
      if (inner) return inner
    }
    posA -= size
    posB -= size
  }
}

/** The changed range between two docs, block ids aside: [start, endA) in `a` became [start, endB) in `b`; null = same. */
export function diffIgnoringIds(a: PMNode, b: PMNode): { start: number; endA: number; endB: number } | null {
  const start = diffStart(a.content, b.content, 0)
  if (start == null) return null
  const end = diffEnd(a.content, b.content, a.content.size, b.content.size)
  let endA = end?.a ?? a.content.size
  let endB = end?.b ?? b.content.size
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  return { start, endA, endB }
}

type Pair = (pos: number, mine: PMNode, theirs: PMNode) => void

/** `a` and `b` hold the same blocks before `until`: pair the blocks starting there (ancestors of `until` too). */
function pairHead(a: Fragment, b: Fragment, pos: number, until: number, pair: Pair): void {
  for (let i = 0; i < a.childCount && i < b.childCount && pos < until; i++) {
    const x = a.child(i)
    const y = b.child(i)
    if (x.type !== y.type) return
    pair(pos, x, y)
    if (!x.isTextblock && !x.isLeaf) pairHead(x.content, y.content, pos + 1, until, pair)
    pos += x.nodeSize
  }
}

/** `a` and `b` hold the same blocks from `from` (in `a`) to their ends: pair them, walking both from the end. */
function pairTail(a: Fragment, b: Fragment, endA: number, from: number, pair: Pair): void {
  for (let iA = a.childCount, iB = b.childCount; iA > 0 && iB > 0 && endA > from; ) {
    const x = a.child(--iA)
    const y = b.child(--iB)
    if (x.type !== y.type) return
    const start = endA - x.nodeSize
    if (start >= from) pair(start, x, y)
    if (!x.isTextblock && !x.isLeaf) pairTail(x.content, y.content, endA - 1, from, pair)
    endA = start
  }
}

/**
 * Give the blocks of `tr.doc` the ids `theirs` holds for the same blocks, as attribute steps (the caret, node views
 * and undo history stay). `mine`: the part of `tr.doc` that is this side's own (its unsaved typing, its blocks keep
 * their ids) — the rest must equal `theirs` but for ids; omitted = all of it. Never leaves an id twice in the doc
 * (then nothing is taken).
 */
export function adoptIds(tr: Transaction, theirs: PMNode, mine?: { from: number; to: number }): void {
  const doc = tr.doc
  const take = new Map<number, string>()
  const pair: Pair = (pos, x, y) => {
    const id = y.attrs.id
    if (ID_TYPES.has(x.type.name) && typeof id === 'string' && id && id !== x.attrs.id) take.set(pos, id)
  }
  pairHead(doc.content, theirs.content, 0, mine ? mine.from : Infinity, pair)
  if (mine) pairTail(doc.content, theirs.content, doc.content.size, mine.to, pair)
  if (!take.size) return
  const seen = new Set<string>()
  let twice = false
  doc.descendants((node, pos) => {
    if (twice) return false
    if (ID_TYPES.has(node.type.name)) {
      const id = take.get(pos) ?? node.attrs.id
      if (typeof id === 'string' && id) {
        if (seen.has(id)) twice = true
        seen.add(id)
      }
    }
    return !node.isTextblock
  })
  if (twice) return
  for (const [pos, id] of take) tr.setNodeAttribute(pos, 'id', id)
}
