/**
 * Date and person mentions in Markdown files One reads back (Markdown export, folder / GitHub sync):
 * written as links with a `one:` scheme — the link text is the label, so the file stays readable
 * (GitHub shows "@Oct 17"), and the importer / pick-up turn them back into mentions:
 *
 *   [@Oct 17](one:date/2026-10-17?r=-1d)       date mention (id = stored date, r = reminder code)
 *   [@Alex](one:person/<personId>)              person mention
 *
 * Page mentions keep their relative link (`[@Title](Page.md)`), they come back by title.
 * Share links and published sites never use this (they render mentions as text / links).
 */
import type { JSONContent } from '@tiptap/core'
import { normalizeReminder } from '../../inbox/reminders'

/** The serializer only keeps web links: mention links travel under this host and become `one:` after. */
const HOST = 'https://one.invalid/'
const ONE = /^one:(date|person)\/([^?#\s]+)(?:\?r=([^&#\s]*))?$/
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/** The doc with date / person mentions as "@label" text linked to their `one:` target (same object when there are none). */
function linkMentions(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    const a = n.attrs ?? {}
    if (n.type === 'mention' && (a.kind === 'date' || a.kind === 'person') && str(a.id)) {
      const id = encodeURIComponent(str(a.id)).replace(/%3A/gi, ':')
      const code = a.kind === 'date' ? normalizeReminder(a.reminder) : null
      const href = `${HOST}${a.kind}/${id}${code ? `?r=${encodeURIComponent(code)}` : ''}`
      const marks = (n.marks ?? []).filter((m) => m.type !== 'link')
      return { type: 'text', text: `@${str(a.label) || str(a.id)}`, marks: [...marks, { type: 'link', attrs: { href } }] }
    }
    if (!n.content) return n
    const kids = n.content.map(walk)
    return kids.some((k, i) => k !== n.content![i]) ? { ...n, content: kids } : n
  }
  return walk(doc)
}

/** `docToMarkdown` for files One reads back: date and person mentions as `one:` links. */
export function toFileMarkdown(docToMarkdown: (doc: JSONContent | null) => string, doc: JSONContent | null): string {
  if (!doc) return docToMarkdown(doc)
  const linked = linkMentions(doc)
  const md = docToMarkdown(linked)
  return linked === doc ? md : md.split(`](${HOST}`).join('](one:')
}

/** Is this href one of the mention links above? */
export const isMentionHref = (href: string) => href.trim().startsWith('one:')

/** A `one:` mention link (its text, its href) → the mention node, or null for anything else. */
export function mentionFromLink(text: string, href: string): JSONContent | null {
  const m = ONE.exec(href.trim())
  if (!m) return null
  const id = decode(m[2])
  if (!id) return null
  const label = text.replace(/^@/, '').trim()
  if (m[1] === 'person') return { type: 'mention', attrs: { id, label, kind: 'person' } }
  if (!DATE.test(id)) return null
  const code = m[3] ? normalizeReminder(decode(m[3])) : null
  return { type: 'mention', attrs: { id, label: label || id, kind: 'date', ...(code ? { reminder: code } : {}) } }
}
