/**
 * Row hierarchies inside one database — the pure half (hierarchy.ts re-exports it and adds the writes' rules):
 *  - sub-items: "Parent item" ↔ "Sub-items"
 *  - dependencies: "Blocked by" ↔ "Blocking" (timeline)
 * Both are two-way self-relation pairs (TWO_WAY_SUFFIX), so writeValue keeps their two sides in sync. Also the
 * relation checks the flight recorder's eject plans with: the paired partner of a relation and the rows a hierarchy
 * cell must not link to, both over a given state, and whether a restored relation value may go back. No store.
 */
import type { Database, ID, Page, PropertyDef, PropertyValue } from '../../store/types'

/**
 * Two-way relations are paired explicitly: turning two-way on creates the reverse property on the
 * target database with the id `<forward id>.2way`. Only such a pair syncs — two relations that
 * merely point at each other (created separately) stay independent, and switching two-way off can
 * only ever remove the property that two-way created or its explicit partner.
 */
export const TWO_WAY_SUFFIX = '.2way'

/** The explicit two-way partner of a relation property, in `databases`. */
export function pairedRelationIn(databases: Record<ID, Database>, dbId: ID, prop: PropertyDef): { db: Database; prop: PropertyDef } | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return null
  const target = databases[prop.relationDatabaseId]
  if (!target) return null
  const partner = (p: PropertyDef | undefined): p is PropertyDef => !!p && p.id !== prop.id && p.type === 'relation' && p.relationDatabaseId === dbId
  const back = target.properties.find((p) => p.id === prop.id + TWO_WAY_SUFFIX)
  if (partner(back)) return { db: target, prop: back }
  if (prop.id.endsWith(TWO_WAY_SUFFIX)) {
    const fwd = target.properties.find((p) => p.id === prop.id.slice(0, -TWO_WAY_SUFFIX.length))
    if (partner(fwd)) return { db: target, prop: fwd }
  }
  return null
}

export interface SubItemsPair {
  parent: PropertyDef
  children: PropertyDef
}

export interface DependencyPair {
  blockedBy: PropertyDef
  blocking: PropertyDef
  onConflict: 'shift' | 'warn'
}

function selfRelation(db: Database, id: ID | undefined): PropertyDef | undefined {
  return id ? db.properties.find((p) => p.id === id && p.type === 'relation' && p.relationDatabaseId === db.id) : undefined
}

/** The sub-items pair when the feature is on and both properties still exist. */
export function subItemsOf(db: Database | null | undefined): SubItemsPair | null {
  const c = db?.subItems
  if (!db || !c?.enabled) return null
  const parent = selfRelation(db, c.parentPropertyId)
  const children = selfRelation(db, c.childPropertyId)
  return parent && children ? { parent, children } : null
}

/** The dependency pair when the feature is on and both properties still exist. */
export function dependenciesOf(db: Database | null | undefined): DependencyPair | null {
  const c = db?.dependencies
  if (!db || !c?.enabled) return null
  const blockedBy = selfRelation(db, c.blockedByPropertyId)
  const blocking = selfRelation(db, c.blockingPropertyId)
  return blockedBy && blocking ? { blockedBy, blocking, onConflict: c.onConflict ?? 'shift' } : null
}

/** Is this one of the properties a hierarchy feature manages? */
export function hierarchyRole(db: Database | null | undefined, propId: ID): 'parent' | 'children' | 'blockedBy' | 'blocking' | null {
  const sub = subItemsOf(db)
  if (sub?.parent.id === propId) return 'parent'
  if (sub?.children.id === propId) return 'children'
  const dep = dependenciesOf(db)
  if (dep?.blockedBy.id === propId) return 'blockedBy'
  if (dep?.blocking.id === propId) return 'blocking'
  return null
}

const live = (pages: Record<ID, Page>, id: ID, dbId: ID | null) => {
  const p = pages[id]
  return !!p && !p.trashed && p.databaseId === dbId
}

/** A row's parent: the first linked live row of the same database (never the row itself). */
export function parentIdOf(pages: Record<ID, Page>, pair: SubItemsPair, row: Page): ID | null {
  const ids = row.properties[pair.parent.id]
  if (!Array.isArray(ids)) return null
  for (const id of ids) if (id !== row.id && live(pages, id, row.databaseId)) return id
  return null
}

/** Live linked ids of a relation value. */
export function linkedIds(pages: Record<ID, Page>, row: Page | undefined, propId: ID): ID[] {
  const ids = row?.properties[propId]
  return Array.isArray(ids) ? ids.filter((id) => id !== row!.id && live(pages, id, row!.databaseId)) : []
}

/** Rows of a database (not trashed). */
function rowsIn(pages: Record<ID, Page>, dbId: ID): Page[] {
  const out: Page[] = []
  for (const p of Object.values(pages)) if (p.databaseId === dbId && !p.trashed) out.push(p)
  return out
}

