/**
 * Where a Space typed on an empty line opened the AI menu (behaviors.ts → bridge `ai.typed`), followed through every
 * transaction since — appended ones too (ProseMirror mapping, assoc -1: text typed right there goes after it). `at` is
 * null once that place is gone (deleted across). The menu's code can take a few hundred ms the first time; this is how
 * the menu knows, as it shows, whether the line the Space was typed on is still where the caret is, and where the
 * Space belongs when letters followed it (features/ai/AIMenu `typedNow`).
 *
 * Followed while `live()` says so (the bridge still holds it): the listener goes with the first transaction after that.
 */
import type { Editor, EditorEvents } from '@tiptap/core'

export interface TypedAt {
  /** the Space's place now (null: gone) */
  readonly at: number | null
}

export function followTyped(editor: Editor, pos: number, live: (t: TypedAt) => boolean): TypedAt {
  const t: { at: number | null } = { at: pos }
  const onTr = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
    if (!live(t)) {
      editor.off('transaction', onTr)
      return
    }
    for (const tr of [transaction, ...appendedTransactions]) {
      if (t.at === null || !tr.docChanged) continue
      const r = tr.mapping.mapResult(t.at, -1)
      t.at = r.deletedAcross ? null : r.pos
    }
  }
  editor.on('transaction', onTr)
  return t
}
