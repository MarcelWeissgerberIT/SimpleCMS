/**
 * Version history — the properties of a database entry. A snapshot of a row keeps its stored property
 * values together with each property's name, type and options at that time (a property renamed or
 * deleted later still reads right). Computed properties (formula, rollup, created / edited time and
 * by) are never kept; unique_id is kept but never restored.
 */
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page, PageIcon, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { writePropertyValue } from '../../database'
import { compatible, isEmptyValue, isKept, NO_RESTORE, planRestoreProps, skipOf, valueKey, type NotRestored, type PropSkip, type SnapshotPropDef, type SnapshotProps } from './propsCore'

export { isKept, isEmptyValue, valueKey, planRestoreProps, emptyOf } from './propsCore'
export type { SnapshotPropDef, SnapshotProps, PropSkip, NotRestored, RestorePlan } from './propsCore'

function defOf(p: PropertyDef): SnapshotPropDef {
  const d: SnapshotPropDef = { id: p.id, name: p.name, type: p.type }
  if (p.options?.length) d.options = p.options.map((o) => ({ ...o }))
  if (p.numberFormat) d.numberFormat = p.numberFormat
  if (p.relationDatabaseId) d.relationDatabaseId = p.relationDatabaseId
  if (p.idPrefix) d.idPrefix = p.idPrefix
  if (p.ratingMax) d.ratingMax = p.ratingMax
  return d
}

/** The stored properties of a row (null: not a row, or its database is gone). */
export function propsOf(page: Page, db: Database | undefined = useWorkspace.getState().databases[page.databaseId ?? '']): SnapshotProps | null {
  if (!page.databaseId || !db) return null
  const values: Record<ID, PropertyValue> = {}
  const defs: SnapshotPropDef[] = []
  for (const p of db.properties) {
    if (!isKept(p)) continue
    defs.push(defOf(p))
    const v = page.properties[p.id]
    if (!isEmptyValue(v)) values[p.id] = structuredClone(v) as PropertyValue
  }
  return { databaseId: page.databaseId, values, defs }
}

/** A fresh, untouched entry: no title, no icon, no stored value (an automatic unique ID does not count). */
export function blankRow(page: Page): boolean {
  if (page.title.trim() || page.icon) return false
  const db = useWorkspace.getState().databases[page.databaseId ?? '']
  return !db || db.properties.every((p) => !isKept(p) || NO_RESTORE.has(p.type) || isEmptyValue(page.properties[p.id]))
}

/** What a hash and the change check compare: values only (a renamed property is not an edit of the row). */
export function propsKey(props: SnapshotProps | null | undefined): string {
  if (!props) return ''
  const types = new Map(props.defs.map((d) => [d.id, d.type]))
  return JSON.stringify(
    Object.keys(props.values)
      .sort()
      .map((k) => [k, valueKey(props.values[k], types.get(k))])
      .filter(([, v]) => v !== ''),
  )
}

export const iconKey = (icon: PageIcon | null | undefined) => (icon ? JSON.stringify([icon.type, icon.value, 'color' in icon ? (icon.color ?? null) : null]) : '')

