/**
 * Preflight's keys — only with focus inside the plate (handler on `.pf`) or the queue (its section), never while
 * typing, never on a repeat or with modifiers. Space never scrolls and never clicks a cap (prevented on keydown AND
 * keyup); ↵ on a cap is the cap's own click. Arrows: a 2-D roving group (columns read from the grid at keydown).
 */
import type { KeyboardEvent } from 'react'
import { onGridKey, onRovingKey } from '../../../ui/roving'
import { typing } from '../../../ui/keys'

export { typing } from '../../../ui/keys'

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

/* ---------------- the queue (§7.4) */

const LETTERS = new Set(['j', 'k', 'a', 'd', 'e', 'o', 'r', 'n', 'x', 'z', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

export interface QueueKeyHandlers {
  move(dir: 1 | -1): void
  /** a card key ('a' · 'd' · 'o' · 'r' · '1'…'9') on the current card */
  key(k: string): void
  toggleDiff(): void
  bulkApply(): void
  discardStale(): void
  undo(): void
  /** Esc: a text field first, then the confirm row / bulk sheet, then back to the lamp */
  escape(target: HTMLElement): void
}

/**
 * The queue's keys — handler on the queue section: only with focus inside it, never while typing (Esc excepted: it
 * leaves the field), never on a repeat, with no modifier but Shift, never on an event already handled. Enter on a key
 * or a link is that element's own click (never a second action). Every key handled is prevented.
 */
export function onQueueKey(e: KeyboardEvent<HTMLElement>, h: QueueKeyHandlers): void {
  if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
  const target = e.target as HTMLElement
  if (e.key === 'Escape') {
    // never the shell's Esc (closing a peek, focus mode, the phone's sidebar)
    e.preventDefault()
    if (!e.repeat) h.escape(target)
    return
  }
  if (e.repeat || typing(target)) return
  if (target.closest('[role="tablist"]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
    onRovingKey(e, '[role="tab"]', { axis: 'horizontal' })
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (e.shiftKey) return
    e.preventDefault()
    h.move(e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : ''
  if (!LETTERS.has(k)) return
  // Shift goes with A only (⇧A)
  if (e.shiftKey && k !== 'a') return
  e.preventDefault()
  if (k === 'a' && e.shiftKey) return h.bulkApply()
  if (k === 'j' || k === 'n') return h.move(1)
  if (k === 'k') return h.move(-1)
  if (k === 'e') return h.toggleDiff()
  if (k === 'x') return h.discardStale()
  if (k === 'z') return h.undo()
  h.key(k)
}
