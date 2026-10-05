/**
 * Per-editor hooks between the BlockSelection plugin (keys, taps) and the React overlay that draws
 * the pinned grip: the overlay registers how to open the block menu for the selection; a long-press
 * on phones switches on "tap mode" (taps on other blocks extend the selection).
 */
import type { EditorView } from '@tiptap/pm/view'

const openers = new WeakMap<EditorView, () => void>()
const tapModes = new WeakSet<EditorView>()

export function registerBlockMenuOpener(view: EditorView, open: () => void): () => void {
  openers.set(view, open)
  return () => {
    if (openers.get(view) === open) openers.delete(view)
  }
}

/** Open the block menu for the selected blocks (Alt+Enter); false when no overlay is there. */
export function openBlockMenu(view: EditorView): boolean {
  const open = openers.get(view)
  if (!open) return false
  open()
  return true
}

export function setTapMode(view: EditorView, on: boolean): void {
  if (on) tapModes.add(view)
  else tapModes.delete(view)
}

export const inTapMode = (view: EditorView): boolean => tapModes.has(view)
