/**
 * "Has this device opened the Patchbay?" — the sidebar's NEW tag (§1.8): localStorage `one.patchbay.seen` (cache.ts
 * LS_SEEN), set on the first visit; a write in this tab or another one takes the tag away at once.
 */
import { useSyncExternalStore } from 'react'
import { LS_SEEN, lsGet, lsSet } from '../cache'

const listeners = new Set<() => void>()
const read = (): boolean => lsGet(LS_SEEN) !== null

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_SEEN || e.key === null) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** The page opened: the NEW tag goes. */
export function markSeen(): void {
  if (read()) return
  lsSet(LS_SEEN, '1')
  for (const fn of [...listeners]) fn()
}

export function useSeen(): boolean {
  return useSyncExternalStore(subscribe, read, () => true)
}
