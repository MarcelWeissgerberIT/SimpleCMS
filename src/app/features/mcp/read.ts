/**
 * One MCP — the reading tools. Answers are JSON objects in the same shapes as the team server's
 * MCP endpoint (server/src/mcp/reads.ts); the bridge sends them to the agent as text. Limits keep
 * one answer well under what MCP clients accept.
 */
import { format } from 'date-fns'
import { useUI } from '../../store/ui'
import { inTemplate, selectBacklinks } from '../../store/selectors'
import type { Database, ID, Page, PropertyDef } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { parseHash } from '../../lib/router'
import { t } from '../../i18n'
import { retrieve, workspaceDocs } from '../ai/workspace'
import { MCP_FILTER_OPS, type McpAgentMode, type McpToolName } from './contract'
import { workspaceInfo } from './identity'
import { comparable, databaseOrThrow, friendlyValue, iconText, iso, kindOf, live, McpToolError, pageUrl, pathOf, propertyJson, q, rowJson, rowProperties, rowsOf, titleOf, ws } from './values'

/** Characters of page Markdown in one answer. */
export const MARKDOWN_MAX = 60_000

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function int(v: unknown, def: number, min: number, max: number, key: string): number {
  if (v === undefined || v === null || v === '') return def
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) throw new McpToolError(`"${key}" must be a number.`)
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const ref = (p: Page) => ({ id: p.id, title: titleOf(p), kind: kindOf(p) })

/* ------------------------------------------------------------------ */
/* one_overview                                                        */
/* ------------------------------------------------------------------ */

const TREE_TOP = 60
const TREE_CHILDREN = 15

function overview(mode: McpAgentMode) {
  const { pages, databases, people } = ws()
  const alive = Object.values(pages).filter((p) => live(p.id))
  const childrenOf = (id: ID | null) => alive.filter((p) => p.parentId === id && !p.databaseId && !p.hidden).sort((a, b) => a.order - b.order)
  const node = (p: Page, depth: number): Record<string, unknown> => {
    const out: Record<string, unknown> = ref(p)
    const icon = iconText(p.icon)
    if (icon) out.icon = icon
    if (p.kind === 'database') out.rows = rowsOf(p.id).length
    const kids = childrenOf(p.id)
    if (kids.length && depth < 1) {
      out.children = kids.slice(0, TREE_CHILDREN).map((c) => node(c, depth + 1))
      if (kids.length > TREE_CHILDREN) out.more = kids.length - TREE_CHILDREN
    } else if (kids.length) out.more = kids.length
    return out
  }
  const top = childrenOf(null)
  const route = parseHash(window.location.hash)
  const open = route.name === 'page' ? live(route.id) : null
  const peekId = useUI.getState().peekPageId
  const peek = peekId ? live(peekId) : null
  const now = new Date()
  const info = workspaceInfo()
  // template databases (features/templates) are not the workspace's data
  const dbs = Object.values(databases)
    .map((d) => live(d.id))
    .filter((p): p is Page => !!p && !inTemplate(pages, p.id))
    .map((p) => ({ id: p.id, title: titleOf(p), path: pathOf(p.id), rows: rowsOf(p.id).length }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.title.localeCompare(b.title))
  return {
    workspace: { id: info.id, name: info.name, kind: info.kind, url: `${window.location.origin}${window.location.pathname}` },
    access: mode === 'read' || info.readOnly ? 'read-only' : 'read-write',
    approval: mode === 'ask' ? 'Each change waits for the person to approve it in One.' : mode === 'apply' ? 'Changes are applied directly.' : 'Changes are refused (read only).',
    today: format(now, 'yyyy-MM-dd'),
    weekday: format(now, 'EEEE'),
    now: now.toISOString(),
    localTime: format(now, 'HH:mm'),
    language: ws().settings.language,
    openPage: open ? ref(open) : null,
    ...(peek ? { peekPage: ref(peek) } : {}),
    counts: {
      pages: alive.filter((p) => p.kind === 'page' && !p.databaseId).length,
      databases: dbs.length,
      rows: alive.filter((p) => !!p.databaseId).length,
    },
    pages: top.slice(0, TREE_TOP).map((p) => node(p, 0)),
    ...(top.length > TREE_TOP ? { morePages: top.length - TREE_TOP } : {}),
    databases: dbs,
    people: people.map((p) => ({ name: p.name })),
    hint: 'Ids come from here, one_search and one_list_databases. Rows live in databases: use one_query_database to list them.',
  }
}

/* ------------------------------------------------------------------ */
/* one_search                                                          */
/* ------------------------------------------------------------------ */

function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const words = [query, ...query.split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length > 2)
  const lower = flat.toLowerCase()
  let at = -1
  for (const w of words) {
    at = lower.indexOf(w)
    if (at >= 0) break
  }
  const start = Math.max(0, at < 0 ? 0 : at - 60)
  const s = flat.slice(start, start + 200)
  return `${start > 0 ? '…' : ''}${s}${start + 200 < flat.length ? '…' : ''}`
}

