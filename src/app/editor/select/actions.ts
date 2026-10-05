/**
 * The block menu's actions for several selected blocks — each one transaction (one ⌘Z).
 */
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { trackMove } from '../lib/moves'
import { turnInto, type TurnTarget } from '../lib/blocks'
import { blockSelectionAt, siblingsAt, type BlockSel } from './model'

/** The blocks again in the current doc (positions still between the same siblings), else null. */
export function fresh(editor: Editor, b: BlockSel): BlockSel | null {
  if (editor.isDestroyed) return null
  const now = siblingsAt(editor.state.doc, b.from, b.to)
  return now && now.nodes.length === b.nodes.length && now.nodes.every((n, i) => n === b.nodes[i]) ? now : null
}

/** Delete them all (a container that would be left empty keeps an empty line). */
export function deleteBlocks(editor: Editor, b: BlockSel): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  const { state, view } = editor
  const tr = state.tr
  if (at.parent.canReplace(at.start, at.end, Fragment.empty)) tr.delete(at.from, at.to)
  else tr.replaceWith(at.from, at.to, state.schema.nodes.paragraph.create())
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at.from, tr.doc.content.size)), -1))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** Copies right after the last one (fresh block ids); the copies end up selected. */
export function duplicateBlocks(editor: Editor, b: BlockSel): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  const { state, view } = editor
  const copies = at.nodes.map((n) => n.type.create({ ...n.attrs, id: null }, n.content, n.marks))
  const tr = state.tr.insert(at.to, copies)
  const size = copies.reduce((s, n) => s + n.nodeSize, 0)
  const sel = blockSelectionAt(tr.doc, at.to, at.to + size)
  if (sel) tr.setSelection(sel)
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Append them to another page (undo here takes them back out — see trackMove) and remove them here. */
export function moveBlocks(editor: Editor, b: BlockSel, targetId: string): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  for (const n of at.nodes) trackMove(editor, n.toJSON(), targetId)
  return deleteBlocks(editor, at)
}

/** The text range of the blocks (from the first text position to the last). */
function textRange(doc: PMNode, b: BlockSel): { from: number; to: number } {
  const first = Selection.findFrom(doc.resolve(b.from), 1, true)
  const last = Selection.findFrom(doc.resolve(b.to), -1, true)
  return { from: first?.from ?? b.from, to: Math.max(first?.from ?? b.from, last?.to ?? b.to) }
}

/** Turn them all into one text type (the caret-based "Turn into" over their text). */
export function turnBlocksInto(editor: Editor, b: BlockSel, target: TurnTarget): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  const { from, to } = textRange(editor.state.doc, at)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
  return turnInto(editor, target)
}

/** Text colour / background over all their text; the blocks stay selected. */
export function colorBlocks(editor: Editor, b: BlockSel, kind: 'text' | 'bg', color: string | null): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  const { from, to } = textRange(editor.state.doc, at)
  let ch = editor.chain().setTextSelection({ from, to })
  if (kind === 'text') ch = color ? ch.setTextColor(color) : ch.unsetTextColor()
  else ch = color ? ch.setHighlight({ color }) : ch.unsetHighlight()
  return ch
    .command(({ tr }) => {
      const sel = blockSelectionAt(tr.doc, at.from, at.to)
      if (sel) tr.setSelection(sel)
      return true
    })
    .run()
}

/** Uniform text colour / highlight of all their text (null when mixed or none). */
export function colorsOf(b: BlockSel): { text: string | null; bg: string | null } {
  let text: string | null | undefined
  let bg: string | null | undefined
  for (const node of b.nodes)
    node.descendants((child) => {
      if (!child.isText) return true
      const c = (child.marks.find((m) => m.type.name === 'textStyle')?.attrs.color as string | null) ?? null
      const h = (child.marks.find((m) => m.type.name === 'highlight')?.attrs.color as string | null) ?? null
      text = text === undefined ? c : text === c ? text : null
      bg = bg === undefined ? h : bg === h ? bg : null
      return false
    })
  return { text: text ?? null, bg: bg ?? null }
}

/** Move them one block up / down within their container (Mod+Shift+↑ / ↓); they stay selected. */
export function moveBlocksBy(editor: Editor, b: BlockSel, dir: -1 | 1): boolean {
  const at = fresh(editor, b)
  if (!at) return false
  const i = dir < 0 ? at.start - 1 : at.end
  if (i < 0 || i >= at.parent.childCount) return true
  const sibling = at.parent.child(i)
  const { state, view } = editor
  const tr = state.tr
  const size = at.to - at.from
  let from: number
  if (dir < 0) {
    from = at.from - sibling.nodeSize
    tr.delete(from, at.from).insert(from + size, sibling)
  } else {
    tr.delete(at.to, at.to + sibling.nodeSize).insert(at.from, sibling)
    from = at.from + sibling.nodeSize
  }
  const sel = blockSelectionAt(tr.doc, from, from + size, at.anchor !== at.start)
  if (sel) tr.setSelection(sel)
  view.dispatch(tr.scrollIntoView())
  return true
}
