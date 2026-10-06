/**
 * DATABASE AREA — public API (contract). Other areas import ONLY from this file.
 *  - DatabaseView: full database UI (view tabs, toolbar, table/board/list/gallery/calendar/timeline/chart/form).
 *      inline=true renders a compact embedded variant (used by the editor's databaseBlock node).
 *  - RowProperties: the property panel shown at the top of a row page.
 *  - propertyValueToText: plain-text rendering of a property value (search, export, AI context).
 *  - SharedFormView: the public page of a shared form (route #/f/<payload>; lazy-loaded inside).
 */
import type { ID, Page } from '../store/types'
import { useWorkspace } from '../store/store'
import { Resolver } from './model/resolve'
import { workspaceCtx } from './model/ctx'
import { orderRows } from './model/feed'
import { defaultsFromFilter } from './model/query'
import { resolveMe } from './model/actors'
import { isDbReadOnly } from './readonly'
import { createTypedRow, typeColumn } from './model/recordTypes'
export { DatabaseView, type DatabaseViewProps } from './DatabaseView'
export { RowProperties } from './RowProperties'
export { propertyValueToText } from './values'
/** propertyFormulaValue(db, prop, row): a row's value as formulas see it (option / people names, related titles, Date; computed ones included) — features/script */
export { propertyFormulaValue } from './values'
/** writePropertyValue(dbId, prop, rowId, value): write one value the way a cell does (two-way relations kept in step) — version history's restore. */
export { writeValue as writePropertyValue } from './model/actions'
/** TypeIcon: the lucide glyph of a property type (features/ai/todb lists the columns it will create). */
export { TypeIcon } from './parts'
/** rowsOfView: rows of a view as it shows them (its filters + sorts) — for exports outside React. */
export { rowsOfView } from './model/ics'
export { SharedFormView } from './form/public'
/**
 * Properties created on the fly (also for the workspace agent / MCP tools):
 *  - createPropertyQuick(dbId, { name, type, relation?: { databaseId, twoWay?, reverseName? }, options?, numberFormat? },
 *      { toast? }) → the new PropertyDef (null: locked, view only, bad target). Default: an undo toast.
 *  - createPropertiesQuick(dbId, inputs) (no toast) · dropCreated(dbId, props) (their undo) ·
 *    canCreateProperties(dbId) · propertyByName(db, name) · freePropertyName(db, name)
 *  - CreatePropertyDialog: the short dialog (name · type · relation target + two-way) — render it yourself.
 *  - CreatePropertiesDialog: several fields at once ("check": create or not · "map": create / existing / skip).
 *  - PAGE_MENTIONED: window event the editor fires after inserting a page mention or a link to a page ({ from, to } page ids);
 *      row pages answer with the "link as relation?" offer.
 */
export { createPropertyQuick, createPropertiesQuick, dropCreated, canCreateProperties, propertyByName, freePropertyName, type QuickProperty } from './create/quick'
export { CreatePropertyDialog, type CreatePropertyDialogProps } from './create/CreatePropertyDialog'
export { CreatePropertiesDialog, DATA_TYPES, type CreatePropertiesDialogProps, type PropertySuggestion, type SuggestionResult } from './create/CreatePropertiesDialog'
export { PAGE_MENTIONED } from './create/RelationOffer'
/** NONE_KEY: the group key of a board's "No value" column (View.hiddenGroups). */
export { NONE_KEY } from './model/query'
/**
 * Chart series of a database (features/charts `chart` blocks with a database source): rows after a view's
 * filters, grouped by x (options in order + colour, date buckets day … year with gaps filled), count / sum /
 * avg / min / max of a number, optionally split into series. chartGroupable / chartMeasurable: pickable properties.
 */
export {
  databaseChartData,
  chartGroupable,
  chartMeasurable,
  bucketLabel,
  type DatabaseChartInput,
  type DatabaseChartResult,
  type DatabaseChartAggregate,
  type DatabaseChartBucket,
} from './model/chartData'

/**
 * A database's entries outside its views (the sidebar tree, shell/lib/tree.ts):
 *  - entryOrder(dbId, rows): the rows in the order the database's FIRST view shows them (its sorts, a feed's
 *      date order), unfiltered; without sorts: manual order, then created.
 *  - createEntry(dbId, { title?, templateId? }): a new row with the first view's presets (from its filters) — what the
 *      view's "New" button creates; templateId: from that row template. null: view only, or no such database.
 *  - subItemsOf(db) / parentIdOf(pages, pair, row): the sub-items hierarchy ("Parent item" ↔ "Sub-items").
 */
export { subItemsOf, parentIdOf, type SubItemsPair } from './model/hierarchy'

export function entryOrder(dbId: ID, rows: Page[]): Page[] {
  const base = [...rows].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  const db = useWorkspace.getState().databases[dbId]
  const view = db?.views[0]
  if (!db || !view) return base
  try {
    return orderRows(new Resolver(workspaceCtx()), db, view, base, new Map([...db.properties, typeColumn(db, useWorkspace.getState().kit)].map((p) => [p.id, p])))
  } catch {
    return base
  }
}

export function createEntry(dbId: ID, input: { title?: string; templateId?: ID } = {}): ID | null {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db || isDbReadOnly()) return null
  const view = db.views[0]
  const ctx = workspaceCtx()
  const properties = view ? defaultsFromFilter(view, new Map([...db.properties, typeColumn(db, s.kit)].map((p) => [p.id, p])), (p) => resolveMe(p, ctx)) : {}
  // templateId: a row template's values, content and icon over the presets (the "New ▾" menu's templates)
  const tpl = input.templateId ? db.templates?.find((x) => x.id === input.templateId) : undefined
  // a Type preset (a filter on the Type column) becomes the row's record type (model/recordTypes)
  if (!tpl) return createTypedRow(dbId, { title: input.title ?? '', properties })
  const copy = JSON.parse(JSON.stringify({ properties: tpl.properties, content: tpl.content ?? null }))
  return createTypedRow(dbId, { title: input.title ?? '', properties: { ...properties, ...copy.properties }, content: copy.content, icon: tpl.icon ?? null })
}

/**
 * A database from outside its page (database commands, features/commands):
 *  - openDatabaseView(dbId, viewId): its page on that view (switches it when the page is open) — false: no such view
 *  - pageViewId(dbId): the view its page shows (the last one picked there), else the first
 *  - exportDatabaseCsv(dbId, viewId?): a view's rows (filters + order) and shown columns as a CSV download (default:
 *      the view its page shows) → the row count, null: no such database
 *  - importCsvInto(dbId): pick a CSV / TSV file and import it into the database (the dialog for unknown columns is
 *      rendered by a mounted database view — open the database page first)
 */
export { openDatabaseView, pageViewId, exportDatabaseCsv } from './model/outside'
export { importCsvInto } from './create/CsvIntake'
/**
 * Record types in databases + the free board (model/recordTypes):
 *  - freeBoardSpec(): title + lane properties and a free board view for createDatabase (slash "/free board", "New free board")
 *  - addFreeBoard(dbId): a lane property + a free board view on an existing database → the view id ('' refused)
 *  - adoptRowType(rowId): a row whose record type its database does not hold yet (a page dropped in from elsewhere) → attached
 *  - TYPE_PROP_ID: the computed Type column's id (views' visibleProperties / filters / sorts / groupBy)
 *  - withTypeColumn(db, props, rows): export columns with "Type" after the title when the database uses record types
 */
export { freeBoardSpec, addFreeBoard, adoptRowType, TYPE_PROP_ID, withTypeColumn, typeOfRow } from './model/recordTypes'
