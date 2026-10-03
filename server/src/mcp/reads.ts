/**
 * The MCP read tools on top of the public-API model: overview, search, pages as Markdown with
 * backlinks, databases and filtered row queries. Everything is read from the workspace's own meta
 * document (and its pages' content documents) — another member's private pages are never in there.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, badRequest, notFound } from '../errors.ts'
import { fragmentLinks, fragmentMarkdown } from '../api/markdown.ts'
import { type PageInfo, type PropertyDef, type Roots, allPages, inTrash, liveDatabase, livePage, pageMap, readOrdered, rowsOf } from '../api/meta.ts'
import { MAX_PAGE_SIZE, contentDoc, findProperty, type WorkspaceModel } from '../api/model.ts'
import { schemaOut } from '../api/values.ts'
import { iso } from '../tokens.ts'
import { type Condition, type Field, type FriendlyRow, type SortKey, decodeCursor, encodeCursor, matches, sorter } from './query.ts'

/** Pages listed in the overview's tree, at most. */
const TREE_LIMIT = 150
const TREE_DEPTH = 3
/** Content documents looked at for backlinks, at most. */
const BACKLINK_SCAN = 3000
const MAX_BACKLINKS = 50

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** PageIcon JSON → the tools' icon string: the emoji itself, `asset:<name>` or `lucide:<Name>`. */
export function iconOut(v: unknown): string | null {
  if (!isObj(v) || typeof v.value !== 'string' || !v.value) return null
  if (v.type === 'emoji') return v.value
  if (v.type === 'asset' || v.type === 'lucide') return `${v.type}:${v.value}`
  return null
}

const kindOf = (p: PageInfo): 'page' | 'row' | 'database' => (p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page')

const byOrder = (a: PageInfo, b: PageInfo) => a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)

/** "Projects / Apollo / Kickoff" — the page's ancestors and itself (cycle-safe). */
export function pathOf(r: Roots, id: string): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur) && parts.length < 32) {
    seen.add(cur)
    const yp = pageMap(r, cur)
    if (!yp) break
    const title = yp.get('title')
    parts.unshift(typeof title === 'string' && title.trim() ? title.trim() : 'Untitled')
    const parent = yp.get('parentId')
    cur = typeof parent === 'string' && parent ? parent : null
  }
  return parts.join(' / ')
}

const plainOf = (r: Roots, id: string): string => {
  const v = pageMap(r, id)?.get('plain')
  return typeof v === 'string' ? v : ''
}

interface TreeNode {
  id: string
  title: string
  kind: 'page' | 'database'
  icon?: string
  rows?: number
  children?: TreeNode[]
  /** children not listed (depth or size limit) */
  more?: number
}

export class McpReads {
  private readonly s: Services
  private readonly model: WorkspaceModel

  constructor(s: Services, model: WorkspaceModel) {
    this.s = s
    this.model = model
  }

  /* ---------------------------------------------------------------- overview */

