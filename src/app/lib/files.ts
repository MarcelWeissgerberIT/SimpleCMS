/**
 * Local file storage (images, attachments) in IndexedDB.
 * Stored files are referenced as "onefile:<id>" strings inside content/properties.
 * Use useFileUrl(src) to turn any src (https, data:, asset path, onefile:) into a displayable URL.
 */
import { useEffect, useState } from 'react'
import { createStore, get, set, del, keys } from 'idb-keyval'
import { newId } from './ids'

const fileStore = typeof indexedDB !== 'undefined' ? createStore('one-files', 'files') : undefined

export interface StoredFile {
  blob: Blob
  name: string
  type: string
  size: number
  createdAt: number
}

export const FILE_PREFIX = 'onefile:'

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
  const rec: StoredFile = { blob, name, type: blob.type, size: blob.size, createdAt: Date.now() }
  await set(id, rec, fileStore)
  cloudHooks?.saved(id, rec)
  return FILE_PREFIX + id
}

/** Downloads in flight (several views asking for the same missing file share one request). */
const fetching = new Map<string, Promise<StoredFile | undefined>>()

/** The file stored on this device only (no server fallback). */
export async function getLocalFile(ref: string): Promise<StoredFile | undefined> {
  if (!ref.startsWith(FILE_PREFIX)) return undefined
  return get<StoredFile>(ref.slice(FILE_PREFIX.length), fileStore)
}

export async function getFile(ref: string): Promise<StoredFile | undefined> {
  if (!ref.startsWith(FILE_PREFIX)) return undefined
  const id = ref.slice(FILE_PREFIX.length)
  const local = await get<StoredFile>(id, fileStore)
  const hooks = cloudHooks
  if (local || !hooks) return local
  let job = fetching.get(id)
  if (!job) {
    job = hooks
      .fetch(id)
      .then(async (remote) => {
        // cache on this device (a failed cache write still shows the file)
        if (remote) await set(id, remote, fileStore).catch(() => {})
        return remote
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
