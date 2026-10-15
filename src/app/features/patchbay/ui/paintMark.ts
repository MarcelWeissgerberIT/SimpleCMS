/**
 * The page's paint marks (B17, plan §4: "#/patchbay first rack paint ≤ 250 ms after the chunk") — two User Timing
 * measures, nothing else:
 *  - `pb-first-rack`: from this chunk's arrival (this module is the page's FIRST import, so it is evaluated before the
 *    rest of the chunk) to the moment after the first bench (rack or strands) was painted — once per chunk load;
 *  - `pb-rack-paint`: from a visit's first render to the moment after its bench was painted — every visit.
 * Both end in a task posted from the animation frame that follows the commit which drew the bench: that frame paints
 * the bench, the posted task runs right after the paint. The perf spec reads them (tests/e2e/patchbay-perf.spec.ts). A
 * mark cancelled by an unmount (StrictMode's second mount, a route left at once) is taken by the next mount.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

/** When this chunk arrived (its first module evaluated). */
const CHUNK_AT = now()
let chunkMeasured = false

const measure = (name: string, start: number): void => {
  try {
    performance.measure(name, { start, end: now() })
    if (performance.getEntriesByName(name, 'measure').length > 50) performance.clearMeasures(name)
  } catch {
    /* no user timing here */
  }
}

/** This visit's bench was painted — what waits for it reads this (the modules' screen-reader descriptions, hover). */
const usePainted = create<{ on: boolean }>(() => ({ on: false }))
export const useBenchPainted = (): boolean => usePainted((s) => s.on)
export const benchPainted = (): boolean => usePainted.getState().on
/** Hear the visit's bench painted (true) and the visit end (false). Returns the stop. */
export const onBenchPainted = (fn: (on: boolean) => void): (() => void) => usePainted.subscribe((s, prev) => s.on !== prev.on && fn(s.on))

/** Run `fn` right after the next frame was painted (a task posted from its animation frame); returns the cancel. */
function afterPaint(fn: () => void): () => void {
  let alive = true
  const id = requestAnimationFrame(() => {
    if (!alive) return
    if (typeof MessageChannel !== 'function') return void setTimeout(() => alive && fn(), 0)
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      if (alive) fn()
    }
    ch.port2.postMessage(0)
  })
  return () => {
    alive = false
    cancelAnimationFrame(id)
  }
}

/**
 * Mark the visit's bench painted once `ready` (a model on the page) holds. Returns whether it was painted — the page
 * mounts what lies below the bench (the fuse list and plate, "§ In plain words") only then, so the rack's first frame
 * carries the rack alone (B17: the first paint's work and layout halved on a big rack).
 */
export function useRackPaint(ready: boolean): boolean {
  const [start] = useState(now)
  const [painted, setPainted] = useState(false)
  const done = useRef(false)
  useLayoutEffect(() => {
    if (!ready || done.current) return
    if (typeof requestAnimationFrame !== 'function') {
      done.current = true
      setPainted(true)
      return
    }
    const first = !chunkMeasured
    return afterPaint(() => {
      done.current = true
      if (first) {
        chunkMeasured = true
        measure('pb-first-rack', CHUNK_AT)
      }
      measure('pb-rack-paint', start)
      setPainted(true)
    })
  }, [ready, start])
  // what waits for the paint hears it (and hears the visit end)
  useEffect(() => {
    if (painted) usePainted.setState({ on: true })
    return () => usePainted.setState({ on: false })
  }, [painted])
  return painted
}
