/**
 * Live collaboration in the editor (team cloud): the page's Y document instead of page.content.
 *  - Collaboration: binds the doc's XmlFragment ('default'); brings Y undo (only your own changes,
 *    in steps — see "Undo steps" below).
 *  - CollaborationCaret: other people's carets — a hairline in their colour with a small mono name
 *    tag (INSTRUMENT), selections tinted in their colour's wash.
 *  - CollabBlockIds: block ids stay unique when concurrent edits (from different people) end up
 *    with the same id — the second occurrence gets a fresh one.
 */
import { Extension, type AnyExtension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type StateField, type Transaction } from '@tiptap/pm/state'
import type { DecorationAttrs, EditorView } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { ProsemirrorBinding, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { ContentDocHandle } from '../cloud'
import { COLOR_NAMES } from '../store/types'
import { BLOCK_ID_TYPES } from './schema/base'

const TONES = new Set<string>(COLOR_NAMES)

/* ------------------------------------------------------------------ */
/* Caret restore after remote changes                                  */
/*                                                                     */
/* y-tiptap 3.0.9 re-renders the doc on every remote change and puts   */
/* the local caret back from Yjs relative positions — but its          */
/* "structural change" heuristic distrusts Yjs whenever the text of    */
/* the caret's paragraph changed, and keeps the OLD offset instead. So */
/* when someone types earlier in the same paragraph, your caret slides */
/* back and your next letters land in the wrong place. After its       */
/* restore we put the Yjs-resolved caret back when it lies in the very */
/* same block (same block id) — the case the heuristic gets wrong.     */
/* ------------------------------------------------------------------ */

interface RelSel {
  type: string
  anchor: unknown
  head: unknown
  absAnchor?: number
  absHead?: number
}

interface BindingLike {
  doc: Y.Doc
  type: Y.XmlFragment
  mapping: Map<unknown, unknown>
  prosemirrorView: EditorView | null
  beforeTransactionSelection: RelSel | null
}

function sameTextblock(before: EditorState, oldPos: number | undefined, after: EditorState, newPos: number): boolean {
  if (oldPos === undefined || oldPos > before.doc.content.size || newPos > after.doc.content.size) return false
  const $o = before.doc.resolve(oldPos)
  const $n = after.doc.resolve(newPos)
  const id = $o.parent.attrs.id
  return $o.parent.isTextblock && $n.parent.isTextblock && $o.parent.type === $n.parent.type && typeof id === 'string' && !!id && id === $n.parent.attrs.id
}

function fixCaret(binding: BindingLike, rel: RelSel | null, before: EditorState | undefined, origin: unknown) {
  const view = binding.prosemirrorView
  // own edits (the binding's mux skips them) and undo / redo (restores its own selection) stay as they are
  if (!view || !before || !rel || rel.type !== 'text' || rel.anchor == null || rel.head == null || origin === ySyncPluginKey || origin instanceof Y.UndoManager) return
  const state = view.state
  const anchor = relativePositionToAbsolutePosition(binding.doc, binding.type, rel.anchor, binding.mapping as never)
  const head = relativePositionToAbsolutePosition(binding.doc, binding.type, rel.head, binding.mapping as never)
  if (anchor === null || head === null) return
  if (state.selection.anchor === anchor && state.selection.head === head) return
  if (!sameTextblock(before, rel.absAnchor, state, anchor) || !sameTextblock(before, rel.absHead, state, head)) return
  // selection only: nothing to undo (marking it 'addToHistory: false' would close your undo step)
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)))
}

const proto = ProsemirrorBinding.prototype as unknown as {
  _typeChanged: (events: unknown, transaction: Y.Transaction) => void
  __oneCaretFix?: boolean
}
if (!proto.__oneCaretFix) {
  proto.__oneCaretFix = true
  const original = proto._typeChanged
  proto._typeChanged = function (this: BindingLike, events: unknown, transaction: Y.Transaction) {
    const rel = this.beforeTransactionSelection
    const before = this.prosemirrorView?.state
    original.call(this, events, transaction)
    try {
      fixCaret(this, rel, before, transaction.origin)
    } catch {
      /* keep y-tiptap's selection */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Undo steps                                                          */
/*                                                                     */
/* Y undo merges your own changes into one step while they follow each */
/* other within 500 ms; `stopCapturing()` ends the step early. Two     */
/* things made the steps wrong in a shared page:                       */
/*                                                                     */
/* 1. y-tiptap 3.0.9's sync plugin keeps `addToHistory: false` after a */
/*    REMOTE change (it only updates the flag on doc-changing          */
/*    transactions), and its view calls `stopCapturing()` on each      */
/*    later transaction that is not a remote change: the caret repaint */
/*    after each of someone else's keystrokes, the caret fix above. So */
/*    while someone else typed, each of your keystrokes became its own */
/*    step, and where your last step began depended on whose keystroke */
/*    came last: ⌘Z after more typing took a stray letter back with    */
/*    it. Changes from Yjs are never written back (the binding's       */
/*    mutex), so the flag only matters for your own changes — remote   */
/*    ones now leave it as your last own change set it.                */
/* 2. Y undo knows only time; ProseMirror's history (local workspaces) */
/*    also starts a new step when the next change is somewhere else.   */
/*    Here placing the caret — a press in the editor, a caret key —    */
/*    ends the step: what you type after it is undone on its own.      */
/* ------------------------------------------------------------------ */

interface SyncPluginState {
  isChangeOrigin: boolean
  addToHistory: boolean
}

const patchedSyncFields = new WeakSet<object>()

/** Remote / undo / re-render transactions (`isChangeOrigin`) leave `addToHistory` as it was. */
function keepOwnHistoryFlag(plugin: Plugin) {
  const field = plugin.spec.state as StateField<SyncPluginState> | undefined
  if (!field || patchedSyncFields.has(field)) return
  patchedSyncFields.add(field)
  const apply = field.apply
  field.apply = function (this: Plugin, tr, value, oldState, newState) {
    const next = apply.call(this, tr, value, oldState, newState)
    // y-tiptap copies its state for these, so the previous state object stays untouched
    if (next !== value && next.isChangeOrigin) next.addToHistory = value.addToHistory
    return next
  }
}

const OneCollaboration = Collaboration.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? []
    for (const plugin of plugins) if (plugin.spec.key === ySyncPluginKey) keepOwnHistoryFlag(plugin)
    return plugins
  },
})

