/**
 * Pages a task refers to — page mentions (@), links to pages (`pageLink`, `#/p/<id>` links, also a pasted One address
 * as plain text) in the part of the task Claude may read, and One addresses in the person's answers and rework notes —
 * go along with the task to the worker as read-only text, and so do the pages linked in THOSE pages (one level deeper):
 * ≤ 8 pages in all, ≤ 20,000 characters each, each only what Claude may read of it (context marks). The pages of the
 * turn come first (the answer or rework note the stage runs with, coding/tasks.ts pickNext), then the task's own, then
 * the pages linked in them — from each page its first 8 linked pages (`deeperOf`), and one level deeper only pages the
 * person could have given themselves: never a mail, a memory or a row of One's own databases (pipelines, test cases …),
 * and a private page (team) only for a private task — those are named for Claude, never sent. What Claude sees named
 * but does not get (over the limit, linked deeper, kept back) is listed under the pages (≤ 20 names) with how the
 * person can give it. A database row brings its filled fields, a database its entries' titles. Never trashed or
 * template pages. Their text is part of the task's version (trust.ts: every page the task's content points to and
 * the first 8 each of those points to, refIdsOf), so in a team a changed reference waits for Confirm like a changed
 * task — and nothing outside that version goes along.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, selectRows } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { docToMarkdown, readableBlocks, readableContent } from '../../editor'
import { propertyValueToText } from '../../database'
import { classOfPage, type SourceWorld } from '../ai/core'
import { t } from '../../i18n'
import { privateAllowed } from './pagePick'

export const MAX_REFS = 8
const MAX_CHARS = 20_000
const MAX_ROWS = 50
/** names Claude gets of the pages that do not go along (the rest is counted) */
const MAX_LEFT = 20
const LINK = /#\/p\/([A-Za-z0-9_-]{4,64})/
const LINKS = /#\/p\/([A-Za-z0-9_-]{4,64})/g
/** a Markdown link `[label](href)` — its label (brackets escaped) is text, never an address */
const MD_LINK = /\[(?:\\.|[^\]\\\n])*\]\(([^)\s]*)\)/g

/**
 * The page ids of One addresses in a text ("https://…/app/#/p/<id>", "#/p/<id>", "[@Title](#/p/<id>)"), in order. A
 * Markdown link counts by its address only: an address inside its label (a page titled "Kit #/p/…") names nothing.
 */
export function idsInText(text: string): string[] {
  const out: string[] = []
  const scan = (part: string) => {
    for (const m of part.matchAll(LINKS)) out.push(m[1]!)
  }
  let at = 0
  for (const m of text.matchAll(MD_LINK)) {
    scan(text.slice(at, m.index))
    const id = LINK.exec(m[1]!)?.[1]
    if (id) out.push(id)
    at = m.index! + m[0].length
  }
  scan(text.slice(at))
  return out
}

export interface TaskRef {
  id: ID
  title: string
  markdown: string
  /** linked in this page that goes along (one level deeper), not in the task itself */
  via?: { id: ID; title: string }
}

/**
 * A page Claude sees named but that does not go along: over the limit of 8 (or past a page's first 8 links), linked
 * deeper than one level, or kept back one level deeper (a mail, a memory, a row of One's own databases — `kept`; a
 * private page for a shared task — `private`: never named to Claude, its title stays out of the task).
 */
