/**
 * One MCP — property specs as one_create_property and one_create_database take them: validated for a database that
 * exists or is about to (its id and title known), the reverse side of a two-way relation included; the card's lines.
 */
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { ID, PropertyDef, PropertyType } from '../../store/types'
import { MCP_PROPERTY_TYPES } from './contract'
import { databaseOrThrow, McpToolError, q, titleOf, TWO_WAY_SUFFIX, ws } from './values'
import { optionsOf, str, type PlanLine } from './plan'
import { systemOf, systemRefusal, TWO_WAY_SYSTEM } from './system'

export interface PropSpec {
  def: PropertyDef
  /** two-way relation: the reverse property to add on the target database */
  reverse?: { dbId: ID; def: PropertyDef }
  lines: PlanLine[]
}

/** Validate one property spec (create_property, create_database) for a database (existing or new). */
export function propertySpec(raw: unknown, ctx: { dbId: ID; dbTitle: string; taken: string[] }, key = 'property'): PropSpec {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null
  if (!o) throw new McpToolError(`${key} must be an object {name, type, options?, relation?}.`)
  const name = str(o.name, `${key}.name`, { required: true, max: 100 }).replace(/\s+/g, ' ').trim()
  if (ctx.taken.some((n) => n.toLowerCase() === name.toLowerCase())) throw new McpToolError(`${key}: a property named ${q(name)} already exists.`)
  const type = String(o.type ?? '') as PropertyType
  if (!(MCP_PROPERTY_TYPES as readonly string[]).includes(type)) throw new McpToolError(`${key}: unknown type ${q(String(o.type ?? ''))}. Use one of: ${MCP_PROPERTY_TYPES.join(', ')}.`)
  const def: PropertyDef = { id: newId(), name, type }
  const options = optionsOf(type, o.options, key)
  if (options) def.options = options
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.type'), value: type }]
  if (options?.length) lines.push({ k: 'fact', label: t('features.mcp.plan.options'), value: options.map((x) => x.name).join(', ') })
  let reverse: PropSpec['reverse']
  if (type === 'relation') {
    const rel = (o.relation && typeof o.relation === 'object' && !Array.isArray(o.relation) ? o.relation : null) as Record<string, unknown> | null
    if (!rel) throw new McpToolError(`${key}: a relation needs "relation": {"databaseId": …}.`)
    const self = str(rel.databaseId, `${key}.relation.databaseId`, { required: true, max: 80 }).trim() === ctx.dbId
    const target = self ? null : databaseOrThrow(rel.databaseId)
    const targetId = self ? ctx.dbId : target!.db.id
    const targetTitle = self ? ctx.dbTitle : titleOf(target!.page)
    def.relationDatabaseId = targetId
    lines.push({ k: 'fact', label: t('features.mcp.plan.relation'), value: targetTitle })
    if (rel.twoWay === true) {
      // the reverse side would change the schema of One's own database (read-only over MCP, spec § 3.3)
      const sys = self ? null : systemOf(targetId)
      if (sys) throw new McpToolError(systemRefusal(sys, `${key}.relation`, TWO_WAY_SYSTEM))
      if (target?.db.locked) throw new McpToolError(`${key}: ${q(targetTitle)} is locked, so no reverse property can be added there. Create a one-way relation instead.`)
      const reverseName = str(rel.reverseName, `${key}.relation.reverseName`, { max: 100 }).trim() || (self ? t('database.relation.reverseName', { name }) : ctx.dbTitle)
      if (!self && target!.db.properties.some((p) => p.name.toLowerCase() === reverseName.toLowerCase()))
        throw new McpToolError(`${key}: ${q(targetTitle)} already has a property named ${q(reverseName)}. Pass another "reverseName".`)
      reverse = { dbId: targetId, def: { id: def.id + TWO_WAY_SUFFIX, name: reverseName, type: 'relation', relationDatabaseId: ctx.dbId } }
      lines.push({ k: 'fact', label: t('features.mcp.plan.twoWay'), value: `${targetTitle} · ${reverseName}` })
    }
  } else if (o.relation !== undefined) throw new McpToolError(`${key}: "relation" only applies to type "relation".`)
  return { def, reverse, lines }
}

/** Add properties (and the reverse sides of two-way relations); returns the undo. */
export function addProperties(dbId: ID, specs: PropSpec[]): () => boolean {
  const added: Array<{ dbId: ID; id: ID }> = []
  for (const s of specs) {
    ws().addProperty(dbId, s.def)
    added.push({ dbId, id: s.def.id })
    if (s.reverse && ws().databases[s.reverse.dbId]) {
      ws().addProperty(s.reverse.dbId, s.reverse.def)
      added.push({ dbId: s.reverse.dbId, id: s.reverse.def.id })
    }
  }
  return () => {
    for (const a of added.reverse()) if (ws().databases[a.dbId]?.properties.some((p) => p.id === a.id)) ws().deleteProperty(a.dbId, a.id)
    return true
  }
}

