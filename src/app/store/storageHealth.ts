/**
 * The team workspace's copy on this device: whether its writes land. A team copy persists through y-indexeddb and
 * the one-cloud records, not through persistence.ts — so nothing else would ever say it failed. The cloud layer
 * reports its own writes (`noteCopyWrite`); a QuotaExceededError nobody caught (y-indexeddb stores updates without
 * handling a failure) counts as a failed copy write too. The flight recorder listens: the workspace always wins.
 */
type Listener = (ok: boolean, error?: unknown) => void

const listeners = new Set<Listener>()
let hooked = false

/** A write of the team copy landed (`ok`) or failed (with its error). */
export function noteCopyWrite(ok: boolean, error?: unknown): void {
  listeners.forEach((l) => l(ok, error))
}

const isQuota = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'QuotaExceededError'

function hook(): void {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  window.addEventListener('unhandledrejection', (ev) => {
    if (isQuota(ev.reason)) noteCopyWrite(false, ev.reason)
  })
}

export function onCopyHealth(fn: Listener): () => void {
  hook()
  listeners.add(fn)
  return () => listeners.delete(fn)
}
