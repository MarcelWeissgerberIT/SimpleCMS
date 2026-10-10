/**
 * IndexedDB persistence + live cross-tab sync.
 *
 * - Storage layout (v2, idb-keyval's "keyval-store"): one record per page (`one.page.v2:<id>`) and
 *   per database (`one.db.v2:<id>`), plus `one.ws.v2` for the rest (version, epoch, settings,
 *   people, recent). A save costs what changed, not the workspace: typing on one page writes that
 *   page. The single-record layout of older versions (`one.workspace.v1`) is read once and
 *   converted (the first save writes every record and removes the old one).
 * - Saves are debounced and read-modify-write: a tab only writes what IT changed (dirty pages /
 *   databases / settings keys / people / recent) on top of what is stored, inside one IndexedDB
 *   transaction, so two tabs never clobber each other.
 * - Other tabs hear about a save via BroadcastChannel — with the ids it wrote — and read just those
 *   records, keeping their own unsaved changes. Pages that changed elsewhere get a fresh contentRev
 *   + origin 'sync', so open editors always apply (or merge) them.
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
 * - Older builds (a tab of One opened before an update, same browser): they lose node types they don't
 *   know (store/generations.ts — the editor unwraps a task into its blocks) and store that. So every page
 *   record this build writes carries a stamp (`_schema`: { g: its generation, f: the fingerprint of the
 *   content written }) — an older build copies the stamp along with the record (its own cross-tab merge even
 *   takes the newer side's stamp), so it counts only for content with that very fingerprint. A page holding
 *   newer nodes also gets a shadow copy (`one.page.g<n>:<id>`, a key older builds never touch). A record
 *   without a valid stamp (an older writer) that lacks newer nodes its shadow (or this tab's copy) has gets
 *   them back around what is left of their blocks (rewrapNewer: the older tab's edits kept, inside a task
 *   too; the stale copy of our blocks its own merge keeps is ours, wroteHere) — at boot, from another tab's
 *   save, from its stash, and before a save merges. A node none of whose blocks is left there (deleted), and
 *   every one when it replaced the page as a whole (a restore, an import: REPLACING), stays gone; the version
 *   that had it goes to the page's history (onReplacedByOlder). Shadows of pages an older build deleted go too.
 *   What this costs a save or a boot when no older build wrote anything: one hash per content object (cached),
 *   the shadow copies' keys (a shadow's content is read only where a record's stamp does not fit), and a shadow
 *   deleted only where one may be stored (mayShadow).
 */
import { createStore, type UseStore } from 'idb-keyval'
import { useWorkspace, getWorkspaceSnapshot, emptyWorkspace, pageChanges, WORKSPACE_VERSION, defaultSettings, defaultView, DEFAULT_PAGE_SETTINGS } from './store'
import type { Database, ID, Page, PropertyDef, Settings, Workspace } from './types'
import { sanitizePropFlags } from './keys'
import { newId } from '../lib/ids'
import { isSecretMarker } from '../lib/vault'
import { mergePage, samePage } from './merge'
import { LOCAL_SCOPE, sealStoredAIKey, setStoredKeyMigration } from './secrets'
import { sanitizeFunctions } from './functions'
import { sanitizeAgents } from './agents'
import { sanitizeIntegrations } from './integrations'
import { sanitizeScripts } from './scripts'
import { sanitizeKit } from './kit'
import { sanitizeLook } from './look'
import { contentFingerprint, DOC_SCHEMA_VERSION, newerBlockPrints, newerCounts, rewrapNewer } from './generations'
import { plainText } from './plain'

/** The single-record layout before v2 (read once, then converted). */
const LEGACY_KEY = 'one.workspace.v1'
const BACKUP_KEY = 'one.workspace.v1.bak'
/** v2: everything but pages and databases */
const META_KEY = 'one.ws.v2'
const PAGE_PREFIX = 'one.page.v2:'
const DB_PREFIX = 'one.db.v2:'
/** This build's copy of a page that holds node types older builds don't know (outside their key ranges). */
const SHADOW_PREFIX = `one.page.g${DOC_SCHEMA_VERSION}:`
/** The stamp on every page record this build writes: { g: generation, f: the fingerprint of the content written }. */
const STAMP = '_schema'
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
  // the generation stamp belongs to the stored record, not to the page (writerGen reads it there)
  delete (p as unknown as Obj)[STAMP]
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

/* ------------------------------------------------------------------ */
/* Older builds (store/generations.ts)                                 */
/* ------------------------------------------------------------------ */

/** Fingerprints of content objects (the store's are never changed in place): a page saved again is not hashed again. */
const fingerprints = new WeakMap<object, number>()
function fingerprint(content: Page['content']): number {
  if (!content) return contentFingerprint(content)
  let f = fingerprints.get(content)
  if (f === undefined) fingerprints.set(content, (f = contentFingerprint(content)))
  return f
}

/** A page as this build stores it: with the stamp of its generation, bound to exactly this content. */
const stamped = (p: Page): Obj => ({ ...p, [STAMP]: { g: DOC_SCHEMA_VERSION, f: fingerprint(p.content) } })

/**
 * The generation of the build that wrote this stored page: its stamp — when it belongs to this very content (an
 * older build carries a stamp it read along, or takes the newer side's in its own merge, but its own writes
 * change the content). 0: an older build.
 */
function writerGen(raw: unknown): number {
  if (!isObj(raw) || !isObj(raw[STAMP])) return 0
  const s = raw[STAMP] as Obj
  return isNum(s.g) && isNum(s.f) && s.f === fingerprint(isObj(raw.content) ? (raw.content as Page['content']) : null) ? s.g : 0
}

