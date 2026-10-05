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
 *
 * Private pages (docs/CLOUD.md § Private pages): a second meta document holds this member's private
 * pages (+ their databases and rows). Pages read from it carry `private: true` in the store; writes
 * go to the document that holds the page; a NEW page goes where its parent (or database) lives — a
 * root page where `createPrivatePage()` asked, or its own marker says. A plain store change that would
 * move a page between the two documents (movePage under a page of the other scope) is refused and put
 * back: that is `movePagePrivacy()`'s job (content documents move too).
 */
import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace, type CloudPatch } from '../store/store'
import { runAsRemote } from '../store/persistence'
import type { CustomAgent, CustomFunction, Database, ID, OneScript, Page, Settings } from '../store/types'
import { sameAgent, sanitizeAgent } from '../store/agents'
import { sameScript, sanitizeScript } from '../store/scripts'
import { defaultView } from '../store/store'
import { sharedPlain } from './privacy'
import { LOCAL, newDatabaseMap, newPageMap, readDatabase, readFunctions, readPage, readPeople, roots, writeDatabase, writeFunctions, writePage, writePeople, type YMap } from './schema'

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

/**
 * Who this client's page writes are stamped with (createdBy / updatedBy) while a custom agent applies
 * its changes: `agent:<agentId>` instead of the member's account id (features/agents). Null = the member.
 */
let writeActor: string | null = null
const AGENT_ACTOR = /^agent:[\w-]{1,64}$/
/** Attribute the page writes made while `fn` runs to an agent (`agent:<id>`); other ids are ignored. */
export async function withWriteActor<T>(actor: string, fn: () => Promise<T> | T): Promise<T> {
  if (!AGENT_ACTOR.test(actor)) return fn()
  const prev = writeActor
  writeActor = actor
  try {
    return await fn()
  } finally {
    writeActor = prev
  }
}

/* ------------------------------------------------------------------ custom agents (meta map 'agents') */

/** Agents: one JSON entry per agent (only the ones that changed are written). */
function writeAgents(target: Y.Map<unknown>, next: Record<ID, CustomAgent> | undefined, before: Record<ID, CustomAgent> | undefined): void {
  const prev = before ?? {}
  const cur = next ?? {}
  for (const [id, agent] of Object.entries(cur)) {
    if (prev[id] === agent) continue
    target.set(id, JSON.parse(JSON.stringify(agent)))
  }
  for (const id of Object.keys(prev)) if (!(id in cur)) target.delete(id)
}

/**
 * The store's agents from the meta document, every entry sanitized (store/agents.ts); unchanged ones
 * keep their object, and `cur` itself comes back when nothing changed.
 */
function readAgents(source: Y.Map<unknown>, cur: Record<ID, CustomAgent> | undefined): Record<ID, CustomAgent> {
  const prev = cur ?? {}
  const out: Record<ID, CustomAgent> = {}
  let same = true
  for (const [id, v] of source.entries()) {
    const agent = sanitizeAgent(id, v)
    if (!agent) continue
    if (prev[id] && sameAgent(prev[id], agent) && prev[id].updatedAt === agent.updatedAt) out[id] = prev[id]
    else {
      out[id] = agent
      same = false
    }
  }
  if (Object.keys(prev).some((id) => !(id in out))) same = false
  return same && cur ? cur : out
}

/* ------------------------------------------------------------------ scripts (meta map 'scripts') */

/** Scripts: one JSON entry per script (only the ones that changed are written). */
function writeScripts(target: Y.Map<unknown>, next: Record<ID, OneScript> | undefined, before: Record<ID, OneScript> | undefined): void {
  const prev = before ?? {}
  const cur = next ?? {}
  for (const [id, script] of Object.entries(cur)) {
    if (prev[id] === script) continue
    target.set(id, JSON.parse(JSON.stringify(script)))
  }
  for (const id of Object.keys(prev)) if (!(id in cur)) target.delete(id)
}

