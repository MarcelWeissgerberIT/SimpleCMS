/**
 * The generated notes as editor blocks, and the action items read back from them.
 *  - Summary / Decisions: a heading + a bulleted list each
 *  - Action items: a to-do list; the owner is a person mention (matched to a workspace person
 *    when possible, else a mention carrying only the name), the due date a date mention
 *  - Sent to a database: the item's text becomes a page mention of its row (the row title)
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { format, isValid, parseISO } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'
import type { Person } from '../../../store/types'
import { t } from '../../../i18n'
import type { MeetingActionItem, MeetingSummary } from './summarize'

const text = (s: string): JSONContent => ({ type: 'text', text: s })
const para = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const heading = (s: string): JSONContent => ({ type: 'heading', attrs: { level: 3 }, content: [text(s)] })
const bullets = (items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((s) => ({ type: 'listItem', content: [para(text(s))] })) })

/** A workspace person by name: exact, then first name / prefix (case-insensitive). */
export function matchPerson(name: string | null | undefined, people: Person[]): Person | null {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return null
  const exact = people.find((p) => p.name.trim().toLowerCase() === n)
  if (exact) return exact
  const first = n.split(/\s+/)[0]
  const hits = people.filter((p) => {
    const pn = p.name.trim().toLowerCase()
    return pn.split(/\s+/)[0] === first || pn.startsWith(n)
  })
  return hits.length === 1 ? hits[0] : null
}

export function dateLabel(iso: string, lang: Lang): string {
  const d = parseISO(iso)
  return isValid(d) ? format(d, lang === 'de' ? 'd. MMMM yyyy' : 'MMMM d, yyyy', { locale: lang === 'de' ? de : enUS }) : iso
}

function actionItem(item: MeetingActionItem, people: Person[], lang: Lang): JSONContent {
  const inline: JSONContent[] = [text(item.text)]
  if (item.owner) {
    const person = matchPerson(item.owner, people)
    inline.push(text(' '), { type: 'mention', attrs: { id: person?.id ?? null, label: person?.name ?? item.owner, kind: 'person' } })
  }
  if (item.due) inline.push(text(' '), { type: 'mention', attrs: { id: item.due, label: dateLabel(item.due, lang), kind: 'date' } })
  return { type: 'taskItem', attrs: { checked: false }, content: [para(...inline)] }
}

/** The notes for a summary (headings in the UI language, the content in the meeting's). */
export function notesBlocks(s: MeetingSummary, people: Person[], lang: Lang): JSONContent[] {
  const out: JSONContent[] = []
  if (s.summary.length) out.push(heading(t('features.meeting.notes.summary')), bullets(s.summary))
  if (s.decisions.length) out.push(heading(t('features.meeting.notes.decisions')), bullets(s.decisions))
  if (s.actionItems.length) out.push(heading(t('features.meeting.notes.actions')), { type: 'taskList', content: s.actionItems.map((a) => actionItem(a, people, lang)) })
  return out.length ? out : [para(text(t('features.meeting.notes.empty')))]
}

/** Is the notes area still empty (one empty paragraph)? */
export function notesBlank(node: PMNode): boolean {
  return node.childCount === 0 || (node.childCount === 1 && !!node.firstChild?.isTextblock && node.firstChild.content.size === 0)
}

/* ------------------------------------------------------------------ */
/* Action items in the doc                                             */
/* ------------------------------------------------------------------ */

export interface ActionRef {
  /** position of the item's paragraph, relative to the start of the meeting node's content */
  paraOffset: number
  text: string
  ownerId: string | null
  ownerName: string | null
  /** ISO date of a date mention */
  due: string | null
  /** row (page) the item already links to */
  linked: string | null
}

/** Every to-do inside the meeting notes, with its owner / date / link mentions. */
export function actionItemsIn(meeting: PMNode): ActionRef[] {
  const out: ActionRef[] = []
  meeting.content.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true
    const p = node.firstChild
    if (!p || !p.isTextblock) return false
    const ref: ActionRef = { paraOffset: pos + 1, text: '', ownerId: null, ownerName: null, due: null, linked: null }
    let words = ''
    p.forEach((child) => {
      if (child.isText) words += child.text ?? ''
      else if (child.type.name === 'mention') {
        const { kind, id, label } = child.attrs as { kind?: string; id?: string | null; label?: string | null }
        if (kind === 'person' && !ref.ownerName) {
          ref.ownerId = id ?? null
          ref.ownerName = label ?? null
        } else if (kind === 'date' && id && !ref.due) ref.due = String(id).slice(0, 10)
        else if (kind === 'page' && id && !ref.linked) ref.linked = id
      }
    })
    ref.text = words.replace(/\s+/g, ' ').trim()
    out.push(ref)
    // nested to-dos are items of their own
    return true
  })
  return out
}
