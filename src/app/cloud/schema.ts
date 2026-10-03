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
const PAGE_FIELDS = ['kind', 'title', 'icon', 'cover', 'parentId', 'databaseId', 'order', 'trashed', 'trashedAt', 'createdAt', 'updatedAt', 'settings', 'hidden', 'plain', 'template'] as const
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

/**
 * Comment threads: `<threadId>` → the thread without its replies, `<threadId>/r/<replyId>` → one
 * reply — so two people replying to the same thread at the same time both keep their reply.
 */
const REPLY_SEP = '/r/'
const threadOnly = (c: PageComment) => {
  const { replies: _r, ...rest } = c
  return rest
}

function writeComments(target: YMap, list: PageComment[] | undefined, before: PageComment[] | undefined) {
  const prev = new Map((Array.isArray(before) ? before : []).map((c) => [c.id, c]))
  const next = Array.isArray(list) ? list : []
  for (const c of next) {
    const was = prev.get(c.id)
    prev.delete(c.id)
    if (was === c) continue
    if (!was || !deepEqual(threadOnly(was), threadOnly(c))) target.set(c.id, clone(threadOnly(c)))
    const before = new Map((Array.isArray(was?.replies) ? was!.replies : []).map((r) => [r.id, r]))
    for (const r of Array.isArray(c.replies) ? c.replies : []) {
      const old = before.get(r.id)
      before.delete(r.id)
      if (old !== r && !deepEqual(old, r)) target.set(`${c.id}${REPLY_SEP}${r.id}`, clone(r))
    }
    for (const id of before.keys()) target.delete(`${c.id}${REPLY_SEP}${id}`)
  }
  for (const id of prev.keys()) {
    target.delete(id)
    for (const k of [...target.keys()]) if (k.startsWith(`${id}${REPLY_SEP}`)) target.delete(k)
  }
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
  for (const c of Array.isArray(page.comments) ? page.comments : []) {
    comments.set(c.id, clone(threadOnly(c)))
    for (const r of Array.isArray(c.replies) ? c.replies : []) comments.set(`${c.id}${REPLY_SEP}${r.id}`, clone(r))
  }
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
  const threads: PageComment[] = []
  const replies = new Map<string, PageComment['replies']>()
  for (const [k, c] of (v as YMap).entries()) {
    if (!isObj(c) || typeof c.id !== 'string') continue
    const at = k.indexOf(REPLY_SEP)
    if (at > 0) {
      const list = replies.get(k.slice(0, at)) ?? []
      list.push(clone(c) as unknown as PageComment['replies'][number])
      replies.set(k.slice(0, at), list)
    } else threads.push(clone(c) as unknown as PageComment)
  }
  const byTime = <T extends { id: string; createdAt?: number }>(a: T, b: T) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1)
  for (const t of threads) {
    // a thread written whole (with its replies inside) keeps those as well
    const inline = Array.isArray(t.replies) ? t.replies : []
    const own = replies.get(t.id) ?? []
    const ids = new Set(own.map((r) => r.id))
    t.replies = [...own, ...inline.filter((r) => !ids.has(r.id))].sort(byTime)
  }
  return threads.sort(byTime)
}

/**
 * A store page from its meta entry. Per-device fields (content, revs, favourite) come from `cur`
 * (or the defaults for a page this device hasn't seen). `priv`: the entry is in this member's
 * private meta document (sets the local `private` marker).
 */
export function readPage(id: ID, yp: YMap, cur: Page | undefined, favorite: boolean, priv = false): Page {
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
  // a template's root (features/templates): gallery metadata, shared by the whole team
  const template = g('template')
  if (isObj(template) && typeof template.name === 'string') next.template = clone(template) as unknown as Page['template']
  // who made / last changed it (created_by / last_edited_by): read only, the writing client sets them
  const createdBy = g('createdBy')
  if (typeof createdBy === 'string' && createdBy) next.createdBy = createdBy
  const updatedBy = g('updatedBy')
  if (typeof updatedBy === 'string' && updatedBy) next.updatedBy = updatedBy
  if (priv) next.private = true
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
  if (Array.isArray(v)) return clone(v.filter((x) => isObj(x) && typeof x.id === 'string')) as T[]
  if (!(v instanceof Y.Map)) return []
  const items: Ordered[] = []
  for (const x of (v as YMap).values()) if (isObj(x) && typeof x.id === 'string') items.push(clone(x) as unknown as Ordered)
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))
  return items.map(({ order: _o, ...rest }) => rest as unknown as T)
}

/**
 * Keyed lists of a database entry: Y.Map id → item (+ `order`), so concurrent changes of different
 * items (two automations, an automation's run status and its settings …) never overwrite each other.
 * Database keys other than these are stored as JSON fields of the database entry.
 */
const DB_KEYED = ['properties', 'views', 'automations', 'templates'] as const
const DB_NESTED = new Set<string>(['id', ...DB_KEYED])

const keyedList = (db: Database, key: (typeof DB_KEYED)[number]): Array<{ id: string }> => {
  const v = (db as unknown as Record<string, unknown>)[key]
  return Array.isArray(v) ? v.filter((x): x is { id: string } => isObj(x) && typeof x.id === 'string') : []
}

export function newDatabaseMap(db: Database): YMap {
  const ydb = new Y.Map<unknown>()
  for (const key of DB_KEYED) {
    const list = keyedList(db, key)
    if (!list.length && key !== 'properties' && key !== 'views') continue
    const m = new Y.Map<unknown>()
    list.forEach((x, i) => m.set(x.id, { ...clone(x), order: i }))
    ydb.set(key, m)
  }
  for (const [k, v] of Object.entries(db)) if (!DB_NESTED.has(k) && v !== undefined) ydb.set(k, clone(v))
  return ydb
}

export function writeDatabase(ydb: YMap, db: Database, before: Database): void {
  const r = db as unknown as Record<string, unknown>
  const b = before as unknown as Record<string, unknown>
  for (const key of DB_KEYED) {
    if (r[key] === b[key]) continue
    const target = ydb.get(key)
    // an older entry kept the list as one JSON value: from now on it is keyed
    const map = target instanceof Y.Map ? (target as YMap) : childMap(ydb, key)
    writeOrdered(map, keyedList(db, key), target instanceof Y.Map ? keyedList(before, key) : [])
  }
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
  for (const key of ['automations', 'templates'] as const) {
    const v = ydb.get(key)
    if (v !== undefined) next[key] = readOrdered(v)
  }
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