export type LeftWhy = 'limit' | 'deeper' | 'kept' | 'private'
export interface LeftRef {
  id: ID
  title: string
  why: LeftWhy
  /** not in the task's version (RefPlan): named to Claude by its id only */
  outside?: true
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
    let linked = false
    for (const m of n.marks ?? [])
      if (m.type === 'link') {
        linked = true
        if (typeof m.attrs?.href === 'string') add(LINK.exec(m.attrs.href)?.[1])
      }
    // a One address pasted as plain text — never the text of a link (its address counts: a label is no address)
    if (n.type === 'text' && !linked && typeof n.text === 'string' && n.text.includes('#/p/')) for (const id of idsInText(n.text)) add(id)
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

/** The ids a page's whole content points to, per page object (its content never changes: pages are frozen). */
const pointed = new WeakMap<Page, ID[]>()
const linksOf = (page: Page): ID[] => {
  let ids = pointed.get(page)
  if (!ids) pointed.set(page, (ids = refIds(page.id, page.content?.content ?? [])))
  return ids
}

/**
 * The pages one page can bring along one level deeper: the first 8 live pages its whole content points to, in order —
 * ONE list for the version (refIdsOf) and the hand-out (refPlan, which takes those of them Claude may read in it), so
 * whatever order the hand-out takes pages in, what it can send is in the version.
 */
function deeperOf(id: ID): ID[] {
  const page = useWorkspace.getState().pages[id]
  if (!page) return []
  const out: ID[] = []
  for (const n of linksOf(page)) {
    if (out.length >= MAX_REFS) break
    if (usable(n)) out.push(n)
  }
  return out
}

const worldNow = (): SourceWorld => {
  const s = useWorkspace.getState()
  return { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null, memo: new Map() }
}

/** Ancestors (and the page itself) a broken parent chain never loops through. */
const MAX_DEPTH = 256

/** In one of One's own databases (Database.system: pipelines, test cases, mails, memory …) — or such a database itself. */
function inSystemDb(id: ID, w: SourceWorld): boolean {
  let cur: Page | undefined = w.pages[id]
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    if (w.databases[cur.id]?.system) return true
    cur = cur.parentId ? w.pages[cur.parentId] : undefined
  }
  return false
}

/**
 * Why a page linked in a page (not named by the person) stays back: a private page for a task that may not carry one
 * ('private'), a mail, a memory or a row of One's own databases ('kept') — or null: it may go along.
 */
