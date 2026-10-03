/**
 * Page content documents (`ws:<id>:p:<pageId>`, docs/CLOUD.md § Realtime documents).
 *
 *  - Registry: one Y.Doc + y-indexeddb + HocuspocusProvider (on the shared socket) per page,
 *    ref-counted by editors (acquire/release) and held by background jobs. An entry with changes
 *    the server hasn't confirmed stays alive until it has (offline edits survive navigation).
 *  - Store refresh: Y changes → page.content (debounced). Changes typed here go through
 *    setContent (origin 'cloud': history snapshots, updatedAt, the search excerpt for others);
 *    changes from others / IndexedDB are patched in as remote (origin 'sync', no automations).
 *  - Bridge: setContent from non-editor writers (AI, history, import, templates, moves …) is
 *    written into the Y fragment — three-way merged with what Y has meanwhile, then applied as a
 *    minimal diff (prosemirrorJSONToYXmlFragment on the existing fragment), in one transaction.
 *  - Background sync after boot (small concurrency) keeps page.content fresh for search, export,
 *    graph and backlinks without holding every page document open; a cache of the last content
 *    per page makes boots instant.
 */
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace, plainText } from '../store/store'
import { deepEqual, mergeContent } from '../store/merge'
import type { ID, Page } from '../store/types'
import { docSchema, prepareCollabContent } from '../editor'
import { applyFromCloud, markFromCloud } from './binding'
import { dropContentCache, saveContentCache, type CachedContent } from './local'
import { getSocket, isConnected, onConnection } from './socket'
import { PAGE_ID, within } from './env'
import type { ContentDocHandle } from './state'

/** setContent origin for content typed in this tab's editors (not an editor instance id, not 'sync'). */
export const CLOUD_EDIT_ORIGIN = 'cloud'
/** Y transaction origin of bridge writes. */
const BRIDGE = { bridge: true }
const FIELD = 'default'
/** Remote changes reach the store quickly; your own typing in pauses (it also writes the meta document's search excerpt). */
const REFRESH_MS = 300
const REFRESH_LOCAL_MS = 900
/** How long an unused entry lingers (StrictMode remounts, quick back-and-forth). */
const LINGER_MS = 4000
const CONCURRENCY = 3

export interface ContentContext {
  wsId: string
  writable: () => boolean
  user: () => { id: string; name: string; color: string; tone: string }
  /** A document closed / refused by the server (role-changed, membership-revoked …). */
  onClose: (reason: string) => void
  /** Local changes the server hasn't confirmed (persisted, synced first on the next boot). */
  pending: Set<ID>
  /** Some document's unconfirmed-changes count moved. */
  onUnsynced: () => void
  savePending: () => void
  cache: Map<ID, CachedContent>
}

interface Entry {
  pageId: ID
  doc: Y.Doc
  idb: IndexeddbPersistence
  provider: HocuspocusProvider
  refs: number
  holds: number
  loaded: Promise<void>
  isLoaded: boolean
  synced: boolean
  firstSync: Promise<void>
  localEdit: boolean
  refreshTimer?: number
  lingerTimer?: number
  handle: ContentDocHandle | null
}

let ctx: ContentContext | null = null
const entries = new Map<ID, Entry>()

export function contentContext(): ContentContext | null {
  return ctx
}

const docName = (pageId: ID) => `ws:${ctx!.wsId}:p:${pageId}`
const idbName = (pageId: ID) => `one:${docName(pageId)}`

/** Some open page document has changes the server hasn't confirmed. */
export function contentHasUnsynced(): boolean {
  for (const e of entries.values()) if (e.provider.hasUnsyncedChanges && e.provider.isAttached) return true
  return false
}

function updateUnsynced() {
  ctx?.onUnsynced()
}

/* ------------------------------------------------------------------ registry */

