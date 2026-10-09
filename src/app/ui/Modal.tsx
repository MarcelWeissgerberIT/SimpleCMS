import { useEffect, useId, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../i18n'
import { restoreFocus } from './focus'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Mono label shown before the title, e.g. "§ 04" or "SETTINGS" */
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

const stack: HTMLElement[] = []
let inerted: Element[] = []

function lockBackground() {
  if (stack.length !== 1) return
  const root = document.getElementById('root')
  if (!root) return
  // the app shell's direct children (fall back to #root itself when there is no shell)
  const shell = root.querySelector(':scope > .app')
  const targets = shell ? Array.from(shell.children) : [root]
  inerted = targets.filter((el) => !el.matches('.toasts, [data-modal-keep]') && !el.hasAttribute('inert'))
  inerted.forEach((el) => el.setAttribute('inert', ''))
}

function unlockBackground() {
  if (stack.length) return
  inerted.forEach((el) => el.removeAttribute('inert'))
  inerted = []
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

/** Centered dialog with scrim. Escape / scrim click closes. Tab stays inside. Restores focus on close. */
export function Modal({ open, onClose, title, label, children, footer, width, className, bare, ariaLabel }: ModalProps) {
  const t = useT()
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // true until a click sequence starts inside this dialog (see `guard`)
  const fresh = useRef(true)

  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return
    fresh.current = true
    const prev = document.activeElement as HTMLElement | null
    stack.push(dialog)
    lockBackground()
    const isTop = () => stack[stack.length - 1] === dialog

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape' && !document.querySelector('[data-popover]')) {
        e.stopPropagation()
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
      const i = stack.lastIndexOf(dialog)
      if (i >= 0) stack.splice(i, 1)
      // un-inert first: an inert element cannot take focus back
      unlockBackground()
      restoreFocus(prev)
    }
  }, [open, bare, ariaLabel, titleId])

  if (!open) return null
  const named = !bare && title !== undefined && title !== null && title !== ''
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
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
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
          <div className="modal__header">
            {label && <span className="label">{label}</span>}
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
