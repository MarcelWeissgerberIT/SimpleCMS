/** Read hooks and pure selectors over the workspace store. */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace, linkedPageIds, pageChanges } from './store'
import type { Database, ID, Page } from './types'

export function usePage(id: ID | null | undefined): Page | undefined {
  return useWorkspace((s) => (id ? s.pages[id] : undefined))
}

export function useDatabase(id: ID | null | undefined): Database | undefined {
  return useWorkspace((s) => (id ? s.databases[id] : undefined))
}

export function sortPages(pages: Page[]): Page[] {
  return pages.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** Visible child pages (not trashed, not database rows) of a parent, sorted. */
export function selectChildren(pages: Record<ID, Page>, parentId: ID | null): Page[] {
  return sortPages(Object.values(pages).filter((p) => p.parentId === parentId && !p.trashed && !p.databaseId && !p.hidden))
}

export function useChildren(parentId: ID | null): Page[] {
  const ids = useWorkspace(useShallow((s) => selectChildren(s.pages, parentId).map((p) => p.id)))
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => ids.map((id) => pages[id]).filter(Boolean), [ids, pages])
}

/** Rows of a database (not trashed), in creation/order sequence. */
export function selectRows(pages: Record<ID, Page>, dbId: ID): Page[] {
  return sortPages(Object.values(pages).filter((p) => p.databaseId === dbId && !p.trashed))
}

export function useRows(dbId: ID | null | undefined): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => (dbId ? selectRows(pages, dbId) : []), [pages, dbId])
}

/** Ancestors from root → page (inclusive). */
export function selectBreadcrumbs(pages: Record<ID, Page>, id: ID): Page[] {
  const out: Page[] = []
  let cur: Page | undefined = pages[id]
  const seen = new Set<ID>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return out
}

export function useBreadcrumbs(id: ID | null | undefined): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => (id ? selectBreadcrumbs(pages, id) : []), [pages, id])
}

/**
 * No page added or removed between two page maps, and every changed page `keeps` what an answer
 * depends on (the store's shared diff: cheap right after a change).
 */
function sameShape(pages: Record<ID, Page>, prev: Record<ID, Page>, keeps: (p: Page, o: Page) => boolean): boolean {
  const { changed, added, removed } = pageChanges(pages, prev)
  if (added.length || removed.length) return false
  for (const id of changed) if (!keeps(pages[id], prev[id])) return false
  return true
}

/*
 * Answers that depend on a page's ancestry (in the trash? in a template?), memoised per pages map —
 * the map is immutable, so an answer holds until the next store change. A change that re-parents,
 * adds, removes, trashes or restores no page (typing, a property) keeps every answer: the new map
 * shares the previous map's memo instead of rebuilding it page by page.
 */
interface AncestryMemo<V> {
  byPages: WeakMap<Record<ID, Page>, Map<ID, V>>
  last: Record<ID, Page> | null
  keeps: (p: Page, o: Page) => boolean
}

function memoOf<V>(m: AncestryMemo<V>, pages: Record<ID, Page>): Map<ID, V> {
  let memo = m.byPages.get(pages)
  if (memo) return memo
  const prev = m.last ? m.byPages.get(m.last) : undefined
  memo = prev && sameShape(pages, m.last!, m.keeps) ? prev : new Map()
  m.byPages.set(pages, memo)
  m.last = pages
  return memo
}

/* "Effectively trashed": the page or any ancestor is in the trash. */
const trashedMemo: AncestryMemo<boolean> = { byPages: new WeakMap(), last: null, keeps: (p, o) => p.parentId === o.parentId && p.trashed === o.trashed }

function trashedLookup(pages: Record<ID, Page>): (id: ID) => boolean {
  const memo = memoOf(trashedMemo, pages)
  return (id) => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const chain: ID[] = []
    const seen = new Set<ID>()
    let result = false
    let cur: Page | undefined = pages[id]
    while (cur && !seen.has(cur.id)) {
      const k = memo.get(cur.id)
      if (k !== undefined) {
        result = k
        break
      }
      seen.add(cur.id)
      chain.push(cur.id)
      if (cur.trashed) {
        result = true
        break
      }
      cur = cur.parentId ? pages[cur.parentId] : undefined
    }
    for (const c of chain) memo.set(c, result)
    return result
  }
}

/** Is the page or any ancestor trashed? */
export function isEffectivelyTrashed(pages: Record<ID, Page>, id: ID): boolean {
  return trashedLookup(pages)(id)
}

