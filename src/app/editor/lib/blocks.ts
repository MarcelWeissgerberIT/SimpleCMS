/**
 * Block-level operations shared by the slash menu, block menu, bubble toolbar and shortcuts.
 */
import type { Editor, JSONContent, Range } from '@tiptap/core'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { toggleHeadingLevel, type ToggleHeadingLevel } from '../schema/toggle'

/** Parents whose children are "blocks" in the Notion sense. */
const CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent', 'blockquote', 'tab', 'syncedBlock'])
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
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'blockquote'
  | 'callout'
  | 'codeBlock'

const LIST_TYPES: Record<string, string> = { bulletList: 'bulletList', orderedList: 'orderedList', taskList: 'taskList' }

/** Containers whose lines are blocks of their own: turning a line into something converts it in place. */
const TURN_STOPS = new Set(['detailsContent', 'column', 'tableCell', 'tableHeader', 'callout', 'tab', 'syncedBlock'])

/**
 * The "Turn into" type of the block at the caret. Lines inside callouts, toggles and columns are
 * blocks of their own; a quote holding a single block IS that quote block (Notion), a longer quote
 * is a container like a callout.
 */
export function activeTurnTarget(editor: Editor): TurnTarget | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    const n = node.type.name
    if (n === 'bulletList' || n === 'orderedList' || n === 'taskList') return n
    if (TURN_STOPS.has(n)) break
    if (n === 'blockquote') {
      if (node.childCount === 1) return 'blockquote'
      break
    }
  }
  const p = $from.parent
  if (p.type.name === 'heading') return `heading${p.attrs.level}` as TurnTarget
  if (p.type.name === 'codeBlock') return 'codeBlock'
  if (p.type.name === 'detailsSummary') {
    const level = toggleHeadingLevel($from.node(-1))
    return level ? (`toggleHeading${level}` as TurnTarget) : 'toggle'
  }
  return 'paragraph'
}

/** Lift the list item at the caret out of its list(s) — it stays inside its container (callout, toggle …). */
function liftOutOfLists(editor: Editor) {
  for (let i = 0; i < 8; i++) {
    const { $from } = editor.state.selection
    let item: string | null = null
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d).type.name
      if (LIST_ITEMS.has(n)) {
        item = n
        break
      }
      if (TURN_STOPS.has(n) || n === 'blockquote') break
    }
    if (!item || !editor.commands.liftListItem(item)) return
  }
}

/** Toggle (0) or toggle heading level (1–3) of a "Turn into" target; null for other targets. */
function toggleTargetLevel(target: TurnTarget): ToggleHeadingLevel | null {
  if (target === 'toggle') return 0
  const m = /^toggleHeading([123])$/.exec(target)
  return m ? (Number(m[1]) as ToggleHeadingLevel) : null
}

/** Wrap the current textblock into a toggle (or toggle heading); its text becomes the title. */
function wrapInToggle(editor: Editor, heading: ToggleHeadingLevel = 0): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  const block = $from.parent
  if (!block.isTextblock) return false
  const from = $from.before()
  const to = $from.after()
  const schema = state.schema
  const details = schema.nodes.details.create({ open: true, heading }, [
    schema.nodes.detailsSummary.create(null, block.content),
    schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create()),
  ])
  const tr = state.tr.replaceWith(from, to, details)
  tr.setSelection(TextSelection.create(tr.doc, from + 2 + block.content.size))
  view.dispatch(tr)
  return true
}

/** Replace the toggle around a caret in its title with: title → paragraph, then the body blocks. */
function unwrapToggle(editor: Editor): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  if ($from.parent.type.name !== 'detailsSummary') return false
  const details = $from.node(-1)
  const pos = $from.before(-1)
  const schema = state.schema
  const head = schema.nodes.paragraph.create(null, $from.parent.content)
  const body: PMNode[] = []
  details.child(1)?.forEach((n) => body.push(n))
  const keepBody = !(body.length === 1 && body[0].type.name === 'paragraph' && body[0].content.size === 0)
  const tr = state.tr.replaceWith(pos, pos + details.nodeSize, keepBody ? [head, ...body] : [head])
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + $from.parentOffset))
  view.dispatch(tr)
  return true
}

