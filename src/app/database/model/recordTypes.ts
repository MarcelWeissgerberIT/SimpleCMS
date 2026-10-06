/**
 * Record types in databases (Workspace.kit.recordTypes, contract in store/kit.ts) — the database side:
 *  - which properties a row shows: the database's own ones (no `fromType`) + those of the row's own type;
 *    another type's property is "foreign" to the row (hidden on its page / card, a dim "—" in the table)
 *  - the "Type" column: a computed, view-level column (TYPE_PROP_ID in a view's visibleProperties / filters /
 *    sorts / groupBy), never a stored property — a select whose options are the database's record types;
 *    writing it (a group move, a paste, a picker) sets the row's type with setRecordType
 *  - new rows of a type (the type's content as the body, origin 'template'), "New record type from these
 *    properties", the lanes of a free board (View.free) and what a card of a free board shows.
 */
import type { ColorName, Database, ID, Kit, Page, PropertyDef, RecordType, RecordTypeProp, SelectOption, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { RECORD_PROP_TYPES } from '../../store/kit'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { Resolver } from './resolve'
import { isEmptyValue } from './resolve'

import { TYPE_PROP_ID } from './typeId'

export { TYPE_PROP_ID }
/** `View.typeFields` key of cards without a type. */
export const PLAIN_KEY = '__plain__'

export const isTypeProp = (p: { id: ID } | null | undefined): boolean => p?.id === TYPE_PROP_ID

const ws = () => useWorkspace.getState()

/** The record types a database holds that still exist, in its order. */
export function heldTypes(db: Pick<Database, 'recordTypes'>, kit: Kit | undefined): RecordType[] {
  const out: RecordType[] = []
  for (const id of db.recordTypes ?? []) {
    const rt = kit?.recordTypes[id]
    if (rt) out.push(rt)
  }
  return out
}

/** Every record type of the workspace, by name. */
export function allTypes(kit: Kit | undefined): RecordType[] {
  return Object.values(kit?.recordTypes ?? {}).sort((a, b) => a.name.localeCompare(b.name))
}

/** The computed Type column of a database: a select of its record types. */
export function typeColumn(db: Pick<Database, 'recordTypes'>, kit: Kit | undefined, name = t('database.rtype.column')): PropertyDef {
  return { id: TYPE_PROP_ID, name, type: 'select', options: heldTypes(db, kit).map((rt) => ({ id: rt.id, name: rt.name, color: rt.color ?? 'default' })) }
}

/** The database's properties and its Type column by id (filters / sorts on the Type column work outside React too). */
export function propMapOf(db: Database, kit: Kit | undefined = ws().kit): Map<ID, PropertyDef> {
  return new Map([...db.properties, typeColumn(db, kit)].map((p) => [p.id, p]))
}

/**
 * Columns for an export (CSV, Markdown, HTML tables): the Type column right after the title when the database
 * holds record types or one of `rows` carries a type — unless it is among the columns already.
 */
export function withTypeColumn(db: Database, props: PropertyDef[], rows: Array<Pick<Page, 'recordType'>>, kit: Kit | undefined = ws().kit): PropertyDef[] {
  if (props.some((p) => p.id === TYPE_PROP_ID)) return props
  if (!db.recordTypes?.length && !rows.some((r) => r.recordType)) return props
  const col = typeColumn(db, kit)
  const at = props.findIndex((p) => p.type === 'title') + 1
  return [...props.slice(0, at), col, ...props.slice(at)]
}

/** Does the database use record types at all (held ones or the Type column in a view)? */
export const usesTypes = (db: Database): boolean => !!db.recordTypes?.length || db.views.some((v) => v.visibleProperties.includes(TYPE_PROP_ID))

/** A record type's property shown on a row of another type (or a row without one): not part of that row. */
export const foreignTo = (prop: Pick<PropertyDef, 'fromType'>, row: Pick<Page, 'recordType'>): boolean => !!prop.fromType && prop.fromType.id !== (row.recordType ?? null)

/** The properties a row shows, in the given order (its own type's and the database's own ones). */
export const rowProps = <P extends Pick<PropertyDef, 'fromType'>>(props: P[], row: Pick<Page, 'recordType'>): P[] => props.filter((p) => !foreignTo(p, row))

/** The type of a row as the database knows it (null: none, or a type that no longer exists). */
export function typeOfRow(row: Pick<Page, 'recordType'>, kit: Kit | undefined): RecordType | null {
  return row.recordType ? (kit?.recordTypes[row.recordType] ?? null) : null
}

/** "Not part of Lead" — the hover text of a foreign cell. */
export function foreignLabel(prop: Pick<PropertyDef, 'fromType'>, row: Pick<Page, 'recordType'>, kit: Kit | undefined): string {
  const mine = typeOfRow(row, kit)
  if (mine) return t('database.rtype.notPart', { type: mine.name })
  const theirs = prop.fromType ? kit?.recordTypes[prop.fromType.id] : undefined
  return theirs ? t('database.rtype.onlyFor', { type: theirs.name }) : t('database.rtype.notPartPlain')
}

/* ------------------------------------------------------------------ writes */

/** A row's type (attaches it to the row's database first). False when refused (locked, unknown). */
export function setRowType(rowId: ID, typeId: ID | null): boolean {
  return ws().setRecordType(rowId, typeId)
}

/** Attach a page's record type to its database when the database does not hold it yet (a page dropped in from elsewhere). */
export function adoptRowType(rowId: ID): void {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row?.recordType || !db || (db.recordTypes ?? []).includes(row.recordType)) return
  if (!s.kit?.recordTypes[row.recordType] || !s.attachRecordType(db.id, row.recordType)) {
    // a type that is gone (or a locked database): the row stays plain
    ws().setRecordType(rowId, null)
  }
}

