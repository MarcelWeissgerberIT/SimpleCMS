/**
 * Date and person mentions in Markdown files One reads back (Markdown export, folder / GitHub sync):
 * written as links with a `one:` scheme — the link text is the label, so the file stays readable
 * (GitHub shows "@Oct 17"), and the importer / pick-up turn them back into mentions:
 *
 *   [@Oct 17](one:date/2026-10-17?r=-1d)       date mention (id = stored date, r = reminder code)
 *   [@Alex](one:person/<personId>)              person mention
 *   [Draft copy](one:item/wi_1b2c3d4e5f)        a linked task (task blocks' field line, editor/workitem/markdown.ts):
 *                                               no node of its own — its text stays, the link goes
 *
 * Page mentions keep their relative link (`[@Title](Page.md)`), they come back by title.
 * Share links and published sites never use this (they render mentions as text / links).
 * Writing: editor/lib/fileMarkdown.ts (`docToFileMarkdown`, `linkMentions` + `unhost`). Claude's answers come back
 * through `mentionsFromLinks` (features/ai/claudeDoc.ts), the importer / pick-up through `mentionFromLink`.
 */
import type { JSONContent } from '@tiptap/core'
import { linkMentions, readDue, readReminder, unhost } from '../../../editor'

const ONE = /^one:(date|person|item)\/([^?#\s]+)(?:\?r=([^&#\s]*))?$/
const ITEM = /^wi_[A-Za-z0-9_-]{10}$/
/** Person ids: local ids and account ids (editor/workitem/attrs.ts PERSON_ID) — never whitespace or markup. */
const PERSON = /^[A-Za-z0-9_.:@-]{1,64}$/

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/**
 * `docToMarkdown` for files One reads back: date and person mentions as `one:` links (editor/lib/fileMarkdown.ts —
 * the serializer is the caller's: the export's runs inside withItemLabels).
 */
export function toFileMarkdown(docToMarkdown: (doc: JSONContent | null) => string, doc: JSONContent | null): string {
  if (!doc) return docToMarkdown(doc)
  const linked = linkMentions(doc)
  const md = docToMarkdown(linked)
  return linked === doc ? md : unhost(md)
}

/** Is this href one of the mention links above? */
export const isMentionHref = (href: string) => href.trim().startsWith('one:')

/**
 * A `one:` mention link (its text, its href) → the mention node, or null for anything else (an invalid date, a
 * malformed address). A task link (`one:item/<itemId>`, outside a task block's field line) has no node: its text,
 * without the link. A reminder code that is no valid code is left out.
 */
export function mentionFromLink(text: string, href: string): JSONContent | null {
  const m = ONE.exec(href.trim())
  if (!m) return null
  const id = decode(m[2])
  if (!id) return null
  const label = text.replace(/^@/, '').trim()
  if (m[1] === 'item') return ITEM.test(id) ? { type: 'text', text: text.trim() || id } : null
  if (m[1] === 'person') return { type: 'mention', attrs: { id, label, kind: 'person' } }
  const due = readDue(id)
  if (!due) return null
  const code = m[3] ? readReminder(decode(m[3])) : null
  return { type: 'mention', attrs: { id: due, label: label || due, kind: 'date', ...(code ? { reminder: code } : {}) } }
}

/* ------------------------------------------------------------------ */
/* Claude's `one:` links (features/ai/claudeDoc.ts)                    */
/* ------------------------------------------------------------------ */

/**
 * What a write of Claude's may turn into mentions — given only on paths with a settle context (features/workitems/
 * settle.ts); without rules no person mention is made (a ping nobody reviewed) and no date reminder kept.
 */
export interface MentionRules {
  /** the name of an EXISTING person with this id (the mention's label — never Claude's text), else null */
  person(id: string): string | null
  /** the replaced content held a date mention of this date WITH this reminder code (only then the code stays) */
  knownDate(iso: string, code: string): boolean
  /**
   * the replaced content held a mention of this person in this very block (`block`: the nearest block id around the
   * mention — the inbox's key, features/inbox/scan.ts; null: no block id around it, as in Markdown just written) — not
   * counted as added. One known mention covers one new one.
   */
  knownPerson?(id: string, block: string | null): boolean
}

const hrefOf = (n: JSONContent): string | null => {
  if (n.type !== 'text') return null
  const href = n.marks?.find((m) => m.type === 'link')?.attrs?.href
  return typeof href === 'string' && href.trim().startsWith('one:') ? href.trim() : null
}

const withoutLink = (marks: JSONContent['marks']) => {
  const rest = (marks ?? []).filter((m) => m.type !== 'link')
  return rest.length ? { marks: rest } : {}
}

/**
 * Claude's `one:` links → mentions, by the rules of a settle context (`rules` null: no context):
 *  - `one:person/<id>` → a person mention only with rules and an existing person (label = the person's name);
 *    otherwise "@label" text (D2: no ping from text nobody reviewed);
 *  - `one:date/<iso>?r=<code>` → a date mention for a real date (label = the link text without "@", else the date);
 *    its reminder only when `rules.knownDate(iso, code)` — else dropped (`datesDropped`); an invalid date stays text;
 *  - `one:item/<id>` and any other `one:` address → the text without the link.
 * Iterative; consecutive text runs of one link are one mention; the same object back when nothing changed.
 */
export function mentionsFromLinks(doc: JSONContent, rules: MentionRules | null): { doc: JSONContent; mentionsAdded: number; datesDropped: number } {
  let mentionsAdded = 0
  let datesDropped = 0
  const convert = (text: string, href: string, marks: JSONContent['marks'], block: string | null): JSONContent | null => {
    const rest = withoutLink(marks)
    const m = ONE.exec(href)
    const id = m ? decode(m[2]) : null
    const label = text.replace(/^@/, '').trim()
    if (m && id && m[1] === 'person') {
      const name = rules && PERSON.test(id) ? rules.person(id) : null
      if (name) {
        if (!rules?.knownPerson?.(id, block)) mentionsAdded++
        return { type: 'mention', attrs: { id, label: name, kind: 'person' }, ...rest }
      }
      const at = `@${label || id}`
      return { type: 'text', text: at, ...rest }
    }
    if (m && id && m[1] === 'date') {
      const due = readDue(id)
      if (due) {
        const raw = m[3] ? decode(m[3]) : null
        const code = raw ? readReminder(raw) : null
        const keep = !!code && !!rules?.knownDate(due, code)
        if (m[3] && !keep) datesDropped++
        return { type: 'mention', attrs: { id: due, label: label || due, kind: 'date', ...(keep ? { reminder: code } : {}) }, ...rest }
      }
    }
    // a task link, an invalid date, any other `one:` address: the text, without the link
    return text ? { type: 'text', text, ...rest } : null
  }
  /** an inline list with its `one:` runs converted (the same array when there are none); `block`: the nearest block id */
  const inline = (kids: JSONContent[], block: string | null): JSONContent[] => {
    if (!kids.some((k) => hrefOf(k))) return kids
    const out: JSONContent[] = []
    for (let i = 0; i < kids.length; i++) {
      const href = hrefOf(kids[i])
      if (!href) {
        out.push(kids[i])
        continue
      }
      let text = kids[i].text ?? ''
      while (i + 1 < kids.length && hrefOf(kids[i + 1]) === href) text += kids[++i].text ?? ''
      const made = convert(text, href, kids[i].marks, block)
      if (made) out.push(made)
    }
    return out
  }
  // iterative rebuild: a frame per node with content; a parent is rebuilt only when a child changed
  type Frame = { n: JSONContent; kids: JSONContent[]; out: JSONContent[]; i: number; changed: boolean; block: string | null }
  const frame = (n: JSONContent, outer: string | null): Frame => {
    const block = typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : outer
    const kids = n.content ?? []
    const conv = inline(kids, block)
    return { n, kids: conv, out: [], i: 0, changed: conv !== kids, block }
  }
  const stack: Frame[] = [frame(doc, null)]
  let result = doc
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.i < f.kids.length) {
      const c = f.kids[f.i++]
      if (c.content?.length) stack.push(frame(c, f.block))
      else f.out.push(c)
      continue
    }
    stack.pop()
    const built = f.changed ? { ...f.n, content: f.out } : f.n
    const parent = stack[stack.length - 1]
    if (!parent) result = built
    else {
      if (built !== f.n) parent.changed = true
      parent.out.push(built)
    }
  }
  return { doc: result, mentionsAdded, datesDropped }
}