  overview(wsId: string, scope: string) {
    const w = this.s.repo.workspaceById(wsId)
    return this.model.read(wsId, (r) => {
      const live = allPages(r).filter((p) => !inTrash(r, p.id))
      const rowCount = new Map<string, number>()
      const children = new Map<string | null, PageInfo[]>()
      const ids = new Set(live.map((p) => p.id))
      for (const p of live) {
        if (p.databaseId) {
          rowCount.set(p.databaseId, (rowCount.get(p.databaseId) ?? 0) + 1)
          continue
        }
        // a parent that isn't listed (damaged entry): the page shows at the top level, like in the app
        const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null
        children.set(parent, [...(children.get(parent) ?? []), p])
      }
      let listed = 0
      const tree = (parent: string | null, depth: number): { nodes: TreeNode[]; more: number } => {
        const list = (children.get(parent) ?? []).sort(byOrder)
        const nodes: TreeNode[] = []
        for (const p of list) {
          if (listed >= TREE_LIMIT) break
          listed++
          const node: TreeNode = { id: p.id, title: p.title || 'Untitled', kind: p.kind }
          const icon = iconOut(pageMap(r, p.id)?.get('icon'))
          if (icon) node.icon = icon
          if (p.kind === 'database') node.rows = rowCount.get(p.id) ?? 0
          const kids = children.get(p.id)?.length ?? 0
          if (kids) {
            if (depth + 1 < TREE_DEPTH) {
              const sub = tree(p.id, depth + 1)
              node.children = sub.nodes
              if (sub.more) node.more = sub.more
            } else node.more = kids
          }
          nodes.push(node)
        }
        return { nodes, more: list.length - nodes.length }
      }
      const top = tree(null, 0)
      const databases = live
        .filter((p) => p.kind === 'database' && liveDatabase(r, p.id))
        .map((p) => ({ id: p.id, title: p.title || 'Untitled', path: pathOf(r, p.id), rows: rowCount.get(p.id) ?? 0 }))
        .sort((a, b) => a.path.localeCompare(b.path))
      const now = new Date()
      const ctx = this.model.context(wsId, r)
      const people = ctx.members.map((m) => ({ name: ctx.people.get(m.id)?.name ?? m.name ?? '', email: m.email }))
      return {
        workspace: { id: wsId, name: w?.name ?? '', url: `${this.s.config.publicUrl}/app/?w=${encodeURIComponent(wsId)}` },
        access: scope === 'write' ? 'read-write' : 'read-only',
        today: now.toISOString().slice(0, 10),
        now: now.toISOString(),
        counts: { pages: live.filter((p) => !p.databaseId && p.kind === 'page').length, databases: databases.length, rows: live.filter((p) => p.databaseId).length },
        pages: top.nodes,
        ...(top.more ? { morePages: top.more } : {}),
        databases,
        people,
        hint: 'Ids come from here, one_search and one_list_databases. Rows live in databases: use one_query_database to list them.',
      }
    })
  }

  /* ---------------------------------------------------------------- search */

