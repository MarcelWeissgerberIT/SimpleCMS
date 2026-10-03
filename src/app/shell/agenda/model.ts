/**
 * Agenda index: everything dated in the workspace, as one flat list of items.
 *
 *  - database rows: one item per filled `date` property (ranges and times included)
 *  - journal entries: rows of the journal database (recognised like features/journal does it)
 *  - date mentions: `mention` nodes with kind 'date' (attrs.id = "yyyy-MM-dd") in any page
 *  - activity: pages created / last edited per day (a faint count, not items)
 *
 * Built from the immutable store maps and cached per page object (immer keeps unchanged pages
 * identical), so a rebuild after a keystroke only re-reads the one page that changed.
 */
import { useMemo } from 'react'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ColorName, Database, DateValue, ID, Page, PageIcon, PropertyDef } from '../../store/types'

/* ------------------------------------------------------------------ */
/* Day numbers: whole days since 1970-01-01 (calendar dates, no TZ)     */
/* ------------------------------------------------------------------ */

const MS_DAY = 86_400_000

/** "2026-10-09" (or "2026-10-09T14:30") → day number, or null. */
export function isoToDay(iso: string | null | undefined): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return null
  const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DAY
  return Number.isFinite(n) ? n : null
}

/** Local calendar date → day number. */
export function dateToDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_DAY
}

/** Day number → local Date at midnight. */
export function dayToDate(n: number): Date {
  const u = new Date(n * MS_DAY)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate())
}

export function dayToIso(n: number): string {
  return new Date(n * MS_DAY).toISOString().slice(0, 10)
}

export const today = (): number => dateToDay(new Date())