const newerHeld = new WeakMap<object, boolean>()
/** Does this content hold nodes an older build would lose (it needs a shadow copy)? Walked once per content object. */
function holdsNewer(content: Page['content'] | undefined): boolean {
  if (!content) return false
  let v = newerHeld.get(content)
  if (v === undefined) newerHeld.set(content, (v = newerCounts(content, 0).size > 0))
  return v
}

/** Origins an older build writes a page's content with as a whole (a version restored, a backup, an import). */
const REPLACING = new Set(['history', 'import'])

/**
 * The recent versions of pages holding tasks that this generation stored — this tab's saves and the ones it read
 * from other tabs of this version (page → the contents, oldest first). An older tab saving with typing of its own
 * merges our copy in but keeps ITS stale version of every task's blocks (to it the unwrapped task is a change of its
 * own): a block that comes back as in one of these is ours, not an edit made there. Kept as they are (the store's
 * own objects): their blocks' prints are worked out only once an older build's copy turns up (`wroteOf`).
 */
const wroteHere = new Map<ID, { versions: NonNullable<Page['content']>[]; prints: Set<number> | null }>()
/** Versions kept per page: the stale copy an older tab's merge keeps is one of the last few stored. */
const WROTE_VERSIONS = 6

function noteWritten(p: Page, newer = holdsNewer(p.content)) {
  if (!newer || !p.content) return
  const w = wroteHere.get(p.id) ?? { versions: [], prints: null }
  if (w.versions[w.versions.length - 1] === p.content) return
  w.versions.push(p.content)
  if (w.versions.length > WROTE_VERSIONS) w.versions.shift()
  w.prints = null
  wroteHere.set(p.id, w)
}

/** The prints of the blocks inside tasks in the versions of a page this generation stored (newerBlockPrints). */
function wroteOf(id: ID): Set<number> | undefined {
  const w = wroteHere.get(id)
  if (!w) return undefined
  if (!w.prints) {
    w.prints = new Set()
    for (const content of w.versions) for (const print of newerBlockPrints(content)) w.prints.add(print)
  }
  return w.prints
}

/** A version of a page from before an older build of One replaced it (what it had that the older copy let go). */
export interface ReplacedByOlder {
  pageId: ID
  content: Page['content']
  title: string
  icon: Page['icon']
}
const replacedQueue: ReplacedByOlder[] = []
const replacedListeners = new Set<(v: ReplacedByOlder) => void>()

/**
 * Versions this build had of pages an older build changed so that a node it could not read is gone (none of a
 * task's blocks left there: the person deleted them, or the page was replaced — a restore, an import). The page
 * history keeps them (features/history); ones found before anybody listens (at boot) are handed over then.
 */
export function onReplacedByOlder(fn: (v: ReplacedByOlder) => void): () => void {
  replacedListeners.add(fn)
  for (const v of replacedQueue.splice(0)) fn(v)
  return () => replacedListeners.delete(fn)
}

function keepReplaced(page: Page, content: Page['content']) {
  const v: ReplacedByOlder = { pageId: page.id, content, title: page.title, icon: page.icon }
  if (replacedListeners.size) replacedListeners.forEach((fn) => fn(v))
  else if (replacedQueue.push(v) > 200) replacedQueue.shift()
}

/**
 * A page an older build may have written: its content with every newer node of `known` (what a build
 * of this generation stored or holds) wrapped again around what is left of its blocks — the older build's own
 * edits kept (rewrapNewer). A node with nothing left there stays gone, and so does every one when the older build
 * replaced the content as a whole (a restore, an import); `known` then goes to the page's history (titled as
 * `cur`, this build's copy of the page, has it). The page as it is when nothing was lost (or a current build wrote
 * it); a copy when only something stayed gone, so the caller stores it again (stamped: never checked twice). `genOf`:
 * the generation of the build that wrote `page` (writerGen of its stored record — asked only when `known` has tasks).
 */
function guardOlder(page: Page, genOf: () => number, known: Page['content'] | undefined, cur?: Page): Page {
  if (!known || !holdsNewer(known)) return page
  const gen = genOf()
  if (gen >= DOC_SCHEMA_VERSION) return page
  try {
    const prints = wroteOf(page.id)
    const wrote = prints && ((print: number) => prints.has(print))
    const { doc, dropped } = rewrapNewer(known, page.content, gen, { whole: REPLACING.has(page.contentOrigin ?? ''), wrote })
    if (dropped.length) keepReplaced(cur ?? page, known)
    if (doc === page.content) return dropped.length ? { ...page } : page
    return { ...page, content: doc, plain: plainText(doc) }
  } catch (e) {
    console.warn('[one] could not merge a page an older version of One stored', e)
    return page
  }
}

/**
 * Pages whose shadow copy may be stored: the shadow keys read at boot (and with another tab's full write), this tab's
 * shadow writes, and every page another tab saved since (its message, heard from the start). A save of a page without
 * newer nodes deletes a shadow copy only there — and for every page while that is not known (before the boot read;
 * after another tab's full write until it was read).
 */
const mayShadow = new Set<ID>()
let shadowsKnown = false
/** Full writes other tabs told of. */
let fullWrites = 0

function noteShadows(ids: ID[], fullsBefore: number): void {
  for (const id of ids) mayShadow.add(id)
  if (fullWrites === fullsBefore) shadowsKnown = true
}

