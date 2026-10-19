/**
 * Record types over MCP on the team server (the app's building blocks: meta map 'recordTypes', docs/CLOUD.md § Meta
 * document schema) — what one_move_row needs, as the app's adoptRowType does it (database/model/recordTypes.ts +
 * store/kit.ts syncRecordTypeInto / fillFromRecordProp): a row of a type its new database does not hold brings the type
 * along — the type's properties are added there (or brought in line where the database has them already) and the
 * database holds the type — or, when the type is gone, the row stays plain. A locked database takes no type (its
 * schema would change). Pure over the meta document's roots; the writes happen in the caller's transaction.
 */
import * as Y from 'yjs'
import { type PropertyDef, type Roots, kitEntry } from '../api/meta.ts'
import { newId } from '../tokens.ts'
import { propsMapOf, nextPropOrder } from './writes.ts'

interface RecordProp {
  id: string
  name: string
  type: string
  custom?: string | null
  listId?: string | null
  options?: Array<{ id: string; name: string; color?: string; group?: string }>
  numberFormat?: string
  ratingMax?: number
  relationDatabaseId?: string
  description?: string
}

export interface RecordTypeInfo {
  id: string
  name: string
  properties: RecordProp[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** A record type of the workspace's building blocks, or null (gone, or not readable). */
export function recordTypeOf(r: Roots, id: string | null | undefined): RecordTypeInfo | null {
  const e = kitEntry(r, 'recordTypes', id)
  if (!e || typeof e.name !== 'string') return null
  const properties = (Array.isArray(e.properties) ? e.properties : []).filter((p): p is RecordProp => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.type === 'string')
  return { id: id!, name: e.name, properties }
}

/** The record types a database holds (its `recordTypes`). */
export const heldTypes = (ydb: Y.Map<unknown>): string[] => {
  const v = ydb.get('recordTypes')
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** A database property brought in line with its record property (store/kit.ts fillFromRecordProp; its type never changes). */
function fill(r: Roots, def: PropertyDef & Record<string, unknown>, rp: RecordProp): void {
  def.name = rp.name
  const own = rp.custom ? kitEntry(r, 'propTypes', rp.custom) : null
  const base = own && typeof own.base === 'string' ? (own.base === 'free' ? 'text' : own.base) : null
  if (own && base === def.type) def.custom = rp.custom!
  else delete def.custom
  if (rp.description) def.description = rp.description
  else delete def.description
  if (def.type === 'select' || def.type === 'multi_select' || def.type === 'status') {
    const listId = rp.listId ?? str(own?.listId) ?? null
    const list = listId ? kitEntry(r, 'lists', listId) : null
    if (list && Array.isArray(list.items) && def.type !== 'status') {
      def.listId = listId!
      def.options = (list.items as unknown[]).filter(isObj).map((o) => ({ id: String(o.id), name: String(o.name), color: String(o.color ?? 'gray') }))
    } else {
      delete def.listId
      def.options = (rp.options ?? []).map((o) => ({ ...o })) as PropertyDef['options']
    }
  }
  if (def.type === 'number') {
    const f = rp.numberFormat ?? str(own?.numberFormat)
    if (f) def.numberFormat = f
    if (own?.numberDisplay) def.numberDisplay = own.numberDisplay
  }
  if (def.type === 'rating') {
    const max = rp.ratingMax ?? (typeof own?.ratingMax === 'number' ? own.ratingMax : undefined)
    if (max) def.ratingMax = max
  }
  if (def.type === 'relation' && rp.relationDatabaseId) def.relationDatabaseId = rp.relationDatabaseId
}

/**
 * Attach a record type to a database (store.ts attachRecordType → kit.ts syncRecordTypeInto): every record property
 * linked by `fromType`, new ones added (shown in every view), the type held. Returns the names of the properties added.
 */
export function attachRecordType(r: Roots, ydb: Y.Map<unknown>, rt: RecordTypeInfo): string[] {
  const pm = propsMapOf(ydb)
  const defs = [...pm.entries()].filter(([, v]) => isObj(v)).map(([id, v]) => ({ id, def: JSON.parse(JSON.stringify(v)) as PropertyDef & Record<string, unknown> }))
  const wanted = new Set(rt.properties.map((p) => p.id))
  for (const { id, def } of defs) {
    const from = def.fromType as { id?: string; prop?: string } | undefined
    if (from?.id === rt.id && !wanted.has(from.prop ?? '')) {
      delete def.fromType
      pm.set(id, def)
    }
  }
  const added: string[] = []
  for (const rp of rt.properties) {
    const hit = defs.find(({ def }) => (def.fromType as { id?: string; prop?: string } | undefined)?.id === rt.id && (def.fromType as { prop?: string }).prop === rp.id)
    if (hit) {
      fill(r, hit.def, rp)
      pm.set(hit.id, hit.def)
      continue
    }
    const id = newId()
    const def = { id, name: rp.name, type: rp.type, fromType: { id: rt.id, prop: rp.id } } as PropertyDef & Record<string, unknown>
    fill(r, def, rp)
    pm.set(id, { ...def, order: nextPropOrder(ydb) })
    const views = ydb.get('views')
    if (views instanceof Y.Map)
      for (const [vid, v] of (views as Y.Map<unknown>).entries()) {
        if (!isObj(v)) continue
        const visible = Array.isArray(v.visibleProperties) ? (v.visibleProperties as string[]) : []
        if (!visible.includes(id)) (views as Y.Map<unknown>).set(vid, JSON.parse(JSON.stringify({ ...v, visibleProperties: [...visible, id] })))
      }
    added.push(rp.name)
  }
  if (!heldTypes(ydb).includes(rt.id)) ydb.set('recordTypes', [...heldTypes(ydb), rt.id])
  return added
}
