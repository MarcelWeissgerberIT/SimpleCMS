/* ------------------------------------------------------------------ */
/* A press that closes something — a dialog's key or scrim, a toast's  */
/* key — and the rest of that gesture: the second click of a mouse     */
/* double-click, a finger's double tap. For a moment after the close   */
/* that rest never acts on what now lies under the pointer (the app,   */
/* the side peek, a new toast in the old one's place). Single clicks   */
/* are never touched; a touch tap only near the closing tap.           */
/* ------------------------------------------------------------------ */

/** A press on a key (or a scrim) that may close what it sits on. */
export interface Press {
  at: number
  x: number
  y: number
  /** touch or pen (a mouse: false) */
  touch: boolean
  /** the box of the key pressed (null: no key — a scrim) */
  box: { left: number; top: number; right: number; bottom: number } | null
}

/** How long after closing the rest of the closing gesture is swallowed. */
const THROUGH_MS = 450
/** A mouse's next press this close to the closing one can be the same double-click (px; the click count decides). */
const CLICK_SLOP = 16
/** A second tap this close to the closing tap belongs to the same gesture (px) — a finger lands that far apart. */
const TAP_SLOP = 32
/** … and so does one anywhere on the closing key, its box widened by this much (px). */
const KEY_PAD = 8
/** A press longer ago than this did not close it (a key, a timer did). */
const PRESS_FRESH_MS = 1000
const EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const
/** What counts as the key pressed (its box widens a touch's second tap). */
const KEY = 'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="tab"], summary, label'

interface Armed extends Press {
  until: number
  /** a dialog closed: presses inside a modal dialog still open are that dialog's own (a toast: nothing is exempt) */
  exemptModals: boolean
}

let armed: Armed | null = null
let timer = 0
/**
 * A mouse press near the closing one: its pointerdown carries no click count (0 in Chrome), so whether it is the
 * double-click's second press is known only at its mousedown. Outside-press handlers wait for that (outsidePress()).
 */
let undecided: { event: Event; runs: Array<() => void> } | null = null

/** The press of a pointer event, with the key it landed on. */
export function pressOf(e: { clientX: number; clientY: number; pointerType?: string; target: EventTarget | null }): Press {
  const key = e.target instanceof Element ? e.target.closest(KEY) : null
  const r = key?.getBoundingClientRect()
  return {
    at: performance.now(),
    x: e.clientX,
    y: e.clientY,
    touch: !!e.pointerType && e.pointerType !== 'mouse',
    box: r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
  }
}

function pointOf(e: Event): { x: number; y: number } | null {
  if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
    const p = e.changedTouches[0]
    return p ? { x: p.clientX, y: p.clientY } : null
  }
  return e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : null
}

/** Near the closing press: a mouse within a few px (the click count decides); a tap within reach of a finger, or on the key. */
function near(g: Press, p: { x: number; y: number }): boolean {
  const d = Math.hypot(p.x - g.x, p.y - g.y)
  if (!g.touch) return d <= CLICK_SLOP
  if (d <= TAP_SLOP) return true
  const b = g.box
  return !!b && p.x >= b.left - KEY_PAD && p.x <= b.right + KEY_PAD && p.y >= b.top - KEY_PAD && p.y <= b.bottom + KEY_PAD
}

/** Armed, in time, near, outside an exempt dialog: the event may belong to the closing gesture. */
function candidate(e: Event): Armed | null {
  const g = armed
  if (!g) return null
  if (performance.now() > g.until) {
    disarm()
    return null
  }
  if (g.exemptModals && e.target instanceof Element && e.target.closest('[aria-modal="true"]')) return null
  const p = pointOf(e)
  return p && near(g, p) ? g : null
}

/** A mouse event's click count — the second press of a double-click (or later) counts. */
const repeat = (e: Event) => (e as UIEvent).detail >= 2

function decide(run: boolean) {
  const u = undecided
  undecided = null
  if (run) for (const f of u?.runs ?? []) f()
}

/** A mouse pointerdown near the closing press: undecided until its mousedown (true — it is, or was already). */
function undecidedPress(e: Event, g: Armed | null): boolean {
  if (undecided?.event === e) return true
  if (!g || g.touch || e.type !== 'pointerdown' || (e as PointerEvent).pointerType !== 'mouse') return false
  decide(true)
  undecided = { event: e, runs: [] }
  return true
}

/** Capture listener while armed: swallows the rest of the closing gesture. */
function swallow(e: Event) {
  const g = candidate(e)
  // the mousedown (or, its pointerdown cancelled, the click) of an undecided press: a double-click's second, or not
  if (undecided && undecided.event !== e && (e.type === 'mousedown' || e.type === 'click')) decide(!g || !repeat(e))
  if (!g || undecidedPress(e, g)) return
  if (!g.touch && !repeat(e)) return
  e.stopImmediatePropagation()
  if (e.cancelable && e.type !== 'touchstart') e.preventDefault()
}

/**
 * Something just closed by `press`: swallow the rest of that gesture for a moment. A press older than a second did not
 * close it (nothing is armed). `exemptModals`: presses inside a modal dialog still open are left to it (a dialog that
 * closed — the dialog below or the one it opened has its own guard); a toast's key exempts nothing.
 */
export function armClosingGesture(press: Press | null, opts: { exemptModals?: boolean } = {}): void {
  if (!press || performance.now() - press.at > PRESS_FRESH_MS) return
  decide(true)
  armed = { ...press, until: performance.now() + THROUGH_MS, exemptModals: opts.exemptModals ?? true }
  if (timer) window.clearTimeout(timer)
  else for (const type of EVENTS) window.addEventListener(type, swallow, { capture: true, passive: type === 'touchstart' })
  timer = window.setTimeout(disarm, THROUGH_MS)
}

function disarm() {
  if (!timer) return
  window.clearTimeout(timer)
  timer = 0
  armed = null
  for (const type of EVENTS) window.removeEventListener(type, swallow, { capture: true })
  // a press still undecided (held down): not a quick double-click
  decide(true)
}

/**
 * Is this event (or may it be) the rest of a gesture that just closed something? A touch tap near the closing tap, a
 * mouse press counted as a double-click's second — or a mouse pointerdown near the closing press, whose click count
 * is not known yet (outside-press handlers use outsidePress(), which waits for it).
 */
export function inClosingGesture(e: Event): boolean {
  const g = candidate(e)
  if (undecidedPress(e, g)) return true
  return !!g && (g.touch || repeat(e))
}

/**
 * For "a press outside closes me" handlers on pointerdown (popovers, the side peek): `close` runs now — unless the
 * press is the rest of a closing gesture (the second click of the double-click that closed a dialog over it). A mouse
 * press near the closing one is decided at its mousedown: the double-click's second press closes nothing, a press of
 * its own (click count 1) closes as usual, right then.
 */
export function outsidePress(e: Event, close: () => void): void {
  if (!inClosingGesture(e)) close()
  else if (undecided?.event === e) undecided.runs.push(close)
}
