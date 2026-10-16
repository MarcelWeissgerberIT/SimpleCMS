/**
 * Local file storage (images, attachments) in IndexedDB.
 * Stored files are referenced as "onefile:<id>" strings inside content/properties.
 * Use useFileUrl(src) to turn any src (https, data:, asset path, onefile:) into a displayable URL.
 */
import { useEffect, useState } from 'react'
import { createStore, get, getMany, set, del, keys } from 'idb-keyval'
import { newId } from './ids'

const fileStore = typeof indexedDB !== 'undefined' ? createStore('one-files', 'files') : undefined

export interface StoredFile {
  blob: Blob
  name: string
  type: string
  size: number
  createdAt: number
  /**
   * The workspace the file belongs to: 'local:<epoch>' (this browser's local workspace) or 'cloud:<id>' (a team
   * workspace, also for a copy cached from its server). `one-files` is shared by every workspace of this browser, so
   * readers that hand a file to someone outside (MCP, Claude's text) check it. Absent: saved before stamps existed.
   */
  ws?: string
}

export const FILE_PREFIX = 'onefile:'

/** The workspace new files are stamped with (main.tsx registers it once the workspace is known). */
let stampOf: () => string | null = () => null

export function setFileWorkspace(fn: () => string | null): void {
  stampOf = fn
}

/** The stamp of the workspace this tab shows now (null: not known yet). */
export const fileWorkspace = (): string | null => stampOf()

/** Stamps of files this tab saved or read: file id → stamp ('' = an unstamped legacy file). */
const stamps = new Map<string, string>()
const MAX_STAMPS = 5000

function noteStamp(id: string, rec: Pick<StoredFile, 'ws'> | undefined): void {
  if (!rec) return
  if (stamps.size >= MAX_STAMPS) stamps.delete(stamps.keys().next().value as string)
  stamps.set(id, typeof rec.ws === 'string' ? rec.ws : '')
}

/**
 * The stamp of a file this tab knows ('' = stored without one; undefined = not read here yet — loadFileStamps reads
 * it). Synchronous, for checks inside a write that cannot wait (features/ai/claudeFiles.ts).
 */
export function knownFileStamp(ref: string): string | undefined {
  return ref.startsWith(FILE_PREFIX) ? stamps.get(ref.slice(FILE_PREFIX.length)) : undefined
}

/** Read the stamps of these files from this device (the record only — nothing is fetched from a server). */
export async function loadFileStamps(refs: Iterable<string>): Promise<void> {
  const ids = [...new Set([...refs].filter((r) => r.startsWith(FILE_PREFIX)).map((r) => r.slice(FILE_PREFIX.length)))].filter((id) => !stamps.has(id))
  if (!ids.length || !fileStore) return
  try {
    const recs = await getMany<StoredFile | undefined>(ids, fileStore)
    ids.forEach((id, i) => noteStamp(id, recs[i]))
  } catch {
    /* no IndexedDB: the reference check alone decides */
  }
}

/**
 * Team cloud (src/app/cloud registers this in a cloud workspace): files saved here are also
 * uploaded in the background, and files missing on this device are fetched from the server.
 */
export interface CloudFileHooks {
  /** A file was saved on this device (queue its upload). */
  saved(id: string, file: StoredFile): void
  /** The file isn't on this device: get it from the server (undefined when it has none). */
  fetch(id: string): Promise<StoredFile | undefined>
}

let cloudHooks: CloudFileHooks | null = null

export function setCloudFileHooks(hooks: CloudFileHooks | null): void {
  cloudHooks = hooks
}

export async function saveFile(blob: Blob, name = 'file'): Promise<string> {
  const id = newId()
  const ws = stampOf()
  const rec: StoredFile = { blob, name, type: blob.type, size: blob.size, createdAt: Date.now(), ...(ws ? { ws } : {}) }
  await set(id, rec, fileStore)
  noteStamp(id, rec)
  cloudHooks?.saved(id, rec)
  return FILE_PREFIX + id
}

/** Downloads in flight (several views asking for the same missing file share one request). */
const fetching = new Map<string, Promise<StoredFile | undefined>>()

/** The file stored on this device only (no server fallback). */
export async function getLocalFile(ref: string): Promise<StoredFile | undefined> {
  if (!ref.startsWith(FILE_PREFIX)) return undefined
  const id = ref.slice(FILE_PREFIX.length)
  const rec = await get<StoredFile>(id, fileStore)
  noteStamp(id, rec)
  return rec
}

export async function getFile(ref: string): Promise<StoredFile | undefined> {
  if (!ref.startsWith(FILE_PREFIX)) return undefined
  const id = ref.slice(FILE_PREFIX.length)
  const local = await get<StoredFile>(id, fileStore)
  noteStamp(id, local)
  const hooks = cloudHooks
  if (local || !hooks) return local
  let job = fetching.get(id)
  if (!job) {
    job = hooks
      .fetch(id)
      .then(async (remote) => {
        if (!remote) return remote
        // cache on this device, stamped with the team workspace it came from (a failed cache write still shows the file)
        const ws = stampOf()
        const rec: StoredFile = { ...remote, ...(ws ? { ws } : {}) }
        await set(id, rec, fileStore).catch(() => {})
        noteStamp(id, rec)
        return rec
      })
      .catch(() => undefined)
      .finally(() => fetching.delete(id))
    fetching.set(id, job)
  }
  return job
}

export async function deleteFile(ref: string): Promise<void> {
  if (ref.startsWith(FILE_PREFIX)) await del(ref.slice(FILE_PREFIX.length), fileStore)
}

export async function listFileRefs(): Promise<string[]> {
  return (await keys(fileStore)).map((k) => FILE_PREFIX + String(k))
}

const urlCache = new Map<string, string>()

export async function resolveFileUrl(src: string): Promise<string> {
  if (!src.startsWith(FILE_PREFIX)) return resolveAssetUrl(src)
  const cached = urlCache.get(src)
  if (cached) return cached
  const f = await getFile(src)
  if (!f) return ''
  const url = URL.createObjectURL(f.blob)
  urlCache.set(src, url)
  return url
}

/** Public assets ("assets/icons/x.webp") need the Vite base prefix. */
export function resolveAssetUrl(src: string): string {
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src
  return `${import.meta.env.BASE_URL}${src}`
}

/** React hook: displayable URL for any src (or '' while loading / missing). */
export function useFileUrl(src: string | null | undefined): string {
  const [url, setUrl] = useState(() => (src && !src.startsWith(FILE_PREFIX) ? resolveAssetUrl(src) : urlCache.get(src ?? '') ?? ''))
  useEffect(() => {
    let alive = true
    if (!src) {
      setUrl('')
      return
    }
    resolveFileUrl(src).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [src])
  return url
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