/** Shadow copies of pages whose record is gone (an older build deleted the page for good) — dropped while still so. */
function dropOrphanShadows(ids: ID[]): void {
  if (!ids.length) return
  void inTx<void>('readwrite', (os) => {
    for (const id of ids) {
      const r = os.get(PAGE_PREFIX + id)
      r.onsuccess = () => {
        if (r.result === undefined) os.delete(SHADOW_PREFIX + id)
      }
    }
  }).catch((e) => console.warn('[one] could not drop a shadow copy', e))
}

const shadowContent = (v: unknown): Page['content'] | undefined => (isObj(v) && isObj(v.content) ? (v.content as Page['content']) : undefined)

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
  // row keys / "Only by hand" (keys.ts): only where they fit
  db.properties = sanitizePropFlags(props)
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
  // custom functions: plain data, checked like everything else that comes from storage
  const fns = sanitizeFunctions(src.functions)
  ws.functions = fns.functions
  if (fns.dropped) repaired = true
  // custom agents: the same (store/agents.ts)
  const ags = sanitizeAgents(src.agents)
  ws.agents = ags.agents
  if (ags.dropped) repaired = true
  // scripts: the same (store/scripts.ts)
  const scs = sanitizeScripts(src.scripts)
  ws.scripts = scs.scripts
  if (scs.dropped) repaired = true
  // building blocks: the same (store/kit.ts)
  const kit = sanitizeKit(src.kit)
  ws.kit = kit.kit
  if (kit.dropped) repaired = true
  // integration profiles: the same (store/integrations.ts)
  const ints = sanitizeIntegrations(src.integrations)
  ws.integrations = ints.integrations
  if (ints.dropped) repaired = true
  // the look: the raw value never stays (a broken one is dropped; the standard look is no value)
  delete ws.look
  const look = sanitizeLook(src.look)
  if (look) ws.look = look
  else if (src.look !== undefined && src.look !== null && !isObj(src.look)) repaired = true

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

/**
 * Run `fn` as a change that did not originate here: automations, webhooks, AI autofill and version
 * history ignore it (they read isApplyingRemote()). The cloud binding applies server changes with it.
 */
export function runAsRemote<T>(fn: () => T): T {
  const was = applyingRemote
  applyingRemote = true
  try {
    return fn()
  } finally {
    applyingRemote = was
  }
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
let dirtyFunctions = false
let dirtyAgents = false
let dirtyScripts = false
let dirtyKit = false
let dirtyLook = false
let dirtyIntegrations = false
/** Pages were added or removed: the meta record's page order is rewritten with the next save. */
let dirtyOrder = false
/** Being written right now (a sync must not replace them with the older stored copy). */
const inflightPages = new Set<ID>()
const inflightDbs = new Set<ID>()
const inflightSettings = new Set<keyof Settings>()
let inflightPeople = false
let inflightRecent = false
let inflightFunctions = false
let inflightAgents = false
let inflightScripts = false
let inflightKit = false
let inflightLook = false
let inflightIntegrations = false

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
  return fullWriteNext || dirtyPages.size > 0 || dirtyDbs.size > 0 || dirtySettings.size > 0 || dirtyPeople || dirtyRecent || dirtyFunctions || dirtyAgents || dirtyScripts || dirtyKit || dirtyLook || dirtyIntegrations
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
    if (p && !(stash.pages[id]?.updatedAt > p.updatedAt)) stash.pages[id] = stamped(p) as unknown as Page
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
    // a stash an older build left: what it could not read comes back from our copy
    ws.pages[id] = guardOlder(r.page, () => writerGen(v), cur?.content, cur)
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
/* Records (IndexedDB)                                                 */
/* ------------------------------------------------------------------ */

let kvStore: UseStore | null = null
/** idb-keyval's default database and store (where the workspace always lived). */
const kv = (): UseStore => (kvStore ??= createStore('keyval-store', 'keyval'))
const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)

/**
 * One transaction: `fn` issues its requests (chained through their success callbacks) and leaves
 * its result in `out.value`; resolves once the transaction completed, rejects if it aborted.
 */
function inTx<T>(mode: IDBTransactionMode, fn: (os: IDBObjectStore, out: { value?: T }) => void): Promise<T> {
  return kv()(
    mode,
    (os) =>
      new Promise<T>((resolve, reject) => {
        const tx = os.transaction
        const out: { value?: T } = {}
        tx.oncomplete = () => resolve(out.value as T)
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
        fn(os, out)
      }),
  )
}

/** Records under `prefix` as a map id → value (keys and values come back in the same order). */
function zip(prefix: string, keys: IDBValidKey[], values: unknown[]): Obj {
  const out: Obj = {}
  keys.forEach((k, i) => (out[String(k).slice(prefix.length)] = values[i]))
  return out
}

interface StoredRaw {
  /** the workspace as stored: { version, epoch, settings, people, recent, pages, databases } */
  raw: unknown
  /** the pages with a shadow copy of this generation (only their keys: a value is read when a stamp fails, readShadows) */
  shadowIds: ID[]
  /** stored in the single-record layout of older versions */
  legacy: boolean
  /** v2 records without their meta record (damage) */
  noMeta: boolean
}

