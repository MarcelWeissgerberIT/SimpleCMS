/**
 * Pages deleted for good in a cloud workspace (trash emptied, "delete forever", an undone create …)
 * leave their content document on the server. This client — the one that deleted them — asks the
 * server to drop those documents (DELETE …/documents/:pageId, docs/CLOUD.md). The server only does it
 * once its meta document no longer lists the page, so a request waits until this device's change of
 * the meta documents is confirmed. The queue lives in this device's storage (purge:<ws>), so a reload
 * or an offline spell doesn't lose it.
 *
 * Private pages (docs/CLOUD.md § Private pages): an entry with `private` names this member's private
 * content document (`?scope=private`). A page moved between Private and the workspace leaves its old
 * document behind the same way (it stays in the store, in the other scope — so only a page that is
 * back in the SAME scope keeps its document).
 */
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useWorkspace } from '../store/store'
import type { ID } from '../store/types'
import { delPageDocument } from './api'
import { PAGE_ID } from './env'
import { loadPurges, savePurges, type QueuedPurge } from './local'
import { isConnected, onConnection } from './socket'
import { CloudError } from './state'

/** 409 page_exists: the deletion may not have reached the server yet — a few tries, then the page is someone's again. */
const MAX_TRIES = 4

let wsId: string | null = null
let providers: HocuspocusProvider[] = []
let canWrite: () => boolean = () => false
let queue: QueuedPurge[] = []
let running = false
let timer: number | undefined
let loaded: Promise<void> = Promise.resolve()

/** Saved once the stored queue has been merged in (never overwrites it with a partial list). */
const persist = () => {
  const id = wsId
  if (id) void loaded.then(() => (wsId === id ? savePurges(id, queue) : undefined)).catch(() => {})
}

function schedule(delay: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void run(), delay)
}

/** The server has this device's meta changes (the deletion included) — of both meta documents. */
const metaConfirmed = () => providers.length > 0 && providers.every((p) => p.isSynced && !p.hasUnsyncedChanges)

async function run(): Promise<void> {
  if (running || !wsId) return
  running = true
  try {
    await loaded
    while (queue.length && wsId && canWrite()) {
      if (!isConnected() || !metaConfirmed()) return // the provider's events / the reconnect call again
      const item = queue[0]
      // back in the meanwhile (an undo, moved back): its document stays
      const page = useWorkspace.getState().pages[item.pageId]
      if (page && !!page.private === !!item.private) {
        queue.shift()
        persist()
        continue
      }
      try {
        await delPageDocument(wsId, item.pageId, !!item.private)
        queue.shift()
      } catch (e) {
        const err = e instanceof CloudError ? e : null
        if (err?.code === 'page_exists' && ++item.tries < MAX_TRIES) {
          persist()
          schedule(2000 * 2 ** item.tries)
          return
        }
        if (!err || err.code === 'network' || err.code === 'unavailable' || err.status >= 500 || err.status === 429) {
          schedule(15_000) // try again later
          return
        }
        // refused for good (no permission, workspace gone, still exists after retries)
        queue.shift()
      }
      persist()
    }
  } finally {
    running = false
  }
}

const key = (q: { pageId: ID; private?: boolean }) => `${q.private ? 'u' : 'w'}:${q.pageId}`

/** Start for the open cloud workspace: waiting deletions from earlier sessions go out once connected. */
export function startPurge(activeWs: string, metaProviders: HocuspocusProvider[], writable: () => boolean): void {
  wsId = activeWs
  providers = metaProviders
  canWrite = writable
  loaded = loadPurges(activeWs).then((list) => {
    const known = new Set(queue.map(key))
    queue = [...list.filter((q) => !known.has(key(q))), ...queue]
  })
  for (const p of metaProviders) {
    p.on('unsyncedChanges', () => {
      if (queue.length && metaConfirmed()) schedule(100)
    })
    p.on('synced', () => {
      if (queue.length) schedule(300)
    })
  }
  onConnection((up) => {
    if (up && queue.length) schedule(500)
  })
  void loaded.then(() => queue.length && schedule(1000))
}

/**
 * Pages this device deleted for good (or moved out of a scope): drop their server documents —
 * `private`: this member's private content document of the page, else the workspace's.
 */
export function queuePurge(items: Array<{ pageId: ID; private?: boolean }>): void {
  if (!wsId || !canWrite()) return
  let added = false
  for (const it of items) {
    if (!PAGE_ID.test(it.pageId) || queue.some((q) => key(q) === key(it))) continue
    queue.push({ pageId: it.pageId, tries: 0, ...(it.private ? { private: true } : {}) })
    added = true
  }
  if (!added) return
  persist()
  schedule(300)
}
