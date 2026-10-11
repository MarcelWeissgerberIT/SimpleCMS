/**
 * Task block — field writes in the editor. ONE helper for every editor-side write (key, caret, confirm, pickers,
 * `@` rows, NEW ID, relink): `commitItem` / `commitItems`.
 *
 *  - Target: where the person acted — `{ pos, itemId, blockId }` from getPos() when the action started (a picker
 *    maps `pos` through every transaction while it is open). At commit: the node at `pos` when it is a task with that
 *    itemId (and its block id agrees); else the task whose block id is `blockId` (else the pos match, when only the
 *    block id changed); else NOTHING is written (toast "no longer here"). Never "the
 *    first block with this itemId": duplicates are shown on purpose and a synced reference can sit next to its
 *    original — a click on one block changes that block. `{ itemId }` (writeItems): the doc's first occurrence
 *    outside synced copies (the index winner on that page).
 *  - Delta only: `setNodeMarkup(pos, undefined, { ...node.attrs, ...delta })` — the values a write leaves alone keep
 *    their object (y-tiptap writes an attribute when the value differs BY REFERENCE).
 *  - One undo step in every editor: `closeHistory` on the transaction + startUndoStep / endUndoStep around it (Y
 *    undo in shared pages) — never merged with typing, two quick key clicks are two steps.
 * The keys (Enter, Shift+Enter, Backspace, Mod+Alt+Enter): `WorkItemKeys` below; Mod+Enter: the behaviors walk.
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { t } from '../../i18n'
import { useUI } from '../../store/ui'
import { endUndoStep, startUndoStep } from '../collab'
import { liveEditorOf } from '../context/store'
import { bridgeOf } from '../context/redo'
import type { ItemPickerKind, ItemPickerState } from '../lib/bridge'
import { flushContentOf } from '../lib/contentFlush'
import { PERSON_META } from '../lib/editAs'
import { itemAttrs, WORK_ITEM, type WorkItemStatus } from './attrs'
import { itemHooks, itemLookup } from './lookup'
import { findItemPos, patchItemAttrs, type ItemPatch } from './patch'
import { itemTitleText } from './text'
import { itemRulePlugin, undoItemRule } from './turnInto'
import { announceStatus } from './announce'
import { newItemId } from '../../lib/itemIds'

/** Where a write lands (see the header). */
export type ItemTarget = { pos: number; itemId: string | null; blockId: string | null } | { itemId: string }

const isItem = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === WORK_ITEM

/** The position of the task a target means in `doc`, or null (nothing is written then). */
export function resolveItemTarget(doc: PMNode, target: ItemTarget): number | null {
  if (!('pos' in target)) return findItemPos(doc, target.itemId)
  let atPos: number | null = null
  if (target.pos >= 0 && target.pos < doc.content.size) {
    const node = doc.nodeAt(target.pos)
    if (isItem(node) && (node.attrs.itemId ?? null) === target.itemId) {
      // the very block: its block id agrees (or one of them has none)
      if (!target.blockId || !node.attrs.id || node.attrs.id === target.blockId) return target.pos
      atPos = target.pos
    }
  }
  if (target.blockId) {
    let at: number | null = null
    doc.descendants((node, pos) => {
      if (at !== null) return false
      if (isItem(node) && node.attrs.id === target.blockId) {
        at = pos
        return false
      }
      return !node.isTextblock && !node.isAtom
    })
    if (at !== null) return at
  }
  // the block id changed meanwhile (a concurrent edit gave the block a new one): the mapped pos still holds it
  return atPos
}

export interface CommitOptions {
  /** own undo step (default true) */
  undoStep?: boolean
  /** 'person': a status that became done raises the unblock toast */
  by?: 'person' | 'system'
}

