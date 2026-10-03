/**
 * The binding between the Zustand store and the workspace meta document (docs/CLOUD.md § Client rules).
 *
 * store → Y: every store change becomes ONE Y transaction with origin 'local'. Pages, databases and
 *   people are diffed by reference (immer shares untouched objects) and only changed fields / cells /
 *   threads / properties / views are written. Page content isn't in the meta document: a content
 *   change that didn't come from the page's Y document (AI, history restore, import, templates …)
 *   is handed to the content bridge.
 * Y → store: remote transactions (provider, IndexedDB, uploads) mark pages / databases / people
 *   dirty; after the transaction they are rebuilt from Y and applied in one store patch, while
 *   isApplyingCloud() (and persistence's isApplyingRemote()) is true — automations, webhooks,
 *   autofill and version history ignore them, and the binding doesn't echo them back.
 * Viewers never push: their local changes are reverted from Y.
 */
import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace, type CloudPatch } from '../store/store'
import { runAsRemote } from '../store/persistence'
import type { Database, ID, Page, Settings } from '../store/types'
import { defaultView } from '../store/store'
import { LOCAL, newDatabaseMap, newPageMap, readDatabase, readPage, readPeople, roots, writeDatabase, writePage, writePeople, type YMap } from './schema'

let applying = 0

/** True while the store is being updated from the cloud. */
export function isApplyingCloud(): boolean {
  return applying > 0
}

/** Apply a store change that came from the cloud (no echo, no automations / history). */
export function applyFromCloud(fn: () => void): void {
  applying++
  try {
    runAsRemote(fn)
  } finally {
    applying--
  }
}

/** Content JSON objects that came from a page's Y document (the bridge must not write them back). */
const fromY = new WeakSet<object>()
export function markFromCloud(json: JSONContent): JSONContent {
  fromY.add(json)
  return json
}

export interface BindingOptions {
  doc: Y.Doc
  userId: () => string
  writable: () => boolean
  isFavorite: (id: ID) => boolean
  /** Remote changes: pages that appeared, pages whose updatedAt moved, pages that are gone. */
  onRemotePages: (r: { created: ID[]; touched: ID[]; removed: ID[] }) => void
  /** A local (non-editor) content change to write into the page's content document. */
  bridge: (pageId: ID, base: JSONContent | null, ours: JSONContent | null) => void
  /** Pages removed locally (content documents / caches can go). */
  onLocalRemoved: (ids: ID[]) => void
  /** Local settings changes (per device; a few keys mirror into the account / workspace). */
  onSettings: (next: Settings, prev: Settings) => void
  /** A viewer changed content locally: put the page's Y content back. */
  revertContent: (pageId: ID) => void
}

const EMPTY_PAGE = {} as Page
const EMPTY_DB = { properties: [], views: [] } as unknown as Database

/** A database page always has a schema in the store (a missing one would crash every view). */
function fallbackDatabase(id: ID): Database {
  const db: Database = { id, properties: [{ id: `${id}-title`, name: 'Name', type: 'title' }], views: [], nextUniqueId: 1 }
  db.views = [defaultView('table', db, 'Table')]
  return db
}

/** Store-only guards for a database entry (never written back unless the user changes it). */
function guardDatabase(db: Database): Database {
  if (db.properties.some((p) => p.type === 'title') && db.views.length) return db
  const out = { ...db, properties: [...db.properties], views: [...db.views] }
  if (!out.properties.some((p) => p.type === 'title')) out.properties.unshift({ id: `${db.id}-title`, name: 'Name', type: 'title' })
  if (!out.views.length) out.views = [defaultView('table', out, 'Table')]
  return out
}

export interface Binding {
  stop: () => void
  /** Rebuild everything from Y (viewer revert, after a role change). */
  resync: () => void
}