/** Everything stored (v2 records, else the legacy record), or null when nothing is stored. */
function readAll(): Promise<StoredRaw | null> {
  return inTx<StoredRaw | null>('readonly', (os, out) => {
    const meta = os.get(META_KEY)
    const pk = os.getAllKeys(prefixRange(PAGE_PREFIX))
    const pv = os.getAll(prefixRange(PAGE_PREFIX))
    const dk = os.getAllKeys(prefixRange(DB_PREFIX))
    const dv = os.getAll(prefixRange(DB_PREFIX))
    const sk = os.getAllKeys(prefixRange(SHADOW_PREFIX))
    // requests of a transaction complete in order: the last one sees every result
    sk.onsuccess = () => {
      if (meta.result === undefined && !pk.result.length && !dk.result.length) {
        const legacy = os.get(LEGACY_KEY)
        legacy.onsuccess = () => (out.value = legacy.result === undefined ? null : { raw: legacy.result, shadowIds: [], legacy: true, noMeta: false })
        return
      }
      const { order, ...m }: Obj = isObj(meta.result) ? meta.result : {}
      const pages = inOrder(zip(PAGE_PREFIX, pk.result, pv.result), order)
      const databases = inOrder(zip(DB_PREFIX, dk.result, dv.result), Object.keys(pages))
      const shadowIds = sk.result.map((k) => String(k).slice(SHADOW_PREFIX.length))
      out.value = { raw: { ...m, pages, databases }, shadowIds, legacy: false, noMeta: !isObj(meta.result) }
    }
  })
}

/** These pages' shadow copies (id → { content }; undefined = none stored any more). */
function readShadows(ids: ID[]): Promise<Map<ID, unknown>> {
  return inTx('readonly', (os, out) => {
    const res = new Map<ID, unknown>()
    out.value = res
    for (const id of ids) {
      const r = os.get(SHADOW_PREFIX + id)
      r.onsuccess = () => res.set(id, r.result)
    }
  })
}

interface SomeRecords {
  pages: Map<ID, unknown>
  /** pages with a shadow copy stored */
  shadowed: Set<ID>
  /** the shadow copies read: only where the record's stamp does not fit its content */
  shadows: Map<ID, unknown>
  /** the writer's generation of the records checked for that (writerGen) */
  gens: Map<ID, number>
  dbs: Map<ID, unknown>
  meta: unknown
}

/** Some records (another tab saved them): undefined = not stored (deleted). */
function readSome(pageIds: ID[], dbIds: ID[], meta: boolean): Promise<SomeRecords> {
  return inTx('readonly', (os, out) => {
    const res: SomeRecords = { pages: new Map(), shadowed: new Set(), shadows: new Map(), gens: new Map(), dbs: new Map(), meta: undefined }
    out.value = res
    for (const id of pageIds) {
      const r = os.get(PAGE_PREFIX + id)
      r.onsuccess = () => res.pages.set(id, r.result)
      const key = os.getKey(SHADOW_PREFIX + id)
      key.onsuccess = () => {
        if (key.result === undefined) return
        res.shadowed.add(id)
        // the record gone (an orphan), or stamped by this generation for this very content: the shadow copy has
        // nothing to tell
        if (r.result === undefined) return
        const gen = writerGen(r.result)
        res.gens.set(id, gen)
        if (gen >= DOC_SCHEMA_VERSION) return
        const sh = os.get(SHADOW_PREFIX + id)
        sh.onsuccess = () => res.shadows.set(id, sh.result)
      }
    }
    for (const id of dbIds) {
      const r = os.get(DB_PREFIX + id)
      r.onsuccess = () => res.dbs.set(id, r.result)
    }
    if (meta) {
      const r = os.get(META_KEY)
      r.onsuccess = () => (res.meta = r.result)
    }
  })
}

/**
 * The meta record. `order`: the page ids in the store's order — a map loaded from records would
 * otherwise come back sorted by id, and code that walks the page map (first match by title, ties
 * in sorted lists, graph layout) sees the order it always saw.
 */
const metaOf = (ws: Workspace) => ({ version: ws.version, epoch: ws.epoch, settings: ws.settings, people: ws.people, recent: ws.recent, functions: ws.functions ?? {}, agents: ws.agents ?? {}, scripts: ws.scripts ?? {}, kit: ws.kit, look: ws.look ?? null, integrations: ws.integrations ?? [], order: Object.keys(ws.pages) })

/** Records (id → value) in the stored page order; ids the order does not know follow by creation time. */
function inOrder(records: Obj, order: unknown): Obj {
  const out: Obj = {}
  if (Array.isArray(order)) for (const id of order) if (typeof id === 'string' && id in records && !(id in out)) out[id] = records[id]
  const created = (id: string) => (isObj(records[id]) && isNum(records[id].createdAt) ? records[id].createdAt : 0)
  const rest = Object.keys(records).filter((id) => !(id in out))
  rest.sort((a, b) => created(a) - created(b) || (a < b ? -1 : a > b ? 1 : 0))
  for (const id of rest) out[id] = records[id]
  return out
}

/**
 * The stored local workspace as raw data (v2 records assembled, or the legacy record) for readers
 * outside this tab's store (team cloud: upload, settings, device cleanup). Pass it through migrate().
 */
export async function readStoredWorkspace(): Promise<unknown> {
  return (await readAll())?.raw
}

/* ------------------------------------------------------------------ */
/* The Claude API key at rest (store/secrets.ts)                        */
/* ------------------------------------------------------------------ */

/** The Claude API key a raw stored record holds in plaintext (an older version), or null. */
function plainKeyIn(rec: unknown): string | null {
  const k = isObj(rec) && isObj(rec.settings) ? rec.settings.aiApiKey : null
  return typeof k === 'string' && k.trim() && !isSecretMarker(k.trim()) ? k : null
}

const withKey = (rec: Obj, aiApiKey: string): Obj => ({ ...rec, settings: { ...(rec.settings as Obj), aiApiKey } })

