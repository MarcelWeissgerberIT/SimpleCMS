/**
 * The workspace meta document (docs/CLOUD.md § Meta document schema), read and written by the server
 * exactly the way the app's binding does it (src/app/cloud/schema.ts): pages are Y.Maps of plain JSON
 * fields plus `properties` / `comments` Y.Maps, databases keep `properties` (and views …) as Y.Maps of
 * id → JSON definition with an `order` number. Keep the two in step.
 */
import * as Y from 'yjs'

export type YMap = Y.Map<unknown>

export interface SelectOption {
  id: string
  name: string
  color?: string
  group?: string
}

export interface PropertyDef {
  id: string
  name: string
  type: string
  options?: SelectOption[]
  relationDatabaseId?: string
  idPrefix?: string
  ratingMax?: number
  description?: string
}

export interface PageInfo {
  id: string
  kind: 'page' | 'database'
  title: string
  parentId: string | null
  databaseId: string | null
  order: number
  trashed: boolean
  createdAt: number
  updatedAt: number
  /** Account id, `api:<tokenId>` or `hook:<hookId>` of who created / last changed the page. */
  createdBy: string | null
  updatedBy: string | null
  properties: Record<string, unknown>
}

/** The page settings a new page starts with (DEFAULT_PAGE_SETTINGS in the app's store). */
export const DEFAULT_PAGE_SETTINGS = { fullWidth: false, smallText: false, font: 'sans', locked: false }

/** The app's sub-items / two-way relation id convention (database/model/actions.ts). */
export const TWO_WAY_SUFFIX = '.2way'

export const roots = (doc: Y.Doc) => ({
  workspace: doc.getMap<unknown>('workspace'),
  pages: doc.getMap<unknown>('pages'),
  databases: doc.getMap<unknown>('databases'),
  people: doc.getMap<unknown>('people'),
})

export type Roots = ReturnType<typeof roots>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** A detached JSON copy (never shares a reference with Y). */
export const clone = <T>(v: T): T => (v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as T))

export function pageMap(r: Roots, id: string): YMap | null {
  const yp = r.pages.get(id)
  return yp instanceof Y.Map ? (yp as YMap) : null
}

export function readPage(id: string, yp: YMap): PageInfo {
  const g = (k: string) => yp.get(k)
  const properties: Record<string, unknown> = {}
  const props = g('properties')
  if (props instanceof Y.Map) for (const [k, v] of (props as YMap).entries()) if (v !== undefined) properties[k] = clone(v)
  const createdAt = num(g('createdAt'), 0)
  return {
    id,
    kind: g('kind') === 'database' ? 'database' : 'page',
    title: str(g('title')),
    parentId: idOrNull(g('parentId')),
    databaseId: idOrNull(g('databaseId')),
    order: num(g('order'), 0),
    trashed: g('trashed') === true,
    createdAt,
    updatedAt: num(g('updatedAt'), createdAt),
    createdBy: typeof g('createdBy') === 'string' ? (g('createdBy') as string) : null,
    updatedBy: typeof g('updatedBy') === 'string' ? (g('updatedBy') as string) : null,
    properties,
  }
}

export function allPages(r: Roots): PageInfo[] {
  const out: PageInfo[] = []
  for (const [id, yp] of r.pages.entries()) if (yp instanceof Y.Map) out.push(readPage(id, yp as YMap))
  return out
}

/** Trashed itself or below a trashed page (cycle-safe). */
export function inTrash(r: Roots, id: string): boolean {
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const yp = pageMap(r, cur)
    if (!yp) return false
    if (yp.get('trashed') === true) return true
    cur = idOrNull(yp.get('parentId'))
  }
  return false
}

/**
 * Part of a template (the app's features/templates: a page subtree whose root carries `template`
 * metadata). Templates are blueprints for the gallery, not workspace content — the app keeps them out
 * of every list, and so does the API. Cycle-safe.
 */
export function inTemplate(r: Roots, id: string): boolean {
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const yp = pageMap(r, cur)
    if (!yp) return false
    if (isObj(yp.get('template'))) return true
    cur = idOrNull(yp.get('parentId'))
  }
  return false
}

/** Not for the API: in the trash or part of a template. */
export const outOfReach = (r: Roots, id: string): boolean => inTrash(r, id) || inTemplate(r, id)

/** Keyed lists (Y.Map id → item + order), or the older JSON-array form — like readOrdered in the app. */
export function readOrdered<T>(v: unknown): T[] {
  if (Array.isArray(v)) return clone(v.filter((x) => isObj(x) && typeof x.id === 'string')) as T[]
  if (!(v instanceof Y.Map)) return []
  const items: Array<{ id: string; order?: number }> = []
  for (const x of (v as YMap).values()) if (isObj(x) && typeof x.id === 'string') items.push(clone(x) as { id: string; order?: number })
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))
  return items.map(({ order: _o, ...rest }) => rest as unknown as T)
}

export function databaseMap(r: Roots, id: string): YMap | null {
  const ydb = r.databases.get(id)
  return ydb instanceof Y.Map ? (ydb as YMap) : null
}

