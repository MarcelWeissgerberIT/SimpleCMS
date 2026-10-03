/**
 * IndexedDB persistence + live cross-tab sync.
 *
 * - The workspace lives under one key. Saves are debounced and read-modify-write: a tab only
 *   writes what IT changed (dirty pages / databases / settings keys / people / recent) on top of
 *   what is stored, inside one IndexedDB transaction, so two tabs never clobber each other.
 * - Other tabs hear about a save via BroadcastChannel and merge the stored workspace with their
 *   own unsaved changes. Pages that changed elsewhere get a fresh contentRev + origin 'sync', so
 *   open editors always apply (or merge) them.
 * - Two tabs editing the same page at nearly the same time: each tab remembers the stored copy
 *   its unsaved edits started from (`syncBase`). When the save finds that another tab stored a
 *   different copy meanwhile, it three-way merges (see merge.ts) instead of overwriting, writes the
 *   merged page and shows it in this tab too — neither tab's words get lost.
 * - A load error is never mistaken for a first run: it propagates (boot shows its fault screen,
 *   nothing is seeded or saved). Damaged entries are repaired on load and the original value is
 *   kept under `one.workspace.v1.bak` before anything is written.
 * - Leaving the page (pagehide / beforeunload / tab hidden) flushes at once and mirrors the
 *   not-yet-saved pages synchronously to localStorage, because the browser may abort the async
 *   IndexedDB write. The next boot (or another open tab) puts them back.
 */
import { get as idbGet, set as idbSet, update as idbUpdate } from 'idb-keyval'
import { useWorkspace, getWorkspaceSnapshot, emptyWorkspace, WORKSPACE_VERSION, defaultSettings, defaultView, DEFAULT_PAGE_SETTINGS } from './store'
import type { Database, ID, Page, PropertyDef, Settings, Workspace } from './types'
import { newId } from '../lib/ids'
import { mergePage, samePage } from './merge'

const KEY = 'one.workspace.v1'
const BACKUP_KEY = 'one.workspace.v1.bak'
/** localStorage: pages (and databases) that were not saved yet when the page went away. */
const UNSAVED_KEY = 'one.unsaved'
/** Epoch of workspaces stored before epochs existed. */
const LEGACY_EPOCH = 'legacy'
const SAVE_DELAY = 400
const RETRY_MAX = 30_000

const TAB_ID = newId()
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-sync') : null

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error'
let status: SyncStatus = 'idle'
const statusListeners = new Set<(s: SyncStatus) => void>()
function setStatus(s: SyncStatus) {
  status = s
  statusListeners.forEach((l) => l(s))
}
export function getSaveStatus(): SyncStatus {
  return status
}
export function onSaveStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/* ------------------------------------------------------------------ */
/* Migration & repair                                                  */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isIdOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

/** A page entry with every required field present. Null when the entry is not a page at all. */
function normalizePage(id: ID, v: unknown, now: number): { page: Page; repaired: boolean } | null {
  if (!isObj(v)) return null
  let repaired = false
  const fix = <T>(ok: boolean, fallback: T, value: unknown): T => {
    if (ok) return value as T
    repaired = true
    return fallback
  }
  const p = { ...v } as unknown as Page
  p.id = fix(v.id === id, id, v.id)
  p.kind = fix(v.kind === 'page' || v.kind === 'database', 'page', v.kind)
  p.title = fix(typeof v.title === 'string', '', v.title)
  p.parentId = fix(isIdOrNull(v.parentId), null, v.parentId)
  p.databaseId = fix(isIdOrNull(v.databaseId), null, v.databaseId)
  p.properties = fix(isObj(v.properties), {}, v.properties)
  p.content = fix(v.content === null || v.content === undefined || isObj(v.content), null, v.content ?? null)
  p.trashed = fix(typeof v.trashed === 'boolean', false, v.trashed)
  p.createdAt = fix(isNum(v.createdAt), now, v.createdAt)
  p.updatedAt = fix(isNum(v.updatedAt), p.createdAt, v.updatedAt)
  p.order = fix(isNum(v.order), 0, v.order)
  // plain defaults of older shapes (not damage)
  p.icon = isObj(v.icon) ? (v.icon as unknown as Page['icon']) : null
  p.cover = isObj(v.cover) ? (v.cover as unknown as Page['cover']) : null
  p.favorite = v.favorite === true
  p.trashedAt = isNum(v.trashedAt) ? v.trashedAt : null
  p.contentRev = isNum(v.contentRev) ? v.contentRev : 0
  p.contentOrigin = typeof v.contentOrigin === 'string' ? v.contentOrigin : null
  p.settings = { ...DEFAULT_PAGE_SETTINGS, ...(isObj(v.settings) ? (v.settings as Partial<Page['settings']>) : {}) }
  return { page: p, repaired }
}