/** Write several tasks' fields in ONE transaction (one undo step). Per edit: written / nothing to change (true) or not found (false). */
export function commitItems(editor: Editor, edits: ReadonlyArray<{ target: ItemTarget; patch: ItemPatch }>, opts: CommitOptions = {}): boolean[] {
  if (editor.isDestroyed) return edits.map(() => false)
  const view = editor.view
  const tr = view.state.tr
  const now = Date.now()
  const finished: string[] = []
  const said: Array<{ status: WorkItemStatus; title: string }> = []
  const results = edits.map(({ target, patch }) => {
    const pos = resolveItemTarget(tr.doc, target)
    if (pos === null) return false
    const node = tr.doc.nodeAt(pos)!
    const delta = patchItemAttrs(node.attrs, patch, now)
    if (!delta) return true
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...delta })
    if (delta.status === 'done' && typeof (delta.itemId ?? node.attrs.itemId) === 'string') finished.push((delta.itemId ?? node.attrs.itemId) as string)
    if (typeof delta.status === 'string') said.push({ status: delta.status as WorkItemStatus, title: itemTitleText(node) })
    return true
  })
  if (tr.docChanged) {
    closeHistory(tr)
    tr.setMeta('workItemWrite', true)
    // a person's write from the task's own controls (key, picker, chip — a picker may write after its event): the
    // editor's flush names it (store/writer.ts); writeItems' 'system' commits run inside its writer's editAs
    if (opts.by === 'person') tr.setMeta(PERSON_META, true)
    const step = opts.undoStep !== false
    if (step) startUndoStep(view)
    view.dispatch(tr)
    if (step) endUndoStep(view)
  }
  // a person's status change, in words for screen readers (the LED and the label alone say nothing to them)
  if (opts.by === 'person' && said.length) announceStatus(said)
  if (opts.by === 'person' && finished.length) {
    // the index reads the store: what this editor did a moment ago (a link to the task just finished) goes there first
    flushContentOf(editor)
    itemHooks().finished(finished, view.dom.getAttribute('data-page-id'))
  }
  return results
}

/** Write one task's fields (see commitItems). A person's target that no longer resolves → toast, false. */
export function commitItem(editor: Editor, target: ItemTarget, patch: ItemPatch, opts: CommitOptions = {}): boolean {
  const [ok] = commitItems(editor, [{ target, patch }], opts)
  if (!ok && 'pos' in target) useUI.getState().toast({ message: t('features.workItems.refused.gone') })
  return ok
}

/* ------------------------------------------------------------------ status: the key, the caret, Mod+Enter, the menu */

/** The block a person acts on: its position now + its itemId and block id (what a write targets). */
export function itemTargetAt(editor: Editor, pos: number): { pos: number; itemId: string | null; blockId: string | null } | null {
  if (editor.isDestroyed) return null
  const node = editor.state.doc.nodeAt(pos)
  if (!isItem(node)) return null
  return { pos, itemId: (node.attrs.itemId as string | null) ?? null, blockId: (node.attrs.id as string | null) ?? null }
}

/**
 * Set a task's status as the person asked (key, ⌄, Mod+Enter, Mod+Alt+Enter, the menu). A task still waiting for an
 * open blocker asks once before it is started or marked done (the confirm popover at its key; advisory — decision 3).
 * One transaction, one undo step; a finish raises the unblock toast.
 */
export function setItemStatus(editor: Editor, pos: number, status: WorkItemStatus, from: ItemPickerState['from'] = 'key'): boolean {
  const target = itemTargetAt(editor, pos)
  if (!target) return false
  const a = itemAttrs(editor.state.doc.nodeAt(pos))
  if (a.status === status) return true
  const pageId = editor.view.dom.getAttribute('data-page-id')
  const bridge = bridgeOf(editor)
  if (status !== 'todo' && a.status !== 'done' && bridge && itemLookup().openBlockers(a, pageId) > 0) {
    bridge.setState({ itemPicker: { ...target, kind: 'confirm', status, from, hadFocus: editor.view.hasFocus() } })
    return true
  }
  return commitItem(editor, target, { status }, { by: 'person' })
}

/** The key: open / in progress → done, done → open. Alt: in progress ⇄ open (done → in progress). */
export function nextStatus(status: WorkItemStatus, alt: boolean): WorkItemStatus {
  if (alt) return status === 'in_progress' ? 'todo' : 'in_progress'
  return status === 'done' ? 'todo' : 'done'
}

/** Mod+Enter (alt = Mod+Alt+Enter) on the task at `pos`. */
export function toggleItemDone(editor: Editor, pos: number, alt = false): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!isItem(node)) return false
  return setItemStatus(editor, pos, nextStatus(itemAttrs(node).status, alt), 'key')
}

/**
 * Open a picker of the task at `pos` (key ⌄, a chip, a ghost, a menu item). Whether the editor had the keyboard is
 * read NOW, before any picker mounts and takes it (a menu that opened the picker says it in `extra.hadFocus`).
 */
