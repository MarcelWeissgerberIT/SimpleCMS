/**
 * Places (a page or row, a database's schema, a view) and what a store update did to a page. Pure.
 */
import type { Database, ID, Page, PropertyType } from '../../../store/types'
import type { CanonDeps } from './canon'
import { F, K, type PlaceKey, type PlaceKind } from './types'

export const pagePlace = (id: ID): PlaceKey => `p:${id}`
export const schemaPlace = (dbId: ID): PlaceKey => `s:${dbId}`
export const viewPlace = (dbId: ID, viewId: ID): PlaceKey => `v:${dbId}/${viewId}`

/** Build a place key. */
export function placeKey(kind: 'page', id: ID): PlaceKey
export function placeKey(kind: 'schema', dbId: ID): PlaceKey
export function placeKey(kind: 'view', dbId: ID, viewId: ID): PlaceKey
export function placeKey(kind: 'page' | 'schema' | 'view', a: ID, b?: ID): PlaceKey {
  return kind === 'page' ? pagePlace(a) : kind === 'schema' ? schemaPlace(a) : viewPlace(a, b ?? '-')
}

/** The ids inside a place key. */
export function parsePlace(p: PlaceKey): { kind: 'page' | 'schema' | 'view'; id: ID; view?: ID } {
  if (p.startsWith('p:')) return { kind: 'page', id: p.slice(2) }
  if (p.startsWith('s:')) return { kind: 'schema', id: p.slice(2) }
  const [db, view] = p.slice(2).split('/')
  return { kind: 'view', id: db, view }
}

/** A page object's place kind: a database row, a database's own page, or a plain page. */
export function placeKindOf(page: Pick<Page, 'databaseId' | 'kind'>): PlaceKind {
  return page.databaseId ? 'row' : page.kind === 'database' ? 'db' : 'page'
}

/**
 * Fields whose change alone is no change of the place (the identity chain still moves on): stamps,
 * caches, per-device marks, comments (never leave the device), and content equal by contentKey().
 */
export const IGNORED_PAGE_FIELDS = ['updatedAt', 'favorite', 'plain', 'createdBy', 'updatedBy', 'private', 'comments', 'contentOrigin', 'contentRev', 'trashedAt'] as const

export interface PageClass {
  kinds: number
  /** NEW / GONE */
  f: number
  /** the page changed, but only in ignored fields */
  ignoredOnly: boolean
  /** property values changed */
  pc: number
  /** MOVE: parent before → after */
  mv?: [ID | null, ID | null]
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** How many stored property values differ (valueKey; the database's types when known). */
export function propsDiffCount(prev: Page, next: Page, deps: Pick<CanonDeps, 'valueKey'>, db?: Pick<Database, 'properties'> | null): number {
  if (prev.properties === next.properties) return 0
  const types = new Map<ID, PropertyType>((db?.properties ?? []).map((p) => [p.id, p.type]))
  let n = 0
  const keys = new Set([...Object.keys(prev.properties ?? {}), ...Object.keys(next.properties ?? {})])
  for (const k of keys) if (deps.valueKey(prev.properties?.[k], types.get(k)) !== deps.valueKey(next.properties?.[k], types.get(k))) n++
  return n
}

/** What changed between two versions of a page object (absent = created / deleted for good). */
export function classifyPage(prev: Page | undefined, next: Page | undefined, deps: CanonDeps, db?: Pick<Database, 'properties'> | null): PageClass {
  if (!prev && !next) return { kinds: 0, f: 0, ignoredOnly: true, pc: 0 }
  if (!prev) return { kinds: K.CREATE, f: F.NEW, ignoredOnly: false, pc: 0 }
  if (!next) return { kinds: K.DELETE, f: F.GONE, ignoredOnly: false, pc: 0 }
  if (prev === next) return { kinds: 0, f: 0, ignoredOnly: true, pc: 0 }
  let kinds = 0
  if (prev.title !== next.title) kinds |= K.TITLE
  // the blocks that differ decide (keying only them — typing in a long page); never `plain`: in a team workspace it is the
  // meta document's excerpt, not always the text of this content
  if (prev.content !== next.content && !(deps.contentSame ? deps.contentSame(prev.content, next.content) : deps.contentKey(prev.content) === deps.contentKey(next.content))) kinds |= K.CONTENT
  const pc = propsDiffCount(prev, next, deps, db)
  if (pc) kinds |= K.PROPS
  if (deps.iconKey(prev.icon) !== deps.iconKey(next.icon)) kinds |= K.ICON
  if (!same(prev.cover, next.cover)) kinds |= K.COVER
  if (!prev.trashed && next.trashed) kinds |= K.TRASH
  if (prev.trashed && !next.trashed) kinds |= K.RESTORE
  let mv: [ID | null, ID | null] | undefined
  if (prev.parentId !== next.parentId || prev.databaseId !== next.databaseId || prev.order !== next.order) {
    kinds |= K.MOVE
    if (prev.parentId !== next.parentId) mv = [prev.parentId, next.parentId]
  }
  if ((prev.recordType ?? null) !== (next.recordType ?? null)) kinds |= K.TYPE
  if (!same(prev.settings, next.settings) || !!prev.hidden !== !!next.hidden || !same(prev.template, next.template) || prev.kind !== next.kind) kinds |= K.META
  return { kinds, f: 0, ignoredOnly: kinds === 0, pc, ...(mv ? { mv } : {}) }
}
