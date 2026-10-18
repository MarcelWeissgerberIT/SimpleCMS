/**
 * One MCP — property specs as one_create_property and one_create_database take them: validated for a database that
 * exists or is about to (its id and title known); the card's lines. A relation is one-way over MCP: `twoWay: true` is
 * refused (the owner's decision until T-b — shared/mcp/twoWay.ts).
 */
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { ID, PropertyDef, PropertyType, SelectOption } from '../../store/types'
import { MCP_DEFAULT_STATUS, MCP_PROPERTY_TYPES } from './contract'
import { databaseOrThrow, McpToolError, q, titleOf, ws } from './values'
import { mcpError } from '../../../shared/mcp/errors'
import { optionsOf, str, type PlanLine } from './plan'
import { twoWayArgRefusal } from '../../../shared/mcp/twoWay'
import { MCP_LIMITS } from '../../../shared/mcp/tables'

export interface PropSpec {
  def: PropertyDef
  lines: PlanLine[]
}

/** The options a status property made over MCP without any gets: MCP_DEFAULT_STATUS (English, on both sides). */
export const mcpStatusOptions = (): SelectOption[] => MCP_DEFAULT_STATUS.map((o) => ({ id: newId(), name: o.name, color: o.color, group: o.group }))

/** Validate one property spec (create_property, create_database) for a database (existing or new). */
export function propertySpec(raw: unknown, ctx: { dbId: ID; dbTitle: string; taken: string[] }, key = ''): PropSpec {
  // the argument path of a part of the spec: `properties[2].type`, or `type` for one_create_property's own arguments
  const at = (k: string) => (key ? `${key}.${k}` : k)
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null
  if (!o) throw new McpToolError(mcpError('bad_argument', key, 'an object {name, type, options?, relation?} is expected'))
  const name = str(o.name, at('name'), { required: true, max: MCP_LIMITS.propertyName }).replace(/\s+/g, ' ').trim()
  if (ctx.taken.some((n) => n.toLowerCase() === name.toLowerCase())) throw new McpToolError(mcpError('bad_argument', at('name'), `a property named ${q(name)} already exists`, 'Pick another name, or use the existing property.'))
  const type = String(o.type ?? '') as PropertyType
  if (!(MCP_PROPERTY_TYPES as readonly string[]).includes(type)) throw new McpToolError(mcpError('bad_argument', at('type'), `unknown type ${q(String(o.type ?? ''))}`, `Use one of: ${MCP_PROPERTY_TYPES.join(', ')}.`))
  const def: PropertyDef = { id: newId(), name, type }
  // a status made without options gets the contract's default ones (the same words as on the team server)
  const options = optionsOf(type, o.options, at('options')) ?? (type === 'status' ? mcpStatusOptions() : undefined)
  if (options) def.options = options
  const lines: PlanLine[] = [{ k: 'fact', label: t('features.mcp.plan.type'), value: type }]
  if (options?.length) lines.push({ k: 'fact', label: t('features.mcp.plan.options'), value: options.map((x) => x.name).join(', ') })
  if (type === 'relation') {
    const rel = (o.relation && typeof o.relation === 'object' && !Array.isArray(o.relation) ? o.relation : null) as Record<string, unknown> | null
    if (!rel) throw new McpToolError(mcpError('bad_argument', at('relation'), 'a relation needs "relation": {"databaseId": …}'))
    // two-way relations stay out of MCP until T-b: the reverse side and the linked rows are set up in One
    if (rel.twoWay === true) throw new McpToolError(twoWayArgRefusal(at('relation.twoWay')))
    const self = str(rel.databaseId, at('relation.databaseId'), { required: true, max: 80 }).trim() === ctx.dbId
    const target = self ? null : databaseOrThrow(rel.databaseId)
    const targetId = self ? ctx.dbId : target!.db.id
    const targetTitle = self ? ctx.dbTitle : titleOf(target!.page)
    def.relationDatabaseId = targetId
    lines.push({ k: 'fact', label: t('features.mcp.plan.relation'), value: targetTitle })
  } else if (o.relation !== undefined) throw new McpToolError(mcpError('bad_argument', at('relation'), '"relation" only applies to type "relation"'))
  return { def, lines }
}

/** Add properties (its Undo is the call's, undo.ts). */
export function addProperties(dbId: ID, specs: PropSpec[]): void {
  for (const s of specs) ws().addProperty(dbId, s.def)
}
