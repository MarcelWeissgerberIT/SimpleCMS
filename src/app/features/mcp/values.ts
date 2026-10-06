/**
 * One MCP — workspace data in the friendly JSON shapes of docs/API.md: properties by NAME, option
 * names, ISO dates, people and related rows as objects. Computed values (formula, rollup) come as
 * the app shows them — the browser can compute them, the team server's API cannot.
 */
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed, selectBreadcrumbs } from '../../store/selectors'
import type { Database, ID, Page, PageIcon, PropertyDef } from '../../store/types'
import { propertyValueToText, typeOfRow } from '../../database'
import { isSettable } from '../ai/agent/props'

export const ws = () => useWorkspace.getState()

/** A tool call the agent has to fix: the message goes back as the tool error. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

export const q = (s: string) => JSON.stringify(s)
export const titleOf = (p: Page | undefined) => p?.title.trim() || 'Untitled'
export const iso = (ms: number) => new Date(ms).toISOString()

/** A page that exists and is not in the trash (nor under a trashed page). */
export function live(id: ID | undefined | null): Page | null {
  if (!id) return null
  const { pages } = ws()
  const p = pages[id]
  return p && !p.trashed && !isEffectivelyTrashed(pages, id) ? p : null
}

export function kindOf(p: Page): 'page' | 'database' | 'row' {
  return p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page'
}

/** "Team wiki / Onboarding" — the page's ancestors ('' at the top level). */
export function pathOf(id: ID): string {
  return selectBreadcrumbs(ws().pages, id)
    .slice(0, -1)
    .map((p) => titleOf(p))
    .join(' / ')
}

/** "🚀" · "lucide:Rocket" · "asset:compass" · null */
export function iconText(icon: PageIcon | null | undefined): string | null {
  if (!icon) return null
  return icon.type === 'emoji' ? icon.value : `${icon.type}:${icon.value}`
}

/** Link that opens the page in this One (works in the agent's answer). */
export function pageUrl(id: ID): string {
  return `${window.location.origin}${window.location.pathname}#/p/${id}`
}

export function rowsOf(dbId: ID): Page[] {
  return Object.values(ws().pages)
    .filter((p) => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

export function databaseOrThrow(id: unknown): { db: Database; page: Page } {
  const raw = typeof id === 'string' ? id.trim() : ''
  if (!raw) throw new McpToolError('Missing required parameter "databaseId".')
  const { databases } = ws()
  let page = live(raw)
  // lenient: an exact database title works too
  if (!page || !databases[page.id]) {
    const hits = Object.values(databases)
      .map((d) => live(d.id))
      .filter((p): p is Page => !!p && p.title.trim().toLowerCase() === raw.toLowerCase())
    page = hits.length === 1 ? hits[0] : null
  }
  if (!page || !databases[page.id]) throw new McpToolError(`No database with id ${q(raw)}. Use one_list_databases to get database ids.`)
  return { db: databases[page.id], page }
}

const READ_ONLY_TYPES = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

/** One property value as JSON (see docs/API.md § Property values). */
export function friendlyValue(db: Database, prop: PropertyDef, row: Page): unknown {
  const v = row.properties[prop.id]
  const { pages, people } = ws()
  switch (prop.type) {
    case 'title':
      return row.title
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' && v ? v : null
    case 'number':
    case 'rating':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'checkbox':
      return v === true
    case 'select':
    case 'status':
      return prop.options?.find((o) => o.id === v)?.name ?? null
    case 'multi_select':
      return Array.isArray(v) ? v.map((id) => prop.options?.find((o) => o.id === id)?.name).filter((n): n is string => !!n) : []
    case 'date':
      return v && typeof v === 'object' && !Array.isArray(v) && typeof v.start === 'string' ? { start: v.start, end: v.end ?? null } : null
    case 'person':
      return Array.isArray(v) ? v.map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? id })) : []
    case 'relation':
      return Array.isArray(v) ? v.filter((id) => live(id)).map((id) => ({ id, title: titleOf(pages[id]) })) : []
    case 'files':
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    case 'created_time':
      return iso(row.createdAt)
    case 'last_edited_time':
      return iso(row.updatedAt)
    case 'unique_id': {
      if (typeof v !== 'number') return null
      return prop.idPrefix ? `${prop.idPrefix}-${v}` : v
    }
    default: {
      // formula, rollup, created_by, last_edited_by: as the app shows them
      const text = propertyValueToText(db, prop, row)
      return text || null
    }
  }
}

/** Every property of a row except the title, by name. */
export function rowProperties(db: Database, row: Page): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of db.properties) {
    if (prop.type === 'title') continue
    try {
      out[prop.name] = friendlyValue(db, prop, row)
    } catch {
      out[prop.name] = null
    }
  }
  return out
}

export function rowJson(db: Database, row: Page) {
  // its record type by name (database/model/recordTypes), only when it has one
  const rt = typeOfRow(row, useWorkspace.getState().kit)
  return { id: row.id, title: row.title, url: pageUrl(row.id), ...(rt ? { recordType: rt.name } : {}), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), properties: rowProperties(db, row) }
}

/** A property definition in the shape of the API's schema (docs/API.md, server schemaOut) + what the app knows. */
export function propertyJson(db: Database, prop: PropertyDef) {
  const out: Record<string, unknown> = { id: prop.id, name: prop.name, type: prop.type, readOnly: prop.type !== 'title' && (READ_ONLY_TYPES.has(prop.type) || !isSettable(prop)) }
  if (prop.options) out.options = prop.options.map((o) => ({ id: o.id, name: o.name, color: o.color, ...(o.group ? { group: o.group } : {}) }))
  if (prop.type === 'relation' && prop.relationDatabaseId) {
    out.relationDatabaseId = prop.relationDatabaseId
    out.relationDatabaseTitle = live(prop.relationDatabaseId) ? titleOf(ws().pages[prop.relationDatabaseId]) : '(not available)'
    out.twoWay = !!pairOf(db.id, prop)
  }
  if (prop.type === 'unique_id' && prop.idPrefix) out.prefix = prop.idPrefix
  if (prop.type === 'rating') out.max = prop.ratingMax ?? 5
  if (prop.type === 'number' && prop.numberFormat && prop.numberFormat !== 'number') out.format = prop.numberFormat
  if (prop.type === 'formula' && prop.formula) out.formula = prop.formula
  if (prop.description) out.description = prop.description
  return out
}

/** Two-way relations are paired by id: the reverse property is `<forward id>.2way` (database/model/actions.ts). */
export const TWO_WAY_SUFFIX = '.2way'

function pairOf(dbId: ID, prop: PropertyDef): PropertyDef | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return null
  const target = ws().databases[prop.relationDatabaseId]
  const back = target?.properties.find((p) => p.id === prop.id + TWO_WAY_SUFFIX || (prop.id.endsWith(TWO_WAY_SUFFIX) && p.id === prop.id.slice(0, -TWO_WAY_SUFFIX.length)))
  return back && back.type === 'relation' && back.relationDatabaseId === dbId ? back : null
}

/** Comparable texts of a friendly value (filters, sorting). */
export function comparable(v: unknown): string[] {
  if (v === null || v === undefined || v === '') return []
  if (Array.isArray(v)) return v.flatMap((x) => comparable(x))
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.start === 'string') return [o.start]
    if (typeof o.title === 'string') return [o.title]
    if (typeof o.name === 'string') return [o.name]
    return []
  }
  return [String(v)]
}