export function readProperties(ydb: YMap): PropertyDef[] {
  return readOrdered<PropertyDef>(ydb.get('properties')).filter((p) => typeof p.name === 'string' && typeof p.type === 'string')
}

/** A database the API may use: its page exists, is a database, not in the trash and not part of a template. */
export function liveDatabase(r: Roots, id: string): { page: PageInfo; ydb: YMap; properties: PropertyDef[] } | null {
  const yp = pageMap(r, id)
  const ydb = databaseMap(r, id)
  if (!yp || !ydb || yp.get('kind') !== 'database' || outOfReach(r, id)) return null
  return { page: readPage(id, yp), ydb, properties: readProperties(ydb) }
}

/** A page (or row) the API may use: listed, not in the trash and not part of a template. */
export function livePage(r: Roots, id: string): PageInfo | null {
  const yp = pageMap(r, id)
  if (!yp || outOfReach(r, id)) return null
  return readPage(id, yp)
}

/** Rows of a database that are not in the trash. */
export function rowsOf(r: Roots, dbId: string): PageInfo[] {
  const out: PageInfo[] = []
  for (const [id, yp] of r.pages.entries()) {
    if (!(yp instanceof Y.Map) || yp.get('databaseId') !== dbId || yp.get('trashed') === true) continue
    out.push(readPage(id, yp as YMap))
  }
  return out
}

/** After the last sibling (the app's nextOrder: max order among pages with this parent, + 1). */
export function nextOrder(r: Roots, parentId: string | null): number {
  let max = 0
  for (const yp of r.pages.values()) {
    if (!(yp instanceof Y.Map)) continue
    if (idOrNull(yp.get('parentId')) !== parentId) continue
    const o = num(yp.get('order'), 0)
    if (o > max) max = o
  }
  return max + 1
}

export interface NewPage {
  id: string
  /** 'database' for a database's own page (default 'page') */
  kind?: 'page' | 'database'
  title: string
  /** PageIcon JSON ({ type: 'emoji' | 'asset' | 'lucide', value }) or null */
  icon?: unknown
  parentId: string | null
  databaseId: string | null
  order: number
  properties: Record<string, unknown>
  plain: string
  at: number
}

/** A page entry exactly like the app's newPageMap (store makePage → schema newPageMap). */
export function newPageMap(p: NewPage, actor: string): YMap {
  const yp = new Y.Map<unknown>()
  const fields: Record<string, unknown> = {
    kind: p.kind ?? 'page',
    title: p.title,
    icon: p.icon ?? null,
    cover: null,
    parentId: p.parentId,
    databaseId: p.databaseId,
    order: p.order,
    trashed: false,
    trashedAt: null,
    createdAt: p.at,
    updatedAt: p.at,
    settings: { ...DEFAULT_PAGE_SETTINGS },
    plain: p.plain,
  }
  for (const [k, v] of Object.entries(fields)) yp.set(k, clone(v))
  yp.set('createdBy', actor)
  yp.set('updatedBy', actor)
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(p.properties)) if (v !== undefined) props.set(k, clone(v))
  yp.set('properties', props)
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

/** The page's `properties` Y.Map (created when a damaged entry has none). */
export function propertiesMap(yp: YMap): YMap {
  const cur = yp.get('properties')
  if (cur instanceof Y.Map) return cur as YMap
  const fresh = new Y.Map<unknown>()
  yp.set('properties', fresh)
  return fresh
}

/** Workspace people (members are mirrored there by the app, id = account id). */
export function readPeople(r: Roots): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>()
  for (const [id, v] of r.people.entries()) if (isObj(v) && typeof v.name === 'string') out.set(id, { id, name: v.name })
  return out
}

/**
 * The partner of a two-way relation (the app's pairedRelation): the target database's
 * `<id>.2way` property pointing back, or — for a `.2way` property — its forward property.
 */
export function pairedRelation(r: Roots, dbId: string, prop: PropertyDef): { dbId: string; prop: PropertyDef } | null {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return null
  const target = databaseMap(r, prop.relationDatabaseId)
  if (!target) return null
  const props = readProperties(target)
  const partner = (p: PropertyDef | undefined): p is PropertyDef => !!p && p.id !== prop.id && p.type === 'relation' && p.relationDatabaseId === dbId
  const back = props.find((p) => p.id === prop.id + TWO_WAY_SUFFIX)
  if (partner(back)) return { dbId: prop.relationDatabaseId, prop: back }
  if (prop.id.endsWith(TWO_WAY_SUFFIX)) {
    const fwd = props.find((p) => p.id === prop.id.slice(0, -TWO_WAY_SUFFIX.length))
    if (partner(fwd)) return { dbId: prop.relationDatabaseId, prop: fwd }
  }
  return null
}

/** The sub-items parent property of a database, when sub-items are on (one parent per row). */
export function subItemsParent(ydb: YMap): string | null {
  const cfg = ydb.get('subItems')
  return isObj(cfg) && cfg.enabled === true && typeof cfg.parentPropertyId === 'string' ? cfg.parentPropertyId : null
}