/** Everything reachable from `start` by following `next` (start excluded); loops end the walk. */
function reach(start: ID, next: (id: ID) => ID[]): Set<ID> {
  const out = new Set<ID>()
  const stack = [start]
  while (stack.length && out.size < 100_000) {
    for (const id of next(stack.pop()!)) {
      if (id === start || out.has(id)) continue
      out.add(id)
      stack.push(id)
    }
  }
  return out
}

/** Reverse adjacency of a relation over a database's rows: target → rows linking to it. */
function reverseIndex(pages: Record<ID, Page>, dbId: ID, propId: ID): Map<ID, ID[]> {
  const m = new Map<ID, ID[]>()
  for (const r of rowsIn(pages, dbId))
    for (const id of linkedIds(pages, r, propId)) {
      const list = m.get(id)
      if (list) list.push(r.id)
      else m.set(id, [r.id])
    }
  return m
}

/** Ancestors (parent, grandparent …) of a row. */
export function ancestorsOf(pages: Record<ID, Page>, pair: SubItemsPair, rowId: ID): Set<ID> {
  return reach(rowId, (id) => linkedIds(pages, pages[id], pair.parent.id))
}

/** All sub-items below a row (by the rows' parent links). */
export function descendantsOf(pages: Record<ID, Page>, pair: SubItemsPair, rowId: ID): Set<ID> {
  const row = pages[rowId]
  if (!row?.databaseId) return new Set()
  const kids = reverseIndex(pages, row.databaseId, pair.parent.id)
  return reach(rowId, (id) => kids.get(id) ?? [])
}

/**
 * Rows a relation cell of `rowId` must not link to, because the hierarchy would loop:
 * parent ← itself or any of its sub-items · sub-item ← itself or any ancestor ·
 * blocked by ← itself or anything it (transitively) blocks · blocking ← itself or its blockers.
 * Null for properties no hierarchy manages.
 */
export function invalidTargetsIn(s: { pages: Record<ID, Page>; databases: Record<ID, Database> }, dbId: ID, prop: PropertyDef, rowId: ID): Set<ID> | null {
  const db = s.databases[dbId]
  const role = hierarchyRole(db, prop.id)
  if (!role || !s.pages[rowId]) return null
  const pages = s.pages
  let out: Set<ID>
  if (role === 'parent' || role === 'children') {
    const sub = subItemsOf(db)!
    out = role === 'parent' ? descendantsOf(pages, sub, rowId) : ancestorsOf(pages, sub, rowId)
  } else {
    const dep = dependenciesOf(db)!
    if (role === 'blockedBy') {
      // what rowId blocks, transitively: rows whose "blocked by" chain reaches rowId
      const dependents = reverseIndex(pages, dbId, dep.blockedBy.id)
      out = reach(rowId, (id) => dependents.get(id) ?? [])
    } else out = reach(rowId, (id) => linkedIds(pages, pages[id], dep.blockedBy.id))
  }
  out.add(rowId)
  return out
}

const idsOf = (v: PropertyValue | undefined): ID[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is ID => typeof x === 'string') : [])

/**
 * May a restored relation value of `rowId` go back in the PLANNED state (the eject's plan: `planned` = the state with
 * what it decided so far; `back` = the rows that go back with it)? A paired two-way relation only when every partner
 * row whose back-link the value adds or drops goes back too (its own target restores its side from its pin — no row
 * outside the plan is written) — and, with `valueBack`, only when that partner's PAIRED value goes back too (a pair is
 * decided as one: never one side back and the other held). Sub-items and dependencies besides: no target the hierarchy
 * forbids in the planned state, one parent per row (a sub-item added under this row has no other parent there). Other
 * relations: always.
 */
export function relationRestoreOk(planned: { pages: Record<ID, Page>; databases: Record<ID, Database> }, dbId: ID, prop: PropertyDef, rowId: ID, value: PropertyValue, back: ReadonlySet<ID>, valueBack?: (rowId: ID, propId: ID) => boolean): boolean {
  if (prop.type !== 'relation') return true
  const row = planned.pages[rowId]
  if (!row) return false
  const before = new Set(idsOf(row.properties[prop.id]))
  const after = new Set(idsOf(value))
  const touched = [...after].filter((id) => !before.has(id)).concat([...before].filter((id) => !after.has(id)))
  const pair = pairedRelationIn(planned.databases, dbId, prop)
  if (pair && touched.some((id) => id !== rowId && (!back.has(id) || (valueBack && !valueBack(id, pair.prop.id))))) return false
  const db = planned.databases[dbId]
  const role = hierarchyRole(db, prop.id)
  if (!role) return true
  const added = [...after].filter((id) => !before.has(id))
  const bad = invalidTargetsIn(planned, dbId, prop, rowId) ?? new Set<ID>()
  if (added.some((id) => bad.has(id))) return false
  if (role === 'parent') return [...after].filter((id) => id !== rowId && live(planned.pages, id, row.databaseId)).length <= 1
  if (role === 'children') {
    const sub = subItemsOf(db)!
    // a sub-item added here keeps no other parent (the write would take it away from that one — a row outside the plan)
    return added.every((c) => idsOf(planned.pages[c]?.properties[sub.parent.id]).every((p) => p === rowId))
  }
  return true
}