function search(args: Record<string, unknown>) {
  const query = str(args.query)
  if (!query) throw new McpToolError('Missing required parameter "query".')
  if (query.length > 300) throw new McpToolError('"query" is too long (at most 300 characters).')
  const limit = int(args.limit, 10, 1, 50, 'limit')
  const { pages } = ws()
  const hits = retrieve(query, workspaceDocs(), 50)
  return {
    query,
    results: hits.slice(0, limit).map((h) => {
      const p = pages[h.id]
      const out: Record<string, unknown> = { id: h.id, kind: p ? kindOf(p) : 'page', title: h.title, path: pathOf(h.id) }
      if (p?.databaseId) out.databaseId = p.databaseId
      out.snippet = snippet(h.text, query)
      out.url = pageUrl(h.id)
      if (p) out.updatedAt = iso(p.updatedAt)
      return out
    }),
    total: hits.length,
  }
}

/* ------------------------------------------------------------------ */
/* one_get_page                                                        */
/* ------------------------------------------------------------------ */

/** A page by id, or by exact (case-insensitive) title — the most recently edited if several match. */
export function findPage(args: Record<string, unknown>): { page: Page; others: Page[] } {
  const id = str(args.id)
  const title = str(args.title)
  if (!id && !title) throw new McpToolError('Give the page id (or its exact title).')
  if (id) {
    const p = live(id)
    if (p) return { page: p, others: [] }
    if (!title) throw new McpToolError(`No page with id ${q(id)}. Use one_search to find page ids.`)
  }
  // by title: template pages (features/templates) never answer; by id they still do
  const pages = ws().pages
  const all = Object.values(pages).filter((p) => live(p.id) && !inTemplate(pages, p.id))
  const hits = all.filter((p) => p.title.trim().toLowerCase() === title.toLowerCase()).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!hits.length) {
    const near = all
      .filter((p) => p.title.toLowerCase().includes(title.toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
    throw new McpToolError(`No page titled ${q(title)}.${near.length ? ` Similar: ${near.map((p) => `${q(titleOf(p))} (${p.id})`).join(', ')}` : ' Try one_search.'}`)
  }
  return { page: hits[0], others: hits.slice(1) }
}

function getPage(args: Record<string, unknown>) {
  const { page: p, others } = findPage(args)
  const { pages, databases } = ws()
  const out: Record<string, unknown> = {
    id: p.id,
    kind: kindOf(p),
    title: p.title,
    icon: iconText(p.icon),
    path: pathOf(p.id),
    url: pageUrl(p.id),
    parentId: p.parentId,
  }
  if (p.databaseId && databases[p.databaseId]) out.database = { id: p.databaseId, title: titleOf(pages[p.databaseId]) }
  out.createdAt = iso(p.createdAt)
  out.updatedAt = iso(p.updatedAt)
  if (p.settings.locked) out.locked = true
  if (p.databaseId && databases[p.databaseId]) out.properties = rowProperties(databases[p.databaseId], p)
  if (p.kind === 'database' && databases[p.id]) {
    out.rows = rowsOf(p.id).length
    out.schema = databases[p.id].properties.map((prop) => ({ name: prop.name, type: prop.type, ...(prop.options ? { options: prop.options.map((o) => o.name) } : {}) }))
    out.hint = 'A database: one_query_database lists its rows, one_get_database has the full schema and views.'
  }
  const children = Object.values(pages)
    .filter((c) => c.parentId === p.id && !c.databaseId && !c.trashed)
    .sort((a, b) => a.order - b.order)
  if (children.length) out.children = children.slice(0, 100).map(ref)
  if (others.length) out.alsoTitled = others.slice(0, 10).map((o) => ({ id: o.id, path: pathOf(o.id) }))
  const md = docToMarkdown(p.content).trim()
  out.markdown = md.length > MARKDOWN_MAX ? `${md.slice(0, MARKDOWN_MAX)}\n[Truncated: ${MARKDOWN_MAX.toLocaleString('en')} of ${md.length.toLocaleString('en')} characters]` : md
  if (md.length > MARKDOWN_MAX) out.truncated = true
  out.backlinks = selectBacklinks(pages, p.id)
    .slice(0, 50)
    .map((b) => ({ id: b.id, title: titleOf(b), path: pathOf(b.id) }))
  return out
}

/* ------------------------------------------------------------------ */
/* databases                                                           */
/* ------------------------------------------------------------------ */

function listDatabases() {
  const { databases, pages } = ws()
  return {
    databases: Object.values(databases)
      .map((d) => ({ d, page: live(d.id) }))
      .filter((x): x is { d: Database; page: Page } => !!x.page && !inTemplate(pages, x.d.id))
      .map(({ d, page }) => ({
        id: d.id,
        title: titleOf(page),
        path: pathOf(d.id),
        url: pageUrl(d.id),
        rows: rowsOf(d.id).length,
        properties: d.properties.map((p) => ({ name: p.name, type: p.type })),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.title.localeCompare(b.title)),
  }
}

function getDatabase(args: Record<string, unknown>) {
  const { db, page } = databaseOrThrow(args.id)
  const nameOf = (id: ID | null | undefined) => (id ? (db.properties.find((p) => p.id === id)?.name ?? null) : null)
  return {
    id: db.id,
    title: titleOf(page),
    icon: iconText(page.icon),
    path: pathOf(db.id),
    url: pageUrl(db.id),
    parentId: page.parentId,
    rows: rowsOf(db.id).length,
    locked: !!db.locked,
    ...(db.locked ? { lockedNote: 'Locked: rows can be added and changed; properties and options cannot.' } : {}),
    properties: db.properties.map((p) => propertyJson(db, p)),
    views: db.views.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      ...(nameOf(v.groupBy) ? { groupBy: nameOf(v.groupBy) } : {}),
      ...(nameOf(v.dateProperty) ? { dateProperty: nameOf(v.dateProperty) } : {}),
      ...(v.sorts.length ? { sorts: v.sorts.map((s) => ({ property: nameOf(s.propertyId) ?? s.propertyId, direction: s.direction })) } : {}),
      filtered: !!v.filter?.items.length,
    })),
  }
}

