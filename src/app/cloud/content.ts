/**
 * Page content documents (`ws:<id>:p:<pageId>`, docs/CLOUD.md § Realtime documents; a private page's
 * is `ws:<id>:u:<userId>:p:<pageId>`, § Private pages — the name follows the page's `private` marker).
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
 *  - Moving pages between Private and the workspace (prepareMove): the same Y.Doc gets a second
 *    provider on the other name until the server confirmed the full state there, then that provider
 *    (and an IndexedDB copy of that name) takes over — open editors keep their document and carets.
 *  - Workspace pages never keep the title of a private page in a mention's `label` (others would read
 *    it): local edits that bring one in are cleared at once.
 *  - Local copies are kept per document schema generation (`one:g<n>:ws:…`, docs/CLOUD.md § Schema gate): a
 *    copy an OLDER build of One wrote (`one:ws:…` before generation 1) may hold the deletion of a node it
 *    could not read — never replayed as it is (prepareOlder). One without changes the server never confirmed
 *    holds nothing the server lacks: it fills an empty copy of this generation at once (offline too), then
 *    goes. One with such changes (`pending`) waits for the server's state — however long that takes, the page
 *    stays pending meanwhile — then its changes are taken over (adoptAll): as they are when they delete
 *    nothing newer, else merged with every newer node put back; only then does it go.
 *  - A document with nothing in it yet that the server has not answered for (first open of a page after an
 *    update, offline) is never edited or written blind: editors wait (the page shows the last known text,
 *    read-only) and so do bridge writes — written into an empty document, their text would come twice once
 *    the server's state is in.
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
import { DOC_SCHEMA_VERSION, lostNewer, restoreNewer } from '../store/generations'
import { applyFromCloud, markFromCloud } from './binding'
import { stripHiddenMentions } from './privacy'
import { dropContentCache, dropHeldWrites, loadHeldWrites, saveContentCache, saveHeldWrite, type CachedContent, type HeldRecord, type HeldWrite } from './local'
import { newId } from '../lib/ids'
import { getSocket, isConnected, onConnection } from './socket'
import { PAGE_ID, within } from './env'
import { CloudError, type ContentDocHandle } from './state'
import { watchSchema } from './schemaGate'

/** setContent origin for content typed in this tab's editors (not an editor instance id, not 'sync'). */
export const CLOUD_EDIT_ORIGIN = 'cloud'
/** Y transaction origin of bridge writes. */
const BRIDGE = { bridge: true }
/** Y transaction origin of an older generation's confirmed copy filling an empty one (nothing the server lacks). */
const SEED = { seed: true }
const FIELD = 'default'
/** Remote changes reach the store quickly; your own typing in pauses (it also writes the meta document's search excerpt). */
const REFRESH_MS = 300
const REFRESH_LOCAL_MS = 900
/** How long an unused entry lingers (StrictMode remounts, quick back-and-forth). */
const LINGER_MS = 4000
const CONCURRENCY = 3

export interface ContentContext {
  wsId: string
  /** This member's account id (names of private page documents). */
  userId: string
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
  /** Which document: this member's private one, or the workspace's. */
  priv: boolean
  doc: Y.Doc
  idb: IndexeddbPersistence
  provider: HocuspocusProvider
  refs: number
  holds: number
  loaded: Promise<void>
  isLoaded: boolean
  synced: boolean
  firstSync: Promise<void>
  resolveSync: () => void
  localEdit: boolean
  /** The page went away while the entry was in use: drop the local copies once it is let go. */
  forgotten: boolean
  /** Older generations' copies holding changes the server never confirmed: taken over once it has answered (adoptAll). */
  older: OlderCopy[] | null
  /** Their takeover, while it runs. */
  adoption: Promise<void> | null
  refreshTimer?: number
  lingerTimer?: number
  handle: ContentDocHandle | null
}

interface OlderCopy {
  name: string
  gen: number
}

let ctx: ContentContext | null = null
const entries = new Map<ID, Entry>()

export function contentContext(): ContentContext | null {
  return ctx
}

const docName = (pageId: ID, priv: boolean) => (priv ? `ws:${ctx!.wsId}:u:${ctx!.userId}:p:${pageId}` : `ws:${ctx!.wsId}:p:${pageId}`)
/** This build's local copy of a page document: one per document schema generation (see the top). */
const idbName = (pageId: ID, priv: boolean) => `one:g${DOC_SCHEMA_VERSION}:${docName(pageId, priv)}`
/** Older generations' copies of the same document: generation 0 had no prefix. */
const olderNames = (pageId: ID, priv: boolean): OlderCopy[] =>
  Array.from({ length: DOC_SCHEMA_VERSION }, (_, gen) => ({ name: gen ? `one:g${gen}:${docName(pageId, priv)}` : `one:${docName(pageId, priv)}`, gen }))
/**
 * Every older copy of a page: under its document's name first, then under the other scope's — the page may have
 * moved between Private and the workspace (another device) since an older build wrote it; a move copies the
 * document's full state, so that copy's changes belong to the same document.
 */
