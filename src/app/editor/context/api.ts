/**
 * Context marks — the calls other areas use (re-exported by editor/index.ts). A target is a live
 * editor or a page id (then the page's open editor: the main column first).
 */
import type { Editor } from '@tiptap/core'
import type { ID } from '../../store/types'
import { contextStore, endPicker, liveEditorOf, pageContext, pageIdOfEditor, putPageContext, startPicker, type ContextMode } from './store'

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
 * Open the picker on the page (false: the page has no live editor). `onEnd` runs once when it
 * closes: true = Done (the marks hold), false = cancelled (the marks from before come back).
 */
export function openContextPicker(target: Target, opts: { onEnd?: (done: boolean) => void } = {}): boolean {
  const { pageId, editor } = resolve(target)
  if (!pageId || !editor) return false
  return startPicker(pageId, editor, opts.onEnd)
}

/** Close an open picker (Done or cancel). */
export function closeContextPicker(done: boolean): void {
  endPicker(done)
}

/** The page whose picker is open in this tab (null: none). */
export function contextPickingPage(): ID | null {
  return contextStore.getState().picker?.pageId ?? null
}
