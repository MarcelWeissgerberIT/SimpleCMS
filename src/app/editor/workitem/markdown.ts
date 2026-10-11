/**
 * Task block (`workItem`) — its ONE Markdown form (export, folder / GitHub sync, AI reads), pure:
 *
 *   > [!TODO] Ship the pricing page {#wi_7f3a9c2d01}
 *   > Status: in progress · Due: [@Fri 17 Oct](one:date/2026-10-17?r=-1d) · Owner: [@Alex](one:person/u_1) · Blocked by: [wi_1b2c3d4e5f](one:item/wi_1b2c3d4e5f) · Related: [wi_9d8e7f6a5b](one:item/wi_9d8e7f6a5b)
 *   >
 *   > notes…
 *
 * - Keys and values are written in English; empty fields and the status "todo" are left out.
 * - Lossless: a hard break in the title stays one (`\` at the line's end, the title goes on in the next
 *   quoted line); the time a task was done rides in its id braces (`{#wi_… done=2026-10-09T08:53:20.000Z}`).
 * - Reading (`workItemFromQuote`) also takes the German keys / values (Status / Fällig / Verantwortlich /
 *   Blockiert durch / Verknüpft; offen / in Arbeit / erledigt). A field line with an unknown key stays body
 *   text, so nothing is lost. The parser works on the parsed quote (TipTap JSON) BEFORE anything drops
 *   `one:` links (convert.ts postProcess) — and is switched off in this release (WORK_ITEMS_FROM_MARKDOWN):
 *   `> [!TODO]` still reads back as a plain quote.
 * - Claude's form (`readClaudeQuote`): the same quote read leniently into a DRAFT — names, emails, "me", plain
 *   dates, `#handle` / title refs, Reminder / Blocks keys, a `{#handle}` after a new task's title — resolved by
 *   the settle gate (features/workitems/settle.ts), never here.
 * - Frozen tasks (documents that left the workspace) carry no ids: their people are plain names.
 */
import type { JSONContent } from '@tiptap/core'
import { ITEM_ID, PERSON_ID, dueHasTime, itemAttrs, readDue, readReminder, storedItemAttrs, WORK_ITEM, type WorkItemAttrs, type WorkItemStatus } from './attrs'

/**
 * The GLOBAL Markdown reader: `> [!TODO]` → a task block in every `markdownToDoc`. OFF (P0, P1 and P2): imports,
 * folder / GitHub sync, Markdown paste, quick capture, One Script, template / record-type text and mail keep reading
 * `> [!TODO]` as a quote. Claude's paths read it explicitly — `readClaudeQuote` below, settled by
 * features/workitems/settle.ts (the one gate: people, dates, ids, links, scope, review). Turning this on needs, per
 * source, its own identity and review rules (the P2 brief § 14) — a per-source table then, never this one constant.
 */
