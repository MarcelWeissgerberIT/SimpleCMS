/**
 * Building blocks (Workspace.kit, features/kit): shared lists, own property types, record types — the shape
 * rules, the sanitizer every copy from outside this tab goes through (stored records, backups, the team meta
 * document, the store's own writes), and the pure helpers the store's kit actions use to keep databases in
 * step. Script code of an own property type is text here: nothing in this file ever runs it.
 * Unknown fields are dropped, strings clamped, ids checked; fresh objects only.
 */
import type { JSONContent } from '@tiptap/core'
import {
  COLOR_NAMES,
  type ColorName,
  type CustomPropBase,
  type CustomPropDisplay,
  type CustomPropScripts,
  type CustomPropType,
  type Database,
  type ID,
  type Kit,
  type KitEntry,
  type NumberDisplay,
  type NumberFormat,
  type OptionList,
  type PageIcon,
  type PropertyDef,
  type PropertyType,
  type RecordType,
  type RecordTypeProp,
  type SelectOption,
  type StatusGroup,
} from './types'

export const KIT_LIMITS = {
  name: 80,
  description: 2000,
  /** lists / property types / record types per workspace (each) */
  entries: 300,
  /** items of one list */
  items: 2000,
  optionName: 200,
  /** properties of one record type */
  properties: 50,
  /** characters of one script binding */
  script: 20_000,
  /** prefix / suffix of a display */
  affix: 16,
  /** characters of a record type's content (JSON) */
  content: 200_000,
} as const

export const CUSTOM_BASES: readonly CustomPropBase[] = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone', 'person', 'rating', 'free']
/** Types a record type's property can have (stored ones; title and computed types never). */
export const RECORD_PROP_TYPES: readonly PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'files', 'relation', 'rating']
const NUMBER_FORMATS: readonly NumberFormat[] = ['number', 'comma', 'percent', 'euro', 'dollar', 'pound']
const NUMBER_DISPLAYS: readonly NumberDisplay[] = ['number', 'bar', 'ring']
const DISPLAY_STYLES: ReadonlyArray<NonNullable<CustomPropDisplay['style']>> = ['plain', 'badge', 'led', 'bar']
const STATUS_GROUPS: readonly StatusGroup[] = ['todo', 'in_progress', 'done']
const SCRIPT_KEYS: ReadonlyArray<keyof CustomPropScripts> = ['value', 'validate', 'options', 'format', 'onChange']

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const actorId = (v: unknown): string | null => (typeof v === 'string' && v && v.length <= 128 ? v : null)
const oneLine = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
const pickOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined)

export const isSafeKitId = (id: unknown): id is ID => typeof id === 'string' && SAFE_ID.test(id) && !RESERVED_KEYS.has(id)
const idOrNull = (v: unknown): ID | null => (isSafeKitId(v) ? v : null)

export const emptyKit = (): Kit => ({ lists: {}, propTypes: {}, recordTypes: {} })

function sanitizeIcon(v: unknown): PageIcon | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  const value = own(v, 'value')
  if (typeof value !== 'string' || !value || value.length > 64) return null
  if (type === 'emoji' || type === 'asset') return { type, value }
  if (type === 'lucide') {
    const color = own(v, 'color')
    return COLOR_NAMES.includes(color as ColorName) ? { type, value, color: color as ColorName } : { type, value }
  }
  return null
}

/** The fields every building block has; null when `raw` is not one stored under `id`. */
function entryOf(id: unknown, raw: unknown): KitEntry | null {
  if (!isObj(raw) || !isSafeKitId(id) || own(raw, 'id') !== id) return null
  const name = oneLine(own(raw, 'name'), KIT_LIMITS.name)
  if (!name) return null
  const createdAt = num(own(raw, 'createdAt'), 0)
  const entry: KitEntry = {
    id,
    name,
    icon: sanitizeIcon(own(raw, 'icon')),
    createdBy: actorId(own(raw, 'createdBy')),
    updatedBy: actorId(own(raw, 'updatedBy')),
    createdAt,
    updatedAt: num(own(raw, 'updatedAt'), createdAt),
  }
  const description = own(raw, 'description')
  if (typeof description === 'string' && description.trim()) entry.description = description.slice(0, KIT_LIMITS.description)
  return entry
}