/**
 * The local workspace's Claude API key, stored in plaintext by an older version: sealed into the
 * vault and replaced by its marker where it is stored. Copies (an unconverted older record next to
 * the v2 records, the repair copy) just lose it. Compare-and-swap: a record another tab changed in
 * between is left for the next start. Resolves the marker, or null (nothing to do, or it could not
 * be encrypted — then the plaintext stays as it was). Runs at every start (secrets.ts checkAIKey).
 */
export async function sealStoredKey(): Promise<string | null> {
  const read = (key: string) =>
    inTx<unknown>('readonly', (os, out) => {
      const r = os.get(key)
      r.onsuccess = () => (out.value = r.result)
    })
  const swap = (key: string, from: string, to: string) =>
    inTx<void>('readwrite', (os) => {
      const r = os.get(key)
      r.onsuccess = () => {
        if (plainKeyIn(r.result) === from) os.put(withKey(r.result as Obj, to), key)
      }
    })
  const [meta, legacy, backup] = await Promise.all([read(META_KEY), read(LEGACY_KEY), read(BACKUP_KEY)])
  // the workspace's own record: the v2 meta record, else the single record of older versions
  const main = isObj(meta) ? META_KEY : LEGACY_KEY
  const key = plainKeyIn(main === META_KEY ? meta : legacy)
  let marker: string | null = null
  if (key) {
    marker = await sealStoredAIKey(key.trim(), LOCAL_SCOPE)
    if (marker) await swap(main, key, marker)
  }
  for (const [k, rec] of [
    [LEGACY_KEY, legacy],
    [BACKUP_KEY, backup],
  ] as const) {
    const old = k === main ? null : plainKeyIn(rec)
    if (old) await swap(k, old, '')
  }
  return marker
}

setStoredKeyMigration(sealStoredKey)

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

/**
 * Load the stored workspace. Resolves null ONLY when nothing is stored yet (first run, or after
 * an erase); read errors reject, so the caller never seeds over existing data.
 */
export async function loadWorkspace(): Promise<Workspace | null> {
  const fullsBefore = fullWrites
  const stored = await readAll()
  noteShadows(stored?.shadowIds ?? [], fullsBefore)
  const raw: unknown = stored ? stored.raw : undefined
  if (raw === undefined) {
    // stashed edits belong to a workspace that no longer exists
    localRemove(UNSAVED_KEY)
    // the caller seeds: its first save writes the whole workspace
    fullWriteNext = true
    return null
  }
  const { ws, repaired } = migrateWithReport(raw)
  // pages an older build stored since this generation last did: what it could not read comes back
  const rawPages = isObj(raw) && isObj(raw.pages) ? raw.pages : {}
  const orphans: ID[] = []
  const older: Array<[ID, number]> = []
  for (const id of stored?.shadowIds ?? []) {
    if (!ws.pages[id]) {
      // the page was deleted for good by an older build (its record is gone; an unreadable one keeps its shadow)
      if (rawPages[id] === undefined) orphans.push(id)
      continue
    }
    // stamped by this generation for this very content: nothing lost (its shadow copy is not even read)
    const gen = writerGen(rawPages[id])
    if (gen < DOC_SCHEMA_VERSION) older.push([id, gen])
  }
  const shadows = older.length ? await readShadows(older.map(([id]) => id)) : null
  for (const [id, gen] of older) {
    const page = ws.pages[id]
    const next = guardOlder(page, () => gen, shadowContent(shadows?.get(id)))
    if (next === page) continue
    ws.pages[id] = next
    dirtyPages.add(id)
  }
  dropOrphanShadows(orphans)
  if (repaired) {
    // keep the original before anything is written (a failure here fails the boot: nothing is lost) — but never the API key
    await inTx<void>('readwrite', (os) => void os.put(plainKeyIn(raw) !== null ? withKey(raw as Obj, '') : raw, BACKUP_KEY))
    console.warn(`[one] the stored workspace had damaged entries — repaired; the original is kept in IndexedDB under "${BACKUP_KEY}"`)
    fullWriteNext = true
  }
  // the older single-record layout (or records without their meta): the first save writes every record
  if (stored?.legacy || stored?.noMeta) fullWriteNext = true
  if (!isObj(raw)) return null // nothing recoverable (backed up above): start fresh
  // a Claude API key an older version stored in plaintext: into the vault, its marker in its place
  if (plainKeyIn(raw) !== null) {
    const marker = await sealStoredKey().catch((e) => {
      console.warn('[one] could not migrate the stored Claude API key', e)
      return null
    })
    if (marker) ws.settings.aiApiKey = marker
  }

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
  const fullsBefore = fullWrites
  const stored = await readAll()
  const raw = stored?.raw
  if (!stored || !isObj(raw)) return null
  noteShadows(stored.shadowIds, fullsBefore)
  const ws = migrate(raw)
  const local = useWorkspace.getState().pages
  const rawPages = isObj(raw.pages) ? raw.pages : {}
  const shadowed = new Set(stored.shadowIds)
  // what an older build may have lost — the newer nodes of the shadow copy, else of this tab's copy — counts only
  // where the stored record's stamp does not fit its content
  const older: Array<[ID, number]> = []
  for (const id of Object.keys(ws.pages)) {
    if (!shadowed.has(id) && !holdsNewer(local[id]?.content)) continue
    const gen = writerGen(rawPages[id])
    if (gen < DOC_SCHEMA_VERSION) older.push([id, gen])
  }
  const toRead = older.filter(([id]) => shadowed.has(id)).map(([id]) => id)
  const shadows = toRead.length ? await readShadows(toRead) : null
  for (const [id, gen] of older) {
    const page = ws.pages[id]
    const next = guardOlder(page, () => gen, shadowContent(shadows?.get(id)) ?? local[id]?.content, local[id])
    if (next === page) continue
    ws.pages[id] = next
    restoredHere.add(id)
  }
  for (const id of wroteHere.keys()) if (!ws.pages[id]) wroteHere.delete(id)
  // shadow copies of pages an older build deleted for good (its full write leaves them behind)
  dropOrphanShadows(stored.shadowIds.filter((id) => rawPages[id] === undefined))
  return ws
}

