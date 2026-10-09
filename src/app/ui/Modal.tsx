import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../i18n'
import { titleIfClipped } from './clip'
import { restoreFocus } from './focus'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /**
   * Mono label shown before the title, e.g. "§ 04" or "SETTINGS". One too long to leave the title a comfortable width
   * beside it (a phone) goes on its own line above the title, cut with "…" (its full text as a title on hover).
   */
  label?: string
  children: ReactNode
  footer?: ReactNode
  width?: number | string
  className?: string
  /** Hide the default header (render your own). */
  bare?: boolean
  /**
   * Accessible name when there is no visible title. Bare modals otherwise take their
   * [data-modal-title] element, or their first heading.
   */
  ariaLabel?: string
}

/* ------------------------------------------------------------------ */
/* While any modal is open, the app behind it is inert (no Tab, no     */
/* clicks, hidden from screen readers). Toasts stay live and usable.   */
/* Modals and popovers are portaled to <body>, outside the app root.   */
/* ------------------------------------------------------------------ */

/** The open dialogs, each with the element focused when it opened (its opener). */
const stack: Array<{ dialog: HTMLElement; prev: HTMLElement | null }> = []
/** null = the background is not locked */
let inerted: Element[] | null = null

function lockBackground() {
  if (inerted) return
  const root = document.getElementById('root')
  if (!root) return
  // the app shell's direct children (fall back to #root itself when there is no shell)
  const shell = root.querySelector(':scope > .app')
  const targets = shell ? Array.from(shell.children) : [root]
  inerted = targets.filter((el) => !el.matches('.toasts, [data-modal-keep]') && !el.hasAttribute('inert'))
  inerted.forEach((el) => el.setAttribute('inert', ''))
}

/** Once no dialog is in the document any more — dialogs closing in the same commit are gone before their cleanup runs. */
function unlockBackground() {
  if (!inerted || stack.some((e) => e.dialog.isConnected)) return
  inerted.forEach((el) => el.removeAttribute('inert'))
  inerted = null
}

/** Can take focus: in the document, not inert, shown. */
const canFocus = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement && el !== document.body && el.isConnected && !el.closest('[inert]') && (el.offsetParent !== null || el.getClientRects().length > 0)

/** Focus is nowhere (the page body) or on something removed or inert. */
const focusLost = () => !canFocus(document.activeElement)

/** The main region (the skip link's target): where focus goes when nothing better is left. */
const mainRegion = () => document.querySelector<HTMLElement>('#main:not([data-folded]), .stage-col[tabindex]:not([data-folded]), main[tabindex]')

const anyOpen = () => stack.some((e) => e.dialog.isConnected)

/**
 * Focus back to the dialog's opener — or, when that is gone (it closed with this dialog, a route change took it), inert
 * or unable to take it (disabled meanwhile), to the opener of the next dialog on the stack, then into the dialog still
 * open, then the main region (as the skip link). Never the page body, whatever order dialogs closing together clean up
 * in — unless nothing had the focus when the dialog opened.
 */
function giveFocusBack(prev: HTMLElement | null) {
  if (canFocus(prev)) {
    restoreFocus(prev)
    if (!focusLost()) return
  }
  if (!prev || prev === document.body || !focusLost()) return
  const open = [...stack].reverse().find((e) => e.dialog.isConnected)?.dialog
  const openers = [...stack].reverse().flatMap((e) => (e.prev && e.prev !== prev && (!open || open.contains(e.prev)) ? [e.prev] : []))
  for (const el of [...openers, open, mainRegion()]) {
    if (!canFocus(el)) continue
    restoreFocus(el)
    if (!focusLost()) return
  }
}

/* ------------------------------------------------------------------ */
/* After closing, for a moment: focus that is taken away (the element  */
/* it went back to unmounts — a dialog action that changes the route)  */
/* goes to the main region, never to the page body.                    */
/* ------------------------------------------------------------------ */

/** How long after a dialog closed (or after a route change within that time) focus is looked after. */
const FOCUS_WATCH_MS = 600

let watch: { given: HTMLElement | null; until: number; routed: boolean; raf: number } | null = null

/** A route change right after closing: it renders later and takes the element focus went back to — keep watching. */
function onRouteChange() {
  if (!watch || watch.routed || performance.now() > watch.until) return
  watch.routed = true
  watch.until = performance.now() + FOCUS_WATCH_MS
}

function stopFocusWatch() {
  if (!watch) return
  cancelAnimationFrame(watch.raf)
  watch = null
  window.removeEventListener('hashchange', onRouteChange)
  window.removeEventListener('popstate', onRouteChange)
}

/**
 * Watch focus for a moment after a dialog closed: when it lands on the page body because the element it went back to
 * (`given`) was removed or cannot hold it — or after a route change in that moment — it goes to the main region. A
 * person's own click on an empty spot (the element given is still there) is left alone, and so is an open dialog.
 */
