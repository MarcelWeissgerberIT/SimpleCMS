/**
 * FAVORITES — which pages are favourites stays `Page.favorite` (written only by the store's toggleFavorite: the page
 * record locally, this device's overlay in a team — never the shared document). This module keeps their ORDER, per device
 * and workspace: localStorage `one.shell.favorder:<kind>:<id>` = ID[] (≤ 500; never synced, exported or backed up; the
 * local reset wipes it with the prefix one.shell., a team workspace's copy takes it along, cloud/device.ts).
 *
 * The list is written only on a person's action — toggleStar, placeFavorite, moveFavorite and the removal's Undo — never
 * from a render. It keeps the ids of favourites hidden right now (under a trashed parent): a Restore brings them back to
 * their slot. A write prunes only ids whose page is gone or no longer a favourite. Favourites the list lacks (starred by
 * an older build, a backup restore, another path) follow the placed ones in title order.
 *
 * Every star in the app goes through toggleStar(): the topbar ☆, a row's ☆, the row and page menus, ⌘K and a drop.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { pageStats, useFavorites } from '../../store/selectors'
import { activeWorkspace, useCloud, type WorkspaceRef } from '../../cloud'
import { currentLang, t } from '../../i18n'
import type { ID, Page } from '../../store/types'

export const favOrderKey = (scope: string) => `one.shell.favorder:${scope}`
const scopeOf = (ref: WorkspaceRef) => `${ref.kind}:${ref.id}`
const MAX = 500
/** how long a new favourite's row lights up (sidebar.css `sb-fav-flash`) */
const FLASH_MS = 700

function read(scope: string): ID[] {
  try {
    const v: unknown = JSON.parse(safeLocalGet(favOrderKey(scope)) ?? '[]')
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80))].slice(0, MAX) : []
  } catch {
    return []
  }
}

interface FavOrder {
  /** `<kind>:<id>` of the workspace the order belongs to */
  scope: string
  order: ID[]
  /** the favourite just added (its row lights up once) */
  flash: ID | null
}

export const useFavOrder = create<FavOrder>()(() => {
  const scope = scopeOf(activeWorkspace())
  return { scope, order: read(scope), flash: null }
})

if (typeof window !== 'undefined') {
  // another tab placed a favourite: the same order here
  window.addEventListener('storage', (e) => {
    const { scope } = useFavOrder.getState()
    if (e.key === null || e.key === favOrderKey(scope)) useFavOrder.setState({ order: read(scope) })
    if (e.key === null || e.key === 'one.shell.sections') useFavFold.setState({ open: readSections(safeLocalGet('one.shell.sections')).fav })
  })
  useCloud.subscribe((c, prev) => {
    if (c.active === prev.active) return
    const scope = scopeOf(c.active)
    useFavOrder.setState({ scope, order: read(scope), flash: null })
  })
}

const ws = () => useWorkspace.getState()

function write(order: ID[]): void {
  const next = [...new Set(order)].slice(0, MAX)
  useFavOrder.setState({ order: next })
  safeLocalSet(favOrderKey(useFavOrder.getState().scope), JSON.stringify(next))
}

const titleOrder = (a: Page, b: Page) => (a.title.trim() || '￿').localeCompare(b.title.trim() || '￿', currentLang(), { numeric: true, sensitivity: 'base' })

/** The favourites FAVORITES shows (`favs`: pageStats' live ones) in this device's order: placed ones, then the rest by title. */
export function orderFavorites(favs: readonly Page[], order: readonly ID[]): ID[] {
  const live = new Set(favs.map((p) => p.id))
  const placed = order.filter((id) => live.has(id))
  const known = new Set(placed)
  return [...placed, ...favs.filter((p) => !known.has(p.id)).sort(titleOrder).map((p) => p.id)]
}

/** The favourites as the section shows them now (outside React: a drop, a key). */
export function shownFavorites(): ID[] {
  return orderFavorites(pageStats(ws().pages).favorites, useFavOrder.getState().order)
}

export function useOrderedFavorites(): ID[] {
  const favs = useFavorites()
  const order = useFavOrder((s) => s.order)
  return useMemo(() => orderFavorites(favs, order), [favs, order])
}

/**
 * The list to write: the stored order (pages gone or no longer favourites pruned), then every favourite it lacks — shown
 * or hidden — by title. Its shown part is exactly what orderFavorites() shows. One walk, on a person's action only.
 */
