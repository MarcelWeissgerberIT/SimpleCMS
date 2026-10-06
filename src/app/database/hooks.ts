/**
 * Data hooks: build a Resolver + filtered/sorted/grouped rows for a database view.
 */
import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pageChanges, useWorkspace } from '../store/store'
import { useLang, useT } from '../i18n'
import type { Database, ID, Kit, Page, PropertyDef, PropertyValue, View } from '../store/types'
import { Resolver, type Ctx } from './model/resolve'
import { defaultsFromFilter, groupRows, searchRows, testGroup, type RowGroup } from './model/query'
import { orderRows, type ViewOrder } from './model/feed'
import { parentIdOf, subItemsOf } from './model/hierarchy'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useDbReadOnly } from './readonly'
import { useCloud } from '../cloud'
import { resolverLabels } from './model/ctx'
import { resolveMe, type MeCtx } from './model/actors'
import { typeColumn, usesTypes } from './model/recordTypes'

/** Database ids whose rows matter for this database (relations, rollups — 3 levels). */
function relevantDbIds(databases: Record<ID, Database>, dbId: ID): Set<ID> {
  const out = new Set<ID>([dbId])
  let frontier = [dbId]
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: ID[] = []
    for (const id of frontier) {
      for (const p of databases[id]?.properties ?? []) {
        if (p.type === 'relation' && p.relationDatabaseId && !out.has(p.relationDatabaseId)) {
          out.add(p.relationDatabaseId)
          next.push(p.relationDatabaseId)
        }
      }
    }
    frontier = next
  }
  return out
}

/**
 * Rows of the databases in `ids`, per set of databases: the list is kept while no store change
 * touches one of them (the store's shared diff says which pages changed), so the selector below
 * costs nothing on keystrokes elsewhere instead of a scan of every page on every store change.
 */
const relevantCache = new Map<string, { pages: Record<ID, Page>; rows: Page[] }>()
const inDbs = (p: Page | undefined, ids: Set<ID>) => !!p?.databaseId && ids.has(p.databaseId)

function relevantRows(pages: Record<ID, Page>, ids: Set<ID>): Page[] {
  const key = [...ids].sort().join(' ')
  const hit = relevantCache.get(key)
  if (hit) {
    if (hit.pages === pages) return hit.rows
    const { changed, removed } = pageChanges(pages, hit.pages)
    if (!changed.some((id) => inDbs(pages[id], ids) || inDbs(hit.pages[id], ids)) && !removed.some((id) => inDbs(hit.pages[id], ids))) {
      hit.pages = pages
      return hit.rows
    }
  }
  const rows: Page[] = []
  for (const id of Object.keys(pages)) if (inDbs(pages[id], ids)) rows.push(pages[id])
  relevantCache.set(key, { pages, rows })
  return rows
}

/** Rows of relevant databases; re-renders only when one of them changes. */
export function useRelevantPages(dbId: ID): Page[] {
  return useWorkspace(useShallow((s) => relevantRows(s.pages, relevantDbIds(s.databases, dbId))))
}

export function useLabels() {
  const t = useT()
  return useMemo(
    () => ({
      ...resolverLabels(t),
      days: t('database.calc.daysUnit'),
      none: t('database.group.none'),
      checked: t('database.group.checked'),
      unchecked: t('database.group.unchecked'),
    }),
    [t],
  )
}

/**
 * A tick for time-dependent values: every minute while a formula here reads now() / today(),
 * otherwise once at midnight (relative dates, "within the past week" filters).
 */
function useClock(dbId: ID): number {
  const perMinute = useWorkspace((s) => {
    for (const id of relevantDbIds(s.databases, dbId))
      for (const p of s.databases[id]?.properties ?? []) if (p.type === 'formula' && /\b(now|today)\s*\(/.test(p.formula ?? '')) return true
    return false
  })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
      const wait = perMinute ? 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) : midnight
      timer = window.setTimeout(() => {
        setTick((n) => n + 1)
        schedule()
      }, wait + 50)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [perMinute])
  return tick
}

/** Who "Me" is: the signed-in account in a team workspace, the local user's name (see model/actors). */
export function useMe(): MeCtx {
  const id = useCloud((c) => (c.active.kind === 'cloud' ? (c.user?.id ?? null) : null))
  const name = useWorkspace((s) => s.settings.userName)
  return useMemo(() => ({ id, name }), [id, name])
}

