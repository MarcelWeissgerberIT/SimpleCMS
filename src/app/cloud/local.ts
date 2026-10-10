/**
 * This device's own data for a cloud workspace (never synced, docs/CLOUD.md § not synced):
 *   overlay:<ws>          settings (theme, language, AI key …), favourites, recent pages,
 *                         pages with local edits the server hasn't confirmed yet
 *   content:<ws>:<page>   the last known content JSON of a page (search/export/graph at boot
 *                         without opening every page document) + the page's updatedAt it matches
 *   held:<ws>:<page>:<rid>
 *                         a non-editor write waiting for the page's first server sync (content.ts) — one
 *                         record per hold: two tabs never write into each other's
 *   uploads:<ws>          files waiting for upload (or for publishing: private uploads, § Private pages)
 *   privfiles:<ws>        files this device uploaded from private pages and hasn't published
 *   purge:<ws>            pages deleted for good (or moved between Private and the workspace) whose
 *                         server document still has to go
 * All in one IndexedDB database ('one-cloud'), separate from the local workspace.
 */
import { createStore, del, delMany, entries, get, promisifyRequest, set, type UseStore } from 'idb-keyval'
import type { JSONContent } from '@tiptap/core'
import type { ID, Settings } from '../store/types'

let kv: UseStore | null = null
function db(): UseStore | null {
  if (!kv && typeof indexedDB !== 'undefined') kv = createStore('one-cloud', 'kv')
  return kv
}

export interface Overlay {
  settings: Settings | null
  favorites: ID[]
  recent: ID[]
  /** Pages whose content has local changes the server hasn't confirmed (synced first after a boot). */
  pending: ID[]
}

export async function loadOverlay(wsId: string): Promise<Overlay | null> {
  const s = db()
  if (!s) return null
  try {
    const v = await get<Overlay>(`overlay:${wsId}`, s)
    if (!v || typeof v !== 'object') return null
    return { settings: v.settings ?? null, favorites: Array.isArray(v.favorites) ? v.favorites : [], recent: Array.isArray(v.recent) ? v.recent : [], pending: Array.isArray(v.pending) ? v.pending : [] }
  } catch {
    return null
  }
}

export async function saveOverlay(wsId: string, o: Overlay): Promise<void> {
  const s = db()
  if (s) await set(`overlay:${wsId}`, o, s)
}

export interface CachedContent {
  json: JSONContent | null
  /** The page's updatedAt (meta document) when this content was known to match the server. 0 = local only. */
  at: number
}

/** Every cached page content of a workspace. */
export async function loadContentCache(wsId: string): Promise<Map<ID, CachedContent>> {
  const out = new Map<ID, CachedContent>()
  const s = db()
  if (!s) return out
  const prefix = `content:${wsId}:`
  try {
    await s('readonly', async (store) => {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
      const [keys, values] = await Promise.all([promisifyRequest(store.getAllKeys(range)), promisifyRequest(store.getAll(range))])
      keys.forEach((k, i) => {
        const v = values[i] as CachedContent | undefined
        if (v && typeof v === 'object') out.set(String(k).slice(prefix.length), v)
      })
    })
  } catch (e) {
    console.warn('[one] cloud content cache unreadable', e)
  }
  return out
}

export function saveContentCache(wsId: string, pageId: ID, v: CachedContent): void {
  const s = db()
  if (s) set(`content:${wsId}:${pageId}`, v, s).catch(() => {})
}

export function dropContentCache(wsId: string, pageId: ID): void {
  const s = db()
  if (s) del(`content:${wsId}:${pageId}`, s).catch(() => {})
}

/**
 * A non-editor content write waiting for its page's first server sync (content.ts `bridgeContent`: written
 * into a copy with nothing in it yet, its text would come twice): merged in then, also after a reload. One record
 * per hold (`held:<ws>:<page>:<rid>`): a tab's later writes to the page fold into its own record, another tab's are
 * records of their own.
 */
export interface HeldWrite {
  base: JSONContent | null
  ours: JSONContent | null
  /** When it was held first: the records of a page are written in this order. */
  at: number
}

export interface HeldRecord extends HeldWrite {
  pageId: ID
  /** The record's own id (its key's last part). */
  rid: string
}