function fullOrder(): ID[] {
  const pages = ws().pages
  const stored = useFavOrder.getState().order.filter((id) => pages[id]?.favorite)
  const have = new Set(stored)
  const missing: Page[] = []
  for (const id of Object.keys(pages)) if (pages[id].favorite && !have.has(id)) missing.push(pages[id])
  return [...stored, ...missing.sort(titleOrder).map((p) => p.id)]
}

/** Put `id` before `beforeId` in the written list (null: at the end). */
function reorder(id: ID, beforeId: ID | null): void {
  const list = fullOrder().filter((x) => x !== id)
  const at = beforeId ? list.indexOf(beforeId) : -1
  list.splice(at < 0 ? list.length : at, 0, id)
  write(list)
}

function flash(id: ID): void {
  useFavOrder.setState({ flash: id })
  window.setTimeout(() => {
    if (useFavOrder.getState().flash === id) useFavOrder.setState({ flash: null })
  }, FLASH_MS)
}

/** Make `id` a favourite (if it is not one yet) and put it before `beforeId` among the favourites (null: at the end). */
export function placeFavorite(id: ID, beforeId: ID | null): void {
  const page = ws().pages[id]
  if (!page || page.trashed) return
  const added = !page.favorite
  if (added) ws().toggleFavorite(id)
  reorder(id, beforeId === id ? null : beforeId)
  if (added) flash(id)
}

/**
 * One place up (-1) or down (+1) among the favourites shown. Returns the new position (0-based) and the count, or null
 * when it cannot move (the first one up, the last one down, not shown).
 */
export function moveFavorite(id: ID, delta: -1 | 1): { at: number; of: number } | null {
  const shown = shownFavorites()
  const i = shown.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= shown.length) return null
  const rest = shown.filter((x) => x !== id)
  // before the favourite that will follow it (the end when none does)
  reorder(id, rest[j] ?? null)
  return { at: j, of: shown.length }
}

/** Not a favourite any more — with a toast whose Undo puts it back where it was (flag and slot). */
export function unstarWithUndo(id: ID): void {
  const page = ws().pages[id]
  if (!page?.favorite) return
  const before = fullOrder()
  const at = before.indexOf(id)
  ws().toggleFavorite(id)
  write(before.filter((x) => x !== id))
  useUI.getState().toast({
    message: t('shell.fav.removed', { title: page.title.trim() || t('common.untitled') }),
    action: {
      label: t('common.undo'),
      undo: true,
      run: () => {
        const p = ws().pages[id]
        if (!p || p.trashed) return
        if (!p.favorite) ws().toggleFavorite(id)
        const list = fullOrder().filter((x) => x !== id)
        // back before the favourite that followed it then (if it still is one), else at the end
        const next = at < 0 ? undefined : before.slice(at + 1).find((x) => list.includes(x))
        list.splice(next ? list.indexOf(next) : list.length, 0, id)
        write(list)
      },
    },
  })
}

/* ---------------- FAVORITES folded or open (this device: localStorage `one.shell.sections` = { fav }) ---------------- */

const SECTIONS_KEY = 'one.shell.sections'

/** This device's section prefs: FAVORITES unfolded (`fav`, default true) — anything odd reads as the default. */
export function readSections(raw: string | null): { fav: boolean } {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null
    const p = (v && typeof v === 'object' ? v : {}) as { fav?: unknown }
    return { fav: typeof p.fav === 'boolean' ? p.fav : true }
  } catch {
    return { fav: true }
  }
}

/** FAVORITES unfolded? (its rows show — the tree's copy of an open favourite then leaves the bar to them) */
export const useFavFold = create<{ open: boolean }>()(() => ({ open: readSections(safeLocalGet(SECTIONS_KEY)).fav }))

export function setFavFold(open: boolean): void {
  useFavFold.setState({ open })
  let rest: Record<string, unknown> = {}
  try {
    const v: unknown = JSON.parse(safeLocalGet(SECTIONS_KEY) ?? '{}')
    if (v && typeof v === 'object') rest = v as Record<string, unknown>
  } catch {
    /* anything odd: start over */
  }
  safeLocalSet(SECTIONS_KEY, JSON.stringify({ ...rest, fav: open }))
}

/** The star — every way in: on → a favourite at the end of the list, off → out of it (toast with Undo). */
export function toggleStar(id: ID): void {
  const page = ws().pages[id]
  if (!page) return
  if (page.favorite) unstarWithUndo(id)
  else placeFavorite(id, null)
}
