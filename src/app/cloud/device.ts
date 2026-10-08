/**
 * This browser's copies of team workspaces (docs/CLOUD.md § This device's data) — and removing them
 * (shared computers, "remove this workspace's copy"). A copy is:
 *   one:ws:<id>, one:ws:<id>:p:<page>   y-indexeddb databases (meta document + page documents;
 *   one:ws:<id>:u:<user>[:p:<page>]     the private ones too, docs/CLOUD.md § Private pages)
 *   one-cloud / kv                      overlay:<id> (settings incl. the AI key's marker, favourites, recent),
 *                                       content:<id>:<page>, uploads:<id>, purge:<id>, privfiles:<id>
 *   one-files / files                   cached files — only those nothing else in this browser uses
 *   one-history / snapshots             version history of the workspace's pages (idx:<page>, snap:<id>)
 *   one-vault / kv                      sealed secrets of scope cloud:<id> (the AI key, the GitHub token)
 *   localStorage one.shell.visits:cloud:<id>   which pages this device opened, how often (FREQUENT)
 * The team workspace on the server is never touched, nor is the local workspace or anything it uses
 * (a local workspace copied into a team keeps its page and file ids, so those are checked).
 *
 * The open workspace holds connections to its databases, which would block deleting them. So a
 * removal is a flag (localStorage `one.cloud.forget`) that the next boot carries out before any
 * cloud database is opened; the tab reloads into the local workspace. Other tabs that show a
 * workspace going away switch to the local workspace too (BroadcastChannel), letting go of it.
 */
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { createStore, delMany, entries, keys } from 'idb-keyval'
import { deleteFile, FILE_PREFIX } from '../lib/files'
import { lsGet, lsSet, readChoice, readSession, sleep, writeChoice, WS_ID } from './env'
import { allDeviceEntries, dropDeviceKeys } from './local'
import { readStoredWorkspace } from '../store/persistence'
import { clearSecrets } from '../lib/vault'

const FLAG = 'one.cloud.forget'
const CHANNEL = 'one-cloud-forget'
const ALL = '*'
/** BroadcastChannels of one tab hear each other: messages carry the sender. */
const TAB = Math.random().toString(36).slice(2)
const REF_RE = /onefile:([A-Za-z0-9_-]{1,64})/g
/** A workspace's documents: meta, page content, and (`:u:<userId>`) a member's private ones. */
const DOC_DB = /^one:ws:([A-Za-z0-9_-]{8,64})(?::u:[A-Za-z0-9_-]{8,64})?(?::p:([A-Za-z0-9_-]{1,64}))?$/
const PRIVATE_META_DB = /^one:ws:([A-Za-z0-9_-]{8,64}):u:[A-Za-z0-9_-]{8,64}$/
const KV_KEY = /^(overlay|uploads|purge|content|privfiles):([A-Za-z0-9_-]{8,64})(?::([A-Za-z0-9_-]{1,64}))?$/

function readFlag(): string[] {
  try {
    const v: unknown = JSON.parse(lsGet(FLAG) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && (x === ALL || WS_ID.test(x))) : []
  } catch {
    return []
  }
}

function writeFlag(list: string[]): void {
  lsSet(FLAG, list.length ? JSON.stringify(list) : null)
}

/** This workspace's copy is about to be removed (nothing should be written into it any more). */
export function isForgetting(wsId: string): boolean {
  const flag = readFlag()
  return flag.includes(ALL) || flag.includes(wsId)
}

/** Mark copies for removal: carried out by runPendingForget() at the next boot of any tab. */
export function scheduleForget(which: string[] | 'all'): void {
  const cur = readFlag()
  const next = which === 'all' || cur.includes(ALL) ? [ALL] : [...new Set([...cur, ...which.filter((id) => WS_ID.test(id))])]
  if (!next.length) return
  writeFlag(next)
  // the browser's remembered workspace must not point at a copy that is going away
  const choice = readChoice()
  if (choice.kind === 'cloud' && (next.includes(ALL) || next.includes(choice.id))) writeChoice({ kind: 'local', id: 'local' })
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ ids: next, from: TAB })
    ch.close()
  } catch {
    /* BroadcastChannel unsupported: other tabs notice at their next boot */
  }
}

/** Tabs showing a workspace whose copy goes away leave it (switch to the local workspace). */
export function listenForForget(activeId: () => string | null, leave: () => void): void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (e: MessageEvent<{ ids?: unknown; from?: unknown }>) => {
      const ids = e.data?.ids
      const id = activeId()
      if (e.data?.from === TAB || !id || !Array.isArray(ids)) return
      if (ids.includes(ALL) || ids.includes(id)) leave()
    }
  } catch {
    /* unsupported */
  }
}

