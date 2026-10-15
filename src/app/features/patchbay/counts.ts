/**
 * The Patchbay's numbers for every surface (sidebar LED, Preflight lamp, status bar, the readout's FUSE cell) — LED =
 * lamp = readout (§1.8, §6 A16): one publisher, state.ts `refreshModel`, writes them whenever a model is built (the
 * page's and the background's are the same model), with the hints (hint.ts).
 *
 * B8: `startCounts()` (startPatchbay → main.tsx) loads the background computation (compute.ts, its own chunk) after the
 * first paint, in idle — never at boot: it reads the lazy cache (IndexedDB `one-patchbay`, ids and hosts only) first,
 * then builds the model from the eager inputs plus that cache and keeps it current as the wiring changes. Until then the
 * counts read "not ready" (the LED stays dark, the lamp counts 0).
 */
import { useSyncExternalStore } from 'react'
import type { PatchbayCounts } from './types'

const NOT_READY: PatchbayCounts = { open: 0, allowed: 0, unknown: 0, ready: false }
let counts: PatchbayCounts = NOT_READY
const listeners = new Set<() => void>()

const sameKeys = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => (a ?? []).length === (b ?? []).length && (a ?? []).every((k, i) => k === (b ?? [])[i])

/** The counts now (not ready until the first computation). */
export function patchbayCounts(): PatchbayCounts {
  return counts
}

/** Write the counts (state.ts only); the same numbers keep the same object — nobody re-renders. */
export function setPatchbayCounts(next: PatchbayCounts): void {
  if (next.open === counts.open && next.allowed === counts.allowed && next.unknown === counts.unknown && next.ready === counts.ready && next.first === counts.first && sameKeys(next.keys, counts.keys)) return
  counts = next
  for (const fn of [...listeners]) fn()
}

/** Hear the counts change (the Preflight lamp's `subscribe`). */
export function onCounts(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** React: the counts, re-rendered when they change. */
export function usePatchbayCounts(): PatchbayCounts {
  return useSyncExternalStore(onCounts, patchbayCounts, patchbayCounts)
}

const idle = (fn: () => void): number => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  return ric ? ric(fn, { timeout: 2000 }) : (setTimeout(fn, 200) as unknown as number)
}

/**
 * The fuse computation's service (startPatchbay): after the first paint (two frames), in idle, the background
 * computation's chunk loads and starts. Returns the stop.
 */
export function startCounts(): () => void {
  let stopped = false
  let stop: (() => void) | null = null
  let frame = 0
  const go = () => {
    if (stopped) return
    void import('./compute')
      .then((m) => {
        if (!stopped) stop = m.startCompute()
      })
      .catch((err) => console.warn('[patchbay] the fuse count did not load', err))
  }
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => idle(go))))
  else idle(go)
  return () => {
    stopped = true
    if (frame) cancelAnimationFrame(frame)
    stop?.()
    stop = null
  }
}