function ensure(pageId: ID): Entry {
  const existing = entries.get(pageId)
  if (existing) return existing
  const c = ctx!
  const doc = new Y.Doc()
  const idb = new IndexeddbPersistence(idbName(pageId), doc)
  const provider = new HocuspocusProvider({ websocketProvider: getSocket(), name: docName(pageId), document: doc })
  let resolveSync!: () => void
  const entry: Entry = {
    pageId,
    doc,
    idb,
    provider,
    refs: 0,
    holds: 0,
    loaded: idb.whenSynced.then(() => {
      entry.isLoaded = true
    }),
    isLoaded: false,
    synced: false,
    firstSync: new Promise<void>((r) => (resolveSync = r)),
    localEdit: false,
    handle: null,
  }
  entries.set(pageId, entry)

  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin !== idb && origin !== provider) {
      // typed here, undone here, or a bridge write: the server has to confirm it
      if (!c.pending.has(pageId)) {
        c.pending.add(pageId)
        c.savePending()
      }
      if (origin !== BRIDGE) entry.localEdit = true
      scheduleRefresh(entry, origin === BRIDGE ? REFRESH_MS : REFRESH_LOCAL_MS)
      return
    }
    scheduleRefresh(entry)
  })
  provider.on('synced', () => {
    entry.synced = true
    resolveSync()
    scheduleRefresh(entry, 0)
    checkConfirmed(entry)
  })
  provider.on('unsyncedChanges', () => {
    checkConfirmed(entry)
    updateUnsynced()
  })
  provider.on('close', ({ event }: { event: { reason?: string } }) => {
    entry.synced = false
    if (event?.reason) c.onClose(event.reason)
  })
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => c.onClose(reason === 'unauthenticated' ? 'session-ended' : reason === 'forbidden' ? 'membership-revoked' : reason))
  provider.attach()
  return entry
}

/** The server confirmed every local change of this page: it is no longer pending. */
function checkConfirmed(e: Entry) {
  if (!ctx || !e.synced || e.provider.hasUnsyncedChanges || !ctx.pending.has(e.pageId)) return
  ctx.pending.delete(e.pageId)
  ctx.savePending()
  if (!e.refs && !e.holds) linger(e)
}

function destroy(e: Entry) {
  window.clearTimeout(e.refreshTimer)
  window.clearTimeout(e.lingerTimer)
  if (e.refreshTimer !== undefined) refresh(e)
  entries.delete(e.pageId)
  try {
    e.provider.destroy()
  } catch {
    /* already gone */
  }
  void e.idb.destroy()
  e.doc.destroy()
  updateUnsynced()
}

function linger(e: Entry) {
  window.clearTimeout(e.lingerTimer)
  e.lingerTimer = window.setTimeout(() => {
    if (e.refs || e.holds) return
    // unconfirmed local changes: keep the document (and its provider) until the server has them
    if (ctx?.pending.has(e.pageId) && e.provider.isAttached) return
    destroy(e)
  }, LINGER_MS)
}

function hold(pageId: ID): Entry {
  const e = ensure(pageId)
  e.holds++
  window.clearTimeout(e.lingerTimer)
  return e
}

function unhold(e: Entry) {
  e.holds = Math.max(0, e.holds - 1)
  if (!e.refs && !e.holds && entries.get(e.pageId) === e) linger(e)
}

/* ------------------------------------------------------------------ refresh (Y → store) */

function scheduleRefresh(e: Entry, delay = REFRESH_MS) {
  window.clearTimeout(e.refreshTimer)
  e.refreshTimer = window.setTimeout(() => refresh(e), delay)
}

function fragmentJSON(e: Entry): JSONContent | null {
  const frag = e.doc.getXmlFragment(FIELD)
  if (!frag.length) return null
  return yXmlFragmentToProsemirrorJSON(frag) as JSONContent
}

function refresh(e: Entry) {
  e.refreshTimer = undefined
  const c = ctx
  if (!c || entries.get(e.pageId) !== e) return
  const s = useWorkspace.getState()
  const page = s.pages[e.pageId]
  if (!page) return
  const json = fragmentJSON(e)
  const local = e.localEdit
  e.localEdit = false
  if (!json) {
    // an empty document: the store keeps what it has until the document has content
    return
  }
  if (deepEqual(json, page.content)) {
    remember(e, page.content!, page)
    return
  }
  markFromCloud(json)
  if (local && c.writable()) {
    s.setContent(e.pageId, json, CLOUD_EDIT_ORIGIN)
  } else {
    applyFromCloud(() => {
      const cur = useWorkspace.getState().pages[e.pageId]
      if (!cur) return
      const next: Page = { ...cur, content: json, plain: plainText(json), contentRev: cur.contentRev + 1, contentOrigin: 'sync' }
      useWorkspace.getState().cloudPatch({ pages: { [e.pageId]: next } })
    })
  }
  const after = useWorkspace.getState().pages[e.pageId]
  if (after) remember(e, json, after)
}

