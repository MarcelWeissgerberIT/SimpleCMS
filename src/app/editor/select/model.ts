/**
 * Block selection — one block (NodeSelection) or several neighbours in one container (a node range
 * selection, @tiptap/extension-node-range): read it, make it, extend it (Shift+click, Shift+↑ / ↓,
 * a drag in the margin, a tap on phones) and act on all of it in ONE transaction (block menu).
 *
 *  - readBlockSel(state): the selected blocks (siblings of one parent), or null for a text caret / range.
 *  - menuSelection(state, pos): what the block menu of the block at `pos` acts on — the selection's
 *    blocks when that block is one of them (also a text selection across blocks), else null.
 *  - blockSelectionAt(doc, from, to): the selection for blocks [from, to) of one parent.
 *  - extendBlockSelection / stepBlockSelection: grow or shrink from the anchor block.
 */
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import type { Mapping } from '@tiptap/pm/transform'
import { NodeSelection, Selection, type EditorState } from '@tiptap/pm/state'
import { NodeRangeSelection, isNodeRangeSelection } from '@tiptap/extension-node-range'
import { blockAtResolved } from '../lib/blocks'
import { splitRange } from '../split/range'

/**
 * A node range that survives a change which removes its blocks (a collaborator deleting them):
 * the base class would throw on an empty range — this one falls back to a caret there.
 */
export class BlockRangeSelection extends NodeRangeSelection {
  map(doc: PMNode, mapping: Mapping): NodeRangeSelection {
    try {
      return new BlockRangeSelection(doc.resolve(mapping.map(this.anchor)), doc.resolve(mapping.map(this.head)), this.depth)
    } catch {
      return Selection.near(doc.resolve(Math.min(mapping.map(this.anchor), doc.content.size))) as unknown as NodeRangeSelection
    }
  }
}

/** Selected blocks: siblings [start, end) of `parent` (at `depth`), between `from` and `to`. */
export interface BlockSel {
  from: number
  to: number
  depth: number
  parent: PMNode
  start: number
  end: number
  nodes: PMNode[]
  /** each block's position */
  positions: number[]
  /** index (within parent) of the block the selection grows from */
  anchor: number
}

export function isBlockSelection(sel: Selection): boolean {
  return (sel instanceof NodeSelection && sel.node.isBlock) || isNodeRangeSelection(sel)
}

/** The blocks between two positions that sit between the children of one parent. */
export function siblingsAt(doc: PMNode, from: number, to: number, anchorAtEnd = false): BlockSel | null {
  if (from < 0 || to > doc.content.size || from >= to) return null
  const $a = doc.resolve(from)
  const $b = doc.resolve(to)
  if (!$a.sameParent($b) || $a.parent.inlineContent) return null
  const start = $a.index()
  const end = $b.index()
  if (start >= end || $a.posAtIndex(start) !== from || $b.posAtIndex(end) !== to) return null
  const nodes: PMNode[] = []
  const positions: number[] = []
  for (let i = start; i < end; i++) {
    nodes.push($a.parent.child(i))
    positions.push($a.posAtIndex(i))
  }
  return { from, to, depth: $a.depth, parent: $a.parent, start, end, nodes, positions, anchor: anchorAtEnd ? end - 1 : start }
}

export function readBlockSel(state: EditorState): BlockSel | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.isBlock) return siblingsAt(state.doc, sel.from, sel.to)
  if (isNodeRangeSelection(sel) && sel.ranges.length) {
    const from = sel.ranges[0].$from.pos
    const to = sel.ranges[sel.ranges.length - 1].$to.pos
    return siblingsAt(state.doc, from, to, sel.head < sel.anchor)
  }
  return null
}

/** The selection for blocks [from, to) of one parent: one block → NodeSelection, several → a node range. */
export function blockSelectionAt(doc: PMNode, from: number, to: number, backwards = false): Selection | null {
  const at = siblingsAt(doc, from, to)
  if (!at) return null
  if (at.nodes.length === 1) return at.nodes[0].isBlock ? NodeSelection.create(doc, from) : null
  return backwards ? new BlockRangeSelection(doc.resolve(to), doc.resolve(from), at.depth) : new BlockRangeSelection(doc.resolve(from), doc.resolve(to), at.depth)
}

/** What the block menu of the block at `pos` acts on: the selected blocks it belongs to (two or more), else null. */
export function menuSelection(state: EditorState, pos: number): BlockSel | null {
  const sel = state.selection
  let b = readBlockSel(state)
  if (!b && !sel.empty) {
    // a text selection across blocks counts as those blocks
    const r = splitRange(state.doc, sel.from, sel.to)
    b = r ? siblingsAt(state.doc, r.from, r.to) : null
  }
  if (!b || b.nodes.length < 2) return null
  return pos >= b.from && pos < b.to ? b : null
}

/** The child of `b.parent` that holds `$pos` (its index), or -1 when `$pos` lies elsewhere. */
function indexIn(b: BlockSel, $pos: ResolvedPos): number {
  if ($pos.depth < b.depth) return -1
  if ($pos.start(b.depth) !== $pos.doc.resolve(b.from).start(b.depth)) return -1
  // a position between the children: the block after it (the last one at the end)
  if ($pos.depth === b.depth) return Math.min($pos.index(b.depth), b.parent.childCount - 1)
  return $pos.index(b.depth)
}

function rangeFrom(b: BlockSel, doc: PMNode, anchor: number, head: number): Selection | null {
  const $p = doc.resolve(b.from)
  const lo = Math.min(anchor, head)
  const hi = Math.max(anchor, head)
  return blockSelectionAt(doc, $p.posAtIndex(lo, b.depth), $p.posAtIndex(hi + 1, b.depth), head < anchor)
}

/**
 * Extend the block selection to the block at `pos` (Shift+click, a tap in selection mode): from the
 * anchor block in the same container, else over the nearest container that holds both.
 */
export function extendSelection(state: EditorState, pos: number): Selection | null {
  const b = readBlockSel(state)
  if (!b) return null
  const doc = state.doc
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const i = indexIn(b, $pos)
  if (i >= 0) return rangeFrom(b, doc, b.anchor, i)
  const block = blockAtResolved($pos)
  const target = block ? { from: block.pos, to: block.pos + block.node.nodeSize } : { from: $pos.pos, to: $pos.pos }
  const r = splitRange(doc, Math.min(b.from, target.from), Math.max(b.to, target.to))
  return r ? blockSelectionAt(doc, r.from, r.to) : null
}

/** Shift+↑ / ↓: the moving end of the selection one block up or down (null at the container's edge). */
export function stepSelection(state: EditorState, dir: -1 | 1): Selection | null {
  const b = readBlockSel(state)
  if (!b) return null
  const head = b.anchor === b.start ? b.end - 1 : b.start
  const next = (b.nodes.length === 1 ? b.anchor : head) + dir
  if (next < 0 || next >= b.parent.childCount) return null
  return rangeFrom(b, state.doc, b.anchor, next)
}

/** Every block of the page (⌘A on an all-text selection). */
export function allBlocks(doc: PMNode): Selection | null {
  if (!doc.childCount) return null
  return blockSelectionAt(doc, 0, doc.content.size)
}
