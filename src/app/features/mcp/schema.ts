/**
 * One MCP — property specs as one_create_property and one_create_database take them: validated for a database that
 * exists or is about to (its id and title known), the reverse side of a two-way relation included; the card's lines.
 */
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { ID, PropertyDef, PropertyType, SelectOption } from '../../store/types'
import { MCP_DEFAULT_STATUS, MCP_PROPERTY_TYPES } from './contract'
import { databaseOrThrow, McpToolError, q, titleOf, TWO_WAY_SUFFIX, ws } from './values'
import { mcpError } from '../../../shared/mcp/errors'
import { optionsOf, str, type PlanLine } from './plan'
import { systemOf, systemRefusal, TWO_WAY_SYSTEM } from './system'
import { valueKey } from '../ai/agent/follow'
import { propertyRefs, withoutProperty } from '../../database'
import { MCP_LIMITS } from '../../../shared/mcp/tables'

export interface PropSpec {
  def: PropertyDef
  /** two-way relation: the reverse property to add on the target database */
  reverse?: { dbId: ID; def: PropertyDef }
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
  let reverse: PropSpec['reverse']
  if (type === 'relation') {
    const rel = (o.relation && typeof o.relation === 'object' && !Array.isArray(o.relation) ? o.relation : null) as Record<string, unknown> | null
    if (!rel) throw new McpToolError(mcpError('bad_argument', at('relation'), 'a relation needs "relation": {"databaseId": …}'))
    const self = str(rel.databaseId, at('relation.databaseId'), { required: true, max: 80 }).trim() === ctx.dbId
    const target = self ? null : databaseOrThrow(rel.databaseId)
    const targetId = self ? ctx.dbId : target!.db.id
    const targetTitle = self ? ctx.dbTitle : titleOf(target!.page)
    def.relationDatabaseId = targetId
    lines.push({ k: 'fact', label: t('features.mcp.plan.relation'), value: targetTitle })
    if (rel.twoWay === true) {
      // the reverse side would change the schema of One's own database (read-only over MCP, spec § 3.3)
      const sys = self ? null : systemOf(targetId)
      if (sys) throw new McpToolError(systemRefusal(sys, at('relation'), TWO_WAY_SYSTEM))
      if (target?.db.locked) throw new McpToolError(mcpError('locked', at('relation.twoWay'), `${q(targetTitle)} is locked, so no reverse property can be added there`, 'Create a one-way relation instead.'))
      const reverseName = str(rel.reverseName, at('relation.reverseName'), { max: MCP_LIMITS.propertyName }).trim() || (self ? t('database.relation.reverseName', { name }) : ctx.dbTitle)
      if (!self && target!.db.properties.some((p) => p.name.toLowerCase() === reverseName.toLowerCase()))
        throw new McpToolError(mcpError('bad_argument', at('relation.reverseName'), `${q(targetTitle)} already has a property named ${q(reverseName)}`, 'Pass another "reverseName".'))
      reverse = { dbId: targetId, def: { id: def.id + TWO_WAY_SUFFIX, name: reverseName, type: 'relation', relationDatabaseId: ctx.dbId } }
      lines.push({ k: 'fact', label: t('features.mcp.plan.twoWay'), value: `${targetTitle} · ${reverseName}` })
    }
  } else if (o.relation !== undefined) throw new McpToolError(mcpError('bad_argument', at('relation'), '"relation" only applies to type "relation"'))
  return { def, reverse, lines }
}

/**
 * Does any row of the database hold a value in this property — rows in the trash too (deleting a property strips its
 * value from every row of the database, the trash included, so a value there is as much the person's) — other than the
 * one the call itself put there (`made`: row id → valueKey, e.g. the numbers a unique_id column was backfilled with)?
 */
export function holdsValues(dbId: ID, propId: ID, made?: ReadonlyMap<ID, string>): boolean {
  return Object.values(ws().pages).some((p) => {
    if (p.databaseId !== dbId) return false
    const v = valueKey(p.properties?.[propId])
    return v !== '' && v !== made?.get(p.id)
  })
}

/** The values a property holds right after the call added it (store.addProperty backfills a unique_id column). */
function valuesNow(dbId: ID, propId: ID): Map<ID, string> {
  const out = new Map<ID, string>()
  for (const p of Object.values(ws().pages)) if (p.databaseId === dbId && valueKey(p.properties?.[propId]) !== '') out.set(p.id, valueKey(p.properties[propId]))
  return out
}

/** The view settings that would point nowhere once the property goes (placement aside): filter, calculations, chart, card preview, colour rules … */
const VIEW_REFS = ['filter', 'sorts', 'groupBy', 'dateProperty', 'calculations', 'chart', 'cardPreview', 'colorRules'] as const

