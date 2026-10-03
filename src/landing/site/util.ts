/** Small helpers shared by the site sections. */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escape text for safe interpolation into HTML strings. */
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESC[c])
}

/** Resolve a public asset path (no leading slash) against the Vite base. */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Wrap every character of an element's text in a span (for type-on effects). The visible
 * characters are aria-hidden; a visually hidden copy keeps the text for screen readers
 * (aria-label on a generic span is ignored).
 */
export function splitChars(el: HTMLElement): HTMLElement[] {
  const text = el.textContent ?? ''
  el.textContent = ''
  const sr = document.createElement('span')
  sr.className = 'sr'
  sr.textContent = text
  el.appendChild(sr)
  const spans: HTMLElement[] = []
  for (const ch of text) {
    const s = document.createElement('span')
    s.className = 'ch'
    s.setAttribute('aria-hidden', 'true')
    s.textContent = ch
    el.appendChild(s)
    spans.push(s)
  }
  return spans
}
