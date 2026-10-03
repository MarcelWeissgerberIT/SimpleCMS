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

/*
 * "Effectively trashed" (the page or any ancestor is in the trash), memoised per pages map:
 * the map is immutable, so one answer per page id holds until the next store change.
 */
const trashedCache = new WeakMap<Record<ID, Page>, Map<ID, boolean>>()

function trashedLookup(pages: Record<ID, Page>): (id: ID) => boolean {
  let known = trashedCache.get(pages)
  if (!known) {
    known = new Map()
    trashedCache.set(pages, known)
  }
  const memo = known
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

/** Pages linking to `id` (via page links, mentions, links); pages in the trash (or under a trashed parent) don't count. */
export function selectBacklinks(pages: Record<ID, Page>, id: ID): Page[] {
  const hit = backlinksMemo.get(id)
  if (hit && (hit.pages === pages || !mayChangeAnswer(pages, hit.pages, id, (p) => !!p.content && linksOf(p).has(id)))) {
    hit.pages = pages
    return hit.out
  }
  const trashed = trashedLookup(pages)
  const out: Page[] = []
  for (const k of Object.keys(pages)) {
    const p = pages[k]
    if (p.id !== id && !p.trashed && p.content && linksOf(p).has(id) && !trashed(p.id)) out.push(p)
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
const sameList = (a: Page[], b: Page[] | undefined) => !!b && a.length === b.length && a.every((p, i) => p === b[i])

export function pageStats(pages: Record<ID, Page>): PageStats {
  const hit = statsCache.get(pages)
  if (hit) return hit
  const rows = new Map<ID, number>()
  const tree = { all: 0, priv: 0, shared: 0 }
  let favs: Page[] = []
  let trash: Page[] = []
  // Object.keys: for…in over a map of thousands of pages costs several times more
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.trashed) {
      trash.push(p)
      continue
    }
    if (p.favorite) favs.push(p)
    if (p.databaseId) rows.set(p.databaseId, (rows.get(p.databaseId) ?? 0) + 1)
    else if (!p.hidden) {
      tree.all++
      if (p.private) tree.priv++
      else tree.shared++
    }
  }
  const hasFavorites = favs.length > 0
  if (favs.length) {
    const trashed = trashedLookup(pages)
    favs = sortPages(favs.filter((p) => !trashed(p.id)))
  }
  trash.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  if (sameList(favs, lastStats?.favorites)) favs = lastStats!.favorites
  if (sameList(trash, lastStats?.trash)) trash = lastStats!.trash
  const stats: PageStats = { rows, tree, hasFavorites, favorites: favs, trash }
  statsCache.set(pages, stats)
  lastStats = stats
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