/** The content a new record of this type starts with (a fresh copy), or null. */
export const contentOfType = (rt: RecordType | null | undefined) => (rt?.content ? JSON.parse(JSON.stringify(rt.content)) : null)

/** Give a fresh row its type: the type set, its content as the body (origin 'template'). */
export function typeNewRow(rowId: ID, typeId: ID): boolean {
  const s = ws()
  const rt = s.kit?.recordTypes[typeId]
  if (!rt || !s.setRecordType(rowId, typeId)) return false
  const body = contentOfType(rt)
  if (body && !ws().pages[rowId]?.content) ws().setContent(rowId, body, 'template')
  return true
}

/**
 * Create a row; a Type preset among `properties` (the view's filter on the Type column, a Type group) becomes
 * the row's record type — with its content when the row brings none of its own.
 */
export function createTypedRow(dbId: ID, input: Parameters<ReturnType<typeof useWorkspace.getState>['createRow']>[1] = {}, typeId?: ID | null): ID {
  const props = { ...(input.properties ?? {}) }
  const preset = props[TYPE_PROP_ID]
  delete props[TYPE_PROP_ID]
  const id = ws().createRow(dbId, { ...input, properties: props })
  const want = typeId ?? (typeof preset === 'string' && preset ? preset : null)
  if (want) typeNewRow(id, want)
  return id
}

/** A record type's property shaped after an existing database property (its type, options, format). */
function recordPropOf(def: PropertyDef): RecordTypeProp | null {
  if (!RECORD_PROP_TYPES.includes(def.type)) return null
  const rp: RecordTypeProp = { id: newId(), name: def.name, type: def.type }
  if (def.custom) rp.custom = def.custom
  if (def.type === 'select' || def.type === 'multi_select' || def.type === 'status') {
    if (def.listId && def.type !== 'status') rp.listId = def.listId
    rp.options = (def.options ?? []).map((o) => ({ ...o }))
  }
  if (def.type === 'number' && def.numberFormat) rp.numberFormat = def.numberFormat
  if (def.type === 'rating' && def.ratingMax) rp.ratingMax = def.ratingMax
  if (def.type === 'relation' && def.relationDatabaseId) rp.relationDatabaseId = def.relationDatabaseId
  if (def.description) rp.description = def.description
  return rp
}

/** Can a database property go into a record type (a stored type, not linked to one already)? */
export const canTypeProp = (def: PropertyDef): boolean => def.type !== 'title' && !def.fromType && RECORD_PROP_TYPES.includes(def.type) && !def.autofill

export interface NewTypeInput {
  name: string
  color?: ColorName
  icon?: RecordType['icon']
  /** new properties (name + stored type) */
  fields?: Array<Pick<RecordTypeProp, 'name' | 'type'> & { options?: SelectOption[] }>
  /** existing properties of `dbId` to build the type from (they become linked) */
  fromProps?: ID[]
}

/**
 * Create a record type and attach it to a database. Existing properties (`fromProps`) are linked in place
 * (their values stay); new fields become properties of the database. Returns the type id, null when refused.
 */
