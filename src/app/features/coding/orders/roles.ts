/**
 * The chain roles on a pipeline project (features/coding/schema.ts codingProps) — display only: never part of a task
 * version (trust.ts fieldsKey), never what the chain engine follows (this device's record is). Pure (a Node spec reads it).
 *
 *  - `order` ("Prüfauftrag"): a relation whose relationDatabaseId is a work-orders database — found only by that, never
 *    by its name or its type alone (the first such relation).
 *  - `step` ("Schritt"): a number property found only by its name (EN "Step" / DE "Schritt") and only next to `order`.
 *    The Cost role's fallback by type skips a property of that name (isStepNamed).
 */
import type { ID, PropertyDef } from '../../../store/types'

export type ChainRole = 'order' | 'step'

/** Is this property named like the Step role (`names`: its names in every language, trimmed + lower case)? */
export const isStepNamed = (p: Pick<PropertyDef, 'name'>, names: readonly string[]): boolean => names.includes(p.name.trim().toLowerCase())

/**
 * The chain roles of a project's properties. `isOrdersDb`: is this database a work-orders one (Database.system
 * 'workorders'); `stepNames`: the Step role's names, trimmed + lower case.
 */
export function chainRolesOf(properties: readonly PropertyDef[], isOrdersDb: (dbId: ID) => boolean, stepNames: readonly string[]): Partial<Record<ChainRole, ID>> {
  const order = properties.find((p) => p.type === 'relation' && !!p.relationDatabaseId && isOrdersDb(p.relationDatabaseId))
  if (!order) return {}
  const step = properties.find((p) => p.type === 'number' && p.id !== order.id && isStepNamed(p, stepNames))
  return step ? { order: order.id, step: step.id } : { order: order.id }
}