/**
 * Caret in a toggle title → continue in the toggle body (its empty first line, or a new one),
 * so slash-menu blocks land inside the toggle instead of breaking it.
 */
export function moveIntoToggleBody(editor: Editor): boolean {
  const { $from } = editor.state.selection
  if ($from.parent.type.name !== 'detailsSummary') return false
  const detailsPos = $from.before(-1)
  const details = $from.node(-1)
  // open first (separate transaction, so the DOM is visible before the caret moves in)
  if (!details.attrs.open) editor.view.dispatch(editor.state.tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true }))
  const { state, view } = editor
  const node = state.doc.nodeAt(detailsPos)
  if (!node || node.childCount < 2) return false
  const bodyPos = detailsPos + 1 + node.child(0).nodeSize
  const first = node.child(1).firstChild
  const tr = state.tr
  if (!(first && first.type.name === 'paragraph' && first.content.size === 0)) tr.insert(bodyPos + 1, state.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, bodyPos + 2))
  view.dispatch(tr)
  return true
}

/** Caret in an empty list item → lift it out of all lists (Notion turns the empty item into the new block). */
export function liftEmptyListItem(editor: Editor) {
  for (let i = 0; i < 8; i++) {
    const { $from, empty } = editor.state.selection
    if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size || $from.depth < 2) return
    const item = $from.node(-1)
    if (!LIST_ITEMS.has(item.type.name) || item.childCount !== 1) return
    if (!editor.commands.liftListItem(item.type.name)) return
  }
}

/** Notion-style "Turn into" for the block at the selection (converted in place, inside its container). */
export function turnInto(editor: Editor, target: TurnTarget): boolean {
  // toggle ↔ toggle heading: only the title's level changes, the body stays inside
  const toggleLevel = toggleTargetLevel(target)
  const { $from: $sel } = editor.state.selection
  if (toggleLevel !== null && $sel.parent.type.name === 'detailsSummary') {
    const details = $sel.node(-1)
    if (toggleHeadingLevel(details) !== toggleLevel) editor.view.dispatch(editor.state.tr.setNodeMarkup($sel.before(-1), undefined, { ...details.attrs, heading: toggleLevel }))
    return true
  }
  // a toggle turned into something else: its title becomes that block, its body follows
  if (toggleLevel === null && $sel.parent.type.name === 'detailsSummary') unwrapToggle(editor)
  const current = activeTurnTarget(editor)
  if (current === target) return true
  const { $from } = editor.state.selection
  const container = $from.node(Math.max(0, $from.depth - 1)).type.name
  // a line of a callout / long quote is already "in" one — don't nest another around it
  if ((target === 'callout' && container === 'callout') || (target === 'blockquote' && container === 'blockquote')) return true
  const toList = target in LIST_TYPES
  const fromList = current === 'bulletList' || current === 'orderedList' || current === 'taskList'
  if (fromList && !toList) liftOutOfLists(editor)
  // the single block of a quote: unwrap the quote first
  if (current === 'blockquote') editor.commands.lift('blockquote')
  const keepList = fromList && toList
  const chain = editor.chain().focus()
  // setParagraph() on a paragraph falls back to clearNodes(), which lifts it out of its
  // container (callout, quote …) — only convert when it isn't one already
  const isPara = editor.state.selection.$from.parent.type.name === 'paragraph'
  const para = () => (keepList || isPara ? chain : chain.setParagraph())
  switch (target) {
    case 'paragraph':
      return para().run()
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return chain.setNode('heading', { level: Number(target.slice(-1)) }).run()
    case 'bulletList':
      return para().toggleBulletList().run()
    case 'orderedList':
      return para().toggleOrderedList().run()
    case 'taskList':
      return para().toggleTaskList().run()
    case 'blockquote':
      return para().wrapIn('blockquote').run()
    case 'callout':
      return para().wrapIn('callout').run()
    case 'codeBlock':
      return chain.setCodeBlock().run()
    case 'toggle':
    case 'toggleHeading1':
    case 'toggleHeading2':
    case 'toggleHeading3':
      return para().run() && wrapInToggle(editor, toggleLevel ?? 0)
  }
  return false
}

