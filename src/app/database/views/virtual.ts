/**
 * Windowing for long lists whose vertical scroller may be any ancestor (or the page):
 * measures the list's position against the viewport on every (captured) scroll.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

/** Index of the item containing y (offsets has length n + 1). */
export function indexAt(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo)
}

/** [start, end) of items to render. Returns the full range when disabled. */
export function useWindow(ref: RefObject<HTMLElement | null>, offsets: number[], enabled: boolean, overscan = 480): [number, number] {
  const count = offsets.length - 1
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 60)])
  useLayoutEffect(() => {
    if (!enabled) return
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const a = indexAt(offsets, Math.max(0, -rect.top - overscan))
      const b = Math.min(count, indexAt(offsets, Math.max(0, window.innerHeight - rect.top + overscan)) + 1)
      setRange((p) => (p[0] === a && p[1] === b ? p : [a, b]))
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    document.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      document.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [enabled, offsets, count, ref, overscan])
  return enabled ? [Math.min(range[0], count), Math.min(range[1], count)] : [0, count]
}

/** Uniform-height offsets helper. */
export function uniformOffsets(n: number, h: number): number[] {
  const out = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++) out[i] = i * h
  return out
}
