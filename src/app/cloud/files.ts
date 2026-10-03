/**
 * Files in a cloud workspace (docs/CLOUD.md § Files): saveFile() keeps writing to IndexedDB and
 * queues an upload (PUT …/files/:id, background, retried with backoff and after reconnects; the
 * queue survives reloads). Files missing on this device are fetched from the server and cached.
 *
 * Private pages (§ Private pages): a file saved while a private page is on screen (main view, peek
 * or a pane) is uploaded as private — the server serves it to this member only. It becomes a
 * workspace file (POST …/files/publish, queued like an upload) when a page that uses it moves to the
 * workspace, or when this device writes a workspace page that references it (copy & paste).
 */
import { getLocalFile, setCloudFileHooks, FILE_PREFIX, type StoredFile } from '../lib/files'
import { parseHash } from '../lib/router'
import { useWorkspace } from '../store/store'
import { useUI } from '../store/ui'
import type { Page } from '../store/types'
import { getFileBlob, publishFiles, putFile } from './api'
import { loadPrivateFiles, loadUploads, savePrivateFiles, saveUploads, type QueuedUpload } from './local'
import { fileRefs } from './privacy'
import { CloudError, useCloudSync } from './state'

const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_TRIES = 12
const PUBLISH_BATCH = 200

let wsId: string | null = null
let canWrite: () => boolean = () => false
let queue: QueuedUpload[] = []
/** Files this device uploaded (or queued) as private and hasn't published yet. */
let privateIds = new Set<string>()
let running = false
let timer: number | undefined
let backoff = 0

function publish() {
  useCloudSync.setState({ pendingUploads: queue.filter((q) => !q.publish).length })
}

function persist() {
  if (wsId) saveUploads(wsId, queue).catch(() => {})
}

function persistPrivate() {
  if (wsId) savePrivateFiles(wsId, [...privateIds]).catch(() => {})
}

function fail(item: QueuedUpload, code: string) {
  useCloudSync.setState((s) => ({ failedUploads: [...s.failedUploads.filter((f) => f.id !== item.id), { id: item.id, name: item.name, code }].slice(-20) }))
}

function schedule(delay: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void run(), delay)
}

/** One upload, or a batch of publish requests at the head of the queue. */
async function send(item: QueuedUpload): Promise<'done' | 'skip'> {
  if (item.publish) {
    let n = 0
    while (n < queue.length && n < PUBLISH_BATCH && queue[n].publish) n++
    await publishFiles(wsId!, queue.slice(0, n).map((q) => q.id))
    queue.splice(0, n)
    return 'done'
  }
  const file = await getLocalFile(FILE_PREFIX + item.id).catch(() => undefined)
  // gone from this device (deleted before it was sent): nothing to upload
  if (!file) return 'skip'
  const max = useCloudSync.getState().maxUploadMb
  if (max && file.size > max * 1024 * 1024) {
    fail(item, 'file_too_large')
    return 'skip'
  }
  await putFile(wsId!, item.id, file.blob, file.name, !!item.private)
  queue.shift()
  return 'done'
}

async function run(): Promise<void> {
  if (running || !wsId) return
  running = true
  try {
    while (queue.length && wsId && canWrite()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      const item = queue[0]
      try {
        if ((await send(item)) === 'skip') queue.shift()
        backoff = 0
      } catch (e) {
        const code = e instanceof CloudError ? e.code : 'network'
        const status = e instanceof CloudError ? e.status : 0
        if (status === 413 || status === 400 || status === 403 || status === 404) {
          // refused for good (too large, bad id, no permission, workspace gone)
          queue.shift()
          if (!item.publish) fail(item, code)
        } else {
          item.tries++
          if (item.tries >= MAX_TRIES) {
            queue.shift()
            if (!item.publish) fail(item, code)
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

/** A private page is on screen (main view, peek or a pane): what is saved now belongs to it. */
function privateOnScreen(): boolean {
  const pages = useWorkspace.getState().pages
  const ui = useUI.getState()
  const r = parseHash(window.location.hash)
  return [r.name === 'page' ? r.id : null, ui.peekPageId, ...ui.panes].some((id) => !!id && !!pages[id]?.private)
}

function enqueue(id: string, name: string) {
  if (!FILE_ID.test(id) || queue.some((q) => q.id === id && !q.publish)) return
  const priv = privateOnScreen()
  queue.push({ id, name, tries: 0, ...(priv ? { private: true } : {}) })
  if (priv) {
    privateIds.add(id)
    persistPrivate()
  }
  persist()
  publish()
  schedule(50)
}

/**
 * These files may be seen by everyone now (their page moved to the workspace, or a workspace page
 * uses them): a private upload still waiting goes out as a workspace file, an uploaded one is
 * published. Anyone's ids may be passed — the server only publishes this member's own.
 */
export function publishFileIds(ids: Iterable<string>): void {
  if (!wsId || !canWrite()) return
  let changed = false
  for (const id of ids) {
    if (!FILE_ID.test(id)) continue
    const waiting = queue.find((q) => q.id === id && !q.publish)
    if (waiting) {
      if (waiting.private) {
        delete waiting.private
        changed = true
      }
    } else if (!queue.some((q) => q.id === id && q.publish)) {
      queue.push({ id, name: '', tries: 0, publish: true })
      changed = true
    }
    if (privateIds.delete(id)) changed = true
  }
  if (!changed) return
  persistPrivate()
  persist()
  publish()
  schedule(50)
}

/**
 * Like publishFileIds, but the request goes out now (a page is about to move to the workspace and
 * everyone should see its files at once); without a connection it waits in the queue.
 */
export async function publishNow(ids: string[]): Promise<void> {
  const valid = ids.filter((id) => FILE_ID.test(id))
  if (!wsId || !canWrite() || !valid.length) return
  const ws = wsId
  // files still waiting for their upload simply go out as workspace files
  const rest = valid.filter((id) => {
    const waiting = queue.find((q) => q.id === id && !q.publish)
    if (waiting) delete waiting.private
    return !waiting
  })
  valid.forEach((id) => privateIds.delete(id))
  persistPrivate()
  persist()
  try {
    for (let i = 0; i < rest.length; i += PUBLISH_BATCH) await publishFiles(ws, rest.slice(i, i + PUBLISH_BATCH))
  } catch {
    publishFileIds(rest)
  }
}

/** Workspace pages written here: private uploads of this device they reference are published. */
export function publishReferenced(pages: Page[]): void {
  if (!privateIds.size) return
  const refs = new Set<string>()
  for (const p of pages) {
    fileRefs(p.content, refs)
    fileRefs(p.cover, refs)
    fileRefs(p.properties, refs)
  }
  const mine = [...refs].filter((id) => privateIds.has(id))
  if (mine.length) publishFileIds(mine)
}

/** Start file sync for the active cloud workspace. */
export async function startFiles(activeWs: string, writable: () => boolean): Promise<() => void> {
  wsId = activeWs
  canWrite = writable
  ;[queue, privateIds] = await Promise.all([loadUploads(activeWs), loadPrivateFiles(activeWs).then((l) => new Set(l))])
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
