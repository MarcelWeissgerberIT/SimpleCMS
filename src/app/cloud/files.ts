/**
 * Files in a cloud workspace (docs/CLOUD.md § Files): saveFile() keeps writing to IndexedDB and
 * queues an upload (PUT …/files/:id, background, retried with backoff and after reconnects; the
 * queue survives reloads). Files missing on this device are fetched from the server and cached.
 */
import { getLocalFile, setCloudFileHooks, FILE_PREFIX, type StoredFile } from '../lib/files'
import { getFileBlob, putFile } from './api'
import { loadUploads, saveUploads, type QueuedUpload } from './local'
import { CloudError, useCloudSync } from './state'

const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_TRIES = 12

let wsId: string | null = null
let canWrite: () => boolean = () => false
let queue: QueuedUpload[] = []
let running = false
let timer: number | undefined
let backoff = 0

function publish() {
  useCloudSync.setState({ pendingUploads: queue.length })
}

function persist() {
  if (wsId) saveUploads(wsId, queue).catch(() => {})
}

function fail(item: QueuedUpload, code: string) {
  useCloudSync.setState((s) => ({ failedUploads: [...s.failedUploads.filter((f) => f.id !== item.id), { id: item.id, name: item.name, code }].slice(-20) }))
}

function schedule(delay: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void run(), delay)
}

async function run(): Promise<void> {
  if (running || !wsId) return
  running = true
  try {
    while (queue.length && wsId && canWrite()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      const item = queue[0]
      const file = await getLocalFile(FILE_PREFIX + item.id).catch(() => undefined)
      if (!file) {
        // gone from this device (deleted before it was sent): nothing to upload
        queue.shift()
        persist()
        publish()
        continue
      }
      const max = useCloudSync.getState().maxUploadMb
      if (max && file.size > max * 1024 * 1024) {
        queue.shift()
        fail(item, 'file_too_large')
        persist()
        publish()
        continue
      }
      try {
        await putFile(wsId, item.id, file.blob, file.name)
        queue.shift()
        backoff = 0
      } catch (e) {
        const code = e instanceof CloudError ? e.code : 'network'
        const status = e instanceof CloudError ? e.status : 0
        if (status === 413 || status === 400 || status === 403 || status === 404) {
          // refused for good (too large, bad id, no permission, workspace gone)
          queue.shift()
          fail(item, code)
        } else {
          item.tries++
          if (item.tries >= MAX_TRIES) {
            queue.shift()
            fail(item, code)
          } else {
            backoff = Math.min(backoff ? backoff * 2 : 2000, 60_000)
            persist()
            publish()
            schedule(backoff)
            return
          }
        }
      }
      persist()
      publish()
    }
  } finally {
    running = false
  }
}

function enqueue(id: string, name: string) {
  if (!FILE_ID.test(id) || queue.some((q) => q.id === id)) return
  queue.push({ id, name, tries: 0 })
  persist()
  publish()
  schedule(50)
}

/** Start file sync for the active cloud workspace. */
export async function startFiles(activeWs: string, writable: () => boolean): Promise<() => void> {
  wsId = activeWs
  canWrite = writable
  queue = await loadUploads(activeWs)
  publish()
  setCloudFileHooks({
    saved: (id, file: StoredFile) => {
      if (canWrite()) enqueue(id, file.name)
    },
    fetch: async (id) => {
      if (!wsId || !FILE_ID.test(id)) return undefined
      const got = await getFileBlob(wsId, id)
      if (!got) return undefined
      return { blob: got.blob, name: got.name, type: got.blob.type, size: got.blob.size, createdAt: Date.now() }
    },
  })
  const onOnline = () => {
    backoff = 0
    schedule(200)
  }
  window.addEventListener('online', onOnline)
  if (queue.length) schedule(1000)
  return () => {
    window.removeEventListener('online', onOnline)
    window.clearTimeout(timer)
    setCloudFileHooks(null)
    wsId = null
  }
}

/** The connection is back (socket reconnected): retry waiting uploads now. */
export function kickUploads(): void {
  if (queue.length) {
    backoff = 0
    schedule(100)
  }
}