const olderCopies = (pageId: ID, priv: boolean): OlderCopy[] => [...olderNames(pageId, priv), ...olderNames(pageId, !priv)]
/** Where the page lives now (the binding keeps the marker in step with the meta documents). */
const isPrivate = (pageId: ID) => !!useWorkspace.getState().pages[pageId]?.private
/** Changes that came from the server or this device's IndexedDB copy (not typed / written here). */
const isRemoteOrigin = (origin: unknown) => origin instanceof HocuspocusProvider || origin instanceof IndexeddbPersistence || origin === SEED

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
  const priv = isPrivate(pageId)
  const idb = new IndexeddbPersistence(idbName(pageId, priv), doc)
  const entry: Entry = {
    pageId,
    priv,
    doc,
    idb,
    provider: null as unknown as HocuspocusProvider,
    refs: 0,
    holds: 0,
    // loaded = this generation's copy, plus what an older generation's copy can give at once (prepareOlder)
    loaded: idb.whenSynced
      .then(() => prepareOlder(entry))
      .catch((err) => console.warn('[one] could not look at older local copies', err))
      .then(() => {
        entry.isLoaded = true
        // `pending` is judged only now: a server sync that came first must not drop it before the older copies were looked at
        checkConfirmed(entry)
      }),
    isLoaded: false,
    synced: false,
    firstSync: Promise.resolve(),
    resolveSync: () => {},
    localEdit: false,
    forgotten: false,
    older: null,
    adoption: null,
    handle: null,
  }
  resetSync(entry)
  entries.set(pageId, entry)

  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (!isRemoteOrigin(origin) && c.writable()) {
      // typed here, undone here, or a bridge write: the server has to confirm it
      // (a viewer's local changes never reach the server — nothing to wait for)
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
  doc.getXmlFragment(FIELD).observeDeep((events, tr) => scrubPrivateMentions(entry, events, tr))
  entry.provider = connect(entry, docName(pageId, priv))
  return entry
}

/* ------------------------------------------------------------------ older generations' copies */

let dbList: Promise<Set<string> | null> | null = null

/** The IndexedDB databases this browser holds (null: it can't say) — listed once per workspace session. */
function listDatabases(): Promise<Set<string> | null> {
  dbList ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null
      return new Set((await indexedDB.databases()).map((d) => d.name ?? '').filter(Boolean))
    } catch {
      return null
    }
  })()
  return dbList
}

/** How long an older copy may take to open before its takeover waits for the next sync. */
const OLDER_OPEN_MS = 4000

/**
 * Copies of this page an older build of One left in this browser (part of `loaded`, after this generation's copy):
 *  - without changes the server never confirmed, the server has all of it — deletions too (a gated, read-only
 *    connection never gets one confirmed): it fills this generation's copy when that is empty, then goes;
 *  - with such changes (`pending`), they may delete a node that build could not read: they wait for the
 *    server's state (adoptAll, on every sync until done) and the page stays pending until then.
 */
async function prepareOlder(e: Entry): Promise<void> {
  const c = ctx
  if (!c) return
  const listed = await listDatabases()
  // read only now, and never dropped before (checkConfirmed waits for `isLoaded`)
  const pending = c.pending.has(e.pageId)
  // without a listing: only a page with unconfirmed changes is worth opening the older names for
  const older = olderCopies(e.pageId, e.priv).filter((o) => (listed ? listed.has(o.name) : pending))
  if (!older.length || entries.get(e.pageId) !== e || ctx !== c) return
  if (pending) {
    e.older = older
    if (e.synced) void adoptAll(e)
    return
  }
  // the server's state already in: it has all of the copy (an empty document there is not filled from it again)
  if (!e.synced && !e.doc.getXmlFragment(FIELD).length) {
    for (const o of older) {
      if (entries.get(e.pageId) !== e) return
      await seedFrom(e, o.name).catch((err) => console.warn('[one] could not read an older local copy', err))
    }
  }
  for (const o of older) {
    void clearDocument(o.name).catch(() => {})
    listed?.delete(o.name)
  }
}

/** An older copy is gone from this browser: the session's listing forgets it. */
function unlist(name: string) {
  void dbList?.then((s) => s?.delete(name))
}

/** Is this database still in the browser (another tab may have taken the copy over meanwhile)? Can't say → yes. */
async function stillThere(name: string): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return true
    return (await indexedDB.databases()).some((d) => d.name === name)
  } catch {
    return true
  }
}

/** `fn` while no other tab of this browser runs one under `name` (Web Locks; without them, at once). */
function exclusive(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? locks.request(name, fn).then(() => {}) : fn()
}

/** An older generation's copy, opened on its own (throws when it does not open in time — it is kept then). */
async function openOlder(name: string): Promise<{ doc: Y.Doc; close: () => Promise<void> }> {
  const doc = new Y.Doc()
  const idb = new IndexeddbPersistence(name, doc)
  const close = async () => {
    await idb.destroy().catch(() => {})
    doc.destroy()
  }
  if (!(await within(idb.whenSynced.then(() => true), OLDER_OPEN_MS, false))) {
    await close()
    throw new Error(`older copy ${name} did not open in time`)
  }
  return { doc, close }
}

/** A confirmed older copy into this generation's empty copy (its items are the server's: nothing is doubled). */
async function seedFrom(e: Entry, name: string): Promise<void> {
  const old = await openOlder(name)
  try {
    if (entries.get(e.pageId) === e) Y.applyUpdate(e.doc, Y.encodeStateAsUpdate(old.doc), SEED)
  } finally {
    await old.close()
  }
}

/**
 * Take over the older copies' unconfirmed changes now that the server's state is in (adoptOlder), then let
 * them go. A copy that does not open in time stays, and so does the page's `pending`: the next sync tries again.
 * A tab that may not write (a viewer, an outdated tab) takes nothing over: the copies wait for one that may.
 */
