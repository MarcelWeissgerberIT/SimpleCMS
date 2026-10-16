/**
 * Pages a task refers to — page mentions (@), links to pages (`pageLink`, `#/p/<id>` links, also a pasted One address
 * as plain text) in the part of the task Claude may read, and One addresses in the person's answers and rework notes —
 * go along with the task to the worker as read-only text, and so do the pages linked in THOSE pages (one level deeper):
 * ≤ 8 pages in all, ≤ 20,000 characters each, each only what Claude may read of it (context marks). The pages of the
 * turn come first (the answer or rework note the stage runs with, coding/tasks.ts pickNext), then the task's own, then
 * the pages linked in them. What Claude sees named but does not get (over the limit, or linked deeper) is listed under
 * the pages with how the person can give it. A database row brings its filled fields, a database its entries' titles.
 * Never trashed or template pages. Their text is part of the task's version (trust.ts: every page within two links of
 * the task's content, refIdsOf), so in a team a changed reference waits for Confirm like a changed task — and nothing
 * outside that version goes along.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, selectRows } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { docToMarkdown, readableBlocks, readableContent } from '../../editor'
import { propertyValueToText } from '../../database'
import { t } from '../../i18n'

export const MAX_REFS = 8
const MAX_CHARS = 20_000
const MAX_ROWS = 50
/** pages a task version hashes at most (refIdsOf): what goes along is always among them */
const MAX_HASHED = 64
const LINK = /#\/p\/([A-Za-z0-9_-]{4,64})/
const LINKS = /#\/p\/([A-Za-z0-9_-]{4,64})/g

/** The page ids of One addresses in a text ("https://…/app/#/p/<id>", "#/p/<id>", "[@Title](#/p/<id>)"). */
export const idsInText = (text: string): string[] => [...text.matchAll(LINKS)].map((m) => m[1]!)

export interface TaskRef {
  id: ID
  title: string
  markdown: string
  /** linked in this page that goes along (one level deeper), not in the task itself */
  via?: { id: ID; title: string }
}

/** A page Claude sees named but that does not go along: over the limit of 8, or linked deeper than one level. */
export interface LeftRef {
  id: ID
  title: string
  why: 'limit' | 'deeper'
}

/** The page ids the blocks point to, in order — `selfId` left out. */
function refIds(selfId: ID, blocks: JSONContent[]): ID[] {
  const ids: ID[] = []
  const add = (id: unknown) => {
    if (typeof id === 'string' && id && id !== selfId && !ids.includes(id)) ids.push(id)
  }
  const walk = (n: JSONContent) => {
    if (n.type === 'mention' && n.attrs?.kind === 'page') add(n.attrs.id)
    else if (n.type === 'pageLink') add(n.attrs?.pageId)
    for (const m of n.marks ?? []) if (m.type === 'link' && typeof m.attrs?.href === 'string') add(LINK.exec(m.attrs.href)?.[1])
    // a One address pasted as plain text
    if (n.type === 'text' && typeof n.text === 'string' && n.text.includes('#/p/')) for (const id of idsInText(n.text)) add(id)
    for (const c of n.content ?? []) walk(c)
  }
  for (const b of blocks) walk(b)
  return ids
}

/** The page ids blocks point to (mentions, page links, One addresses), in order — `selfId` left out. */
export const refIdsIn = (blocks: JSONContent[], selfId: ID = ''): ID[] => refIds(selfId, blocks)

/** The ids what Claude may read of a page points to (its readable part: context marks). */
const readableLinks = (id: ID): ID[] => refIds(id, readableBlocks(id))

const usable = (id: ID) => {
  const s = useWorkspace.getState()
  return !!s.pages[id] && !isEffectivelyTrashed(s.pages, id) && !inTemplate(s.pages, id)
}

const titleOf = (id: ID) => useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')

/** A page that goes along to the worker; `staged`: proposed in the AI terminal, not created yet — it goes along once it is. */
export interface RefPage {
  id: ID
  title: string
  staged?: true
  /** linked in this page that goes along (one level deeper) */
  via?: { id: ID; title: string }
}

/**
 * The pages that would go to the worker with these blocks (and the One addresses in `extra`: answers, notes), then the
 * pages linked in them: live, not in a template, at most 8 — what the AI terminal's review lists before a task is
 * created or acted on. `staged`: pages the terminal proposed but did not create yet (id → title) — listed too, marked:
 * once applied they go along (their links are not known yet).
 */
