/**
 * What the public API and incoming webhooks do with a workspace: read databases, rows and pages from
 * the meta / content documents, and write rows and pages the way the app does (docs/CLOUD.md
 * § Server writes). Every id is checked against the workspace's own meta document — a token or hook
 * never sees another workspace (404).
 */
import type * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { iso, newId } from '../tokens.ts'
import { appendBlocks, fragmentText, markdownToNodes, plainText, type Node } from './content.ts'
import {
  type PageInfo,
  type PropertyDef,
  type Roots,
  liveDatabase,
  livePage,
  newPageMap,
  nextOrder,
  pageMap,
  pairedRelation,
  propertiesMap,
  readPage,
  readPeople,
  roots,
  rowsOf,
  subItemsParent,
} from './meta.ts'
import { READ_ONLY_TYPES, ValueError, coerce, friendly, schemaOut, type ValueContext } from './values.ts'
import { checkKey, handOnlyMessage, isHandOnly } from './keys.ts'

export const metaDoc = (wsId: string) => `ws:${wsId}`
export const contentDoc = (wsId: string, pageId: string) => `ws:${wsId}:p:${pageId}`

export const MAX_PAGE_SIZE = 100
export type RowSort = 'order' | 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt'
export const ROW_SORTS: RowSort[] = ['order', 'createdAt', '-createdAt', 'updatedAt', '-updatedAt']

/** Raw input for a row: title and properties by name or id (friendly values). */
export interface RowInput {
  title?: string
  properties?: Record<string, unknown>
  content?: string
}

/** A row ready to be written: title, stored values by property id, content blocks. */
export interface ResolvedRow {
  title: string
  values: Record<string, unknown>
  nodes: Node[] | null
}

const unprocessable = (errors: ValueError[], code = 'invalid_value') =>
  new ApiError(422, code, errors.map((e) => e.message).join('; '), {
    details: { errors: errors.map((e) => ({ property: e.property, message: e.message, ...(e.allowed ? { allowed: e.allowed } : {}) })) },
  })

/** Who writes: `agent` — a server agent or an MCP client, which never writes a property "Only by hand" (keys.ts). */
export interface WriteOpts {
  agent?: boolean
}

/** A property by id, else by name (case-insensitive, trimmed). */
export function findProperty(props: PropertyDef[], key: string): PropertyDef | undefined {
  const k = key.trim().toLowerCase()
  return props.find((p) => p.id === key) ?? props.find((p) => p.name.trim().toLowerCase() === k)
}

export class WorkspaceModel {
  private readonly s: Services

  constructor(s: Services) {
    this.s = s
  }

  url(wsId: string, pageId: string): string {
    // ?w= opens this workspace even when the browser last used another one
    return `${this.s.config.publicUrl}/app/?w=${encodeURIComponent(wsId)}#/p/${pageId}`
  }

  context(wsId: string, r: Roots): ValueContext {
    return { r, members: this.s.repo.members(wsId).map((m) => ({ id: m.id, email: m.email, name: m.name })), people: readPeople(r) }
  }

  read<T>(wsId: string, fn: (r: Roots, doc: Y.Doc) => T): Promise<T> {
    return this.s.collab.read(metaDoc(wsId), (doc) => fn(roots(doc), doc))
  }

  /* ---------------------------------------------------------------- output */

  databaseOut(wsId: string, db: { page: PageInfo; properties: PropertyDef[] }) {
    return {
      id: db.page.id,
      title: db.page.title,
      url: this.url(wsId, db.page.id),
      parentId: db.page.parentId,
      createdAt: iso(db.page.createdAt),
      updatedAt: iso(db.page.updatedAt),
      properties: db.properties.map(schemaOut),
    }
  }

  rowOut(wsId: string, props: PropertyDef[], row: PageInfo, ctx: ValueContext) {
    const properties: Record<string, unknown> = {}
    for (const p of props) {
      if (p.type === 'title') continue
      const v = friendly(p, row, ctx)
      if (v !== undefined) properties[p.name] = v
    }
    return {
      id: row.id,
      databaseId: row.databaseId,
      title: row.title,
      url: this.url(wsId, row.id),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      properties,
    }
  }

  /* ---------------------------------------------------------------- reads */

