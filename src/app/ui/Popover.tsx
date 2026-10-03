import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset as offsetMw, shift, size, useFloating, type Placement, type VirtualElement } from '@floating-ui/react'

export type PopoverAnchor = Element | VirtualElement | null

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** Element (or virtual element with getBoundingClientRect) to anchor to. */
  anchor: PopoverAnchor
  placement?: Placement
  offset?: number
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Don't render the default .popover chrome (bring your own). */
  bare?: boolean
  /** Close when clicking outside (default true). */
  closeOnOutside?: boolean
  /** Focus the first focusable element on open (default true). */
  autoFocus?: boolean
  /** Match the anchor's width. */
  matchWidth?: boolean
  /**
   * Also shift along the cross axis to stay on screen (for side placements like 'right-start'
   * this means sideways, overlapping the anchor rather than running off the viewport).
   */
  shiftCrossAxis?: boolean
  role?: string
  'aria-label'?: string
}

/** Anchored floating panel in a portal. Escape and outside-click close it. */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-start',
  offset = 4,
  children,
  className,
  style,
  bare,
  closeOnOutside = true,
  autoFocus = true,
  matchWidth,
  shiftCrossAxis,
  role,
  ...rest
}: PopoverProps) {
  const { refs, floatingStyles } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offsetMw(offset),
      flip({ padding: 8 }),
      shift({ padding: 8, crossAxis: !!shiftCrossAxis }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          elements.floating.style.maxHeight = `${Math.max(160, Math.min(availableHeight, 560))}px`
          if (matchWidth) elements.floating.style.width = `${rects.reference.width}px`
        },
      }),
    ],
  })
  const floatingRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    refs.setPositionReference(anchor)
  }, [anchor, refs])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!closeOnOutside) return
      const target = e.target as Node
      if (floatingRef.current?.contains(target)) return
      if (anchor instanceof Element && anchor.contains(target)) return
      // clicks inside another (nested) popover should not close this one
      if ((target as Element).closest?.('[data-popover]')) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, anchor, closeOnOutside])

  useEffect(() => {
    if (!open || !autoFocus) return
    const id = requestAnimationFrame(() => {
      const root = floatingRef.current
      // an explicit [data-autofocus] wins over any earlier field or button
      const el = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, textarea, [tabindex="0"], button')
      el?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [open, autoFocus])

  if (!open || !anchor) return null
  return createPortal(
    <div
      ref={(el) => {
        floatingRef.current = el
        refs.setFloating(el)
      }}
      data-popover=""
      role={role}
      aria-label={rest['aria-label']}
      className={bare ? className : `popover ${className ?? ''}`}
      style={{ ...floatingStyles, ...style }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Build a virtual anchor from a DOMRect getter (e.g. editor selection coords). */
export function virtualAnchor(getRect: () => DOMRect): VirtualElement {
  return { getBoundingClientRect: getRect }
}

/** Virtual anchor at a pointer position. */
export function pointAnchor(x: number, y: number): VirtualElement {
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }
}