/**
 * "Turn into" from the block menu, for the block at `ref` itself. A callout / quote picked as a
 * whole is unwrapped (or re-wrapped); everything else converts like the caret version.
 */
export function turnBlockInto(editor: Editor, ref: BlockRef, target: TurnTarget): boolean {
  const { state, view, schema } = editor
  const node = state.doc.nodeAt(ref.pos)
  if (!node) return false
  const name = node.type.name
  if (name === 'callout' || name === 'blockquote') {
    if (target === name) return true
    if (target === 'callout' || target === 'blockquote') {
      const attrs = target === 'callout' ? { id: node.attrs.id, icon: '💡', color: 'gray' } : { id: node.attrs.id }
      const tr = state.tr.setNodeMarkup(ref.pos, schema.nodes[target], attrs)
      tr.setSelection(TextSelection.near(tr.doc.resolve(ref.pos + 1)))
      view.dispatch(tr)
      view.focus()
      return true
    }
    // unwrap: the children take the container's place, the first one becomes `target`
    const tr = state.tr.replaceWith(ref.pos, ref.pos + node.nodeSize, node.content)
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(ref.pos + 1, tr.doc.content.size))))
    view.dispatch(tr)
    return turnInto(editor, target)
  }
  view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(ref.pos + 1, state.doc.content.size)))))
  return turnInto(editor, target)
}

/**
 * Leave a node view (caption, URL form, TeX / diagram editor …) with a text caret right after the
 * node: inline → behind it; block → the start of the next line, or (newLine) a fresh empty line.
 * Creates the line when there is none, so typing never lands on a node selection.
 */
export function caretAfterNode(editor: Editor, pos: number | undefined | null, opts: { newLine?: boolean } = {}): boolean {
  if (editor.isDestroyed) return false
  const { state, view } = editor
  const node = typeof pos === 'number' ? state.doc.nodeAt(pos) : null
  if (typeof pos !== 'number' || !node) {
    view.focus()
    return false
  }
  const end = pos + node.nodeSize
  const tr = state.tr
  if (node.isInline) {
    tr.setSelection(TextSelection.create(tr.doc, end))
  } else {
    const $end = tr.doc.resolve(end)
    const after = $end.nodeAfter
    const para = state.schema.nodes.paragraph
    const reuse = after && (opts.newLine ? after.type === para && after.content.size === 0 : after.isTextblock && !after.type.spec.code)
    if (reuse) tr.setSelection(TextSelection.create(tr.doc, end + 1))
    else if ($end.parent.canReplaceWith($end.index(), $end.index(), para)) {
      tr.insert(end, para.create())
      tr.setSelection(TextSelection.create(tr.doc, end + 1))
    } else tr.setSelection(Selection.near($end, 1))
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/**
 * Keyboard exit from an input inside a node view (caption, title, TeX, diagram code …).
 * Enter → continue on an empty line below (Notion). Escape → onto an empty line right below
 * if there is one, otherwise the block itself is selected (typing can't touch it; Enter or
 * ↓ continue from there). Inline nodes always leave the caret right behind them.
 */
export function leaveNodeView(editor: Editor, pos: number | undefined | null, key: 'enter' | 'escape'): boolean {
  if (editor.isDestroyed) return false
  const node = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
  if (key === 'enter' || !node || node.isInline) return caretAfterNode(editor, pos, { newLine: true })
  const next = editor.state.doc.resolve(pos! + node.nodeSize).nodeAfter
  if (next && next.type.name === 'paragraph' && next.content.size === 0) return caretAfterNode(editor, pos, { newLine: true })
  if (!NodeSelection.isSelectable(node)) return caretAfterNode(editor, pos)
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos!)))
  editor.view.focus()
  return true
}

