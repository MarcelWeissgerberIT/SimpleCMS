/**
 * The workspace meta document (docs/CLOUD.md § Meta document schema) ⇄ store shapes.
 *
 *   'workspace'  name, icon, createdAt
 *   'pages'      pageId → Y.Map { scalar fields …, properties: Y.Map, comments: Y.Map, plain }
 *   'databases'  dbId → Y.Map { properties: Y.Map (id → def + order), views: Y.Map (id → view + order), other keys as JSON }
 *   'people'     personId → Person
 *
 * Writers only touch what changed (field / cell / thread / property / view level), so concurrent
 * edits of different fields of one page all survive. Readers build store objects and reuse the
 * previous object (and sub-objects) when nothing changed, so React sees no churn.
 */
import * as Y from 'yjs'
import type { Database, ID, Page, PageComment, Person, PropertyDef, View } from '../store/types'
import { DEFAULT_PAGE_SETTINGS } from '../store/store'
import { deepEqual } from '../store/merge'

/** Origin of every store → meta transaction (docs/CLOUD.md: origin 'local'). */
export const LOCAL = 'local'

export type YMap = Y.Map<unknown>

export const roots = (doc: Y.Doc) => ({
  workspace: doc.getMap<unknown>('workspace'),
  pages: doc.getMap<YMap>('pages'),
  databases: doc.getMap<YMap>('databases'),
  people: doc.getMap<unknown>('people'),
})

/** Synced page fields stored as plain values (everything else is per device or nested). */
const PAGE_FIELDS = ['kind', 'title', 'icon', 'cover', 'parentId', 'databaseId', 'order', 'trashed', 'trashedAt', 'createdAt', 'updatedAt', 'settings', 'hidden', 'plain'] as const
type PageField = (typeof PAGE_FIELDS)[number]

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A detached JSON copy (drops undefined, never shares a reference with the store or Y). */
export function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v)) as T
}

function setValue(map: YMap, key: string, value: unknown) {
  if (value === undefined) map.delete(key)
  else map.set(key, clone(value))
}

/* ------------------------------------------------------------------ pages */

function writeComments(target: YMap, list: PageComment[] | undefined, before: PageComment[] | undefined) {
  const prev = new Map((Array.isArray(before) ? before : []).map((c) => [c.id, c]))
  const next = Array.isArray(list) ? list : []
  for (const c of next) {
    const was = prev.get(c.id)
    if (was !== c && !deepEqual(was, c)) target.set(c.id, clone(c))
    prev.delete(c.id)
  }
  for (const id of prev.keys()) target.delete(id)
}

function writeProperties(target: YMap, props: Page['properties'], before: Page['properties'] | undefined) {
  const prev = before ?? {}
  for (const [k, v] of Object.entries(props ?? {})) {
    if (prev[k] === v || deepEqual(prev[k], v)) continue
    setValue(target, k, v)
  }
  for (const k of Object.keys(prev)) if (!(k in (props ?? {}))) target.delete(k)
}

/** A page entry for a page the meta document doesn't have yet. */
export function newPageMap(page: Page, userId: string): YMap {
  const yp = new Y.Map<unknown>()
  for (const k of PAGE_FIELDS) if (page[k] !== undefined) yp.set(k, clone(page[k]))
  yp.set('createdBy', userId)
  yp.set('updatedBy', userId)
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(page.properties ?? {})) if (v !== undefined) props.set(k, clone(v))
  yp.set('properties', props)
  const comments = new Y.Map<unknown>()
  for (const c of Array.isArray(page.comments) ? page.comments : []) comments.set(c.id, clone(c))
  yp.set('comments', comments)
  return yp
}

function childMap(parent: YMap, key: string): YMap {
  const cur = parent.get(key)
  if (cur instanceof Y.Map) return cur as YMap
  const fresh = new Y.Map<unknown>()
  parent.set(key, fresh)
  return fresh
}

