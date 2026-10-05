/**
 * "What's new" — which entry this device opened last (localStorage `one.help.seen-changelog`, per device,
 * never synced) and whether a newer one exists. Light module (status bar, workspace menu): the newest
 * entry's id is stamped into the build by the help-site plugin (import.meta.env.VITE_HELP_CHANGELOG_LATEST),
 * so the LED needs none of the changelog content.
 */
import { useSyncExternalStore } from 'react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

export const SEEN_CHANGELOG_KEY = 'one.help.seen-changelog'

/** The newest entry of this build ("2026-10-05-ai-terminal"), or '' (no entries / no plugin). */
export const LATEST_CHANGELOG: string = String(import.meta.env.VITE_HELP_CHANGELOG_LATEST ?? '')

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

const read = (): string => safeLocalGet(SEEN_CHANGELOG_KEY) ?? ''

/** The id of the entry this device opened last ('' = none yet). */
export const readChangelogSeen = read

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  // another tab opened the list
  const onStorage = (e: StorageEvent) => {
    if (e.key === SEEN_CHANGELOG_KEY || e.key === null) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Is `latest` newer than the entry last opened? Ids start with their date, so an entry from a later day
 * than the one stored (a device that ran a newer build) never counts as unseen.
 */
export function isUnseen(latest: string, seen: string): boolean {
  if (!latest) return false
  if (!seen) return true
  return seen !== latest && seen.slice(0, 10) <= latest.slice(0, 10)
}

/** The list (or an entry) was opened: everything up to `newestId` is seen on this device. */
export function markChangelogSeen(newestId: string | null | undefined): void {
  if (!newestId || !isUnseen(newestId, read())) return
  safeLocalSet(SEEN_CHANGELOG_KEY, newestId)
  notify()
}

/** True while this build has an entry newer than the last one this device opened (the help LED). */
export function useChangelogUnseen(): boolean {
  const seen = useSyncExternalStore(subscribe, read, () => '')
  return isUnseen(LATEST_CHANGELOG, seen)
}
