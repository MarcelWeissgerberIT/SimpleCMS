import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Focus going back to where it was (a dialog, the palette … closing).
 *
 * A text editor (the ProseMirror root of a TipTap editor, which carries its editor as `dom.editor`)
 * gets it through its view, which puts the editor's own caret back. A plain focus() lets the browser
 * drop the caret at the start of the document, and ProseMirror only takes that back when the last
 * click in the editor was more than 300 ms ago — quick hands (click, ⌘K, Esc) would type at the start.
 */
interface EditorRoot extends HTMLElement {
  editor?: { isDestroyed: boolean; isEditable: boolean; view: { dom: Element; focus: () => void } }
}

export function restoreFocus(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) return
  const editor = (el as EditorRoot).editor
  if (editor && !editor.isDestroyed && editor.isEditable && editor.view.dom === el) editor.view.focus()
  else el.focus({ preventScroll: true })
}

/* ------------------------------------------------------------------ */
/* Focus never ends on the page body: dialogs, menus and toasts that   */
/* close give it back — to their opener, a key beside it, the main     */
/* region.                                                             */
/* ------------------------------------------------------------------ */

/** Can take focus: in the document, not inert, shown, not disabled (nor marked aria-disabled — a key that cannot act). */
export const canFocus = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement &&
  el !== document.body &&
  el.isConnected &&
  !el.closest('[inert]') &&
  !el.matches(':disabled') &&
  el.getAttribute('aria-disabled') !== 'true' &&
  (el.offsetParent !== null || el.getClientRects().length > 0)

/** Focus is nowhere (the page body) or on something removed or inert. */
export const focusLost = (): boolean => !canFocus(document.activeElement)

/** The main region (the skip link's target): where focus goes when nothing better is left. */
export const mainRegion = (): HTMLElement | null => document.querySelector<HTMLElement>('#main:not([data-folded]), .stage-col[tabindex]:not([data-folded]), main[tabindex]')

/**
 * Nothing in particular has the focus: the page body, or the main region itself — where a closing dialog, menu or toast
 * leaves it when nothing better is left. "Take the keyboard if nobody has it" checks use this, never `=== body`.
 */
export function focusIsNowhere(el: Element | null = document.activeElement): boolean {
  return !el || el === document.body || el === document.documentElement || el.matches('#main, .stage-col[tabindex], main[tabindex]')
}

/** Main region, as the last place for focus to go. True when it took it. */
export function focusMainRegion(): boolean {
  const main = mainRegion()
  if (!canFocus(main)) return false
  restoreFocus(main)
  return !focusLost()
}

const TAB_STOP = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
/** Among the keys around a hidden opener, these stand for its row or item (a sidebar row's link). */
const ITEM = '[role="treeitem"], [role="row"], [role="option"], [role="gridcell"], a[href]'

/** A focusable stand-in inside `root`: its row / item first, else its first visible tab stop. */
function standIn(root: Element): HTMLElement | null {
  const keys = Array.from(root.querySelectorAll<HTMLElement>(TAB_STOP)).filter((k) => canFocus(k) && getComputedStyle(k).opacity !== '0')
  return keys.find((k) => k.matches(ITEM)) ?? keys[0] ?? null
}

/**
 * Focus `el` — or, when it cannot take it now (an action key shown only on hover, a row that is no key itself), the
 * key that stands for it nearby: its row's link, the first visible key of the closest container that has one (never
 * past a dialog, a popover or the main region). True when focus landed.
 */
export function focusNear(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[inert]')) return false
  if (canFocus(el) && el.matches(`${TAB_STOP}, [tabindex]`)) {
    restoreFocus(el)
    if (!focusLost()) return true
  }
  for (let box: HTMLElement | null = el, depth = 0; box && depth < 4; box = box.parentElement, depth++) {
    if (box === document.body || (box !== el && box.matches('[role="dialog"], [data-popover], main, #main, .stage-col'))) break
    const key = standIn(box)
    if (!key) continue
    restoreFocus(key)
    if (!focusLost()) return true
  }
  return false
}

/*
 * A key in a menu (or the palette, a toast) that opens a dialog: the menu is gone before the dialog opens, so the
 * dialog would find focus on the page body. The menu hands its trigger over for a moment; the dialog opening then takes
 * it as the element to give focus back to. A submenu and its menu closing together hand over both: the first one still
 * in the document wins (the submenu's own opener is an item of the menu that closed).
 */
