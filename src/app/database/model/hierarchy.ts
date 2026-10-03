/**
 * Row hierarchies inside one database:
 *  - sub-items: "Parent item" ↔ "Sub-items"
 *  - dependencies: "Blocked by" ↔ "Blocking" (timeline)
 * Both are two-way self-relation pairs (see TWO_WAY_SUFFIX in actions.ts), so writeValue keeps
 * their two sides in sync. This module adds the rules on top: a row has at most one parent, and
 * neither hierarchy may loop back on itself. It only reads the store (no imports from actions.ts).
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import type { Database, ID, Page, PropertyDef } from '../../store/types'

export interface SubItemsPair {
  parent: PropertyDef
  children: PropertyDef
}

export interface DependencyPair {
  blockedBy: PropertyDef
  blocking: PropertyDef
  onConflict: 'shift' | 'warn'
}

const ws = () => useWorkspace.getState()

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
export function invalidTargets(dbId: ID, prop: PropertyDef, rowId: ID): Set<ID> | null {
  const s = ws()
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

/**
 * Called by writeValue before a relation is written: drops links that would loop (with a toast),
 * keeps one parent per row, and lets a row that becomes someone's sub-item leave its old parent.
 * Returns the value to write.
 */
export function constrainRelationWrite(dbId: ID, prop: PropertyDef, rowId: ID, before: ID[], next: ID[]): ID[] {
  const s = ws()
  const db = s.databases[dbId]
  const role = hierarchyRole(db, prop.id)
  if (!role) return next
  const bad = invalidTargets(dbId, prop, rowId) ?? new Set<ID>()
  const added = next.filter((id) => !before.includes(id))
  const rejected = added.filter((id) => bad.has(id))
  let out = [...new Set(next.filter((id) => !rejected.includes(id)))]
  if (rejected.length) useUI.getState().toast({ message: t(role === 'parent' || role === 'children' ? 'database.sub.loop' : 'database.dep.loop'), kind: 'error' })
  if (role === 'parent' && out.length > 1) {
    // one parent per row: the one just picked wins
    const fresh = out.filter((id) => !before.includes(id))
    out = [fresh.length ? fresh[fresh.length - 1] : out[0]]
  }
  if (role === 'children') {
    const sub = subItemsOf(db)!
    for (const c of out) {
      if (before.includes(c)) continue
      const cur = s.pages[c]?.properties[sub.parent.id]
      const olds = Array.isArray(cur) ? cur.filter((x) => x !== rowId) : []
      if (!olds.length) continue
      for (const o of olds) {
        const list = ws().pages[o]?.properties[sub.children.id]
        if (Array.isArray(list) && list.includes(c)) s.setRowProperty(o, sub.children.id, list.filter((x) => x !== c))
      }
      s.setRowProperty(c, sub.parent.id, (cur as ID[]).filter((x) => x === rowId))
    }
  }
  return out
}