export function createRecordType(dbId: ID | null, input: NewTypeInput): ID | null {
  const s = ws()
  const db = dbId ? s.databases[dbId] : undefined
  if (dbId && (!db || db.locked)) return null
  const name = input.name.trim()
  if (!name) return null
  const id = newId()
  const linked: Array<{ def: PropertyDef; rp: RecordTypeProp }> = []
  for (const pid of input.fromProps ?? []) {
    const def = db?.properties.find((p) => p.id === pid)
    const rp = def && canTypeProp(def) ? recordPropOf(def) : null
    if (def && rp) linked.push({ def, rp })
  }
  const fresh: RecordTypeProp[] = (input.fields ?? [])
    .filter((f) => f.name.trim() && RECORD_PROP_TYPES.includes(f.type))
    .map((f) => {
      const rp: RecordTypeProp = { id: newId(), name: f.name.trim(), type: f.type }
      if (f.type === 'select' || f.type === 'multi_select' || f.type === 'status') rp.options = f.options ?? []
      return rp
    })
  const now = Date.now()
  s.upsertRecordType({ id, name, color: input.color ?? 'default', icon: input.icon ?? null, properties: [...linked.map((x) => x.rp), ...fresh], createdAt: now, updatedAt: now })
  if (!ws().kit?.recordTypes[id]) return null
  if (db) {
    // the existing properties are linked first, so attaching finds them instead of adding copies
    for (const { def, rp } of linked) ws().updateProperty(db.id, def.id, { fromType: { id, prop: rp.id } })
    ws().attachRecordType(db.id, id)
  }
  return id
}

/** Take a type out of a database (its properties stay as plain ones). */
export const detachType = (dbId: ID, typeId: ID): boolean => ws().detachRecordType(dbId, typeId)

/** The route of a record type in the building blocks (features/kit). */
export const recordTypeHref = (typeId: ID) => `#/kit/records/${encodeURIComponent(typeId)}`

/* ------------------------------------------------------------------ free board */

/** The lanes a new free board starts with. */
export function defaultLanes(): SelectOption[] {
  return [
    { id: newId(), name: t('database.free.lane.inbox'), color: 'gray' },
    { id: newId(), name: t('database.free.lane.doing'), color: 'orange' },
    { id: newId(), name: t('database.free.lane.done'), color: 'green' },
  ]
}

/** A free board view over `laneId` (the lane select). */
export function freeBoardView(db: Pick<Database, 'properties'>, laneId: ID, name = t('database.view.free')): Partial<View> & Pick<View, 'type'> {
  return {
    type: 'board',
    name,
    free: true,
    groupBy: laneId,
    hiddenGroups: [],
    // the lane is the column: cards show the fields of their own type instead
    visibleProperties: db.properties.filter((p) => p.type !== 'title' && p.id !== laneId).map((p) => p.id),
  }
}

/** Add a free board to a database: its lane property ("Lane" / "Spalte") and the view. Returns the view id ('' when refused). */
export function addFreeBoard(dbId: ID): ID {
  const s = ws()
  const db = s.databases[dbId]
  if (!db || db.locked) return ''
  const laneId = s.addProperty(dbId, { type: 'select', name: freeLaneName(db), options: defaultLanes() })
  const fresh = ws().databases[dbId]
  return ws().addView(dbId, freeBoardView(fresh, laneId))
}

/** "Lane", "Lane 2" … — a name no property of the database has yet. */
function freeLaneName(db: Database): string {
  const base = t('database.free.laneProp')
  const taken = new Set(db.properties.map((p) => p.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

/** The parts of a new free-board database: title + lane properties and the view (for createDatabase). */
export function freeBoardSpec(): { properties: PropertyDef[]; views: View[] } {
  const title: PropertyDef = { id: newId(), name: t('database.free.titleProp'), type: 'title' }
  const lane: PropertyDef = { id: newId(), name: t('database.free.laneProp'), type: 'select', options: defaultLanes() }
  const view: View = { id: newId(), filter: null, sorts: [], openIn: 'peek', ...freeBoardView({ properties: [title, lane] }, lane.id) } as View
  return { properties: [title, lane], views: [view] }
}

/**
 * What a card of a free board shows: the fields of its own type (and the database's own properties) that the
 * view shows — the ones picked for its type in the card settings, else the first 3 non-empty ones.
 */
export function cardFields(r: Resolver, db: Database, view: View, row: Page, props: PropertyDef[], limit = 3): PropertyDef[] {
  const own = rowProps(props, row)
  // the type's fields first, then the database's own
  const ordered = [...own.filter((p) => p.fromType), ...own.filter((p) => !p.fromType)]
  const picked = view.typeFields?.[row.recordType ?? PLAIN_KEY]
  if (picked) {
    const byId = new Map(ordered.map((p) => [p.id, p]))
    return picked.map((id) => byId.get(id)).filter((p): p is PropertyDef => !!p)
  }
  const out: PropertyDef[] = []
  for (const p of ordered) {
    if (out.length >= limit) break
    const v = r.value(db, p, row)
    if (!isEmptyValue(p, v)) out.push(p)
  }
  return out
}