  search(wsId: string, query: string, limit: number) {
    return this.model.read(wsId, (r) => {
      const q = query.trim().toLowerCase()
      const terms = q.split(/\s+/).filter(Boolean)
      const hits: Array<{ p: PageInfo; score: number; plain: string }> = []
      const ctx = this.model.context(wsId, r)
      const schemas = new Map<string, PropertyDef[] | null>()
      /** a row's property values as text (option names, people, related titles …) */
      const valuesOf = (p: PageInfo): string => {
        if (!p.databaseId) return ''
        if (!schemas.has(p.databaseId)) schemas.set(p.databaseId, liveDatabase(r, p.databaseId)?.properties ?? null)
        const props = schemas.get(p.databaseId)
        if (!props) return ''
        return Object.values(this.model.rowOut(wsId, props, p, ctx).properties).flatMap(valueText).join(' · ')
      }
      for (const p of allPages(r)) {
        if (inTrash(r, p.id)) continue
        const title = p.title.toLowerCase()
        const values = valuesOf(p)
        const plain = [plainOf(r, p.id), values].filter(Boolean).join('\n')
        const body = plain.toLowerCase()
        let score = 0
        if (title === q) score = 100
        else if (title.startsWith(q)) score = 70
        else if (title.includes(q)) score = 50
        else if (terms.every((t) => title.includes(t))) score = 35
        else if (terms.every((t) => title.includes(t) || body.includes(t))) score = 10 + 5 * terms.filter((t) => title.includes(t)).length + (body.includes(q) ? 5 : 0)
        if (score) hits.push({ p, score, plain })
      }
      hits.sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt)
      return {
        query,
        results: hits.slice(0, limit).map(({ p, plain }) => ({
          id: p.id,
          kind: kindOf(p),
          title: p.title || 'Untitled',
          path: pathOf(r, p.id),
          ...(p.databaseId ? { databaseId: p.databaseId } : {}),
          snippet: snippet(plain, terms),
          url: this.model.url(wsId, p.id),
          updatedAt: iso(p.updatedAt),
        })),
        total: hits.length,
      }
    })
  }

  /* ---------------------------------------------------------------- pages */

  /** By id, or by title (exact, case-insensitive; the most recently changed one when several match). */
  private resolvePage(r: Roots, input: { id?: string; title?: string }): { page: PageInfo; others: PageInfo[] } {
    if (input.id) {
      const page = livePage(r, input.id)
      if (!page) throw notFound('page_not_found', `No page with id "${input.id}" in this workspace (or it is in the trash)`)
      return { page, others: [] }
    }
    const want = (input.title ?? '').trim().toLowerCase()
    if (!want) throw badRequest('invalid_request', 'Give the page id or its title')
    const live = allPages(r).filter((p) => !inTrash(r, p.id))
    const exact = live.filter((p) => p.title.trim().toLowerCase() === want).sort((a, b) => b.updatedAt - a.updatedAt)
    if (exact[0]) return { page: exact[0], others: exact.slice(1) }
    const near = live.filter((p) => p.title.toLowerCase().includes(want)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
    const hint = near.length ? ` Similar: ${near.map((p) => `"${p.title}" (${p.id})`).join(', ')}` : ' Try one_search.'
    throw notFound('page_not_found', `No page titled "${input.title}".${hint}`)
  }

  async getPage(wsId: string, input: { id?: string; title?: string }) {
    const head = await this.model.read(wsId, (r) => {
      const { page, others } = this.resolvePage(r, input)
      const db = page.databaseId ? liveDatabase(r, page.databaseId) : null
      const titles = new Map<string, string>()
      for (const [id, yp] of r.pages.entries()) if (yp instanceof Y.Map) titles.set(id, typeof yp.get('title') === 'string' ? (yp.get('title') as string) : '')
      const kids = allPages(r)
        .filter((p) => p.parentId === page.id && !p.databaseId && !p.trashed)
        .sort(byOrder)
      const rows = page.kind === 'database' ? rowsOf(r, page.id).length : null
      return {
        page,
        titles,
        out: {
          id: page.id,
          kind: kindOf(page),
          title: page.title,
          icon: iconOut(pageMap(r, page.id)?.get('icon')),
          path: pathOf(r, page.id),
          url: this.model.url(wsId, page.id),
          parentId: page.parentId,
          ...(db ? { database: { id: db.page.id, title: db.page.title } } : {}),
          createdAt: iso(page.createdAt),
          updatedAt: iso(page.updatedAt),
          ...(db ? { properties: this.model.rowOut(wsId, db.properties, page, this.model.context(wsId, r)).properties } : {}),
          ...(rows !== null
            ? {
                rows,
                schema: (liveDatabase(r, page.id)?.properties ?? []).map((p) => ({ name: p.name, type: p.type, ...(p.options ? { options: p.options.map((o) => o.name) } : {}) })),
                hint: 'A database: one_query_database lists its rows, one_get_database has the full schema and views.',
              }
            : {}),
          ...(kids.length ? { children: kids.slice(0, 100).map((p) => ({ id: p.id, title: p.title || 'Untitled', kind: p.kind })) } : {}),
          ...(others.length ? { alsoTitled: others.slice(0, 10).map((p) => ({ id: p.id, path: pathOf(r, p.id) })) } : {}),
        },
        candidates: allPages(r)
          .filter((p) => p.id !== page.id && !inTrash(r, p.id) && p.kind !== 'database')
          .slice(0, BACKLINK_SCAN)
          .map((p) => ({ id: p.id, title: p.title || 'Untitled', path: pathOf(r, p.id) })),
      }
    })
    const title = (id: string) => (head.titles.has(id) ? head.titles.get(id) || 'Untitled' : null)
    const { markdown, truncated } = await this.s.collab.read(contentDoc(wsId, head.page.id), (doc) => fragmentMarkdown(doc, { title }))
    const backlinks = await this.backlinks(wsId, head.page.id, head.candidates)
    return { ...head.out, markdown, ...(truncated ? { truncated: true } : {}), backlinks }
  }

  /**
   * Pages whose content links to `pageId` (page links, @-mentions, #/p/ links, database blocks).
   * Stored states are checked for the id's bytes first; only those (and pages never stored yet) are
   * read — so a link typed in the last few seconds (stores are debounced, ≤ 10 s) may be missing.
   */
  private async backlinks(wsId: string, pageId: string, candidates: Array<{ id: string; title: string; path: string }>) {
    const needle = Buffer.from(pageId)
    const out: Array<{ id: string; title: string; path: string }> = []
    for (const c of candidates) {
      if (out.length >= MAX_BACKLINKS) break
      const name = contentDoc(wsId, c.id)
      const stored = this.s.repo.loadDocument(name)
      if (stored && Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength).indexOf(needle) < 0) continue
      if (await this.s.collab.read(name, (doc) => fragmentLinks(doc).has(pageId))) out.push(c)
    }
    return out
  }

  /* ---------------------------------------------------------------- databases */

  listDatabases(wsId: string) {
    return this.model.read(wsId, (r) => {
      const out: Array<{ id: string; title: string; path: string; url: string; rows: number; properties: Array<{ name: string; type: string }> }> = []
      for (const id of r.databases.keys()) {
        const db = liveDatabase(r, id)
        if (!db) continue
        out.push({
          id,
          title: db.page.title || 'Untitled',
          path: pathOf(r, id),
          url: this.model.url(wsId, id),
          rows: rowsOf(r, id).length,
          properties: db.properties.map((p) => ({ name: p.name, type: p.type })),
        })
      }
      return { databases: out.sort((a, b) => a.path.localeCompare(b.path) || (a.id < b.id ? -1 : 1)) }
    })
  }

  getDatabase(wsId: string, dbId: string) {
    return this.model.read(wsId, (r) => {
      const db = liveDatabase(r, dbId)
      if (!db) throw notFound('database_not_found', `No database with id "${dbId}" in this workspace (one_list_databases lists them)`)
      const nameOf = (id: unknown) => (typeof id === 'string' ? (db.properties.find((p) => p.id === id)?.name ?? null) : null)
      const views = readOrdered<Record<string, unknown>>(db.ydb.get('views')).map((v) => ({
        id: String(v.id),
        name: typeof v.name === 'string' ? v.name : '',
        type: typeof v.type === 'string' ? v.type : 'table',
        ...(nameOf(v.groupBy) ? { groupBy: nameOf(v.groupBy) } : {}),
        ...(nameOf(v.dateProperty) ? { dateProperty: nameOf(v.dateProperty) } : {}),
        ...(Array.isArray(v.sorts) && v.sorts.length
          ? { sorts: (v.sorts as Array<{ propertyId?: unknown; direction?: unknown }>).map((s) => ({ property: nameOf(s.propertyId) ?? String(s.propertyId), direction: s.direction === 'desc' ? 'desc' : 'asc' })) }
          : {}),
        filtered: isObj(v.filter) && Array.isArray(v.filter.items) && v.filter.items.length > 0,
      }))
      return {
        id: dbId,
        title: db.page.title || 'Untitled',
        path: pathOf(r, dbId),
        url: this.model.url(wsId, dbId),
        parentId: db.page.parentId,
        rows: rowsOf(r, dbId).length,
        locked: db.ydb.get('locked') === true,
        properties: db.properties.map((p) => {
          const out = schemaOut(p) as ReturnType<typeof schemaOut> & { relationDatabaseTitle?: string }
          if (p.type === 'relation' && p.relationDatabaseId) out.relationDatabaseTitle = liveDatabase(r, p.relationDatabaseId)?.page.title ?? '(not available)'
          return out
        }),
        views,
      }
    })
  }

  queryDatabase(wsId: string, input: { databaseId: string; filter?: Condition[]; sort?: SortKey[]; limit: number; cursor?: string }) {
    return this.model.read(wsId, (r) => {
      const db = liveDatabase(r, input.databaseId)
      if (!db) throw notFound('database_not_found', `No database with id "${input.databaseId}" in this workspace (one_list_databases lists them)`)
      const fieldOf = (key: string): Field => field(db.properties, key)
      const conds = (input.filter ?? []).map((c) => ({ c, f: fieldOf(c.property) }))
      const keys = (input.sort ?? []).map((k) => ({ field: fieldOf(k.property), dir: (k.direction === 'desc' ? -1 : 1) as 1 | -1 }))
      const ctx = this.model.context(wsId, r)
      // the table's own order first (like the app), so equal sort keys keep it
      const rows = rowsOf(r, input.databaseId)
        .sort(byOrder)
        .map((p) => this.model.rowOut(wsId, db.properties, p, ctx))
      const hit = rows.filter((row) => conds.every(({ c, f }) => matches(f, c, row)))
      if (keys.length) hit.sort(sorter(keys))
      const fingerprint = JSON.stringify([input.databaseId, input.filter ?? [], input.sort ?? []])
      const offset = input.cursor ? decodeCursor(input.cursor, fingerprint) : 0
      const page = hit.slice(offset, offset + Math.min(input.limit, MAX_PAGE_SIZE))
      const end = offset + page.length
      return {
        database: { id: input.databaseId, title: db.page.title || 'Untitled' },
        total: hit.length,
        rows: page,
        next: end < hit.length ? encodeCursor(end, fingerprint) : null,
      }
    })
  }
}

