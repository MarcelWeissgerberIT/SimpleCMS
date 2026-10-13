/**
 * Where a Space typed on an empty line opened the AI menu (behaviors.ts → bridge `ai.typed`), followed through every
 * transaction since — appended ones too (ProseMirror mapping, assoc -1: text typed right there goes after it). `at` is
 * null once that place is gone (deleted across). The menu's code can take a few hundred ms the first time; this is how
 * the menu knows, as it shows, whether the line the Space was typed on is still where the caret is, and where the
 * Space belongs when letters followed it (features/ai/AIMenu `typedNow`).
 *
 * y-tiptap puts every change from Yjs (a collaborator's, Y undo / redo) in as one replace of the whole document, which
 * deletes across every place: after such a change the Space's line is found again by its block id, at the same offset
 * (null only when that line is really gone).
 *
 * Followed while `live()` says so (the bridge still holds it): the listener goes with the first transaction after that.
 */
import type { Editor, EditorEvents } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

export interface TypedAt {
  /** the Space's place now (null: gone) */
  readonly at: number | null
}

/** Blocks whose own paragraphs open the AI menu (never a list item, a quote, a task, a table cell …). */
const AI_PARENTS = new Set(['doc', 'column', 'callout', 'detailsContent', 'tab', 'syncedBlock', 'meetingNotes'])

/**
 * A line where a Space typed on it, empty, opens the AI menu: a paragraph right in the page, a column, a callout, a
 * toggle's body, a tab, a synced block or meeting notes. The Space shortcut asks it, and the menu again as it shows
 * ("- ", "> " or "[!] " typed since may have made the line a list item, a quote or a task).
 */
export function spaceOpensAI($pos: ResolvedPos): boolean {
  return $pos.parent.type.name === 'paragraph' && AI_PARENTS.has($pos.node(Math.max(0, $pos.depth - 1)).type.name)
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
      t.at = !r.deletedAcross ? r.pos : tr.getMeta(ySyncPluginKey) ? sameLine(tr.before, tr.doc, t.at) : null
    }
  }
  editor.on('transaction', onTr)
  return t
}

/** `at` (in `before`) in `after`: its line by block id, the same offset in it — null when that line is gone. */
function sameLine(before: PMNode, after: PMNode, at: number): number | null {
  const $at = before.resolve(at)
  const line = $at.parent
  const id = line.attrs.id
  if (!line.isTextblock || typeof id !== 'string' || !id) return null
  let found: number | null = null
  after.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type === line.type && node.attrs.id === id) {
      found = pos + 1 + Math.min($at.parentOffset, node.content.size)
      return false
    }
    return !node.isTextblock
  })
  return found
}