export function refPagesOf(blocks: JSONContent[], extra: string[] = [], selfId: ID = '', staged?: ReadonlyMap<ID, string>): RefPage[] {
  const s = useWorkspace.getState()
  const ids = refIdsIn(blocks, selfId)
  for (const text of extra) for (const id of idsInText(text)) if (id !== selfId && !ids.includes(id)) ids.push(id)
  const out: RefPage[] = ids
    .filter((id) => usable(id) || (!s.pages[id] && !!staged?.has(id)))
    .slice(0, MAX_REFS)
    .map((id): RefPage => (s.pages[id] ? { id, title: titleOf(id) } : { id, title: staged!.get(id)!.trim() || t('common.untitled'), staged: true }))
  const seen = new Set([selfId, ...ids])
  for (const parent of out.filter((r) => !r.staged)) {
    for (const id of readableLinks(parent.id)) {
      if (out.length >= MAX_REFS) return out
      if (seen.has(id) || !usable(id)) continue
      seen.add(id)
      out.push({ id, title: titleOf(id), via: { id: parent.id, title: parent.title } })
    }
  }
  return out
}

/** How refPlan picks: the turn's texts first; `within`: the task version's pages (refIdsOf) — nothing outside goes along. */
export interface RefOpts {
  /** this turn's texts (the answer / rework note the stage runs with, an answer being written): their pages go first */
  turn?: string[]
  within?: readonly ID[]
}

/** What goes along with a task (ids, in order) and what Claude sees named but does not get. */
export interface RefPlan {
  pages: Array<{ id: ID; via?: ID }>
  left: Array<{ id: ID; why: 'limit' | 'deeper' }>
}

/**
 * The pages a task refers to, in the order they go along: the turn's (`opts.turn`), the task's readable part (its notes
 * hold the answers and rework notes sent before), the One addresses in `extra`, then — one level deeper — the pages
 * linked in the readable part of those; ≤ 8. The rest Claude sees named: over the limit, or linked deeper still.
 */
export function refPlan(taskId: ID, extra: string[] = [], opts: RefOpts = {}): RefPlan {
  const within = opts.within ? new Set(opts.within) : null
  const pages: RefPlan['pages'] = []
  const left: RefPlan['left'] = []
  const seen = new Set<ID>([taskId])
  const take = (id: ID, via?: ID) => {
    if (seen.has(id) || !usable(id)) return
    seen.add(id)
    if (pages.length < MAX_REFS && (!within || within.has(id))) pages.push(via ? { id, via } : { id })
    else left.push({ id, why: 'limit' })
  }
  for (const text of opts.turn ?? []) for (const id of idsInText(text)) take(id)
  for (const id of readableLinks(taskId)) take(id)
  for (const text of extra) for (const id of idsInText(text)) take(id)
  // one level deeper: the pages linked in what Claude reads of those that go along
  for (const parent of pages.map((p) => p.id)) for (const id of readableLinks(parent)) take(id, parent)
  // what the deeper pages link: named in their text, never sent
  for (const p of pages)
    if (p.via)
      for (const id of readableLinks(p.id))
        if (!seen.has(id) && usable(id)) {
          seen.add(id)
          left.push({ id, why: 'deeper' })
        }
  return { pages, left }
}

const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…` : s)

/** One referenced page as text: a row's filled fields first, a database's entries, then what Claude may read of it. */
function refText(page: Page): string {
  const s = useWorkspace.getState()
  const parts: string[] = []
  const db = page.databaseId ? s.databases[page.databaseId] : undefined
  if (db) {
    const fields = db.properties
      .filter((p) => p.type !== 'title')
      .map((p) => [p.name, propertyValueToText(db, p, page).trim()] as const)
      .filter(([, v]) => v)
      .slice(0, 30)
    if (fields.length) parts.push(fields.map(([k, v]) => `- ${k}: ${v.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n'))
  }
  if (s.databases[page.id]) {
    const rows = selectRows(s.pages, page.id).filter((r) => !r.trashed)
    if (rows.length) parts.push(rows.slice(0, MAX_ROWS).map((r) => `- ${r.title.trim() || t('common.untitled')}`).join('\n') + (rows.length > MAX_ROWS ? `\n- … (${rows.length - MAX_ROWS} more)` : ''))
  }
  const body = readableContent(page.id).markdown
  if (body) parts.push(body)
  return clip(parts.join('\n\n'))
}