/*
 * Templates (Page.template, features/templates): a template is a page subtree whose root carries
 * `template`. Its pages never show in normal use — sidebar, search, graph, agenda, reminders,
 * backlinks of other pages, recent, folder sync, agent context, exports all ask inTemplate().
 * Memoised per pages map like the trash lookup; top-level pages answer without the memo.
 */
const templateMemo: AncestryMemo<ID | null> = { byPages: new WeakMap(), last: null, keeps: (p, o) => p.parentId === o.parentId && !!p.template === !!o.template }

function templateLookup(pages: Record<ID, Page>): (id: ID) => ID | null {
  const memo = memoOf(templateMemo, pages)
  return (id) => {
    const page = pages[id]
    if (!page) return null
    if (page.template) return page.id
    if (!page.parentId) return null
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const chain: ID[] = []
    const seen = new Set<ID>()
    let result: ID | null = null
    let cur: Page | undefined = page
    while (cur && !seen.has(cur.id)) {
      const k = memo.get(cur.id)
      if (k !== undefined) {
        result = k
        break
      }
      if (cur.template) {
        result = cur.id
        break
      }
      seen.add(cur.id)
      chain.push(cur.id)
      cur = cur.parentId ? pages[cur.parentId] : undefined
    }
    for (const c of chain) memo.set(c, result)
    return result
  }
}

/** The root page id of the template a page belongs to (itself for a template root), else null. */
export function templateRootOf(pages: Record<ID, Page>, id: ID): ID | null {
  return templateLookup(pages)(id)
}

/** Is the page part of a template (its root or anything below it)? Such pages stay out of normal use. */
export function inTemplate(pages: Record<ID, Page>, id: ID): boolean {
  return templateLookup(pages)(id) !== null
}

/**
 * What a picker opened on page `near` may offer (link / mention / move targets, linked databases,
 * relation targets): every page outside templates, template pages only within near's own template.
 */
export function templateScope(pages: Record<ID, Page>, near: ID | null | undefined): (id: ID) => boolean {
  const lookup = templateLookup(pages)
  const own = near ? lookup(near) : null
  return (id) => {
    const tpl = lookup(id)
    return tpl === null || tpl === own
  }
}

/** Page ids a content links to, per (immutable) content object: a store change rescans only changed pages. */
const linksCache = new WeakMap<object, ReadonlySet<ID>>()
const NO_LINKS: ReadonlySet<ID> = new Set()

function linksOf(p: Page): ReadonlySet<ID> {
  if (!p.content) return NO_LINKS
  let hit = linksCache.get(p.content)
  if (!hit) {
    hit = new Set(linkedPageIds(p.content))
    linksCache.set(p.content, hit)
  }
  return hit
}

/**
 * Can a store change (prev → pages) have changed a per-page answer about `id` — a list of the pages
 * for which `relevant` holds (they link to it, mention it …), live ones only? Only through a page
 * that is or was relevant, a page that moved or went to / came back from the trash (the ancestry
 * that decides "live"), or a removed page. The page `id` itself never counts. Shared diff: cheap.
 */
export function mayChangeAnswer(pages: Record<ID, Page>, prev: Record<ID, Page>, id: ID, relevant: (p: Page) => boolean): boolean {
  const { changed, removed } = pageChanges(pages, prev)
  if (removed.length) return true
  for (const k of changed) {
    const p = pages[k]
    const o = prev[k]
    if (o && (o.trashed !== p.trashed || o.parentId !== p.parentId)) return true
    if (k !== id && (relevant(p) || (!!o && relevant(o)))) return true
  }
  return false
}

/** The last few answers (target → pages map it was computed for, answer): typing elsewhere reuses them. */
const backlinksMemo = new Map<ID, { pages: Record<ID, Page>; out: Page[] }>()

/**
 * Pages linking to `id` (via page links, mentions, links); pages in the trash (or under a trashed
 * parent) don't count, nor do template pages — except, for a template page, those of its own template.
 */
export function selectBacklinks(pages: Record<ID, Page>, id: ID): Page[] {
  const hit = backlinksMemo.get(id)
  if (hit && (hit.pages === pages || !mayChangeAnswer(pages, hit.pages, id, (p) => !!p.content && linksOf(p).has(id)))) {
    hit.pages = pages
    return hit.out
  }
  const trashed = trashedLookup(pages)
  const tplOf = templateLookup(pages)
  const ownTpl = tplOf(id)
  const out: Page[] = []
  for (const k of Object.keys(pages)) {
    const p = pages[k]
    if (p.id !== id && !p.trashed && p.content && linksOf(p).has(id) && !trashed(p.id) && tplOf(p.id) === ownTpl) out.push(p)
  }
  backlinksMemo.delete(id)
  backlinksMemo.set(id, { pages, out })
  if (backlinksMemo.size > 4) backlinksMemo.delete(backlinksMemo.keys().next().value!)
  return out
}

