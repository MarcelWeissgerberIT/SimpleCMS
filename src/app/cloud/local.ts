/**
 * This device's own data for a cloud workspace (never synced, docs/CLOUD.md § not synced):
 *   overlay:<ws>          settings (theme, language, AI key …), favourites, recent pages,
 *                         pages with local edits the server hasn't confirmed yet
 *   content:<ws>:<page>   the last known content JSON of a page (search/export/graph at boot
 *                         without opening every page document) + the page's updatedAt it matches
 *   uploads:<ws>          files waiting for upload
 *   purge:<ws>            pages deleted for good whose server document still has to go
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

export interface QueuedUpload {
  id: string
  name: string
  tries: number
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

export interface QueuedPurge {
  pageId: ID
  tries: number
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