/* ---------- one_query_database ---------- */

type Op = (typeof MCP_FILTER_OPS)[number]
const ALIAS: Partial<Record<Op, Op>> = { eq: 'equals', is: 'equals', neq: 'not_equals', is_not: 'not_equals', before: 'lt', after: 'gt', on_or_before: 'lte', on_or_after: 'gte' }

const TRUE = new Set(['true', 'yes', 'ja', '1', 'checked', 'x', 'on'])
const FALSE = new Set(['false', 'no', 'nein', '0', 'unchecked', 'off'])

/** "Yes" → "true" for checkboxes; everything lower-case. */
function needle(v: unknown, checkbox: boolean): string {
  const s = (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)).trim().toLowerCase()
  if (checkbox && TRUE.has(s)) return 'true'
  if (checkbox && FALSE.has(s)) return 'false'
  return s
}

function compare(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.localeCompare(b)
}

/** A filter / sort field: a property (by name or id), "title", "createdAt", "updatedAt". */
interface Field {
  key: string
  checkbox: boolean
  values: (row: Page) => string[]
}

function sortSpecs(raw: unknown): Array<{ property: string; desc: boolean }> {
  if (raw === undefined || raw === null || raw === '') return []
  const one = (x: unknown): { property: string; desc: boolean } => {
    if (typeof x === 'string') {
      const s = x.trim()
      return s.startsWith('-') ? { property: s.slice(1).trim(), desc: true } : { property: s, desc: false }
    }
    if (x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { property?: unknown }).property === 'string') {
      const o = x as { property: string; direction?: unknown }
      return { property: o.property.trim(), desc: o.direction === 'desc' }
    }
    throw new McpToolError('"sort" must be a property name ("-Name" for descending), {property, direction} or a list of those.')
  }
  const list = Array.isArray(raw) ? raw.slice(0, 5).map(one) : [one(raw)]
  return list.filter((s) => s.property && s.property !== 'order')
}

