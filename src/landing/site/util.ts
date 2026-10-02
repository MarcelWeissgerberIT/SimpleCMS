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

/** Wrap every character of an element's text in a span (for type-on effects). Keeps aria via aria-label. */
export function splitChars(el: HTMLElement): HTMLElement[] {
  const text = el.textContent ?? ''
  el.setAttribute('aria-label', text)
  el.textContent = ''
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

/** Deterministic PRNG (mulberry32) — for schematic drawings that must look the same every time. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