/** Clean select options (unique ids, names, colours; status groups only when `groups`). */
export function sanitizeOptions(raw: unknown, max: number = KIT_LIMITS.items, groups = false): SelectOption[] {
  const out: SelectOption[] = []
  const seen = new Set<string>()
  for (const o of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break
    if (!isObj(o)) continue
    const id = own(o, 'id')
    const name = oneLine(own(o, 'name'), KIT_LIMITS.optionName)
    if (!isSafeKitId(id) || seen.has(id) || !name) continue
    seen.add(id)
    const color = own(o, 'color')
    const opt: SelectOption = { id, name, color: COLOR_NAMES.includes(color as ColorName) ? (color as ColorName) : 'default' }
    const group = groups ? pickOf(STATUS_GROUPS, own(o, 'group')) : undefined
    if (group) opt.group = group
    out.push(opt)
  }
  return out
}

/** A clean copy of a shared list, or null. `id`: the key it was stored under. */
export function sanitizeList(id: unknown, raw: unknown): OptionList | null {
  const entry = entryOf(id, raw)
  if (!entry) return null
  return { ...entry, items: sanitizeOptions(own(raw as Record<string, unknown>, 'items')) }
}

function sanitizeDisplay(raw: unknown): CustomPropDisplay | undefined {
  if (!isObj(raw)) return undefined
  const d: CustomPropDisplay = {}
  const prefix = oneLine(own(raw, 'prefix'), KIT_LIMITS.affix)
  const suffix = oneLine(own(raw, 'suffix'), KIT_LIMITS.affix)
  if (prefix) d.prefix = prefix
  if (suffix) d.suffix = suffix
  const color = own(raw, 'color')
  if (COLOR_NAMES.includes(color as ColorName)) d.color = color as ColorName
  const style = pickOf(DISPLAY_STYLES, own(raw, 'style'))
  if (style) d.style = style
  return Object.keys(d).length ? d : undefined
}

function sanitizeScripts(raw: unknown): CustomPropScripts | undefined {
  if (!isObj(raw)) return undefined
  const s: CustomPropScripts = {}
  for (const k of SCRIPT_KEYS) {
    const code = own(raw, k)
    if (typeof code === 'string' && code.trim()) s[k] = code.slice(0, KIT_LIMITS.script)
  }
  return Object.keys(s).length ? s : undefined
}

const ratingOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : undefined)

/** A clean copy of an own property type, or null. */
export function sanitizePropType(id: unknown, raw: unknown): CustomPropType | null {
  const entry = entryOf(id, raw)
  if (!entry) return null
  const r = raw as Record<string, unknown>
  const base = pickOf(CUSTOM_BASES, own(r, 'base'))
  if (!base) return null
  const t: CustomPropType = { ...entry, base }
  if (base === 'select' || base === 'multi_select') {
    const listId = idOrNull(own(r, 'listId'))
    if (listId) t.listId = listId
  }
  const numberFormat = pickOf(NUMBER_FORMATS, own(r, 'numberFormat'))
  if (numberFormat) t.numberFormat = numberFormat
  const numberDisplay = pickOf(NUMBER_DISPLAYS, own(r, 'numberDisplay'))
  if (numberDisplay) t.numberDisplay = numberDisplay
  const ratingMax = ratingOf(own(r, 'ratingMax'))
  if (ratingMax) t.ratingMax = ratingMax
  const display = sanitizeDisplay(own(r, 'display'))
  if (display) t.display = display
  const scripts = sanitizeScripts(own(r, 'scripts'))
  if (scripts) t.scripts = scripts
  return t
}

