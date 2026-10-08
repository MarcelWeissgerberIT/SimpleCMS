/**
 * Row keys and "Only by hand" (PropertyDef.key / agentReadOnly) — pure rules shared by the store's readers, the
 * database UI, the agents' tools, the MCP bridge and the person's cell commit:
 *
 *  - a key is a text, number or url property, at most one per database; its values are unique per database among
 *    the rows that are not in the trash (empty is allowed, as often as needed). Values compare as stored: text and
 *    urls trimmed and exact, numbers numerically ("8215" = 8215 = "8215.0" for a number key).
 *  - "Only by hand" fits every property a value can be written into (never the title or a computed one).
 *
 * Nothing here writes; the sanitizer returns fresh objects only when it changed something.
 */
import type { Database, ID, Page, PropertyDef, PropertyType } from './types'

/** Property types that can be a database's key. */
export const KEY_TYPES: readonly PropertyType[] = ['text', 'number', 'url']

/** Computed types: no one writes them, so "Only by hand" has nothing to protect. */
const COMPUTED: ReadonlySet<PropertyType> = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

export const canBeKey = (p: Pick<PropertyDef, 'type'>): boolean => KEY_TYPES.includes(p.type)
export const canBeHandOnly = (p: Pick<PropertyDef, 'type'>): boolean => p.type !== 'title' && !COMPUTED.has(p.type)

/** The database's key property (the first flagged one of a key type), if any. */
export function keyPropOf(db: Pick<Database, 'properties'> | null | undefined): PropertyDef | undefined {
  return db?.properties.find((p) => p.key === true && canBeKey(p))
}

/** Is this property protected from agents ("Only by hand")? */
export const isHandOnly = (p: Pick<PropertyDef, 'type' | 'agentReadOnly'>): boolean => p.agentReadOnly === true && canBeHandOnly(p)

/**
 * A key value as it compares ('' = empty): numbers numerically (a number key also reads "8215" as 8215), text and
 * urls trimmed and exact.
 */
export function keyText(type: PropertyType, v: unknown): string {
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

/** The rows of a database that hold a key (not in the trash). */
const keyRows = (pages: Record<ID, Page>, dbId: ID) => Object.values(pages).filter((p) => p.databaseId === dbId && !p.trashed)

/** Key text → the rows holding it (rows without a value are left out). */
export function keyIndex(pages: Record<ID, Page>, dbId: ID, prop: Pick<PropertyDef, 'id' | 'type'>): Map<string, Page[]> {
  const out = new Map<string, Page[]>()
  for (const row of keyRows(pages, dbId)) {
    const k = keyText(prop.type, row.properties[prop.id])
    if (!k) continue
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

/** Another row (not `except`) holding this key value already, or undefined (an empty value never clashes). */
export function keyOwner(pages: Record<ID, Page>, dbId: ID, prop: Pick<PropertyDef, 'id' | 'type'>, value: unknown, except?: ID | null): Page | undefined {
  const k = keyText(prop.type, value)
  if (!k) return undefined
  return keyRows(pages, dbId).find((row) => row.id !== except && keyText(prop.type, row.properties[prop.id]) === k)
}

/** Values more than one row holds (the first `max`): turning a property into the key refuses them. */
export function keyDuplicates(pages: Record<ID, Page>, dbId: ID, prop: Pick<PropertyDef, 'id' | 'type'>, max = 3): Array<{ value: string; rows: Page[] }> {
  const out: Array<{ value: string; rows: Page[] }> = []
  for (const [value, rows] of keyIndex(pages, dbId, prop)) {
    if (rows.length < 2) continue
    out.push({ value, rows })
    if (out.length >= max) break
  }
  return out
}

/**
 * Readers (stored records, the team meta document): `key` only on a key type and only once per database,
 * `agentReadOnly` only as `true` on a writable property. Returns the same list when nothing had to change.
 */
export function sanitizePropFlags(props: PropertyDef[]): PropertyDef[] {
  let keyed = false
  let changed = false
  const out = props.map((p) => {
    const rec = p as PropertyDef & { key?: unknown; agentReadOnly?: unknown }
    let next: PropertyDef = p
    if ('key' in rec && rec.key !== undefined) {
      const keep = rec.key === true && canBeKey(p) && !keyed
      if (keep) keyed = true
      else {
        const { key: _k, ...rest } = next
        next = rest
      }
    }
    if ('agentReadOnly' in rec && rec.agentReadOnly !== undefined && !(rec.agentReadOnly === true && canBeHandOnly(p))) {
      const { agentReadOnly: _a, ...rest } = next
      next = rest
    }
    if (next !== p) changed = true
    return next
  })
  return changed ? out : props
}