function watchFocus(given: HTMLElement | null) {
  stopFocusWatch()
  window.addEventListener('hashchange', onRouteChange)
  window.addEventListener('popstate', onRouteChange)
  const w = { given, until: performance.now() + FOCUS_WATCH_MS, routed: false, raf: 0 }
  watch = w
  // lost for two frames in a row: code that puts focus back a frame after its own close (menus, panels) goes first
  let lost = false
  const check = () => {
    if (watch !== w) return
    const now = !anyOpen() && focusLost() && ((!!w.given && !canFocus(w.given)) || w.routed)
    if (now && lost) {
      const main = mainRegion()
      if (canFocus(main)) restoreFocus(main)
    }
    lost = now && focusLost()
    if (performance.now() > w.until && !lost) return stopFocusWatch()
    w.raf = requestAnimationFrame(check)
  }
  w.raf = requestAnimationFrame(check)
}

/* ------------------------------------------------------------------ */
/* A dialog closed by a pointer: the rest of that gesture (the second  */
/* click of a double-click, a double tap) never acts on what lies      */
/* underneath — for a moment, outside any dialog still open.           */
/* ------------------------------------------------------------------ */

/** A press in a dialog or on its scrim. */
interface Press {
  at: number
  x: number
  y: number
  /** touch or pen (a mouse: false) */
  touch: boolean
}

/** How long after closing the rest of the closing gesture is swallowed. */
const THROUGH_MS = 450
/** A tap (or a mouse's next click) this close to the closing press belongs to the same gesture (px). */
const TAP_SLOP = 16
/** A press longer ago than this did not close the dialog (a key, a timer did). */
const PRESS_FRESH_MS = 1000
const THROUGH_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const

let through: (Press & { until: number }) | null = null
let throughTimer = 0

function pointOf(e: Event): { x: number; y: number } | null {
  if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
    const p = e.changedTouches[0]
    return p ? { x: p.clientX, y: p.clientY } : null
  }
  return e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : null
}

/**
 * Capture listener while armed: a mouse's second click (click count ≥ 2 — single clicks are never touched) or a touch /
 * pen tap near the closing press, landing outside any dialog still open (its scrim counts as outside), is swallowed.
 */
function swallowThrough(e: Event) {
  const g = through
  if (!g || performance.now() > g.until) return disarmThrough()
  if (e.target instanceof Element && e.target.closest('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')) return
  const p = pointOf(e)
  if (!p || Math.hypot(p.x - g.x, p.y - g.y) > TAP_SLOP) return
  if (!g.touch && (e as UIEvent).detail < 2) return
  e.stopImmediatePropagation()
  if (e.cancelable && e.type !== 'touchstart') e.preventDefault()
}

function armThrough(p: Press) {
  through = { ...p, until: performance.now() + THROUGH_MS }
  if (throughTimer) window.clearTimeout(throughTimer)
  else for (const type of THROUGH_EVENTS) window.addEventListener(type, swallowThrough, { capture: true, passive: type === 'touchstart' })
  throughTimer = window.setTimeout(disarmThrough, THROUGH_MS)
}

function disarmThrough() {
  if (!throughTimer) return
  window.clearTimeout(throughTimer)
  throughTimer = 0
  through = null
  for (const type of THROUGH_EVENTS) window.removeEventListener(type, swallowThrough, { capture: true })
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex], [contenteditable="true"]'

/** Tab stops inside `root`: skips roving items (tabindex=-1), inert and hidden elements. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      el.getAttribute('tabindex') !== '-1' &&
      !el.closest('[inert]') &&
      (el.offsetParent !== null || el.getClientRects().length > 0),
  )
}

/** The title keeps at least this much room (in its own font size) beside the label; less, and the label goes above it. */
const TITLE_ROOM_EM = 13

