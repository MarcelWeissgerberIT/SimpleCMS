import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useCloud } from '../../cloud'

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
 *
 * Only for the local workspace: in a team workspace this would erase the browser's local
 * workspace behind the person's back (the flag runs at the next local boot). There, Settings offers
 * "remove this workspace's copy" instead (cloud API removeDeviceCopy), and the owner deletes the
 * team workspace itself under Workspace settings → Danger zone.
 */
export function requestReset() {
  if (useCloud.getState().active.kind === 'cloud') {
    console.warn('[one] erasing is for the local workspace — a team workspace removes its copy instead')
    return
  }
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
 *
 * The flag is only cleared database by database, as each delete settles: if this tab is
 * closed while a delete is still blocked, the flag (now the list of databases left) makes
 * the next boot finish the job instead of loading the old data again.
 */
export async function runPendingReset(onBlocked?: () => void): Promise<boolean> {
  const raw = safeLocalGet(RESET_FLAG)
  if (!raw) return false
  // "1" = a fresh request; a JSON list = databases an interrupted run had not deleted yet
  let names: string[] | null = null
  try {
    const v: unknown = JSON.parse(raw)
    if (Array.isArray(v)) names = v.filter((x): x is string => typeof x === 'string')
  } catch {
    /* "1" or junk: start over */
  }
  if (!names) {
    const all = new Set<string>(['keyval-store', 'one-files', 'one-vault'])
    try {
      const dbs = (await indexedDB.databases?.()) ?? []
      for (const d of dbs) if (d.name) all.add(d.name)
    } catch {
      /* databases() unsupported */
    }
    names = [...all]
  }
  const left = new Set(names)
  const save = () => safeLocalSet(RESET_FLAG, left.size ? JSON.stringify([...left]) : null)
  save()
  let warned = false
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name)
          const settle = () => {
            left.delete(name)
            save()
            resolve()
          }
          req.onsuccess = settle
          // a failed delete is not retried on every boot (that would wipe the next workspace too)
          req.onerror = () => {
            console.error(`[one] could not delete database "${name}"`, req.error)
            settle()
          }
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
