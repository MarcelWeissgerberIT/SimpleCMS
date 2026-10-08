/**
 * Row keys and "Only by hand" in the database UI (rules: store/keys.ts):
 *  - setKeyProperty: make a text / number / url property the database's key (the old key stops being one) — refused
 *    on a locked database and while rows share a value;
 *  - setHandOnly: agents never write the property;
 *  - keyClash: what a person typed into the key column of these rows that another row holds already.
 */
import { useWorkspace } from '../../store/store'
import { canBeHandOnly, canBeKey, keyDuplicates, keyOwner, keyPropOf, keyText } from '../../store/keys'
import type { Database, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { isDbReadOnly } from '../readonly'

const ws = () => useWorkspace.getState()

export type KeyResult = { ok: true } | { ok: false; reason: 'locked' | 'type' | 'duplicates'; value?: string; count?: number }

/** Turn the key flag of a property on or off. */
export function setKeyProperty(dbId: ID, propId: ID, on: boolean): KeyResult {
  const db = ws().databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop || isDbReadOnly()) return { ok: false, reason: 'locked' }
  if (db.locked) return { ok: false, reason: 'locked' }
  if (!on) {
    if (prop.key) ws().updateProperty(dbId, propId, { key: undefined })
    return { ok: true }
  }
  if (!canBeKey(prop)) return { ok: false, reason: 'type' }
  const dupes = keyDuplicates(ws().pages, dbId, prop, 1)
  if (dupes.length) return { ok: false, reason: 'duplicates', value: dupes[0].value, count: dupes[0].rows.length }
  // at most one key per database: the old one stops being the key
  for (const p of db.properties) if (p.key && p.id !== propId) ws().updateProperty(dbId, p.id, { key: undefined })
  if (!prop.key) ws().updateProperty(dbId, propId, { key: true })
  return { ok: true }
}

/** Turn "Only by hand" on or off (false: refused — locked database or a property no one writes). */
export function setHandOnly(dbId: ID, propId: ID, on: boolean): boolean {
  const db = ws().databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop || db.locked || isDbReadOnly() || (on && !canBeHandOnly(prop))) return false
  if (!!prop.agentReadOnly !== on) ws().updateProperty(dbId, propId, { agentReadOnly: on ? true : undefined })
  return true
}

/**
 * A key value a person enters into `rowIds` that would not be unique: another row holds it (`row`), or it would go
 * into several rows at once (`row` null). Null: fine (not the key, empty, or unchanged).
 */
export function keyClash(db: Database, prop: PropertyDef, rowIds: ID[], value: PropertyValue): { value: string; row: Page | null } | null {
  const live = ws().databases[db.id] ?? db
  if (keyPropOf(live)?.id !== prop.id) return null
  const k = keyText(prop.type, value)
  if (!k) return null
  const pages = ws().pages
  // the value a row holds already is no clash (a legacy duplicate is not made worse by keeping it)
  const changing = rowIds.filter((id) => keyText(prop.type, pages[id]?.properties[prop.id]) !== k)
  if (!changing.length) return null
  if (rowIds.length > 1) return { value: k, row: null }
  const owner = keyOwner(pages, db.id, prop, value, rowIds[0])
  return owner ? { value: k, row: owner } : null
}
