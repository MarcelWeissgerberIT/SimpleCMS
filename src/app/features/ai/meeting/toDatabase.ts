/**
 * "Send action items to a database": one row per to-do in the notes that is not linked yet —
 * title = the item's text, the first person property ← the owner (matched by name), the first
 * date property ← the due date. Each item's text then becomes a page mention of its row (one
 * undo step), and the row links back to the meeting page.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { findMeeting } from '../../../editor'
import { useWorkspace } from '../../../store/store'
import type { ID, PropertyValue } from '../../../store/types'
import { t } from '../../../i18n'
import { actionItemsIn, matchPerson, type ActionRef } from './notes'

/** Items that would become rows (to-dos with text and no row link yet). */
export function pendingActionItems(editor: Editor, blockId: string): ActionRef[] {
  const hit = findMeeting(editor.state.doc, blockId)
  return hit ? actionItemsIn(hit.node).filter((a) => a.text && !a.linked) : []
}

/**
 * What the open items carry that database `dbId` has no property for: how many name an owner
 * (a workspace person; the database has no person property) / have a due date (no date property).
 */
export function missingFields(editor: Editor, blockId: string, dbId: ID): { owner: number; due: number } {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return { owner: 0, due: 0 }
  const items = pendingActionItems(editor, blockId)
  return {
    owner: db.properties.some((p) => p.type === 'person') ? 0 : items.filter((a) => !!ownerId(a)).length,
    due: db.properties.some((p) => p.type === 'date') ? 0 : items.filter((a) => !!a.due).length,
  }
}

function ownerId(item: ActionRef): ID | null {
  const people = useWorkspace.getState().people
  if (item.ownerId && people.some((p) => p.id === item.ownerId)) return item.ownerId
  return matchPerson(item.ownerName, people)?.id ?? null
}

/** Create the rows and link them in the notes. Returns the number of rows created. */
export function sendActionItems(editor: Editor, blockId: string, pageId: string | null, dbId: ID): number {
  const ws = useWorkspace.getState()
  const db = ws.databases[dbId]
  const hit = findMeeting(editor.state.doc, blockId)
  if (!db || !hit) return 0
  const items = actionItemsIn(hit.node).filter((a) => a.text && !a.linked)
  if (!items.length) return 0
  const personProp = db.properties.find((p) => p.type === 'person')
  const dateProp = db.properties.find((p) => p.type === 'date')
  const backlink: JSONContent | null = pageId
    ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t('features.meeting.db.fromMeeting')} ` }, { type: 'mention', attrs: { id: pageId, label: ws.pages[pageId]?.title ?? '', kind: 'page' } }] }] }
    : null

  const rows = items.map((item) => {
    const properties: Record<ID, PropertyValue> = {}
    const owner = personProp ? ownerId(item) : null
    if (personProp && owner) properties[personProp.id] = [owner]
    if (dateProp && item.due) properties[dateProp.id] = { start: item.due }
    const id = ws.createRow(dbId, { title: item.text, properties, content: backlink })
    return { item, id }
  })

  // the item's words → a mention of its row; owner / date mentions stay (last item first: positions hold)
  const { schema } = editor
  const tr = editor.state.tr
  const base = hit.pos + 1
  for (const { item, id } of [...rows].reverse()) {
    const at = base + item.paraOffset
    const para = tr.doc.nodeAt(at)
    if (!para || !para.isTextblock) continue
    const keep: PMNode[] = []
    para.forEach((child) => {
      if (child.type.name === 'mention' && child.attrs.kind !== 'page') keep.push(child)
    })
    const inline: PMNode[] = [schema.nodes.mention.create({ id, label: item.text, kind: 'page' })]
    for (const k of keep) inline.push(schema.text(' '), k)
    tr.replaceWith(at + 1, at + 1 + para.content.size, inline)
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  return rows.length
}