export function startBinding(o: BindingOptions): Binding {
  const r = roots(o.doc)
  const dirtyPages = new Set<ID>()
  const dirtyDbs = new Set<ID>()
  let dirtyPeople = false
  let dirtyWorkspace = false

  /* ---------------------------------------------------------------- Y → store */

  const collect = (target: Y.AbstractType<unknown>, into: Set<ID>) => (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return
    for (const e of events) {
      if (e.target === target) (e as Y.YMapEvent<unknown>).keysChanged.forEach((k) => into.add(k))
      else if (e.path.length) into.add(String(e.path[0]))
    }
  }
  const onPages = collect(r.pages as unknown as Y.AbstractType<unknown>, dirtyPages)
  const onDbs = collect(r.databases as unknown as Y.AbstractType<unknown>, dirtyDbs)
  const onPeople = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyPeople = true
  }
  const onWorkspace = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyWorkspace = true
  }
  r.pages.observeDeep(onPages)
  r.databases.observeDeep(onDbs)
  r.people.observe(onPeople)
  r.workspace.observe(onWorkspace)

  function applyRemote(all = false) {
    const s = useWorkspace.getState()
    if (all) {
      for (const id of r.pages.keys()) dirtyPages.add(id)
      for (const id of Object.keys(s.pages)) dirtyPages.add(id)
      for (const id of r.databases.keys()) dirtyDbs.add(id)
      for (const id of Object.keys(s.databases)) dirtyDbs.add(id)
      dirtyPeople = dirtyWorkspace = true
    }
    const patch: CloudPatch = {}
    const created: ID[] = []
    const touched: ID[] = []
    const removed: ID[] = []
    const nextPages: Record<ID, Page | null> = {}
    for (const id of dirtyPages) {
      const yp = r.pages.get(id)
      const cur = s.pages[id]
      if (!(yp instanceof Y.Map)) {
        if (cur) {
          nextPages[id] = null
          removed.push(id)
        }
        continue
      }
      const next = readPage(id, yp as YMap, cur, o.isFavorite(id))
      if (next === cur) continue
      nextPages[id] = next
      if (!cur) created.push(id)
      else if (next.updatedAt !== cur.updatedAt) touched.push(id)
    }
    dirtyPages.clear()
    if (Object.keys(nextPages).length) patch.pages = nextPages

    const nextDbs: Record<ID, Database | null> = {}
    for (const id of dirtyDbs) {
      const ydb = r.databases.get(id)
      const cur = s.databases[id]
      if (!(ydb instanceof Y.Map)) {
        // a database page keeps a schema in the store while its page exists
        const page = nextPages[id] === undefined ? s.pages[id] : nextPages[id]
        if (cur && !(page && page.kind === 'database')) nextDbs[id] = null
        continue
      }
      const next = guardDatabase(readDatabase(id, ydb as YMap, cur))
      if (next !== cur) nextDbs[id] = next
    }
    dirtyDbs.clear()
    // database pages without a schema (damaged data): a store-only fallback
    for (const [id, page] of Object.entries(nextPages)) {
      if (page?.kind === 'database' && !s.databases[id] && !nextDbs[id]) nextDbs[id] = fallbackDatabase(id)
    }
    if (Object.keys(nextDbs).length) patch.databases = nextDbs

    if (dirtyPeople) {
      const people = readPeople(r.people, s.people)
      if (people !== s.people) patch.people = people
      dirtyPeople = false
    }
    if (dirtyWorkspace) {
      const name = r.workspace.get('name')
      if (typeof name === 'string' && name && name !== s.settings.workspaceName) patch.settings = { workspaceName: name }
      dirtyWorkspace = false
    }
    if (!patch.pages && !patch.databases && !patch.people && !patch.settings) return
    applyFromCloud(() => s.cloudPatch(patch))
    if (created.length || touched.length || removed.length) o.onRemotePages({ created, touched, removed })
  }

  const afterTx = (tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return
    if (dirtyPages.size || dirtyDbs.size || dirtyPeople || dirtyWorkspace) {
      try {
        applyRemote()
      } catch (e) {
        console.error('[one] could not apply a cloud change', e)
      }
    }
  }
  o.doc.on('afterTransaction', afterTx)

  /* ---------------------------------------------------------------- store → Y */

  let revertTimer: number | undefined
  const scheduleRevert = () => {
    window.clearTimeout(revertTimer)
    revertTimer = window.setTimeout(() => applyRemote(true), 30)
  }

  const unsub = useWorkspace.subscribe((state, prev) => {
    if (applying || !state.ready || !prev.ready) return
    const pagesChanged = state.pages !== prev.pages
    const dbsChanged = state.databases !== prev.databases
    const peopleChanged = state.people !== prev.people
    if (state.settings !== prev.settings) o.onSettings(state.settings, prev.settings)
    if (!pagesChanged && !dbsChanged && !peopleChanged) return

    if (!o.writable()) {
      if (pagesChanged) {
        for (const id in state.pages) {
          const p = state.pages[id]
          const b = prev.pages[id]
          if (b && p !== b && p.content !== b.content && !(p.content && fromY.has(p.content))) o.revertContent(id)
        }
      }
      scheduleRevert()
      return
    }

    const uid = o.userId()
    const bridges: Array<[ID, JSONContent | null, JSONContent | null]> = []
    const removed: ID[] = []
    o.doc.transact(() => {
      if (pagesChanged) {
        for (const id in state.pages) {
          const p = state.pages[id]
          const b = prev.pages[id]
          if (p === b) continue
          const yp = r.pages.get(id)
          if (yp instanceof Y.Map) writePage(yp as YMap, p, b ?? EMPTY_PAGE, uid)
          else r.pages.set(id, newPageMap(p, uid))
          if (p.content !== (b?.content ?? null) && !(p.content && fromY.has(p.content)) && !(!b && p.content == null)) {
            bridges.push([id, b?.content ?? null, p.content])
          }
        }
        for (const id in prev.pages) {
          if (id in state.pages) continue
          r.pages.delete(id)
          removed.push(id)
        }
      }
      if (dbsChanged) {
        for (const id in state.databases) {
          const db = state.databases[id]
          const b = prev.databases[id]
          if (db === b) continue
          const ydb = r.databases.get(id)
          if (ydb instanceof Y.Map) writeDatabase(ydb as YMap, db, b ?? EMPTY_DB)
          else r.databases.set(id, newDatabaseMap(db))
        }
        for (const id in prev.databases) if (!(id in state.databases)) r.databases.delete(id)
      }
      if (peopleChanged) writePeople(r.people, state.people, prev.people)
    }, LOCAL)
    for (const [id, base, ours] of bridges) o.bridge(id, base, ours)
    if (removed.length) o.onLocalRemoved(removed)
  })

  return {
    stop: () => {
      unsub()
      window.clearTimeout(revertTimer)
      r.pages.unobserveDeep(onPages)
      r.databases.unobserveDeep(onDbs)
      r.people.unobserve(onPeople)
      r.workspace.unobserve(onWorkspace)
      o.doc.off('afterTransaction', afterTx)
    },
    resync: () => applyRemote(true),
  }
}

