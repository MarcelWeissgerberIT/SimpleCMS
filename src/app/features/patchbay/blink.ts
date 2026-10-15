/**
 * The fuse blink (plan §3.5, WCAG 2.2.2): a fuse blinks on its first appearance per (fuse key, signature) in this tab —
 * 3 cycles over 2.7 s, then it stays lit. Preflight's `blinkOf` pattern, re-implemented here (features/preflight is not
 * imported for it): every element of one fuse (the plate's LED, its tab, the glyph's ring) asks with the same id and
 * gets the same start, so they blink in step; a remount resumes where the blink is (a negative delay), a later one does
 * not blink again. A changed signature (a lapsed allowance, a re-wired path) is a new appearance.
 *
 * `noBlink()` (the seam, `window.__onePatchbay.noBlink()`) switches it off for screenshots; with reduced motion the CSS
 * never animates (patchbay.css). Dependency-free.
 */
export const BLINK_MS = 2700

const started = new Map<string, { hash: string; at: number }>()
let off = false

/** Screenshots: no blink from now on (this tab). */
export function noBlink(): void {
  off = true
  try {
    document.documentElement.setAttribute('data-pb-noblink', '')
  } catch {
    /* no DOM */
  }
}

/** Whether `id` blinks now (its first appearance with `hash`, or still within its 2.7 s) and the animation's delay. */
export function blinkOf(id: string, hash: string, now = Date.now()): { on: boolean; delay: number } {
  if (off) return { on: false, delay: 0 }
  const cur = started.get(id)
  if (!cur || cur.hash !== hash) {
    started.set(id, { hash, at: now })
    return { on: true, delay: 0 }
  }
  const elapsed = now - cur.at
  if (elapsed >= BLINK_MS) return { on: false, delay: 0 }
  return { on: true, delay: -elapsed }
}

/** The inline style a blinking element carries (its delay; CSS reads `--pb-blink-delay`). */
export const blinkStyle = (b: { on: boolean; delay: number }): Record<string, string> | undefined => (b.on ? { ['--pb-blink-delay']: `${Math.round(b.delay)}ms` } : undefined)
