/**
 * The shared row index: which live rows each database holds — `dbId → Set<rowId>` (rows with `databaseId === dbId`,
 * not trashed) and `rowId → dbId`. Built ONCE per workspace scope by the first caller (one `Object.keys(pages)` walk),
 * then kept up to date from `pageChanges()` (a memo hit: every write hands its diff in) — O(changed) per write and no
 * further page-map scans. Readers that count rows (the Preflight lamps, coding's waiting tasks, view lamps) share it
 * instead of walking the page map after every store change.
 *
 * `onRowsChanged` reports once per microtask what changed, and how:
 *  - `dbs`: databases whose rows moved, came, went, or changed a title / value;
 *  - `contentDbs`: databases of rows whose CONTENT alone changed (typing in a row page) — kept apart, so a reader that
 *    only counts rows by their values re-reads nothing while someone types;
 *  - `contentOnly`: every page (row or not) whose content alone changed;
 *  - `schema`: databases whose definition changed (properties, views, pipeline …);
 *  - `structure`: some page appeared, went, moved, or was trashed / restored (rows and other pages);
 *  - `changed`: every changed page id;
 *  - `reset`: the workspace scope changed (another workspace was loaded) — the index was dropped and is built again by
 *    the next caller; read everything again.
 */
import { pageChanges, useWorkspace } from './store'
import type { Database, ID, Page } from './types'
import { classifyChange } from './rowChange'

export { classifyChange, type RowChangeKind } from './rowChange'

export interface RowsChange {
  reset?: true
  dbs: Set<ID>
  contentDbs: Set<ID>
  contentOnly: Set<ID>
  schema: Set<ID>
  structure: boolean
  changed: readonly ID[]
}

interface Index {
  scope: string | null
  rows: Map<ID, Set<ID>>
  rowDb: Map<ID, ID>
}

const EMPTY: ReadonlySet<ID> = new Set()

let index: Index | null = null
let builds = 0
let builtScope: string | null = null
let unsubscribe: (() => void) | null = null
const listeners = new Set<(c: RowsChange) => void>()

const isLiveRow = (p: Page | undefined): p is Page & { databaseId: ID } => !!p && !!p.databaseId && !p.trashed

function scopeOf(s: { epoch?: string }): string | null {
  return s.epoch ?? null
}

/** Build the index if it is not built for the current workspace (one page-map walk); later calls are free. */
export function ensureRowIndex(): void {
  const s = useWorkspace.getState()
  const scope = scopeOf(s)
  if (index && index.scope === scope) return
  const rows = new Map<ID, Set<ID>>()
  const rowDb = new Map<ID, ID>()
  const pages = s.pages
  const ids = Object.keys(pages)
  for (let i = 0; i < ids.length; i++) {
    const p = pages[ids[i]]
    if (!isLiveRow(p)) continue
    let set = rows.get(p.databaseId)
    if (!set) rows.set(p.databaseId, (set = new Set()))
    set.add(p.id)
    rowDb.set(p.id, p.databaseId)
  }
  index = { scope, rows, rowDb }
  builds++
  builtScope = scope
  if (!unsubscribe) unsubscribe = useWorkspace.subscribe(onStore)
}

/** The live rows of a database (an empty set when it has none). Builds the index on the first call. */
export function rowIdsOf(dbId: ID): ReadonlySet<ID> {
  ensureRowIndex()
  return index?.rows.get(dbId) ?? EMPTY
}

/** The database a live row belongs to (null for pages that are not live rows). */
export function rowDbOf(id: ID): ID | null {
  ensureRowIndex()
  return index?.rowDb.get(id) ?? null
}

/** Listen for row changes (one call per microtask with everything that changed in it). */
export function onRowsChanged(fn: (c: RowsChange) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** For tests and the perf seam: how often the index was built, and for which scope. */
export function rowIndexStats(): { builds: number; scope: string | null } {
  return { builds, scope: builtScope }
}

/* ---------------- updates */

let pending: RowsChange | null = null

const fresh = (): RowsChange => ({ dbs: new Set(), contentDbs: new Set(), contentOnly: new Set(), schema: new Set(), structure: false, changed: [] })

function queue(): RowsChange {
  if (pending) return pending
  pending = fresh()
  queueMicrotask(emit)
  return pending
}

function emit(): void {
  const c = pending
  pending = null
  if (!c) return
  if (!c.reset && !c.structure && !c.dbs.size && !c.contentDbs.size && !c.contentOnly.size && !c.schema.size && !c.changed.length) return
  for (const fn of [...listeners]) {
    try {
      fn(c)
    } catch (e) {
      console.warn('[rowIndex] listener failed', e)
    }
  }
}

function addRow(idx: Index, p: Page & { databaseId: ID }): void {
  let set = idx.rows.get(p.databaseId)
  if (!set) idx.rows.set(p.databaseId, (set = new Set()))
  set.add(p.id)
  idx.rowDb.set(p.id, p.databaseId)
}

function dropRow(idx: Index, id: ID): void {
  const db = idx.rowDb.get(id)
  if (db === undefined) return
  idx.rowDb.delete(id)
  const set = idx.rows.get(db)
  if (!set) return
  set.delete(id)
  if (!set.size) idx.rows.delete(db)
}

function onStore(s: { epoch?: string; pages: Record<ID, Page>; databases: Record<ID, Database> }, prev: { epoch?: string; pages: Record<ID, Page>; databases: Record<ID, Database> }): void {
  if (s.pages === prev.pages && s.databases === prev.databases && s.epoch === prev.epoch) return
  // another workspace: drop the index (the next caller builds it again) and tell readers to read everything
  if (scopeOf(s) !== scopeOf(prev) || (index && index.scope !== scopeOf(s))) {
    index = null
    const c = queue()
    c.reset = true
    return
  }
  const c = queue()
  if (s.pages !== prev.pages) {
    const d = pageChanges(s.pages, prev.pages)
    const changed = c.changed as ID[]
    const visit = (id: ID) => {
      const next = s.pages[id]
      const before = prev.pages[id]
      const kind = classifyChange(next, before)
      if (!kind) return
      changed.push(id)
      if (kind === 'membership') {
        c.structure = true
        if (before?.databaseId) c.dbs.add(before.databaseId)
        if (next?.databaseId) c.dbs.add(next.databaseId)
        if (index) {
          // the newest state decides (a write made inside another subscriber is reported before this one)
          const now = useWorkspace.getState().pages[id]
          dropRow(index, id)
          if (isLiveRow(now)) addRow(index, now)
        }
        return
      }
      if (kind === 'values') {
        if (next?.databaseId && !next.trashed) c.dbs.add(next.databaseId)
        return
      }
      c.contentOnly.add(id)
      if (next?.databaseId && !next.trashed) c.contentDbs.add(next.databaseId)
    }
    for (const id of d.changed) visit(id)
    for (const id of d.removed) visit(id)
  }
  if (s.databases !== prev.databases) {
    for (const id of Object.keys(s.databases)) if (s.databases[id] !== prev.databases[id]) c.schema.add(id)
    for (const id of Object.keys(prev.databases)) if (!(id in s.databases)) c.schema.add(id)
  }
}