function adoptAll(e: Entry): Promise<void> {
  if (e.adoption) return e.adoption
  const c = ctx
  const older = e.older
  if (!c || !older || !c.writable()) return Promise.resolve()
  const run = (async () => {
    const live = () => entries.get(e.pageId) === e && ctx === c
    for (const o of older) {
      if (!live()) return
      try {
        // one tab of this browser at a time, and only while the copy is there: taken over twice (two tabs of
        // the update), a merged copy's text would come twice — it goes right after its takeover
        await exclusive(`one:older:${o.name}`, async () => {
          if (!live() || !(await stillThere(o.name))) return
          await adoptOlder(e, o.name, o.gen)
          await within(clearDocument(o.name).then(() => true), OLDER_OPEN_MS, false)
        })
      } catch (err) {
        console.warn('[one] could not take over an older local copy — trying again on the next sync', err)
        return
      }
      if (!live()) return
      unlist(o.name)
      e.older = e.older?.filter((x) => x !== o) ?? null
    }
    if (live() && !e.older?.length) e.older = null
  })()
  e.adoption = run.finally(() => {
    e.adoption = null
    if (entries.get(e.pageId) !== e) return
    scheduleRefresh(e, 0)
    checkConfirmed(e)
  })
  return e.adoption
}

/**
 * One older copy's state into the page document: as it is when it deletes nothing newer than its generation
 * (`gen`), else its content merged with every newer node put back (the older build deleted what it could not
 * read — that deletion never reaches the server).
 */
async function adoptOlder(e: Entry, name: string, gen: number): Promise<void> {
  const { doc: old, close } = await openOlder(name)
  const probe = new Y.Doc()
  try {
    const update = Y.encodeStateAsUpdate(old)
    const before = fragmentJSON(e)
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(e.doc))
    Y.applyUpdate(probe, update)
    const frag = probe.getXmlFragment(FIELD)
    const after = frag.length ? (yXmlFragmentToProsemirrorJSON(frag) as JSONContent) : null
    if (deepEqual(before, after)) return
    if (!lostNewer(before, after, gen)) {
      Y.applyUpdate(e.doc, update, BRIDGE)
      return
    }
    const merged = restoreNewer(before, after, gen, 'drop')
    if (!merged || deepEqual(merged, before)) return
    e.doc.transact(() => {
      prosemirrorJSONToYXmlFragment(docSchema(), prepareCollabContent(merged, true), e.doc.getXmlFragment(FIELD))
    }, BRIDGE)
  } finally {
    probe.destroy()
    await close()
  }
}

function resetSync(e: Entry) {
  e.synced = false
  e.firstSync = new Promise<void>((r) => (e.resolveSync = r))
}

/** Nothing in this copy yet, and the server has not answered for the page: what it holds is not here. */
const blind = (e: Entry) => !e.synced && !e.doc.getXmlFragment(FIELD).length
const hasText = (plain: string | undefined) => !!plain?.trim()
/** A doc with more in it than one empty paragraph (an image, a divider, a table … count, not only text). */
const hasContent = (json: JSONContent | null | undefined) => !!json?.content?.some((n) => n.type !== 'paragraph' || !!n.content?.length)
/** This device knows the page has something in it: its search excerpt (meta document) or its last known content. */
function known(pageId: ID): boolean {
  const p = useWorkspace.getState().pages[pageId]
  return !!p && (hasText(p.plain) || hasContent(p.content))
}

/** Resolves once the server's state is in and older copies are taken over (or the entry is gone) — offline, when back. */
async function serverIn(e: Entry): Promise<void> {
  // firstSync is a new promise after a move (resetSync): look again every second
  while (entries.get(e.pageId) === e && ctx && !e.synced && !e.forgotten) await within(e.firstSync, 1000, undefined)
  if (e.adoption) await e.adoption
}

/**
 * A provider for the entry's document on `name` (the shared socket). Its events act on the entry
 * only while it is the entry's provider — a move's standby provider just syncs. `awareness`: the
 * entry's (open editors' carets keep working when a move swaps providers).
 */
function connect(e: Entry, name: string, awareness?: HocuspocusProvider['awareness']): HocuspocusProvider {
  const c = ctx!
  const provider = new HocuspocusProvider({ websocketProvider: getSocket(), name, document: e.doc, ...(awareness ? { awareness } : {}) })
  watchSchema(provider)
  const mine = () => e.provider === provider && entries.get(e.pageId) === e
  provider.on('synced', () => {
    if (!mine()) return
    e.synced = true
    e.resolveSync()
    // the server's state is in: older copies' unconfirmed changes now (the store keeps its text meanwhile)
    if (e.older) void adoptAll(e)
    scheduleRefresh(e, 0)
    checkConfirmed(e)
  })
  provider.on('unsyncedChanges', () => {
    if (!mine()) return
    checkConfirmed(e)
    updateUnsynced()
  })
  provider.on('close', ({ event }: { event: { reason?: string } }) => {
    if (!mine()) return
    e.synced = false
    if (event?.reason) c.onClose(event.reason)
  })
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
    if (mine()) c.onClose(reason === 'unauthenticated' ? 'session-ended' : reason === 'forbidden' ? 'membership-revoked' : reason)
  })
  provider.attach()
  return provider
}

/** Stop a provider but keep its awareness alive (it moved on to the entry's next provider). */
function retire(provider: HocuspocusProvider) {
  const awareness = provider.configuration.awareness
  provider.configuration.awareness = null
  try {
    provider.destroy()
  } catch {
    /* gone */
  }
  // editors still holding this provider read `.awareness` when they unmount
  provider.configuration.awareness = awareness
}

