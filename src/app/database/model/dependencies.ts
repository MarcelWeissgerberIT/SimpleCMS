/**
 * Dependency scheduling: conflicts (a dependent starting before its blocker ends) and shifting
 * dependents later when a blocker moves past them. Day granularity; durations are preserved.
 */
import { differenceInCalendarDays } from 'date-fns'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import type { DateValue, ID, Page, PropertyDef } from '../../store/types'
import { isDateValue, parseLocal, shiftDateValue } from './format'
import { writeValue } from './actions'
import { dependenciesOf, linkedIds, type DependencyPair } from './hierarchy'

const ws = () => useWorkspace.getState()

/** Start and (inclusive) end day of a date value. */
export function spanOf(v: unknown): { start: Date; end: Date } | null {
  if (!isDateValue(v)) return null
  const start = parseLocal((v as DateValue).start)
  if (!start) return null
  const end = parseLocal((v as DateValue).end ?? null)
  return { start, end: end && end >= start ? end : start }
}

/** A dependent must start after the day its blocker ends. */
export function isViolated(blockerEnd: Date, dependentStart: Date): boolean {
  return differenceInCalendarDays(dependentStart, blockerEnd) < 1
}

/**
 * After `rowId`'s dates changed: move every (transitive) dependent that now starts too early
 * to the day after its blocker ends. Returns the dependents' previous values (for undo).
 * A loop in the data cannot spin forever: the number of moves is bounded.
 */
export function shiftDependents(dbId: ID, dateProp: PropertyDef, pair: DependencyPair, rowId: ID): Array<{ id: ID; before: DateValue }> {
  const pages = ws().pages
  // blocker → dependents, from the "blocked by" side (the source of truth for arrows too)
  const dependents = new Map<ID, ID[]>()
  for (const p of Object.values(pages) as Page[]) {
    if (p.databaseId !== dbId || p.trashed) continue
    for (const b of linkedIds(pages, p, pair.blockedBy.id)) dependents.set(b, [...(dependents.get(b) ?? []), p.id])
  }
  const before = new Map<ID, DateValue>()
  const queue: ID[] = [rowId]
  let budget = Math.max(64, dependents.size * 8)
  while (queue.length && budget > 0) {
    const id = queue.shift()!
    const span = spanOf(ws().pages[id]?.properties[dateProp.id])
    if (!span) continue
    for (const depId of dependents.get(id) ?? []) {
      if (depId === rowId) continue
      const dv = ws().pages[depId]?.properties[dateProp.id]
      const ds = spanOf(dv)
      if (!ds || !isViolated(span.end, ds.start)) continue
      const delta = differenceInCalendarDays(span.end, ds.start) + 1
      if (!before.has(depId)) before.set(depId, dv as DateValue)
      writeValue(dbId, dateProp, depId, shiftDateValue(dv as DateValue, delta))
      queue.push(depId)
      budget--
    }
  }
  return [...before].map(([id, v]) => ({ id, before: v }))
}

/**
 * A row's dates were moved by the user (timeline / calendar drag): with "shift dependents" on,
 * push its dependents later and offer undo in a toast. No-op without dependencies.
 */
export function afterDateMove(dbId: ID, dateProp: PropertyDef, rowId: ID): void {
  const dep = dependenciesOf(ws().databases[dbId])
  if (!dep || dep.onConflict !== 'shift' || dateProp.type !== 'date') return
  const moved = shiftDependents(dbId, dateProp, dep, rowId)
  if (!moved.length) return
  useUI.getState().toast({
    message: t(`database.dep.shifted.${moved.length === 1 ? 'one' : 'other'}`, { count: moved.length }),
    action: { label: t('common.undo'), run: () => moved.forEach((x) => writeValue(dbId, dateProp, x.id, x.before)) },
  })
}