function sanitizeRecordProp(raw: unknown): RecordTypeProp | null {
  if (!isObj(raw)) return null
  const id = own(raw, 'id')
  const name = oneLine(own(raw, 'name'), KIT_LIMITS.name)
  const type = pickOf(RECORD_PROP_TYPES, own(raw, 'type'))
  if (!isSafeKitId(id) || !name || !type) return null
  const p: RecordTypeProp = { id, name, type }
  const custom = idOrNull(own(raw, 'custom'))
  if (custom) p.custom = custom
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    const listId = type === 'status' ? null : idOrNull(own(raw, 'listId'))
    if (listId) p.listId = listId
    p.options = sanitizeOptions(own(raw, 'options'), KIT_LIMITS.items, type === 'status')
  }
  const numberFormat = type === 'number' ? pickOf(NUMBER_FORMATS, own(raw, 'numberFormat')) : undefined
  if (numberFormat) p.numberFormat = numberFormat
  const ratingMax = type === 'rating' ? ratingOf(own(raw, 'ratingMax')) : undefined
  if (ratingMax) p.ratingMax = ratingMax
  const rel = type === 'relation' ? idOrNull(own(raw, 'relationDatabaseId')) : null
  if (rel) p.relationDatabaseId = rel
  const description = own(raw, 'description')
  if (typeof description === 'string' && description.trim()) p.description = description.slice(0, KIT_LIMITS.description)
  return p
}

function sanitizeContent(raw: unknown): JSONContent | null {
  if (!isObj(raw) || own(raw, 'type') !== 'doc') return null
  try {
    const json = JSON.stringify(raw)
    return json.length <= KIT_LIMITS.content ? (JSON.parse(json) as JSONContent) : null
  } catch {
    return null
  }
}

/** A clean copy of a record type, or null. */
export function sanitizeRecordType(id: unknown, raw: unknown): RecordType | null {
  const entry = entryOf(id, raw)
  if (!entry) return null
  const r = raw as Record<string, unknown>
  const properties: RecordTypeProp[] = []
  const seen = new Set<string>()
  for (const x of Array.isArray(own(r, 'properties')) ? (own(r, 'properties') as unknown[]) : []) {
    if (properties.length >= KIT_LIMITS.properties) break
    const p = sanitizeRecordProp(x)
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    properties.push(p)
  }
  const t: RecordType = { ...entry, properties }
  const color = own(r, 'color')
  if (COLOR_NAMES.includes(color as ColorName)) t.color = color as ColorName
  const content = sanitizeContent(own(r, 'content'))
  if (content) t.content = content
  return t
}

type Sanitizer<T> = (id: unknown, raw: unknown) => T | null

function sanitizeMap<T>(raw: unknown, clean: Sanitizer<T>): { map: Record<ID, T>; dropped: number } {
  const map: Record<ID, T> = {}
  let dropped = 0
  if (raw === undefined || raw === null) return { map, dropped }
  if (!isObj(raw)) return { map, dropped: 1 }
  let n = 0
  for (const id of Object.keys(raw)) {
    const v = n < KIT_LIMITS.entries ? clean(id, own(raw, id)) : null
    if (v) {
      map[id] = v
      n++
    } else dropped++
  }
  return { map, dropped }
}

export const KIT_SANITIZERS = { lists: sanitizeList, propTypes: sanitizePropType, recordTypes: sanitizeRecordType } as const
export type KitPart = keyof Kit

/** Every valid building block of a stored / imported kit (`dropped`: entries that were not valid). */
export function sanitizeKit(raw: unknown): { kit: Kit; dropped: number } {
  const src = isObj(raw) ? raw : {}
  let dropped = raw !== undefined && raw !== null && !isObj(raw) ? 1 : 0
  const kit = emptyKit()
  for (const part of Object.keys(KIT_SANITIZERS) as KitPart[]) {
    const r = sanitizeMap(own(src, part), KIT_SANITIZERS[part] as Sanitizer<never>)
    ;(kit as unknown as Record<KitPart, Record<ID, unknown>>)[part] = r.map
    dropped += r.dropped
  }
  return { kit, dropped }
}