/** A resolver for one database (recomputed when relevant rows / schema change, and as time passes). */
export function useResolver(dbId: ID): Resolver {
  const relevant = useRelevantPages(dbId)
  const tick = useClock(dbId)
  const databases = useWorkspace((s) => s.databases)
  const people = useWorkspace((s) => s.people)
  const lang = useLang()
  const labels = useLabels()
  const me = useMe()
  // custom functions (formulas may call them): a new set → formulas compute again
  const functions = useWorkspace((s) => s.functions)
  return useMemo(() => {
    const ctx: Ctx = { pages: useWorkspace.getState().pages, databases, people, lang, now: Date.now(), labels, me }
    return new Resolver(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant, databases, people, lang, labels, tick, me, functions])
}

export interface DbModel {
  db: Database
  dbPage: Page
  view: View
  resolver: Resolver
  /** The database's properties and the computed Type column (model/recordTypes: TYPE_PROP_ID). */
  propMap: Map<ID, PropertyDef>
  /** Properties pickers offer (filter, sort, group, show): the database's own + the Type column while it holds record types. */
  allProps: PropertyDef[]
  /** The workspace's building blocks (record types …). */
  kit: Kit | undefined
  titleProp: PropertyDef
  /** Visible non-title properties in view order. */
  visibleProps: PropertyDef[]
  /** All rows (not trashed), in manual order. */
  allRows: Page[]
  /** Filtered + searched + sorted rows. */
  rows: Page[]
  /** Groups (if the view groups and the layout supports it). */
  groups: RowGroup[] | null
  groupProp: PropertyDef | null
  search: string
  inline: boolean
  /** Presets for new rows (from filters). */
  newRowDefaults: () => Record<ID, PropertyValue>
  /** View only (a viewer in a team workspace): read, never write — every write affordance hides. */
  readOnly: boolean
  /** The database is locked (model/lock): properties and views are fixed, rows stay editable. */
  locked: boolean
  /** Properties and views can't change here: view only or locked. */
  fixed: boolean
}

export function useDbModel(db: Database, dbPage: Page, view: View, search: string, inline: boolean, keep: ID[] = []): DbModel {
  const resolver = useResolver(db.id)
  const labels = useLabels()
  const kit = useWorkspace((s) => s.kit)
  const t = useT()
  const typeCol = useMemo(() => typeColumn(db, kit, t('database.rtype.column')), [db, kit, t])
  const propMap = useMemo(() => new Map([...db.properties, typeCol].map((p) => [p.id, p])), [db.properties, typeCol])
  const allProps = useMemo(() => (usesTypes(db) ? [...db.properties, typeCol] : db.properties), [db, typeCol])
  const titleProp = useMemo(() => db.properties.find((p) => p.type === 'title') ?? { id: '__title__', name: 'Name', type: 'title' as const }, [db.properties])
  const visibleProps = useMemo(
    () => view.visibleProperties.map((id) => propMap.get(id)).filter((p): p is PropertyDef => !!p && p.type !== 'title'),
    [view.visibleProperties, propMap],
  )
  const allRows = useMemo(() => {
    const pages = resolver.ctx.pages
    return Object.values(pages)
      .filter((p) => p.databaseId === db.id && !p.trashed)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  }, [resolver, db.id])
  // "parents only": sub-items stay out of this view (every layout)
  const sub = useMemo(() => (view.subItems === 'parents' ? subItemsOf(db) : null), [view.subItems, db])
  const order = useMemo<ViewOrder>(() => ({ type: view.type, sorts: view.sorts, feed: view.feed }), [view.type, view.sorts, view.feed])
  const rows = useMemo(() => {
    let out = allRows
    if (sub) out = out.filter((row) => !parentIdOf(resolver.ctx.pages, sub, row))
    if (view.filter && view.filter.items.length) out = out.filter((row) => testGroup(resolver, db, view.filter!, row, propMap))
    if (search.trim()) out = searchRows(resolver, db, out, search)
    // the view's sorts — a feed without any: newest first (model/feed)
    out = orderRows(resolver, db, order, out, propMap)
    if (keep.length) {
      // rows just created here stay visible even when they don't match (like Notion) — at the end
      const shown = new Set(out.map((r) => r.id))
      const extra = allRows.filter((r) => keep.includes(r.id) && !shown.has(r.id) && !(sub && parentIdOf(resolver.ctx.pages, sub, r)))
      if (extra.length) out = [...out, ...extra]
    }
    return out
  }, [allRows, sub, view.filter, order, search, resolver, db, propMap, keep])
  const groupProp = view.groupBy && ['table', 'list', 'board'].includes(view.type) ? propMap.get(view.groupBy) ?? null : null
  const groups = useMemo(() => (groupProp ? groupRows(resolver, db, groupProp, rows, labels) : null), [groupProp, resolver, db, rows, labels])
  const newRowDefaults = useCallback(() => defaultsFromFilter(view, propMap, (p) => resolveMe(p, resolver.ctx)), [view, propMap, resolver])
  const readOnly = useDbReadOnly()
  const locked = db.locked === true
  return { db, dbPage, view, resolver, propMap, allProps, kit, titleProp, visibleProps, allRows, rows, groups, groupProp, search, inline, newRowDefaults, readOnly, locked, fixed: readOnly || locked }
}

export const DbModelContext = createContext<DbModel | null>(null)
export function useModel(): DbModel {
  const m = useContext(DbModelContext)
  if (!m) throw new Error('DbModelContext missing')
  return m
}

/** localStorage-backed state for per-viewer UI conveniences. */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = safeLocalGet(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      safeLocalSet(key, JSON.stringify(val))
    } catch {
      /* ignore */
    }
  }, [key, val])
  return [val, setVal]
}
