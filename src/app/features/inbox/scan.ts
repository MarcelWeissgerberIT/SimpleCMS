/**
 * What the inbox reads from the workspace — pure functions over the store maps, cached per
 * immutable object (immer keeps untouched pages, contents and comment lists), so a pass after an
 * edit only rescans what changed.
 *
 *  - reminders: date mentions with `attrs.reminder` in any page + date properties of rows with
 *    `DateValue.reminder`. A reminder's key changes with its date or code, so changing either
 *    cancels the old one; trashed pages (or pages under a trashed parent) have none. A date mention
 *    inside a synced block is one reminder however many pages show the block (keyed by the sync
 *    group, at the page of the original when it is live).
 *  - team facts (cloud workspaces): my person mentions per block (and the sync group of those in
 *    synced blocks), the person properties I am in, and every comment reply id of a page — the
 *    engine diffs them against a snapshot.
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, DateValue, ID, Page, PageComment } from '../../store/types'
import { isEffectivelyTrashed } from '../../store/selectors'
import { normalizeReminder, reminderDueAt } from './reminders'

export interface ReminderEntry {
  /** 'm:<page>:<iso>:<code>' (date mention) · 's:<syncId>:<iso>:<code>' (date mention in a synced block) · 'p:<row>:<prop>:<iso>:<code>' (date property) */
  key: string
  source: 'mention' | 'property'
  pageId: ID
  propId: ID | null
  iso: string
  code: string
  dueAt: number
  /** the block a date mention sits in (deep link), if it has an id */
  blockId: string | null
  /** the line of a date mention */
  excerpt: string
}

interface Spot {
  blockId: string | null
  line: string
}

/** The synced block a mention sits in: its group, and the page of its original (null: this copy is the original). */
interface SyncedSpot {
  syncId: string
  original: boolean
  source: ID | null
}

interface ContentFacts {
  dates: Array<Spot & { iso: string; code: string; synced: SyncedSpot | null }>
  /** person id → where it is mentioned */
  persons: Map<ID, Array<Spot & { synced: SyncedSpot | null }>>
  /** comment thread id → the block its mark sits in */
  comments: Map<ID, string | null>
}

const LINE_MAX = 140

const clip = (s: string) => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s)

/** Inline text of a text block (text + mention labels). */
function inlineText(nodes: JSONContent[]): string {
  let s = ''
  for (const n of nodes) {
    if (n.type === 'text' && n.text) s += n.text
    else if (n.type === 'mention' && n.attrs?.label) s += `${n.attrs.kind === 'person' ? '@' : ''}${String(n.attrs.label)}`
    else if (n.type === 'hardBreak') s += ' '
  }
  return s.replace(/\s+/g, ' ').trim()
}

const contentCache = new WeakMap<JSONContent, ContentFacts>()

function scanContent(doc: JSONContent): ContentFacts {
  const hit = contentCache.get(doc)
  if (hit) return hit
  const facts: ContentFacts = { dates: [], persons: new Map(), comments: new Map() }
  const walk = (n: JSONContent, block: string | null, synced: SyncedSpot | null) => {
    const kids = n.content
    if (!kids) return
    const here = typeof n.attrs?.id === 'string' && n.attrs.id ? n.attrs.id : block
    if (n.type === 'syncedBlock' && typeof n.attrs?.syncId === 'string' && n.attrs.syncId) {
      const source = typeof n.attrs.sourcePageId === 'string' && n.attrs.sourcePageId ? n.attrs.sourcePageId : null
      synced = { syncId: n.attrs.syncId, original: !source, source }
    }
    let line: string | null = null
    const lineOf = () => (line ??= clip(inlineText(kids)))
    for (const c of kids) {
      if (c.type === 'mention') {
        const a = c.attrs ?? {}
        if (typeof a.id !== 'string' || !a.id) continue
        if (a.kind === 'date') {
          const code = normalizeReminder(a.reminder)
          if (code) facts.dates.push({ iso: a.id, code, blockId: here, line: lineOf(), synced })
        } else if (a.kind === 'person') {
          const list = facts.persons.get(a.id) ?? []
          list.push({ blockId: here, line: lineOf(), synced })
          facts.persons.set(a.id, list)
        }
      } else if (c.type === 'text') {
        for (const m of c.marks ?? []) {
          const id = m.type === 'comment' ? m.attrs?.id : null
          if (typeof id === 'string' && !facts.comments.has(id)) facts.comments.set(id, here)
        }
      } else walk(c, here, synced)
    }
  }
  walk(doc, null, null)
  contentCache.set(doc, facts)
  return facts
}

function isDateValue(v: unknown): v is DateValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'
}

/* ------------------------------------------------------------------ reminders */

/** Reminders of synced blocks: from the copy that is the original (the others show the same). */
const fromOriginal = new WeakSet<ReminderEntry>()
const pageReminders = new WeakMap<Page, { db: Database | undefined; list: ReminderEntry[] }>()