  listDatabases(wsId: string) {
    return this.read(wsId, (r) => {
      const out: Array<ReturnType<WorkspaceModel['databaseOut']>> = []
      for (const id of r.databases.keys()) {
        const db = liveDatabase(r, id)
        if (db) out.push(this.databaseOut(wsId, db))
      }
      return out.sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1))
    })
  }

  getDatabase(wsId: string, dbId: string) {
    return this.read(wsId, (r) => {
      const db = liveDatabase(r, dbId)
      if (!db) throw notFound('database_not_found', 'No such database in this workspace')
      return this.databaseOut(wsId, db)
    })
  }

  listRows(wsId: string, dbId: string, opts: { limit: number; cursor: string | null; sort: RowSort }) {
    return this.read(wsId, (r) => {
      const db = liveDatabase(r, dbId)
      if (!db) throw notFound('database_not_found', 'No such database in this workspace')
      const key = (p: PageInfo) => (opts.sort === 'order' ? p.order : opts.sort.endsWith('createdAt') ? p.createdAt : p.updatedAt)
      const dir = opts.sort.startsWith('-') ? -1 : 1
      // ties: the app's own row order (createdAt), then the id — stable across pages
      const cmp = (a: { k: number; c: number; id: string }, b: { k: number; c: number; id: string }) => dir * (a.k - b.k) || a.c - b.c || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const rows = rowsOf(r, dbId)
        .map((p) => ({ p, at: { k: key(p), c: p.createdAt, id: p.id } }))
        .sort((a, b) => cmp(a.at, b.at))
      const after = opts.cursor ? decodeCursor(opts.cursor, opts.sort) : null
      const rest = after ? rows.filter((x) => cmp(x.at, after) > 0) : rows
      const page = rest.slice(0, opts.limit)
      const ctx = this.context(wsId, r)
      const last = page[page.length - 1]
      return {
        rows: page.map((x) => this.rowOut(wsId, db.properties, x.p, ctx)),
        next: rest.length > page.length && last ? encodeCursor(opts.sort, last.at) : null,
      }
    })
  }

  getRow(wsId: string, rowId: string) {
    return this.read(wsId, (r) => {
      const { row, db } = this.liveRow(r, rowId)
      return this.rowOut(wsId, db.properties, row, this.context(wsId, r))
    })
  }

  async getPage(wsId: string, pageId: string) {
    const head = await this.read(wsId, (r) => {
      const page = livePage(r, pageId)
      if (!page) throw notFound('page_not_found', 'No such page in this workspace')
      const db = page.databaseId ? liveDatabase(r, page.databaseId) : null
      const props = db ? this.rowOut(wsId, db.properties, page, this.context(wsId, r)).properties : undefined
      return {
        id: page.id,
        kind: page.kind === 'database' ? 'database' : db ? 'row' : 'page',
        title: page.title,
        url: this.url(wsId, page.id),
        parentId: page.parentId,
        databaseId: db ? page.databaseId : null,
        createdAt: iso(page.createdAt),
        updatedAt: iso(page.updatedAt),
        ...(props ? { properties: props } : {}),
      }
    })
    const text = await this.s.collab.read(contentDoc(wsId, pageId), (doc) => fragmentText(doc))
    return { ...head, text }
  }

  private liveRow(r: Roots, rowId: string) {
    const row = livePage(r, rowId)
    const db = row?.databaseId ? liveDatabase(r, row.databaseId) : null
    if (!row || !db) throw notFound('row_not_found', 'No such row in this workspace')
    return { row, db }
  }

  /* ---------------------------------------------------------------- input */

  /**
   * Friendly row input → stored values (strict: unknown properties and values that don't fit are a
   * 422 listing every problem). A title given as a property counts as the title.
   */
  resolveStrict(props: PropertyDef[], input: RowInput, ctx: ValueContext, opts: WriteOpts = {}): { title: string | undefined; values: Record<string, unknown> } {
    const errors: ValueError[] = []
    const values: Record<string, unknown> = {}
    let title = input.title
    for (const [key, raw] of Object.entries(input.properties ?? {})) {
      const prop = findProperty(props, key)
      if (!prop) {
        errors.push(new ValueError(key, `Unknown property "${key}"`, props.filter((p) => !READ_ONLY_TYPES.has(p.type) && !(opts.agent && isHandOnly(p))).map((p) => p.name)))
        continue
      }
      if (opts.agent && isHandOnly(prop)) {
        errors.push(new ValueError(prop.name, handOnlyMessage(prop)))
        continue
      }
      try {
        const v = coerce(prop, raw, ctx)
        if (prop.type === 'title') title ??= String(v)
        else values[prop.id] = v
      } catch (e) {
        if (e instanceof ValueError) errors.push(e)
        else throw e
      }
    }
    if (errors.length) throw unprocessable(errors)
    return { title, values }
  }

  /** Rule checks that need the row itself: one parent per row for sub-items, no self-parent. */
  private checkHierarchy(ydb: Y.Map<unknown>, props: PropertyDef[], rowId: string, values: Record<string, unknown>) {
    const parentId = subItemsParent(ydb)
    if (!parentId || !(parentId in values)) return
    const ids = values[parentId] as string[]
    const name = props.find((p) => p.id === parentId)?.name ?? parentId
    if (ids.length > 1) throw unprocessable([new ValueError(name, `${name}: a row has at most one parent`)])
    if (ids.includes(rowId)) throw unprocessable([new ValueError(name, `${name}: a row cannot be its own parent`)])
  }

  /* ---------------------------------------------------------------- writes */

  /** Validates (strict), then creates. `opts.id`: the new row's id (agents' staged rows), else a fresh one. */
  async createRow(wsId: string, dbId: string, input: RowInput, actor: string, opts: { id?: string } & WriteOpts = {}) {
    const resolved = await this.read(wsId, (r) => {
      const db = liveDatabase(r, dbId)
      if (!db) throw notFound('database_not_found', 'No such database in this workspace')
      if (opts.id && pageMap(r, opts.id)) throw new ApiError(409, 'page_exists', 'A page with this id exists already')
      const { title, values } = this.resolveStrict(db.properties, input, this.context(wsId, r), opts)
      // the database's key stays unique (checked again when the row is written)
      checkKey(r, dbId, db.properties, values, null)
      return { title: title ?? '', values, nodes: input.content !== undefined && input.content.trim() ? markdownToNodes(input.content) : null }
    })
    return this.insertRow(wsId, dbId, resolved, actor, opts.id)
  }

  /**
   * Write a resolved row: its content document first (so the row arrives with its content), then the
   * meta entry — order after the last row, unique ids from the database's counter, two-way relations.
   */
  async insertRow(wsId: string, dbId: string, row: ResolvedRow, actor: string, presetId?: string): Promise<{ id: string; url: string }> {
    const id = presetId ?? newId()
    if (row.nodes?.length) {
      // a row refused for its key (keys.ts) leaves no content document behind
      await this.read(wsId, (r) => {
        const db = liveDatabase(r, dbId)
        if (db) checkKey(r, dbId, db.properties, row.values, null)
      })
      await this.s.collab.write(contentDoc(wsId, id), (doc) => appendBlocks(doc, row.nodes!), actor)
    }
    await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const db = liveDatabase(r, dbId)
        if (!db) throw notFound('database_not_found', 'No such database in this workspace')
        if (presetId && pageMap(r, id)) throw new ApiError(409, 'page_exists', 'A page with this id exists already')
        this.checkHierarchy(db.ydb, db.properties, id, row.values)
        // the database's key: unique per row (keys.ts) — webhooks, the API, MCP and agents alike
        checkKey(r, dbId, db.properties, row.values, null)
        const values = { ...row.values }
        const uniques = db.properties.filter((p) => p.type === 'unique_id')
        const counter = db.ydb.get('nextUniqueId')
        const next = typeof counter === 'number' && Number.isFinite(counter) ? counter : 1
        for (const p of uniques) values[p.id] = next
        const at = Date.now()
        // —— changes from here on ——
        if (uniques.length) db.ydb.set('nextUniqueId', next + 1)
        r.pages.set(id, newPageMap({ id, title: row.title, parentId: dbId, databaseId: dbId, order: nextOrder(r, dbId), properties: values, plain: row.nodes ? plainText(row.nodes) : '', at }, actor))
        this.syncPartners(r, dbId, db.properties, id, {}, values, actor, at)
      },
      actor,
    )
    this.s.log.info('api row created', { workspace: wsId, database: dbId, row: id, by: actor })
    return { id, url: this.url(wsId, id) }
  }

  async updateRow(wsId: string, rowId: string, input: RowInput, actor: string, opts: WriteOpts = {}) {
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, row } = this.liveRow(r, rowId)
        const ctx = this.context(wsId, r)
        const { title, values } = this.resolveStrict(db.properties, input, ctx, opts)
        this.checkHierarchy(db.ydb, db.properties, rowId, values)
        checkKey(r, db.page.id, db.properties, values, rowId, row.properties)
        const yp = pageMap(r, rowId)!
        const pm = propertiesMap(yp)
        const before: Record<string, unknown> = {}
        for (const k of Object.keys(values)) before[k] = pm.get(k)
        // a moved date keeps the reminder set on it in the app (it rides along date changes there too)
        for (const p of db.properties) if (p.type === 'date' && p.id in values) values[p.id] = keepReminder(before[p.id], values[p.id])
        const at = Date.now()
        // —— changes from here on ——
        if (title !== undefined) yp.set('title', title)
        for (const [k, v] of Object.entries(values)) pm.set(k, v)
        yp.set('updatedAt', at)
        yp.set('updatedBy', actor)
        this.syncPartners(r, db.page.id, db.properties, rowId, before, values, actor, at)
        return this.rowOut(wsId, db.properties, readPage(rowId, yp), ctx)
      },
      actor,
    )
    this.s.log.info('api row updated', { workspace: wsId, row: rowId, by: actor })
    return out
  }

  /**
   * Two-way relations (the app's writeValue): rows linked now get this row in their partner
   * property, rows unlinked lose it. A partner that is a sub-items parent holds one row only.
   */
  private syncPartners(r: Roots, dbId: string, props: PropertyDef[], rowId: string, before: Record<string, unknown>, after: Record<string, unknown>, actor: string, at: number) {
    const relOf = (id: string, propId: string): string[] => {
      const yp = pageMap(r, id)
      const v = yp ? propertiesMap(yp).get(propId) : undefined
      return Array.isArray(v) ? (v as string[]) : []
    }
    const setRel = (id: string, propId: string, next: string[]) => {
      const yp = pageMap(r, id)
      if (!yp) return
      propertiesMap(yp).set(propId, next)
      yp.set('updatedAt', at)
      yp.set('updatedBy', actor)
    }
    for (const prop of props) {
      if (prop.type !== 'relation' || !(prop.id in after)) continue
      const pair = pairedRelation(r, dbId, prop)
      if (!pair) continue
      const targetDb = liveDatabase(r, pair.dbId)
      const single = !!targetDb && subItemsParent(targetDb.ydb) === pair.prop.id
      const was = new Set(Array.isArray(before[prop.id]) ? (before[prop.id] as string[]) : [])
      const now = new Set(after[prop.id] as string[])
      for (const id of now) {
        if (was.has(id)) continue
        const cur = relOf(id, pair.prop.id)
        if (single) {
          // one parent per row: the row leaves its old parent's list, then points at this row
          for (const old of cur) {
            if (old !== rowId && relOf(old, prop.id).includes(id)) setRel(old, prop.id, relOf(old, prop.id).filter((x) => x !== id))
          }
          if (cur.length !== 1 || cur[0] !== rowId) setRel(id, pair.prop.id, [rowId])
        } else if (!cur.includes(rowId)) setRel(id, pair.prop.id, [...cur, rowId])
      }
      for (const id of was) {
        if (now.has(id)) continue
        const cur = relOf(id, pair.prop.id)
        if (cur.includes(rowId)) setRel(id, pair.prop.id, cur.filter((x) => x !== rowId))
      }
    }
  }

  /** `input.id`: the new page's id (agents' staged pages), else a fresh one. */
  async createPage(wsId: string, input: { id?: string; parentId?: string | null; title: string; content?: string; icon?: unknown }, actor: string) {
    const parentId = input.parentId ?? null
    const check = (r: Roots) => {
      if (input.id && pageMap(r, input.id)) throw new ApiError(409, 'page_exists', 'A page with this id exists already')
      if (!parentId) return
      const parent = livePage(r, parentId)
      if (!parent) throw notFound('parent_not_found', 'No such parent page in this workspace')
      if (parent.kind === 'database') throw new ApiError(422, 'parent_is_database', 'The parent is a database: create rows with POST /api/v1/databases/:id/rows')
    }
    await this.read(wsId, check)
    const nodes = input.content?.trim() ? markdownToNodes(input.content) : null
    const id = input.id ?? newId()
    if (nodes) await this.s.collab.write(contentDoc(wsId, id), (doc) => appendBlocks(doc, nodes), actor)
    await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        check(r)
        r.pages.set(id, newPageMap({ id, title: input.title, icon: input.icon ?? null, parentId, databaseId: null, order: nextOrder(r, parentId), properties: {}, plain: nodes ? plainText(nodes) : '', at: Date.now() }, actor))
      },
      actor,
    )
    this.s.log.info('api page created', { workspace: wsId, page: id, by: actor })
    return { id, url: this.url(wsId, id) }
  }
}

/** The app's reminder of a date value (DateValue.reminder), carried over to its new date. */
function keepReminder(prev: unknown, next: unknown): unknown {
  const reminder = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as { reminder?: unknown }).reminder : null
  return typeof reminder === 'string' && reminder && next && typeof next === 'object' && !Array.isArray(next) ? { ...next, reminder } : next
}

/* ------------------------------------------------------------------ cursors */

function encodeCursor(sort: RowSort, at: { k: number; c: number; id: string }): string {
  return Buffer.from(JSON.stringify([sort, at.k, at.c, at.id])).toString('base64url')
}

function decodeCursor(cursor: string, sort: RowSort): { k: number; c: number; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (Array.isArray(v) && v[0] === sort && typeof v[1] === 'number' && typeof v[2] === 'number' && typeof v[3] === 'string') return { k: v[1], c: v[2], id: v[3] }
  } catch {
    /* below */
  }
  throw new ApiError(400, 'invalid_cursor', 'The cursor is invalid (or belongs to another sort order)')
}
