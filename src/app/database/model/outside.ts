/**
 * A database from outside its page (database commands in the sidebar and ⌘K, features/commands):
 * which view its page shows, opening it on a view, exporting a view as CSV.
 */
import type { ID, Page } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { openPage } from '../../lib/router'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { t } from '../../i18n'
import { Resolver } from './resolve'
import { workspaceCtx } from './ctx'
import { viewRows } from './ics'
import { exportCsv } from './actions'
import { propMapOf } from './recordTypes'

/** The localStorage key of the view a database's own page shows (DatabaseView, useLocalState). */
export const pageViewKey = (dbId: ID) => `one.db.view.${dbId}.page`

/** Window event: show this view on the database's page if it is open ({ dbId, viewId }). */
export const VIEW_REQUEST = 'one:db-view'

/** The view the database's page shows (the last one picked there), else its first. */
export function pageViewId(dbId: ID): ID | null {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return null
  try {
    const id = JSON.parse(safeLocalGet(pageViewKey(dbId)) ?? 'null')
    if (typeof id === 'string' && db.views.some((v) => v.id === id)) return id
  } catch {
    /* the first view */
  }
  return db.views[0]?.id ?? null
}

/** Open the database's page on a view (switches the view when the page is open already). */
export function openDatabaseView(dbId: ID, viewId: ID): boolean {
  const db = useWorkspace.getState().databases[dbId]
  if (!db?.views.some((v) => v.id === viewId)) return false
  safeLocalSet(pageViewKey(dbId), JSON.stringify(viewId))
  window.dispatchEvent(new CustomEvent(VIEW_REQUEST, { detail: { dbId, viewId } }))
  openPage(dbId)
  return true
}

/**
 * Export a view as CSV (a download): its rows (filters + order) with the title and its shown columns.
 * `viewId` null → the view its page shows. Returns the number of rows, null when there is no such database.
 */
export function exportDatabaseCsv(dbId: ID, viewId: ID | null = null): number | null {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const page = s.pages[dbId]
  if (!db || !page) return null
  const id = viewId ?? pageViewId(dbId)
  const view = db.views.find((v) => v.id === id) ?? db.views[0]
  const r = new Resolver(workspaceCtx())
  const all = Object.values(s.pages)
    .filter((p): p is Page => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  const rows = view ? viewRows(r, db, view, all) : all
  const byId = propMapOf(db)
  const title = db.properties.find((p) => p.type === 'title')
  const shown = view ? view.visibleProperties.map((pid) => byId.get(pid)).filter((p) => !!p && p.type !== 'title') : db.properties.filter((p) => p.type !== 'title')
  const props = [...(title ? [title] : []), ...shown.filter((p): p is NonNullable<typeof p> => !!p)]
  exportCsv(r, db, props, rows, page.title.trim() || t('common.untitled'))
  return rows.length
}
