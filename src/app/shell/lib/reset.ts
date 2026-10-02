import { safeLocalGet, safeLocalSet } from '@/shared/brand'

/** localStorage flag: wipe all IndexedDB data on the next boot (before anything opens a connection). */
export const RESET_FLAG = 'one.resetPending'

/** Tabs of this app tell each other about a reset here (separate from the data-sync channel). */
const CHANNEL = 'one-reset'
/** Channels in the same tab hear each other — tag messages so a tab ignores its own. */
const TAB = Math.random().toString(36).slice(2)

function broadcast(msg: { type: 'reset' }) {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ ...msg, from: TAB })
    ch.close()
  } catch {
    /* BroadcastChannel unsupported */
  }
}

/**
 * Erase the workspace: flag the wipe, make every other open tab reload (they hold IndexedDB
 * connections that would block the delete, and their in-memory copy would otherwise be saved
 * back over the fresh workspace), then restart this tab.
 */
export function requestReset() {
  safeLocalSet(RESET_FLAG, '1')
  broadcast({ type: 'reset' })
  window.location.hash = '#/'
  window.location.reload()
}

/**
 * Another tab is resetting: drop everything in memory and reload, which closes this tab's
 * database connections. Mount once, as early as possible.
 */
export function listenForReset(): () => void {
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
  } catch {
    return () => {}
  }
  ch.onmessage = (e) => {
    if (e.data?.type !== 'reset' || e.data.from === TAB) return
    window.location.hash = '#/'
    window.location.reload()
  }
  return () => ch?.close()
}

/**
 * Serialise boot across tabs (reset → load → seed → first save), so two tabs starting at the
 * same time never wipe each other or seed two different workspaces.
 */
export async function withBootLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return locks.request('one-boot', () => fn()) as Promise<T>
}

/**
 * Run a pending reset. `onBlocked` fires when another tab still holds the database open
 * (e.g. an older build without the reset listener) — the delete then waits for that tab to close.
 */
export async function runPendingReset(onBlocked?: () => void): Promise<boolean> {
  if (safeLocalGet(RESET_FLAG) !== '1') return false
  safeLocalSet(RESET_FLAG, null)
  const names = new Set<string>(['keyval-store', 'one-files'])
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    for (const d of dbs) if (d.name) names.add(d.name)
  } catch {
    /* databases() unsupported */
  }
  let warned = false
  await Promise.all(
    [...names].map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name)
          req.onsuccess = req.onerror = () => resolve()
          // a blocked delete stays queued and completes once the other tab lets go
          req.onblocked = () => {
            broadcast({ type: 'reset' })
            if (!warned) {
              warned = true
              onBlocked?.()
            }
          }
        }),
    ),
  )
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('one.shell.')) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
  return true
}
