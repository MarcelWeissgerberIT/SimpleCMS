/**
 * One MCP — two-way relations stay out of MCP until T-b (the owner's decision, Weg 4; the shared rule and its words:
 * src/shared/mcp/twoWay.ts, the team server's too). A value of a two-way relation — an explicit pair, a sub-items or a
 * dependencies pair — would write the linked rows as well; it is refused at plan time (assertOneWayInput, before any
 * card) and again right before the call writes (assertOneWayStage: a relation made two-way while the card waited).
 * A one-way relation is fine.
 */
import type { Database, ID, PropertyDef } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import { findProp } from '../ai/agent/props'
import { isTwoWay, twoWayValueRefusal } from '../../../shared/mcp/twoWay'
import { McpToolError, ws } from './values'

/** Is this property of `db` two-way? `databases`: the schema to read (one_create_database: as it will be). */
export function twoWayProp(db: Database, prop: PropertyDef, databases: Record<ID, Database> = ws().databases): boolean {
  const target = prop.relationDatabaseId ? databases[prop.relationDatabaseId] : undefined
  return isTwoWay(db.id, prop, db, target?.properties ?? null)
}

/** Refuse a row's `properties` (name or id → value, as the call sent them) that set or clear a two-way relation. */
export function assertOneWayInput(db: Database, props: Record<string, unknown> | undefined, path: string, databases?: Record<ID, Database>): void {
  for (const key of Object.keys(props ?? {})) {
    const prop = findProp(db, key)
    if (prop && twoWayProp(db, prop, databases)) throw new McpToolError(twoWayValueRefusal(`${path}.${prop.name}`, prop.name))
  }
}

/** The refusal of the first staged row value on a two-way relation (null: none) — the schema as it is now. */
export function twoWayStaged(changes: readonly StagedChange[]): string | null {
  const { pages, databases } = ws()
  for (const c of changes) {
    if (c.kind !== 'create_row' && c.kind !== 'update_row') continue
    const dbId = c.kind === 'create_row' ? c.databaseId : pages[c.pageId]?.databaseId
    const db = dbId ? databases[dbId] : undefined
    if (!db) continue
    for (const pc of c.props ?? []) {
      const prop = db.properties.find((p) => p.id === pc.propId)
      if (prop && twoWayProp(db, prop, databases)) return twoWayValueRefusal(`properties.${prop.name}`, prop.name)
    }
  }
  return null
}

/** Refuse a stage holding a two-way value (right before the call writes: made two-way while the card waited). */
export function assertOneWayStage(changes: readonly StagedChange[]): void {
  const why = twoWayStaged(changes)
  if (why) throw new McpToolError(why)
}
