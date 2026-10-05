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

/**
 * Why blocks are picked: 'read' — what Claude may read of the page (the context marks; Done sets them)
 * · 'redo' — passages to redo with instructions (the caller gets them; the context marks stay).
 */
export type PickPurpose = 'read' | 'redo'

export interface PickerSession {
  pageId: ID
  editor: Editor
  purpose: PickPurpose
  /** the block ids marked in this session (committed on Done only) */
  ids: string[]
  /** called once when the picker closes: done (false = cancelled) and the marked ids that exist */
  onEnd?: (done: boolean, ids: string[]) => void
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

export function startPicker(pageId: ID, editor: Editor, opts: { purpose?: PickPurpose; ids?: string[]; onEnd?: (done: boolean, ids: string[]) => void } = {}): boolean {
  if (editor.isDestroyed) return false
  if (contextStore.getState().picker) endPicker(false)
  const purpose = opts.purpose ?? 'read'
  const ids = opts.ids ?? (purpose === 'read' ? pageContext(pageId).ids : [])
  contextStore.setState({ picker: { pageId, editor, purpose, ids: [...new Set(ids)], onEnd: opts.onEnd } })
  return true
}

/** The marks of the open picker change (nothing is committed before Done). */
export function setPickerIds(ids: string[]) {
  const picker = contextStore.getState().picker
  if (picker) contextStore.setState({ picker: { ...picker, ids: [...new Set(ids)] } })
}

/**
 * Close the picker. Done ('read'): none marked means "nothing from this page", else "only the marked
 * blocks". Cancelled: nothing changes. `liveIds`: the marked blocks that still exist.
 */
export function endPicker(done: boolean, liveIds?: string[]) {
  const picker = contextStore.getState().picker
  if (!picker) return
  const ids = liveIds ?? picker.ids
  if (done && picker.purpose === 'read') putPageContext(picker.pageId, { mode: ids.length ? 'marked' : 'none', ids })
  contextStore.setState({ picker: null })
  picker.onEnd?.(done, done ? ids : [])
}