/** Caret at the end of a block's own text (its first textblock); false for blocks without text. */
export function caretIntoBlock(editor: Editor, pos: number): boolean {
  const { state, view } = editor
  const node = state.doc.nodeAt(pos)
  if (!node) return false
  let caret = -1
  if (node.isTextblock) caret = pos + 1 + node.content.size
  else
    node.descendants((n, p) => {
      if (caret >= 0) return false
      if (n.isTextblock) {
        caret = pos + 1 + p + 1 + n.content.size
        return false
      }
      return true
    })
  if (caret < 0) return false
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, caret)).scrollIntoView())
  return true
}

/* ------------------------------------------------------------------ */
/* Insert                                                              */
/* ------------------------------------------------------------------ */

const NEEDS_INPUT = new Set(['image', 'bookmark', 'embed', 'fileBlock', 'blockMath', 'video', 'audio'])
/** Blocks too big for a table cell: they go after the table instead. */
const HEAVY = new Set(['databaseBlock', 'columns', 'table', 'toc', 'embed', 'mermaid', 'tabs'])
const CELLS = new Set(['tableCell', 'tableHeader'])

/**
 * Insert block content at the selection the Notion way: an empty paragraph is replaced,
 * otherwise the content goes below the current block (inside the same container when it
 * accepts it). Optionally removes `range` first (the "/query" text of the slash menu).
 */
export function insertBlock(editor: Editor, content: JSONContent | JSONContent[], range?: Range | null): boolean {
  if (range) editor.view.dispatch(editor.state.tr.delete(range.from, range.to))
  moveIntoToggleBody(editor)
  liftEmptyListItem(editor)
  const { state, view, schema } = editor
  const tr = state.tr
  const list = Array.isArray(content) ? content : [content]
  let nodes: PMNode[]
  try {
    nodes = list.map((c) => schema.nodeFromJSON(c))
  } catch (err) {
    console.warn('[editor] invalid block', err)
    return false
  }
  const frag = Fragment.from(nodes)
  const heavy = nodes.some((n) => HEAVY.has(n.type.name))
  const $from = tr.selection.$from
  let at = -1
  const parent = $from.parent
  if (parent.type.name === 'paragraph' && parent.content.size === 0 && $from.depth >= 1) {
    const container = $from.node(-1)
    const idx = $from.index(-1)
    if (!(heavy && CELLS.has(container.type.name)) && container.canReplace(idx, idx + 1, frag)) {
      at = $from.before()
      tr.replaceWith(at, $from.after(), nodes)
    }
  }
  if (at < 0) {
    for (let d = $from.depth; d >= 1 && at < 0; d--) {
      const container = $from.node(d - 1)
      if (heavy && CELLS.has(container.type.name)) continue
      const idx = $from.index(d - 1)
      if (container.canReplace(idx + 1, idx + 1, frag)) at = $from.after(d)
    }
    if (at < 0) at = tr.doc.content.size
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

/* ------------------------------------------------------------------ */
/* Nesting: toggle / callout / columns keyboard behaviour               */
/* ------------------------------------------------------------------ */

const NESTERS = new Set(['listItem', 'taskItem', 'detailsContent', 'callout', 'column', 'tableCell', 'tableHeader', 'blockquote'])

/** Innermost nesting ancestor of a position (list item, toggle body, callout, column, cell, quote). */
export function innermostNester($pos: ResolvedPos): { depth: number; name: string } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (NESTERS.has(name)) return { depth: d, name }
  }
  return null
}

function selectionAt(tr: Transaction, pos: number) {
  const p = Math.max(0, Math.min(pos, tr.doc.content.size))
  const $p = tr.doc.resolve(p)
  tr.setSelection($p.parent.inlineContent ? TextSelection.create(tr.doc, p) : Selection.near($p))
}

/** Enter on the empty last line of a toggle body leaves the toggle. */
export function exitToggleOnEmptyLine(editor: Editor): boolean {
  const { state, view } = editor
  const { selection } = state
  const { $from, empty } = selection
  if (!empty || !(selection instanceof TextSelection) || $from.depth < 3) return false
  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false
  const body = $from.node(-1)
  if (body.type.name !== 'detailsContent' || $from.index(-1) !== body.childCount - 1) return false
  const afterToggle = $from.after(-2)
  const tr = state.tr
  // keep the body valid (block+): only remove the line when it isn't the only one
  if (body.childCount > 1) tr.delete($from.before(), $from.after())
  const at = tr.mapping.map(afterToggle)
  tr.insert(at, state.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, at + 1))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Enter in an open toggle title: continue in the (empty) first body line instead of adding another. */