export const WORK_ITEMS_FROM_MARKDOWN: boolean = false

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export interface ItemMarkdownLabels {
  /** a person's name, or null when the id does not resolve (the id is written as the label then) */
  person(id: string): string | null
  /** a linked task's title (the workspace index — later); null = its id */
  item?(itemId: string): string | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 17 Oct" / "Fri 17 Oct 09:00" — the English label of a due date in the field line. */
export function dueLabelEn(due: string): string {
  const y = Number(due.slice(0, 4))
  const m = Number(due.slice(5, 7))
  const d = Number(due.slice(8, 10))
  const day = new Date(y, m - 1, d)
  const base = `${WEEKDAYS[day.getDay()]} ${d} ${MONTHS[m - 1]}`
  return dueHasTime(due) ? `${base} ${due.slice(11, 16)}` : base
}

/** Link text inside [ ]: brackets and backslashes escaped, one line. */
const linkText = (s: string) => s.replace(/\s+/g, ' ').replace(/[\\[\]]/g, (c) => `\\${c}`)

const STATUS_WORD: Record<WorkItemStatus, string> = { todo: 'todo', in_progress: 'in progress', done: 'done' }

/** The field line (without the "> "), '' when nothing is set. */
export function fieldLine(a: WorkItemAttrs, labels: ItemMarkdownLabels): string {
  const parts: string[] = []
  if (a.status !== 'todo') parts.push(`Status: ${STATUS_WORD[a.status]}`)
  if (a.due) {
    const code = a.reminder ? `?r=${encodeURIComponent(a.reminder)}` : ''
    parts.push(`Due: [@${dueLabelEn(a.due)}](one:date/${a.due}${code})`)
  }
  if (a.people.length) parts.push(`Owner: ${a.people.map((id) => `[@${linkText(labels.person(id) ?? id)}](one:person/${encodeURIComponent(id)})`).join(', ')}`)
  else if (a.frozen?.people.length) parts.push(`Owner: ${a.frozen.people.map((n) => linkText(n)).join(', ')}`)
  const items = (ids: string[]) => ids.map((id) => `[${linkText(labels.item?.(id) ?? id)}](one:item/${id})`).join(', ')
  if (a.blockedBy.length) parts.push(`Blocked by: ${items(a.blockedBy)}`)
  if (a.related.length) parts.push(`Related: ${items(a.related)}`)
  return parts.join(' · ')
}

/** Every line of a block of Markdown quoted ("> …", empty lines ">"). */
const quoteLines = (md: string) =>
  md
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')

/**
 * The task as Markdown. `title`: the first paragraph as inline Markdown; `notes`: the other blocks as
 * Markdown (already rendered by the caller's serializer).
 */
export function workItemMarkdown(attrs: WorkItemAttrs, title: string, notes: string, labels: ItemMarkdownLabels): string {
  // a hard break ("  \n" from the serializer) stays one: "\" at the end of the line (CommonMark)
  const line = title
    .trim()
    .replace(/[ \t]*\\?[ \t]*\n[ \t]*/g, (m) => (/\\|  /.test(m) ? '\\\n' : ' '))
  const done = attrs.doneAt ? ` done=${new Date(attrs.doneAt).toISOString()}` : ''
  const head = `[!TODO] ${line}${attrs.itemId ? ` {#${attrs.itemId}${done}}` : ''}`.trimEnd()
  const fields = fieldLine(attrs, labels)
  const body = notes.trim()
  return quoteLines([head, ...(fields ? [fields] : []), ...(body ? ['', body] : [])].join('\n'))
}

/* ------------------------------------------------------------------ */
/* Reading (switched off in P0 — see WORK_ITEMS_FROM_MARKDOWN)         */
/* ------------------------------------------------------------------ */

const MARKER = /^\[!TODO\][ \t]*/i
/** `{#wi_…}` at the end of the title line, with the time it was done (`done=<ISO>`) when it is done. */
const ID_SUFFIX = /\s*\{#(wi_[A-Za-z0-9_-]{10})(?:\s+done=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z))?\}\s*$/

type Key = 'status' | 'due' | 'people' | 'blockedBy' | 'related'

const KEYS: Record<string, Key> = {
  status: 'status',
  due: 'due',
  'fällig': 'due',
  faellig: 'due',
  owner: 'people',
  owners: 'people',
  assignee: 'people',
  assignees: 'people',
  verantwortlich: 'people',
  'blocked by': 'blockedBy',
  'blockiert durch': 'blockedBy',
  related: 'related',
  'verknüpft': 'related',
  verknuepft: 'related',
}

const STATUSES: Record<string, WorkItemStatus> = {
  todo: 'todo',
  open: 'todo',
  offen: 'todo',
  'in progress': 'in_progress',
  in_progress: 'in_progress',
  'in arbeit': 'in_progress',
  done: 'done',
  erledigt: 'done',
}

interface Piece {
  text: string
  href: string | null
}

const hrefOf = (n: JSONContent): string | null => {
  const link = n.marks?.find((m) => m.type === 'link')
  const href = link?.attrs?.href
  return typeof href === 'string' ? href.trim() : null
}

/** Inline content split into lines at soft line breaks ("\n" inside text); hard breaks stay in their line. */
function lines(inline: JSONContent[]): JSONContent[][] {
  const out: JSONContent[][] = [[]]
  for (const n of inline) {
    if (n.type === 'text' && typeof n.text === 'string' && n.text.includes('\n')) {
      n.text.split('\n').forEach((part, i) => {
        if (i > 0) out.push([])
        if (part) out[out.length - 1].push({ ...n, text: part })
      })
      continue
    }
    out[out.length - 1].push(n)
  }
  return out
}

/** "Key: value · Key: value" → segments of pieces (text runs with their link). */
function segments(line: JSONContent[]): Piece[][] {
  const segs: Piece[][] = [[]]
  for (const n of line) {
    if (n.type !== 'text' || typeof n.text !== 'string') {
      segs[segs.length - 1].push({ text: '￼', href: null })
      continue
    }
    const href = hrefOf(n)
    if (href) {
      segs[segs.length - 1].push({ text: n.text, href })
      continue
    }
    n.text.split(/\s+·\s+/).forEach((part, i) => {
      if (i > 0) segs.push([])
      if (part) segs[segs.length - 1].push({ text: part, href: null })
    })
  }
  return segs.filter((s) => s.some((p) => p.text.trim()))
}

const ONE_LINK = /^one:(date|person|item)\/([^?#\s]+)(?:\?r=([^&#\s]*))?$/
const KEY_HEAD = /^\s*([\p{L} ]{2,24}?)\s*:\s*/u

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

interface Fields {
  status?: WorkItemStatus
  due?: string | null
  reminder?: string | null
  people?: string[]
  blockedBy?: string[]
  related?: string[]
}

/** One "Key: value" segment into `fields`; false when it is not a field this form knows. */
function readSegment(seg: Piece[], fields: Fields): boolean {
  const first = seg[0]
  if (!first || first.href) return false
  const m = KEY_HEAD.exec(first.text)
  if (!m) return false
  const key = KEYS[m[1].toLowerCase().replace(/\s+/g, ' ')]
  if (!key || key in fields) return false
  const rest: Piece[] = [{ text: first.text.slice(m[0].length), href: null }, ...seg.slice(1)]
  const plain = rest
    .filter((p) => !p.href)
    .map((p) => p.text)
    .join('')
  const links = rest.filter((p) => p.href).map((p) => ONE_LINK.exec(p.href!) ?? null)
  if (links.some((l) => !l)) return false
  switch (key) {
    case 'status': {
      if (links.length) return false
      const s = STATUSES[plain.trim().toLowerCase().replace(/\s+/g, ' ')]
      if (!s) return false
      fields.status = s
      return true
    }
    case 'due': {
      const link = links[0]
      if (links.length > 1 || (link && link[1] !== 'date')) return false
      const due = readDue(link ? decode(link[2]) : plain.trim())
      if (!due) return false
      fields.due = due
      fields.reminder = link?.[3] ? readReminder(decode(link[3])) : null
      return true
    }
    case 'people': {
      // only `one:person/<id>` links: a bare name resolves later (never invented here)
      if (links.some((l) => l![1] !== 'person') || plain.replace(/[\s,]/g, '')) return false
      fields.people = links.map((l) => decode(l![2]) ?? '').filter((id) => PERSON_ID.test(id))
      return true
    }
    case 'blockedBy':
    case 'related': {
      if (links.some((l) => l![1] !== 'item')) return false
      const bare = plain.split(/[\s,]+/).filter(Boolean)
      if (bare.some((w) => !ITEM_ID.test(w))) return false
      fields[key] = [...links.map((l) => decode(l![2]) ?? ''), ...bare].filter((id) => ITEM_ID.test(id))
      return true
    }
    default:
      return false
  }
}

/** The field line of a quote → its fields, or null when it is not one (it stays body text then). */
export function readFieldLine(line: JSONContent[]): Fields | null {
  const segs = segments(line)
  if (!segs.length) return null
  const fields: Fields = {}
  for (const seg of segs) if (!readSegment(seg, fields)) return null
  return fields
}

/** The visible text of a line (mentions as "@label", atoms as nothing). */
const lineText = (line: JSONContent[]): string =>
  line.map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'mention' ? `@${String(n.attrs?.label ?? n.attrs?.id ?? '')}` : '')).join('')

/**
 * Does this line read as a field line ("Key: … · Key: …", every key one this form knows)? Lenient: the values
 * may be anything — mention nodes, plain names, links of any kind (what a file or Claude wrote back).
 */
function looksLikeFieldLine(line: JSONContent[]): boolean {
  const segs = lineText(line)
    .split(/\s+·\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return (
    segs.length > 0 &&
    segs.every((seg) => {
      const m = KEY_HEAD.exec(seg)
      return !!m && !!KEYS[m[1].toLowerCase().replace(/\s+/g, ' ')]
    })
  )
}

const isBlank = (inline: JSONContent[]) => inline.every((n) => n.type === 'text' && !n.text?.trim())

/** Trim leading / trailing whitespace (and hard breaks) of a line. */
function trimLine(inline: JSONContent[]): JSONContent[] {
  const out = inline.map((n) => ({ ...n }))
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  const first = out[0]
  if (first?.type === 'text') first.text = (first.text ?? '').replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'text') last.text = (last.text ?? '').replace(/\s+$/, '')
  return out.filter((n) => n.type !== 'text' || n.text)
}

interface QuoteParts {
  itemId: string | null
  doneAt: number | null
  title: JSONContent[]
  /** the second line, when it is a field line by `isFields` */
  fieldLine: JSONContent[] | null
  notes: JSONContent[]
}

/** A `> [!TODO] …` quote taken apart: id (+ done time), title line, field line, notes — null for any other quote. */
function splitQuote(quote: JSONContent, isFields: (line: JSONContent[]) => boolean): QuoteParts | null {
  if (quote.type !== 'blockquote') return null
  const firstPara = quote.content?.[0]
  if (firstPara?.type !== 'paragraph') return null
  const inline = firstPara.content ?? []
  const t0 = inline[0]
  if (t0?.type !== 'text' || !MARKER.test(t0.text ?? '') || hrefOf(t0)) return null
  const split = lines([{ ...t0, text: (t0.text ?? '').replace(MARKER, '') }, ...inline.slice(1)])
  // the title line: its id suffix comes off
  let title = trimLine(split[0])
  let itemId: string | null = null
  let doneAt: number | null = null
  const last = title[title.length - 1]
  const idm = last?.type === 'text' && !hrefOf(last) ? ID_SUFFIX.exec(last.text ?? '') : null
  if (idm && last) {
    itemId = idm[1]
    doneAt = idm[2] ? Date.parse(idm[2]) || null : null
    const text = (last.text ?? '').slice(0, idm.index)
    title = trimLine(text ? [...title.slice(0, -1), { ...last, text }] : title.slice(0, -1))
  }
  let rest = split.slice(1)
  let fieldLine: JSONContent[] | null = null
  if (rest.length && isFields(rest[0])) {
    fieldLine = rest[0]
    rest = rest.slice(1)
  }
  const notes: JSONContent[] = []
  const leftover = rest.map(trimLine).filter((l) => !isBlank(l))
  if (leftover.length) {
    const content: JSONContent[] = []
    leftover.forEach((l, i) => {
      if (i > 0) content.push({ type: 'hardBreak' })
      content.push(...l)
    })
    notes.push({ type: 'paragraph', content })
  }
  notes.push(...(quote.content ?? []).slice(1))
  return { itemId, doneAt, title, fieldLine, notes }
}

/* ------------------------------------------------------------------ */
/* Claude's form (lenient, unresolved — features/workitems/settle.ts)  */
/* ------------------------------------------------------------------ */

/** A link to another task as Claude wrote it: a task id, a `#handle` of its writing, or a title. */
export type RefDraft =
  | { id: string }
  | { handle: string }
  /**
   * A title. `whole`: the whole value of a comma-holding field ("Plan, review") — its comma parts follow it as their
   * own title refs; settle takes the whole one when it resolves, else the parts.
   */
  | { title: string; whole?: boolean }

/** A person as Claude wrote it: an id (a `one:person` link), a name, a member's email, or "me". */
export type PersonDraft = { id: string } | { raw: string } | { email: string } | { me: true }

/** One `> [!TODO]` quote of Claude's, read but not resolved: `{ raw }` keeps a value that is no valid one (warnings). */
export interface ClaudeItemDraft {
  itemId: string | null
  doneAt: number | null
  /** `{#copy}` after a new task's title (folded to lower case) */
  handle: string | null
  title: JSONContent[]
  notes: JSONContent[]
  fieldLine: JSONContent[] | null
  /** the 2nd line had a known key next to an unknown one: it stayed body text (L6) */
  fieldKey?: string
  status?: WorkItemStatus | { raw: string }
  due?: string | { raw: string }
  reminder?: string | { raw: string }
  people?: PersonDraft[]
  blockedBy?: RefDraft[]
  related?: RefDraft[]
  blocks?: RefDraft[]
}

type ClaudeKey = Key | 'reminder' | 'blocks'

/** Keys only Claude's form reads (workItemFromQuote never sees them: a file's field line keeps its P0 meaning). */
const CLAUDE_KEYS: Record<string, ClaudeKey> = {
  reminder: 'reminder',
  erinnerung: 'reminder',
  blocks: 'blocks',
  'hält auf': 'blocks',
  'haelt auf': 'blocks',
}

const claudeKey = (word: string): ClaudeKey | null => {
  const k = word.toLowerCase().replace(/\s+/g, ' ')
  return KEYS[k] ?? CLAUDE_KEYS[k] ?? null
}

/** `{#copy}` at the end of the title line: a handle (letters, digits, _ -; never a `wi_` id). */
const HANDLE_SUFFIX = /\s*\{#([A-Za-z][A-Za-z0-9_-]{0,23})\}\s*$/
const HANDLE_REF = /^#([A-Za-z][A-Za-z0-9_-]{0,23})$/
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const ME = new Set(['me', 'ich'])
const HUMAN_DUE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/

const handleOf = (raw: string): string | null => {
  const h = raw.toLowerCase()
  return h.startsWith('wi_') ? null : h
}

/** A segment's key as written (the text before the colon, else its first words), and whether Claude's form knows it. */
function segmentKey(seg: Piece[]): { key: string; known: ClaudeKey | null } {
  const first = seg[0]
  const m = first && !first.href ? KEY_HEAD.exec(first.text) : null
  if (m) return { key: m[1].trim(), known: claudeKey(m[1]) }
  const text = seg.map((x) => x.text).join('').trim()
  return { key: text.slice(0, 24), known: null }
}

/** Split the plain runs of a value at commas; links stay whole entries. */
function entries(rest: Piece[]): Array<{ text: string; href: string | null }> {
  const out: Array<{ text: string; href: string | null }> = []
  let buf = ''
  const flush = () => {
    for (const part of buf.split(',')) if (part.trim()) out.push({ text: part.trim(), href: null })
    buf = ''
  }
  for (const piece of rest) {
    if (piece.href) {
      flush()
      out.push({ text: piece.text.trim(), href: piece.href })
    } else buf += piece.text
  }
  flush()
  return out
}

function readDueText(text: string): string | null {
  const m = HUMAN_DUE.exec(text.trim())
  return m ? readDue(m[2] ? `${m[1]}T${m[2]}` : m[1]) : null
}

function personDraft(e: { text: string; href: string | null }): PersonDraft | null {
  if (e.href) {
    const link = ONE_LINK.exec(e.href)
    if (link?.[1] === 'person') {
      const id = decode(link[2])
      if (id) return { id }
    }
    if (/^mailto:/i.test(e.href)) {
      const mail = e.href.replace(/^mailto:/i, '').trim()
      if (EMAIL.test(mail)) return { email: mail }
    }
  }
  const name = e.text.replace(/^@/, '').trim()
  if (!name) return null
  if (ME.has(name.toLowerCase())) return { me: true }
  if (EMAIL.test(name)) return { email: name }
  return { raw: name }
}

function refDrafts(rest: Piece[]): RefDraft[] {
  const list = entries(rest)
  const out: RefDraft[] = []
  const plain = rest.every((x) => !x.href) ? rest.map((x) => x.text).join('').trim() : ''
  const one = (e: { text: string; href: string | null }): RefDraft | null => {
    if (e.href) {
      const link = ONE_LINK.exec(e.href)
      const id = link?.[1] === 'item' ? decode(link[2]) : null
      if (id && ITEM_ID.test(id)) return { id }
    }
    const text = e.text.trim()
    if (!text) return null
    if (ITEM_ID.test(text)) return { id: text }
    const h = HANDLE_REF.exec(text)
    const handle = h ? handleOf(h[1]) : null
    if (handle) return { handle }
    return { title: text }
  }
  const refs = list.map(one).filter((r): r is RefDraft => !!r)
  // "Plan, review": the whole value first (a title may hold a comma), then its parts
  if (plain && refs.length > 1 && refs.some((r) => 'title' in r)) out.push({ title: plain, whole: true })
  out.push(...refs)
  return out
}

/** One segment of Claude's field line into the draft (a key seen twice: lists merge, the first single value wins). */
function readClaudeSegment(seg: Piece[], key: ClaudeKey, d: ClaudeItemDraft): void {
  const first = seg[0]
  const m = KEY_HEAD.exec(first.text)
  const rest: Piece[] = [{ text: m ? first.text.slice(m[0].length) : first.text, href: null }, ...seg.slice(1)]
  const plain = rest
    .filter((x) => !x.href)
    .map((x) => x.text)
    .join('')
    .trim()
  const links = rest.filter((x) => x.href)
  const raw = rest
    .map((x) => x.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  switch (key) {
    case 'status': {
      if (d.status !== undefined) return
      const s = links.length ? undefined : STATUSES[plain.toLowerCase().replace(/\s+/g, ' ')]
      d.status = s ?? { raw }
      return
    }
    case 'due': {
      if (d.due !== undefined) return
      const link = links.map((x) => ONE_LINK.exec(x.href!)).find((l) => l?.[1] === 'date')
      if (link) {
        const due = readDue(decode(link[2]))
        d.due = due ?? { raw }
        if (due && link[3] && d.reminder === undefined) {
          const code = decode(link[3])
          d.reminder = readReminder(code) ?? { raw: code ?? link[3] }
        }
        return
      }
      d.due = readDueText(plain) ?? { raw }
      return
    }
    case 'reminder': {
      if (d.reminder !== undefined) return
      d.reminder = readReminder(plain.toLowerCase()) ?? { raw }
      return
    }
    case 'people': {
      const found = entries(rest)
        .map(personDraft)
        .filter((x): x is PersonDraft => !!x)
      d.people = [...(d.people ?? []), ...found]
      return
    }
    case 'blockedBy':
    case 'related':
    case 'blocks': {
      d[key] = [...(d[key] ?? []), ...refDrafts(rest)]
      return
    }
  }
}

/**
 * Claude's `> [!TODO] …` quote (TipTap JSON, links still link marks) → a DRAFT, or null for any other node.
 * Lenient: `Owner: Alex, me, sam@example.test` · `Due: 2026-10-17` / `2026-10-17 09:30` / a `one:date` link (its
 * `?r=` = the reminder) · `Reminder: -1d` · `Blocked by / Related / Blocks: #copy, wi_…, an exact title` (EN + DE
 * keys); `{#copy}` after the title declares a handle. Every segment's key must be known or the line stays body
 * text (P0 rule) — a known key next to an unknown one also leaves `fieldKey` (the unknown one) for a warning.
 * Nothing is resolved here (people, links, ids: features/workitems/settle.ts).
 */
export function readClaudeQuote(quote: JSONContent): ClaudeItemDraft | null {
  let fieldKey: string | undefined
  const q = splitQuote(quote, (line) => {
    const segs = segments(line)
    if (!segs.length) return false
    const keys = segs.map(segmentKey)
    if (keys.every((k) => k.known)) return true
    if (keys.some((k) => k.known)) fieldKey = keys.find((k) => !k.known)?.key
    return false
  })
  if (!q) return null
  let title = q.title
  let handle: string | null = null
  if (!q.itemId) {
    const last = title[title.length - 1]
    const hm = last?.type === 'text' && !hrefOf(last) ? HANDLE_SUFFIX.exec(last.text ?? '') : null
    const h = hm ? handleOf(hm[1]) : null
    if (hm && h && last) {
      handle = h
      const text = (last.text ?? '').slice(0, hm.index)
      title = trimLine(text ? [...title.slice(0, -1), { ...last, text }] : title.slice(0, -1))
    }
  }
  const d: ClaudeItemDraft = { itemId: q.itemId, doneAt: q.doneAt, handle, title, notes: q.notes, fieldLine: q.fieldLine }
  if (fieldKey) d.fieldKey = fieldKey
  if (q.fieldLine) {
    for (const seg of segments(q.fieldLine)) {
      const key = segmentKey(seg).known
      if (key) readClaudeSegment(seg, key, d)
    }
  }
  return d
}

/**
 * A parsed `> [!TODO] …` quote (TipTap JSON) → a task block, or null for any other quote. The title line
 * may end with `{#wi_…}` (the task's id); the second line is read as the field line when it is one.
 */
export function workItemFromQuote(quote: JSONContent): JSONContent | null {
  const q = splitQuote(quote, (line) => !!readFieldLine(line))
  if (!q) return null
  const fields = q.fieldLine ? (readFieldLine(q.fieldLine) ?? {}) : {}
  const attrs = itemAttrs({ itemId: q.itemId, doneAt: q.doneAt, ...fields })
  return {
    type: WORK_ITEM,
    attrs: storedItemAttrs({ ...attrs, id: null }),
    content: [{ type: 'paragraph', ...(q.title.length ? { content: q.title } : {}) }, ...q.notes],
  }
}

/* ------------------------------------------------------------------ */
/* Known tasks written back as Markdown (while the reader is off)      */
/* ------------------------------------------------------------------ */

/**
 * Markdown that comes back for a document that HOLDS tasks (a folder / GitHub file picked up, Claude's
 * replace of a page or of blocks it read, a record type's or template's text edited, a script's replace):
 * every `> [!TODO] … {#wi_X}` quote whose X is a task of `known` (the document before — or the blocks being
 * replaced) becomes that task again — with ALL its fields as they are (status, due, people, links: they are
 * changed in One only, the field line written back is not read), its title and notes from the Markdown.
 *
 * Never creates a task: only ids `known` holds, each as often as `known` holds it, and not where `doc` has
 * that task already. `same(a, b)`: two blocks read the same (their Markdown) — then the old block is kept
 * with everything Markdown cannot carry (colours, comments, block ids).
 */
export function keepItems(doc: JSONContent, known: JSONContent | null | undefined, same?: (a: JSONContent, b: JSONContent) => boolean): JSONContent {
  if (!known) return doc
  const pool = new Map<string, JSONContent[]>()
  const collect = (n: JSONContent | undefined, into: (id: string, node: JSONContent) => void) => {
    if (!n || typeof n !== 'object') return
    if (n.type === WORK_ITEM) {
      const id = itemAttrs(n).itemId
      if (id) into(id, n)
    }
    n.content?.forEach((c) => collect(c, into))
  }
  collect(known, (id, node) => pool.set(id, [...(pool.get(id) ?? []), node]))
  if (!pool.size) return doc
  // tasks the new document holds already (blocks kept as they were) use up their copies
  collect(doc, (id) => pool.get(id)?.shift())
  const restore = (q: QuoteParts, old: JSONContent): JSONContent => {
    const [oldTitle, ...oldNotes] = old.content ?? []
    const title: JSONContent = { type: 'paragraph', ...(q.title.length ? { content: q.title } : {}) }
    const notes = q.notes.map((n, i) => (oldNotes[i] && same?.(oldNotes[i], n) ? oldNotes[i] : n))
    return {
      ...old,
      content: [oldTitle?.type === 'paragraph' && (same?.(oldTitle, title) ?? false) ? oldTitle : { ...(oldTitle?.type === 'paragraph' ? { attrs: oldTitle.attrs } : {}), ...title }, ...notes],
    }
  }
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'blockquote') {
      const q = splitQuote(n, looksLikeFieldLine)
      const old = q?.itemId ? pool.get(q.itemId)?.shift() : undefined
      if (q && old) return restore(q, old)
    }
    if (!n.content?.length) return n
    const kids = n.content.map(walk)
    return kids.some((k, i) => k !== n.content![i]) ? { ...n, content: kids } : n
  }
  return walk(doc)
}
