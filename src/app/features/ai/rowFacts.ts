/**
 * A database row's fields as request text (D-S2-28) — one function for retrieval (Ask the workspace) and autofill.
 * Without a shape (a route that sees everything) every field reads as it always did (propertyValueToText). For a route
 * that does not see everything:
 *  - people (when names are redacted): person values and Created / Last edited by → "@Person n" (the request's
 *    redactor — the same numbering as the mentions in its pages); a relation into a Contacts directory names people too;
 *  - a relation's title reaching a page the route may not see → "—";
 *  - a formula or rollup whose inputs touch such a field → "—" (its value could spell them out).
 */
import { redactPersonValue } from '@/shared/ai/redact'
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page, PropertyDef } from '../../store/types'
import { propertyValueToText } from '../../database'
import type { Shape } from './core/shape'

export interface FactsContext {
  /** the route's shape (null: it sees everything — every field as it is) */
  shape: Shape | null
  /** may the route see this page? */
  visible: (id: ID) => boolean
}

const HIDDEN = '—'

const PERSON_LIKE = new Set<PropertyDef['type']>(['person', 'created_by', 'last_edited_by'])
const personLike = (p: PropertyDef): boolean => PERSON_LIKE.has(p.type)

/** The ids a person-like field holds on a row. */
function personKeys(p: PropertyDef, row: Page): string[] {
  if (p.type === 'created_by') return row.createdBy ? [row.createdBy] : []
  if (p.type === 'last_edited_by') return row.updatedBy ? [row.updatedBy] : []
  const v = row.properties?.[p.id]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const relationIds = (p: PropertyDef | undefined, row: Page): ID[] => {
  const v = p ? row.properties?.[p.id] : undefined
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** One field as the route may receive it ('' = empty). */
function fieldText(db: Database, p: PropertyDef, row: Page, ctx: FactsContext, tainted: Set<ID>): string {
  const shape = ctx.shape
  const s = useWorkspace.getState()
  if (!shape) return safeText(db, p, row)
  const people = shape.o.people
  if (personLike(p)) return people ? personKeys(p, row).map((k) => redactPersonValue(k, shape.r)).join(', ') : safeText(db, p, row)
  if (p.type === 'relation') {
    const ids = relationIds(p, row)
    if (!ids.some((id) => !ctx.visible(id)) && !(people && contacts(p))) return safeText(db, p, row)
    return ids.map((id) => (!ctx.visible(id) ? HIDDEN : people && contacts(p) ? redactPersonValue(id, shape.r) : s.pages[id]?.title.trim() || 'Untitled')).join(', ')
  }
  if (p.type === 'formula' || p.type === 'rollup') return tainted.has(p.id) ? HIDDEN : safeText(db, p, row)
  return safeText(db, p, row)
}

const safeText = (db: Database, p: PropertyDef, row: Page): string => {
  try {
    return propertyValueToText(db, p, row)
  } catch {
    return ''
  }
}

/** A relation into a Contacts directory (features/mail/people.ts): its titles are people's names. */
function contacts(p: PropertyDef): boolean {
  const target = p.relationDatabaseId ? useWorkspace.getState().databases[p.relationDatabaseId] : undefined
  return target?.system === 'mail-contacts'
}

/** The fields whose value the route may not read whole (person-like when names are redacted, relations reaching an
 *  unseen page) — and the formulas / rollups that read them. */
function taintedFields(db: Database, row: Page, ctx: FactsContext): Set<ID> {
  const out = new Set<ID>()
  const shape = ctx.shape
  if (!shape) return out
  for (const p of db.properties) {
    if (personLike(p) && shape.o.people) out.add(p.id)
    if (p.type === 'relation' && (relationIds(p, row).some((id) => !ctx.visible(id)) || (shape.o.people && contacts(p)))) out.add(p.id)
  }
  // rollups: their relation, or a person-like / unseen target (read on the related database)
  for (const p of db.properties) {
    if (p.type !== 'rollup' || !p.rollup) continue
    const rel = db.properties.find((x) => x.id === p.rollup!.relationPropertyId)
    const target = rel?.relationDatabaseId ? useWorkspace.getState().databases[rel.relationDatabaseId]?.properties.find((x) => x.id === p.rollup!.targetPropertyId) : undefined
    if (!rel || out.has(rel.id) || (target && personLike(target) && shape.o.people) || target?.type === 'relation' || target?.type === 'formula' || target?.type === 'rollup') out.add(p.id)
  }
  // formulas: any reference to a tainted field (by name or id) — formulas reading formulas, repeated until stable
  for (let changed = true; changed; ) {
    changed = false
    for (const p of db.properties) {
      if (p.type !== 'formula' || out.has(p.id)) continue
      const expr = p.formula ?? ''
      if ([...out].some((id) => {
        const f = db.properties.find((x) => x.id === id)
        return !!f && (expr.includes(f.id) || expr.includes(f.name))
      })) {
        out.add(p.id)
        changed = true
      }
    }
  }
  return out
}

/** The row's fields (title, files and `skip` left out) as the route may receive them; empty ones left out. */
export function rowFactsFor(db: Database, row: Page, ctx: FactsContext, skip?: ID | null): Array<{ name: string; value: string }> {
  const tainted = taintedFields(db, row, ctx)
  const out: Array<{ name: string; value: string }> = []
  for (const p of db.properties) {
    if (p.type === 'title' || p.type === 'files' || p.id === skip) continue
    const value = fieldText(db, p, row, ctx, tainted)
    if (value.trim()) out.push({ name: p.name, value })
  }
  return out
}

/** Every field of the row (title and files left out) as the route may receive it, by property id. */
export function rowFieldsFor(db: Database, row: Page, ctx: FactsContext): Map<ID, string> {
  const tainted = taintedFields(db, row, ctx)
  const out = new Map<ID, string>()
  for (const p of db.properties) if (p.type !== 'title' && p.type !== 'files') out.set(p.id, fieldText(db, p, row, ctx, tainted))
  return out
}

/** The related rows a row's request names (relations' targets the route may see) — the request's sources too. */
export function relatedRows(db: Database, row: Page, ctx: FactsContext): ID[] {
  const ids = new Set<ID>()
  for (const p of db.properties) if (p.type === 'relation') for (const id of relationIds(p, row)) if (ctx.visible(id)) ids.add(id)
  return [...ids]
}