export function openItemPickerAt(editor: Editor, pos: number, kind: ItemPickerKind, from: ItemPickerState['from'], extra: Partial<ItemPickerState> = {}): boolean {
  const target = itemTargetAt(editor, pos)
  const bridge = bridgeOf(editor)
  if (!target || !bridge) return false
  bridge.setState({ itemPicker: { ...target, kind, from, hadFocus: !editor.isDestroyed && editor.view.hasFocus(), ...extra } })
  return true
}

/** The end of a task's title (a text position). */
export function titleEnd(doc: PMNode, pos: number): number {
  const node = doc.nodeAt(pos)
  return pos + 1 + (node?.firstChild?.nodeSize ?? 2) - 1
}

/**
 * Back to writing in a task: the editor takes the keyboard; the caret stays where it was when it sat inside this task,
 * else (or `force`: the block menu had selected the whole task) it goes to the end of the task's title.
 */
export function focusTitleEnd(editor: Editor, target: ItemTarget, opts: { force?: boolean } = {}): void {
  if (editor.isDestroyed || !editor.isEditable) return
  const pos = resolveItemTarget(editor.state.doc, target)
  if (pos === null) return void editor.view.focus()
  const node = editor.state.doc.nodeAt(pos)!
  const sel = editor.state.selection
  const inside = !opts.force && sel instanceof TextSelection && sel.from > pos && sel.to < pos + node.nodeSize
  if (!inside) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, titleEnd(editor.state.doc, pos))))
  editor.view.focus()
}

/** "+ NOTE": the task's first note line (made when there is none), caret in it. */
export function focusFirstNote(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!isItem(node) || !node.firstChild) return false
  const at = pos + 1 + node.firstChild.nodeSize
  const tr = editor.state.tr
  const second = node.childCount > 1 ? node.child(1) : null
  if (second && second.isTextblock) tr.setSelection(TextSelection.create(tr.doc, at + 1))
  else {
    tr.insert(at, editor.state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
  }
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

// Test hook (dev, or ?e2e): commit a person's write to a block of a page's live editor (targeting tests)
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneItemsEditor?: unknown }).__oneItemsEditor = {
    commit: (pageId: string, target: ItemTarget, patch: ItemPatch) => {
      const editor = liveEditorOf(pageId)
      return editor ? commitItem(editor, target, patch, { by: 'person' }) : false
    },
    resolve: (pageId: string, target: ItemTarget) => {
      const editor = liveEditorOf(pageId)
      return editor ? resolveItemTarget(editor.state.doc, target) : null
    },
    /** open a picker of the task at `pos` (as its chip / menu would) */
    openPicker: (pageId: string, pos: number, kind: ItemPickerKind) => {
      const editor = liveEditorOf(pageId)
      return editor ? openItemPickerAt(editor, pos, kind, 'menu') : false
    },
    /** the open picker of a page's editor (pos mapped while it is open) */
    picker: (pageId: string) => {
      const editor = liveEditorOf(pageId)
      return (editor && bridgeOf(editor)?.getState().itemPicker) ?? null
    },
    /** the position of the n-th task of the page's editor (document order) */
    itemPos: (pageId: string, n: number) => {
      const editor = liveEditorOf(pageId)
      const out: number[] = []
      editor?.state.doc.descendants((node, pos) => {
        if (isItem(node)) out.push(pos)
        return !node.isTextblock
      })
      return out[n] ?? null
    },
  }
}

/* ------------------------------------------------------------------ the keyboard (workItemKeys) */

/** The task whose own line holds the caret: its depth, position and which child (0 = the title). */
function caretLine(editor: Editor): { pos: number; depth: number; index: number; node: PMNode } | null {
  const sel = editor.state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return null
  const $from = sel.$from
  const d = $from.depth - 1
  if (d < 1 || !$from.parent.isTextblock) return null
  const node = $from.node(d)
  if (!isItem(node)) return null
  return { pos: $from.before(d), depth: d, index: $from.index(d), node }
}

/** The innermost task around the caret (any depth): its position. */
export function itemAround(editor: Editor): number | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) if (isItem($from.node(d))) return $from.before(d)
  return null
}

const emptyFields = (n: PMNode) => {
  const a = itemAttrs(n)
  return a.status === 'todo' && !a.due && !a.people.length && !a.blockedBy.length && !a.related.length
}

/** A new, empty task (a fresh itemId, nothing inherited) holding `title` (inline content). */
function newTask(editor: Editor, title?: import('@tiptap/pm/model').Fragment): PMNode {
  const { schema } = editor.state
  return schema.nodes[WORK_ITEM].create({ itemId: newItemId(), status: 'todo' }, schema.nodes.paragraph.create(null, title))
}