/** Write what changed between `before` and `page` into an existing page entry. True when anything was written. */
export function writePage(yp: YMap, page: Page, before: Page, userId: string): boolean {
  let changed = false
  for (const k of PAGE_FIELDS) {
    const a = page[k as PageField]
    const b = before[k as PageField]
    if (a === b || deepEqual(a, b)) continue
    setValue(yp, k, a)
    changed = true
  }
  if (page.properties !== before.properties && !deepEqual(page.properties, before.properties)) {
    writeProperties(childMap(yp, 'properties'), page.properties, before.properties)
    changed = true
  }
  if (page.comments !== before.comments && !deepEqual(page.comments ?? [], before.comments ?? [])) {
    writeComments(childMap(yp, 'comments'), page.comments, before.comments)
    changed = true
  }
  if (changed) yp.set('updatedBy', userId)
  return changed
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Keep `prev`'s sub-objects where they are equal, and `prev` itself when nothing changed. */
function reuse<T extends object>(prev: T | undefined, next: T): T {
  if (!prev) return next
  const p = prev as Record<string, unknown>
  const n = next as Record<string, unknown>
  let same = true
  for (const k of Object.keys(n)) {
    if (p[k] === n[k]) continue
    if (deepEqual(p[k], n[k])) n[k] = p[k]
    else same = false
  }
  for (const k of Object.keys(p)) if (!(k in n) && p[k] !== undefined) same = false
  return same ? prev : next
}

function readComments(v: unknown): PageComment[] {
  if (!(v instanceof Y.Map)) return []
  const out: PageComment[] = []
  for (const c of (v as YMap).values()) if (isObj(c) && typeof c.id === 'string') out.push(clone(c) as unknown as PageComment)
  return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1))
}

/**
 * A store page from its meta entry. Per-device fields (content, revs, favourite) come from `cur`
 * (or the defaults for a page this device hasn't seen).
 */
export function readPage(id: ID, yp: YMap, cur: Page | undefined, favorite: boolean): Page {
  const g = (k: string) => yp.get(k)
  const propsMap = g('properties')
  const properties: Page['properties'] = {}
  if (propsMap instanceof Y.Map) for (const [k, v] of (propsMap as YMap).entries()) if (v !== undefined) properties[k] = clone(v) as Page['properties'][string]
  const createdAt = num(g('createdAt'), cur?.createdAt ?? Date.now())
  const settings = g('settings')
  const next: Page = {
    id,
    kind: g('kind') === 'database' ? 'database' : 'page',
    title: str(g('title')),
    icon: isObj(g('icon')) ? (clone(g('icon')) as Page['icon']) : null,
    cover: isObj(g('cover')) ? (clone(g('cover')) as Page['cover']) : null,
    parentId: idOrNull(g('parentId')),
    databaseId: idOrNull(g('databaseId')),
    properties,
    content: cur?.content ?? null,
    contentRev: cur?.contentRev ?? 0,
    contentOrigin: cur?.contentOrigin ?? null,
    favorite: cur ? cur.favorite : favorite,
    trashed: g('trashed') === true,
    trashedAt: typeof g('trashedAt') === 'number' ? (g('trashedAt') as number) : null,
    createdAt,
    updatedAt: num(g('updatedAt'), createdAt),
    order: num(g('order'), 0),
    settings: { ...DEFAULT_PAGE_SETTINGS, ...(isObj(settings) ? (clone(settings) as Partial<Page['settings']>) : {}) },
    plain: str(g('plain'), cur?.plain ?? ''),
  }
  const hidden = g('hidden')
  if (hidden !== undefined) next.hidden = hidden === true
  const comments = readComments(g('comments'))
  if (comments.length || cur?.comments !== undefined) next.comments = comments
  return reuse(cur, next)
}

/* ------------------------------------------------------------------ databases */

type Ordered = { id: string; order?: number }

function writeOrdered<T extends { id: string }>(target: YMap, list: T[], before: T[] | undefined) {
  const prevIndex = new Map((before ?? []).map((x, i) => [x.id, { x, i }]))
  list.forEach((item, i) => {
    const was = prevIndex.get(item.id)
    if (!was || was.i !== i || (was.x !== item && !deepEqual(was.x, item))) target.set(item.id, { ...clone(item), order: i })
    prevIndex.delete(item.id)
  })
  for (const id of prevIndex.keys()) target.delete(id)
}

