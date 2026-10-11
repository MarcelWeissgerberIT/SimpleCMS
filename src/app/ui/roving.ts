/**
 * Arrow-key navigation for radio groups and listboxes built from buttons (WAI-ARIA "roving focus"):
 * ←/→/↑/↓ move to the previous/next enabled item and select it, Home/End jump to the ends.
 * Pair with tabIndex={selected ? 0 : -1} on the items so Tab enters the group once.
 *
 * `onGridKey` is the 2-D variant for a grid of keys laid out by CSS grid (the Preflight plate): ←/→ step through the
 * items in reading order, ↑/↓ move a whole row (no item there → it stays), Home/End jump to the first / last. The
 * column count is read from the grid at keydown, so it follows the layout at every width and text size. It only moves
 * focus — it never clicks.
 */
import type { KeyboardEvent } from 'react'

const KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'])
const VERTICAL = new Set(['ArrowDown', 'ArrowUp'])

export function onRovingKey(e: KeyboardEvent<HTMLElement>, selector = '[role="radio"], [role="option"], [role="tab"]', opts?: { axis?: 'both' | 'horizontal' }): void {
  if (!KEYS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey) return
  // a horizontal group (a tab strip) leaves ↑ / ↓ to its container
  if (opts?.axis === 'horizontal' && VERTICAL.has(e.key)) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : at < 0 ? 0 : (at + step + items.length) % items.length
  e.preventDefault()
  items[next].focus()
  if (next !== at) items[next].click()
}

/**
 * Where a grid key moves from item `i` in a grid of `n` items laid out in `cols` columns (pure). ←/→ step in reading
 * order and stop at the ends; ↑/↓ move by a row and stay when there is no item above / below; Home/End go to the first /
 * last item. Nothing focused yet (`i < 0`) → the first item. null = not a grid key (or no items).
 */
export function gridNext(i: number, key: string, cols: number, n: number): number | null {
  if (n <= 0 || !KEYS.has(key)) return null
  const c = Math.max(1, Math.floor(cols) || 1)
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  if (i < 0 || i >= n) return 0
  switch (key) {
    case 'ArrowRight':
      return Math.min(i + 1, n - 1)
    case 'ArrowLeft':
      return Math.max(i - 1, 0)
    case 'ArrowDown':
      return i + c < n ? i + c : i
    case 'ArrowUp':
      return i - c >= 0 ? i - c : i
  }
  return null
}

/** The number of columns of a CSS grid as laid out now (1 for anything that is not a grid). */
export function gridColumns(el: Element): number {
  const tracks = getComputedStyle(el).gridTemplateColumns
  if (!tracks || tracks === 'none') return 1
  // computed tracks are resolved sizes ("147px 147px …"); line names come in brackets
  return Math.max(1, tracks.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).length)
}

/**
 * 2-D arrow keys inside a grid of keys (see `gridNext`). The grid is `[data-grid]` inside the handler's element, else
 * the element itself. Moves focus only — never clicks, never selects. Returns the index focused, or null when the key
 * was not handled (then nothing was prevented).
 */
export function onGridKey(e: KeyboardEvent<HTMLElement>, opts: { selector: string }): number | null {
  if (!KEYS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.defaultPrevented) return null
  const root = e.currentTarget
  const items = Array.from(root.querySelectorAll<HTMLElement>(opts.selector)).filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return null
  const active = document.activeElement
  const at = items.findIndex((el) => el === active || (!!active && el.contains(active)))
  const next = gridNext(at, e.key, gridColumns(root.querySelector('[data-grid]') ?? root), items.length)
  if (next === null) return null
  e.preventDefault()
  if (next !== at) items[next].focus()
  return next
}