/* ------------------------------------------------------------------ hydration */

/** Build the store's workspace parts from the meta document (boot). */
export function readAll(doc: Y.Doc, isFavorite: (id: ID) => boolean): Pick<CloudPatch, 'people'> & { pages: Record<ID, Page>; databases: Record<ID, Database>; name: string | null } {
  const r = roots(doc)
  const pages: Record<ID, Page> = {}
  for (const [id, yp] of r.pages.entries()) if (yp instanceof Y.Map) pages[id] = readPage(id, yp as YMap, undefined, isFavorite(id))
  const databases: Record<ID, Database> = {}
  for (const [id, ydb] of r.databases.entries()) if (ydb instanceof Y.Map) databases[id] = guardDatabase(readDatabase(id, ydb as YMap, undefined))
  for (const p of Object.values(pages)) if (p.kind === 'database' && !databases[p.id]) databases[p.id] = fallbackDatabase(p.id)
  const name = r.workspace.get('name')
  return { pages, databases, people: readPeople(r.people, []), name: typeof name === 'string' && name ? name : null }
}

/**
 * Pages whose parent (or database) is gone, and parent cycles — both can only come from
 * concurrent edits (a delete racing a move / create). Returns the store updates that repair them.
 */
export function structuralRepairs(pages: Record<ID, Page>, databases: Record<ID, Database>): Array<{ id: ID; patch: Partial<Page> }> {
  const out = new Map<ID, Partial<Page>>()
  for (const p of Object.values(pages)) {
    if (p.databaseId && !(databases[p.databaseId] && pages[p.databaseId])) out.set(p.id, { databaseId: null, ...(p.parentId === p.databaseId ? { parentId: null } : {}) })
    if (p.parentId && (p.parentId === p.id || !pages[p.parentId])) out.set(p.id, { ...out.get(p.id), parentId: null })
  }
  const state = new Map<ID, 1 | 2>()
  for (const start of Object.keys(pages)) {
    const path: ID[] = []
    let cur: ID | null = start
    while (cur && pages[cur] && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        const closer = pages[path[path.length - 1]]
        out.set(closer.id, { ...out.get(closer.id), parentId: null, ...(closer.databaseId === closer.parentId ? { databaseId: null } : {}) })
        break
      }
      state.set(cur, 1)
      path.push(cur)
      const fix: Partial<Page> | undefined = out.get(cur)
      cur = fix && 'parentId' in fix ? null : pages[cur].parentId
    }
    for (const id of path) state.set(id, 2)
  }
  return [...out].map(([id, patch]) => ({ id, patch }))
}
