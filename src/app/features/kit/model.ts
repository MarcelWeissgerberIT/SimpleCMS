/**
 * Building blocks (features/kit) — creating blocks and finding where they are used. Everything is written
 * through the store's kit actions (upsertList / upsertPropType / upsertRecordType …, sanitized there) and
 * its row action (setRowProperty). The create* functions are the small API a tool (the AI terminal, MCP)
 * can call; they return the new id, or null when nothing was saved (view only, an invalid block).
 */
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { newId } from '../../lib/ids'
import { CUSTOM_BASES, KIT_LIMITS, RECORD_PROP_TYPES, optionsOfList, storedTypeOf } from '../../store/kit'
import {
  COLOR_NAMES,
  type ColorName,
  type CustomPropBase,
  type CustomPropDisplay,
  type CustomPropScripts,
  type CustomPropType,
  type Database,
  type ID,
  type NumberDisplay,
  type NumberFormat,
  type OptionList,
  type PageIcon,
  type PropertyDef,
  type PropertyType,
  type RecordType,
  type RecordTypeProp,
  type SelectOption,
} from '../../store/types'
import type { JSONContent } from '@tiptap/core'

const ws = () => useWorkspace.getState()
export const kitReadOnly = () => useCloud.getState().readOnly

const PALETTE = COLOR_NAMES.filter((c) => c !== 'default') as ColorName[]
/** The colour the n-th item of a list gets when none is given. */
export const itemColor = (n: number): ColorName => PALETTE[n % PALETTE.length]

/** Items from text: one per line (list markers, numbering, check boxes and surrounding space dropped). */
export function itemsFromText(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n|\t/)) {
    const name = raw
      .replace(/^\s*(?:[-*+•–]|\d+[.)]|[a-z][.)](?=\s))\s+/i, '')
      .replace(/^\[[ xX]?\]\s+/, '')
      .trim()
      .slice(0, KIT_LIMITS.optionName)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** New items for names (fresh ids, colours continuing after `existing`; names already there are skipped). */
export function newItems(names: Array<string | { name: string; color?: ColorName }>, existing: SelectOption[] = []): SelectOption[] {
  const taken = new Set(existing.map((o) => o.name.trim().toLowerCase()))
  const out: SelectOption[] = []
  for (const n of names) {
    const name = (typeof n === 'string' ? n : n.name).replace(/\s+/g, ' ').trim().slice(0, KIT_LIMITS.optionName)
    const key = name.toLowerCase()
    if (!name || taken.has(key)) continue
    taken.add(key)
    const color = typeof n !== 'string' && n.color && COLOR_NAMES.includes(n.color) ? n.color : itemColor(existing.length + out.length)
    out.push({ id: newId(), name, color })
  }
  return out
}

/* ------------------------------------------------------------------ creating (tools call these) */

export interface ListInput {
  name: string
  items?: Array<string | { name: string; color?: ColorName }>
  description?: string
  icon?: PageIcon | null
}

/** A new shared list → its id (null: view only / no name). */
export function createList(input: ListInput): ID | null {
  if (kitReadOnly()) return null
  const id = newId()
  const items = newItems(input.items ?? []).slice(0, KIT_LIMITS.items)
  ws().upsertList({ id, name: input.name, items, description: input.description, icon: input.icon ?? null, createdAt: Date.now(), updatedAt: Date.now() })
  return ws().kit?.lists[id] ? id : null
}

export interface PropTypeInput {
  name: string
  base: CustomPropBase
  listId?: ID | null
  description?: string
  icon?: PageIcon | null
  numberFormat?: NumberFormat
  numberDisplay?: NumberDisplay
  ratingMax?: number
  display?: CustomPropDisplay
  scripts?: CustomPropScripts
}

/** A new own property type → its id (null: view only / invalid). */
export function createPropType(input: PropTypeInput): ID | null {
  if (kitReadOnly() || !CUSTOM_BASES.includes(input.base)) return null
  const id = newId()
  ws().upsertPropType({ ...input, id, createdAt: Date.now(), updatedAt: Date.now() })
  return ws().kit?.propTypes[id] ? id : null
}

export interface RecordTypeInput {
  name: string
  properties?: Array<Omit<RecordTypeProp, 'id'> & { id?: ID }>
  color?: ColorName
  description?: string
  icon?: PageIcon | null
  content?: JSONContent | null
}

/** A new record type → its id (null: view only / invalid). Property ids are made when missing. */
export function createRecordType(input: RecordTypeInput): ID | null {
  if (kitReadOnly()) return null
  const id = newId()
  const properties = (input.properties ?? []).map((p) => ({ ...p, id: p.id ?? newId() }))
  ws().upsertRecordType({ ...input, properties, id, createdAt: Date.now(), updatedAt: Date.now() })
  return ws().kit?.recordTypes[id] ? id : null
}

/* ------------------------------------------------------------------ where blocks are used */

export interface PropUse {
  db: Database
  prop: PropertyDef
  /** the database's title */
  title: string
}

const dbTitle = (id: ID) => ws().pages[id]?.title.trim() ?? ''
const liveDb = (db: Database) => {
  const p = ws().pages[db.id]
  return !!p && !p.trashed
}