function normalizeDatabase(id: ID, v: unknown, lang: Settings['language']): { db: Database; repaired: boolean } | null {
  if (!isObj(v)) return null
  let repaired = false
  const db = { ...v } as unknown as Database
  if (v.id !== id) {
    db.id = id
    repaired = true
  }
  const props = Array.isArray(v.properties) ? (v.properties as unknown[]).filter((x): x is PropertyDef => isObj(x) && typeof x.id === 'string') : []
  if (!Array.isArray(v.properties) || props.length !== (v.properties as unknown[]).length) repaired = true
  if (!props.some((x) => x.type === 'title')) {
    props.unshift({ id: newId(), name: 'Name', type: 'title' })
    repaired = true
  }
  db.properties = props
  const views = Array.isArray(v.views) ? (v.views as unknown[]).filter((x): x is Database['views'][number] => isObj(x) && typeof x.id === 'string') : []
  if (!Array.isArray(v.views) || views.length !== (v.views as unknown[]).length) repaired = true
  if (!views.length) {
    views.push(defaultView('table', db, lang === 'de' ? 'Tabelle' : 'Table'))
    repaired = true
  }
  db.views = views
  db.nextUniqueId = isNum(v.nextUniqueId) ? v.nextUniqueId : 1
  return { db, repaired }
}

/**
 * Structural repairs (idempotent): rows of a missing database become plain top-level pages,
 * pages under a missing parent move to the top level, parent cycles are cut.
 */
function repairStructure(ws: Workspace): boolean {
  let repaired = false
  const { pages, databases } = ws
  for (const p of Object.values(pages)) {
    if (p.databaseId && !(databases[p.databaseId] && pages[p.databaseId])) {
      if (!p.parentId || p.parentId === p.databaseId || !pages[p.parentId]) p.parentId = null
      p.databaseId = null
      repaired = true
    }
    if (p.parentId && (p.parentId === p.id || !pages[p.parentId])) {
      p.parentId = null
      repaired = true
    }
  }
  // cycles: walk each page's ancestors; the page whose parent is already on the path closes the loop
  const state = new Map<ID, 1 | 2>() // 1 = on the current path, 2 = known to reach the root
  for (const start of Object.keys(pages)) {
    const path: ID[] = []
    let cur: ID | null = start
    while (cur && pages[cur] && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        const closer = pages[path[path.length - 1]]
        if (closer.databaseId === closer.parentId) closer.databaseId = null
        closer.parentId = null
        repaired = true
        break
      }
      state.set(cur, 1)
      path.push(cur)
      cur = pages[cur].parentId
    }
    for (const id of path) state.set(id, 2)
  }
  return repaired
}