/** Every held record of a workspace (or of one page), in the order they were held. */
export async function loadHeldWrites(wsId: string, pageId?: ID): Promise<HeldRecord[]> {
  const out: HeldRecord[] = []
  const s = db()
  if (!s) return out
  const prefix = pageId ? `held:${wsId}:${pageId}:` : `held:${wsId}:`
  try {
    await s('readonly', async (store) => {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
      const [keys, values] = await Promise.all([promisifyRequest(store.getAllKeys(range)), promisifyRequest(store.getAll(range))])
      keys.forEach((k, i) => {
        const v = values[i] as Partial<HeldWrite> | undefined
        const [page, rid, more] = String(k).slice(`held:${wsId}:`.length).split(':')
        if (!v || typeof v !== 'object' || !('ours' in v) || !page || !rid || more !== undefined) return
        out.push({ pageId: page, rid, base: v.base ?? null, ours: v.ours ?? null, at: typeof v.at === 'number' ? v.at : 0 })
      })
    })
  } catch (e) {
    console.warn('[one] held cloud writes unreadable', e)
  }
  return out.sort((a, b) => a.at - b.at || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0))
}

/** `null`: the write is in (or gone). Resolves once stored (never rejects). */
export function saveHeldWrite(wsId: string, pageId: ID, rid: string, v: HeldWrite | null): Promise<void> {
  const s = db()
  if (!s) return Promise.resolve()
  const key = `held:${wsId}:${pageId}:${rid}`
  return (v ? set(key, { base: v.base, ours: v.ours, at: v.at }, s) : del(key, s)).catch(() => {})
}

/** Every held record of a page goes (the page is gone for good). Resolves once stored (never rejects). */
export function dropHeldWrites(wsId: string, pageId: ID): Promise<void> {
  const s = db()
  if (!s) return Promise.resolve()
  const prefix = `held:${wsId}:${pageId}:`
  return s('readwrite', (store) => {
    store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))
    return promisifyRequest(store.transaction)
  }).catch(() => {})
}

export interface QueuedUpload {
  id: string
  name: string
  tries: number
  /** Uploaded from a private page: only this member may download it (`x-file-scope: private`). */
  private?: boolean
  /** Not an upload: make this member's private file a workspace file (POST …/files/publish). */
  publish?: boolean
}

export async function loadUploads(wsId: string): Promise<QueuedUpload[]> {
  const s = db()
  if (!s) return []
  try {
    const v = await get<QueuedUpload[]>(`uploads:${wsId}`, s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export async function saveUploads(wsId: string, list: QueuedUpload[]): Promise<void> {
  const s = db()
  if (s) await set(`uploads:${wsId}`, list, s)
}

export async function loadPrivateFiles(wsId: string): Promise<string[]> {
  const s = db()
  if (!s) return []
  try {
    const v = await get<string[]>(`privfiles:${wsId}`, s)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function savePrivateFiles(wsId: string, ids: string[]): Promise<void> {
  const s = db()
  // a long-lived list stays small: the newest few thousand are enough to catch a copy & paste
  if (s) await (ids.length ? set(`privfiles:${wsId}`, ids.slice(-5000), s) : del(`privfiles:${wsId}`, s))
}

export interface QueuedPurge {
  pageId: ID
  tries: number
  /** This member's private content document of the page (docs/CLOUD.md § Private pages). */
  private?: boolean
}

export async function loadPurges(wsId: string): Promise<QueuedPurge[]> {
  const s = db()
  if (!s) return []
  try {
    const v = await get<QueuedPurge[]>(`purge:${wsId}`, s)
    return Array.isArray(v) ? v.filter((x) => x && typeof x.pageId === 'string') : []
  } catch {
    return []
  }
}

export async function savePurges(wsId: string, list: QueuedPurge[]): Promise<void> {
  const s = db()
  if (s) await (list.length ? set(`purge:${wsId}`, list, s) : del(`purge:${wsId}`, s))
}

/** Every entry of this device's cloud data (removing a workspace's copy, see device.ts). */
export async function allDeviceEntries(): Promise<Array<[string, unknown]>> {
  const s = db()
  if (!s) return []
  try {
    return (await entries<IDBValidKey, unknown>(s)).map(([k, v]) => [String(k), v])
  } catch {
    return []
  }
}

export async function dropDeviceKeys(keys: string[]): Promise<void> {
  const s = db()
  if (s && keys.length) await delMany(keys, s)
}
