/**
 * Context marks — the calls other areas use (re-exported by editor/index.ts). A target is a live
 * editor or a page id (then the page's open editor: the main column first).
 */
import type { Editor } from '@tiptap/core'
import type { ID } from '../../store/types'
import { blockKey } from './read'
import { contextStore, endPicker, liveEditorOf, pageContext, pageIdOfEditor, putPageContext, startPicker, type ContextMode, type PickPurpose } from './store'

type Target = Editor | ID

function resolve(target: Target): { pageId: ID | null; editor: Editor | null } {
  if (typeof target === 'string') return { pageId: target, editor: liveEditorOf(target) }
  return { pageId: pageIdOfEditor(target), editor: target.isDestroyed ? null : target }
}

/** Whole page / only the marked blocks / nothing. The marks stay when the mode changes. */
export function setContextMode(target: Target, mode: ContextMode): void {
  const { pageId } = resolve(target)
  if (!pageId) return
  const cur = pageContext(pageId)
  if (cur.mode !== mode) putPageContext(pageId, { ...cur, mode })
}

/**
 * Open the picker on the page (false: the page has no live editor). purpose 'read' (default): what
 * Claude may read — Done sets the context marks; 'redo': passages to redo — `ids` pre-marks blocks, the
 * marks go to `onEnd` only. `onEnd` runs once when it closes: done (false = cancelled) and the marked ids.
 */
export function openContextPicker(target: Target, opts: { purpose?: PickPurpose; ids?: string[]; onEnd?: (done: boolean, ids: string[]) => void } = {}): boolean {
  const { pageId, editor } = resolve(target)
  if (!pageId || !editor) return false
  return startPicker(pageId, editor, opts)
}

/** Close an open picker (Done or cancel). */
export function closeContextPicker(done: boolean): void {
  endPicker(done)
}

/** The page whose picker is open in this tab (null: none). */
export function contextPickingPage(): ID | null {
  return contextStore.getState().picker?.pageId ?? null
}

/** Keys of the top-level blocks a range touches (to pre-mark a selection or the cursor block). */
export function topBlockKeys(editor: Editor, from: number, to: number): string[] {
  if (editor.isDestroyed) return []
  const doc = editor.state.doc
  const a = Math.max(0, Math.min(from, doc.content.size))
  const b = Math.max(a, Math.min(to, doc.content.size))
  const hi = b > a ? b : a + 1
  const out: string[] = []
  doc.forEach((node, pos, i) => {
    if (pos < hi && pos + node.nodeSize > a) out.push(blockKey(node, i))
  })
  return out
}