function keptBack(id: ID, w: SourceWorld, allowPrivate: boolean): 'kept' | 'private' | null {
  const classes = classOfPage(id, w)
  if (classes.has('private') && !allowPrivate) return 'private'
  if (classes.has('mail') || classes.has('memory') || inSystemDb(id, w)) return 'kept'
  return null
}

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
 * pages linked in them (each page's first 8 that Claude may read in it, none kept back): live, not in a template, at
 * most 8 — what the AI terminal's review and the new-task dialog list before a task is created or acted on. `staged`:
 * pages the terminal proposed but did not create yet (id → title) — listed too, marked: once applied they go along
 * (their links are not known yet). `allowPrivate`: private pages one level deeper (default: the task is private).
 */
export function refPagesOf(blocks: JSONContent[], extra: string[] = [], selfId: ID = '', staged?: ReadonlyMap<ID, string>, allowPrivate = privateAllowed(selfId || null)): RefPage[] {
  const s = useWorkspace.getState()
  const ids = refIdsIn(blocks, selfId)
  for (const text of extra) for (const id of idsInText(text)) if (id !== selfId && !ids.includes(id)) ids.push(id)
  const out: RefPage[] = ids
    .filter((id) => usable(id) || (!s.pages[id] && !!staged?.has(id)))
    .slice(0, MAX_REFS)
    .map((id): RefPage => (s.pages[id] ? { id, title: titleOf(id) } : { id, title: staged!.get(id)!.trim() || t('common.untitled'), staged: true }))
  const seen = new Set([selfId, ...ids])
  const w = worldNow()
  for (const parent of out.filter((r) => !r.staged)) {
    const readable = new Set(readableLinks(parent.id))
    for (const id of deeperOf(parent.id)) {
      if (out.length >= MAX_REFS) return out
      if (seen.has(id) || !readable.has(id)) continue
      seen.add(id)
      if (keptBack(id, w, allowPrivate)) continue
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
  /** private pages one level deeper (default: the task is private — privateAllowed) */
  allowPrivate?: boolean
}

/**
 * What goes along with a task (ids, in order) and what Claude sees named but does not get. `outside`: not in the task's
 * version (past a page's first links, linked deeper still) — counted for Claude, never named: its title is no part of
 * what was checked.
 */
export interface RefPlan {
  pages: Array<{ id: ID; via?: ID }>
  left: Array<{ id: ID; why: LeftWhy; outside?: true }>
}

/**
 * The pages a task refers to, in the order they go along: the turn's (`opts.turn`), the task's readable part (its notes
 * hold the answers and rework notes sent before), the One addresses in `extra`, then — one level deeper — the pages
 * linked in the readable part of those (each page's first 8, `deeperOf`; none kept back); ≤ 8, only pages of the
 * version (`within`). The rest Claude sees named: over the limit, linked deeper still, kept back.
 */
export function refPlan(taskId: ID, extra: string[] = [], opts: RefOpts = {}): RefPlan {
  const within = opts.within ? new Set(opts.within) : null
  const allowPrivate = opts.allowPrivate ?? privateAllowed(taskId)
  const w = worldNow()
  const pages: RefPlan['pages'] = []
  const left: RefPlan['left'] = []
  const seen = new Set<ID>([taskId])
  /**
   * A page met: sent while there is room — one level deeper (`via`) only what may follow — else named (`nameAs`: never
   * sent, e.g. past a page's first links). A page outside the version is never sent.
   */
  const meet = (id: ID, via: ID | null, nameAs?: 'limit' | 'deeper') => {
    if (seen.has(id) || !usable(id)) return
    seen.add(id)
    const outside = !!within && !within.has(id)
    const kept = via !== null ? keptBack(id, w, allowPrivate) : null
    const why: LeftWhy = kept ?? nameAs ?? 'limit'
    if (!outside && !kept && !nameAs && pages.length < MAX_REFS) pages.push(via ? { id, via } : { id })
    else left.push(outside ? { id, why, outside: true } : { id, why })
  }
  for (const text of opts.turn ?? []) for (const id of idsInText(text)) meet(id, null)
  for (const id of readableLinks(taskId)) meet(id, null)
  for (const text of extra) for (const id of idsInText(text)) meet(id, null)
  // one level deeper: from each page that goes along, its first linked pages (deeperOf) Claude may read in it
  const rest: Array<[ID, ID[]]> = []
  for (const parent of pages.map((p) => p.id)) {
    const readable = readableLinks(parent)
    const first = new Set(deeperOf(parent))
    for (const id of readable) if (first.has(id)) meet(id, parent)
    rest.push([parent, readable.filter((id) => !first.has(id))])
  }
  // named, never sent: what Claude reads past a page's first links, then what the deeper pages link
  for (const [parent, ids] of rest) for (const id of ids) meet(id, parent, 'limit')
  for (const p of [...pages]) if (p.via) for (const id of readableLinks(p.id)) meet(id, p.id, 'deeper')
  return { pages, left }
}

/**
 * What the task's next hand-out sends (pickNext): this stage's answers and rework note first (`stageId`), the older
 * ones after the task's own pages, only pages of the task's version. With `draft` (an answer or rework note being
 * written, not sent yet): what it would send once it is — the draft's pages first, the version as it will be then.
 */
export function nextPlan(taskId: ID, local: TurnLocal, stageId: ID | null | undefined, draft = ''): RefPlan {
  const page = useWorkspace.getState().pages[taskId]
  if (!page) return { pages: [], left: [] }
  const { turn, older } = splitTurn(local, stageId)
  return refPlan(taskId, older, { turn: draft ? [draft, ...turn] : turn, within: refIdsOf(page, draft ? [draft] : []) })
}

/** The answers and rework note a task keeps on this device (coding/local.ts TaskLocal). */
export interface TurnLocal {
  answers?: Array<{ stageId: ID; a: string }>
  rework?: { stageId: ID; text: string } | null
}

/** The turn's texts (this stage's answers and rework note) and the older ones — as pickNext hands them out. */
export function splitTurn(local: TurnLocal, stageId: ID | null | undefined): { turn: string[]; older: string[] } {
  const ofStage = (x: { stageId: ID }) => !!stageId && x.stageId === stageId
  const answers = local.answers ?? []
  const rework = local.rework
  return {
    turn: [...answers.filter(ofStage).map((a) => a.a), ...(rework && ofStage(rework) ? [rework.text] : [])],
    older: [...answers.filter((a) => !ofStage(a)).map((a) => a.a), ...(rework && !ofStage(rework) ? [rework.text] : [])],
  }
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
    left: plan.left.map(({ id, why, outside }) => ({ id, title: titleOf(id), why, ...(outside ? { outside } : {}) })),
  }
}

/** The pages a task refers to (what goes along to the worker); `extra`: more text to look for One addresses in. */
export function taskRefs(taskId: ID, extra: string[] = [], opts: RefOpts = {}): TaskRef[] {
  return taskRefPlan(taskId, extra, opts).refs
}

/**
 * Who Claude is told about of what stays back: ≤ 20 names (a page outside the version by its id only — its title is no
 * part of what was checked), the rest counted; a private page never (its title stays out of a shared task).
 */
function leftList(left: LeftRef[], room: { n: number }): string {
  const named: string[] = []
  for (const l of left) {
    if (room.n <= 0) break
    room.n--
    named.push(l.outside ? t('features.coding.refs.pageId', { id: l.id }) : `${t('features.coding.refs.quote', { title: l.title })} (${t('features.coding.refs.page')} ${l.id})`)
  }
  const more = left.length - named.length
  if (!named.length) return t(more === 1 ? 'features.coding.refs.leftCount.one' : 'features.coding.refs.leftCount.other', { n: more })
  return named.join(', ') + (more ? t('features.coding.refs.leftMore', { n: more }) : '')
}

/** The referenced pages as a part of the task text ('' without any): each page, then what is named but left out. */
export function refsMarkdown(refs: TaskRef[], left: LeftRef[] = []): string {
  const over = left.filter((l) => l.why === 'limit' || l.why === 'deeper')
  const kept = left.filter((l) => l.why === 'kept')
  if (!refs.length && !over.length && !kept.length) return ''
  const parts = [`## ${t('features.coding.refs.heading')}`]
  for (const r of refs) parts.push(`### ${r.title} (${t('features.coding.refs.page')} ${r.id})\n\n${r.via ? `_${t('features.coding.refs.via', { title: r.via.title })}_\n\n` : ''}${r.markdown || t('features.coding.refs.empty')}`)
  if (over.length || kept.length) {
    const room = { n: MAX_LEFT }
    const say: string[] = []
    if (over.length) say.push(t('features.coding.refs.left', { n: MAX_REFS, list: leftList(over, room) }))
    if (kept.length) say.push(t('features.coding.refs.leftKept', { list: leftList(kept, room) }))
    say.push(t('features.coding.refs.leftAsk'))
    parts.push(say.join(' '))
  }
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

/** One referenced page's part of a version, per page object. */
const keyed = new WeakMap<Page, string>()
const keyOf = (p: Page): string => {
  let k = keyed.get(p)
  if (k === undefined) keyed.set(p, (k = `${p.id}\n${p.title}\n${JSON.stringify(p.properties ?? {})}\n${docToMarkdown(p.content)}`))
  return k
}

/**
 * The references' part of a task version: the pages refIdsOf names (not only the readable parts), by id, title, fields
 * and full content — the same in every language and with any context marks.
 */
export function refsKey(page: Page): string {
  const s = useWorkspace.getState()
  return refIdsOf(page)
    .map((id) => keyOf(s.pages[id]!))
    .join('\u0001')
}

/**
 * The pages a task version hashes (refsKey): every live page (not in a template) the task's content points to — all of
 * them, wherever they stand — then from each of those its first 8 (deeperOf). Whatever order the hand-out takes pages
 * in (the turn's first), each page it can send is among them, so a page whose change makes a team task wait for
 * Confirm again (coding/waiting.ts watches them) is every page that can go along. `extra`: texts about to be written
 * into the task's page (an answer or rework note being written: "Goes along" shows the version it will have). A task
 * whose pages link no further pages (and that links ≤ 8) hashes as before pages linked in pages went along.
 */
export function refIdsOf(page: Page, extra: string[] = []): ID[] {
  const out: ID[] = []
  const seen = new Set<ID>([page.id])
  const take = (id: ID) => {
    if (seen.has(id)) return
    seen.add(id)
    if (usable(id)) out.push(id)
  }
  for (const id of linksOf(page)) take(id)
  for (const text of extra) for (const id of idsInText(text)) take(id)
  for (const id of [...out]) for (const n of deeperOf(id)) take(n)
  return out
}
