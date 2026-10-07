import type { SyntheticEvent } from 'react'

/**
 * A label cut short with an ellipsis tells its full text on hover: call from onMouseEnter / onFocus of the
 * host (a menu item, a select key). The host gets a `title` only while the label (the host itself, or
 * `selector` inside it) is really clipped; a title this helper did not set is never touched.
 */
export function titleIfClipped(e: SyntheticEvent<HTMLElement>, selector?: string): void {
  const host = e.currentTarget
  const label = selector ? host.querySelector<HTMLElement>(selector) : host
  if (!label) return
  if (label.scrollWidth > label.clientWidth + 1) {
    host.title = (label.textContent ?? '').trim()
    host.dataset.clipTitle = ''
  } else if (host.dataset.clipTitle !== undefined) {
    host.removeAttribute('title')
    delete host.dataset.clipTitle
  }
}
