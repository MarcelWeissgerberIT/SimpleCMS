/**
 * "Turn into page" — the pure part: which blocks a selection covers and what the new page is called.
 *
 *  - splitRange(doc, from, to): the selection — or the caret's block — as whole blocks of ONE block
 *    container (the page, a column, a callout, a toggle's body, a tab). Inside a list only the list
 *    items go (the list is split around the link); a table, quote, toggle, code block, synced block …
 *    goes as a whole. A selection across containers grows to the nearest container that holds both
 *    ends (across two columns: the whole columns block). null: nothing there to move.
 *  - blockSplitRange(state, pos): the block menu's range — the selected blocks when the block at
 *    `pos` is one of them, else that block alone.
 *  - readSplit(doc, range): the blocks (or list items) of a range, null when it is no longer one.
 *  - splitTitle(nodes): a leading heading becomes the title and leaves the content; one short line of
 *    plain text becomes the title by itself (the line IS the page, like Notion); else the first line
 *    (≤ 60 characters, cut at a word); else '' (Untitled).
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/** Nodes whose children are free-standing blocks — where a page link may take the place of some of them. */
export const SPLIT_CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent', 'tab'])
/** Lists: their items move on their own (the list is split around the link). */
export const SPLIT_LISTS = new Set(['bulletList', 'orderedList', 'taskList'])
/** A meeting being recorded / summarised stays where its recording runs. */
const BUSY_MEETING = new Set(['recording', 'paused', 'summarizing'])

export const TITLE_MAX = 60

/** Positions just before the first and just after the last block (or list item) that moves. */
export interface SplitRange {
  from: number
  to: number
}

export function splitRange(doc: PMNode, from: number, to: number): SplitRange | null {
  const size = doc.content.size
  const a = Math.max(0, Math.min(from, size))
  const b = Math.max(a, Math.min(to, size))
  const $from = doc.resolve(a)
  const $to = doc.resolve(b)
  for (let d = $from.sharedDepth(b); d >= 0; d--) {
    const node = $from.node(d)
    const list = SPLIT_LISTS.has(node.type.name) && d > 0 && SPLIT_CONTAINERS.has($from.node(d - 1).type.name)
    if (!list && !SPLIT_CONTAINERS.has(node.type.name)) continue
    let start = $from.index(d)
    let end = $to.depth > d ? $to.index(d) + 1 : $to.index(d)
    // a selection that only touches the very end of its first block / the very start of its last one leaves them out
    if (a < b && end - start > 1 && a > $from.posAtIndex(start, d) && !doc.textBetween(a, $from.posAtIndex(start + 1, d), ' ', ' ').trim()) start++
    if (a < b && end - start > 1 && $to.depth > d) {
      const lastStart = $from.posAtIndex(end - 1, d)
      if (!doc.textBetween(lastStart, b, ' ', ' ').trim() && b < lastStart + node.child(end - 1).nodeSize) end--
    }
    if (start >= end || end > node.childCount) return null
    // every item of a list: the list itself is the block
    if (list && start === 0 && end === node.childCount) return { from: $from.before(d), to: $from.after(d) }
    return { from: $from.posAtIndex(start, d), to: $from.posAtIndex(end, d) }
  }
  return null
}

/** The block menu's range: the selected blocks when the block at `pos` is one of them, else that block. */
export function blockSplitRange(state: EditorState, pos: number): SplitRange | null {
  const node = state.doc.nodeAt(pos)
  if (!node) return null
  const own = splitRange(state.doc, pos, pos + node.nodeSize)
  const sel = state.selection
  if (!own || sel.empty) return own
  const all = splitRange(state.doc, sel.from, sel.to)
  return all && all.from <= own.from && own.to <= all.to ? all : own
}

/** The blocks of a range. */
export interface SplitAt {
  from: number
  to: number
  /** the container (or the list) and the child indexes [start, end) */
  parent: PMNode
  start: number
  end: number
  nodes: PMNode[]
  /** list items: the list they come from and its position */
  list: { node: PMNode; pos: number } | null
}

export function readSplit(doc: PMNode, range: SplitRange): SplitAt | null {
  if (range.from < 0 || range.to > doc.content.size || range.from >= range.to) return null
  const $a = doc.resolve(range.from)
  const $b = doc.resolve(range.to)
  if (!$a.sameParent($b) || $a.parent.inlineContent) return null
  const parent = $a.parent
  const isList = SPLIT_LISTS.has(parent.type.name)
  if (!isList && !SPLIT_CONTAINERS.has(parent.type.name)) return null
  const start = $a.index()
  const end = $b.index()
  if (start >= end || $a.posAtIndex(start) !== range.from || $b.posAtIndex(end) !== range.to) return null
  const nodes: PMNode[] = []
  for (let i = start; i < end; i++) nodes.push(parent.child(i))
  return { from: range.from, to: range.to, parent, start, end, nodes, list: isList ? { node: parent, pos: $a.before() } : null }
}

/** A meeting that is recording (or being summarised) among the nodes. */
export function holdsBusyMeeting(nodes: readonly PMNode[]): boolean {
  let busy = false
  for (const n of nodes) {
    const check = (m: PMNode) => {
      if (m.type.name === 'meetingNotes' && BUSY_MEETING.has(String(m.attrs.status))) busy = true
      return !busy
    }
    if (check(n)) n.descendants(check)
  }
  return busy
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

/** Inline atoms as the reader sees them: a line break, a mention's label, TeX. */
export function leafText(leaf: PMNode): string {
  if (leaf.type.name === 'hardBreak') return '\n'
  if (leaf.type.name === 'mention') return String(leaf.attrs.label ?? '')
  if (leaf.type.name === 'inlineMath') return String(leaf.attrs.latex ?? '')
  return ''
}

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The first line of text in a node with any ('' when it holds none). */
export function firstLine(node: PMNode): string {
  const text = node.isTextblock ? node.textBetween(0, node.content.size, '\n', leafText) : node.isLeaf ? '' : node.textBetween(0, node.content.size, '\n', leafText)
  for (const line of text.split('\n')) if (squash(line)) return squash(line)
  return ''
}

/** At most TITLE_MAX characters, cut at a word. */
export function cutTitle(line: string): string {
  if (line.length <= TITLE_MAX) return line
  const cut = line.slice(0, TITLE_MAX - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp >= TITLE_MAX / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/** One paragraph of plain words: no links, comments, mentions or line breaks that a title would drop. */
function plainLine(node: PMNode): boolean {
  if (node.type.name !== 'paragraph' || !node.childCount) return false
  let plain = true
  node.forEach((child) => {
    if (!child.isText || child.marks.some((m) => m.type.name === 'link' || m.type.name === 'comment')) plain = false
  })
  return plain
}

/** The new page's title and how many leading nodes it takes with it (they leave the content). */
export function splitTitle(nodes: readonly PMNode[]): { title: string; drop: number } {
  const first = nodes[0]
  if (!first) return { title: '', drop: 0 }
  if (first.type.name === 'heading') {
    const title = squash(first.textBetween(0, first.content.size, ' ', leafText))
    if (title) return { title, drop: 1 }
  }
  if (nodes.length === 1 && plainLine(first)) {
    const line = squash(first.textContent)
    if (line.length <= TITLE_MAX) return { title: line, drop: 1 }
  }
  for (const n of nodes) {
    const line = firstLine(n)
    if (line) return { title: cutTitle(line), drop: 0 }
  }
  return { title: '', drop: 0 }
}
