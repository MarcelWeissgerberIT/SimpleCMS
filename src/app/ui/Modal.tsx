import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../i18n'
import { titleIfClipped } from './clip'
import { canFocus, focusLost, focusNear, mainRegion, restoreFocus, takeFocusHandoff } from './focus'
import { armClosingGesture, armOpeningGesture, pressOf, type Press } from './gesture'
import { holdBackgroundToasts } from '../store/ui'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /**
   * Mono label shown before the title, e.g. "§ 04" or "SETTINGS". A title that fits on one line beside it stays there;
   * one that would wrap in a narrow column beside it (under ~13em, a phone) or beside a label taking a good part of the
   * row goes below it, the label on its own line above, cut with "…" (its full text as a title on hover).
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

const anyOpen = () => stack.some((e) => e.dialog.isConnected)

/**
 * Background toasts (agent runs) never sit over a dialog: held while one is open, shown once the last one has closed —
 * a frame later, so a dialog that closes as the next one opens (setup → editor) keeps them held.
 */
function holdToasts() {
  if (anyOpen()) return holdBackgroundToasts(true)
  requestAnimationFrame(() => holdBackgroundToasts(anyOpen()))
}

/**
 * Focus back to the dialog's opener (or the key standing for it when it is hidden now — a row's action key shown only
 * on hover) — or, when that is gone (it closed with this dialog, a route change took it), inert or unable to take it
 * (disabled meanwhile), to the opener of the next dialog on the stack, then into the dialog still open, then the main
 * region (as the skip link). Never the page body, whatever order dialogs closing together clean up in — also when
 * nothing had the focus when the dialog opened.
 */
function giveFocusBack(prev: HTMLElement | null) {
  if (canFocus(prev)) {
    restoreFocus(prev)
    if (!focusLost()) return
  }
  if (!focusLost() || (prev && focusNear(prev))) return
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

/** A title that would wrap beside the label keeps at least this much room (in its own font size) there; less, and the label goes above it. */
const TITLE_ROOM_EM = 13
/** A label wider than this share of the header row goes above a title that would wrap beside it. */
const LABEL_SHARE = 0.3

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
    // the opener — or, focus already gone with a menu that opened this dialog (the palette too), the key it handed over
    const active = document.activeElement
    const prev = canFocus(active) ? active : takeFocusHandoff()
    stack.push({ dialog, prev })
    lockBackground()
    holdToasts()
    // opened by a tap: a double tap's second tap never presses what now lies under the finger in here
    armOpeningGesture(dialog.parentElement ?? dialog)
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
      holdToasts()
      // closed (not just re-run): look after focus for a moment; closed by a press, swallow the rest of its gesture
      if (dialog.isConnected) return
      const now = document.activeElement
      watchFocus(now instanceof HTMLElement && now !== document.body ? now : null)
      armClosingGesture(press.current)
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
      const labelWidth = lab.scrollWidth
      const room = inner - labelWidth - close - 2 * gap
      // the title's width on one line (the same in either layout)
      const ws = title.style.whiteSpace
      title.style.whiteSpace = 'nowrap'
      const range = document.createRange()
      range.selectNodeContents(title)
      const oneLine = range.getBoundingClientRect().width
      title.style.whiteSpace = ws
      // a title that fits on one line beside the label stays there; one that would wrap goes below the label when
      // that leaves it too narrow a column (under ~13em) or the label takes a good part of the row
      const wraps = oneLine > room + 0.5
      const stack = wraps && (room < TITLE_ROOM_EM * parseFloat(getComputedStyle(title).fontSize) || labelWidth > LABEL_SHARE * inner)
      head.toggleAttribute('data-stacked', stack)
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(head)
    ro.observe(lab)
    ro.observe(title)
    return () => ro.disconnect()
  }, [open, label])

  if (!open) return null
  const named = !bare && title !== undefined && title !== null && title !== ''
  /** A press in the dialog or on its scrim (a close right after it swallows the rest of that gesture). */
  const pressed = (e: ReactPointerEvent) => {
    press.current = pressOf(e)
  }
  /**
   * The rest of a double-click whose first click opened this dialog never acts in it: the second press would land on
   * whatever now sits under the pointer (a footer key, the scrim). A click count above 1 before any click sequence
   * began inside the dialog is swallowed; a sequence that starts here (count 1) is the person's own. A finger's double
   * tap counts 1 on its second click: armOpeningGesture() (as the dialog opens) takes care of that.
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