/** Upgrade older persisted shapes and repair damaged entries; `repaired` says whether anything was damaged. */
export function migrateWithReport(raw: unknown): { ws: Workspace; repaired: boolean } {
  let repaired = !isObj(raw)
  const src: Obj = isObj(raw) ? raw : {}
  const ws: Workspace = { ...emptyWorkspace(), ...(src as Partial<Workspace>) }
  ws.version = WORKSPACE_VERSION
  ws.epoch = typeof src.epoch === 'string' ? src.epoch : LEGACY_EPOCH
  ws.settings = { ...defaultSettings(), ...(isObj(src.settings) ? (src.settings as Partial<Settings>) : {}) }
  ws.people = Array.isArray(src.people) ? (src.people as unknown[]).filter(isObj) as unknown as Workspace['people'] : []
  ws.recent = Array.isArray(src.recent) ? (src.recent as unknown[]).filter((x): x is string => typeof x === 'string') : []

  const now = Date.now()
  ws.pages = {}
  if (src.pages !== undefined && !isObj(src.pages)) repaired = true
  for (const [id, v] of Object.entries(isObj(src.pages) ? src.pages : {})) {
    const r = normalizePage(id, v, now)
    if (!r) {
      repaired = true
      continue
    }
    if (r.repaired) repaired = true
    ws.pages[id] = r.page
  }
  ws.databases = {}
  if (src.databases !== undefined && !isObj(src.databases)) repaired = true
  for (const [id, v] of Object.entries(isObj(src.databases) ? src.databases : {})) {
    const r = normalizeDatabase(id, v, ws.settings.language)
    if (!r) {
      repaired = true
      continue
    }
    if (r.repaired) repaired = true
    ws.databases[id] = r.db
  }
  // a database page without its schema would crash every view: give it a fresh one
  for (const p of Object.values(ws.pages)) {
    if (p.kind === 'database' && !ws.databases[p.id]) {
      ws.databases[p.id] = normalizeDatabase(p.id, { id: p.id }, ws.settings.language)!.db
      repaired = true
    }
  }
  if (repairStructure(ws)) repaired = true
  return { ws, repaired }
}

/** Upgrade older persisted shapes (and repair damaged entries). */
export function migrate(raw: unknown): Workspace {
  return migrateWithReport(raw).ws
}

/* ------------------------------------------------------------------ */
/* Dirty tracking                                                      */
/* ------------------------------------------------------------------ */

let saveTimer: number | undefined
let retryDelay = 0
let applyingRemote = false
/** Next save writes the whole snapshot (after a repair, so damaged entries leave storage too). */
let fullWriteNext = false

/** True while a workspace update from another tab is being applied (automations etc. should ignore it). */
export function isApplyingRemote(): boolean {
  return applyingRemote
}

/*
 * Local changes not yet written to IndexedDB. When another tab broadcasts a change we
 * merge: everything comes from IndexedDB except what this tab changed and hasn't saved yet,
 * so a fast typist in two tabs never loses keystrokes to a sync.
 */
const dirtyPages = new Set<ID>()
const dirtyDbs = new Set<ID>()
const dirtySettings = new Set<keyof Settings>()
let dirtyPeople = false
let dirtyRecent = false
/** Being written right now (a sync must not replace them with the older stored copy). */
const inflightPages = new Set<ID>()
const inflightDbs = new Set<ID>()
const inflightSettings = new Set<keyof Settings>()
let inflightPeople = false
let inflightRecent = false

/**
 * Per page: the stored copy this tab's current (unsaved) edits descend from. Set when a page
 * first changes after it was in sync, updated after every save and every adopted remote copy.
 */
const syncBase = new Map<ID, Page>()

function trackDirty<T>(next: Record<string, T>, prev: Record<string, T>, into: Set<string>) {
  if (next === prev) return
  for (const id in next) if (next[id] !== prev[id]) into.add(id)
  for (const id in prev) if (!(id in next)) into.add(id)
}

function hasDirty(): boolean {
  return fullWriteNext || dirtyPages.size > 0 || dirtyDbs.size > 0 || dirtySettings.size > 0 || dirtyPeople || dirtyRecent
}

/* ------------------------------------------------------------------ */
/* Unsaved stash (localStorage)                                        */
/* ------------------------------------------------------------------ */

interface Stash {
  at: number
  epoch: string
  pages: Record<ID, Page>
  databases: Record<ID, Database>
}

/** The stash this tab wrote or adopted; removed after the next successful save. */
let pendingStash: string | null = null

function localGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function localRemove(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* blocked storage */
  }
}

function parseStash(raw: string | null): Stash | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!isObj(v) || typeof v.epoch !== 'string' || !isObj(v.pages)) return null
    return { at: isNum(v.at) ? v.at : 0, epoch: v.epoch, pages: v.pages as Stash['pages'], databases: (isObj(v.databases) ? v.databases : {}) as Stash['databases'] }
  } catch {
    return null
  }
}

