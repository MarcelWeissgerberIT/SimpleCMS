/**
 * Locked databases (Database.locked — Notion's "Lock database").
 *
 * Locked = the structure is fixed: properties can't be added, renamed, retyped, deleted or
 * reordered (select options can't be created or edited either), and views can't be added, renamed,
 * deleted, reordered or reconfigured (layout, grouping, visible properties, widths, calculations,
 * colour rules, sub-items, dependencies, form questions). Rows stay editable: values, new rows,
 * templates, automations.
 *
 * Filters and sorts still work, like in Notion — but only for this tab: on a locked database they
 * go into a session overlay (useSessionQuery, by view id) and are never saved. Locking and
 * unlocking start the overlay over from the saved view.
 *
 * Anyone who can edit locks / unlocks with one click (the toolbar plate, the "…" menu); viewers of a
 * team workspace see the same plate. The flag syncs like any other database key (docs/CLOUD.md:
 * "any other Database key … JSON").
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import type { FilterGroup, ID, Sort, View } from '../../store/types'
import { isDbReadOnly } from '../readonly'

export const isDbLocked = (dbId: ID | null | undefined): boolean => !!dbId && useWorkspace.getState().databases[dbId]?.locked === true

export interface ViewQuery {
  filter?: FilterGroup | null
  sorts?: Sort[]
}

/** Filters / sorts of locked databases' views, for this tab only (by view id). */
export const useSessionQuery = create<Record<ID, ViewQuery>>(() => ({}))

/** This tab's filter / sorts of a view while its database is locked (undefined = the saved ones). */
export function useSessionOverlay(dbId: ID, viewId: ID | undefined): ViewQuery | undefined {
  const locked = useWorkspace((s) => s.databases[dbId]?.locked === true)
  const q = useSessionQuery((s) => (viewId ? s[viewId] : undefined))
  return locked ? q : undefined
}

/** The view as this tab shows it. */
export function withOverlay(view: View, q: ViewQuery | undefined): View {
  return q ? { ...view, ...q } : view
}

/** The filter and sorts a view shows right now (saved, or this tab's on a locked database). */
export function currentQuery(dbId: ID, viewId: ID): { filter: FilterGroup | null; sorts: Sort[] } {
  const v = useWorkspace.getState().databases[dbId]?.views.find((x) => x.id === viewId)
  const q = isDbLocked(dbId) ? useSessionQuery.getState()[viewId] : undefined
  return {
    filter: q && 'filter' in q ? (q.filter ?? null) : (v?.filter ?? null),
    sorts: q?.sorts ?? v?.sorts ?? [],
  }
}

/** Change a view's filter / sorts: saved for everyone — on a locked database for this tab only. */
export function setViewQuery(dbId: ID, viewId: ID, patch: ViewQuery): void {
  if (isDbLocked(dbId)) useSessionQuery.setState((s) => ({ ...s, [viewId]: { ...s[viewId], ...patch } }))
  else useWorkspace.getState().updateView(dbId, viewId, patch)
}

/** Drop this tab's filters / sorts of a database's views (back to the saved ones). */
export function resetSessionQuery(dbId: ID): void {
  const ids = (useWorkspace.getState().databases[dbId]?.views ?? []).map((v) => v.id)
  const cur = useSessionQuery.getState()
  if (!ids.some((id) => id in cur)) return
  const next = { ...cur }
  for (const id of ids) delete next[id]
  useSessionQuery.setState(next, true)
}

/** Lock / unlock a database (anyone who can edit). */
export function setDbLocked(dbId: ID, locked: boolean): void {
  if (isDbReadOnly()) return
  const s = useWorkspace.getState()
  if (!s.databases[dbId] || (s.databases[dbId].locked === true) === locked) return
  s.updateDatabase(dbId, { locked })
  resetSessionQuery(dbId)
}