/**
 * Enter in a task: at the end of a non-empty title → the next task (right after, same container); at its start →
 * a new task BEFORE this one (this one keeps its text and fields, the caret stays); in the middle → the text after
 * the caret becomes the next task's title (the fields stay on this one); on an empty title → a task without fields
 * or notes becomes an empty line (else nothing); on the empty LAST note line → that line leaves the task. The three
 * that make a task ask the creation gate first — shut: the default split (a note line).
 */
export function enterInItem(editor: Editor): boolean {
  const at = caretLine(editor)
  if (!at) return false
  const { state, view } = editor
  const $from = state.selection.$from
  const text = $from.parent
  if (at.index === 0) {
    if (!text.content.size) {
      if (!emptyFields(at.node) || at.node.childCount > 1) return true
      const tr = state.tr.replaceWith(at.pos, at.pos + at.node.nodeSize, state.schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, at.pos + 1))
      view.dispatch(tr.scrollIntoView())
      return true
    }
    if (!itemLookup().canCreate()) return false
    const off = $from.parentOffset
    const tr = state.tr
    if (off === 0) {
      // a new task before this one; the caret stays at the start of this title
      tr.insert(at.pos, newTask(editor))
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos)))
    } else {
      const after = at.pos + at.node.nodeSize
      const rest = off < text.content.size ? text.content.cut(off) : undefined
      if (rest) tr.delete($from.pos, $from.end())
      const next = tr.mapping.map(after)
      tr.insert(next, newTask(editor, rest))
      tr.setSelection(TextSelection.create(tr.doc, next + 2))
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }
  // the empty last note line leaves the task (like a toggle's body)
  if (at.index === at.node.childCount - 1 && text.type.name === 'paragraph' && !text.content.size) {
    const after = at.pos + at.node.nodeSize
    const tr = state.tr.delete($from.before(), $from.after())
    const to = tr.mapping.map(after)
    tr.insert(to, state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, to + 1))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  return false
}

/** Shift+Enter in a title: the caret goes to the first note line (made when there is none). */
export function shiftEnterInItem(editor: Editor): boolean {
  const at = caretLine(editor)
  if (!at || at.index !== 0) return false
  return focusFirstNote(editor, at.pos)
}

/** Backspace at the start of an EMPTY title: the task becomes its title line + notes (fields go; one undo step). */
export function unwrapItem(editor: Editor, pos?: number): boolean {
  const at = pos === undefined ? caretLine(editor) : (() => {
    const node = editor.state.doc.nodeAt(pos)
    return isItem(node) ? { pos, depth: 0, index: 0, node } : null
  })()
  if (!at) return false
  const { state, view } = editor
  const tr = state.tr.replaceWith(at.pos, at.pos + at.node.nodeSize, at.node.content)
  tr.setSelection(TextSelection.create(tr.doc, at.pos + 1))
  view.dispatch(tr.scrollIntoView())
  return true
}

function backspaceInItem(editor: Editor): boolean {
  const at = caretLine(editor)
  if (!at || at.index !== 0) return false
  const $from = editor.state.selection.$from
  if ($from.parentOffset !== 0 || $from.parent.content.size) return false
  // right after "[!] " made this task: Backspace undoes the rule (the typed "[!] " comes back), as everywhere else
  if (editor.commands.undoInputRule() || undoItemRule(editor)) return true
  return unwrapItem(editor)
}

/**
 * The task block's keys (priority 1100: before the editor's own shortcuts). Mod+Enter is NOT bound here — the
 * behaviors walk binds it (the deepest of to-do / toggle / task wins: a to-do in the notes toggles itself). Every
 * handler gives way while a suggestion menu is open and during IME composition.
 */
export const WorkItemKeys = Extension.create({
  name: 'workItemKeys',
  priority: 1100,
  addProseMirrorPlugins() {
    // the last "[!] " rule, for Backspace right after it
    return [itemRulePlugin()]
  },
  addKeyboardShortcuts() {
    const editor = this.editor
    const free = () => !editor.view.composing && !bridgeOf(editor)?.getState().suggest
    return {
      Enter: () => free() && enterInItem(editor),
      'Shift-Enter': () => free() && shiftEnterInItem(editor),
      Backspace: () => free() && backspaceInItem(editor),
      'Mod-Alt-Enter': () => {
        if (!free()) return false
        const pos = itemAround(editor)
        return pos !== null && toggleItemDone(editor, pos, true)
      },
    }
  },
})
