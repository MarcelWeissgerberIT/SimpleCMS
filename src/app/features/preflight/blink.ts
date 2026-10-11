/**
 * The blink: 3 cycles once per (lamp, ids hash) per tab — a remount resumes it where it is (a negative delay), a later
 * one does not blink again. `noBlink()` (the seam) switches it off for screenshots.
 */
const BLINK_MS = 2700

const started = new Map<string, { hash: string; at: number }>()
let off = false

export function noBlink(): void {
  off = true
  document.documentElement.setAttribute('data-pf-noblink', '')
}

/**
 * Whether this lamp blinks now and the delay to give its animation (ms; negative = already running). `delay` is when
 * it may start (the end of the lamp test when it ran in this render).
 */
export function blinkOf(id: string, hash: string, delay: number, now = Date.now()): { on: boolean; delay: number } {
  if (off) return { on: false, delay: 0 }
  const cur = started.get(id)
  if (!cur || cur.hash !== hash) {
    started.set(id, { hash, at: now + delay })
    return { on: true, delay }
  }
  const elapsed = now - cur.at
  if (elapsed >= BLINK_MS) return { on: false, delay: 0 }
  return { on: true, delay: -elapsed }
}
