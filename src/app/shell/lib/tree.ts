/**
 * Sidebar tree helpers: a memoised parent → children index over the page map (rebuilt only
 * when a store change moves, adds, removes or hides pages; O(1) per node), a database's entries
 * (computed only for databases the tree shows open, kept per database) and the per-viewer
 * expanded state.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { pageChanges, useWorkspace } from '../../store/store'
import type { Database, ID, Page } from '../../store/types'
import { entryOrder, parentIdOf, subItemsOf } from '../../database'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

const ROOT = '__root__'
const EMPTY: ID[] = []

let lastPages: Record<ID, Page> | null = null
let lastMap = new Map<string, ID[]>()

/** What the tree is built from: an edit that changes none of it (typing, a row property) keeps the tree. */
const treeFieldsDiffer = (a: Page, b: Page) =>
  a.parentId !== b.parentId || a.order !== b.order || a.createdAt !== b.createdAt || a.trashed !== b.trashed || a.databaseId !== b.databaseId || a.hidden !== b.hidden

/** None of the pages moved, appeared, disappeared or changed visibility? (the store's shared diff) */
function sameTree(pages: Record<ID, Page>, prev: Record<ID, Page>): boolean {
  const { changed, removed } = pageChanges(pages, prev)
  if (removed.length) return false
  for (const id of changed) {
    const o = prev[id]
    if (!o || treeFieldsDiffer(pages[id], o)) return false
  }
  return true
}

/** Visible tree children (not trashed, not database rows, not hidden), sorted. */
export function childMap(pages: Record<ID, Page>): Map<string, ID[]> {
  if (pages === lastPages) return lastMap
  if (lastPages && sameTree(pages, lastPages)) {
    lastPages = pages
    return lastMap
  }
  const groups = new Map<string, Page[]>()
  for (const p of Object.values(pages)) {
    if (p.trashed || p.databaseId || p.hidden) continue
    const key = p.parentId ?? ROOT
    const arr = groups.get(key)
    if (arr) arr.push(p)
    else groups.set(key, [p])
  }
  const map = new Map<string, ID[]>()
  for (const [k, arr] of groups) map.set(k, arr.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt).map((p) => p.id))
  lastPages = pages
  lastMap = map
  return map
}

export function childIds(pages: Record<ID, Page>, parentId: ID | null): ID[] {
  return childMap(pages).get(parentId ?? ROOT) ?? EMPTY
}

export function useChildIds(parentId: ID | null): ID[] {
  return useWorkspace(useShallow((s) => childIds(s.pages, parentId)))
}

/* ---------------- database entries (rows) ---------------- */

/** Entries a list shows before its "show all" key (the open page's own entry is shown on top of these). */
export const ENTRY_LIMIT = 20

interface EntryIndex {
  /** top-level entries (with sub-items on: rows without a parent row), in the first view's order */
  roots: ID[]
  /** sub-item rows by parent row, same order (sub-items on only) */
  sub: Map<ID, ID[]>
}

interface EntryCache {
  pages: Record<ID, Page>
  db: Database
  rows: Map<ID, Page>
  index: EntryIndex
}

const NO_SUB = new Map<ID, ID[]>()
const entryCache = new Map<ID, EntryCache>()

/** A row the tree lists under its database (template roots and hidden rows never show). */
const isEntry = (p: Page | undefined, dbId: ID): p is Page => !!p && p.databaseId === dbId && !p.trashed && !p.hidden && !p.template

/**
 * Which row edits can change the order: 'order' (manual order only), 'values' (+ property values and
 * titles: the view sorts by stored values, or sub-items nest by their parent link), 'all' (the view sorts
 * by something computed — formula, rollup, last edited).
 */
function sensitivity(db: Database): 'order' | 'values' | 'all' {
  const view = db.views[0]
  const sorts = view && Array.isArray(view.sorts) ? view.sorts : []
  const keys = sorts.length ? sorts.map((x) => x.propertyId) : view?.type === 'feed' && view.feed?.dateProperty ? [view.feed.dateProperty] : []
  const types = keys.map((id) => db.properties.find((p) => p.id === id)?.type)
  if (types.some((t) => t === 'formula' || t === 'rollup' || t === 'last_edited_time' || t === 'last_edited_by')) return 'all'
  return types.some(Boolean) || subItemsOf(db) ? 'values' : 'order'
}

function buildIndex(pages: Record<ID, Page>, db: Database, rows: Map<ID, Page>): EntryIndex {
  const ordered = entryOrder(db.id, [...rows.values()])
  const pair = subItemsOf(db)
  if (!pair) return { roots: ordered.map((p) => p.id), sub: NO_SUB }
  const roots: ID[] = []
  const sub = new Map<ID, ID[]>()
  for (const row of ordered) {
    const parent = parentIdOf(pages, pair, row)
    if (!parent || !rows.has(parent)) roots.push(row.id)
    else {
      const list = sub.get(parent)
      if (list) list.push(row.id)
      else sub.set(parent, [row.id])
    }
  }
  // rows a parent loop keeps away from every top-level row show at the top level (and nowhere else)
  const reached = new Set<ID>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    stack.push(...(sub.get(id) ?? []))
  }
  if (reached.size < ordered.length) {
    const stray = new Set(ordered.filter((r) => !reached.has(r.id)).map((r) => r.id))
    roots.push(...stray)
    for (const [k, list] of sub) sub.set(k, list.filter((id) => !stray.has(id)))
  }
  return { roots, sub }
}