let handed: Array<{ el: HTMLElement; until: number }> = []
const HANDOFF_MS = 1000

/** Hand `el` to a dialog that opens in a moment (it gives focus back there when it closes). */
export function handFocusOver(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement) || el === document.body || !el.isConnected) return
  const now = performance.now()
  handed = [...handed.filter((h) => h.el !== el && h.until >= now), { el, until: now + HANDOFF_MS }]
}

/** The element handed over a moment ago and still in the document (once — the rest are dropped). */
export function takeFocusHandoff(): HTMLElement | null {
  const now = performance.now()
  const h = handed.find((x) => x.until >= now && x.el.isConnected)
  handed = []
  return h?.el ?? null
}

/** No dialog took `el` (still handed over): drop it. */
export function dropFocusHandoff(el: Element | null | undefined): void {
  handed = handed.filter((h) => h.el !== el)
}

/** Triggers of menus that just closed, checked together (a submenu closes with its menu). */
let returning: { triggers: HTMLElement[]; route: string } | null = null
/** The route when a menu item was picked — before its action ran (it may navigate before the menu closes). */
let picked: { route: string; at: number } | null = null
const PICK_FRESH_MS = 1000
/** The view shown: the hash without its query (`?b=` only scrolls the same page). */
const routeNow = () => window.location.hash.split('?')[0]

/** A menu item is picked: note the route before its action runs (ui/Menu.tsx; returnFocusAfterClose compares with it). */
export function notePick(): void {
  picked = { route: routeNow(), at: performance.now() }
}

/** How long after a pick changed the route its new view is watched (it renders a moment later, the main region anew). */
const ROUTE_WATCH_MS = 600

/**
 * A pick changed the route: the new view renders a moment later and replaces the main region (the shell keys it by
 * route), taking the focus with it. For a moment, focus that falls to the page body (two frames in a row) goes to the
 * main region again — unless something of the new view took it.
 */
function mainAfterRoute(): void {
  const until = performance.now() + ROUTE_WATCH_MS
  let lost = false
  const check = () => {
    if (focusLost() && lost) focusMainRegion()
    lost = focusLost()
    if (performance.now() < until) requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/**
 * A menu closed by Esc or by a pick: focus goes back to `trigger` — the ARIA menu button — unless the pick moved it on
 * (a dialog opened, a field took it, the route changed). Checked two frames later, when what the pick opened has taken
 * the keyboard; a dialog opening right away gets `trigger` handed over. Of menus closing together the first trigger
 * still there takes it; all of them gone: the main region. A pick that changed the route (compared with the route
 * before the pick's action ran — notePick()) leaves focus to the new view: the main region unless something there took it.
 */
export function returnFocusAfterClose(trigger: Element | null | undefined): void {
  if (!(trigger instanceof HTMLElement) || trigger === document.body) return
  handFocusOver(trigger)
  if (returning) {
    returning.triggers.push(trigger)
    return
  }
  const route = picked && performance.now() - picked.at <= PICK_FRESH_MS ? picked.route : routeNow()
  picked = null
  const batch = { triggers: [trigger], route }
  returning = batch
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      returning = null
      batch.triggers.forEach(dropFocusHandoff)
      if (!focusLost()) return
      if (routeNow() !== batch.route) {
        focusMainRegion()
        mainAfterRoute()
        return
      }
      const live = batch.triggers.filter((t) => t.isConnected)
      if (live.some((t) => focusNear(t))) return
      if (live.length < batch.triggers.length) focusMainRegion()
    }),
  )
}


/**
 * Focus a field that a click is about to show — in the same commit, not a frame later: the first letters
 * typed right after the click (on a busy machine a frame can take long) would go elsewhere. Call the
 * returned function together with the state change that mounts the field (already shown: focused at once).
 */
export function useFocusWhenShown<T extends HTMLElement>(ref: RefObject<T | null>): () => void {
  const want = useRef(false)
  useLayoutEffect(() => {
    if (!want.current || !ref.current) return
    want.current = false
    ref.current.focus({ preventScroll: true })
  })
  return useCallback(() => {
    if (ref.current) ref.current.focus({ preventScroll: true })
    else want.current = true
  }, [ref])
}