/** Database properties bound to a list. */
export function propsOfList(listId: ID): PropUse[] {
  const out: PropUse[] = []
  for (const db of Object.values(ws().databases)) {
    if (!liveDb(db)) continue
    for (const prop of db.properties) if (prop.listId === listId) out.push({ db, prop, title: dbTitle(db.id) })
  }
  return out
}

/** Database properties of an own type. */
export function propsOfType(typeId: ID): PropUse[] {
  const out: PropUse[] = []
  for (const db of Object.values(ws().databases)) {
    if (!liveDb(db)) continue
    for (const prop of db.properties) if (prop.custom === typeId) out.push({ db, prop, title: dbTitle(db.id) })
  }
  return out
}

/** Databases holding a record type (and how many of their rows carry it). */
export function databasesOfRecordType(typeId: ID): Array<{ db: Database; title: string; rows: number }> {
  const s = ws()
  const out: Array<{ db: Database; title: string; rows: number }> = []
  for (const db of Object.values(s.databases)) {
    if (!liveDb(db) || !(db.recordTypes ?? []).includes(typeId)) continue
    let rows = 0
    for (const p of Object.values(s.pages)) if (p.databaseId === db.id && !p.trashed && p.recordType === typeId) rows++
    out.push({ db, title: dbTitle(db.id), rows })
  }
  return out
}

/** Own types and record types that name a list. */
export function blocksUsingList(listId: ID): { types: CustomPropType[]; records: RecordType[] } {
  const kit = ws().kit
  return {
    types: Object.values(kit?.propTypes ?? {}).filter((t) => t.listId === listId),
    records: Object.values(kit?.recordTypes ?? {}).filter((r) => r.properties.some((p) => p.listId === listId)),
  }
}

/** Record types with a property of an own type. */
export const recordTypesUsingType = (typeId: ID): RecordType[] => Object.values(ws().kit?.recordTypes ?? {}).filter((r) => r.properties.some((p) => p.custom === typeId))

/** Rows (live) whose value of a property bound to `listId` holds the item. */
export function rowsWithItem(listId: ID, itemId: ID): Array<{ rowId: ID; prop: PropertyDef }> {
  const out: Array<{ rowId: ID; prop: PropertyDef }> = []
  const uses = propsOfList(listId)
  if (!uses.length) return out
  const byDb = new Map<ID, PropertyDef[]>()
  for (const u of uses) byDb.set(u.db.id, [...(byDb.get(u.db.id) ?? []), u.prop])
  for (const p of Object.values(ws().pages)) {
    if (!p.databaseId || p.trashed) continue
    for (const prop of byDb.get(p.databaseId) ?? []) {
      const v = p.properties[prop.id]
      if (v === itemId || (Array.isArray(v) && (v as unknown[]).includes(itemId))) out.push({ rowId: p.id, prop })
    }
  }
  return out
}

/**
 * Remove an item from a list: rows holding it get `replaceWith` instead (or lose it). One store write
 * per row, then the list without the item (bound properties follow).
 */
export function removeItem(list: OptionList, itemId: ID, replaceWith: ID | null): number {
  const hits = rowsWithItem(list.id, itemId)
  const s = ws()
  for (const { rowId, prop } of hits) {
    const v = s.pages[rowId]?.properties[prop.id]
    if (Array.isArray(v)) {
      const next = (v as ID[]).map((x) => (x === itemId ? replaceWith : x)).filter((x): x is ID => !!x)
      s.setRowProperty(rowId, prop.id, [...new Set(next)])
    } else s.setRowProperty(rowId, prop.id, replaceWith)
  }
  s.upsertList({ ...list, items: list.items.filter((o) => o.id !== itemId) })
  return hits.length
}

/* ------------------------------------------------------------------ properties of own types */

/** What a database property of an own type starts with (the list's items as options). */
export function propertyDefFor(type: CustomPropType): Partial<PropertyDef> & Pick<PropertyDef, 'type' | 'name'> {
  const def: Partial<PropertyDef> & Pick<PropertyDef, 'type' | 'name'> = { type: storedTypeOf(type.base), name: type.name, custom: type.id }
  const list = type.listId ? ws().kit?.lists[type.listId] : undefined
  if (def.type === 'select' || def.type === 'multi_select') {
    def.options = list ? optionsOfList(list) : []
    if (list) def.listId = list.id
  }
  if (type.numberFormat) def.numberFormat = type.numberFormat
  if (type.numberDisplay) def.numberDisplay = type.numberDisplay
  if (type.ratingMax) def.ratingMax = type.ratingMax
  return def
}

/** A select / multi-select property bound to a list. */
export function propertyDefForList(list: OptionList, type: 'select' | 'multi_select'): Partial<PropertyDef> & Pick<PropertyDef, 'type' | 'name'> {
  return { type, name: list.name, listId: list.id, options: optionsOfList(list) }
}

/** The own type of a property — only while the property still has the type's stored shape. */
export function ownTypeOf(prop: Pick<PropertyDef, 'custom' | 'type'>): CustomPropType | null {
  if (!prop.custom) return null
  const type = ws().kit?.propTypes[prop.custom]
  return type && storedTypeOf(type.base) === prop.type ? type : null
}

/** Record properties can be of these standard types (the rest are computed). */
export const RECORD_TYPES: readonly PropertyType[] = RECORD_PROP_TYPES
