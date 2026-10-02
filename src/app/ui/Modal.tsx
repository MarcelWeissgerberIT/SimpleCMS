import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

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
}

/** Centered dialog with scrim. Escape / scrim click closes. Restores focus on close. */
export function Modal({ open, onClose, title, label, children, footer, width, className, bare }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-popover]')) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not(.modal__close)')
      ;(el ?? ref.current)?.focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`modal ${className ?? ''}`}
        style={width ? { width: typeof width === 'number' ? `min(${width}px, 100%)` : width } : undefined}
      >
        {!bare && (
          <div className="modal__header">
            {label && <span className="label">{label}</span>}
            <h2 className="modal__title">{title}</h2>
            <button className="icon-btn modal__close" onClick={onClose} aria-label="Close">
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