export function useBacklinks(id: ID | null | undefined): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => (id ? selectBacklinks(pages, id) : []), [pages, id])
}

/*
 * Workspace-wide counts and lists that views read on every store change (sidebar, status bar,
 * spec plate): ONE pass per pages map — the map is immutable, so the answer holds until the next
 * change — instead of an Object.values() scan per reader, selector run and keystroke. Lists keep
 * their identity while their members do, so readers do not re-render for unrelated edits.
 */
export interface PageStats {
  /** live rows per database */
  rows: Map<ID, number>
  /** sidebar tree pages (not trashed, rows or hidden): all of them / private ones / the others */
  tree: { all: number; priv: number; shared: number }
  /** any favourite that is not in the trash itself */
  hasFavorites: boolean
  /** favourites (not trashed, nor under a trashed parent), in tree order */
  favorites: Page[]
  /** pages in the trash, most recently trashed first */
  trash: Page[]
}

const statsCache = new WeakMap<Record<ID, Page>, PageStats>()
let lastStats: PageStats | null = null
let lastStatsPages: Record<ID, Page> | null = null
const sameList = (a: Page[], b: Page[] | undefined) => !!b && a.length === b.length && a.every((p, i) => p === b[i])

/** A changed page leaves the stats as they are: none of what they count, list or sort by changed. */
const statsKeep = (p: Page, o: Page) =>
  !p.favorite && !o.favorite && !p.trashed && !o.trashed && p.databaseId === o.databaseId && p.hidden === o.hidden && p.private === o.private && p.parentId === o.parentId && !!p.template === !!o.template

export function pageStats(pages: Record<ID, Page>): PageStats {
  const hit = statsCache.get(pages)
  if (hit) return hit
  // typing, a row property …: the last pass still holds (no walk over the page map)
  if (lastStats && lastStatsPages && sameShape(pages, lastStatsPages, statsKeep)) {
    statsCache.set(pages, lastStats)
    lastStatsPages = pages
    return lastStats
  }
  const rows = new Map<ID, number>()
  const tree = { all: 0, priv: 0, shared: 0 }
  let favs: Page[] = []
  let trash: Page[] = []
  // template pages (Page.template) are not in the tree: top-level ones answer without a walk
  const tplOf = templateLookup(pages)
  // Object.keys: for…in over a map of thousands of pages costs several times more
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.trashed) {
      trash.push(p)
      continue
    }
    if (p.favorite) favs.push(p)
    if (p.databaseId) rows.set(p.databaseId, (rows.get(p.databaseId) ?? 0) + 1)
    else if (!p.hidden && !(p.parentId && tplOf(id))) {
      tree.all++
      if (p.private) tree.priv++
      else tree.shared++
    }
  }
  const hasFavorites = favs.length > 0
  if (favs.length) {
    const trashed = trashedLookup(pages)
    favs = sortPages(favs.filter((p) => !trashed(p.id) && !tplOf(p.id)))
  }
  trash.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  if (sameList(favs, lastStats?.favorites)) favs = lastStats!.favorites
  if (sameList(trash, lastStats?.trash)) trash = lastStats!.trash
  const stats: PageStats = { rows, tree, hasFavorites, favorites: favs, trash }
  statsCache.set(pages, stats)
  lastStats = stats
  lastStatsPages = pages
  return stats
}

/** Live rows of a database. */
export function useRowCount(dbId: ID | null | undefined): number {
  return useWorkspace((s) => (dbId ? (pageStats(s.pages).rows.get(dbId) ?? 0) : 0))
}

/** Sidebar tree pages: all (null), my private ones (true) or the workspace's (false). */
export function useTreeCount(priv: boolean | null): number {
  return useWorkspace((s) => {
    const t = pageStats(s.pages).tree
    return priv === null ? t.all : priv ? t.priv : t.shared
  })
}

export function useHasFavorites(): boolean {
  return useWorkspace((s) => pageStats(s.pages).hasFavorites)
}

export function useFavorites(): Page[] {
  return useWorkspace((s) => pageStats(s.pages).favorites)
}

export function useTrash(): Page[] {
  return useWorkspace((s) => pageStats(s.pages).trash)
}

/** Display title with fallback. */
export function pageTitle(p: Page | undefined, untitled = 'Untitled'): string {
  return p?.title?.trim() || untitled
}