const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

function closeUndoStep(view: EditorView) {
  const undo = yUndoPluginKey.getState(view.state) as { undoManager?: Y.UndoManager } | undefined
  undo?.undoManager?.stopCapturing()
}

/*
 * A change that must be its own undo step (Claude's result put in): `startUndoStep` right before its
 * transaction is built (that transaction also carries closeHistory for local pages), `endUndoStep` right
 * after it is dispatched. Shared pages use Y undo, which knows only time: without these, typing within
 * 500 ms before or after joined Claude's step, and ⌘Z took the person's own letters away with it.
 */
export function startUndoStep(view: EditorView): void {
  if (!view.isDestroyed) closeUndoStep(view)
}

export function endUndoStep(view: EditorView): void {
  if (view.isDestroyed) return
  // a step-less transaction that closes ProseMirror's history group (local pages; nothing in a shared one)
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  closeUndoStep(view)
}

/** Placing the caret (a press in the editor, a caret key) closes the current undo step. */
const CollabUndoSteps = Extension.create({
  name: 'oneCollabUndoSteps',
  // before other handlers: they may stop the event (handled keys, node views)
  priority: 1001,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('oneCollabUndoSteps'),
        props: {
          handleDOMEvents: {
            pointerdown: (view) => {
              closeUndoStep(view)
              return false
            },
            keydown: (view, event) => {
              if (CARET_KEYS.has(event.key) && !event.isComposing) closeUndoStep(view)
              return false
            },
          },
        },
      }),
    ]
  },
})

/** The person's colour name: `tone`, or parsed from a `var(--c-<name>-text)` colour. */
function toneOf(user: Record<string, unknown>): string {
  const t = typeof user.tone === 'string' ? user.tone : ''
  if (TONES.has(t)) return t
  const m = typeof user.css === 'string' ? user.css.match(/^var\(--c-([a-z]+)-text\)$/) : null
  return m && TONES.has(m[1]) ? m[1] : 'orange'
}

function renderCaret(user: Record<string, unknown>): HTMLElement {
  const tone = toneOf(user)
  const caret = document.createElement('span')
  caret.className = 'collab-caret'
  caret.style.setProperty('--caret', `var(--c-${tone}-text)`)
  caret.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'collab-caret__label'
  label.textContent = String(user.name ?? '').slice(0, 40) || '·'
  caret.append(label)
  return caret
}

function renderSelection(user: Record<string, unknown>): DecorationAttrs {
  return { nodeName: 'span', class: 'collab-sel', style: `--caret-wash: var(--c-${toneOf(user)}-bg)` }
}

const idTypes = new Set(BLOCK_ID_TYPES)

function freshId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const isRemote = (tr: Transaction) => tr.docChanged && !!tr.getMeta('y-sync$')

export const CollabBlockIds = Extension.create({
  name: 'oneCollabBlockIds',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('oneCollabBlockIds'),
        appendTransaction: (transactions, _old, state) => {
          if (!editor.isEditable || !transactions.some(isRemote)) return null
          const seen = new Set<string>()
          let tr: Transaction | null = null
          state.doc.descendants((node, pos) => {
            if (!idTypes.has(node.type.name)) return true
            const id = node.attrs.id
            if (typeof id === 'string' && id) {
              if (seen.has(id)) {
                tr ??= state.tr
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: freshId() })
              } else seen.add(id)
            }
            return true
          })
          return tr ? (tr as Transaction).setMeta('addToHistory', false) : null
        },
      }),
    ]
  },
})

/** The collaboration extensions for a page's content document. */
export function collabExtensions(handle: ContentDocHandle): AnyExtension[] {
  const m = handle.user.color.match(/^var\(--c-([a-z]+)-text\)$/)
  const user = { name: handle.user.name, css: handle.user.color, color: handle.user.color, tone: m && TONES.has(m[1]) ? m[1] : 'orange' }
  return [
    OneCollaboration.configure({ document: handle.doc, field: handle.field }),
    CollaborationCaret.configure({ provider: handle.provider, user, render: renderCaret, selectionRender: renderSelection }),
    CollabBlockIds,
    CollabUndoSteps,
  ]
}