/** What a save tells the other tabs: the records it wrote (`full`: all of them). */
interface ChangedMessage {
  type: 'changed'
  from: string
  full: boolean
  pages: ID[]
  dbs: ID[]
  meta: boolean
}

// heard from the start (before the boot read): a page another tab saved may have a shadow copy now (mayShadow)
channel?.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as Partial<ChangedMessage> | null
  if (msg?.type !== 'changed' || msg.from === TAB_ID) return
  if (!msg.full && Array.isArray(msg.pages) && Array.isArray(msg.dbs)) {
    for (const id of msg.pages) if (typeof id === 'string') mayShadow.add(id)
  } else {
    fullWrites++
    shadowsKnown = false
  }
})

/**
 * This tab's workspace with the records another tab just saved read back in (a page / database
 * not stored any more is gone). Only those records are read: the rest of the store stays as is.
 */
/** Pages a read from another tab's save had to merge back (an older build lost nodes): this tab stores them again. */
const restoredHere = new Set<ID>()

async function readChanged(pageIds: ID[], dbIds: ID[], meta: boolean): Promise<Workspace> {
  const rec = await readSome(pageIds, dbIds, meta)
  const local = useWorkspace.getState()
  const ws: Workspace = { ...getWorkspaceSnapshot(), pages: { ...local.pages }, databases: { ...local.databases } }
  if (meta && isObj(rec.meta)) {
    const m = migrate({ ...rec.meta, pages: {}, databases: {} })
    ws.settings = m.settings
    ws.people = m.people
    ws.recent = m.recent
    ws.functions = m.functions
    ws.agents = m.agents
    ws.scripts = m.scripts
    ws.kit = m.kit
    ws.integrations = m.integrations
    if (m.look) ws.look = m.look
    else delete ws.look
  }
  const now = Date.now()
  const orphans: ID[] = []
  for (const [id, v] of rec.pages) {
    const r = normalizePage(id, v, now)
    if (!r) {
      delete ws.pages[id]
      wroteHere.delete(id)
      // deleted for good there (an older build leaves the shadow copy behind)
      if (v === undefined && rec.shadowed.has(id)) orphans.push(id)
      continue
    }
    let gen = rec.gens.get(id)
    const genOf = () => (gen ??= writerGen(v))
    // saved by an older build (another tab opened before an update): it never takes what it could not read
    const page = guardOlder(r.page, genOf, shadowContent(rec.shadows.get(id)) ?? local.pages[id]?.content, local.pages[id])
    if (page !== r.page) restoredHere.add(id)
    // stored by another tab of this generation: its versions of the tasks' blocks are ours too
    else if (holdsNewer(page.content) && genOf() >= DOC_SCHEMA_VERSION) noteWritten(page, true)
    ws.pages[id] = page
  }
  for (const [id, v] of rec.dbs) {
    const r = normalizeDatabase(id, v, ws.settings.language)
    if (r) ws.databases[id] = r.db
    else delete ws.databases[id]
  }
  dropOrphanShadows(orphans)
  return ws
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/**
 * Our copy of a page to store: when another tab stored a different copy since our edits started
 * (stored copy ≠ our base) the two are merged rather than ours overwriting theirs; `merged`
 * collects those (id → [the copy we wrote, our snapshot copy]).
 */
function pageToWrite(id: ID, ours: Page, base: Page | undefined, theirs: unknown, merged: Map<ID, [Page, Page]>): Page {
  if (!base || !isObj(theirs)) return ours
  try {
    const read = normalizePage(id, theirs, Date.now())?.page
    // nobody stored another copy since our edits started: ours as it is
    if (!read || samePage(read, base)) return ours
    // stored by an older build since: never its loss of what it could not read (our base still has it)
    const t = guardOlder(read, () => writerGen(theirs), base.content, ours)
    if (samePage(t, base)) return ours
    const m = mergePage(base, t, ours)
    if (m === ours) return ours // theirs adds nothing ours does not have
    merged.set(id, [m, ours])
    return m
  } catch (e) {
    // never fail a save over a merge: ours wins as before
    console.warn('[one] could not merge concurrent edits of a page', e)
    return ours
  }
}

interface WriteSet {
  pages: ID[]
  dbs: ID[]
  settingKeys: Array<keyof Settings>
  people: boolean
  recent: boolean
  /** custom functions (kept in the meta record) */
  functions: boolean
  /** custom agents (kept in the meta record) */
  agents: boolean
  /** scripts (kept in the meta record) */
  scripts: boolean
  /** building blocks (kept in the meta record) */
  kit: boolean
  /** the workspace look (kept in the meta record) */
  look: boolean
  /** integration profiles (kept in the meta record) */
  integrations: boolean
  /** pages were added or removed (the meta record keeps their order) */
  order: boolean
  /** every record (first run, a repair, the conversion from the legacy layout) */
  full: boolean
}

/** Run `then` once every request has succeeded (at once when there are none). */
function afterAll(reqs: IDBRequest[], then: () => void) {
  let left = reqs.length
  if (!left) return then()
  for (const r of reqs) r.addEventListener('success', () => --left === 0 && then())
}

/**
 * Write this tab's changes in ONE read-modify-write transaction: read what a merge needs (the meta
 * record, stored copies of pages edited from a known base), then take the store's snapshot and
 * put / delete exactly the changed records. Nothing stored yet (or `full`): every record, and
 * stored keys that are not in the snapshot go. Resolves with the snapshot's pages (what was
 * written, merges aside) and whether that was a full write.
 */
function writeRecords(set: WriteSet, bases: Map<ID, Page>, merged: Map<ID, [Page, Page]>): Promise<{ pages: Record<ID, Page>; full: boolean }> {
  return inTx('readwrite', (os, out) => {
    const theirs = new Map<ID, unknown>()
    const meta = os.get(META_KEY)
    const reads = set.full
      ? []
      : set.pages
          .filter((id) => bases.has(id))
          .map((id) => {
            const r = os.get(PAGE_PREFIX + id)
            r.onsuccess = () => theirs.set(id, r.result)
            return r
          })

    const writeAll = (storedKeys: IDBValidKey[]) => {
      const snap = getWorkspaceSnapshot()
      out.value = { pages: snap.pages, full: true }
      const keep = new Set<string>()
      const put = (key: string, value: unknown) => {
        keep.add(key)
        os.put(value, key)
      }
      for (const [id, p] of Object.entries(snap.pages)) {
        put(PAGE_PREFIX + id, stamped(p))
        const newer = holdsNewer(p.content)
        if (newer) {
          put(SHADOW_PREFIX + id, { content: p.content })
          mayShadow.add(id)
        }
        noteWritten(p, newer)
      }
      for (const id of wroteHere.keys()) if (!snap.pages[id]) wroteHere.delete(id)
      for (const [id, db] of Object.entries(snap.databases)) put(DB_PREFIX + id, db)
      for (const k of storedKeys) if (!keep.has(String(k))) os.delete(k)
      os.put(metaOf(snap), META_KEY)
      os.delete(LEGACY_KEY)
    }

    // a shadow copy goes where one may be stored (a failed save puts its pages back into mayShadow)
    const unshadow = (id: ID) => {
      if (shadowsKnown && !mayShadow.has(id)) return
      os.delete(SHADOW_PREFIX + id)
      mayShadow.delete(id)
    }

    const writeChanged = () => {
      const snap = getWorkspaceSnapshot()
      out.value = { pages: snap.pages, full: false }
      for (const id of set.pages) {
        const ours = snap.pages[id]
        if (!ours) {
          os.delete(PAGE_PREFIX + id)
          unshadow(id)
          wroteHere.delete(id)
          continue
        }
        const page = pageToWrite(id, ours, bases.get(id), theirs.get(id), merged)
        os.put(stamped(page), PAGE_PREFIX + id)
        // the copy an older build's write is checked against (store/generations.ts)
        const newer = holdsNewer(page.content)
        if (newer) {
          os.put({ content: page.content }, SHADOW_PREFIX + id)
          mayShadow.add(id)
        } else unshadow(id)
        noteWritten(page, newer)
      }
      for (const id of set.dbs) {
        const db = snap.databases[id]
        if (db) os.put(db, DB_PREFIX + id)
        else os.delete(DB_PREFIX + id)
      }
      if (set.settingKeys.length || set.people || set.recent || set.functions || set.agents || set.scripts || set.kit || set.look || set.integrations || set.order) {
        const next: Obj = { ...(meta.result as Obj), version: snap.version }
        if (set.order) next.order = Object.keys(snap.pages)
        if (set.settingKeys.length) {
          const settings: Obj = { ...(isObj(next.settings) ? next.settings : snap.settings) }
          for (const k of set.settingKeys) settings[k] = snap.settings[k]
          next.settings = settings
        }
        if (set.people) next.people = snap.people
        if (set.recent) next.recent = snap.recent
        if (set.functions) next.functions = snap.functions ?? {}
        if (set.agents) next.agents = snap.agents ?? {}
        if (set.scripts) next.scripts = snap.scripts ?? {}
        if (set.kit) next.kit = snap.kit
        if (set.look) next.look = snap.look ?? null
        if (set.integrations) next.integrations = snap.integrations ?? []
        os.put(next, META_KEY)
      }
    }

    afterAll([meta, ...reads], () => {
      merged.clear()
      if (!set.full && isObj(meta.result)) return writeChanged()
      const keys = [PAGE_PREFIX, DB_PREFIX, SHADOW_PREFIX].map((prefix) => os.getAllKeys(prefixRange(prefix)))
      afterAll(keys, () => writeAll(keys.flatMap((k) => k.result)))
    })
  })
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
  const functions = dirtyFunctions
  const agents = dirtyAgents
  const scripts = dirtyScripts
  const kit = dirtyKit
  const look = dirtyLook
  const integrations = dirtyIntegrations
  const order = dirtyOrder
  const full = fullWriteNext
  const stash = pendingStash
  dirtyPages.clear()
  dirtyDbs.clear()
  dirtySettings.clear()
  dirtyPeople = dirtyRecent = dirtyFunctions = dirtyAgents = dirtyScripts = dirtyKit = dirtyLook = dirtyIntegrations = dirtyOrder = fullWriteNext = false
  pages.forEach((id) => inflightPages.add(id))
  dbs.forEach((id) => inflightDbs.add(id))
  settingKeys.forEach((k) => inflightSettings.add(k))
  inflightPeople = people
  inflightRecent = recent
  inflightFunctions = functions
  inflightAgents = agents
  inflightScripts = scripts
  inflightKit = kit
  inflightLook = look
  inflightIntegrations = integrations
  // the stored copies our edits started from: a different stored copy means another tab wrote
  const bases = new Map<ID, Page>()
  for (const id of pages) {
    const b = syncBase.get(id)
    if (b) bases.set(id, b)
  }
  const merged = new Map<ID, [Page, Page]>()
  try {
    setStatus('saving')
    // nothing stored yet (first run, seed), a repair or the legacy layout: every record (full)
    const res = await writeRecords({ pages, dbs, settingKeys, people, recent, functions, agents, scripts, kit, look, integrations, order, full }, bases, merged)
    const written = res.pages
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
    // other tabs read just these records (a full write: everything)
    const msg: ChangedMessage = { type: 'changed', from: TAB_ID, full: res.full, pages, dbs, meta: settingKeys.length > 0 || people || recent || functions || agents || scripts || kit || look || integrations }
    channel?.postMessage(msg)
  } catch (e) {
    console.error('[one] failed to save workspace', e)
    pages.forEach((id) => {
      dirtyPages.add(id)
      // a shadow copy it meant to delete may still be there
      mayShadow.add(id)
    })
    dbs.forEach((id) => dirtyDbs.add(id))
    settingKeys.forEach((k) => dirtySettings.add(k))
    dirtyPeople ||= people
    dirtyRecent ||= recent
    dirtyFunctions ||= functions
    dirtyAgents ||= agents
    dirtyScripts ||= scripts
    dirtyKit ||= kit
    dirtyLook ||= look
    dirtyIntegrations ||= integrations
    dirtyOrder ||= order
    fullWriteNext ||= full
    setStatus('error')
    // try again on our own (1 s, 2 s, 4 s … 30 s) instead of waiting for the next edit
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 1000, RETRY_MAX)
    scheduleSave(retryDelay)
  } finally {
    inflightPages.clear()
    inflightDbs.clear()
    inflightSettings.clear()
    inflightPeople = inflightRecent = inflightFunctions = inflightAgents = inflightScripts = inflightKit = inflightLook = inflightIntegrations = false
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
      state.recent === prev.recent &&
      state.functions === prev.functions &&
      state.agents === prev.agents &&
      state.scripts === prev.scripts &&
      state.kit === prev.kit &&
      state.look === prev.look &&
      state.integrations === prev.integrations
    )
      return
    if (state.pages !== prev.pages) {
      const { changed, added, removed } = pageChanges(state.pages, prev.pages)
      if (added.length || removed.length) dirtyOrder = true
      for (const id of changed) {
        dirtyPages.add(id)
        // first change since the page was in sync: remember the copy it started from
        if (!syncBase.has(id) && prev.pages[id]) syncBase.set(id, prev.pages[id])
      }
      for (const id of removed) {
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
    if (state.functions !== prev.functions) dirtyFunctions = true
    if (state.agents !== prev.agents) dirtyAgents = true
    if (state.scripts !== prev.scripts) dirtyScripts = true
    if (state.kit !== prev.kit) dirtyKit = true
    if (state.look !== prev.look) dirtyLook = true
    if (state.integrations !== prev.integrations) dirtyIntegrations = true
    scheduleSave(SAVE_DELAY)
  })

  const onMessage = async (ev: MessageEvent) => {
    const msg = ev.data as Partial<ChangedMessage> | null
    if (msg?.type !== 'changed' || msg.from === TAB_ID) return
    // which records changed (a message without ids — a full write — means: all of them)
    const some = !msg.full && Array.isArray(msg.pages) && Array.isArray(msg.dbs) ? { pages: msg.pages, dbs: msg.dbs, meta: !!msg.meta } : null
    let ws: Workspace | null
    try {
      // a save of ours that finished while we were reading: read again, or our older stored
      // copy would replace what we just wrote
      for (let i = 0; ; i++) {
        const gen = saveGen
        ws = some ? await readChanged(some.pages, some.dbs, some.meta) : await readStored()
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
    if (dirtyFunctions || inflightFunctions) ws.functions = local.functions
    if (dirtyAgents || inflightAgents) ws.agents = local.agents
    if (dirtyScripts || inflightScripts) ws.scripts = local.scripts
    if (dirtyKit || inflightKit) ws.kit = local.kit
    if (dirtyLook || inflightLook) {
      if (local.look) ws.look = local.look
      else delete ws.look
    }
    if (dirtyIntegrations || inflightIntegrations) ws.integrations = local.integrations
    // pages taken over from storage are in sync again (the next local change sets a new base)
    for (const id of [...syncBase.keys()]) {
      if (!dirtyPages.has(id) && !inflightPages.has(id)) syncBase.delete(id)
    }
    if (some) {
      for (const id of some.pages) if (ws.pages[id]) markIncoming(local.pages[id], ws.pages[id])
    } else for (const p of Object.values(ws.pages)) markIncoming(local.pages[p.id], p)
    applyRemote(ws)
    // an older build's save that lost nodes: our merged copy replaces it in storage (and in the other tabs)
    if (restoredHere.size) {
      for (const id of restoredHere) if (ws.pages[id]) dirtyPages.add(id)
      restoredHere.clear()
      scheduleSave(0)
    }
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