/** The store's scripts from the meta document, every entry sanitized (store/scripts.ts); `cur` itself when nothing changed. */
function readScripts(source: Y.Map<unknown>, cur: Record<ID, OneScript> | undefined): Record<ID, OneScript> {
  const prev = cur ?? {}
  const out: Record<ID, OneScript> = {}
  let same = true
  for (const [id, v] of source.entries()) {
    const script = sanitizeScript(id, v)
    if (!script) continue
    if (prev[id] && sameScript(prev[id], script) && prev[id].updatedAt === script.updatedAt) out[id] = prev[id]
    else {
      out[id] = script
      same = false
    }
  }
  if (Object.keys(prev).some((id) => !(id in out))) same = false
  return same && cur ? cur : out
}

/** New pages with these ids are created in the private meta document (createPrivatePage). */
const privateIntents = new Set<ID>()
export function intendPrivate(id: ID): void {
  privateIntents.add(id)
}

export interface BindingOptions {
  doc: Y.Doc
  /** This member's private meta document (null: none — every page is the workspace's). */
  privateDoc: Y.Doc | null
  userId: () => string
  writable: () => boolean
  isFavorite: (id: ID) => boolean
  /**
   * Remote changes: pages that appeared, pages whose updatedAt moved, pages that are gone, pages that
   * moved between Private and the workspace (their content documents change names).
   */
  onRemotePages: (r: { created: ID[]; touched: ID[]; removed: ID[]; rescoped: ID[] }) => void
  /** A local (non-editor) content change to write into the page's content document. */
  bridge: (pageId: ID, base: JSONContent | null, ours: JSONContent | null) => void
  /** Pages removed locally (content documents / caches can go); `private`: where they lived. */
  onLocalRemoved: (removed: Array<{ id: ID; private: boolean }>) => void
  /** Local settings changes (per device; a few keys mirror into the account / workspace). */
  onSettings: (next: Settings, prev: Settings) => void
  /** A viewer changed content locally: put the page's Y content back. */
  revertContent: (pageId: ID) => void
  /** A plain store change tried to move pages between Private and the workspace: refused and put back. */
  onBlockedMove?: (ids: ID[]) => void
  /** Workspace (shared) pages written from this device — they may now reference private uploads. */
  onSharedWrite?: (pages: Page[]) => void
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

type Roots = ReturnType<typeof roots>

const isMap = (v: unknown): v is YMap => v instanceof Y.Map

/**
 * The entry of a page in the two meta documents. In both (a move another device made is half
 * through): the scope the store already shows, else the private one.
 */
function pick(rs: Roots, rq: Roots | null, id: ID, cur: Page | undefined): { yp: YMap; priv: boolean } | null {
  const s = rs.pages.get(id)
  const q = rq?.pages.get(id)
  if (isMap(s) && isMap(q)) return cur && !cur.private ? { yp: s, priv: false } : { yp: q, priv: true }
  if (isMap(q)) return { yp: q, priv: true }
  if (isMap(s)) return { yp: s, priv: false }
  return null
}

/** Without the local `private` marker (or with it). Same object when nothing changes. */
function withScope(p: Page, priv: boolean): Page {
  if (!!p.private === priv) return p
  if (priv) return { ...p, private: true }
  const { private: _p, ...rest } = p
  return rest
}

export interface Binding {
  stop: () => void
  /** Rebuild everything from Y (viewer revert, after a role change). */
  resync: () => void
}

export function startBinding(o: BindingOptions): Binding {
  const rs = roots(o.doc)
  const rq = o.privateDoc ? roots(o.privateDoc) : null
  const dirtyPages = new Set<ID>()
  const dirtyDbs = new Set<ID>()
  let dirtyPeople = false
  let dirtyWorkspace = false
  let dirtyFunctions = false
  const agentsMap = o.doc.getMap<unknown>('agents')
  let dirtyAgents = false
  const scriptsMap = o.doc.getMap<unknown>('scripts')
  let dirtyScripts = false

  /* ---------------------------------------------------------------- Y → store */

  const collect = (target: Y.AbstractType<unknown>, into: Set<ID>) => (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return
    for (const e of events) {
      if (e.target === target) (e as Y.YMapEvent<unknown>).keysChanged.forEach((k) => into.add(k))
      else if (e.path.length) into.add(String(e.path[0]))
    }
  }
  const observed: Array<[Y.AbstractType<unknown>, (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction) => void]> = []
  for (const r of rq ? [rs, rq] : [rs]) {
    const pages = r.pages as unknown as Y.AbstractType<unknown>
    const dbs = r.databases as unknown as Y.AbstractType<unknown>
    observed.push([pages, collect(pages, dirtyPages)], [dbs, collect(dbs, dirtyDbs)])
  }
  for (const [type, fn] of observed) type.observeDeep(fn)
  const onPeople = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyPeople = true
  }
  const onWorkspace = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyWorkspace = true
  }
  const onFunctions = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyFunctions = true
  }
  const onAgents = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyAgents = true
  }
  const onScripts = (_e: unknown, tr: Y.Transaction) => {
    if (tr.origin !== LOCAL) dirtyScripts = true
  }
  rs.people.observe(onPeople)
  rs.workspace.observe(onWorkspace)
  rs.functions.observe(onFunctions)
  agentsMap.observe(onAgents)
  scriptsMap.observe(onScripts)

  function applyRemote(all = false) {
    const s = useWorkspace.getState()
    if (all) {
      for (const r of rq ? [rs, rq] : [rs]) {
        for (const id of r.pages.keys()) dirtyPages.add(id)
        for (const id of r.databases.keys()) dirtyDbs.add(id)
      }
      for (const id of Object.keys(s.pages)) dirtyPages.add(id)
      for (const id of Object.keys(s.databases)) dirtyDbs.add(id)
      dirtyPeople = dirtyWorkspace = dirtyFunctions = dirtyAgents = dirtyScripts = true
    }
    const patch: CloudPatch = {}
    const created: ID[] = []
    const touched: ID[] = []
    const removed: ID[] = []
    const rescoped: ID[] = []
    const nextPages: Record<ID, Page | null> = {}
    for (const id of dirtyPages) {
      const cur = s.pages[id]
      const found = pick(rs, rq, id, cur)
      if (!found) {
        if (cur) {
          nextPages[id] = null
          removed.push(id)
        }
        continue
      }
      const next = readPage(id, found.yp, cur, o.isFavorite(id), found.priv)
      if (next === cur) continue
      nextPages[id] = next
      if (!cur) created.push(id)
      else {
        if (!!next.private !== !!cur.private) rescoped.push(id)
        if (next.updatedAt !== cur.updatedAt) touched.push(id)
      }
    }
    dirtyPages.clear()
    if (Object.keys(nextPages).length) patch.pages = nextPages

    const nextDbs: Record<ID, Database | null> = {}
    for (const id of dirtyDbs) {
      const cur = s.databases[id]
      // a database page keeps a schema in the store while its page exists
      const page = nextPages[id] === undefined ? s.pages[id] : nextPages[id]
      const first = (page?.private ? rq : rs)?.databases.get(id)
      const second = (page?.private ? rs : rq)?.databases.get(id)
      const ydb = isMap(first) ? first : isMap(second) ? second : null
      if (!ydb) {
        if (cur && !(page && page.kind === 'database')) nextDbs[id] = null
        continue
      }
      const next = guardDatabase(readDatabase(id, ydb, cur))
      if (next !== cur) nextDbs[id] = next
    }
    dirtyDbs.clear()
    // database pages without a schema (damaged data): a store-only fallback
    for (const [id, page] of Object.entries(nextPages)) {
      if (page?.kind === 'database' && !s.databases[id] && !nextDbs[id]) nextDbs[id] = fallbackDatabase(id)
    }
    if (Object.keys(nextDbs).length) patch.databases = nextDbs

    if (dirtyPeople) {
      const people = readPeople(rs.people, s.people)
      if (people !== s.people) patch.people = people
      dirtyPeople = false
    }
    if (dirtyWorkspace) {
      const name = rs.workspace.get('name')
      if (typeof name === 'string' && name && name !== s.settings.workspaceName) patch.settings = { workspaceName: name }
      dirtyWorkspace = false
    }
    if (dirtyFunctions) {
      const fns = readFunctions(rs.functions, s.functions)
      if (fns !== s.functions) {
        const next: Record<ID, CustomFunction | null> = {}
        for (const [id, fn] of Object.entries(fns)) if (s.functions?.[id] !== fn) next[id] = fn
        for (const id of Object.keys(s.functions ?? {})) if (!(id in fns)) next[id] = null
        if (Object.keys(next).length) patch.functions = next
      }
      dirtyFunctions = false
    }
    if (dirtyAgents) {
      const agents = readAgents(agentsMap, s.agents)
      if (agents !== s.agents) {
        const next: Record<ID, CustomAgent | null> = {}
        for (const [id, agent] of Object.entries(agents)) if (s.agents?.[id] !== agent) next[id] = agent
        for (const id of Object.keys(s.agents ?? {})) if (!(id in agents)) next[id] = null
        if (Object.keys(next).length) patch.agents = next
      }
      dirtyAgents = false
    }
    if (dirtyScripts) {
      const scripts = readScripts(scriptsMap, s.scripts)
      if (scripts !== s.scripts) {
        const next: Record<ID, OneScript | null> = {}
        for (const [id, script] of Object.entries(scripts)) if (s.scripts?.[id] !== script) next[id] = script
        for (const id of Object.keys(s.scripts ?? {})) if (!(id in scripts)) next[id] = null
        if (Object.keys(next).length) patch.scripts = next
      }
      dirtyScripts = false
    }
    if (!patch.pages && !patch.databases && !patch.people && !patch.settings && !patch.functions && !patch.agents && !patch.scripts) return
    applyFromCloud(() => s.cloudPatch(patch))
    if (created.length || touched.length || removed.length || rescoped.length) o.onRemotePages({ created, touched, removed, rescoped })
  }

  const afterTx = (tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return
    if (dirtyPages.size || dirtyDbs.size || dirtyPeople || dirtyWorkspace || dirtyFunctions || dirtyAgents || dirtyScripts) {
      try {
        applyRemote()
      } catch (e) {
        console.error('[one] could not apply a cloud change', e)
      }
    }
  }
  o.doc.on('afterTransaction', afterTx)
  o.privateDoc?.on('afterTransaction', afterTx)

  /* ---------------------------------------------------------------- store → Y */

  let revertTimer: number | undefined
  const scheduleRevert = () => {
    window.clearTimeout(revertTimer)
    revertTimer = window.setTimeout(() => applyRemote(true), 30)
  }

  /** Where a page's entry is (the store's marker decides while a move is half through). */
  const locate = (id: ID, flag: boolean): Roots | null => {
    const inS = isMap(rs.pages.get(id))
    const inQ = !!rq && isMap(rq.pages.get(id))
    if (inS && inQ) return flag ? rq : rs
    return inQ ? rq : inS ? rs : null
  }
  const locateDb = (id: ID, flag: boolean): Roots | null => {
    const inS = isMap(rs.databases.get(id))
    const inQ = !!rq && isMap(rq.databases.get(id))
    if (inS && inQ) return flag ? rq : rs
    return inQ ? rq : inS ? rs : null
  }
  /** Both documents change in one go (nested transactions, origin 'local'). */
  const transact = (fn: () => void) => o.doc.transact(() => (o.privateDoc ? o.privateDoc.transact(fn, LOCAL) : fn()), LOCAL)

  const unsub = useWorkspace.subscribe((state, prev) => {
    if (applying || !state.ready || !prev.ready) return
    const pagesChanged = state.pages !== prev.pages
    const dbsChanged = state.databases !== prev.databases
    const peopleChanged = state.people !== prev.people
    const functionsChanged = state.functions !== prev.functions
    const agentsChanged = state.agents !== prev.agents
    const scriptsChanged = state.scripts !== prev.scripts
    if (state.settings !== prev.settings) o.onSettings(state.settings, prev.settings)
    if (!pagesChanged && !dbsChanged && !peopleChanged && !functionsChanged && !agentsChanged && !scriptsChanged) return

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

    /** Private here (written there / to be written there): located pages where they are, new ones like their parent. */
    const decided = new Map<ID, boolean>()
    const scopeOf = (id: ID, depth = 0): boolean => {
      const known = decided.get(id)
      if (known !== undefined) return known
      const p = state.pages[id]
      let priv = false
      if (p && depth < 256) {
        const at = locate(id, !!p.private)
        if (at) priv = at === rq
        else {
          const up = p.parentId && state.pages[p.parentId] ? p.parentId : p.databaseId && state.pages[p.databaseId] ? p.databaseId : null
          priv = up ? scopeOf(up, depth + 1) : privateIntents.has(id) || !!p.private
        }
      }
      decided.set(id, priv)
      return priv
    }
    /** Not visible to everyone: private here, or not here at all (someone else's private page, or deleted). */
    const hidden = (id: ID) => !state.pages[id] || !!state.pages[id].private
    /** The meta values a workspace page may carry (no titles of pages others can't see in `plain`). */
    const shareable = (p: Page): Page => {
      const plain = sharedPlain(p, hidden)
      return plain === p.plain ? p : { ...p, plain }
    }

    const uid = writeActor ?? o.userId()
    const bridges: Array<[ID, JSONContent | null, JSONContent | null]> = []
    const removed: Array<{ id: ID; private: boolean }> = []
    const blocked: ID[] = []
    const reflag: Array<[ID, boolean]> = []
    const shared: Page[] = []
    transact(() => {
      if (pagesChanged) {
        for (const id in state.pages) {
          const p = state.pages[id]
          const b = prev.pages[id]
          if (p === b) continue
          const at = locate(id, !!(b ?? p).private)
          if (at) {
            const priv = at === rq
            const parentMoved = !!b && (p.parentId !== b.parentId || p.databaseId !== b.databaseId)
            if (parentMoved) {
              const up = p.parentId && state.pages[p.parentId] ? p.parentId : p.databaseId && state.pages[p.databaseId] ? p.databaseId : null
              // a root page stays where it is; under a page it goes where that page is — another
              // document is a move between Private and the workspace (movePagePrivacy), not this
              if (up && scopeOf(up) !== priv) {
                blocked.push(id)
                continue
              }
            }
            // the marker is the binding's: whoever else changed it gets it put back
            if (!!p.private !== priv) reflag.push([id, priv])
            const yp = at.pages.get(id) as YMap
            if (priv) writePage(yp, p, b ?? EMPTY_PAGE, uid)
            else {
              const out = shareable(p)
              const before = out === p || !b ? (b ?? EMPTY_PAGE) : { ...b, plain: typeof yp.get('plain') === 'string' ? (yp.get('plain') as string) : b.plain }
              writePage(yp, out, before, uid)
              shared.push(p)
            }
          } else {
            const priv = scopeOf(id)
            privateIntents.delete(id)
            const target = priv ? rq : rs
            // a private page without a private document (never happens while one is open): store only
            if (!target) continue
            target.pages.set(id, newPageMap(priv ? p : shareable(p), uid))
            if (!!p.private !== priv) reflag.push([id, priv])
            if (!priv) shared.push(p)
          }
          if (p.content !== (b?.content ?? null) && !(p.content && fromY.has(p.content)) && !(!b && p.content == null)) {
            bridges.push([id, b?.content ?? null, p.content])
          }
        }
        for (const id in prev.pages) {
          if (id in state.pages) continue
          const at = locate(id, !!prev.pages[id].private)
          rs.pages.delete(id)
          rq?.pages.delete(id)
          removed.push({ id, private: at ? at === rq : !!prev.pages[id].private })
        }
      }
      if (dbsChanged) {
        for (const id in state.databases) {
          const db = state.databases[id]
          const b = prev.databases[id]
          if (db === b) continue
          const at = locateDb(id, !!state.pages[id]?.private)
          if (at) writeDatabase(at.databases.get(id) as YMap, db, b ?? EMPTY_DB)
          else {
            const target = state.pages[id] && scopeOf(id) ? rq : rs
            target?.databases.set(id, newDatabaseMap(db))
          }
        }
        for (const id in prev.databases) {
          if (id in state.databases) continue
          rs.databases.delete(id)
          rq?.databases.delete(id)
        }
      }
      if (peopleChanged) writePeople(rs.people, state.people, prev.people)
      if (functionsChanged) writeFunctions(rs.functions, state.functions, prev.functions)
      if (agentsChanged) writeAgents(agentsMap, state.agents, prev.agents)
      if (scriptsChanged) writeScripts(scriptsMap, state.scripts, prev.scripts)
    })
    // Follow-up store patches (the local `private` marker; created_by / last_edited_by mirror the
    // createdBy / updatedBy this client just wrote) go out after every store listener saw this change:
    // patched from inside this listener, the listeners after it (the inbox …) would see the nested,
    // "remote" patch first and take this device's own change for someone else's.
    const touchedIds: ID[] = []
    if (pagesChanged) for (const id in state.pages) if (state.pages[id] !== prev.pages[id]) touchedIds.push(id)
    if (reflag.length || touchedIds.length) {
      queueMicrotask(() => {
        const now = useWorkspace.getState().pages
        const pages: Record<ID, Page> = {}
        for (const [id, priv] of reflag) if (now[id]) pages[id] = withScope(now[id], priv)
        for (const id of touchedIds) {
          const cur = pages[id] ?? now[id]
          const yp = cur ? locate(id, !!cur.private)?.pages.get(id) : undefined
          if (!isMap(yp) || !cur) continue
          const by = (k: string) => (typeof yp.get(k) === 'string' && yp.get(k) ? (yp.get(k) as string) : undefined)
          if (cur.createdBy !== by('createdBy') || cur.updatedBy !== by('updatedBy')) pages[id] = { ...cur, createdBy: by('createdBy'), updatedBy: by('updatedBy') }
        }
        if (Object.keys(pages).length) applyFromCloud(() => useWorkspace.getState().cloudPatch({ pages }))
      })
    }
    if (blocked.length) {
      scheduleRevert()
      o.onBlockedMove?.(blocked)
    }
    for (const [id, base, ours] of bridges) o.bridge(id, base, ours)
    if (removed.length) o.onLocalRemoved(removed)
    if (shared.length) o.onSharedWrite?.(shared)
  })

  // the agents are not part of the boot read (readAll): they come in now, like a remote change
  if (agentsMap.size || Object.keys(useWorkspace.getState().agents ?? {}).length) {
    dirtyAgents = true
    try {
      applyRemote()
    } catch (e) {
      console.error('[one] could not read the agents of the cloud workspace', e)
    }
  }
  // the scripts likewise
  if (scriptsMap.size || Object.keys(useWorkspace.getState().scripts ?? {}).length) {
    dirtyScripts = true
    try {
      applyRemote()
    } catch (e) {
      console.error('[one] could not read the scripts of the cloud workspace', e)
    }
  }

  return {
    stop: () => {
      unsub()
      window.clearTimeout(revertTimer)
      for (const [type, fn] of observed) type.unobserveDeep(fn)
      rs.people.unobserve(onPeople)
      rs.workspace.unobserve(onWorkspace)
      rs.functions.unobserve(onFunctions)
      agentsMap.unobserve(onAgents)
      scriptsMap.unobserve(onScripts)
      o.doc.off('afterTransaction', afterTx)
      o.privateDoc?.off('afterTransaction', afterTx)
    },
    resync: () => applyRemote(true),
  }
}

