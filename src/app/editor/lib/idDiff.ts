/**
 * Block ids are bookkeeping, not content: every editor fills in ids for blocks that have none (convert.ts
 * `withBlockIds`, fresh random ids each time) and writes them once, so two copies of the same text can differ in
 * nothing but their ids. Diffs that skip a block's `id`, and taking another copy's ids over for the same blocks — so
 * a write that only added ids is no change to merge against (PageEditor's external updates).
 */
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { BLOCK_ID_TYPES } from '../schema/base'

const ID_TYPES = new Set<string>(BLOCK_ID_TYPES)

/** [start, endA) in `a` became [start, endB) in `b`. */
export type Range = { start: number; endA: number; endB: number }
type Pair = (pos: number, mine: PMNode, theirs: PMNode) => void

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

function range(a: PMNode, b: PMNode, start: number | null, end: () => { a: number; b: number } | null): Range | null {
  if (start == null) return null
  const e = end()
  let endA = e?.a ?? a.content.size
  let endB = e?.b ?? b.content.size
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  return { start, endA, endB }
}

/** The changed range between two docs, block ids aside; null = the same but for ids. */
export function diffIgnoringIds(a: PMNode, b: PMNode): Range | null {
  return range(a, b, diffStart(a.content, b.content, 0), () => diffEnd(a.content, b.content, a.content.size, b.content.size))
}

/** The exact changed range (prosemirror-model's own diff, ids included). */
export function diffExact(a: PMNode, b: PMNode): Range | null {
  return range(a, b, a.content.findDiffStart(b.content), () => a.content.findDiffEnd(b.content))
}

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

const idOf = (n: PMNode): string | null => (ID_TYPES.has(n.type.name) && typeof n.attrs.id === 'string' && n.attrs.id ? n.attrs.id : null)

/** Set block ids by position (attribute steps) — never leaving an id twice in the doc (then none is set). */
function setIds(tr: Transaction, take: Map<number, string>): void {
  if (!take.size) return
  const seen = new Set<string>()
  let twice = false
  tr.doc.descendants((node, pos) => {
    if (twice) return false
    const id = idOf(node) ? (take.get(pos) ?? idOf(node)) : null
    if (id) {
      if (seen.has(id)) twice = true
      seen.add(id)
    }
    return !node.isTextblock
  })
  if (twice) return
  for (const [pos, id] of take) tr.setNodeAttribute(pos, 'id', id)
}

/**
 * `tr.doc` equals `theirs` but for block ids: give its blocks theirs' ids, as attribute steps (the caret, node views
 * and undo history stay).
 */
export function adoptIds(tr: Transaction, theirs: PMNode): void {
  const take = new Map<number, string>()
  pairHead(tr.doc.content, theirs.content, 0, Infinity, (pos, x, y) => {
    const id = idOf(y)
    if (id && idOf(x) && id !== x.attrs.id) take.set(pos, id)
  })
  setIds(tr, take)
}

/** The ids `theirs` holds for the blocks `base` holds, outside `changed` (theirs' change from base, ids aside). */
export function idsFor(base: PMNode, theirs: PMNode, changed: Range | null): Map<string, string> {
  const out = new Map<string, string>()
  const pair: Pair = (_pos, x, y) => {
    const a = idOf(x)
    const b = idOf(y)
    if (a && b && a !== b) out.set(a, b)
  }
  pairHead(base.content, theirs.content, 0, changed ? changed.start : Infinity, pair)
  if (changed) pairTail(base.content, theirs.content, base.content.size, changed.endA, pair)
  return out
}

/** Rename the blocks of `tr.doc` whose id `ids` maps (attribute steps). */
export function renameIds(tr: Transaction, ids: Map<string, string>): void {
  if (!ids.size) return
  const take = new Map<number, string>()
  tr.doc.descendants((node, pos) => {
    const id = idOf(node)
    const to = id ? ids.get(id) : undefined
    if (to) take.set(pos, to)
    return !node.isTextblock
  })
  setIds(tr, take)
}
