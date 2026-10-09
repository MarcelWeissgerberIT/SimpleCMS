/* ------------------------------------------------------------------ */
/* A press that closes something — a dialog's key or scrim, a toast's  */
/* key — and the rest of that gesture: the second click of a mouse     */
/* double-click, a finger's double tap. For a moment after the close   */
/* that rest never acts on what now lies under the pointer (the app,   */
/* the side peek, a new toast in the old one's place). Single clicks   */
/* are never touched; a touch tap only on the closing key or near the  */
/* closing tap on no key — a tap on another key is the person's own.   */
/* A dialog that a tap opens: the rest of that tap's gesture (a double */
/* tap's second tap) never acts in it either.                          */
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

/** How long after closing (or opening) the rest of that gesture is swallowed. */
const THROUGH_MS = 450
/** A mouse's next press this close to the closing one can be the same double-click (px; the click count decides). */
const CLICK_SLOP = 16
/** A second tap this close to the first one belongs to the same gesture (px) — a finger lands that far apart. */
const TAP_SLOP = 32
/** … and so does one anywhere on the key the first tap pressed, its box widened by this much (px). */
const KEY_PAD = 8
/** A press longer ago than this did not close (or open) it (a key, a timer did). */
const PRESS_FRESH_MS = 1000
/** A dialog that opens this long after a tap's click was handled (or later) was not opened by that tap. */
const OPENED_BY_CLICK_MS = 150
const EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const
/** What counts as the key pressed (its box widens a touch's second tap). */
const KEY = 'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="tab"], summary, label'
/**
 * What a tap acts on: a key, a field, a text to edit … A tap on one of these after a close is the person's own unless it
 * lies on the closing key itself — however near the closing tap it lands.
 */
const ACTS = `${KEY}, input, select, textarea, [contenteditable="true"], [contenteditable=""], [role="checkbox"], [role="switch"], [role="radio"], [role="link"], [role="treeitem"], [role="gridcell"], [role="slider"], [tabindex]:not([tabindex="-1"])`

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

/* -------- the last touch / pen tap: a dialog that opens right then knows the tap that opened it -------- */

/**
 * Where and when it pressed, whether it is up, whether its click is being handled now and when that ended (null: a
 * mouse press, a key, a cancelled touch).
 */
let lastTap: (Press & { up: boolean; clicking: boolean; clickEnd: number }) | null = null
if (typeof window !== 'undefined') {
  const opts = { capture: true, passive: true }
  window.addEventListener('pointerdown', (e) => (lastTap = e.pointerType && e.pointerType !== 'mouse' ? { ...pressOf(e), up: false, clicking: false, clickEnd: -Infinity } : null), opts)
  window.addEventListener('pointerup', (e) => {
    if (lastTap && e.pointerType !== 'mouse') lastTap.up = true
  }, opts)
  // a scroll or a pinch: no tap
  window.addEventListener('pointercancel', () => (lastTap = null), opts)
  // a tap's click (a swallowed tap has none): handled from its capture here to its bubbling back to the window — what
  // it opens (the app's handlers, React's commit and effects) opens in between
  const clickDone = (tap: NonNullable<typeof lastTap>) => {
    if (!tap.clicking) return
    tap.clicking = false
    tap.clickEnd = performance.now()
  }
  window.addEventListener('click', (e) => {
    const tap = lastTap
    if (!tap?.up || !e.isTrusted || performance.now() - tap.at > PRESS_FRESH_MS) return
    tap.clicking = true
    // a handler that stops the click on its way back: done after this task
    window.setTimeout(() => clickDone(tap), 0)
  }, opts)
  window.addEventListener('click', () => lastTap && clickDone(lastTap), { passive: true })
  // a key of the keyboard: what opens now was not opened by that tap
  window.addEventListener('keydown', () => (lastTap = null), opts)
}

function pointOf(e: Event): { x: number; y: number } | null {
  if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
    const p = e.changedTouches[0]
    return p ? { x: p.clientX, y: p.clientY } : null
  }
  return e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : null
}