/** Synchronously mirror every page (and database) this tab has not saved yet. */
function stashUnsaved() {
  const pageIds = new Set([...dirtyPages, ...inflightPages])
  const dbIds = new Set([...dirtyDbs, ...inflightDbs])
  if (!pageIds.size && !dbIds.size) return
  const s = useWorkspace.getState()
  const epoch = s.epoch ?? LEGACY_EPOCH
  const prev = parseStash(localGet(UNSAVED_KEY))
  const stash: Stash = { at: Date.now(), epoch, pages: {}, databases: {} }
  // another tab's stash that nobody adopted yet: keep it
  if (prev && prev.epoch === epoch) {
    stash.pages = { ...prev.pages }
    stash.databases = { ...prev.databases }
  }
  for (const id of pageIds) {
    const p = s.pages[id]
    if (p && !(stash.pages[id]?.updatedAt > p.updatedAt)) stash.pages[id] = p
  }
  for (const id of dbIds) {
    const db = s.databases[id]
    if (db) stash.databases[id] = db
  }
  if (!Object.keys(stash.pages).length && !Object.keys(stash.databases).length) return
  try {
    const raw = JSON.stringify(stash)
    window.localStorage.setItem(UNSAVED_KEY, raw)
    pendingStash = raw
  } catch {
    /* quota / blocked storage: the IndexedDB flush is all we have */
  }
}

/**
 * Put stashed pages that are newer than `ws`'s copies into `ws`. Returns the ids taken over.
 * A stash from another workspace epoch (erased since) is ignored.
 */
