/**
 * Row keys and "Only by hand" on the server — the app's rules (src/app/store/keys.ts), keep the two in step:
 *  - a database's key is its first property flagged `key: true` of type text, number or url; its values are unique
 *    among the database's rows that are not in the trash (empty allowed). Values compare as stored: text and urls
 *    trimmed and exact, numbers numerically.
 *  - `agentReadOnly: true` on a writable property: agents (server agents, MCP clients) never write it.
 * Every write of a row value through the API's paths refuses a key another row holds (409 duplicate_key).
 */
import { ApiError } from '../errors.ts'
import { type PropertyDef, type Roots, rowsOf } from './meta.ts'

export const KEY_TYPES = new Set(['text', 'number', 'url'])
const COMPUTED = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'])

export const canBeKey = (p: Pick<PropertyDef, 'type'>): boolean => KEY_TYPES.has(p.type)

export function keyPropOf(props: PropertyDef[]): PropertyDef | undefined {
  return props.find((p) => p.key === true && canBeKey(p))
}

export const isHandOnly = (p: PropertyDef): boolean => p.agentReadOnly === true && p.type !== 'title' && !COMPUTED.has(p.type)

/** A key value as it compares ('' = empty). */
export function keyText(type: string, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (type === 'number') {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN
    if (Number.isFinite(n)) return String(n)
    return typeof v === 'string' ? v.trim() : ''
  }
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

/** Another row of the database (not `except`) holding this key value, or null. */
export function keyOwner(r: Roots, dbId: string, prop: PropertyDef, value: unknown, except: string | null): { id: string; title: string } | null {
  const k = keyText(prop.type, value)
  if (!k) return null
  const hit = rowsOf(r, dbId).find((row) => row.id !== except && keyText(prop.type, row.properties[prop.id]) === k)
  return hit ? { id: hit.id, title: hit.title } : null
}

/**
 * Refuse stored values that give the database's key a value another row holds (409 duplicate_key). `self`: the row
 * written (null: a new row) — keeping the value it holds already is fine.
 */
export function checkKey(r: Roots, dbId: string, props: PropertyDef[], values: Record<string, unknown>, self: string | null, current?: Record<string, unknown>): void {
  const key = keyPropOf(props)
  if (!key || !(key.id in values)) return
  if (self && current && keyText(key.type, current[key.id]) === keyText(key.type, values[key.id])) return
  const owner = keyOwner(r, dbId, key, values[key.id], self)
  if (!owner) return
  const value = keyText(key.type, values[key.id])
  throw new ApiError(409, 'duplicate_key', `${key.name}: "${value}" is this database's key, and the row "${owner.title.trim() || 'Untitled'}" (id ${owner.id}) has it already — a key is unique per row`, {
    details: { errors: [{ property: key.name, message: 'duplicate key', value, rowId: owner.id }] },
  })
}

/** The refusal of a property only people fill in, for an agent's or MCP client's write. */
export const handOnlyMessage = (p: Pick<PropertyDef, 'name'>) => `${p.name}: filled in only by hand ("Only by hand") — agents never write it; leave it out`