/**
 * Carry out waiting removals (boot, before any cloud database is opened). Waits at most `waitMs`:
 * a database another tab still holds open is deleted once that tab lets go (the flag stays until then).
 */
export async function runPendingForget(waitMs = 5000): Promise<void> {
  const flag = readFlag()
  if (!flag.length || typeof indexedDB === 'undefined') return
  const job = forget(flag).catch((e) => console.warn('[one] removing a team workspace copy failed', e))
  await Promise.race([job, sleep(waitMs)])
}

const asJson = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}

function collectRefs(v: unknown, into: Set<string>): void {
  const json = asJson(v)
  if (!json.includes('onefile:')) return
  for (const m of json.matchAll(REF_RE)) into.add(m[1])
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.deleteDatabase(name)
    } catch {
      return resolve()
    }
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    // blocked: stays queued and completes once the other tab lets go
  })
}

async function forget(flag: string[]): Promise<void> {
  const all = flag.includes(ALL)

  /* ---------------- what this browser holds */
  let dbNames: string[] | null = null
  try {
    if (typeof indexedDB.databases === 'function') dbNames = (await indexedDB.databases()).map((d) => d.name ?? '').filter(Boolean)
  } catch {
    dbNames = null
  }
  const kv = await allDeviceEntries()
  const held = new Set<string>()
  for (const n of dbNames ?? []) {
    const m = DOC_DB.exec(n)
    if (m) held.add(m[1])
  }
  for (const [k] of kv) {
    const m = KV_KEY.exec(k)
    if (m) held.add(m[2])
  }
  const targets = new Set(all ? held : flag.filter((id) => id !== ALL))
  const done = () => writeFlag(readFlag().filter((x) => (x === ALL ? !all : !targets.has(x))))
  // recent / frequent visits of this device (shell/lib/visits.ts): localStorage "one.shell.visits:cloud:<ws>" — before
  // the early return below (nothing else may be left of a copy, its visits still are)
  try {
    for (const k of Object.keys(localStorage)) {
      const m = /^one\.shell\.visits:cloud:([A-Za-z0-9_-]{1,64})$/.exec(k)
      if (m && (all || flag.includes(m[1]))) localStorage.removeItem(k)
    }
  } catch {
    /* blocked storage */
  }
  if (!targets.size) return done()

  /* ---------------- the targets' pages and files; what others here still use */
  const pages = new Set<string>()
  const refs = new Set<string>()
  const keep = new Set<string>()
  const kvDrop: string[] = []
  for (const [k, v] of kv) {
    const m = KV_KEY.exec(k)
    if (!m) continue
    const [, kind, ws, page] = m
    if (targets.has(ws)) {
      kvDrop.push(k)
      if (kind === 'content' && page) pages.add(page)
      collectRefs(v, refs)
    } else if (kind === 'uploads') {
      // another workspace's files that haven't reached its server yet
      for (const item of Array.isArray(v) ? v : []) if (item && typeof (item as { id?: unknown }).id === 'string') keep.add((item as { id: string }).id)
    } else if (kind === 'content') collectRefs(v, keep)
  }
  const docDbs = new Set<string>()
  // without a list of databases: the signed-in member's private documents are the ones there can be
  const uid = readSession()?.user.id
  const metaNames = (ws: string) =>
    dbNames ? dbNames.filter((n) => n === `one:ws:${ws}` || PRIVATE_META_DB.exec(n)?.[1] === ws) : [`one:ws:${ws}`, ...(uid ? [`one:ws:${ws}:u:${uid}`] : [])]
  for (const ws of targets) for (const metaName of metaNames(ws)) {
    docDbs.add(metaName)
    // the meta document: page ids (their documents / history) and files in properties / covers
    const doc = new Y.Doc()
    const idb = new IndexeddbPersistence(metaName, doc)
    try {
      await Promise.race([idb.whenSynced, sleep(4000)])
      for (const id of doc.getMap('pages').keys()) pages.add(id)
      collectRefs(doc.toJSON(), refs)
    } catch {
      /* unreadable: its databases go anyway */
    } finally {
      await idb.destroy().catch(() => {})
      doc.destroy()
    }
  }
  for (const n of dbNames ?? []) {
    const m = DOC_DB.exec(n)
    if (m && targets.has(m[1])) docDbs.add(n)
  }
  if (!dbNames) for (const ws of targets) for (const p of pages) for (const meta of metaNames(ws)) docDbs.add(`${meta}:p:${p}`)

  // the local workspace keeps its pages' history and its files
  const localPages = new Set<string>()
  try {
    const local = (await readStoredWorkspace()) as { pages?: Record<string, unknown> } | undefined
    if (local?.pages) for (const id of Object.keys(local.pages)) localPages.add(id)
    collectRefs(local, keep)
  } catch {
    /* no local workspace */
  }

  /* ---------------- version history of the targets' pages */
  const history = createStore('one-history', 'snapshots')
  const historyDrop: string[] = []
  try {
    const list = await entries<IDBValidKey, unknown>(history)
    const dropSnaps = new Set<string>()
    for (const [k, v] of list) {
      const key = String(k)
      if (!key.startsWith('idx:')) continue
      const pageId = key.slice(4)
      if (!pages.has(pageId) || localPages.has(pageId)) continue
      historyDrop.push(key)
      for (const meta of Array.isArray(v) ? v : []) if (meta && typeof (meta as { id?: unknown }).id === 'string') dropSnaps.add(`snap:${(meta as { id: string }).id}`)
    }
    for (const [k, v] of list) {
      const key = String(k)
      if (!key.startsWith('snap:')) continue
      if (dropSnaps.has(key)) {
        historyDrop.push(key)
        collectRefs(v, refs)
      } else collectRefs(v, keep)
    }
  } catch {
    /* no history */
  }

  /* ---------------- remove */
  await dropDeviceKeys(kvDrop).catch(() => {})
  if (historyDrop.length) await delMany(historyDrop, history).catch(() => {})
  // inbox of this device (features/inbox/state.ts): items, read marks, the last scan
  if (!dbNames || dbNames.includes('one-inbox')) {
    const inboxKeys = [...targets].flatMap((ws) => [`data:cloud:${ws}`, `snap:cloud:${ws}`])
    await delMany(inboxKeys, createStore('one-inbox', 'kv')).catch(() => {})
  }
  // background AI-menu results of this device (features/ai/runs.ts): keys "cloud:<ws>|<runId>"
  if (!dbNames || dbNames.includes('one-ai-runs')) {
    const runs = createStore('one-ai-runs', 'runs')
    const runKeys = (await keys(runs).catch(() => [] as IDBValidKey[])).filter((k) => {
      const m = /^cloud:([^|]+)\|/.exec(String(k))
      return !!m && targets.has(m[1])
    })
    if (runKeys.length) await delMany(runKeys, runs).catch(() => {})
  }
  // script runs and trusted script versions of this device (features/script/runtime/runs.ts): keys "cloud:<ws>|…"
  if (!dbNames || dbNames.includes('one-scripts')) {
    const store = createStore('one-scripts', 'kv')
    const scriptKeys = (await keys(store).catch(() => [] as IDBValidKey[])).filter((k) => {
      const m = /^cloud:([^|]+)\|/.exec(String(k))
      return !!m && targets.has(m[1])
    })
    if (scriptKeys.length) await delMany(scriptKeys, store).catch(() => {})
  }
  // coding pipeline of this device (features/coding/local.ts): logs, run states, trusted task versions — keys "cloud:<ws>|…"
  if (!dbNames || dbNames.includes('one-coding')) {
    const store = createStore('one-coding', 'kv')
    const codingKeys = (await keys(store).catch(() => [] as IDBValidKey[])).filter((k) => {
      const m = /^cloud:([^|]+)\|/.exec(String(k))
      return !!m && targets.has(m[1])
    })
    if (codingKeys.length) await delMany(codingKeys, store).catch(() => {})
  }
  // folder + GitHub sync of this device (features/sync/storage.ts)
  if (!dbNames || dbNames.includes('one-sync')) {
    const syncKeys = [...targets].flatMap((ws) =>
      ['folder', 'manifest:folder', 'manifest:github', 'github', 'status:folder', 'status:github', 'log'].map((k) => `${k}:cloud:${ws}`),
    )
    await delMany(syncKeys, createStore('one-sync', 'kv')).catch(() => {})
  }
  // this device's sealed secrets for them (lib/vault.ts): the AI key, the GitHub token
  await clearSecrets((scope) => scope.startsWith('cloud:') && (all || targets.has(scope.slice(6)))).catch(() => {})
  for (const id of refs) if (!keep.has(id)) await deleteFile(FILE_PREFIX + id).catch(() => {})
  await Promise.all([...docDbs].map(deleteDb))
  done()
}