/** Centered dialog with scrim. Escape / scrim click closes. Tab stays inside. Restores focus on close. */
export function Modal({ open, onClose, title, label, children, footer, width, className, bare, ariaLabel }: ModalProps) {
  const t = useT()
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // true until a click sequence starts inside this dialog (see `guard`)
  const fresh = useRef(true)
  // the last press in the dialog or on its scrim (null after a key): a close right after it was the pointer's
  const press = useRef<Press | null>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return
    fresh.current = true
    press.current = null
    const prev = document.activeElement as HTMLElement | null
    stack.push({ dialog, prev })
    lockBackground()
    const isTop = () => stack[stack.length - 1]?.dialog === dialog

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape' && !document.querySelector('[data-popover]')) {
        e.stopPropagation()
        press.current = null
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const active = document.activeElement as HTMLElement | null
      // menus and pickers opened from the dialog (portaled popovers) handle their own focus,
      // and so does any other modal surface on top (e.g. the command palette)
      if (active?.closest('[data-popover]')) return
      const otherModal = active?.closest('[aria-modal="true"]')
      if (otherModal && otherModal !== dialog) return
      const items = focusables(dialog)
      if (!items.length) {
        e.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const inside = !!active && dialog.contains(active)
      // compare by document position: focus may sit on a roving item (tabindex=-1)
      // or the dialog itself, which are not in the list of tab stops
      const before = (node: Node) => !!active && (active === node || !!(node.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_PRECEDING))
      const after = (node: Node) => !!active && (active === node || !!(node.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING))
      if (e.shiftKey && (!inside || before(first))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || after(last))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    const raf = requestAnimationFrame(() => {
      // bare modals bring their own header: name the dialog after its first heading
      if (bare && !ariaLabel && !dialog.hasAttribute('aria-labelledby')) {
        const heading = dialog.querySelector<HTMLElement>('[data-modal-title]') ?? dialog.querySelector<HTMLElement>('h1, h2, h3')
        if (heading) {
          if (!heading.id) heading.id = `${titleId}-h`
          dialog.setAttribute('aria-labelledby', heading.id)
        }
      }
      // an explicit [data-autofocus] wins over any earlier field or button
      const el =
        dialog.querySelector<HTMLElement>('[data-autofocus]') ??
        dialog.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not(.modal__close):not([disabled])')
      ;(el ?? dialog).focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      const i = stack.findLastIndex((e) => e.dialog === dialog)
      if (i >= 0) stack.splice(i, 1)
      // un-inert first: an inert element cannot take focus back
      unlockBackground()
      giveFocusBack(prev)
      // closed (not just re-run): look after focus for a moment; closed by a press, swallow the rest of its gesture
      if (dialog.isConnected) return
      const active = document.activeElement
      watchFocus(active instanceof HTMLElement && active !== document.body ? active : null)
      const p = press.current
      if (p && performance.now() - p.at < PRESS_FRESH_MS) armThrough(p)
    }
  }, [open, bare, ariaLabel, titleId])

  // a long label leaves the title a narrow column beside it (a phone): the label then gets its own line above the title
  useLayoutEffect(() => {
    const head = headRef.current
    const lab = head?.querySelector<HTMLElement>('.modal__label')
    const title = head?.querySelector<HTMLElement>('.modal__title')
    if (!open || !head || !lab || !title) return
    const fit = () => {
      const cs = getComputedStyle(head)
      const close = head.querySelector<HTMLElement>('.modal__close')?.offsetWidth ?? 0
      const gap = parseFloat(cs.columnGap) || 0
      const inner = head.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const room = inner - lab.scrollWidth - close - 2 * gap
      head.toggleAttribute('data-stacked', room < TITLE_ROOM_EM * parseFloat(getComputedStyle(title).fontSize))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(head)
    ro.observe(lab)
    return () => ro.disconnect()
  }, [open, label])

  if (!open) return null
  const named = !bare && title !== undefined && title !== null && title !== ''
  /** A press in the dialog or on its scrim (a close right after it swallows the rest of that gesture). */
  const pressed = (e: ReactPointerEvent) => {
    press.current = { at: performance.now(), x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' }
  }
  /**
   * The rest of a double-click whose first click opened this dialog never acts in it: the second press would land on
   * whatever now sits under the pointer (a footer key, the scrim). A click count above 1 before any click sequence
   * began inside the dialog is swallowed; a sequence that starts here (count 1) is the person's own.
   */
  const guard = (e: ReactMouseEvent) => {
    if (e.detail <= 1) {
      if (e.type === 'mousedown') fresh.current = false
      return
    }
    if (!fresh.current) return
    e.preventDefault()
    e.stopPropagation()
  }
  return createPortal(
    <div
      className="modal-scrim"
      onMouseDownCapture={guard}
      onMouseUpCapture={guard}
      onClickCapture={guard}
      onDoubleClickCapture={guard}
      onPointerDownCapture={pressed}
      onKeyDownCapture={() => (press.current = null)}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return
        // the press's own default would move focus to the page body once the dialog is gone: focus goes back instead
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={named && !ariaLabel ? titleId : undefined}
        aria-label={ariaLabel ?? (!named && !bare ? label : undefined)}
        tabIndex={-1}
        className={`modal ${className ?? ''}`}
        style={width ? { width: typeof width === 'number' ? `min(${width}px, 100%)` : width } : undefined}
      >
        {!bare && (
          <div className="modal__header" ref={headRef}>
            {label && (
              <span className="label modal__label" onMouseEnter={titleIfClipped}>
                {label}
              </span>
            )}
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            <button className="icon-btn modal__close" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        )}
        {bare ? children : <div className="modal__body">{children}</div>}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
