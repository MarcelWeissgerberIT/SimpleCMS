/**
 * Measured tiers for a one-line row that must never wrap (a module's kind line): tier 0 shows everything; while the row
 * overflows, the next tier is tried before the frame is painted (CSS says what each tier lets go). Another width or
 * other content starts again at 0 — measured, never guessed from a breakpoint (German words are longer).
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export function useFitTier(ref: RefObject<HTMLElement | null>, max: number, content: unknown): number {
  const [tier, setTier] = useState(0)
  const width = useRef(0)
  // other words: start from everything again
  useLayoutEffect(() => setTier(0), [content])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    width.current = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width.current) return
      width.current = el.clientWidth
      setTier(0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || tier >= max || el.clientWidth === 0) return
    if (el.scrollWidth > el.clientWidth + 1) setTier(tier + 1)
  })
  return tier
}