/* ------------------------------------------------------------------ hydration */

/** Build the store's workspace parts from the meta document (+ this member's private one) at boot. */
export function readAll(
  doc: Y.Doc,
  privateDoc: Y.Doc | null,
  isFavorite: (id: ID) => boolean,
): Pick<CloudPatch, 'people'> & { pages: Record<ID, Page>; databases: Record<ID, Database>; functions: Record<ID, CustomFunction>; name: string | null } {
  const r = roots(doc)
  const q = privateDoc ? roots(privateDoc) : null
  const pages: Record<ID, Page> = {}
  const databases: Record<ID, Database> = {}
  // shared first: a page in both (a move half through) shows as private
  for (const [src, priv] of q ? ([[r, false], [q, true]] as const) : ([[r, false]] as const)) {
    for (const [id, yp] of src.pages.entries()) if (isMap(yp)) pages[id] = readPage(id, yp, undefined, isFavorite(id), priv)
    for (const [id, ydb] of src.databases.entries()) if (isMap(ydb)) databases[id] = guardDatabase(readDatabase(id, ydb, undefined))
  }
  for (const p of Object.values(pages)) if (p.kind === 'database' && !databases[p.id]) databases[p.id] = fallbackDatabase(p.id)
  const name = r.workspace.get('name')
  return { pages, databases, people: readPeople(r.people, []), functions: readFunctions(r.functions, undefined), name: typeof name === 'string' && name ? name : null }
}

