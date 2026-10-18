/**
 * One MCP — two-way relations stay out of MCP until T-b (the owner's decision, Weg 4): a value of a two-way relation
 * writes the linked rows too — an explicit pair (`<id>.2way` on the related database, the app's enableTwoWay) or the
 * sub-items / dependencies pair of a database — and `twoWay: true` adds a reverse property to another database. Both are
 * refused over MCP, on the local bridge and on the team server alike, with these words (code `refused_type`); a one-way
 * relation is fine. Pure: each side passes its own schema in.
 */
import { mcpError } from './errors.ts'

/** The id of a relation's reverse side (database/model/hierarchyCore.ts TWO_WAY_SUFFIX, server api/meta.ts). */
export const TWO_WAY_SUFFIX = '.2way'

/** What the rule reads of a property. */
export interface RelationShape {
  id: string
  type: string
  relationDatabaseId?: string | null
}

/** A database's sub-items / dependencies settings as stored (Database.subItems / .dependencies). */
export interface HierarchyShape {
  subItems?: unknown
  dependencies?: unknown
}

const HIERARCHY_KEYS = ['parentPropertyId', 'childPropertyId', 'blockedByPropertyId', 'blockingPropertyId'] as const

/** Is `propId` one side of the database's sub-items or dependencies pair (switched on or not — the pair stays a pair)? */
function inHierarchy(h: HierarchyShape | null | undefined, propId: string): boolean {
  for (const cfg of [h?.subItems, h?.dependencies]) {
    if (!cfg || typeof cfg !== 'object') continue
    for (const k of HIERARCHY_KEYS) if ((cfg as Record<string, unknown>)[k] === propId) return true
  }
  return false
}

/**
 * Is `prop` (a property of database `dbId`) two-way: its partner on the related database (`<id>.2way`, or the forward
 * side of a `.2way` property), or one side of the database's sub-items / dependencies pair? `targetProps`: the related
 * database's properties (null: it is gone — no partner there).
 */
export function isTwoWay(dbId: string, prop: RelationShape, hierarchy: HierarchyShape | null | undefined, targetProps: readonly RelationShape[] | null | undefined): boolean {
  if (prop.type !== 'relation') return false
  if (inHierarchy(hierarchy, prop.id)) return true
  const partner = (p: RelationShape | undefined) => !!p && p.id !== prop.id && p.type === 'relation' && p.relationDatabaseId === dbId
  const props = targetProps ?? []
  if (partner(props.find((p) => p.id === prop.id + TWO_WAY_SUFFIX))) return true
  return prop.id.endsWith(TWO_WAY_SUFFIX) && partner(props.find((p) => p.id === prop.id.slice(0, -TWO_WAY_SUFFIX.length)))
}

/** The next step of a refused two-way value. */
const VALUE_NEXT = 'A one-way relation is fine; leave this property out, or ask the person to set it in One.'

/** The refusal of a value (or a clearing) of a two-way relation: `path` = the argument (`rows[2].properties.Parent item`). */
export const twoWayValueRefusal = (path: string, name: string): string =>
  mcpError('refused_type', path, `${JSON.stringify(name)} is two-way (or a sub-items / dependencies pair); set it in One`, VALUE_NEXT)

/** The refusal of `twoWay: true` (one_create_property, one_create_database): `path` = `relation.twoWay` … */
export const twoWayArgRefusal = (path: string): string =>
  mcpError('refused_type', path, 'two-way relations are set up in One; over MCP a relation is one-way', 'Leave out twoWay (a one-way relation is fine), or ask the person to make it two-way in One.')