/** Cache the page's content; `at` says up to which meta updatedAt it matches the server. */
function remember(e: Entry, json: JSONContent, page: Page) {
  const c = ctx
  if (!c) return
  const confirmed = e.synced && !c.pending.has(e.pageId)
  const prev = c.cache.get(e.pageId)
  const at = confirmed ? page.updatedAt : (prev?.at ?? 0)
  if (prev && prev.json === json && prev.at === at) return
  const v = { json, at }
  c.cache.set(e.pageId, v)
  saveContentCache(c.wsId, e.pageId, v)
}

/* ------------------------------------------------------------------ editor handles */

export function acquire(pageId: ID): ContentDocHandle | null {
  if (!ctx || !PAGE_ID.test(pageId)) return null
  const e = ensure(pageId)
  e.refs++
  window.clearTimeout(e.lingerTimer)
  if (!e.handle) {
    const u = ctx.user()
    const ready = (async () => {
      await e.loaded
      // first time on this device: wait (briefly) for the server's copy instead of showing an empty page
      if (!e.doc.getXmlFragment(FIELD).length && isConnected() && !e.synced) await within(e.firstSync, 4000, undefined)
    })()
    e.handle = { doc: e.doc, provider: e.provider, field: FIELD, user: { name: u.name, color: u.color }, readOnly: !ctx.writable(), ready }
  }
  e.handle.readOnly = !ctx.writable()
  return e.handle
}

export function release(pageId: ID): void {
  const e = entries.get(pageId)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  if (!e.refs && !e.holds) {
    // hand the latest text to the store now (search, backlinks …)
    if (e.refreshTimer !== undefined) {
      window.clearTimeout(e.refreshTimer)
      refresh(e)
    }
    linger(e)
  }
}

/**
 * Authenticate a provider again on the same socket (after the server closed its document, e.g.
 * 'role-changed'). Not detach() + attach(): detaching sends a CLOSE frame that the server queues
 * until the new authentication and then replays — closing the fresh connection again.
 */
export function reauthenticate(provider: HocuspocusProvider): void {
  if (!provider.isAttached || provider.isAuthenticated) return
  void provider
    .sendToken()
    .then(() => provider.startSync())
    .catch((err) => console.warn('[one] could not re-authenticate a document', err))
}

/** Every page document the server closed authenticates again (after a role change). */
export function reattachAll(): void {
  for (const e of entries.values()) reauthenticate(e.provider)
}

/** Stop syncing every page document (signed out / removed); local copies stay. */
export function detachAll(): void {
  for (const e of entries.values()) {
    try {
      e.provider.detach()
    } catch {
      /* gone */
    }
  }
}

/** Hand pending refreshes to the store right away (page hide / unload). */
export function flushRefreshes(): void {
  for (const e of entries.values()) {
    if (e.refreshTimer === undefined) continue
    window.clearTimeout(e.refreshTimer)
    refresh(e)
  }
}

/* ------------------------------------------------------------------ bridge (store → Y) */

const writeQueues = new Map<ID, Promise<void>>()

function canonical(json: JSONContent | null): JSONContent | null {
  if (!json) return null
  try {
    return docSchema().nodeFromJSON(prepareCollabContent(json, false)).toJSON() as JSONContent
  } catch {
    return json
  }
}

/** Write a non-editor content change into the page's Y document (merged with what Y has meanwhile). */
export function bridgeContent(pageId: ID, base: JSONContent | null, ours: JSONContent | null): void {
  if (!ctx || !ctx.writable() || !PAGE_ID.test(pageId)) return
  if (deepEqual(base, ours)) return
  const prev = writeQueues.get(pageId) ?? Promise.resolve()
  const job = prev.then(async () => {
    if (!ctx || !useWorkspace.getState().pages[pageId]) return
    const e = hold(pageId)
    try {
      await e.loaded
      if (isConnected() && !e.synced) await within(e.firstSync, 5000, undefined)
      if (entries.get(pageId) !== e) return
      const frag = e.doc.getXmlFragment(FIELD)
      const theirs = canonical(fragmentJSON(e))
      const b = canonical(base)
      const o = canonical(ours)
      const target = theirs && !deepEqual(theirs, b) ? mergeContent(b, theirs, o) : o
      if (deepEqual(target, theirs)) return
      e.doc.transact(() => {
        if (!target) frag.delete(0, frag.length)
        else prosemirrorJSONToYXmlFragment(docSchema(), prepareCollabContent(target, true), frag)
      }, BRIDGE)
    } catch (err) {
      console.error('[one] could not write content into the page document', err)
    } finally {
      unhold(e)
    }
  })
  writeQueues.set(
    pageId,
    job.finally(() => {
      if (writeQueues.get(pageId) === job) writeQueues.delete(pageId)
    }),
  )
}

