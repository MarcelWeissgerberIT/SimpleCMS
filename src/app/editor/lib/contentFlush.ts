/**
 * An editable editor's pending content into the store now. PageEditor saves on a pause (SAVE_DELAY); a reader of
 * the store that must see what the editor just did registers nothing — it calls `flushContentOf(editor)`. The
 * unblock toast is one: it reads the workspace task index (built from the store), so a link made a moment before
 * the blocker is finished must be in the store first.
 */
import type { Editor } from '@tiptap/core'

const flushers = new WeakMap<Editor, () => void>()

/** PageEditor: its save, for this editor. Returns the unregister. */
export function registerContentFlush(editor: Editor, flush: () => void): () => void {
  flushers.set(editor, flush)
  return () => {
    if (flushers.get(editor) === flush) flushers.delete(editor)
  }
}

/** Write the editor's unsaved content now (nothing pending, or no page editor: nothing). */
export function flushContentOf(editor: Editor): void {
  flushers.get(editor)?.()
}