function readOrdered<T>(v: unknown): T[] {
  if (!(v instanceof Y.Map)) return []
  const items: Ordered[] = []
  for (const x of (v as YMap).values()) if (isObj(x) && typeof x.id === 'string') items.push(clone(x) as unknown as Ordered)
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))
  return items.map(({ order: _o, ...rest }) => rest as unknown as T)
}

/** Database keys other than these are stored as JSON fields of the database entry. */
const DB_NESTED = new Set(['id', 'properties', 'views'])

export function newDatabaseMap(db: Database): YMap {
  const ydb = new Y.Map<unknown>()
  const props = new Y.Map<unknown>()
  db.properties.forEach((p, i) => props.set(p.id, { ...clone(p), order: i }))
  const views = new Y.Map<unknown>()
  db.views.forEach((v, i) => views.set(v.id, { ...clone(v), order: i }))
  ydb.set('properties', props)
  ydb.set('views', views)
  for (const [k, v] of Object.entries(db)) if (!DB_NESTED.has(k) && v !== undefined) ydb.set(k, clone(v))
  return ydb
}

export function writeDatabase(ydb: YMap, db: Database, before: Database): void {
  if (db.properties !== before.properties) writeOrdered(childMap(ydb, 'properties'), db.properties, before.properties)
  if (db.views !== before.views) writeOrdered(childMap(ydb, 'views'), db.views, before.views)
  const rec = db as unknown as Record<string, unknown>
  const prev = before as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(rec), ...Object.keys(prev)])) {
    if (DB_NESTED.has(k) || rec[k] === prev[k] || deepEqual(rec[k], prev[k])) continue
    setValue(ydb, k, rec[k])
  }
}

export function readDatabase(id: ID, ydb: YMap, cur: Database | undefined): Database {
  const next: Record<string, unknown> = { id }
  for (const [k, v] of ydb.entries()) if (!DB_NESTED.has(k) && v !== undefined) next[k] = clone(v)
  next.properties = readOrdered<PropertyDef>(ydb.get('properties'))
  next.views = readOrdered<View>(ydb.get('views'))
  if (typeof next.nextUniqueId !== 'number') next.nextUniqueId = 1
  const db = next as unknown as Database
  if (cur) {
    // keep unchanged property / view objects (views re-render per object)
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))
    const props = byId(cur.properties)
    db.properties = db.properties.map((p) => (deepEqual(props.get(p.id), p) ? props.get(p.id)! : p))
    const views = byId(cur.views)
    db.views = db.views.map((v) => (deepEqual(views.get(v.id), v) ? views.get(v.id)! : v))
  }
  return reuse(cur, db)
}

/* ------------------------------------------------------------------ people */

export function writePeople(target: Y.Map<unknown>, people: Person[], before: Person[]): void {
  const prev = new Map(before.map((p) => [p.id, p]))
  for (const p of people) {
    const was = prev.get(p.id)
    if (was !== p && !deepEqual(was, p)) target.set(p.id, clone(p))
    prev.delete(p.id)
  }
  for (const id of prev.keys()) target.delete(id)
}

export function readPeople(source: Y.Map<unknown>, cur: Person[]): Person[] {
  const remote = new Map<string, Person>()
  for (const [id, v] of source.entries()) if (isObj(v) && typeof v.name === 'string') remote.set(id, { ...(clone(v) as unknown as Person), id })
  const out: Person[] = []
  // keep this device's order; new people go to the end (by id, the same on every device)
  for (const p of cur) {
    const r = remote.get(p.id)
    if (!r) continue
    out.push(deepEqual(p, r) ? p : r)
    remote.delete(p.id)
  }
  out.push(...[...remote.values()].sort((a, b) => (a.id < b.id ? -1 : 1)))
  return out.length === cur.length && out.every((p, i) => p === cur[i]) ? cur : out
}
