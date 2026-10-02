/**
 * Block-level operations shared by the slash menu, block menu, bubble toolbar and shortcuts.
 */
import type { Editor, JSONContent, Range } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'

/** Parents whose children are "blocks" in the Notion sense. */
const CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent', 'blockquote'])
const LIST_ITEMS = new Set(['listItem', 'taskItem'])

export interface BlockRef {
  node: PMNode
  pos: number
}

/** The block (Notion sense) that contains a resolved position. */
export function blockAtResolved($pos: ResolvedPos): BlockRef | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    const parent = $pos.node(d - 1)
    if (LIST_ITEMS.has(node.type.name) || CONTAINERS.has(parent.type.name)) return { node, pos: $pos.before(d) }
  }
  return null
}

export function currentBlock(state: { selection: Selection; doc: PMNode }): BlockRef | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.isBlock) return { node: sel.node, pos: sel.from }
  return blockAtResolved(sel.$from)
}

function restoreSelection(tr: Transaction, oldSel: Selection, oldStart: number, newStart: number) {
  const delta = newStart - oldStart
  try {
    if (oldSel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, oldSel.from + delta))
    else tr.setSelection(TextSelection.create(tr.doc, oldSel.anchor + delta, oldSel.head + delta))
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(newStart + 1, tr.doc.content.size))))
  }
}

export function moveBlock(editor: Editor, dir: -1 | 1, ref?: BlockRef | null): boolean {
  const { state, view } = editor
  const b = ref ?? currentBlock(state)
  if (!b) return false
  const $b = state.doc.resolve(b.pos)
  const parent = $b.parent
  const index = $b.index()
  const target = index + dir
  if (target < 0 || target >= parent.childCount) return false
  const sibling = parent.child(target)
  const tr = state.tr
  tr.delete(b.pos, b.pos + b.node.nodeSize)
  const insertAt = dir < 0 ? b.pos - sibling.nodeSize : b.pos + sibling.nodeSize
  tr.insert(insertAt, b.node)
  restoreSelection(tr, state.selection, b.pos, insertAt)
  view.dispatch(tr.scrollIntoView())
  return true
}

export function duplicateBlock(editor: Editor, ref?: BlockRef | null): boolean {
  const { state, view } = editor
  const b = ref ?? currentBlock(state)
  if (!b) return false
  const at = b.pos + b.node.nodeSize
  const tr = state.tr.insert(at, b.node.type.create({ ...b.node.attrs, id: null }, b.node.content, b.node.marks))
  restoreSelection(tr, state.selection, b.pos, at)
  view.dispatch(tr.scrollIntoView())
  return true
}

export function deleteBlock(editor: Editor, ref?: BlockRef | null): boolean {
  const { state, view } = editor
  const b = ref ?? currentBlock(state)
  if (!b) return false
  const tr = state.tr.delete(b.pos, b.pos + b.node.nodeSize)
  const $pos = tr.doc.resolve(Math.min(b.pos, tr.doc.content.size))
  tr.setSelection(Selection.near($pos, -1))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

export function selectBlock(editor: Editor, ref?: BlockRef | null): boolean {
  const { state, view } = editor
  const b = ref ?? currentBlock(state)
  if (!b) return false
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, b.pos)))
  return true
}

/* ------------------------------------------------------------------ */
/* Turn into                                                           */
/* ------------------------------------------------------------------ */

export type TurnTarget =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'toggle'
  | 'blockquote'
  | 'callout'
  | 'codeBlock'

const LIST_TYPES: Record<string, string> = { bulletList: 'bulletList', orderedList: 'orderedList', taskList: 'taskList' }

export function activeTurnTarget(editor: Editor): TurnTarget | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name
    if (n === 'bulletList' || n === 'orderedList' || n === 'taskList') return n
    if (n === 'details') return 'toggle'
    if (n === 'blockquote') return 'blockquote'
    if (n === 'callout') return 'callout'
  }
  const p = $from.parent
  if (p.type.name === 'heading') return `heading${p.attrs.level}` as TurnTarget
  if (p.type.name === 'codeBlock') return 'codeBlock'
  if (p.type.name === 'detailsSummary') return 'toggle'
  return 'paragraph'
}

function inListOrQuote(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name
    if (LIST_ITEMS.has(n) || n === 'blockquote') return true
    if (CONTAINERS.has(n) && n !== 'doc') return false
  }
  return false
}

