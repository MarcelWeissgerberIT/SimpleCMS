/** Read hooks and pure selectors over the workspace store. */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace, linkedPageIds } from './store'
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

/** Is the page or any ancestor trashed? */
export function isEffectivelyTrashed(pages: Record<ID, Page>, id: ID): boolean {
  return selectBreadcrumbs(pages, id).some((p) => p.trashed)
}

/** Pages linking to `id` (via page links, mentions, links). */
export function selectBacklinks(pages: Record<ID, Page>, id: ID): Page[] {
  return Object.values(pages).filter((p) => !p.trashed && p.id !== id && linkedPageIds(p.content).includes(id))
}

export function useBacklinks(id: ID | null | undefined): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => (id ? selectBacklinks(pages, id) : []), [pages, id])
}

export function useFavorites(): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => sortPages(Object.values(pages).filter((p) => p.favorite && !p.trashed)), [pages])
}

export function useTrash(): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(
    () => Object.values(pages).filter((p) => p.trashed).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)),
    [pages],
  )
}

/** Display title with fallback. */
export function pageTitle(p: Page | undefined, untitled = 'Untitled'): string {
  return p?.title?.trim() || untitled
}