/**
 * What is built on a property besides its values: view settings naming it (filter, sort, grouping, date, chart,
 * calculations, card preview, colour rules, a feed's date, a free board's fields), a formula naming it, a rollup through
 * it or of it, autofill, an automation, a command (database/model/withoutProperty.ts).
 */
function builtOn(dbId: ID, propId: ID): string {
  const s = ws()
  const db = s.databases[dbId]
  if (!db) return ''
  const without = withoutProperty(db, propId).views
  const views = db.views.filter((v, i) => VIEW_REFS.some((k) => JSON.stringify(v[k] ?? null) !== JSON.stringify(without[i]?.[k] ?? null))).map((v) => v.id)
  return JSON.stringify([propertyRefs(db, s.databases, propId).sort(), views])
}

/** A property as a call left it: its definition, what was built on it, the values the call itself wrote into it. */
export interface PropMark {
  dbId: ID
  id: ID
  def: string
  refs: string
  made: Map<ID, string>
}

const defOf = (dbId: ID, propId: ID) => JSON.stringify(ws().databases[dbId]?.properties.find((p) => p.id === propId) ?? null)

export const propMark = (dbId: ID, propId: ID): PropMark => ({ dbId, id: propId, def: defOf(dbId, propId), refs: builtOn(dbId, propId), made: valuesNow(dbId, propId) })

/**
 * Changed since the call added it (spec § 3.2: an Undo leaves it alone): its database locked (a schema change there is
 * the person's to make), its definition changed (renamed, options, a formula …), something built on it since (a view's
 * filter / sort / group …, a formula, a rollup), or a value someone filled in (holdsValues). Gone: nothing to keep.
 */
export function propChangedSince(m: PropMark): boolean {
  const db = ws().databases[m.dbId]
  if (!db?.properties.some((p) => p.id === m.id)) return false
  return !!db.locked || defOf(m.dbId, m.id) !== m.def || builtOn(m.dbId, m.id) !== m.refs || holdsValues(m.dbId, m.id, m.made)
}

/** Delete a property the call added — and any view setting still pointing at it (as one_delete_property clears them). */
export function dropProperty(dbId: ID, propId: ID): void {
  const db = ws().databases[dbId]
  if (!db?.properties.some((p) => p.id === propId)) return
  const clean = withoutProperty(db, propId).views
  ws().deleteProperty(dbId, propId)
  for (const v of ws().databases[dbId]?.views ?? []) {
    const c = clean.find((x) => x.id === v.id)
    if (!c) continue
    const patch: Record<string, unknown> = {}
    for (const k of VIEW_REFS) if (JSON.stringify(v[k] ?? null) !== JSON.stringify(c[k] ?? null)) patch[k] = c[k]
    if (Object.keys(patch).length) ws().updateView(dbId, v.id, patch)
  }
}

/**
 * Add properties (and the reverse sides of two-way relations); returns the undo. The Undo leaves a property changed
 * since alone (spec § 3.2; propChangedSince: filled in, renamed or set up, built on, its database locked) — with its
 * two-way partner, whose links mirror it — and then answers false. What the call itself wrote into a new column (a
 * unique_id column's numbers) is no filling in: such a column goes, and the database's counter goes back while nothing
 * took a number since.
 */
export function addProperties(dbId: ID, specs: PropSpec[]): () => boolean {
  const added: Array<Array<PropMark & { counter?: { before: number; after: number } }>> = []
  for (const s of specs) {
    const before = ws().databases[dbId]?.nextUniqueId
    ws().addProperty(dbId, s.def)
    const after = ws().databases[dbId]?.nextUniqueId
    const counter = s.def.type === 'unique_id' && typeof before === 'number' && typeof after === 'number' && after !== before ? { before, after } : undefined
    const pair: Array<PropMark & { counter?: { before: number; after: number } }> = [{ ...propMark(dbId, s.def.id), ...(counter ? { counter } : {}) }]
    if (s.reverse && ws().databases[s.reverse.dbId]) {
      ws().addProperty(s.reverse.dbId, s.reverse.def)
      pair.push(propMark(s.reverse.dbId, s.reverse.def.id))
    }
    added.push(pair)
  }
  return () => {
    let clean = true
    for (const pair of [...added].reverse()) {
      const there = pair.filter((a) => ws().databases[a.dbId]?.properties.some((p) => p.id === a.id))
      if (there.some(propChangedSince)) {
        clean = false
        continue
      }
      for (const a of [...there].reverse()) {
        dropProperty(a.dbId, a.id)
        // the numbers the column took: the counter goes back while nothing took one since
        if (a.counter && ws().databases[a.dbId]?.nextUniqueId === a.counter.after) ws().updateDatabase(a.dbId, { nextUniqueId: a.counter.before })
      }
    }
    return clean
  }
}