/** A filter / sort key: a property (name or id), "title", "createdAt" or "updatedAt". */
function field(props: PropertyDef[], key: string): Field {
  const prop = findProperty(props, key)
  if (prop?.type === 'title' || (!prop && key.trim().toLowerCase() === 'title')) return { name: prop?.name ?? 'title', type: 'text', get: (row: FriendlyRow) => row.title }
  if (prop) return { name: prop.name, type: prop.type, get: (row: FriendlyRow) => row.properties[prop.name] ?? null }
  const k = key.trim().toLowerCase()
  if (k === 'createdat' || k === 'created') return { name: 'createdAt', type: 'created_time', get: (row) => row.createdAt }
  if (k === 'updatedat' || k === 'updated' || k === 'last edited') return { name: 'updatedAt', type: 'last_edited_time', get: (row) => row.updatedAt }
  throw new ApiError(422, 'unknown_property', `Unknown property "${key}". Properties: ${props.map((p) => p.name).join(', ')} (or title, createdAt, updatedAt)`)
}

/** Up to ~200 characters of `plain` around the first term found (whole lines are kept short). */
function snippet(plain: string, terms: string[]): string {
  const text = plain.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const low = text.toLowerCase()
  const at = terms.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 60)
  const cut = text.slice(start, start + 200)
  return `${start > 0 ? '…' : ''}${cut}${start + 200 < text.length ? '…' : ''}`
}

/** Words of a friendly value for search: strings, numbers, names / emails / titles inside objects. */
function valueText(v: unknown): string[] {
  if (v === null || v === undefined || v === false) return []
  if (typeof v === 'string') return v ? [v] : []
  if (typeof v === 'number') return [String(v)]
  if (v === true) return []
  if (Array.isArray(v)) return v.flatMap(valueText)
  if (isObj(v)) return ['title', 'name', 'email', 'start'].flatMap((k) => (typeof v[k] === 'string' && v[k] ? [v[k] as string] : []))
  return []
}