export function enterFromToggleTitle(editor: Editor): boolean {
  const { state, view } = editor
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'detailsSummary' || $from.parentOffset !== $from.parent.content.size) return false
  const details = $from.node(-1)
  if (!details.attrs.open || details.childCount < 2) return false
  const first = details.child(1).firstChild
  if (!first || first.type.name !== 'paragraph' || first.content.size !== 0) return false
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.after() + 2)).scrollIntoView())
  return true
}

/**
 * Shift+Tab inside a toggle body or callout: move the block out, right after its container.
 * The blocks after it move along, so the reading order never changes (Notion nests them under
 * the outdented block; our text blocks can't hold children, so they follow it instead).
 */
export function outdentBlock(editor: Editor): boolean {
  const { state, view } = editor
  const sel = state.selection
  const { $from } = sel
  if ($from.parent.type.spec.code) return false
  const nest = innermostNester($from)
  if (!nest || (nest.name !== 'detailsContent' && nest.name !== 'callout')) return false
  const d = nest.depth
  if ($from.depth < d + 1) return false
  const container = $from.node(d)
  const index = $from.index(d)
  const blockPos = $from.before(d + 1)
  const anchorOff = sel.anchor - blockPos
  const headOff = sel.head - blockPos
  const moved = container.content.cut(blockPos - $from.start(d))
  const tr = state.tr
  let newPos: number
  if (nest.name === 'callout' && index === 0) {
    // everything leaves the callout: unwrap it
    newPos = $from.before(d)
    tr.replaceWith(newPos, $from.after(d), container.content)
  } else {
    const after = $from.after(nest.name === 'detailsContent' ? d - 1 : d)
    // a toggle body must keep one line
    if (index === 0) tr.replaceWith(blockPos, $from.end(d), state.schema.nodes.paragraph.create())
    else tr.delete(blockPos, $from.end(d))
    newPos = tr.mapping.map(after)
    tr.insert(newPos, moved)
  }
  try {
    tr.setSelection(TextSelection.create(tr.doc, newPos + anchorOff, newPos + headOff))
  } catch {
    selectionAt(tr, newPos + headOff)
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Tab / Shift+Tab inside columns: jump to the end of the next / previous column. */
export function jumpColumn(editor: Editor, dir: 1 | -1): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  if ($from.parent.type.spec.code) return false
  const nest = innermostNester($from)
  if (!nest || nest.name !== 'column') return false
  const columns = $from.node(nest.depth - 1)
  const target = $from.index(nest.depth - 1) + dir
  if (target < 0 || target >= columns.childCount) return false
  let pos = $from.start(nest.depth - 1)
  for (let i = 0; i < target; i++) pos += columns.child(i).nodeSize
  const end = pos + columns.child(target).nodeSize - 1
  const found = Selection.findFrom(state.doc.resolve(end), -1, true)
  if (!found) return false
  view.dispatch(state.tr.setSelection(found).scrollIntoView())
  return true
}

/** Backspace at the start of a block that follows an atom block (image, embed …): select that block. */
export function selectAtomBefore(editor: Editor): boolean {
  const { state, view } = editor
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0 || !$from.parent.isTextblock || $from.depth < 1) return false
  const idx = $from.index($from.depth - 1)
  if (idx === 0) return false
  const before = $from.node($from.depth - 1).child(idx - 1)
  if (!before.isAtom || !before.isBlock || !NodeSelection.isSelectable(before)) return false
  const beforePos = $from.before() - before.nodeSize
  const tr = state.tr
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) tr.delete($from.before(), $from.after())
  tr.setSelection(NodeSelection.create(tr.doc, beforePos))
  view.dispatch(tr.scrollIntoView())
  return true
}
