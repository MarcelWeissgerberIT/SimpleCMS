/**
 * The file form of Markdown — `docToMarkdown` with date and person mentions as `one:` links, so whoever reads the
 * text (a Markdown file One reads back, Claude) can write them back and they come back as mentions:
 *
 *   [@Oct 17](one:date/2026-10-17?r=-1d)       date mention (id = stored date, r = reminder code)
 *   [@Alex](one:person/<personId>)              person mention
 *
 * Task blocks' field lines write these links already (workitem/markdown.ts). Used by the Markdown export and the
 * folder / GitHub sync (features/io/import/mentions.ts `toFileMarkdown`, with their own serializer) and by the AI
 * reads whose text Claude writes back (read_page, edit_page refs, get_page, the AI menu's reads). Everything else —
 * coding trust hashes, Outbox seals, the clipboard — keeps `docToMarkdown` (its "@label" text).
 */
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown } from '../convert'
import { readReminder } from '../workitem/attrs'

/** The serializer only keeps web links: mention links travel under this host and become `one:` after (`unhost`). */
const HOST = 'https://one.invalid/'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The doc with date / person mentions as "@label" text linked to their `one:` target under HOST (same object when there are none). */
export function linkMentions(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    const a = n.attrs ?? {}
    if (n.type === 'mention' && (a.kind === 'date' || a.kind === 'person') && str(a.id)) {
      const id = encodeURIComponent(str(a.id)).replace(/%3A/gi, ':')
      const code = a.kind === 'date' ? readReminder(a.reminder) : null
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

/** Serialized `linkMentions` output → the `one:` links. */
export const unhost = (md: string): string => md.split(`](${HOST}`).join('](one:')

/** `docToMarkdown` with date and person mentions as `one:` links. */
export function docToFileMarkdown(doc: JSONContent | null): string {
  if (!doc) return docToMarkdown(doc)
  const linked = linkMentions(doc)
  const md = docToMarkdown(linked)
  return linked === doc ? md : unhost(md)
}
