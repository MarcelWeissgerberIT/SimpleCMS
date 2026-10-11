/**
 * The row patch after a send (a route's `after`): typed values only, written ONLY once the slip is sent — one
 * version ("Outbox · <route>", aiWrite with reason 'outbox') and one Undo: "Reset row" puts back the value before,
 * only where the value is still the one the Outbox wrote (a person's later change is kept, and named). A property
 * marked "Only by hand" is refused (struck through on the slip); so is an unknown one or a value of the wrong type.
 * The patch is the person's action: no `agent:` stamp, row triggers behave as for a person's edit.
 */
import { useWorkspace } from '../../store/store'
import type { Database, ID, PropertyDef, PropertyValue, RouteAfter } from '../../store/types'
import { aiWrite } from '../history/snapshots'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { propByRef } from './routes'
import type { AfterEntry, Receipt } from './types'

const ws = () => useWorkspace.getState()

/** A route's value as the property's stored value (null: refused for this type). */
function storedValue(prop: PropertyDef, v: RouteAfter['value']): PropertyValue | undefined {
  if (v === null) return null
  switch (prop.type) {
    case 'checkbox':
      return typeof v === 'boolean' ? v : undefined
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    case 'select':
    case 'status': {
      if (typeof v !== 'string') return undefined
      const o = prop.options?.find((x) => x.name === v) ?? prop.options?.find((x) => x.name.toLowerCase() === v.toLowerCase())
      return o ? o.id : undefined
    }
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v) ? { start: v } : undefined
    default:
      return undefined
  }
}

export const sameValue = (a: PropertyValue | null | undefined, b: PropertyValue | null | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The route's `after` against a row: what would be written, and what is refused (and why). */
export function resolveAfter(list: RouteAfter[] | undefined, db: Database | undefined, rowId: ID, roles: Record<string, string[]>): AfterEntry[] {
  const row = ws().pages[rowId]
  return (list ?? []).map((a) => {
    const prop = propByRef(db, a.property, roles)
    if (!prop || !row) return { ref: a.property, propId: null, name: a.property, before: null, after: a.value, refused: 'unknown' as const }
    const before = row.properties[prop.id] ?? null
    if (prop.agentReadOnly) return { ref: a.property, propId: prop.id, name: prop.name, before, after: a.value, refused: 'handOnly' as const }
    const after = storedValue(prop, a.value)
    if (after === undefined) return { ref: a.property, propId: prop.id, name: prop.name, before, after: a.value, refused: 'type' as const }
    return { ref: a.property, propId: prop.id, name: prop.name, before, after }
  })
}

/**
 * Write the patch (after 'sent'): an entry whose value the person changed since staging is skipped and named. One
 * version, labelled with the route.
 */
export function applyAfter(rowId: ID, entries: AfterEntry[], label: string): Receipt['rowPatch'] {
  const applied: Receipt['rowPatch']['applied'] = []
  const skipped: string[] = []
  const s = ws()
  const row = s.pages[rowId]
  if (!row || row.trashed || useCloud.getState().readOnly) return { applied, skipped: entries.filter((e) => !e.refused).map((e) => e.name) }
  aiWrite(
    () => {
      for (const e of entries) {
        if (e.refused || !e.propId) continue
        const now = ws().pages[rowId]?.properties[e.propId] ?? null
        if (!sameValue(now, e.before)) {
          skipped.push(e.name)
          continue
        }
        if (sameValue(now, e.after)) continue
        ws().setRowProperty(rowId, e.propId, e.after)
        applied.push({ propId: e.propId, before: e.before, after: e.after })
      }
    },
    { reason: 'outbox', by: label },
  )
  return { applied, skipped }
}

/** "Reset row": the values before, only where the Outbox's value is still there. Returns the properties left as they are. */
export function resetPatch(rowId: ID, patch: Receipt['rowPatch']): { reset: number; kept: string[] } {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  const kept: string[] = []
  let reset = 0
  if (!row || row.trashed) return { reset, kept: patch.applied.map((a) => db?.properties.find((p) => p.id === a.propId)?.name ?? a.propId) }
  aiWrite(
    () => {
      for (const a of patch.applied) {
        const now = ws().pages[rowId]?.properties[a.propId] ?? null
        const name = db?.properties.find((p) => p.id === a.propId)?.name ?? a.propId
        if (!sameValue(now, a.after)) {
          kept.push(name)
          continue
        }
        ws().setRowProperty(rowId, a.propId, a.before)
        reset++
      }
    },
    { reason: 'outbox', by: t('features.outbox.reset.version') },
  )
  return { reset, kept }
}