/** On the key the press landed on, its box widened a little. */
function onKey(g: Press, p: { x: number; y: number }): boolean {
  const b = g.box
  return !!b && p.x >= b.left - KEY_PAD && p.x <= b.right + KEY_PAD && p.y >= b.top - KEY_PAD && p.y <= b.bottom + KEY_PAD
}

/**
 * Near the closing press: a mouse within a few px (the click count decides). A tap on the closing key (its box widened
 * a little), or within a finger's reach on a spot that acts on nothing (text, an empty area — where it would close a
 * popover or the side peek). A tap on another key that shows up there after the close is the person's own.
 */
function near(g: Press, p: { x: number; y: number }, target: EventTarget | null): boolean {
  const d = Math.hypot(p.x - g.x, p.y - g.y)
  if (!g.touch) return d <= CLICK_SLOP
  if (onKey(g, p)) return true
  return d <= TAP_SLOP && !(target instanceof Element && target.closest(ACTS))
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
  return p && near(g, p, e.target) ? g : null
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

/** Stops an event of a gesture's rest: no handler sees it, no default (a touch's click) follows. */
function stop(e: Event) {
  e.stopImmediatePropagation()
  if (e.cancelable && e.type !== 'touchstart') e.preventDefault()
}

/** Capture listener while armed: swallows the rest of the closing gesture. */
function swallow(e: Event) {
  const g = candidate(e)
  // the mousedown (or, its pointerdown cancelled, the click) of an undecided press: a double-click's second, or not
  if (undecided && undecided.event !== e && (e.type === 'mousedown' || e.type === 'click')) decide(!g || !repeat(e))
  if (!g || undecidedPress(e, g)) return
  if (!g.touch && !repeat(e)) return
  stop(e)
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

/* -------- a dialog opened by a tap: the rest of that tap's gesture never acts in it -------- */

let opening: (Press & { until: number; scope: Element }) | null = null
let openTimer = 0

/** Capture listener while a tap-opened dialog is new: swallows a tap of the same gesture inside it. */
function swallowOpening(e: Event) {
  const o = opening
  if (!o) return
  if (performance.now() > o.until) return disarmOpening()
  if (!(e.target instanceof Node) || !o.scope.contains(e.target)) return
  const p = pointOf(e)
  if (p && (Math.hypot(p.x - o.x, p.y - o.y) <= TAP_SLOP || onKey(o, p))) stop(e)
}

/**
 * A dialog (`scope`: its scrim, everything it covers) just opened. Opened by a touch or pen tap — while it is down, while
 * its click is handled or a moment after (a dialog that opens on its own later was not): for a moment a tap inside it
 * near that tap — within a finger's reach, or on the key it pressed (its box widened a little) — is the rest of that
 * gesture (a double tap's second) and never presses what now lies there. Its click often counts 1 on touch, so the
 * click count cannot tell (a mouse's double-click: the dialog's own guard).
 */
export function armOpeningGesture(scope: Element): void {
  const tap = lastTap
  const now = performance.now()
  if (!tap || !(tap.clicking || now - tap.clickEnd <= OPENED_BY_CLICK_MS || (!tap.up && now - tap.at <= PRESS_FRESH_MS))) return
  const { up: _up, clicking: _clicking, clickEnd: _end, ...press } = tap
  opening = { ...press, until: now + THROUGH_MS, scope }
  if (openTimer) window.clearTimeout(openTimer)
  else for (const type of EVENTS) window.addEventListener(type, swallowOpening, { capture: true, passive: type === 'touchstart' })
  openTimer = window.setTimeout(disarmOpening, THROUGH_MS)
}

function disarmOpening() {
  if (!openTimer) return
  window.clearTimeout(openTimer)
  openTimer = 0
  opening = null
  for (const type of EVENTS) window.removeEventListener(type, swallowOpening, { capture: true })
}

/**
 * Is this event (or may it be) the rest of a gesture that just closed something? A touch tap on the closing key or near
 * the closing tap on no key, a mouse press counted as a double-click's second — or a mouse pointerdown near the closing
 * press, whose click count is not known yet (outside-press handlers use outsidePress(), which waits for it).
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