function takeStash(ws: Workspace, stash: Stash, keepDbs?: Set<ID>): { pages: ID[]; dbs: ID[] } {
  const out = { pages: [] as ID[], dbs: [] as ID[] }
  if (stash.epoch !== (ws.epoch ?? LEGACY_EPOCH)) return out
  const now = Date.now()
  for (const [id, v] of Object.entries(stash.pages)) {
    const r = normalizePage(id, v, now)
    if (!r) continue
    const cur = ws.pages[id]
    if (cur && cur.updatedAt >= r.page.updatedAt) continue
    ws.pages[id] = r.page
    out.pages.push(id)
  }
  for (const [id, v] of Object.entries(stash.databases)) {
    if (keepDbs?.has(id)) continue
    const r = normalizeDatabase(id, v, ws.settings.language)
    if (!r) continue
    ws.databases[id] = r.db
    out.dbs.push(id)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

/**
 * Load the stored workspace. Resolves null ONLY when nothing is stored yet (first run, or after
 * an erase); read errors reject, so the caller never seeds over existing data.
 */
export async function loadWorkspace(): Promise<Workspace | null> {
  const raw: unknown = await idbGet(KEY)
  if (raw === undefined) {
    // stashed edits belong to a workspace that no longer exists
    localRemove(UNSAVED_KEY)
    // the caller seeds: its first save writes the whole workspace
    fullWriteNext = true
    return null
  }
  const { ws, repaired } = migrateWithReport(raw)
  if (repaired) {
    // keep the original before anything is written (a failure here fails the boot: nothing is lost)
    await idbSet(BACKUP_KEY, raw)
    console.warn(`[one] the stored workspace had damaged entries — repaired; the original is kept in IndexedDB under "${BACKUP_KEY}"`)
    fullWriteNext = true
  }
  if (!isObj(raw)) return null // nothing recoverable (backed up above): start fresh

  // edits from the last moments before this tab (or another) went away
  const stashRaw = localGet(UNSAVED_KEY)
  const stash = parseStash(stashRaw)
  if (stash) {
    const taken = takeStash(ws, stash)
    if (taken.pages.length || taken.dbs.length) {
      repairStructure(ws)
      taken.pages.forEach((id) => dirtyPages.add(id))
      taken.dbs.forEach((id) => dirtyDbs.add(id))
      pendingStash = stashRaw
    } else {
      localRemove(UNSAVED_KEY)
    }
  } else if (stashRaw) {
    localRemove(UNSAVED_KEY)
  }
  return ws
}

/** Stored workspace for a sync (errors are the caller's business). */
async function readStored(): Promise<Workspace | null> {
  const raw: unknown = await idbGet(KEY)
  return isObj(raw) ? migrate(raw) : null
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/**
 * Overlay this tab's changes onto the stored workspace. A page another tab stored since our
 * edits started (stored copy ≠ our base) is merged rather than overwritten; `merged` collects
 * those (id → [the copy we wrote, our snapshot copy]).
 */
function overlay(
  stored: Obj,
  snap: Workspace,
  pages: ID[],
  dbs: ID[],
  settingKeys: Array<keyof Settings>,
  people: boolean,
  recent: boolean,
  bases: Map<ID, Page>,
  merged: Map<ID, [Page, Page]>,
): Obj {
  const out: Obj = { ...stored, version: snap.version }
  if (pages.length) {
    const next = { ...(isObj(stored.pages) ? stored.pages : {}) }
    for (const id of pages) {
      const ours = snap.pages[id]
      if (!ours) {
        delete next[id]
        continue
      }
      next[id] = ours
      const base = bases.get(id)
      const theirs = isObj(stored.pages) ? stored.pages[id] : undefined
      if (!base || !isObj(theirs)) continue
      try {
        const t = normalizePage(id, theirs, Date.now())?.page
        if (!t || samePage(t, base)) continue
        const m = mergePage(base, t, ours)
        if (m === ours) continue // theirs adds nothing ours does not have
        next[id] = m
        merged.set(id, [m, ours])
      } catch (e) {
        // never fail a save over a merge: ours wins as before
        console.warn('[one] could not merge concurrent edits of a page', e)
      }
    }
    out.pages = next
  }
  if (dbs.length) {
    const next = { ...(isObj(stored.databases) ? stored.databases : {}) }
    for (const id of dbs) {
      if (snap.databases[id]) next[id] = snap.databases[id]
      else delete next[id]
    }
    out.databases = next
  }
  if (settingKeys.length) {
    const next: Obj = { ...(isObj(stored.settings) ? stored.settings : {}) }
    for (const k of settingKeys) next[k] = snap.settings[k]
    out.settings = next
  }
  if (people) out.people = snap.people
  if (recent) out.recent = snap.recent
  return out
}

let chain: Promise<void> = Promise.resolve()
/** Counts this tab's completed saves. */
let saveGen = 0

/** Saves run one after another in this tab; each one is a single read-modify-write transaction. */
function saveNow(): Promise<void> {
  const run = chain.then(writeChanges)
  chain = run.catch(() => {})
  return run
}

async function writeChanges(): Promise<void> {
  if (!hasDirty()) return
  const pages = [...dirtyPages]
  const dbs = [...dirtyDbs]
  const settingKeys = [...dirtySettings]
  const people = dirtyPeople
  const recent = dirtyRecent
  const full = fullWriteNext
  const stash = pendingStash
  dirtyPages.clear()
  dirtyDbs.clear()
  dirtySettings.clear()
  dirtyPeople = dirtyRecent = fullWriteNext = false
  pages.forEach((id) => inflightPages.add(id))
  dbs.forEach((id) => inflightDbs.add(id))
  settingKeys.forEach((k) => inflightSettings.add(k))
  inflightPeople = people
  inflightRecent = recent
  // the stored copies our edits started from: a different stored copy means another tab wrote
  const bases = new Map<ID, Page>()
  for (const id of pages) {
    const b = syncBase.get(id)
    if (b) bases.set(id, b)
  }
  const merged = new Map<ID, [Page, Page]>()
  let written: Record<ID, Page> = {}
  try {
    setStatus('saving')
    await idbUpdate(KEY, (stored: unknown) => {
      merged.clear()
      const snap = getWorkspaceSnapshot()
      written = snap.pages
      // nothing stored yet (first run, seed) or a repair: the whole snapshot
      if (full || !isObj(stored)) return snap
      return overlay(stored, snap, pages, dbs, settingKeys, people, recent, bases, merged)
    })
    // what is stored now is what this tab's pages descend from
    for (const id of pages) {
      const page = merged.get(id)?.[0] ?? written[id]
      if (page) syncBase.set(id, page)
      else syncBase.delete(id)
    }
    saveGen++
    if (merged.size) adoptMerged(merged)
    retryDelay = 0
    setStatus('saved')
    if (stash) {
      if (localGet(UNSAVED_KEY) === stash) localRemove(UNSAVED_KEY)
      if (pendingStash === stash) pendingStash = null
    }
    channel?.postMessage({ type: 'changed', from: TAB_ID })
  } catch (e) {
    console.error('[one] failed to save workspace', e)
    pages.forEach((id) => dirtyPages.add(id))
    dbs.forEach((id) => dirtyDbs.add(id))
    settingKeys.forEach((k) => dirtySettings.add(k))
    dirtyPeople ||= people
    dirtyRecent ||= recent
    fullWriteNext ||= full
    setStatus('error')
    // try again on our own (1 s, 2 s, 4 s … 30 s) instead of waiting for the next edit
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 1000, RETRY_MAX)
    scheduleSave(retryDelay)
  } finally {
    inflightPages.clear()
    inflightDbs.clear()
    inflightSettings.clear()
    inflightPeople = inflightRecent = false
  }
}

function scheduleSave(delay: number) {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    void saveNow()
  }, delay)
}