/** Wrap the current textblock into a toggle; its text becomes the toggle title. */
function wrapInToggle(editor: Editor): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  const block = $from.parent
  if (!block.isTextblock) return false
  const from = $from.before()
  const to = $from.after()
  const schema = state.schema
  const details = schema.nodes.details.create({ open: true }, [
    schema.nodes.detailsSummary.create(null, block.content),
    schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create()),
  ])
  const tr = state.tr.replaceWith(from, to, details)
  tr.setSelection(TextSelection.create(tr.doc, from + 2 + block.content.size))
  view.dispatch(tr)
  return true
}

/** Notion-style "Turn into" for the block at the selection. */
export function turnInto(editor: Editor, target: TurnTarget): boolean {
  const current = activeTurnTarget(editor)
  if (current === target && target !== 'paragraph') return true
  let chain = editor.chain().focus()
  const toList = target in LIST_TYPES
  const fromList = current === 'bulletList' || current === 'orderedList' || current === 'taskList'
  if (!(toList && fromList) && inListOrQuote(editor)) chain = chain.clearNodes()
  // leaving a callout / toggle: unwrap by lifting the current block
  if (current === 'callout' && target !== 'callout') chain = chain.lift('callout')
  switch (target) {
    case 'paragraph':
      return chain.setParagraph().run()
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return chain.setNode('heading', { level: Number(target.slice(-1)) }).run()
    case 'bulletList':
      return (fromList ? chain : chain.setParagraph()).toggleBulletList().run()
    case 'orderedList':
      return (fromList ? chain : chain.setParagraph()).toggleOrderedList().run()
    case 'taskList':
      return (fromList ? chain : chain.setParagraph()).toggleTaskList().run()
    case 'blockquote':
      return chain.setParagraph().wrapIn('blockquote').run()
    case 'callout':
      return chain.setParagraph().wrapIn('callout').run()
    case 'codeBlock':
      return chain.setCodeBlock().run()
    case 'toggle': {
      const ok = chain.setParagraph().run()
      return ok && wrapInToggle(editor)
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Insert                                                              */
/* ------------------------------------------------------------------ */

const NEEDS_INPUT = new Set(['image', 'bookmark', 'embed', 'fileBlock', 'blockMath'])

/**
 * Insert block content at the selection the Notion way: an empty paragraph is replaced,
 * otherwise the content goes below the current block. Optionally removes `range` first
 * (the "/query" text of the slash menu).
 */
export function insertBlock(editor: Editor, content: JSONContent | JSONContent[], range?: Range | null): boolean {
  const { state, view, schema } = editor
  const tr = state.tr
  if (range) tr.delete(range.from, range.to)
  const list = Array.isArray(content) ? content : [content]
  let nodes: PMNode[]
  try {
    nodes = list.map((c) => schema.nodeFromJSON(c))
  } catch (err) {
    console.warn('[editor] invalid block', err)
    return false
  }
  const $from = tr.selection.$from
  let at: number
  const parent = $from.parent
  const replaceEmpty = parent.type.name === 'paragraph' && parent.content.size === 0 && $from.depth >= 1
  if (replaceEmpty) {
    at = $from.before()
    tr.replaceWith(at, $from.after(), nodes)
  } else {
    const b = blockAtResolved($from)
    at = b ? b.pos + b.node.nodeSize : tr.doc.content.size
    tr.insert(at, nodes)
  }
  const size = nodes.reduce((s, n) => s + n.nodeSize, 0)
  const end = at + size
  const first = nodes[0]
  if (first.isAtom && NEEDS_INPUT.has(first.type.name) && nodes.length === 1) {
    // select it so its node view opens the input
    if (!tr.doc.nodeAt(end) && end >= tr.doc.content.size) tr.insert(end, schema.nodes.paragraph.create())
    tr.setSelection(NodeSelection.create(tr.doc, at))
  } else {
    // first textblock inside the inserted content, else the block after it
    let caret = -1
    tr.doc.nodesBetween(at, end, (n, pos) => {
      if (caret >= 0) return false
      if (n.isTextblock) {
        caret = pos + 1 + n.content.size
        return false
      }
      return true
    })
    if (caret < 0) {
      const next = tr.doc.resolve(Math.min(end, tr.doc.content.size)).nodeAfter
      if (!next || !next.isTextblock) tr.insert(end, schema.nodes.paragraph.create())
      caret = end + 1
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))))
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** Text range covering all inline content of a block (for colouring a whole block). */
export function blockTextRange(ref: BlockRef): Range {
  return { from: ref.pos + 1, to: ref.pos + ref.node.nodeSize - 1 }
}
