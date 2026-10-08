/**
 * Workspace agent — row keys (rules: store/keys.ts) as the staging tools see them: which row holds which key value
 * once the changes staged so far are applied (live rows, their pending updates, the rows staged in this run), and
 * the refusal of a value another row holds. Model-facing messages (English).
 */
import { keyPropOf, keyText } from '../../../store/keys'
import type { Database, ID, Page, PropertyDef } from '../../../store/types'
import { unlocked } from '../../agents/integrations/status'
import type { PropChange, StagedChange } from './types'

export interface KeyHolder {
  /** a live row's id, or the id a staged row gets */
  id: ID
  title: string
  /** the staged change that gives the row this value (a pending create_row, or the update_row of a live row) */
  change?: StagedChange
}

const open = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'

/** The value a staged property change writes (option changes are never keys). */
export const intentValue = (pc: PropChange | undefined): unknown => (pc?.intent.kind === 'value' ? pc.intent.value : undefined)

/** Key text → who holds it once the open changes are applied (rows without a value are left out). */
export function keyHolders(changes: StagedChange[], dbId: ID, prop: Pick<PropertyDef, 'id' | 'type'>, pages: Record<ID, Page>): Map<string, KeyHolder[]> {
  const out = new Map<string, KeyHolder[]>()
  const add = (k: string, h: KeyHolder) => {
    if (!k) return
    const list = out.get(k)
    if (list) list.push(h)
    else out.set(k, [h])
  }
  // a live row's pending update that sets the property wins over its stored value
  const updates = new Map<ID, StagedChange>()
  for (const c of changes) if (c.kind === 'update_row' && open(c) && c.databaseId === dbId && c.props?.some((p) => p.propId === prop.id)) updates.set(c.pageId, c)
  for (const row of Object.values(pages)) {
    if (row.databaseId !== dbId || row.trashed) continue
    const u = updates.get(row.id)
    const v = u ? intentValue(u.props!.find((p) => p.propId === prop.id)) : row.properties[prop.id]
    add(keyText(prop.type, v), { id: row.id, title: row.title.trim(), ...(u ? { change: u } : {}) })
  }
  for (const c of changes) {
    if (c.kind !== 'create_row' || !open(c) || c.databaseId !== dbId) continue
    add(keyText(prop.type, intentValue(c.props?.find((p) => p.propId === prop.id))), { id: c.pageId, title: (c.title ?? '').trim(), change: c })
  }
  return out
}

const q = (s: string) => JSON.stringify(s)

/** "the row "Login fails" (id: …)" / "the row "…" staged as change #4". */
export function holderText(h: KeyHolder): string {
  const name = `the row ${q(h.title || 'Untitled')}`
  return h.change?.kind === 'create_row' ? `${name} staged as change #${h.change.n}` : `${name} (id: ${h.id})`
}

/**
 * The refusal of a write that would give the database's key a value another row holds (null: fine). `changes` are the
 * property changes of the write, `self` the row written (null: a new row).
 */
export function keyConflict(all: StagedChange[], db: Database, changes: PropChange[], self: ID | null, pages: Record<ID, Page>): string | null {
  const key = keyPropOf(db)
  if (!key) return null
  const pc = changes.find((c) => c.propId === key.id)
  const k = keyText(key.type, intentValue(pc))
  if (!k) return null
  // keeping the value a row holds already is no conflict
  if (self && pages[self]?.databaseId === db.id && keyText(key.type, pages[self].properties[key.id]) === k) return null
  const other = (keyHolders(all, db.id, key, pages).get(k) ?? []).find((h) => h.id !== self)
  if (!other) return null
  return `"${key.name}" is this database's key — unique per row — and ${holderText(other)} has ${q(k)} already. Nothing was staged. Change that row instead (update_row${unlocked('upsert') ? `, or upsert_rows by "${key.name}"` : ''}).`
}
