/**
 * Properties created on the fly — from a picker's "Create property “X”", the relation offer next
 * to a mention, or data that brings fields the database doesn't have yet (meeting notes, CSV).
 * One call per property: named and typed; a relation can get its two-way partner on the target
 * right away. Each creation is a normal store change; the toast undoes it (the property, its
 * values and whatever pointed at it go — model/actions dropProperties).
 *
 * Locked databases (model/lock) and viewers of a team workspace never create anything here.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import type { Database, ID, NumberFormat, PropertyDef, PropertyType, SelectOption } from '../../store/types'
import { isDbReadOnly } from '../readonly'
import { isDbLocked } from '../model/lock'
import { CREATABLE_TYPES } from '../model/schema'
import { TWO_WAY_SUFFIX, dropProperties, enableTwoWay, insertProperty } from '../model/actions'

const ws = () => useWorkspace.getState()

export interface QuickProperty {
  name: string
  type: PropertyType
  /** relation: the target database; twoWay adds the partner property there (named reverseName). */
  relation?: { databaseId: ID; twoWay?: boolean; reverseName?: string }
  /** select / multi_select / status: the options to start with */
  options?: SelectOption[]
  numberFormat?: NumberFormat
}

/** Every type a property can be created with (the "add property" list), optionally narrowed. */
export function creatableTypes(only?: PropertyType[]): PropertyType[] {
  return CREATABLE_TYPES.flat().filter((type) => !only || only.includes(type))
}

/** Properties of this database may be created here (not view only, not locked). */
export function canCreateProperties(dbId: ID | null | undefined): boolean {
  return !!dbId && !!ws().databases[dbId] && !isDbReadOnly() && !isDbLocked(dbId)
}

/** The property with this name (trimmed, any case). */
export function propertyByName(db: Pick<Database, 'properties'>, name: string): PropertyDef | undefined {
  const n = name.trim().toLowerCase()
  return n ? db.properties.find((p) => p.name.trim().toLowerCase() === n) : undefined
}

/** `name`, or "name 2", "name 3" … when the database already has it. */
export function freePropertyName(db: Pick<Database, 'properties'>, name: string): string {
  const base = name.trim()
  if (!propertyByName(db, base)) return base
  let n = 2
  while (propertyByName(db, `${base} ${n}`)) n++
  return `${base} ${n}`
}

/** The created properties of one call, for an undo: [database id, property id]. */
type Made = Array<[ID, ID]>

function createOne(dbId: ID, input: QuickProperty, made: Made): PropertyDef | null {
  const db = ws().databases[dbId]
  if (!db || input.type === 'title' || !canCreateProperties(dbId)) return null
  const def: Partial<PropertyDef> & Pick<PropertyDef, 'type'> = { type: input.type, name: freePropertyName(db, input.name.trim() || t(`database.type.${input.type}`)) }
  if (input.options) def.options = input.options.map((o) => ({ ...o }))
  if (input.numberFormat) def.numberFormat = input.numberFormat
  if (input.type === 'formula') def.formula = ''
  const rel = input.relation
  if (input.type === 'relation') {
    if (!rel?.databaseId || !ws().databases[rel.databaseId]) return null
    def.relationDatabaseId = rel.databaseId
  }
  const id = insertProperty(db, null, def)
  const prop = ws().databases[dbId]?.properties.find((p) => p.id === id)
  if (!prop) return null
  made.push([dbId, id])
  if (input.type === 'relation' && rel?.twoWay && canCreateProperties(rel.databaseId)) {
    enableTwoWay(dbId, prop)
    const backId = id + TWO_WAY_SUFFIX
    const target = ws().databases[rel.databaseId]
    if (target?.properties.some((p) => p.id === backId)) {
      made.push([rel.databaseId, backId])
      const others = { properties: target.properties.filter((p) => p.id !== backId) }
      const want = rel.reverseName?.trim()
      if (want) ws().updateProperty(rel.databaseId, backId, { name: freePropertyName(others, want) })
    }
  }
  return ws().databases[dbId]?.properties.find((p) => p.id === id) ?? null
}

/** Undo for created properties (the reverse side of a two-way relation first). */
function undoMade(made: Made): () => void {
  return () => {
    for (const [dbId, propId] of [...made].reverse()) if (ws().databases[dbId]?.properties.some((p) => p.id === propId)) dropProperties(dbId, [propId])
  }
}

/**
 * Create one property. `toast: false` leaves the undo to the caller (dropCreated). Returns the
 * property, or null when nothing could be created (locked, view only, no such target …).
 */
export function createPropertyQuick(dbId: ID, input: QuickProperty, opts: { toast?: boolean } = {}): PropertyDef | null {
  const made: Made = []
  const prop = createOne(dbId, input, made)
  if (prop && opts.toast !== false) {
    const twoWay = made.length > 1
    useUI.getState().toast({
      message: t(twoWay ? 'database.create.createdTwoWay' : 'database.create.created', { name: prop.name }),
      action: { label: t('common.undo'), run: undoMade(made) },
    })
  }
  return prop
}

/**
 * Create several properties of one database (no toast — the caller's flow reports and undoes).
 * One result per input, in order (null where nothing could be created).
 */
export function createPropertiesQuick(dbId: ID, inputs: QuickProperty[]): Array<PropertyDef | null> {
  return inputs.map((input) => createOne(dbId, input, []))
}

/** Undo created properties (and the two-way partners they brought along). */
export function dropCreated(dbId: ID, props: PropertyDef[]): void {
  const made: Made = []
  for (const p of props) {
    made.push([dbId, p.id])
    if (p.type === 'relation' && p.relationDatabaseId) made.push([p.relationDatabaseId, p.id + TWO_WAY_SUFFIX])
  }
  undoMade(made)()
}
