/**
 * The page search of "@" and "one:" — ONE ranking for the editor's menus (MentionMenu, RefMenu) and every other field
 * that points at a page the same way (coding answers, coding/RefField.tsx): live pages only (trashed ones and their
 * subtrees left out), template pages only from a page of the same template (`near`), never `near` itself. A query
 * ranks fuzzy title matches, those whose title (or a word of it) starts with the query first.
 */
import Fuse from 'fuse.js'
import type { ID, Page } from '../../store/types'
import { templateScope } from '../../store/selectors'
import { liveIds } from './livePages'

export interface PageSearch {
  query: string
  /** the page the search is made from (left out; its template decides which template pages show) */
  near: ID | null
  /** liveIds(pages) — compute it once when the menu opens */
  live?: ReadonlySet<ID>
  /** more pages to leave out (e.g. private pages where their title must not travel) */
  skip?: (p: Page) => boolean
}

const FUSE = { keys: ['title'], threshold: 0.38, ignoreLocation: true }

/** Fuzzy title matches; a title that starts with the query, then one with a word that does, before the rest. */
function byQuery(list: Page[], q: string): Page[] {
  const lq = q.toLowerCase()
  const at = (p: Page) => {
    const title = p.title.trim().toLowerCase()
    return title.startsWith(lq) ? 0 : title.includes(` ${lq}`) ? 1 : 2
  }
  return new Fuse(list, FUSE)
    .search(q)
    .map((r, i) => [r.item, at(r.item), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([p]) => p)
}

function candidates(pages: Record<ID, Page>, s: PageSearch): Page[] {
  const live = s.live ?? liveIds(pages)
  const scope = templateScope(pages, s.near)
  return Object.values(pages).filter((p) => live.has(p.id) && p.id !== s.near && scope(p.id) && !s.skip?.(p))
}

/** "@": pages and entries by title (fuzzy); without a query the recently opened first (`recent`), then the newest. */
export function mentionPages(pages: Record<ID, Page>, recent: readonly ID[], s: PageSearch): Page[] {
  const list = candidates(pages, s)
  const q = s.query.trim()
  if (q) return byQuery(list, q)
  return [...list].sort((a, b) => {
    const ra = recent.indexOf(a.id)
    const rb = recent.indexOf(b.id)
    return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || b.updatedAt - a.updatedAt
  })
}

export type RefSection = 'level' | 'inside' | 'search'

/**
 * "one:": those on the same level as `near` (same parent or database) first, then those inside it, then (with a query)
 * a title search over every other page and entry — at most `per` of each.
 */
export function refPages(pages: Record<ID, Page>, s: PageSearch, per = 6): Array<{ section: RefSection; page: Page }> {
  const list = candidates(pages, s)
  const here = s.near ? pages[s.near] : undefined
  const q = s.query.trim()
  const byTitle = (xs: Page[]) => (q ? byQuery(xs, q) : [...xs].sort((a, b) => b.updatedAt - a.updatedAt))
  const level = byTitle(list.filter((p) => !!here && p.parentId === here.parentId)).slice(0, per)
  const inside = byTitle(list.filter((p) => !!s.near && p.parentId === s.near)).slice(0, per)
  const seen = new Set([...level, ...inside].map((p) => p.id))
  const search = q ? byTitle(list.filter((p) => !seen.has(p.id))).slice(0, per) : []
  return [...level.map((page) => ({ section: 'level' as const, page })), ...inside.map((page) => ({ section: 'inside' as const, page })), ...search.map((page) => ({ section: 'search' as const, page }))]
}
