/**
 * The Patchbay's numbers for every surface (sidebar LED, Preflight lamp, status bar, the readout's FUSE cell) — LED =
 * lamp = readout (§1.8, §6 A16). B8 fills it: the fuse computation runs after first paint, in idle (never at boot),
 * from the eager inputs plus the lazy cache, and writes the counts here (and the hints, hint.ts).
 *
 * B1 (seams): the typed reads and the service hook — nothing is computed yet, so the counts read "not ready".
 */
import { useSyncExternalStore } from 'react'
import type { PatchbayCounts } from './types'

const NOT_READY: PatchbayCounts = { open: 0, allowed: 0, unknown: 0, ready: false }
let counts: PatchbayCounts = NOT_READY
const listeners = new Set<() => void>()

/** The counts now (not ready until the first computation). */
export function patchbayCounts(): PatchbayCounts {
  return counts
}

/** Write the counts (B8's computation only); the same numbers keep the same object — nobody re-renders. */
export function setPatchbayCounts(next: PatchbayCounts): void {
  if (next.open === counts.open && next.allowed === counts.allowed && next.unknown === counts.unknown && next.ready === counts.ready) return
  counts = next
  for (const fn of [...listeners]) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** React: the counts, re-rendered when they change. */
export function usePatchbayCounts(): PatchbayCounts {
  return useSyncExternalStore(subscribe, patchbayCounts, patchbayCounts)
}

/** The fuse computation's service (startPatchbay calls it; B8 fills it: idle after first paint, lazy cache, lamp, hints). */
export function startCounts(): () => void {
  return () => {}
}