/**
 * Pages whose parent (or database) is gone, and parent cycles — both can only come from
 * concurrent edits (a delete racing a move / create). Returns the store updates that repair them.
 * A parent in the other scope (Private vs the workspace — a move racing a create on another device)
 * counts as gone: the page becomes a root page of its own scope.
 */
export function structuralRepairs(pages: Record<ID, Page>, databases: Record<ID, Database>): Array<{ id: ID; patch: Partial<Page> }> {
  const out = new Map<ID, Partial<Page>>()
  const there = (p: Page, id: ID | null) => !!id && !!pages[id] && !!pages[id].private === !!p.private
  for (const p of Object.values(pages)) {
    if (p.databaseId && !(databases[p.databaseId] && there(p, p.databaseId))) out.set(p.id, { databaseId: null, ...(p.parentId === p.databaseId ? { parentId: null } : {}) })
    if (p.parentId && (p.parentId === p.id || !there(p, p.parentId))) out.set(p.id, { ...out.get(p.id), parentId: null })
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

/**
 * unique_id numbers two devices handed out at the same moment (both saw the same nextUniqueId), or
 * from a counter that a concurrent write set back: the row created first keeps its number, later rows
 * get the next free numbers, and nextUniqueId moves past the highest number in use. Deterministic
 * (value, then createdAt, then id), so every device that runs it on the same data writes the same.
 */
export function uniqueIdRepairs(pages: Record<ID, Page>, databases: Record<ID, Database>): { rows: Array<{ id: ID; propId: ID; value: number }>; counters: Array<{ id: ID; next: number }> } {
  const rows: Array<{ id: ID; propId: ID; value: number }> = []
  const counters: Array<{ id: ID; next: number }> = []
  const props = new Map<ID, ID[]>()
  for (const db of Object.values(databases)) {
    const ids = db.properties.filter((p) => p.type === 'unique_id').map((p) => p.id)
    if (ids.length) props.set(db.id, ids)
  }
  if (!props.size) return { rows, counters }
  const byDb = new Map<ID, Page[]>()
  for (const p of Object.values(pages)) {
    if (!p.databaseId || !props.has(p.databaseId)) continue
    const list = byDb.get(p.databaseId)
    if (list) list.push(p)
    else byDb.set(p.databaseId, [p])
  }
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (const [dbId, propIds] of props) {
    const list = byDb.get(dbId) ?? []
    let top = 0
    for (const r of list) for (const pid of propIds) top = Math.max(top, num(r.properties[pid]) ?? 0)
    for (const pid of propIds) {
      const numbered = list.filter((r) => num(r.properties[pid]) !== null)
      numbered.sort((a, b) => (a.properties[pid] as number) - (b.properties[pid] as number) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      let last: number | null = null
      for (const r of numbered) {
        const v = r.properties[pid] as number
        if (v === last) rows.push({ id: r.id, propId: pid, value: ++top })
        else last = v
      }
    }
    const next = databases[dbId].nextUniqueId
    if (!(typeof next === 'number' && next > top)) counters.push({ id: dbId, next: top + 1 })
  }
  return { rows, counters }
}