/** The pages a task refers to with their text, and what is named but left out (refPlan). */
export function taskRefPlan(taskId: ID, extra: string[] = [], opts: RefOpts = {}): { refs: TaskRef[]; left: LeftRef[] } {
  const s = useWorkspace.getState()
  const plan = refPlan(taskId, extra, opts)
  return {
    refs: plan.pages.map(({ id, via }) => ({ id, title: titleOf(id), markdown: refText(s.pages[id]!), ...(via ? { via: { id: via, title: titleOf(via) } } : {}) })),
    left: plan.left.map(({ id, why }) => ({ id, title: titleOf(id), why })),
  }
}

/** The pages a task refers to (what goes along to the worker); `extra`: more text to look for One addresses in. */
export function taskRefs(taskId: ID, extra: string[] = [], opts: RefOpts = {}): TaskRef[] {
  return taskRefPlan(taskId, extra, opts).refs
}

/** The referenced pages as a part of the task text ('' without any): each page, then what is named but left out. */
export function refsMarkdown(refs: TaskRef[], left: LeftRef[] = []): string {
  if (!refs.length && !left.length) return ''
  const parts = [`## ${t('features.coding.refs.heading')}`]
  for (const r of refs) parts.push(`### ${r.title} (${t('features.coding.refs.page')} ${r.id})\n\n${r.via ? `_${t('features.coding.refs.via', { title: r.via.title })}_\n\n` : ''}${r.markdown || t('features.coding.refs.empty')}`)
  if (left.length) parts.push(t('features.coding.refs.left', { n: MAX_REFS, list: left.map((l) => `“${l.title}” (${t('features.coding.refs.page')} ${l.id})`).join(', ') }))
  return parts.join('\n\n')
}

/**
 * The task text the worker gets: the task's readable part, then the pages it (the turn's texts first, then `extra`:
 * older answers, notes) refers to, the pages linked in those, and what is left out.
 */
export function taskText(taskId: ID, extra: string[] = [], opts: RefOpts = {}): string {
  const own = readableContent(taskId).markdown
  const { refs, left } = taskRefPlan(taskId, extra, opts)
  const more = refsMarkdown(refs, left)
  return more ? `${own}\n\n${more}` : own
}

/** The ids a page's whole content points to, per page object (its content never changes: pages are frozen). */
const pointed = new WeakMap<Page, ID[]>()
const linksOf = (page: Page): ID[] => {
  let ids = pointed.get(page)
  if (!ids) pointed.set(page, (ids = refIds(page.id, page.content?.content ?? [])))
  return ids
}

/** One referenced page's part of a version, per page object. */
const keyed = new WeakMap<Page, string>()
const keyOf = (p: Page): string => {
  let k = keyed.get(p)
  if (k === undefined) keyed.set(p, (k = `${p.id}\n${p.title}\n${JSON.stringify(p.properties ?? {})}\n${docToMarkdown(p.content)}`))
  return k
}

/**
 * The references' part of a task version: every page the task's content points to and the pages THOSE point to (not
 * only the readable parts), by id, title, fields and full content — the same in every language and with any context
 * marks.
 */
export function refsKey(page: Page): string {
  const s = useWorkspace.getState()
  return refIdsOf(page)
    .map((id) => keyOf(s.pages[id]!))
    .join('\u0001')
}

/**
 * The pages a task version hashes (refsKey): every page the task's content points to that is live and not in a
 * template, then every page those point to — at most 64; what goes along (refPlan) is always among them, so a page
 * whose change makes a team task wait for Confirm again (coding/waiting.ts watches them) is every page that can go
 * along. A task whose pages link no further pages (and that links ≤ 8) hashes as before pages linked in pages went along.
 */
export function refIdsOf(page: Page): ID[] {
  const s = useWorkspace.getState()
  const out: ID[] = []
  const seen = new Set<ID>([page.id])
  const take = (id: ID) => {
    if (out.length >= MAX_HASHED || seen.has(id)) return
    seen.add(id)
    if (usable(id)) out.push(id)
  }
  for (const id of linksOf(page)) take(id)
  for (const id of [...out]) {
    const p = s.pages[id]
    if (p) for (const n of linksOf(p)) take(n)
  }
  return out
}