function queryDatabase(args: Record<string, unknown>) {
  const { db, page } = databaseOrThrow(args.databaseId)
  const limit = int(args.limit, 50, 1, 100, 'limit')
  const titleProp = db.properties.find((p) => p.type === 'title')
  const cache = new Map<string, string[]>()
  const fieldOf = (name: string): Field => {
    const n = name.trim().toLowerCase()
    const byProp = (prop: PropertyDef): Field => ({
      key: prop.id,
      checkbox: prop.type === 'checkbox',
      values: (row) => {
        const k = `${row.id}\u0000${prop.id}`
        let v = cache.get(k)
        if (!v) {
          let f: unknown = null
          try {
            f = friendlyValue(db, prop, row)
          } catch {
            f = null
          }
          v = comparable(f).map((x) => x.toLowerCase())
          cache.set(k, v)
        }
        return v
      },
    })
    if (titleProp && (n === 'title' || n === titleProp.name.toLowerCase())) return byProp(titleProp)
    const prop = db.properties.find((p) => p.name.trim().toLowerCase() === n || p.id === name.trim())
    if (prop) return byProp(prop)
    if (n === 'createdat' || n === 'created') return { key: 'createdAt', checkbox: false, values: (r) => [iso(r.createdAt).toLowerCase()] }
    if (n === 'updatedat' || n === 'updated' || n === 'last edited') return { key: 'updatedAt', checkbox: false, values: (r) => [iso(r.updatedAt).toLowerCase()] }
    throw new McpToolError(`Unknown property ${q(name)}. Properties: ${db.properties.map((p) => q(p.name)).join(', ')} (or title, createdAt, updatedAt).`)
  }

  const raw = args.filter
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new McpToolError('"filter" must be a list of {property, op, value}.')
  if (Array.isArray(raw) && raw.length > 20) throw new McpToolError('At most 20 filter conditions.')
  const filters = ((raw as unknown[] | undefined) ?? []).map((f) => {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    const field = fieldOf(String(o.property ?? ''))
    const given = String(o.op ?? '').trim().toLowerCase() as Op
    if (!MCP_FILTER_OPS.includes(given)) throw new McpToolError(`Unknown op ${q(String(o.op ?? ''))}. Use one of: ${MCP_FILTER_OPS.slice(0, 14).join(', ')}.`)
    return { field, op: ALIAS[given] ?? given, value: needle(o.value, field.checkbox) }
  })
  const sorts = sortSpecs(args.sort).map((s) => ({ field: fieldOf(s.property), desc: s.desc }))

  const all = rowsOf(db.id)
  const matches = all.filter((row) =>
    filters.every(({ field, op, value }) => {
      const vs = field.values(row)
      const empty = !vs.length || (field.checkbox && vs[0] === 'false')
      switch (op) {
        case 'equals':
          return vs.includes(value)
        case 'not_equals':
          return !vs.includes(value)
        case 'contains':
          return vs.some((v) => v.includes(value))
        case 'not_contains':
          return !vs.some((v) => v.includes(value))
        case 'starts_with':
          return vs.some((v) => v.startsWith(value))
        case 'ends_with':
          return vs.some((v) => v.endsWith(value))
        case 'is_empty':
        case 'is_not_checked':
          return empty
        case 'is_not_empty':
        case 'is_checked':
          return !empty
        case 'gt':
          return vs.some((v) => compare(v, value) > 0)
        case 'gte':
          return vs.some((v) => compare(v, value) >= 0)
        case 'lt':
          return vs.some((v) => compare(v, value) < 0)
        case 'lte':
          return vs.some((v) => compare(v, value) <= 0)
      }
      return true
    }),
  )
  if (sorts.length)
    matches.sort((a, b) => {
      for (const { field, desc } of sorts) {
        const ka = field.values(a)[0] ?? null
        const kb = field.values(b)[0] ?? null
        // empty values last, whatever the direction
        if (ka === null || kb === null) {
          if (ka !== kb) return ka === null ? 1 : -1
          continue
        }
        const c = compare(ka, kb)
        if (c) return desc ? -c : c
      }
      return 0
    })

  const fingerprint = hash(JSON.stringify([db.id, raw ?? [], args.sort ?? null]))
  const offset = decodeCursor(args.cursor, fingerprint)
  const slice = matches.slice(offset, offset + limit)
  const end = offset + slice.length
  return {
    database: { id: db.id, title: titleOf(page) },
    total: matches.length,
    rows: slice.map((r) => rowJson(db, r)),
    next: end < matches.length ? encodeCursor(end, fingerprint) : null,
  }
}

