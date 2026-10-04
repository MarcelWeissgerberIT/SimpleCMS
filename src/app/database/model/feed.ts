/**
 * Feed view: the order it shows rows in and the date each entry is stamped with.
 * A feed without sorts of its own shows the newest entries first (or the oldest, view.feed.order),
 * by the date property of its choice (view.feed.dateProperty) — created time when it has none.
 * Sorts set in the Sort panel (or a locked database's session sorts) take over, like everywhere.
 */
import type { Database, ID, Page, PropertyDef, View } from '../../store/types'
import type { Resolver } from './resolve'
import { sortRows } from './query'
import { isDateType } from './schema'

/** Created time of a row, for a database without such a property (every row has one). */
export const FEED_CREATED: PropertyDef = { id: '__feed_created', name: '', type: 'created_time' }

/** What decides the order of a view's rows. */
export type ViewOrder = Pick<View, 'type' | 'sorts' | 'feed'>

/** The property a feed orders by and stamps its entries with (gone or no longer a date → created time). */
export function feedDateProp(db: Database, view: Pick<View, 'feed'>): PropertyDef {
  const id = view.feed?.dateProperty
  const p = id ? db.properties.find((x) => x.id === id) : undefined
  return p && isDateType(p.type) ? p : FEED_CREATED
}

/** True while the feed's own order applies (the view has no sorts). */
export const feedOrders = (view: ViewOrder): boolean => view.type === 'feed' && !(Array.isArray(view.sorts) && view.sorts.length)

/** Rows in the order the view shows them: its sorts, or — a feed without any — newest / oldest first. */
export function orderRows(r: Resolver, db: Database, view: ViewOrder, rows: Page[], props: Map<ID, PropertyDef>): Page[] {
  if (!feedOrders(view)) return sortRows(r, db, rows, Array.isArray(view.sorts) ? view.sorts : [], props)
  const prop = feedDateProp(db, view)
  return sortRows(r, db, rows, [{ propertyId: prop.id, direction: view.feed?.order === 'oldest' ? 'asc' : 'desc' }], new Map([[prop.id, prop]]))
}