function remindersOf(page: Page, db: Database | undefined): ReminderEntry[] {
  const hit = pageReminders.get(page)
  if (hit && hit.db === db) return hit.list
  const list: ReminderEntry[] = []
  const seen = new Set<string>()
  if (page.content) {
    for (const d of scanContent(page.content).dates) {
      const key = d.synced ? `s:${d.synced.syncId}:${d.iso}:${d.code}` : `m:${page.id}:${d.iso}:${d.code}`
      const dueAt = reminderDueAt(d.iso, d.code)
      if (dueAt === null || seen.has(key)) continue
      seen.add(key)
      const entry: ReminderEntry = { key, source: 'mention', pageId: page.id, propId: null, iso: d.iso, code: d.code, dueAt, blockId: d.blockId, excerpt: d.line }
      if (d.synced?.original) fromOriginal.add(entry)
      list.push(entry)
    }
  }
  if (db) {
    for (const prop of db.properties) {
      if (prop.type !== 'date') continue
      const v = page.properties[prop.id]
      if (!isDateValue(v)) continue
      const code = normalizeReminder(v.reminder)
      const dueAt = code ? reminderDueAt(v.start, code) : null
      if (!code || dueAt === null) continue
      list.push({ key: `p:${page.id}:${prop.id}:${v.start}:${code}`, source: 'property', pageId: page.id, propId: prop.id, iso: v.start, code, dueAt, blockId: null, excerpt: prop.name })
    }
  }
  pageReminders.set(page, { db, list })
  return list
}

/**
 * Every reminder of the workspace (pages in the trash have none), soonest first. `trashed` collects
 * the reminders of pages in the trash (the engine notes those that come due there, see engine.ts).
 */
export function collectReminders(pages: Record<ID, Page>, dbs: Record<ID, Database>, trashed?: ReminderEntry[]): ReminderEntry[] {
  const out: ReminderEntry[] = []
  /** synced blocks: one entry per key, the original's when it is live */
  const shared = new Map<string, ReminderEntry>()
  for (const id in pages) {
    const page = pages[id]
    const list = remindersOf(page, page.databaseId ? dbs[page.databaseId] : undefined)
    if (!list.length) continue
    if (isEffectivelyTrashed(pages, id)) {
      trashed?.push(...list)
      continue
    }
    for (const r of list) {
      if (!r.key.startsWith('s:')) out.push(r)
      else {
        const had = shared.get(r.key)
        if (!had || (fromOriginal.has(r) && !fromOriginal.has(had))) shared.set(r.key, r)
      }
    }
  }
  out.push(...shared.values())
  return out.sort((a, b) => a.dueAt - b.dueAt)
}

/* ------------------------------------------------------------------ team facts */

/** What concerns "me" in one page — diffed against the engine's snapshot. */
export interface TeamFacts {
  /** block ids (repeated per mention, synced blocks included) where I am @mentioned; absent: the content is not loaded yet */
  m?: Array<string | null>
  /**
   * per entry of `m`: the sync group it sits in (null: not in a synced block) — a group's mentions are
   * tracked across pages (engine.ts). Absent in snapshots written before groups were tracked.
   */
  g?: Array<string | null>
  /** person properties (ids) I am in */
  a: ID[]
  /** every comment reply id on the page */
  r: ID[]
}

export function teamFacts(page: Page, db: Database | undefined, me: ID): TeamFacts {
  const out: TeamFacts = { a: [], r: [] }
  if (page.content) {
    const spots = scanContent(page.content).persons.get(me) ?? []
    out.m = spots.map((s) => s.blockId)
    out.g = spots.map((s) => s.synced?.syncId ?? null)
  }
  if (db)
    for (const prop of db.properties) {
      const v = page.properties[prop.id]
      if (prop.type === 'person' && Array.isArray(v) && v.includes(me)) out.a.push(prop.id)
    }
  for (const c of page.comments ?? []) for (const r of c.replies ?? []) out.r.push(r.id)
  return out
}

/** The line a person mention of `me` sits in (first in that block). */
export function mentionLine(page: Page, me: ID, blockId: string | null): string {
  if (!page.content) return ''
  const spots = scanContent(page.content).persons.get(me) ?? []
  return (spots.find((s) => s.blockId === blockId) ?? spots[0])?.line ?? ''
}

/** My first mention in a sync group on a page: its block, its line and the page of the group's original (null: this page). */
export function groupMention(page: Page, me: ID, syncId: string): { blockId: string | null; line: string; source: ID | null } | null {
  if (!page.content) return null
  const spot = (scanContent(page.content).persons.get(me) ?? []).find((s) => s.synced?.syncId === syncId)
  return spot ? { blockId: spot.blockId, line: spot.line, source: spot.synced!.source } : null
}

/** The block a comment thread's mark sits in (for a deep link), if any. */
export function commentBlock(page: Page, threadId: ID): string | null {
  return page.content ? (scanContent(page.content).comments.get(threadId) ?? null) : null
}

/** Has `name` written the thread or one of its replies (other than `exceptReply`)? */
export function takesPart(thread: PageComment, name: string, exceptReply?: ID): boolean {
  if (!name) return false
  if (thread.author.trim() === name) return true
  return (thread.replies ?? []).some((r) => r.id !== exceptReply && r.author.trim() === name)
}
