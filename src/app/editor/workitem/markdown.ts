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
 * - Frozen tasks (documents that left the workspace) carry no ids: their people are plain names.
 */
import type { JSONContent } from '@tiptap/core'
import { ITEM_ID, PERSON_ID, dueHasTime, itemAttrs, readDue, readReminder, storedItemAttrs, WORK_ITEM, type WorkItemAttrs, type WorkItemStatus } from './attrs'

/**
 * Markdown `> [!TODO]` → a task block. OFF in the schema release (P0): every client must understand the
 * block before anything can create one (docs/CLOUD.md § Schema gate). Flip it in the release that creates tasks.
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
