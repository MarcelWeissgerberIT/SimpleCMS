/**
 * One Script runtime — a value as a small table (the query tester, printed lists of rows): a query or a
 * list of rows → title + properties, a list of records → their fields, a list of plain values → one
 * column. Cells of rows and pages link to them.
 */
import { HostObject, SRecord, toText, type CallCtx, type Value } from '../lang'
import { PageObj, QueryObj } from './objects'
import type { Cell, ResultTable } from './types'
import { propByName } from './props'
import { propertyValueToText } from '../../../database'

export const TABLE_MAX = 200
const COLS_MAX = 12

function cell(v: Value): Cell {
  if (v instanceof PageObj) return { text: v.display(), pageId: v.id }
  if (v instanceof QueryObj) return { text: v.display(), pageId: v.dbId }
  if (Array.isArray(v) && v.length && v.every((x) => x instanceof PageObj)) return v.map((x) => (x as PageObj).display()).join(', ')
  return toText(v)
}

/** Columns for rows of one database: the title, then the first view's visible properties. */
function rowColumns(rows: PageObj[]): string[] {
  const db = rows.find((r) => r.db)?.db
  if (!db) return ['title']
  const title = db.properties.find((p) => p.type === 'title')
  const view = db.views[0]
  const visible = (view?.visibleProperties ?? []).map((id) => db.properties.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p && p.type !== 'title')
  return [title?.name ?? 'title', ...visible.slice(0, 5).map((p) => p.name)]
}

function rowCells(row: PageObj, columns: string[]): Cell[] {
  const db = row.db
  const page = row.host.page(row.id)
  return columns.map((c, i) => {
    if (i === 0) return { text: row.display(), pageId: row.id }
    try {
      // a property as the database shows it (number formats, dates, options); else the script's value
      const prop = db && page && !row.host.isDraft(row.id) ? propByName(db, c) : undefined
      if (prop && prop.type !== 'relation') return propertyValueToText(db!, prop, page!)
      return cell(row.scope(c) ?? null)
    } catch {
      return ''
    }
  })
}

/** A table for the value, or null when it is a single plain value. */
export async function tabulate(v: Value, ctx: CallCtx): Promise<ResultTable | null> {
  let items: Value[]
  let columns: string[] | null = null
  if (v instanceof QueryObj) {
    items = await v.items(ctx)
    columns = v.columns()
  } else if (Array.isArray(v)) items = v
  else if (v instanceof PageObj) items = [v]
  else if (v instanceof SRecord) items = [v]
  else return null

  const total = items.length
  const shown = items.slice(0, TABLE_MAX)
  if (shown.length && shown.every((x) => x instanceof PageObj)) {
    const rows = shown as PageObj[]
    const cols = columns && !(v instanceof QueryObj && v.selected) ? columns : rowColumns(rows)
    return { columns: cols, rows: rows.map((r) => ({ pageId: r.id, cells: rowCells(r, cols) })), total }
  }
  if (shown.length && shown.every((x) => x instanceof SRecord)) {
    const cols: string[] = columns ? [...columns] : []
    for (const r of shown as SRecord[]) for (const k of r.fields.keys()) if (!cols.includes(k) && cols.length < COLS_MAX) cols.push(k)
    return {
      columns: cols,
      rows: (shown as SRecord[]).map((r) => {
        const cells = cols.map((c) => cell(r.fields.get(c) ?? null))
        const link = [...r.fields.values()].find((x) => x instanceof PageObj) as PageObj | undefined
        return { pageId: link?.id ?? null, cells }
      }),
      total,
    }
  }
  if (!shown.length && v instanceof QueryObj) return { columns: columns ?? ['title'], rows: [], total: 0 }
  if (!shown.length) return { columns: ['value'], rows: [], total: 0 }
  return {
    columns: ['value'],
    rows: shown.map((x) => ({ pageId: x instanceof PageObj ? x.id : x instanceof QueryObj ? x.dbId : null, cells: [cell(x)] })),
    total,
  }
}

/** Whether printing this value should show a table. */
export function isTabular(v: Value): boolean {
  if (v instanceof QueryObj) return true
  if (Array.isArray(v)) return v.length > 0 && (v.every((x) => x instanceof PageObj) || v.every((x) => x instanceof SRecord))
  return false
}

export { HostObject }
