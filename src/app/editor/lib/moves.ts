/**
 * Block menu "Move to": the block is appended to another page and removed here. The move is
 * one undoable action — undo in this editor takes the block back out of the target page,
 * redo moves it there again — so an undo never leaves a copy behind.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { useWorkspace } from '../../store/store'

const ORIGIN = 'editor-move'

interface Move {
  id: string
  json: JSONContent
  target: string
  /** Whether the block currently lives in the source editor. */
  here: boolean
}

const moves = new WeakMap<Editor, Move[]>()

function appendTo(pageId: string, json: JSONContent) {
  const ws = useWorkspace.getState()
  const page = ws.pages[pageId]
  if (!page) return
  const existing = page.content?.content ?? []
  const last = existing[existing.length - 1]
  const trimmed = last && last.type === 'paragraph' && !last.content?.length ? existing.slice(0, -1) : existing
  ws.setContent(pageId, { type: 'doc', content: [...trimmed, json] }, ORIGIN)
}

function removeFrom(pageId: string, id: string) {
  const ws = useWorkspace.getState()
  const doc = ws.pages[pageId]?.content
  if (!doc?.content) return
  let removed = false
  const walk = (list: JSONContent[]): JSONContent[] =>
    list
      .filter((n) => {
        if (!removed && n.attrs?.id === id) {
          removed = true
          return false
        }
        return true
      })
      .map((n) => (n.content && !removed ? { ...n, content: walk(n.content) } : n))
  const next = walk(doc.content)
  if (!removed) return
  ws.setContent(pageId, { type: 'doc', content: next.length ? next : [{ type: 'paragraph' }] }, ORIGIN)
}

function hasBlock(doc: PMNode, id: string): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.attrs.id === id) found = true
    return !found && !node.isTextblock
  })
  return found
}

/** Append `json` to the target page and keep both pages in step with undo / redo here. */
export function trackMove(editor: Editor, json: JSONContent, targetId: string) {
  appendTo(targetId, json)
  const id = json.attrs?.id as string | undefined
  if (!id) return
  let list = moves.get(editor)
  if (!list) {
    const own: Move[] = []
    list = own
    moves.set(editor, own)
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || !transaction.getMeta('history$')) return
      for (const m of own) {
        const present = hasBlock(editor.state.doc, m.id)
        if (present === m.here) continue
        m.here = present
        if (present) removeFrom(m.target, m.id)
        else appendTo(m.target, m.json)
      }
    }
    editor.on('transaction', onTransaction)
    editor.on('destroy', () => editor.off('transaction', onTransaction))
  }
  list.push({ id, json, target: targetId, here: false })
}