/**
 * The entries of a database, kept per database: a store change only re-sorts when it adds, removes or
 * moves a row of this database, or edits what the order depends on (see sensitivity) — no walk over
 * the page map after the first build (the store's shared diff says what changed).
 */
function entryIndex(pages: Record<ID, Page>, db: Database): EntryIndex {
  const hit = entryCache.get(db.id)
  if (hit && hit.pages === pages && hit.db === db) return hit.index
  if (!hit) {
    const rows = new Map<ID, Page>()
    for (const id of Object.keys(pages)) if (isEntry(pages[id], db.id)) rows.set(id, pages[id])
    const index = buildIndex(pages, db, rows)
    entryCache.set(db.id, { pages, db, rows, index })
    return index
  }
  let dirty = hit.db !== db
  if (hit.pages !== pages) {
    const sens = sensitivity(db)
    const { changed, removed } = pageChanges(pages, hit.pages)
    for (const id of removed) if (hit.rows.delete(id)) dirty = true
    for (const id of changed) {
      const p = pages[id]
      const was = hit.rows.get(id)
      if (isEntry(p, db.id)) {
        hit.rows.set(id, p)
        if (!was || sens === 'all' || p.order !== was.order || p.createdAt !== was.createdAt || (sens === 'values' && (p.properties !== was.properties || p.title !== was.title))) dirty = true
      } else if (was) {
        hit.rows.delete(id)
        dirty = true
      }
    }
  }
  hit.pages = pages
  hit.db = db
  if (dirty) hit.index = buildIndex(pages, db, hit.rows)
  return hit.index
}

type TreeSlice = { pages: Record<ID, Page>; databases: Record<ID, Database> }

/** All entries of one list: a database's top level (parentRow null) or a row's sub-items. */
function entryList(s: TreeSlice, dbId: ID, parentRow: ID | null): ID[] {
  const db = s.databases[dbId]
  if (!db || (parentRow && !subItemsOf(db))) return EMPTY
  const index = entryIndex(s.pages, db)
  return parentRow ? (index.sub.get(parentRow) ?? EMPTY) : index.roots
}

/** Where a page sits in the tree: a sub-item under its parent row, a row under its database, else its parent page. */
export function treeParentId(s: TreeSlice, p: Page): ID | null {
  if (p.databaseId && s.databases[p.databaseId]) {
    const pair = subItemsOf(s.databases[p.databaseId])
    const up = pair ? parentIdOf(s.pages, pair, p) : null
    if (up && isEntry(s.pages[up], p.databaseId)) return up
  }
  return p.parentId
}

/** Tree ancestors of a page, top-level first (cycle-safe). */
export function treeAncestors(s: TreeSlice, id: ID): Page[] {
  const out: Page[] = []
  const seen = new Set<ID>([id])
  let up = s.pages[id] ? treeParentId(s, s.pages[id]) : null
  while (up && !seen.has(up) && s.pages[up]) {
    seen.add(up)
    out.unshift(s.pages[up])
    up = treeParentId(s, s.pages[up])
  }
  return out
}

/**
 * The entries a list shows: the first ENTRY_LIMIT, plus — further down the list — the entry that holds
 * the open page (so the open page stays visible in the tree). Computed only while the list is mounted.
 */
export function useEntryIds(dbId: ID, parentRow: ID | null, openId: ID | null): ID[] {
  return useWorkspace(
    useShallow((s) => {
      const all = entryList(s, dbId, parentRow)
      if (all.length <= ENTRY_LIMIT) return all
      const shown = all.slice(0, ENTRY_LIMIT)
      if (openId && s.pages[openId]) {
        const chain = new Set([openId, ...treeAncestors(s, openId).map((p) => p.id)])
        for (let i = ENTRY_LIMIT; i < all.length; i++) if (chain.has(all[i])) shown.push(all[i])
      }
      return shown
    }),
  )
}

/** How many entries a list has (its "show all" count). */
export function useEntryTotal(dbId: ID, parentRow: ID | null): number {
  return useWorkspace((s) => entryList(s, dbId, parentRow).length)
}

/** Sub-item rows below an entry (0 without sub-items, or for anything else). */
export function useSubEntryCount(dbId: ID | null, rowId: ID): number {
  return useWorkspace((s) => (dbId ? entryList(s, dbId, rowId).length : 0))
}

/* ---------------- expanded state (localStorage, per viewer) ---------------- */

const KEY = 'one.shell.expanded'

function loadExpanded(): Record<string, true> {
  try {
    const raw = safeLocalGet(KEY)
    return raw ? (JSON.parse(raw) as Record<string, true>) : {}
  } catch {
    return {}
  }
}

interface TreeState {
  expanded: Record<string, true>
  toggle: (key: string) => void
  expand: (keys: string[]) => void
  collapse: (key: string) => void
}

export const useTreeState = create<TreeState>()((set, get) => {
  const persist = () => safeLocalSet(KEY, JSON.stringify(get().expanded))
  return {
    expanded: loadExpanded(),
    toggle: (key) => {
      set((s) => {
        const next = { ...s.expanded }
        if (next[key]) delete next[key]
        else next[key] = true
        return { expanded: next }
      })
      persist()
    },
    expand: (keys) => {
      if (keys.every((k) => get().expanded[k])) return
      set((s) => {
        const next = { ...s.expanded }
        for (const k of keys) next[k] = true
        return { expanded: next }
      })
      persist()
    },
    collapse: (key) => {
      if (!get().expanded[key]) return
      set((s) => {
        const next = { ...s.expanded }
        delete next[key]
        return { expanded: next }
      })
      persist()
    },
  }
})

export const treeKey = (section: string, id: ID) => `${section}:${id}`
