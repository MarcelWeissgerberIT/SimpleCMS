/**
 * Writes applied through an open editor, under their writer (store/writer.ts). An AI result, a meeting summary or a
 * split reaches the store as the editor's flush — 300 ms later locally, 900 ms in a team — mixed with whatever the
 * person typed meanwhile. `editAs` makes that write exact: the person's pending typing goes in first under the
 * editor's own frame, then the writer's transactions, then the store write happens at once inside the writer's frame.
 *
 * Each mounted page editor registers its flush (PageEditor: a sync `setContent`; a team editor: the content
 * document's refresh, cloud `flushPageContent`). In DEV / ?e2e the editor notes transactions that changed its
 * document outside a user event and outside `editAs` (the net, PageEditor) — a flush carrying one is reported.
 */
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { withWriter, type Writer } from '../../store/writer'

/** A mounted editor's flush: no writer = the editor's own frame. */
export type EditorFlush = (writer?: Writer) => void

const flushers = new WeakMap<Editor, EditorFlush>()
let depth = 0

/** PageEditor: this editor's flush (returns the unregister). */
export function registerEditorFlush(editor: Editor, flush: EditorFlush): () => void {
  flushers.set(editor, flush)
  return () => {
    if (flushers.get(editor) === flush) flushers.delete(editor)
  }
}

/**
 * The editor's pending content into the store now, as its own write (the person typing; a team editor: the content
 * document's refresh). For a reader of the store that must see what the editor just did — the unblock toast reads the
 * task index, built from the store. Nothing pending, or no page editor: nothing.
 */
export function flushEditor(editor: Editor): void {
  if (!editor.isDestroyed) flushers.get(editor)?.()
}

/** A writer's transactions are being applied through `editAs` right now (the editor net skips them). */
export const inEditAs = (): boolean => depth > 0

/**
 * Meta of One's own normalising transactions (block ids, structure repairs): they change the document without
 * anyone writing — the editor net skips them.
 */
export const NORMALISE_META = 'one:normalise'

/**
 * Meta of a transaction from the person's own controls inside the document (a node view's UI: the spreadsheet grid)
 * that may land after their event — a clipboard read, a file the person picked. The flush that carries it is the
 * person's (the editor's own frame); the editor net skips it.
 */
export const PERSON_META = 'one:person'

/**
 * Run `fn` (transactions on the editor: `view.dispatch` or `chain()…run()`, plus any store calls that go with
 * them — an Undo's put-back) as `writer`'s write: the person's pending typing is flushed first (their frame),
 * then `fn` inside `writer`'s frame, then the editor's store write at once inside it too. Synchronous only —
 * open one per burst after each await.
 */
export function editAs(editor: Editor, writer: Writer, fn: () => void): void {
  const flush = editor.isDestroyed ? undefined : flushers.get(editor)
  flush?.()
  depth++
  try {
    withWriter(writer, fn)
  } finally {
    depth--
  }
  flush?.(writer)
}

/** One transaction as `writer`'s write (see editAs). */
export const dispatchAs = (editor: Editor, writer: Writer, tr: Transaction): void => editAs(editor, writer, () => editor.view.dispatch(tr))