/** "14:30" from "2026-10-09T14:30", else null. */
function timeOf(s: string | null | undefined): string | null {
  const m = s ? /T(\d{2}):(\d{2})/.exec(s) : null
  return m ? `${m[1]}:${m[2]}` : null
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export type AgendaKind = 'row' | 'journal' | 'mention'

export interface AgendaItem {
  /** unique: `r:<row>:<prop>` or `m:<page>:<iso>` */
  key: string
  kind: AgendaKind
  /** filter source: database id, 'journal' or 'mentions' */
  source: string
  pageId: ID
  dbId: ID | null
  propId: ID | null
  /** date property name, set when its database has more than one date property */
  propName: string | null
  title: string
  icon: PageIcon | null
  pageKind: Page['kind']
  /** first and last day (inclusive) */
  start: number
  end: number
  /** "HH:mm" (24 h) when the value includes a time */
  time: string | null
  endTime: string | null
  /** status / select colour of the row */
  color: ColorName | null
  statusName: string | null
  /** null: the row has no status or checkbox to be done with */
  done: boolean | null
  /** the line a date mention sits in */
  excerpt: string | null
}

export const SOURCE_JOURNAL = 'journal'
export const SOURCE_MENTIONS = 'mentions'
export const SOURCE_ACTIVITY = 'activity'

export interface AgendaSource {
  id: string
  kind: 'database' | 'journal' | 'mentions' | 'activity'
  label: string
  icon: PageIcon | null
  /** LED colour */
  color: ColorName
  /** databases: their date properties (quick-create targets) */
  dateProps: PropertyDef[]
  count: number
}

export interface AgendaIndex {
  items: AgendaItem[]
  sources: AgendaSource[]
  /** day → pages created or edited that day */
  activity: Map<number, number>
  journalId: ID | null
}

/** The journal database: id prefix "jrnl" (features/journal), else a "Journal" db with Date + Mood. */
export function findJournalDb(pages: Record<ID, Page>, dbs: Record<ID, Database>): ID | null {
  let best: Page | null = null
  let sig: Page | null = null
  for (const p of Object.values(pages)) {
    if (p.kind !== 'database' || !dbs[p.id] || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    if (p.id.startsWith('jrnl')) {
      if (!best || p.createdAt < best.createdAt) best = p
    } else if (!sig && /^(journal|tagebuch)$/i.test(p.title.trim())) {
      const props = dbs[p.id].properties
      if (props.some((x) => x.type === 'date') && props.some((x) => x.type === 'select' && /^(mood|stimmung)$/i.test(x.name.trim()))) sig = p
    }
  }
  return (best ?? sig)?.id ?? null
}

/** Status colour, status name and done-ness of a row. */
function rowState(db: Database, row: Page): { color: ColorName | null; statusName: string | null; done: boolean | null } {
  const status = db.properties.find((p) => p.type === 'status')
  const select = db.properties.find((p) => p.type === 'select')
  const opt = (p: PropertyDef | undefined) => (p ? p.options?.find((o) => o.id === row.properties[p.id]) : undefined)
  const so = opt(status)
  const color = so?.color ?? opt(select)?.color ?? null
  let done: boolean | null = null
  if (status) done = so?.group === 'done'
  else {
    const boxes = db.properties.filter((p) => p.type === 'checkbox')
    const box = boxes.find((p) => /^(done|erledigt|complete|completed|fertig)$/i.test(p.name.trim())) ?? boxes[0]
    if (box) done = row.properties[box.id] === true
  }
  return { color: color === 'default' ? null : color, statusName: so?.name ?? null, done }
}

function isDateValue(v: unknown): v is DateValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'
}

/** Longest range shown (a typo like 2062 must not paint decades). */
const MAX_SPAN = 400

function rowItems(row: Page, db: Database, journal: boolean): AgendaItem[] {
  const dateProps = db.properties.filter((p) => p.type === 'date')
  if (!dateProps.length) return []
  const st = rowState(db, row)
  const out: AgendaItem[] = []
  for (const prop of dateProps) {
    const v = row.properties[prop.id]
    if (!isDateValue(v)) continue
    const start = isoToDay(v.start)
    if (start === null) continue
    let end = isoToDay(v.end ?? null) ?? start
    if (end < start) end = start
    if (end - start > MAX_SPAN) end = start + MAX_SPAN
    const withTime = !!v.includeTime
    out.push({
      key: `r:${row.id}:${prop.id}`,
      kind: journal ? 'journal' : 'row',
      source: journal ? SOURCE_JOURNAL : db.id,
      pageId: row.id,
      dbId: db.id,
      propId: prop.id,
      propName: dateProps.length > 1 ? prop.name : null,
      title: row.title,
      icon: row.icon,
      pageKind: row.kind,
      start,
      end,
      time: withTime ? timeOf(v.start) : null,
      endTime: withTime ? timeOf(v.end) : null,
      excerpt: null,
      ...st,
    })
  }
  return out
}

/** Inline text of a text block (text + mention labels). */
function inlineText(nodes: JSONContent[]): string {
  let s = ''
  for (const n of nodes) {
    if (n.type === 'text' && n.text) s += n.text
    else if (n.type === 'mention' && n.attrs?.label) s += String(n.attrs.label)
    else if (n.type === 'hardBreak') s += ' '
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** Date mentions of a doc: [iso, line it sits in][] (first line per date). */
function dateMentions(content: JSONContent | null): Array<[string, string]> {
  if (!content) return []
  const found = new Map<string, string>()
  const walk = (n: JSONContent) => {
    const kids = n.content
    if (!kids) return
    let line: string | null = null
    for (const c of kids) {
      if (c.type === 'mention' && c.attrs?.kind === 'date' && typeof c.attrs.id === 'string' && isoToDay(c.attrs.id) !== null) {
        const iso = c.attrs.id.slice(0, 10)
        if (!found.has(iso)) {
          line ??= inlineText(kids)
          found.set(iso, line.length > 96 ? `${line.slice(0, 95)}…` : line)
        }
      } else walk(c)
    }
  }
  walk(content)
  return [...found]
}

const mentionCache = new WeakMap<JSONContent, Array<[string, string]>>()

function mentionItems(page: Page): AgendaItem[] {
  if (!page.content) return []
  let list = mentionCache.get(page.content)
  if (!list) {
    list = dateMentions(page.content)
    mentionCache.set(page.content, list)
  }
  return list.map(([iso, line]) => {
    const day = isoToDay(iso)!
    return {
      key: `m:${page.id}:${iso}`,
      kind: 'mention' as const,
      source: SOURCE_MENTIONS,
      pageId: page.id,
      dbId: null,
      propId: null,
      propName: null,
      title: page.title,
      icon: page.icon,
      pageKind: page.kind,
      start: day,
      end: day,
      time: null,
      endTime: null,
      color: null,
      statusName: null,
      done: null,
      excerpt: line || null,
    }
  })
}

/** Per page: its items, valid while the page object and its database stay the same. */
const pageCache = new WeakMap<Page, { db: Database | undefined; journal: boolean; items: AgendaItem[]; created: number; edited: number }>()

const DB_COLORS: ColorName[] = ['blue', 'green', 'purple', 'pink', 'red', 'brown', 'gray']

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Day, then time (all-day first), longer ranges first, then title. Cheap checks first: this sorts thousands of items. */
export function compareItems(a: AgendaItem, b: AgendaItem): number {
  return a.start - b.start || cmpStr(a.time ?? '', b.time ?? '') || b.end - a.end || collator.compare(a.title, b.title) || cmpStr(a.key, b.key)
}

export function buildIndex(pages: Record<ID, Page>, dbs: Record<ID, Database>): AgendaIndex {
  const journalId = findJournalDb(pages, dbs)
  const items: AgendaItem[] = []
  const activity = new Map<number, number>()
  const bump = (d: number) => activity.set(d, (activity.get(d) ?? 0) + 1)
  for (const page of Object.values(pages)) {
    // template pages (features/templates) have no dates on the agenda
    if (page.trashed || isEffectivelyTrashed(pages, page.id) || inTemplate(pages, page.id)) continue
    const db = page.databaseId ? dbs[page.databaseId] : undefined
    const journal = !!db && db.id === journalId
    let hit = pageCache.get(page)
    if (!hit || hit.db !== db || hit.journal !== journal) {
      hit = {
        db,
        journal,
        items: [...(db ? rowItems(page, db, journal) : []), ...mentionItems(page)],
        created: dateToDay(new Date(page.createdAt)),
        edited: dateToDay(new Date(page.updatedAt)),
      }
      pageCache.set(page, hit)
    }
    bump(hit.created)
    if (hit.edited !== hit.created) bump(hit.edited)
    for (const it of hit.items) items.push(it)
  }
  items.sort(compareItems)

  // sources: every live database with a date property (journal apart), then journal, mentions, activity
  const counts = new Map<string, number>()
  for (const it of items) counts.set(it.source, (counts.get(it.source) ?? 0) + 1)
  const dbPages = Object.values(pages)
    .filter((p) => p.kind === 'database' && dbs[p.id] && p.id !== journalId && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && dbs[p.id].properties.some((x) => x.type === 'date'))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const sources: AgendaSource[] = dbPages.map((p, i) => ({
    id: p.id,
    kind: 'database',
    label: p.title.trim(),
    icon: p.icon,
    color: DB_COLORS[i % DB_COLORS.length],
    dateProps: dbs[p.id].properties.filter((x) => x.type === 'date'),
    count: counts.get(p.id) ?? 0,
  }))
  if (journalId)
    sources.push({ id: SOURCE_JOURNAL, kind: 'journal', label: '', icon: pages[journalId]?.icon ?? null, color: 'yellow', dateProps: [], count: counts.get(SOURCE_JOURNAL) ?? 0 })
  if (counts.get(SOURCE_MENTIONS))
    sources.push({ id: SOURCE_MENTIONS, kind: 'mentions', label: '', icon: null, color: 'orange', dateProps: [], count: counts.get(SOURCE_MENTIONS) ?? 0 })
  sources.push({ id: SOURCE_ACTIVITY, kind: 'activity', label: '', icon: null, color: 'gray', dateProps: [], count: 0 })
  return { items, sources, activity, journalId }
}

/* one index per store snapshot, shared by every consumer (agenda, home panel) */
let memo: { pages: Record<ID, Page>; dbs: Record<ID, Database>; index: AgendaIndex } | null = null

export function getIndex(pages: Record<ID, Page>, dbs: Record<ID, Database>): AgendaIndex {
  if (memo && memo.pages === pages && memo.dbs === dbs) return memo.index
  const index = buildIndex(pages, dbs)
  memo = { pages, dbs, index }
  return index
}

export function useAgendaIndex(): AgendaIndex {
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)
  return useMemo(() => getIndex(pages, dbs), [pages, dbs])
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Items overlapping [from, to] (inclusive), visible sources only. */
export function itemsBetween(items: AgendaItem[], from: number, to: number, hidden: ReadonlySet<string>): AgendaItem[] {
  return items.filter((it) => it.start <= to && it.end >= from && !hidden.has(it.source))
}

/** Rows that should be done by now: past end day, a status/checkbox that is not done. */
export function overdueItems(items: AgendaItem[], day: number, hidden: ReadonlySet<string>): AgendaItem[] {
  return items.filter((it) => it.kind === 'row' && it.done === false && it.end < day && !hidden.has(it.source)).sort((a, b) => a.end - b.end || compareItems(a, b))
}

/** Draggable: database rows (journal entries carry their date in their title, mentions live in text). */
export const canMove = (it: AgendaItem) => it.kind === 'row' && !!it.propId
