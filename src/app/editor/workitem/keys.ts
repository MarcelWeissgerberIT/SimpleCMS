/**
 * Task block — field writes in the editor. ONE helper for every editor-side write (key, caret, confirm, pickers,
 * `@` rows, NEW ID, relink): `commitItem` / `commitItems`.
 *
 *  - Target: where the person acted — `{ pos, itemId, blockId }` from getPos() when the action started (a picker
 *    maps `pos` through every transaction while it is open). At commit: the node at `pos` when it is a task with that
 *    itemId; else the task whose block id is `blockId`; else NOTHING is written (toast "no longer here"). Never "the
 *    first block with this itemId": duplicates are shown on purpose and a synced reference can sit next to its
 *    original — a click on one block changes that block. `{ itemId }` (writeItems): the doc's first occurrence
 *    outside synced copies (the index winner on that page).
 *  - Delta only: `setNodeMarkup(pos, undefined, { ...node.attrs, ...delta })` — the values a write leaves alone keep
 *    their object (y-tiptap writes an attribute when the value differs BY REFERENCE).
 *  - One undo step in every editor: `closeHistory` on the transaction + startUndoStep / endUndoStep around it (Y
 *    undo in shared pages) — never merged with typing, two quick key clicks are two steps.
 * The bindings (Enter, Backspace, Mod+Alt+Enter …) come with the interactive block (Stage B).
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { t } from '../../i18n'
import { useUI } from '../../store/ui'
import { endUndoStep, startUndoStep } from '../collab'
import { WORK_ITEM } from './attrs'
import { itemHooks } from './lookup'
import { findItemPos, patchItemAttrs, type ItemPatch } from './patch'

/** Where a write lands (see the header). */
export type ItemTarget = { pos: number; itemId: string | null; blockId: string | null } | { itemId: string }

const isItem = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === WORK_ITEM

/** The position of the task a target means in `doc`, or null (nothing is written then). */
export function resolveItemTarget(doc: PMNode, target: ItemTarget): number | null {
  if (!('pos' in target)) return findItemPos(doc, target.itemId)
  if (target.pos >= 0 && target.pos < doc.content.size) {
    const node = doc.nodeAt(target.pos)
    if (isItem(node) && (node.attrs.itemId ?? null) === target.itemId) return target.pos
  }
  if (!target.blockId) return null
  let at: number | null = null
  doc.descendants((node, pos) => {
    if (at !== null) return false
    if (isItem(node) && node.attrs.id === target.blockId) {
      at = pos
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return at
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
  const results = edits.map(({ target, patch }) => {
    const pos = resolveItemTarget(tr.doc, target)
    if (pos === null) return false
    const node = tr.doc.nodeAt(pos)!
    const delta = patchItemAttrs(node.attrs, patch, now)
    if (!delta) return true
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...delta })
    if (delta.status === 'done' && typeof (delta.itemId ?? node.attrs.itemId) === 'string') finished.push((delta.itemId ?? node.attrs.itemId) as string)
    return true
  })
  if (tr.docChanged) {
    closeHistory(tr)
    tr.setMeta('workItemWrite', true)
    const step = opts.undoStep !== false
    if (step) startUndoStep(view)
    view.dispatch(tr)
    if (step) endUndoStep(view)
  }
  if (opts.by === 'person' && finished.length) itemHooks().finished(finished, view.dom.getAttribute('data-page-id'))
  return results
}

/** Write one task's fields (see commitItems). A person's target that no longer resolves → toast, false. */
export function commitItem(editor: Editor, target: ItemTarget, patch: ItemPatch, opts: CommitOptions = {}): boolean {
  const [ok] = commitItems(editor, [{ target, patch }], opts)
  if (!ok && 'pos' in target) useUI.getState().toast({ message: t('features.workItems.refused.gone') })
  return ok
}
