/**
 * Version history — the pure half of a row's properties (props.ts re-exports all of it): what a snapshot keeps,
 * empty values, value keys, and which kept values may go back into a row now (planRestoreProps — History's restore
 * writes the plan, the flight recorder's eject plans with it). No store, no DOM.
 */
import type { Database, ID, NumberFormat, Page, PropertyDef, PropertyType, PropertyValue, SelectOption } from '../../store/types'

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
export const NO_RESTORE = new Set<PropertyType>(['unique_id'])

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
    const d = v as unknown as Record<string, unknown>
    return JSON.stringify(Object.keys(d).sort().filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== false).map((k) => [k, d[k]]))
  }
  return JSON.stringify(v)
}

export type PropSkip = 'deleted' | 'type' | 'option'

export interface NotRestored {
  name: string
  reason: PropSkip
}

const TEXTISH = new Set<PropertyType>(['text', 'url', 'email', 'phone'])
export const compatible = (a: PropertyType, b: PropertyType) => a === b || (TEXTISH.has(a) && TEXTISH.has(b))

/** Why a value can't go back (null: it can). */
export function skipOf(then: SnapshotPropDef, live: PropertyDef | undefined, value: PropertyValue | undefined): PropSkip | null {
  if (!live) return 'deleted'
  if (!compatible(then.type, live.type)) return 'type'
  if ((live.type === 'select' || live.type === 'status') && typeof value === 'string' && !live.options?.some((o) => o.id === value)) return 'option'
  return null
}

export const emptyOf = (type: PropertyType): PropertyValue => (type === 'checkbox' ? false : type === 'multi_select' || type === 'relation' || type === 'person' || type === 'files' ? [] : null)

export interface RestorePlan {
  /** the values that go back, by property id (only those that differ from the row now) */
  values: Record<ID, PropertyValue>
  /** properties left alone, and why */
  notRestored: NotRestored[]
  /** the property id of each note in `notRestored` (same order) */
  skipped: ID[]
}

/**
 * Which of a snapshot's values may go back into `row` with the database `db` as it is (or as an eject plans it):
 * only properties that still exist with a compatible type; a select's option deleted since, and multi-select options
 * deleted since, are left out and named. Two-way relations, sub-items and dependencies are the writer's (and the
 * eject's relation check's) business. Pure.
 */
export function planRestoreProps(row: Page, props: SnapshotProps, db: Pick<Database, 'id' | 'properties'> | undefined): RestorePlan {
  const out: RestorePlan = { values: {}, notRestored: [], skipped: [] }
  const skip = (id: ID, name: string, reason: PropSkip) => {
    out.notRestored.push({ name, reason })
    out.skipped.push(id)
  }
  if (!db || row.databaseId !== props.databaseId || db.id !== props.databaseId) {
    for (const d of props.defs) if (isKept(d) && !NO_RESTORE.has(d.type) && !isEmptyValue(props.values[d.id])) skip(d.id, d.name, 'deleted')
    return out
  }
  for (const then of props.defs) {
    if (!isKept(then) || NO_RESTORE.has(then.type)) continue
    const live = db.properties.find((p) => p.id === then.id)
    const old = props.values[then.id]
    const cur = row.properties[then.id]
    if (live && valueKey(old, live.type) === valueKey(cur, live.type)) continue
    // a property deleted since that was empty then: nothing is lost, nothing to report
    if (!live && isEmptyValue(old)) continue
    const why = skipOf(then, live, old)
    if (why) {
      skip(then.id, live?.name ?? then.name, why)
      continue
    }
    // an empty value goes back the way a cleared cell reads (unticked, no options, nothing)
    let value: PropertyValue = old === undefined ? emptyOf(live!.type) : (structuredClone(old) as PropertyValue)
    // multi-select: options deleted since are left out
    if (live!.type === 'multi_select' && Array.isArray(value)) {
      const known = value.filter((id) => live!.options?.some((o) => o.id === id))
      if (known.length !== value.length) skip(then.id, live!.name, 'option')
      value = known
    }
    out.values[then.id] = value
  }
  return out
}
