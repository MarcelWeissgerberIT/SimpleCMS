/**
 * Arrow-key navigation for radio groups and listboxes built from buttons (WAI-ARIA "roving focus"):
 * ←/→/↑/↓ move to the previous/next enabled item and select it, Home/End jump to the ends.
 * Pair with tabIndex={selected ? 0 : -1} on the items so Tab enters the group once.
 */
import type { KeyboardEvent } from 'react'

const KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'])

export function onRovingKey(e: KeyboardEvent<HTMLElement>, selector = '[role="radio"], [role="option"], [role="tab"]'): void {
  if (!KEYS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : at < 0 ? 0 : (at + step + items.length) % items.length
  e.preventDefault()
  items[next].focus()
  if (next !== at) items[next].click()
}
