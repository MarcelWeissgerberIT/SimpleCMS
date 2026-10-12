/**
 * Row hierarchies inside one database:
 *  - sub-items: "Parent item" ↔ "Sub-items"
 *  - dependencies: "Blocked by" ↔ "Blocking" (timeline)
 * Both are two-way self-relation pairs (see TWO_WAY_SUFFIX in hierarchyCore.ts), so writeValue keeps
 * their two sides in sync. This module adds the rules of a write on top: a row has at most one parent,
 * and neither hierarchy may loop back on itself. The pure half (pairs, links, what a cell must not link
 * to over any state) is hierarchyCore.ts, re-exported here. No imports from actions.ts.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import type { ID, PropertyDef } from '../../store/types'
import { dependenciesOf, hierarchyRole, invalidTargetsIn, subItemsOf } from './hierarchyCore'

export { subItemsOf, dependenciesOf, hierarchyRole, parentIdOf, linkedIds, ancestorsOf, descendantsOf, invalidTargetsIn } from './hierarchyCore'
export type { SubItemsPair, DependencyPair } from './hierarchyCore'

const ws = () => useWorkspace.getState()

/**
 * Rows a relation cell of `rowId` must not link to, because the hierarchy would loop:
 * parent ← itself or any of its sub-items · sub-item ← itself or any ancestor ·
 * blocked by ← itself or anything it (transitively) blocks · blocking ← itself or its blockers.
 * Null for properties no hierarchy manages.
 */
export function invalidTargets(dbId: ID, prop: PropertyDef, rowId: ID): Set<ID> | null {
  return invalidTargetsIn(ws(), dbId, prop, rowId)
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