/** Force an immediate save (e.g. before unload or after import). */
export function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  return saveNow()
}

/* ------------------------------------------------------------------ */
/* Cross-tab sync                                                      */
/* ------------------------------------------------------------------ */

const sameContent = (a: Page['content'], b: Page['content']) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Prepare a page that comes from another tab: if its content differs from ours it gets a rev
 * above both (revs are per-tab counters and collide) and origin 'sync', so an open editor
 * applies it, or merges it with unsaved typing. Same content → keep our rev, nothing to apply.
 */
function markIncoming(cur: Page | undefined, p: Page) {
  if (!cur || cur === p) return
  if (cur.contentRev === p.contentRev && cur.contentOrigin === p.contentOrigin && cur.updatedAt === p.updatedAt) return
  if (sameContent(cur.content, p.content)) {
    p.contentRev = cur.contentRev
    p.contentOrigin = cur.contentOrigin
    return
  }
  p.contentRev = Math.max(cur.contentRev, p.contentRev) + 1
  p.contentOrigin = 'sync'
}

/**
 * A save merged another tab's edits into pages of ours: show the merged pages here too. A page
 * that changed again since the snapshot gets the other tab's part merged into it as well.
 */
function adoptMerged(merged: Map<ID, [Page, Page]>) {
  const local = useWorkspace.getState()
  let next: Record<ID, Page> | null = null
  for (const [id, [stored, ours]] of merged) {
    const cur = local.pages[id]
    if (!cur) continue // deleted meanwhile: the next save removes it
    const page = { ...(cur === ours ? stored : mergePage(ours, stored, cur)) }
    if (sameContent(cur.content, page.content)) {
      page.contentRev = cur.contentRev
      page.contentOrigin = cur.contentOrigin
    } else {
      // open editors apply it (or merge it with typing they have not handed over yet)
      page.contentRev = cur.contentRev + 1
      page.contentOrigin = 'sync'
    }
    next ??= { ...local.pages }
    next[id] = page
  }
  if (next) applyRemote({ ...getWorkspaceSnapshot(), pages: next })
}

function applyRemote(ws: Workspace) {
  const local = useWorkspace.getState()
  applyingRemote = true
  try {
    local.replaceAll(ws)
  } finally {
    applyingRemote = false
  }
}

