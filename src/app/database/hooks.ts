/**
 * Data hooks: build a Resolver + filtered/sorted/grouped rows for a database view.
 */
import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../store/store'
import { useLang, useT } from '../i18n'
import type { Database, ID, Page, PropertyDef, PropertyValue, View } from '../store/types'
import { Resolver, type Ctx } from './model/resolve'
import { defaultsFromFilter, groupRows, searchRows, sortRows, testGroup, type RowGroup } from './model/query'
import { parentIdOf, subItemsOf } from './model/hierarchy'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

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

/** Rows of relevant databases; re-renders only when one of them changes. */
export function useRelevantPages(dbId: ID): Page[] {
  return useWorkspace(
    useShallow((s) => {
      const ids = relevantDbIds(s.databases, dbId)
      const out: Page[] = []
      for (const p of Object.values(s.pages)) if (p.databaseId && ids.has(p.databaseId)) out.push(p)
      return out
    }),
  )
}

export function useLabels() {
  const t = useT()
  return useMemo(
    () => ({
      today: t('database.date.today'),
      tomorrow: t('database.date.tomorrow'),
      yesterday: t('database.date.yesterday'),
      untitled: t('common.untitled'),
      yes: t('database.yes'),
      no: t('database.no'),
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

/** A resolver for one database (recomputed when relevant rows / schema change, and as time passes). */
export function useResolver(dbId: ID): Resolver {
  const relevant = useRelevantPages(dbId)
  const tick = useClock(dbId)
  const databases = useWorkspace((s) => s.databases)
  const people = useWorkspace((s) => s.people)
  const lang = useLang()
  const labels = useLabels()
  return useMemo(() => {
    const ctx: Ctx = { pages: useWorkspace.getState().pages, databases, people, lang, now: Date.now(), labels }
    return new Resolver(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant, databases, people, lang, labels, tick])
}

export interface DbModel {
  db: Database
  dbPage: Page
  view: View
  resolver: Resolver
  propMap: Map<ID, PropertyDef>
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
}

export function useDbModel(db: Database, dbPage: Page, view: View, search: string, inline: boolean, keep: ID[] = []): DbModel {
  const resolver = useResolver(db.id)
  const labels = useLabels()
  const propMap = useMemo(() => new Map(db.properties.map((p) => [p.id, p])), [db.properties])
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
  const rows = useMemo(() => {
    let out = allRows
    if (sub) out = out.filter((row) => !parentIdOf(resolver.ctx.pages, sub, row))
    if (view.filter && view.filter.items.length) out = out.filter((row) => testGroup(resolver, db, view.filter!, row, propMap))
    if (search.trim()) out = searchRows(resolver, db, out, search)
    out = sortRows(resolver, db, out, view.sorts, propMap)
    if (keep.length) {
      // rows just created here stay visible even when they don't match (like Notion) — at the end
      const shown = new Set(out.map((r) => r.id))
      const extra = allRows.filter((r) => keep.includes(r.id) && !shown.has(r.id))
      if (extra.length) out = [...out, ...extra]
    }
    return out
  }, [allRows, sub, view.filter, view.sorts, search, resolver, db, propMap, keep])
  const groupProp = view.groupBy && ['table', 'list', 'board'].includes(view.type) ? propMap.get(view.groupBy) ?? null : null
  const groups = useMemo(() => (groupProp ? groupRows(resolver, db, groupProp, rows, labels) : null), [groupProp, resolver, db, rows, labels])
  const newRowDefaults = useCallback(() => defaultsFromFilter(view, propMap), [view, propMap])
  return { db, dbPage, view, resolver, propMap, titleProp, visibleProps, allRows, rows, groups, groupProp, search, inline, newRowDefaults }
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