/** A viewer's local content change: show the document's content again. */
export function revertContent(pageId: ID): void {
  const e = entries.get(pageId)
  if (e) {
    const json = fragmentJSON(e)
    if (!json) return
    markFromCloud(json)
    applyFromCloud(() => {
      const cur = useWorkspace.getState().pages[pageId]
      if (cur) useWorkspace.getState().cloudPatch({ pages: { [pageId]: { ...cur, content: json, plain: plainText(json), contentRev: cur.contentRev + 1, contentOrigin: 'sync' } } })
    })
  } else enqueueSync([pageId], true)
}

/* ------------------------------------------------------------------ background sync */

const queue: ID[] = []
const queued = new Set<ID>()
/** Pages that could only be read locally (offline): synced once the connection is back. */
const deferred = new Set<ID>()
let workers = 0

/** Load these pages' content documents once (local copy, then the server) and refresh the store. */
export function enqueueSync(ids: ID[], front = false): void {
  if (!ctx) return
  for (const id of ids) {
    if (!PAGE_ID.test(id) || queued.has(id)) continue
    queued.add(id)
    if (front) queue.unshift(id)
    else queue.push(id)
  }
  while (workers < CONCURRENCY && queue.length) {
    workers++
    void work().finally(() => workers--)
  }
}

async function work(): Promise<void> {
  while (queue.length && ctx) {
    const id = queue.shift()!
    queued.delete(id)
    if (!useWorkspace.getState().pages[id]) continue
    const e = hold(id)
    try {
      await e.loaded
      if (isConnected()) {
        await within(e.firstSync, 15_000, undefined)
        if (!e.synced) deferred.add(id)
      } else deferred.add(id)
      if (e.refreshTimer !== undefined) window.clearTimeout(e.refreshTimer)
      refresh(e)
    } catch (err) {
      console.warn('[one] background sync of a page failed', err)
    } finally {
      unhold(e)
    }
  }
}

/** Remote meta changes: new pages and pages someone else changed (content may have moved too). */
export function onRemotePages(r: { created: ID[]; touched: ID[]; removed: ID[] }): void {
  const stale: ID[] = []
  for (const id of [...r.created, ...r.touched]) {
    const e = entries.get(id)
    // an open, synced document receives content changes live: just note how fresh it is
    if (e && e.synced) {
      const page = useWorkspace.getState().pages[id]
      if (page?.content) remember(e, page.content, page)
      continue
    }
    stale.push(id)
  }
  if (stale.length) enqueueSync(stale)
  for (const id of r.removed) forget(id)
}

/** A page is gone for good: drop its document and local copies. */
export function forget(pageId: ID): void {
  if (!ctx) return
  const e = entries.get(pageId)
  if (e && (e.refs || e.holds)) return
  if (e) destroy(e)
  ctx.cache.delete(pageId)
  dropContentCache(ctx.wsId, pageId)
  if (ctx.pending.delete(pageId)) ctx.savePending()
  if (PAGE_ID.test(pageId)) void clearDocument(idbName(pageId)).catch(() => {})
}

/* ------------------------------------------------------------------ lifecycle */

export function startContent(c: ContentContext): () => void {
  ctx = c
  const offConn = onConnection((up) => {
    if (!up) return
    // back online: what could only be read locally gets its server sync now
    const ids = [...deferred, ...c.pending]
    deferred.clear()
    if (ids.length) enqueueSync(ids, true)
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushRefreshes()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flushRefreshes)
  return () => {
    offConn()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', flushRefreshes)
    for (const e of [...entries.values()]) destroy(e)
    queue.length = 0
    queued.clear()
    ctx = null
  }
}

/** Which pages need a sync after boot: no cached content, content older than the meta document, or unconfirmed local edits. */
export function staleAtBoot(pages: Record<ID, Page>, c: ContentContext): ID[] {
  const out: ID[] = []
  const list = Object.values(pages).sort((a, b) => b.updatedAt - a.updatedAt)
  for (const p of list) {
    const cached = c.cache.get(p.id)
    if (c.pending.has(p.id) || !cached || cached.at < p.updatedAt) out.push(p.id)
  }
  return out
}
