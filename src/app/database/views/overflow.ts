/**
 * Horizontal overflow state of a scroll container: which edges hide content.
 * Used to fade those edges and offer "scroll this way" buttons.
 */
import { useEffect, useState } from 'react'

export type EdgeOverflow = 'none' | 'start' | 'end' | 'both'

/** Returns a callback ref for the scroll container, its overflow state and the element. */
export function useEdgeOverflow<T extends HTMLElement>(): [(el: T | null) => void, EdgeOverflow, T | null] {
  const [el, setEl] = useState<T | null>(null)
  const [state, setState] = useState<EdgeOverflow>('none')
  useEffect(() => {
    if (!el) return
    const check = () => {
      const max = el.scrollWidth - el.clientWidth
      // a few px of slack: padding, snap points and sub-pixel layouts never count as "scrolled"
      const next: EdgeOverflow = max <= 8 ? 'none' : el.scrollLeft < 8 ? 'end' : el.scrollLeft >= max - 8 ? 'start' : 'both'
      setState((cur) => (cur === next ? cur : next))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', check, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', check)
    }
  }, [el])
  return [setEl, state, el]
}

/**
 * Scroll by most of a viewport width (keeps one column of context). With `items`, the stop is
 * aligned to an item's leading edge, `inset` px in from the start — clear of the edge fade and the
 * step button, so the column you land on starts fully readable.
 */
export function scrollByPage(el: HTMLElement | null, dir: 1 | -1, items?: string, inset = 0) {
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const max = el.scrollWidth - el.clientWidth
  let left = el.scrollLeft + dir * Math.max(200, el.clientWidth * 0.8)
  if (items) {
    const base = el.getBoundingClientRect().left - el.scrollLeft
    const stops = Array.from(el.querySelectorAll<HTMLElement>(items)).map((c) => c.getBoundingClientRect().left - base - inset)
    const ahead = stops.filter((x) => (dir > 0 ? x > el.scrollLeft + 4 : x < el.scrollLeft - 4))
    if (ahead.length) left = ahead.reduce((best, x) => (Math.abs(x - left) < Math.abs(best - left) ? x : best))
  }
  left = Math.max(0, Math.min(max, left))
  el.scrollTo({ left: left < 8 ? 0 : left, behavior: reduce ? 'auto' : 'smooth' })
}