/** Two building blocks hold the same definition (ignoring updatedAt). */
export function sameKitEntry<T extends KitEntry>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}

/* ------------------------------------------------------------------ keeping databases in step (pure) */

/** A list's items as a property's options (fresh copies). */
export const optionsOfList = (list: OptionList): SelectOption[] => list.items.map((o) => ({ id: o.id, name: o.name, color: o.color }))

/** The stored type of a property of an own type ('free' → 'text'). */
export const storedTypeOf = (base: CustomPropBase): PropertyType => (base === 'free' ? 'text' : base)

/**
 * A database property for a record type's property (new id; `fromType` links it). Options come from its
 * list when it has one; an own type's defaults fill what the record property leaves open.
 */
export function propertyFromRecordProp(rt: RecordType, rp: RecordTypeProp, kit: Kit, id: ID): PropertyDef {
  const def: PropertyDef = { id, name: rp.name, type: rp.type, fromType: { id: rt.id, prop: rp.id } }
  fillFromRecordProp(def, rp, kit)
  return def
}

/** Bring a linked property's definition in line with its record property (its type never changes). */
export function fillFromRecordProp(def: PropertyDef, rp: RecordTypeProp, kit: Kit): void {
  def.name = rp.name
  const own = rp.custom ? kit.propTypes[rp.custom] : undefined
  if (own && storedTypeOf(own.base) === def.type) def.custom = own.id
  else delete def.custom
  if (rp.description) def.description = rp.description
  else delete def.description
  if (def.type === 'select' || def.type === 'multi_select' || def.type === 'status') {
    const listId = rp.listId ?? own?.listId ?? null
    const list = listId ? kit.lists[listId] : undefined
    if (list && def.type !== 'status') {
      def.listId = list.id
      def.options = optionsOfList(list)
    } else {
      delete def.listId
      def.options = (rp.options ?? []).map((o) => ({ ...o }))
    }
  }
  if (def.type === 'number') {
    const f = rp.numberFormat ?? own?.numberFormat
    if (f) def.numberFormat = f
    if (own?.numberDisplay) def.numberDisplay = own.numberDisplay
  }
  if (def.type === 'rating') {
    const max = rp.ratingMax ?? own?.ratingMax
    if (max) def.ratingMax = max
  }
  if (def.type === 'relation' && rp.relationDatabaseId) def.relationDatabaseId = rp.relationDatabaseId
}

/**
 * Bring `db` in step with record type `rt` (mutates; for an immer draft): every record property gets its
 * linked database property (created when missing — then shown in every view), linked ones follow names /
 * options / formats. A record property that is gone leaves its database property in place, unlinked —
 * values are never dropped here. Returns the ids of created properties.
 */
export function syncRecordTypeInto(db: Database, rt: RecordType, kit: Kit, newPropId: () => ID): ID[] {
  const created: ID[] = []
  const wanted = new Set(rt.properties.map((p) => p.id))
  for (const def of db.properties) {
    if (def.fromType?.id === rt.id && !wanted.has(def.fromType.prop)) delete def.fromType
  }
  for (const rp of rt.properties) {
    const def = db.properties.find((d) => d.fromType?.id === rt.id && d.fromType.prop === rp.id)
    if (def) fillFromRecordProp(def, rp, kit)
    else {
      const id = newPropId()
      db.properties.push(propertyFromRecordProp(rt, rp, kit, id))
      for (const v of db.views) if (!v.visibleProperties.includes(id)) v.visibleProperties.push(id)
      created.push(id)
    }
  }
  if (!(db.recordTypes ?? []).includes(rt.id)) db.recordTypes = [...(db.recordTypes ?? []), rt.id]
  return created
}
