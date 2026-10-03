/**
 * One MCP — the reading tools. Answers are JSON objects (the bridge sends them to the agent as
 * text); limits keep a single answer well under what MCP clients accept.
 */
import { format } from 'date-fns'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { selectBacklinks } from '../../store/selectors'
import type { Database, ID, Page } from '../../store/types'
import { docToMarkdown } from '../../editor'
import { parseHash } from '../../lib/router'
import { retrieve, workspaceDocs } from '../ai/workspace'
import { MCP_FILTER_OPS, type McpAgentMode, type McpToolName } from './contract'
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

/** Workspace name and kind as the tab shows them. */
export function workspaceInfo() {
  const c = useCloud.getState()
  if (c.active.kind === 'cloud') {
    const name = c.workspaces.find((w) => w.id === c.active.id)?.name ?? 'Team workspace'
    return { name, kind: 'team' as const, readOnly: c.readOnly, role: c.role }
  }
  return { name: ws().settings.workspaceName.trim() || 'Workspace', kind: 'local' as const, readOnly: false, role: null }
}

/* ------------------------------------------------------------------ */
/* one_overview                                                        */
/* ------------------------------------------------------------------ */

const TREE_TOP = 60
const TREE_CHILDREN = 15

function overview(mode: McpAgentMode) {
  const { pages, databases, people } = ws()
  const alive = Object.values(pages).filter((p) => live(p.id))
  const childrenOf = (id: ID | null) =>
    alive.filter((p) => p.parentId === id && !p.databaseId && !p.hidden).sort((a, b) => a.order - b.order)
  const node = (p: Page, depth: number): Record<string, unknown> => {
    const kids = depth < 1 ? childrenOf(p.id) : []
    const out: Record<string, unknown> = { id: p.id, title: titleOf(p), kind: kindOf(p) }
    const icon = iconText(p.icon)
    if (icon) out.icon = icon
    if (p.kind === 'database') out.rows = rowsOf(p.id).length
    if (kids.length) out.children = kids.slice(0, TREE_CHILDREN).map((c) => node(c, depth + 1))
    if (kids.length > TREE_CHILDREN) out.moreChildren = kids.length - TREE_CHILDREN
    else if (depth >= 1) {
      const n = childrenOf(p.id).length
      if (n) out.subPages = n
    }
    return out
  }
  const top = childrenOf(null)
  const route = parseHash(window.location.hash)
  const open = route.name === 'page' ? live(route.id) : null
  const peekId = useUI.getState().peekPageId
  const peek = peekId ? live(peekId) : null
  const now = new Date()
  return {
    workspace: workspaceInfo(),
    today: format(now, 'yyyy-MM-dd'),
    weekday: format(now, 'EEEE'),
    time: format(now, 'HH:mm'),
    language: ws().settings.language,
    agentChanges: mode === 'ask' ? 'ask first (each change waits for approval in One)' : mode === 'apply' ? 'applied directly' : 'read only (changes are refused)',
    openPage: open ? { id: open.id, title: titleOf(open), kind: kindOf(open) } : null,
    ...(peek ? { peekPage: { id: peek.id, title: titleOf(peek), kind: kindOf(peek) } } : {}),
    counts: {
      pages: alive.filter((p) => p.kind === 'page' && !p.databaseId).length,
      databases: alive.filter((p) => p.kind === 'database').length,
      rows: alive.filter((p) => !!p.databaseId).length,
    },
    tree: top.slice(0, TREE_TOP).map((p) => node(p, 0)),
    ...(top.length > TREE_TOP ? { moreTopLevel: top.length - TREE_TOP } : {}),
    databases: Object.values(databases)
      .map((d) => live(d.id))
      .filter((p): p is Page => !!p)
      .map((p) => ({ id: p.id, title: titleOf(p), path: pathOf(p.id), rows: rowsOf(p.id).length })),
    people: people.map((p) => p.name),
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
  const start = Math.max(0, at < 0 ? 0 : at - 80)
  const s = flat.slice(start, start + 240)
  return `${start > 0 ? '…' : ''}${s}${start + 240 < flat.length ? '…' : ''}`
}

function search(args: Record<string, unknown>) {
  const query = str(args.query)
  if (!query) throw new McpToolError('Missing required parameter "query".')
  if (query.length > 300) throw new McpToolError('"query" is too long (at most 300 characters).')
  const limit = int(args.limit, 10, 1, 50, 'limit')
  const { pages } = ws()
  const hits = retrieve(query, workspaceDocs(), limit)
  return {
    query,
    results: hits.map((h) => {
      const p = pages[h.id]
      const out: Record<string, unknown> = { id: h.id, title: h.title, kind: p ? kindOf(p) : 'page', path: pathOf(h.id) }
      if (p?.databaseId) out.database = { id: p.databaseId, title: titleOf(pages[p.databaseId]) }
      if (p) out.updatedAt = iso(p.updatedAt)
      const text = snippet(h.text, query)
      if (text) out.snippet = text
      return out
    }),
  }
}

/* ------------------------------------------------------------------ */
/* one_get_page                                                        */
/* ------------------------------------------------------------------ */

/** A page by id, or by exact (case-insensitive) title — the most recently edited if several match. */
export function findPage(args: Record<string, unknown>): { page: Page; others: Page[] } {
  const id = str(args.id)
  const title = str(args.title)
  if (!id && !title) throw new McpToolError('Pass "id" (or "title").')
  if (id) {
    const p = live(id)
    if (p) return { page: p, others: [] }
    if (!title) throw new McpToolError(`No page with id ${q(id)}. Use one_search to find page ids.`)
  }
  const hits = Object.values(ws().pages)
    .filter((p) => p.title.trim().toLowerCase() === title.toLowerCase() && live(p.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (!hits.length) throw new McpToolError(`No page titled ${q(title)}. Use one_search to find it.`)
  return { page: hits[0], others: hits.slice(1) }
}

function getPage(args: Record<string, unknown>) {
  const { page: p, others } = findPage(args)
  const { pages, databases } = ws()
  const out: Record<string, unknown> = {
    id: p.id,
    title: p.title,
    kind: kindOf(p),
    icon: iconText(p.icon),
    path: pathOf(p.id),
    parentId: p.parentId,
    url: pageUrl(p.id),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  }
  if (p.settings.locked) out.locked = true
  if (p.databaseId && databases[p.databaseId]) {
    out.database = { id: p.databaseId, title: titleOf(pages[p.databaseId]) }
    out.properties = rowProperties(databases[p.databaseId], p)
  }
  if (p.kind === 'database' && databases[p.id]) {
    const db = databases[p.id]
    out.rows = rowsOf(p.id).length
    out.schema = db.properties.map((prop) => ({ name: prop.name, type: prop.type }))
    out.hint = 'Use one_query_database for the rows and one_get_database for the full schema.'
  }
  const md = docToMarkdown(p.content).trim()
  out.markdown = md.length > MARKDOWN_MAX ? md.slice(0, MARKDOWN_MAX) : md
  if (md.length > MARKDOWN_MAX) out.truncated = { shown: MARKDOWN_MAX, total: md.length }
  const children = Object.values(pages)
    .filter((c) => c.parentId === p.id && !c.databaseId && !c.trashed)
    .sort((a, b) => a.order - b.order)
  out.children = children.slice(0, 100).map((c) => ({ id: c.id, title: titleOf(c), kind: kindOf(c) }))
  out.backlinks = selectBacklinks(pages, p.id)
    .slice(0, 50)
    .map((b) => ({ id: b.id, title: titleOf(b), kind: kindOf(b) }))
  if (others.length) out.sameTitle = others.slice(0, 10).map((o) => ({ id: o.id, path: pathOf(o.id), kind: kindOf(o) }))
  return out
}

/* ------------------------------------------------------------------ */
/* databases                                                           */
/* ------------------------------------------------------------------ */

function listDatabases() {
  const { databases } = ws()
  return {
    databases: Object.values(databases)
      .map((d) => ({ d, page: live(d.id) }))
      .filter((x): x is { d: Database; page: Page } => !!x.page)
      .sort((a, b) => titleOf(a.page).localeCompare(titleOf(b.page)))
      .map(({ d, page }) => ({
        id: d.id,
        title: titleOf(page),
        path: pathOf(d.id),
        rows: rowsOf(d.id).length,
        ...(d.locked ? { locked: true } : {}),
        properties: d.properties.map((p) => ({ name: p.name, type: p.type })),
      })),
  }
}

function getDatabase(args: Record<string, unknown>) {
  const { db, page } = databaseOrThrow(args.id)
  return {
    id: db.id,
    title: titleOf(page),
    icon: iconText(page.icon),
    path: pathOf(db.id),
    url: pageUrl(db.id),
    rows: rowsOf(db.id).length,
    ...(db.locked ? { locked: true, lockedNote: 'Locked: rows can be added and changed, properties and options cannot.' } : {}),
    properties: db.properties.map((p) => propertyJson(db, p)),
    views: db.views.map((v) => ({ id: v.id, name: v.name, type: v.type })),
  }
}

type Op = (typeof MCP_FILTER_OPS)[number]

const TRUE = new Set(['true', 'yes', 'ja', '1', 'checked', 'x'])
const FALSE = new Set(['false', 'no', 'nein', '0', 'unchecked'])

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

function queryDatabase(args: Record<string, unknown>) {
  const { db, page } = databaseOrThrow(args.databaseId)
  const limit = int(args.limit, 50, 1, 100, 'limit')
  const titleProp = db.properties.find((p) => p.type === 'title')
  const propNamed = (name: string) => {
    const n = name.trim().toLowerCase()
    if (n === 'title' || n === titleProp?.name.toLowerCase()) return titleProp
    return db.properties.find((p) => p.name.trim().toLowerCase() === n)
  }
  const names = () => db.properties.map((p) => q(p.name)).join(', ')
  const raw = args.filter
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new McpToolError('"filter" must be a list of {property, op, value}.')
  const filters = ((raw as unknown[] | undefined) ?? []).map((f) => {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    const prop = propNamed(String(o.property ?? ''))
    if (!prop) throw new McpToolError(`Unknown property ${q(String(o.property ?? ''))}. Properties: ${names()}.`)
    const op = String(o.op ?? '') as Op
    if (!MCP_FILTER_OPS.includes(op)) throw new McpToolError(`Unknown op ${q(String(o.op ?? ''))}. Use one of: ${MCP_FILTER_OPS.join(', ')}.`)
    return { prop, op, value: needle(o.value, prop.type === 'checkbox') }
  })

  // sort: "order" (default), "createdAt", "updatedAt", a property name; "-" = descending
  const sortRaw = str(args.sort) || 'order'
  const desc = sortRaw.startsWith('-')
  const sortKey = desc ? sortRaw.slice(1).trim() : sortRaw
  const sortProp = ['order', 'createdAt', 'updatedAt'].includes(sortKey) ? null : propNamed(sortKey)
  if (!sortProp && !['order', 'createdAt', 'updatedAt'].includes(sortKey)) throw new McpToolError(`Cannot sort by ${q(sortKey)}: use "order", "createdAt", "updatedAt" or a property name (${names()}).`)

  const valueCache = new Map<string, string[]>()
  const values = (row: Page, prop: NonNullable<typeof titleProp>) => {
    const k = `${row.id}\u0000${prop.id}`
    let v = valueCache.get(k)
    if (!v) {
      let f: unknown = null
      try {
        f = friendlyValue(db, prop, row)
      } catch {
        f = null
      }
      v = comparable(f).map((x) => x.toLowerCase())
      valueCache.set(k, v)
    }
    return v
  }

  const all = rowsOf(db.id)
  const matches = all.filter((row) =>
    filters.every(({ prop, op, value }) => {
      const vs = values(row, prop)
      switch (op) {
        case 'equals':
          return vs.includes(value) || (prop.type === 'checkbox' && !vs.length && value === 'false')
        case 'not_equals':
          return !vs.includes(value)
        case 'contains':
          return vs.some((v) => v.includes(value))
        case 'not_contains':
          return !vs.some((v) => v.includes(value))
        case 'is_empty':
          return !vs.length || (prop.type === 'checkbox' && vs[0] === 'false')
        case 'is_not_empty':
          return !!vs.length && !(prop.type === 'checkbox' && vs[0] === 'false')
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
  if (sortKey !== 'order' || desc) {
    const key = (r: Page): string | number | null =>
      sortKey === 'createdAt' ? r.createdAt : sortKey === 'updatedAt' ? r.updatedAt : sortKey === 'order' ? r.order : (values(r, sortProp!)[0] ?? null)
    matches.sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      // empty values last, whatever the direction
      if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1
      const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : compare(String(ka), String(kb))
      return desc ? -c : c
    })
  }

  const offset = decodeCursor(args.cursor)
  const slice = matches.slice(offset, offset + limit)
  const end = offset + slice.length
  return {
    database: { id: db.id, title: titleOf(page) },
    total: matches.length,
    ...(filters.length ? { totalRows: all.length } : {}),
    rows: slice.map((r) => rowJson(db, r)),
    next: end < matches.length ? encodeCursor(end) : null,
  }
}

const encodeCursor = (offset: number) => `o${offset.toString(36)}`

function decodeCursor(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0
  const m = typeof v === 'string' ? /^o([0-9a-z]+)$/.exec(v.trim()) : null
  if (!m) throw new McpToolError('Invalid "cursor": pass the "next" value of the previous answer.')
  return parseInt(m[1], 36)
}

/* ------------------------------------------------------------------ */

export const READ_TOOLS: Partial<Record<McpToolName, (args: Record<string, unknown>, mode: McpAgentMode) => unknown>> = {
  one_overview: (_args, mode) => overview(mode),
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
      return `${title(args.databaseId)}${n ? ` · ${n} ×` : ''}`
    }
    default:
      return workspaceInfo().name
  }
}