/** Short stable hash (a cursor belongs to one query). */
function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

const encodeCursor = (offset: number, fp: string) => `${offset.toString(36)}.${fp}`

function decodeCursor(v: unknown, fp: string): number {
  if (v === undefined || v === null || v === '') return 0
  const m = typeof v === 'string' ? /^([0-9a-z]+)\.([0-9a-z]+)$/.exec(v.trim()) : null
  if (!m) throw new McpToolError('Invalid "cursor": pass the "next" value of the previous answer.')
  if (m[2] !== fp) throw new McpToolError('This cursor belongs to another query (other filter or sort). Start again without a cursor.')
  return parseInt(m[1], 36)
}

/* ------------------------------------------------------------------ */

/** The bridge answers one_list_workspaces itself (every tab); a tab asked directly names only its own. */
function ownWorkspace(mode: McpAgentMode) {
  const info = workspaceInfo()
  return {
    workspaces: [{ id: info.id, name: info.name, kind: info.kind, access: mode === 'read' || info.readOnly ? 'read-only' : 'read-write', readOnly: info.readOnly, mode, newest: true }],
  }
}

export const READ_TOOLS: Partial<Record<McpToolName, (args: Record<string, unknown>, mode: McpAgentMode) => unknown>> = {
  one_overview: (_args, mode) => overview(mode),
  one_list_workspaces: (_args, mode) => ownWorkspace(mode),
  one_search: search,
  one_get_page: getPage,
  one_list_databases: listDatabases,
  one_get_database: getDatabase,
  one_query_database: queryDatabase,
}

/** Short label of what a read call is about (activity log). */
export function readTarget(tool: McpToolName, args: Record<string, unknown>): string {
  const title = (id: unknown) => {
    const p = typeof id === 'string' ? live(id.trim()) : null
    return p ? titleOf(p) : typeof id === 'string' ? id : ''
  }
  switch (tool) {
    case 'one_search':
      return `“${str(args.query)}”`
    case 'one_get_page':
      return str(args.title) || title(args.id)
    case 'one_get_database':
      return title(args.id)
    case 'one_query_database': {
      const n = Array.isArray(args.filter) ? args.filter.length : 0
      return `${title(args.databaseId)}${n ? ` · ${t(n === 1 ? 'features.mcp.log.filters.one' : 'features.mcp.log.filters.other', { n })}` : ''}`
    }
    default:
      return workspaceInfo().name
  }
}
