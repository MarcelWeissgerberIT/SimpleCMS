/**
 * Context marks — what Claude may read of a page for a request. Per tab, in memory: never saved,
 * synced or exported.
 *  - mode 'page' (default): the whole page · 'marked': only the marked top-level blocks · 'none': nothing.
 *  - marks are the ids (attrs.id, UniqueID) of top-level blocks, so they follow every edit — typing,
 *    moves, external writes, collaboration. A block that is gone simply stops counting.
 *  - the picker: one at a time per tab, bound to one live editor (plugin.ts, ContextPicker.tsx).
 */
import { createStore } from 'zustand/vanilla'
import type { Editor } from '@tiptap/core'
import type { ID } from '../../store/types'

export type ContextMode = 'page' | 'marked' | 'none'

export interface PageContext {
  mode: ContextMode
  /** ids of the marked top-level blocks (kept when the mode goes back to 'page') */
  ids: string[]
}

export interface PickerSession {
  pageId: ID
  editor: Editor
  /** the marks before the picker opened (Esc restores them) */
  saved: PageContext
  /** called once when the picker closes: true = Done, false = cancelled */
  onEnd?: (done: boolean) => void
}

interface ContextState {
  pages: Record<ID, PageContext>
  picker: PickerSession | null
  /** bumps on every doc change of a registered editor (words / blocks readouts follow typing) */
  rev: number
}

export const DEFAULT_CONTEXT: PageContext = { mode: 'page', ids: [] }

export const contextStore = createStore<ContextState>()(() => ({ pages: {}, picker: null, rev: 0 }))

export const pageContext = (pageId: ID): PageContext => contextStore.getState().pages[pageId] ?? DEFAULT_CONTEXT

export function putPageContext(pageId: ID, next: PageContext) {
  contextStore.setState((s) => ({ pages: { ...s.pages, [pageId]: { mode: next.mode, ids: [...new Set(next.ids)] } } }))
}

/* ------------------------------------------------------------------ */
/* Live editors per page (registered by the extension)                 */
/* ------------------------------------------------------------------ */

const editors = new Map<ID, Set<Editor>>()

export function registerEditor(pageId: ID, editor: Editor) {
  let set = editors.get(pageId)
  if (!set) editors.set(pageId, (set = new Set()))
  set.add(editor)
}

export function unregisterEditor(pageId: ID, editor: Editor) {
  editors.get(pageId)?.delete(editor)
  const picker = contextStore.getState().picker
  // the page was left (or re-rendered) while picking: cancelled, the marks before stay
  if (picker?.editor === editor) endPicker(false)
}

/** The live editor of a page — the main column's first, then a pane or the peek. */
export function liveEditorOf(pageId: ID): Editor | null {
  const list = [...(editors.get(pageId) ?? [])].filter((e) => !e.isDestroyed && e.view.dom.isConnected)
  const main = list.find((e) => e.view.dom.closest('.pv')?.getAttribute('data-variant') === 'main')
  return main ?? list[0] ?? null
}

export function pageIdOfEditor(editor: Editor): ID | null {
  if (editor.isDestroyed) return null
  return editor.view.dom.getAttribute('data-page-id')
}

let revQueued = false
/** A registered editor's doc changed: readouts recount (at most once a frame). */
export function bumpRev() {
  if (revQueued) return
  revQueued = true
  requestAnimationFrame(() => {
    revQueued = false
    contextStore.setState((s) => ({ rev: s.rev + 1 }))
  })
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

export function startPicker(pageId: ID, editor: Editor, onEnd?: (done: boolean) => void): boolean {
  if (editor.isDestroyed) return false
  const cur = contextStore.getState().picker
  if (cur) endPicker(false)
  const saved = pageContext(pageId)
  contextStore.setState({ picker: { pageId, editor, saved: { mode: saved.mode, ids: [...saved.ids] }, onEnd } })
  return true
}

/**
 * Close the picker. Done: the marks hold — none marked means "nothing from this page", else
 * "only the marked blocks". Cancelled: the marks (and the mode) from before come back.
 */
export function endPicker(done: boolean, liveIds?: string[]) {
  const picker = contextStore.getState().picker
  if (!picker) return
  const cur = pageContext(picker.pageId)
  if (done) {
    const ids = liveIds ?? cur.ids
    putPageContext(picker.pageId, { mode: ids.length ? 'marked' : 'none', ids })
  } else putPageContext(picker.pageId, picker.saved)
  contextStore.setState({ picker: null })
  picker.onEnd?.(done)
}
