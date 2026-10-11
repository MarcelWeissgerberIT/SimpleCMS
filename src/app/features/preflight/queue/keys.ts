/**
 * Preflight's keys — only with focus inside the plate (handler on `.pf`; the queue's keys join in P2), never while
 * typing, never on a repeat or with modifiers. Space never scrolls and never clicks a cap (prevented on keydown AND
 * keyup); ↵ on a cap is the cap's own click. Arrows: a 2-D roving group (columns read from the grid at keydown).
 */
import type { KeyboardEvent } from 'react'
import { onGridKey } from '../../../ui/roving'

/** Focus is in a text field, a menu, a listbox or a dialog: single-letter keys belong to it. */
export function typing(el: Element | null = document.activeElement): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return true
  return !!el.closest('[role="menu"], [role="listbox"], [role="dialog"]')
}

export const CAP_SELECTOR = '.pf-cap'

/**
 * The plate's keys. `next(fromIndex)` answers the cap Space jumps to (the next new lamp cycling, else the next lit,
 * else null). Returns the index focused (arrows / Space), or null.
 */
export function onPlateKey(e: KeyboardEvent<HTMLElement>, next: (from: number) => number | null): number | null {
  if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return null
  const target = e.target as Element
  if (typing(target) || !target.closest(CAP_SELECTOR)) return null
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault()
    if (e.type !== 'keydown' || e.repeat) return null
    const caps = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(CAP_SELECTOR))
    const at = caps.findIndex((c) => c === document.activeElement)
    const to = next(at)
    if (to === null || !caps[to]) return null
    caps[to].focus()
    return to
  }
  if (e.type !== 'keydown' || e.shiftKey) return null
  return onGridKey(e, { selector: CAP_SELECTOR })
}