/** Did a row's stored values change between two versions of it (cheap when the object is the same)? */
export function propsChanged(before: Page, after: Page): boolean {
  if (before.properties === after.properties || !after.databaseId) return false
  const db = useWorkspace.getState().databases[after.databaseId]
  if (!db) return false
  for (const p of db.properties) {
    if (!isKept(p)) continue
    if (valueKey(before.properties[p.id], p.type) !== valueKey(after.properties[p.id], p.type)) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Changes view                                                        */
/* ------------------------------------------------------------------ */

export interface PropChangeRow {
  id: ID
  /** the name now (or then, when the property is gone) */
  name: string
  /** the property to read the values with: the live one, else the one in the snapshot */
  def: SnapshotPropDef
  /** the snapshot's definition (its options read old option ids) */
  then: SnapshotPropDef
  before: PropertyValue | null
  after: PropertyValue | null
  /** restoring leaves it alone (and why) */
  skip?: PropSkip
}

/** The properties that differ between a snapshot and the row now (computed ones never). */
export function diffProps(props: SnapshotProps | undefined, page: Page | undefined): PropChangeRow[] {
  if (!props || !page) return []
  const db = useWorkspace.getState().databases[props.databaseId]
  const live = new Map((db?.properties ?? []).map((p) => [p.id, p]))
  const out: PropChangeRow[] = []
  for (const then of props.defs) {
    if (!isKept(then)) continue
    const now = live.get(then.id)
    const before = props.values[then.id] ?? null
    // a deleted property has no value now; one with another type reads its value with the new type
    const after = now && page.databaseId === props.databaseId ? (page.properties[then.id] ?? null) : null
    const type = now && compatible(then.type, now.type) ? now.type : then.type
    if (valueKey(before, type) === valueKey(after, type) && now) continue
    if (!now && isEmptyValue(before)) continue
    const skip = NO_RESTORE.has(then.type) ? undefined : (skipOf(then, now, before) ?? undefined)
    out.push({ id: then.id, name: now?.name ?? then.name, def: now ? { ...defOf(now), options: mergeOptions(now.options, then.options) } : then, then, before, after, ...(skip ? { skip } : {}) })
  }
  return out
}

/**
 * The properties that differ between two versions of a row (History → Changes, "to the previous
 * version"). The live schema names and types them as in diffProps; a property deleted since reads
 * with the definition the versions kept. No restore notes: those describe restoring the older side.
 */
export function diffPropsBetween(before: SnapshotProps | undefined, after: SnapshotProps | undefined): PropChangeRow[] {
  if (!before || !after || before.databaseId !== after.databaseId) return []
  const db = useWorkspace.getState().databases[after.databaseId]
  const live = new Map((db?.properties ?? []).map((p) => [p.id, p]))
  const was = new Map(before.defs.map((d) => [d.id, d]))
  const is = new Map(after.defs.map((d) => [d.id, d]))
  const ids = [...after.defs.map((d) => d.id), ...before.defs.map((d) => d.id).filter((id) => !is.has(id))]
  const out: PropChangeRow[] = []
  for (const id of ids) {
    const then = (was.get(id) ?? is.get(id))!
    const newer = is.get(id) ?? then
    if (!isKept(then) || !isKept(newer)) continue
    const now = live.get(id)
    const old = before.values[id] ?? null
    const val = after.values[id] ?? null
    const type = now && compatible(newer.type, now.type) ? now.type : newer.type
    if (valueKey(old, type) === valueKey(val, type)) continue
    const options = mergeOptions(newer.options, then.options)
    const def = now && compatible(newer.type, now.type) ? { ...defOf(now), options: mergeOptions(now.options, options) } : { ...newer, options }
    out.push({ id, name: now?.name ?? newer.name, def, then, before: old, after: val })
  }
  return out
}

/** Live options first, then the ones the snapshot knew (an option deleted since still has a name). */
function mergeOptions(live: SelectOption[] | undefined, then: SelectOption[] | undefined): SelectOption[] | undefined {
  if (!then?.length) return live
  const ids = new Set((live ?? []).map((o) => o.id))
  return [...(live ?? []), ...then.filter((o) => !ids.has(o.id))]
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

/**
 * Write a snapshot's property values back into the row: only properties that still exist with a
 * compatible type (two-way relations stay in step); returns the ones left alone.
 */
export function restoreProps(pageId: ID, props: SnapshotProps): NotRestored[] {
  const s = useWorkspace.getState()
  const page = s.pages[pageId]
  const db = s.databases[props.databaseId]
  if (!page || !db) return props.defs.filter((d) => isKept(d) && !NO_RESTORE.has(d.type) && !isEmptyValue(props.values[d.id])).map((d) => ({ name: d.name, reason: 'deleted' as const }))
  const plan = planRestoreProps(page, props, db)
  for (const [id, value] of Object.entries(plan.values)) {
    const live = db.properties.find((p) => p.id === id)!
    // a two-way write before may have changed it already
    if (valueKey(value, live.type) === valueKey(useWorkspace.getState().pages[pageId]?.properties[id], live.type)) continue
    writePropertyValue(db.id, live, pageId, value)
  }
  return plan.notRestored
}