/** Start autosave + cross-tab sync. Call once after hydrate(). */
export function startPersistence(): () => void {
  const unsub = useWorkspace.subscribe((state, prev) => {
    if (!state.ready || applyingRemote) return
    if (
      state.pages === prev.pages &&
      state.databases === prev.databases &&
      state.settings === prev.settings &&
      state.people === prev.people &&
      state.recent === prev.recent
    )
      return
    if (state.pages !== prev.pages) {
      for (const id in state.pages) {
        if (state.pages[id] === prev.pages[id]) continue
        dirtyPages.add(id)
        // first change since the page was in sync: remember the copy it started from
        if (!syncBase.has(id) && prev.pages[id]) syncBase.set(id, prev.pages[id])
      }
      for (const id in prev.pages) {
        if (id in state.pages) continue
        dirtyPages.add(id)
        syncBase.delete(id)
      }
    }
    trackDirty(state.databases, prev.databases, dirtyDbs)
    if (state.settings !== prev.settings) {
      for (const k of Object.keys(state.settings) as Array<keyof Settings>) if (state.settings[k] !== prev.settings[k]) dirtySettings.add(k)
    }
    if (state.people !== prev.people) dirtyPeople = true
    if (state.recent !== prev.recent) dirtyRecent = true
    scheduleSave(SAVE_DELAY)
  })

  const onMessage = async (ev: MessageEvent) => {
    if (ev.data?.type !== 'changed' || ev.data.from === TAB_ID) return
    let ws: Workspace | null
    try {
      // a save of ours that finished while we were reading: read again, or our older stored
      // copy would replace what we just wrote
      for (let i = 0; ; i++) {
        const gen = saveGen
        ws = await readStored()
        if (gen === saveGen || i >= 3) break
      }
    } catch (e) {
      console.warn('[one] could not read the workspace another tab saved', e)
      return
    }
    if (!ws) return
    const local = useWorkspace.getState()
    // keep this tab's unsaved (and in-flight) changes
    for (const id of new Set([...dirtyPages, ...inflightPages])) {
      if (local.pages[id]) ws.pages[id] = local.pages[id]
      else delete ws.pages[id]
    }
    for (const id of new Set([...dirtyDbs, ...inflightDbs])) {
      if (local.databases[id]) ws.databases[id] = local.databases[id]
      else delete ws.databases[id]
    }
    const keepSettings = new Set([...dirtySettings, ...inflightSettings])
    if (keepSettings.size) {
      const settings = { ...ws.settings } as Record<keyof Settings, unknown>
      for (const k of keepSettings) settings[k] = local.settings[k]
      ws.settings = settings as unknown as Settings
    }
    if (dirtyPeople || inflightPeople) ws.people = local.people
    if (dirtyRecent || inflightRecent) ws.recent = local.recent
    // pages taken over from storage are in sync again (the next local change sets a new base)
    for (const id of [...syncBase.keys()]) {
      if (!dirtyPages.has(id) && !inflightPages.has(id)) syncBase.delete(id)
    }
    for (const p of Object.values(ws.pages)) markIncoming(local.pages[p.id], p)
    applyRemote(ws)
  }
  channel?.addEventListener('message', onMessage)

  // another tab went away with unsaved edits: take them over right now
  const onStorage = (e: StorageEvent) => {
    if (e.key !== UNSAVED_KEY || !e.newValue) return
    const stash = parseStash(e.newValue)
    if (!stash) return
    const local = useWorkspace.getState()
    const ws = { ...getWorkspaceSnapshot(), pages: { ...local.pages }, databases: { ...local.databases } }
    // databases have no updatedAt: never let a stash override one this tab is still changing
    const taken = takeStash(ws, stash, new Set([...dirtyDbs, ...inflightDbs]))
    if (!taken.pages.length && !taken.dbs.length) return
    for (const id of taken.pages) {
      markIncoming(local.pages[id], ws.pages[id])
      // the other tab's last copy replaces ours as it is (no merge base)
      syncBase.delete(id)
    }
    applyRemote(ws)
    taken.pages.forEach((id) => dirtyPages.add(id))
    taken.dbs.forEach((id) => dirtyDbs.add(id))
    pendingStash = e.newValue
    scheduleSave(0)
  }
  window.addEventListener('storage', onStorage)

  // Leaving: put open editors' text into the store (their own listeners usually ran already),
  // mirror what is unsaved to localStorage synchronously, then start the IndexedDB write.
  const flushEditors = () => {
    try {
      ;(window as Window & { __oneEditorUnload?: () => void }).__oneEditorUnload?.()
    } catch {
      /* an editor failing to flush must not stop the save */
    }
  }
  const onLeave = () => {
    flushEditors()
    stashUnsaved()
    if (hasDirty()) void flushSave()
  }
  // Hidden (tab switch, app switch on phones, often the last event before a kill): our listener
  // runs before the editors' own, so give them a tick to put their text into the store first.
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') return
    window.setTimeout(() => {
      if (!hasDirty()) return
      stashUnsaved()
      void flushSave()
    }, 0)
  }
  window.addEventListener('beforeunload', onLeave)
  window.addEventListener('pagehide', onLeave)
  document.addEventListener('visibilitychange', onVisibility)

  // edits restored from a stash, or a repaired workspace: write them now
  if (hasDirty()) scheduleSave(0)

  return () => {
    unsub()
    channel?.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('beforeunload', onLeave)
    window.removeEventListener('pagehide', onLeave)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