/**
 * The page moved between Private and the workspace: the entry continues on the other document
 * (`provider` — a move's standby provider that already holds the full state on the server — or a
 * fresh one) and keeps its local copy under that name; the old name's local copy goes.
 */
function retarget(e: Entry, priv: boolean, provider?: HocuspocusProvider) {
  if (e.priv === priv) {
    if (provider && provider !== e.provider) retire(provider)
    return
  }
  const old = e.provider
  const oldIdb = e.idb
  const oldName = idbName(e.pageId, e.priv)
  e.priv = priv
  e.idb = new IndexeddbPersistence(idbName(e.pageId, priv), e.doc)
  resetSync(e)
  e.provider = provider ?? connect(e, docName(e.pageId, priv), old.awareness)
  if (provider?.isSynced) {
    e.synced = true
    e.resolveSync()
  }
  if (e.handle) e.handle.provider = e.provider
  retire(old)
  void oldIdb
    .destroy()
    .then(() => clearDocument(oldName))
    .catch(() => {})
  checkConfirmed(e)
  updateUnsynced()
}

/**
 * The server confirmed every local change of this page: it is no longer pending — never before the local copies
 * are loaded (an older copy's changes hang on `pending`, prepareOlder reads it) and never while older copies wait.
 */
function checkConfirmed(e: Entry) {
  if (!ctx || entries.get(e.pageId) !== e || !e.isLoaded || e.older || e.adoption || !e.synced || e.provider.hasUnsyncedChanges || !ctx.pending.has(e.pageId)) return
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
  const idbDone = e.idb.destroy()
  e.doc.destroy()
  updateUnsynced()
  // gone from the store while it was open: its local copies go now (unless it came back)
  if (e.forgotten && !useWorkspace.getState().pages[e.pageId]) void idbDone.finally(() => forget(e.pageId))
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
  // older copies are being taken over: the server's state without them would hide their text for a moment
  if (e.adoption) return
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

/**
 * Hand what the document received (local copy, server, others) to the store now — before an editor
 * binds to it. The editor's own first changes (block ids, a trailing line …) are local edits: had the
 * loaded state not reached the store yet, the next refresh would pass all of it off as typed in this
 * tab, and a copy that is merely stale (a synced block, say) would look like this tab's edit.
 */
function settle(e: Entry) {
  if (e.refreshTimer === undefined || entries.get(e.pageId) !== e) return
  window.clearTimeout(e.refreshTimer)
  refresh(e)
}

export function acquire(pageId: ID): ContentDocHandle | null {
  if (!ctx || !PAGE_ID.test(pageId)) return null
  const e = ensure(pageId)
  e.refs++
  window.clearTimeout(e.lingerTimer)
  if (!e.handle) {
    const u = ctx.user()
    const ready = (async () => {
      await e.loaded
      if (blind(e)) {
        // nothing here yet, but the page has something in it (or older copies wait for the server): typed into this
        // empty copy, it would come twice — the server first, however long that takes (the page shows it meanwhile)
        if (e.older || known(pageId)) await serverIn(e)
        // first time on this device: wait (briefly) for the server's copy instead of showing an empty page
        else if (isConnected()) await within(e.firstSync, 4000, undefined)
      }
      // older copies' changes being taken over: the page opens with them
      if (e.adoption) await e.adoption
      settle(e)
    })()
    e.handle = { doc: e.doc, provider: e.provider, field: FIELD, user: { name: u.name, color: u.color }, readOnly: !ctx.writable(), ready }
  } else if (e.isLoaded) settle(e)
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

/**
 * Hand one page's pending refresh to the store right away: a writer that changed the page's open editor (its document
 * carries the change) and reads the store next — the AI terminal's edit_page.
 */
export function flushRefresh(pageId: ID): void {
  const e = entries.get(pageId)
  if (!e || e.refreshTimer === undefined) return
  window.clearTimeout(e.refreshTimer)
  refresh(e)
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
/**
 * Writes waiting for their page's first server sync (blind) are kept on this device — a tab closed meanwhile writes
 * them on the next boot — one record per hold (cloud/local.ts `held:<ws>:<page>:<rid>`: the first base, the latest
 * text), with the page marked pending and its text in the content cache (the store shows it after a reload). This
 * tab's own record per page: a later write to the page folds into it while it waits.
 */
const heldWrites = new Map<ID, Held>()
interface Held extends HeldWrite {
  rid: string
}
/** Pages with records taken over from a tab that went, queued to be written (a write of this tab behind them is held too). */
const resuming = new Map<ID, number>()
/** The newest text queued for a page: a write that starts waiting holds that (later ones queued behind it are in it). */
const queuedText = new Map<ID, JSONContent | null>()

/* ------------------------------------------------------------------ held records: one tab's at a time */

/**
 * A held record is the tab's that holds it (its own, or one it took over): another tab of this browser takes it over
 * only once that tab let it go (the tab gone, or the record written and gone with it) — two tabs writing the same held
 * text would bring it twice. The owner keeps the Web Lock `one:held:<ws>:<rid>`. Without Web Locks (no secure context
 * — a team server on plain http — or Safari before 15.4) it answers the others' question about the record on a
 * BroadcastChannel instead: a tab takes a record over only when nobody answered within ASK_MS (the earlier of two
 * asking at once gets it), and asks again when its owner lets go or every ASK_AGAIN_MS. rid → its page, letting go.
 */
const owned = new Map<string, Owned>()
interface Owned {
  pageId: ID
  release: () => void
  /** let go once something is stored (its deletion): this tab answers for it until then */
  leaving?: boolean
}
/** Lock requests waiting for a record another tab owns: they end when the workspace closes. */
let waits: AbortController | null = null
const ASK_MS = 300
const ASK_AGAIN_MS = 5000
/** BroadcastChannels of one tab hear each other: messages carry the sender. */
const TAB = newId()
type HeldMessage = { t: 'ask'; rid: string; from: string; at: number } | { t: 'mine'; rid: string; from: string; to: string } | { t: 'free'; rid: string; from: string }
/** This tab's open questions: rid → when it asked, and whether another tab owns the record (or asked first). */
const asking = new Map<string, { at: number; taken: boolean }>()
/** Records this tab waits for: rid → wake-ups when their owner lets them go. */
const freed = new Map<string, Set<() => void>>()
let heldChannel: BroadcastChannel | null | undefined

const webLocks = (): LockManager | null => {
  const locks = typeof navigator !== 'undefined' ? (navigator.locks as LockManager | undefined) : undefined
  return typeof locks?.request === 'function' ? locks : null
}
const lockName = (wsId: string, rid: string) => `one:held:${wsId}:${rid}`

/** The channel tabs without Web Locks ask each other on (opened the first time this tab owns or asks for a record). */
function heldMessages(): BroadcastChannel | null {
  if (heldChannel !== undefined) return heldChannel
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-held') : null
  heldChannel = ch
  ch?.addEventListener('message', (ev: MessageEvent) => {
    const m = ev.data as HeldMessage | null
    if (!m || typeof m.rid !== 'string' || m.from === TAB) return
    if (m.t === 'ask') {
      const q = asking.get(m.rid)
      // ours — or both asking: the earlier question wins (at the same moment, the smaller tab id)
      if (owned.has(m.rid) || (q && !q.taken && (q.at < m.at || (q.at === m.at && TAB < m.from)))) ch.postMessage({ t: 'mine', rid: m.rid, from: TAB, to: m.from })
      else if (q) q.taken = true
    } else if (m.t === 'mine') {
      const q = m.to === TAB ? asking.get(m.rid) : undefined
      if (q) q.taken = true
    } else if (m.t === 'free') freed.get(m.rid)?.forEach((wake) => wake())
  })
  return ch
}

/** Without Web Locks: what lets an owned record go (the tabs waiting for it ask again). */
const announceFree = (rid: string) => () => heldMessages()?.postMessage({ t: 'free', rid, from: TAB })

/** A record this tab just made is its own (no other tab knows it yet). */
function own(wsId: string, pageId: ID, rid: string): void {
  if (owned.has(rid)) return
  const locks = webLocks()
  if (!locks) {
    heldMessages()
    owned.set(rid, { pageId, release: announceFree(rid) })
    return
  }
  let release!: () => void
  const kept = new Promise<void>((r) => (release = r))
  owned.set(rid, { pageId, release })
  locks.request(lockName(wsId, rid), () => kept).catch(() => {})
}

/**
 * This tab is done with the record — once `stored` (its deletion, or nothing to store), another tab may take it over;
 * until then this tab still answers for it.
 */
function disown(rid: string, stored: Promise<void> = Promise.resolve()): void {
  const o = owned.get(rid)
  if (!o || o.leaving) return
  o.leaving = true
  void stored.then(() => {
    if (owned.get(rid) !== o) return
    owned.delete(rid)
    o.release()
  })
}

/**
 * Make a record another tab left this tab's: true once it is. `wait`: until the tab that owns it lets it go — else
 * false at once while one does. False when the workspace closed meanwhile.
 */
function takeOver(c: ContentContext, pageId: ID, rid: string, wait: boolean): Promise<boolean> {
  if (owned.has(rid)) return Promise.resolve(false)
  const locks = webLocks()
  if (!locks) return askFor(c, pageId, rid, wait)
  const signal = waits?.signal
  return new Promise<boolean>((resolve) => {
    let release!: () => void
    const kept = new Promise<void>((r) => (release = r))
    const granted = async (lock: Lock | null) => {
      if (!lock || ctx !== c || owned.has(rid)) return resolve(false)
      owned.set(rid, { pageId, release })
      resolve(true)
      await kept
    }
    const options: LockOptions = wait ? (signal ? { signal } : {}) : { ifAvailable: true }
    locks.request(lockName(c.wsId, rid), options, granted).catch(() => resolve(false))
  })
}

/** takeOver without Web Locks: ask the other tabs whether one owns the record (see `owned`). */
async function askFor(c: ContentContext, pageId: ID, rid: string, wait: boolean): Promise<boolean> {
  const ch = heldMessages()
  for (;;) {
    if (ctx !== c) return false
    // nobody to ask — no BroadcastChannel either (Safari before 15.4, which this build does not run in): taken
    if (!ch) {
      owned.set(rid, { pageId, release: () => {} })
      return true
    }
    const q = { at: Date.now(), taken: false }
    asking.set(rid, q)
    ch.postMessage({ t: 'ask', rid, from: TAB, at: q.at })
    const mine = await new Promise<boolean>((resolve) =>
      window.setTimeout(() => {
        if (asking.get(rid) === q) asking.delete(rid)
        const free = !q.taken && ctx === c && !owned.has(rid)
        // in the same task as the question ends: from now on this tab answers it
        if (free) owned.set(rid, { pageId, release: announceFree(rid) })
        resolve(free)
      }, ASK_MS),
    )
    if (mine) return true
    if (!wait || ctx !== c) return false
    // asked again once its owner lets it go — or after a while (an owner may go without a word)
    await new Promise<void>((resolve) => {
      const wakes = freed.get(rid) ?? new Set<() => void>()
      freed.set(rid, wakes)
      const wake = () => {
        window.clearTimeout(timer)
        wakes.delete(wake)
        if (!wakes.size && freed.get(rid) === wakes) freed.delete(rid)
        resolve()
      }
      const timer = window.setTimeout(wake, ASK_AGAIN_MS)
      wakes.add(wake)
    })
  }
}

/* ------------------------------------------------------------------ held writes */

function holdWrite(pageId: ID, base: JSONContent | null, ours: JSONContent | null) {
  const c = ctx
  if (!c) return
  const prev = heldWrites.get(pageId)
  const v: Held = prev ? { ...prev, ours } : { rid: newId(), base, ours, at: Date.now() }
  heldWrites.set(pageId, v)
  // owned before it is stored: a tab that reads it finds it taken
  if (!prev) own(c.wsId, pageId, v.rid)
  void saveHeldWrite(c.wsId, pageId, v.rid, v)
  const cached = { json: ours, at: 0 }
  c.cache.set(pageId, cached)
  saveContentCache(c.wsId, pageId, cached)
  if (!c.pending.has(pageId)) {
    c.pending.add(pageId)
    c.savePending()
  }
}

/**
 * The write ending in `ours` is done. Written into the document: the held record goes with the last one; a later
 * write, still queued, keeps it — from what is in the document now (a reload merges only the rest, never this write
 * a second time). Not written (it failed, the tab may no longer write, the page went): this tab lets go of the record
 * as it is — a later write here never folds into it, and a boot (or another tab) that may write writes it. A record
 * goes only once its own text is written, or with its page (gone for good, `forget`).
 */
function letGo(pageId: ID, ours: JSONContent | null, written: boolean) {
  const c = ctx
  const v = heldWrites.get(pageId)
  if (!v || !c) return
  if (!written) {
    heldWrites.delete(pageId)
    disown(v.rid)
  } else if (v.ours === ours) {
    heldWrites.delete(pageId)
    disown(v.rid, saveHeldWrite(c.wsId, pageId, v.rid, null))
  } else if (v.base !== ours) {
    const next: Held = { ...v, base: ours }
    heldWrites.set(pageId, next)
    void saveHeldWrite(c.wsId, pageId, v.rid, next)
  }
}

/** The page is gone for good: every held record of it goes (any tab's) — this tab's hold on them once that is stored. */
function dropHeld(pageId: ID): void {
  const c = ctx
  if (!c) return
  heldWrites.delete(pageId)
  const stored = dropHeldWrites(c.wsId, pageId)
  for (const [rid, o] of owned) if (o.pageId === pageId) disown(rid, stored)
}

function canonical(json: JSONContent | null): JSONContent | null {
  if (!json) return null
  try {
    return docSchema().nodeFromJSON(prepareCollabContent(json, false)).toJSON() as JSONContent
  } catch {
    return json
  }
}

/** A write's part in its page's queue: `hold` keeps it on this device while it waits for the server, `done` after. */
interface WriteHold {
  hold(): void
  done(written: boolean): void
}

/** Merge `base` → `ours` into the page's Y document in its turn (with what Y has by then). */
function queueWrite(pageId: ID, base: JSONContent | null, ours: JSONContent | null, h: WriteHold): void {
  const prev = writeQueues.get(pageId) ?? Promise.resolve()
  const job = prev.then(async () => {
    const c = ctx
    if (!c || !useWorkspace.getState().pages[pageId]) return h.done(false)
    const e = hold(pageId)
    let written = false
    try {
      await e.loaded
      // nothing here yet while the page had something in it: written into this empty copy, all of it would come
      // twice once the server's state is in — the write waits for the server (the store shows it meanwhile)
      if (blind(e) && (e.older || hasContent(base))) {
        h.hold()
        await serverIn(e)
        // gone meanwhile (deleted for good, the workspace closed) or no longer allowed to write (a role change, an
        // outdated tab): nothing is written — a held write stays on this device for a boot that may write it
        if (e.forgotten || ctx !== c || !useWorkspace.getState().pages[pageId] || !c.writable()) return
      } else if (isConnected() && !e.synced) await within(e.firstSync, 5000, undefined)
      if (entries.get(pageId) !== e) return
      const frag = e.doc.getXmlFragment(FIELD)
      const theirs = canonical(fragmentJSON(e))
      const b = canonical(base)
      const o = canonical(ours)
      let target = theirs && !deepEqual(theirs, b) ? mergeContent(b, theirs, o) : o
      // a workspace page never gets the title of a private page through a mention's label
      if (!e.priv) target = stripHiddenMentions(target, isPrivate) ?? target
      if (!deepEqual(target, theirs)) {
        e.doc.transact(() => {
          if (!target) frag.delete(0, frag.length)
          else prosemirrorJSONToYXmlFragment(docSchema(), prepareCollabContent(target, true), frag)
        }, BRIDGE)
      }
      written = true
    } catch (err) {
      console.error('[one] could not write content into the page document', err)
    } finally {
      unhold(e)
      h.done(written)
    }
  })
  // the queue's tail is the promise stored here (not `job`): only the last one cleans up
  const tail: Promise<void> = job.finally(() => {
    if (writeQueues.get(pageId) !== tail) return
    writeQueues.delete(pageId)
    queuedText.delete(pageId)
  })
  writeQueues.set(pageId, tail)
}

/** Write a non-editor content change into the page's Y document (merged with what Y has meanwhile). */
export function bridgeContent(pageId: ID, base: JSONContent | null, ours: JSONContent | null): void {
  if (!ctx || !ctx.writable() || !PAGE_ID.test(pageId)) return
  if (deepEqual(base, ours)) return
  // a write before this one waits for the server: this one is the text to keep now
  if (heldWrites.has(pageId) || resuming.has(pageId)) holdWrite(pageId, base, ours)
  queuedText.set(pageId, ours)
  queueWrite(pageId, base, ours, {
    hold: () => holdWrite(pageId, base, queuedText.has(pageId) ? (queuedText.get(pageId) ?? null) : ours),
    done: (written) => letGo(pageId, ours, written),
  })
}

/** A record taken over from a tab that went, written in its turn (it is on this device already); it goes once written. */
function writeResumed(c: ContentContext, r: HeldRecord): void {
  resuming.set(r.pageId, (resuming.get(r.pageId) ?? 0) + 1)
  queueWrite(r.pageId, r.base, r.ours, {
    hold: () => {},
    done: (written) => {
      const left = (resuming.get(r.pageId) ?? 1) - 1
      if (left > 0) resuming.set(r.pageId, left)
      else resuming.delete(r.pageId)
      disown(r.rid, written && ctx === c ? saveHeldWrite(c.wsId, r.pageId, r.rid, null) : undefined)
    },
  })
}

/** A record this tab just took over, read again (`r`; written meanwhile, it is gone): written, or let go as it is. */
function resume(c: ContentContext, rid: string, r: HeldRecord | undefined): void {
  if (!r || ctx !== c || !c.writable() || !useWorkspace.getState().pages[r.pageId]) disown(rid)
  else writeResumed(c, r)
}

/**
 * Writes tabs left waiting for their page's first server sync (holdWrite): merged in once it answers, in the order
 * they were held. A record another open tab still owns is its own — this tab takes it over only once that tab let it
 * go (closed), and reads it again then (written meanwhile, it is gone).
 */
export async function resumeHeldWrites(): Promise<void> {
  const c = ctx
  if (!c) return
  const list = await loadHeldWrites(c.wsId)
  if (ctx !== c) return
  const todo: HeldRecord[] = []
  for (const r of list) {
    // the page is gone, or nothing is left to write (a later write took the first one back)
    if (!useWorkspace.getState().pages[r.pageId] || deepEqual(r.base, r.ours)) void saveHeldWrite(c.wsId, r.pageId, r.rid, null)
    // not allowed to write now (a viewer, an outdated tab): kept for a boot that may
    else if (c.writable() && !owned.has(r.rid)) todo.push(r)
  }
  if (!todo.length) return
  const taken = await Promise.all(todo.map((r) => takeOver(c, r.pageId, r.rid, false)))
  const now = new Map((await loadHeldWrites(c.wsId)).map((r) => [r.rid, r]))
  todo.forEach((r, i) => {
    if (taken[i]) resume(c, r.rid, now.get(r.rid))
    else
      void takeOver(c, r.pageId, r.rid, true).then(async (ok) => {
        if (ok) resume(c, r.rid, (await loadHeldWrites(c.wsId, r.pageId)).find((x) => x.rid === r.rid))
      })
  })
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
export function onRemotePages(r: { created: ID[]; touched: ID[]; removed: ID[]; rescoped: ID[] }): void {
  if (r.rescoped.length) rescope(r.rescoped)
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

/**
 * A page is gone from this device's store (deleted for good, or — for someone else — moved to a
 * private section): drop its document and every local copy. An entry still in use (an open
 * editor) is dropped when it is let go.
 */
export function forget(pageId: ID): void {
  if (!ctx) return
  const e = entries.get(pageId)
  if (e && (e.refs || e.holds)) {
    e.forgotten = true
    dropHeld(pageId)
    return
  }
  if (e) destroy(e)
  ctx.cache.delete(pageId)
  dropContentCache(ctx.wsId, pageId)
  dropHeld(pageId)
  if (ctx.pending.delete(pageId)) ctx.savePending()
  if (!PAGE_ID.test(pageId)) return
  for (const priv of [false, true]) for (const name of [idbName(pageId, priv), ...olderNames(pageId, priv).map((o) => o.name)]) void clearDocument(name).catch(() => {})
}

/* ------------------------------------------------------------------ private ⇄ workspace */

export interface ContentMove {
  /** The pages' documents continue on the target names (call right after the meta documents moved). */
  commit(): void
  /** Nothing moved: the standby providers go (the caller purges what they left on the server). */
  abort(): void
  /** The moved pages' content as the server has it (file references for publishing private uploads). */
  json: Map<ID, JSONContent | null>
}

const confirmed = (p: HocuspocusProvider) => p.isSynced && !p.hasUnsyncedChanges

/** Resolves true once `test()` holds (checked on the provider's events and every 100 ms), false after `ms`. */
function until(test: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (test()) return resolve(true)
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      if (test()) {
        window.clearInterval(timer)
        resolve(true)
      } else if (Date.now() - t0 > ms) {
        window.clearInterval(timer)
        resolve(false)
      }
    }, 100)
  })
}

/**
 * Get the content of `ids` ready to live in the other scope: every document synced with the server
 * under its current name, then a standby provider per page on the target name (same Y.Doc), until
 * the server confirmed the full state there. `hidden`: pages whose mentions lose their label first
 * (moving to the workspace: pages that stay private). Throws CloudError('offline' | 'timeout') —
 * then nothing is left behind except what standby providers already sent (the caller purges it).
 */
export async function prepareMove(ids: ID[], toPrivate: boolean, hidden?: (id: ID) => boolean, timeoutMs = 20_000): Promise<ContentMove> {
  if (!ctx || !isConnected()) throw new CloudError('offline', 'Moving pages needs a connection.')
  const held = ids.filter((id) => PAGE_ID.test(id)).map(hold)
  const standby: Array<{ e: Entry; provider: HocuspocusProvider }> = []
  const release = () => held.forEach(unhold)
  try {
    await Promise.all(held.map((e) => e.loaded))
    if (!(await until(() => held.every((e) => e.synced), timeoutMs))) throw new CloudError(isConnected() ? 'timeout' : 'offline', 'The server did not answer in time.')
    // the labels go before the state is copied (a cleared value is not part of the encoded state)
    if (hidden) for (const e of held) clearLabels(e, [...allMentions(e.doc.getXmlFragment(FIELD))], hidden)
    for (const e of held) if (e.priv !== toPrivate) standby.push({ e, provider: connect(e, docName(e.pageId, toPrivate), e.provider.awareness) })
    if (!(await until(() => standby.every((s) => confirmed(s.provider)), timeoutMs))) throw new CloudError(isConnected() ? 'timeout' : 'offline', 'The server did not confirm the copy in time.')
  } catch (err) {
    for (const s of standby) retire(s.provider)
    release()
    throw err
  }
  const json = new Map<ID, JSONContent | null>()
  for (const e of held) json.set(e.pageId, fragmentJSON(e))
  let done = false
  return {
    json,
    commit() {
      if (done) return
      done = true
      for (const s of standby) if (entries.get(s.e.pageId) === s.e) retarget(s.e, toPrivate, s.provider)
      release()
    },
    abort() {
      if (done) return
      done = true
      for (const s of standby) retire(s.provider)
      release()
    },
  }
}

/** Pages another device moved between Private and the workspace: their open documents follow. */
function rescope(ids: ID[]) {
  for (const id of ids) {
    const e = entries.get(id)
    const priv = isPrivate(id)
    if (e) retarget(e, priv)
    // a local copy under the old name is stale now
    else if (PAGE_ID.test(id)) void clearDocument(idbName(id, !priv)).catch(() => {})
  }
}

/* ------------------------------------------------------------------ mention labels */

const isElement = (t: unknown): t is Y.XmlElement => t instanceof Y.XmlElement

function collectMentions(type: unknown, into: Y.XmlElement[]) {
  if (!isElement(type) && !(type instanceof Y.XmlFragment)) return
  if (isElement(type) && type.nodeName === 'mention') into.push(type)
  for (const el of type.createTreeWalker((n) => isElement(n) && n.nodeName === 'mention')) into.push(el as Y.XmlElement)
}

function allMentions(frag: Y.XmlFragment): Y.XmlElement[] {
  const out: Y.XmlElement[] = []
  collectMentions(frag, out)
  return out
}

/** Page mentions among `els` that name a `hidden` page and still carry its title. */
function labelled(els: Y.XmlElement[], hidden: (id: ID) => boolean): Y.XmlElement[] {
  return els.filter((el) => {
    const id = el.getAttribute('id')
    return el.getAttribute('kind') === 'page' && !!el.getAttribute('label') && typeof id === 'string' && hidden(id)
  })
}

function clearLabels(e: Entry, els: Y.XmlElement[], hidden: (id: ID) => boolean) {
  const leak = labelled(els, hidden)
  if (!leak.length) return
  e.doc.transact(() => {
    for (const el of leak) if (el.doc && el.getAttribute('label')) el.setAttribute('label', '')
  }, BRIDGE)
}

/**
 * A mention of a private page written into a WORKSPACE page here (typed, pasted, bridged) loses its
 * label at once: the other members' copies and the search excerpt must never carry its title.
 */
function scrubPrivateMentions(e: Entry, events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction) {
  if (e.priv || !tr.local || isRemoteOrigin(tr.origin) || !ctx?.writable()) return
  const found: Y.XmlElement[] = []
  for (const ev of events) {
    if (isElement(ev.target) && ev.target.nodeName === 'mention' && (ev as Y.YXmlEvent).attributesChanged?.size) found.push(ev.target)
    for (const item of ev.changes.added) if (item.content instanceof Y.ContentType) collectMentions(item.content.type, found)
  }
  if (!found.length) return
  const isPriv = (id: ID) => !!useWorkspace.getState().pages[id]?.private
  if (!labelled(found, isPriv).length) return
  queueMicrotask(() => {
    if (entries.get(e.pageId) === e && !e.priv) clearLabels(e, found, isPriv)
  })
}

/* ------------------------------------------------------------------ lifecycle */

export function startContent(c: ContentContext): () => void {
  ctx = c
  dbList = null
  waits = new AbortController()
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
    heldWrites.clear()
    resuming.clear()
    queuedText.clear()
    waits?.abort()
    waits = null
    for (const rid of [...owned.keys()]) disown(rid)
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
