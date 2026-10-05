/**
 * Version history — the properties of a database entry. A snapshot of a row keeps its stored property
 * values together with each property's name, type and options at that time (a property renamed or
 * deleted later still reads right). Computed properties (formula, rollup, created / edited time and
 * by) are never kept; unique_id is kept but never restored.
 */
import { useWorkspace } from '../../store/store'
import type { Database, ID, NumberFormat, Page, PageIcon, PropertyDef, PropertyType, PropertyValue, SelectOption } from '../../store/types'
import { writePropertyValue } from '../../database'

/** A property as it was when the snapshot was taken. */
export interface SnapshotPropDef {
  id: ID
  name: string
  type: PropertyType
  options?: SelectOption[]
  numberFormat?: NumberFormat
  relationDatabaseId?: ID
  idPrefix?: string
  ratingMax?: number
}

export interface SnapshotProps {
  databaseId: ID
  /** stored values by property id (empty values left out) */
  values: Record<ID, PropertyValue>
  defs: SnapshotPropDef[]
}

/** Never in a snapshot: computed from other data. */
const COMPUTED = new Set<PropertyType>(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by'])
/** Kept for the record, never written back. */
const NO_RESTORE = new Set<PropertyType>(['unique_id'])

export const isKept = (p: Pick<PropertyDef, 'type'>) => !COMPUTED.has(p.type)

/** null, '', [], false and absent all mean "empty". */
export function isEmptyValue(v: PropertyValue | undefined): boolean {
  return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)
}

/** Stable text of a value (empty = ''; arrays of ids compare as sets). */
export function valueKey(v: PropertyValue | undefined, type?: PropertyType): string {
  if (isEmptyValue(v)) return ''
  if (Array.isArray(v) && (type === 'multi_select' || type === 'relation' || type === 'person')) return JSON.stringify([...v].sort())
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const d = v as Record<string, unknown>
    return JSON.stringify(Object.keys(d).sort().filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== false).map((k) => [k, d[k]]))
  }
  return JSON.stringify(v)
}

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

export type PropSkip = 'deleted' | 'type' | 'option'

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

const TEXTISH = new Set<PropertyType>(['text', 'url', 'email', 'phone'])
const compatible = (a: PropertyType, b: PropertyType) => a === b || (TEXTISH.has(a) && TEXTISH.has(b))

/** Why a value can't go back (null: it can). */
function skipOf(then: SnapshotPropDef, live: PropertyDef | undefined, value: PropertyValue | undefined): PropSkip | null {
  if (!live) return 'deleted'
  if (!compatible(then.type, live.type)) return 'type'
  if ((live.type === 'select' || live.type === 'status') && typeof value === 'string' && !live.options?.some((o) => o.id === value)) return 'option'
  return null
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

/** Live options first, then the ones the snapshot knew (an option deleted since still has a name). */
function mergeOptions(live: SelectOption[] | undefined, then: SelectOption[] | undefined): SelectOption[] | undefined {
  if (!then?.length) return live
  const ids = new Set((live ?? []).map((o) => o.id))
  return [...(live ?? []), ...then.filter((o) => !ids.has(o.id))]
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

export interface NotRestored {
  name: string
  reason: PropSkip
}

/**
 * Write a snapshot's property values back into the row: only properties that still exist with a
 * compatible type (two-way relations stay in step); returns the ones left alone.
 */
export function restoreProps(pageId: ID, props: SnapshotProps): NotRestored[] {
  const s = useWorkspace.getState()
  const page = s.pages[pageId]
  const db = s.databases[props.databaseId]
  if (!page || !db || page.databaseId !== props.databaseId) return props.defs.filter((d) => isKept(d) && !NO_RESTORE.has(d.type) && !isEmptyValue(props.values[d.id])).map((d) => ({ name: d.name, reason: 'deleted' as const }))
  const skipped: NotRestored[] = []
  for (const then of props.defs) {
    if (!isKept(then) || NO_RESTORE.has(then.type)) continue
    const live = db.properties.find((p) => p.id === then.id)
    const old = props.values[then.id]
    const cur = useWorkspace.getState().pages[pageId]?.properties[then.id]
    if (live && valueKey(old, live.type) === valueKey(cur, live.type)) continue
    const skip = skipOf(then, live, old)
    if (skip === 'deleted' || skip === 'type' || skip === 'option') {
      skipped.push({ name: live?.name ?? then.name, reason: skip })
      continue
    }
    let value: PropertyValue = old === undefined ? null : (structuredClone(old) as PropertyValue)
    // multi-select: options deleted since are left out
    if (live!.type === 'multi_select' && Array.isArray(value)) {
      const known = value.filter((id) => live!.options?.some((o) => o.id === id))
      if (known.length !== value.length) skipped.push({ name: live!.name, reason: 'option' })
      value = known
    }
    if (live!.type === 'relation' && value === null) value = []
    writePropertyValue(db.id, live!, pageId, value)
  }
  return skipped
}
