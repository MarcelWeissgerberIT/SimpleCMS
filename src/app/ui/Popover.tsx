import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset as offsetMw, shift, size, useFloating, type Placement, type VirtualElement } from '@floating-ui/react'
import { useT } from '../i18n'
import { canResize, clearPopoverSize, loadPopoverSize, savePopoverSize, type PopoverSize } from './popoverSize'

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
  /**
   * A resize grip at the bottom-right corner (popovers that hold forms): drag it, or focus it and use
   * the arrow keys (Shift = bigger steps), to make the panel bigger — never smaller than its natural
   * size, never bigger than the screen. The value names the kind of popover: its size is remembered
   * per device (localStorage `one.popover.size:<kind>`); double-click the grip (or Home) = reset.
   * No grip on touch screens and phone widths.
   */
  resizable?: string
  role?: string
  'aria-label'?: string
}

const UNPLACED: CSSProperties = { opacity: 0, pointerEvents: 'none' }
/** The tallest a popover gets by itself (a resized one may use the whole screen). */
const MAX_HEIGHT = 560
/** Distance kept to the viewport edges. */
const EDGE = 8
const GRIP = 14

/** Focus a panel's field: an explicit [data-autofocus] wins over any earlier field or button. */
export function focusFirst(root: HTMLElement | null | undefined): boolean {
  const el = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, textarea, [tabindex="0"], button')
  if (!el) return false
  el.focus({ preventScroll: true })
  return true
}

/** Anchored floating panel in a portal. Escape and outside-click close it. Always kept on screen. */
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
  resizable,
  role,
  ...rest
}: PopoverProps) {
  const t = useT()
  const shown = open && !!anchor
  // the size the person gave this kind of popover (read once per opening)
  const session = useRef<{ kind: string | undefined; size: PopoverSize | null } | null>(null)
  if (!shown) session.current = null
  else if (!session.current) session.current = { kind: resizable, size: resizable && canResize() ? loadPopoverSize(resizable) : null }
  // the class's own max-width (px; Infinity = none), read once per panel element
  const cssMax = useRef<number | null>(null)
  // while / after resizing, the panel's top-left corner stays where it was (the grip follows the pointer)
  const [pinned, setPinned] = useState<{ x: number; y: number } | null>(null)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned

  const { refs, floatingStyles, isPositioned } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offsetMw(offset),
      flip({ padding: EDGE }),
      shift({ padding: EDGE, crossAxis: !!shiftCrossAxis }),
      size({
        padding: EDGE,
        apply({ rects, elements, availableWidth, availableHeight }) {
          const el = elements.floating
          if (pinnedRef.current) return
          if (cssMax.current === null) {
            el.style.maxWidth = ''
            const mw = parseFloat(getComputedStyle(el).maxWidth)
            cssMax.current = Number.isFinite(mw) ? mw : Infinity
          }
          const w = Math.max(0, Math.floor(availableWidth))
          const h = Math.max(0, Math.floor(availableHeight))
          const user = session.current?.size
          // never wider or taller than the room there is: the content wraps or scrolls inside
          el.style.maxWidth = `${Math.min(cssMax.current, w)}px`
          el.style.maxHeight = `${user ? h : Math.min(h, MAX_HEIGHT)}px`
          if (user) {
            el.style.minWidth = `${Math.min(user.w, w)}px`
            el.style.minHeight = `${Math.min(user.h, h)}px`
            // panels with inner scroll areas let them take the extra room (CSS: [data-resized])
            el.dataset.resized = ''
          }
          if (matchWidth) el.style.width = `${rects.reference.width}px`
        },
      }),
    ],
  })
  const floatingRef = useRef<HTMLDivElement | null>(null)
  const gripRef = useRef<HTMLButtonElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    refs.setPositionReference(anchor)
  }, [anchor, refs])

  // closed, or the window changed size: floating-ui places the panel again (with the person's size)
  useEffect(() => {
    if (!shown) {
      setPinned(null)
      return
    }
    const unpin = () => pinnedRef.current && setPinned(null)
    window.addEventListener('resize', unpin)
    return () => window.removeEventListener('resize', unpin)
  }, [shown])

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
      // clicks inside another (nested) popover — or on a popover's resize grip — should not close this one
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

  // Keys typed right after the panel opened belong to it: focus at once (before the next key event is
  // handled — a frame later the first letters would have gone to the page), and once more a frame later
  // when nothing inside has it then (content that mounted late, a mousedown that took the focus back).
  useLayoutEffect(() => {
    if (!shown || !autoFocus) return
    focusFirst(floatingRef.current)
    const id = requestAnimationFrame(() => {
      const root = floatingRef.current
      if (root && !root.contains(document.activeElement)) focusFirst(root)
    })
    return () => cancelAnimationFrame(id)
  }, [shown, autoFocus])

  /* ---------------- resize grip ---------------- */

  const grip = !!resizable && shown && canResize()

  /** Put the grip on the panel's bottom-right corner (it lives beside the panel: it never scrolls away). */
  const placeGrip = useCallback(() => {
    const el = floatingRef.current
    const g = gripRef.current
    if (!el || !g) return
    const r = el.getBoundingClientRect()
    g.style.left = `${Math.round(r.right - GRIP)}px`
    g.style.top = `${Math.round(r.bottom - GRIP)}px`
  }, [])

  useLayoutEffect(() => {
    if (grip) placeGrip()
  })

  useEffect(() => {
    const el = floatingRef.current
    if (!grip || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => placeGrip())
    ro.observe(el)
    return () => ro.disconnect()
  }, [grip, placeGrip])

  /** The panel's size without the person's size (the smallest it may get). */
  const natural = (el: HTMLElement) => {
    const keep = { minWidth: el.style.minWidth, minHeight: el.style.minHeight, maxWidth: el.style.maxWidth, maxHeight: el.style.maxHeight }
    const resized = 'resized' in el.dataset
    const top = el.getBoundingClientRect().top
    // the caps the panel has by itself (as the size middleware sets them without a size of the person's)
    el.style.minWidth = ''
    el.style.minHeight = ''
    el.style.maxWidth = `${Math.min(cssMax.current ?? Infinity, window.innerWidth - 2 * EDGE)}px`
    el.style.maxHeight = `${Math.max(0, Math.min(MAX_HEIGHT, window.innerHeight - EDGE - top))}px`
    delete el.dataset.resized
    const r = el.getBoundingClientRect()
    Object.assign(el.style, keep)
    if (resized) el.dataset.resized = ''
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) }
  }

  /** Resize from the pinned top-left corner, clamped to [natural size, screen]. */
  const resizeTo = (w: number, h: number, nat: { w: number; h: number }, at: { x: number; y: number }) => {
    const el = floatingRef.current
    if (!el) return null
    const maxW = Math.max(nat.w, window.innerWidth - EDGE - at.x)
    const maxH = Math.max(nat.h, window.innerHeight - EDGE - at.y)
    const next = { w: Math.round(Math.min(maxW, Math.max(nat.w, w))), h: Math.round(Math.min(maxH, Math.max(nat.h, h))) }
    el.style.maxWidth = `${maxW}px`
    el.style.maxHeight = `${maxH}px`
    el.style.minWidth = `${next.w}px`
    el.style.minHeight = `${next.h}px`
    el.dataset.resized = ''
    placeGrip()
    return next
  }

  const pinHere = () => {
    const el = floatingRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const at = pinnedRef.current ?? { x: Math.round(r.left), y: Math.round(r.top) }
    pinnedRef.current = at
    setPinned(at)
    // the same frame: no jump while React catches up
    el.style.transform = 'none'
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    return { at, rect: r, nat: natural(el) }
  }

  const remember = (s: PopoverSize | null) => {
    if (!resizable || !session.current) return
    session.current.size = s
    if (s) savePopoverSize(resizable, s)
  }

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = pinHere()
    if (!start) return
    const g = e.currentTarget
    const from = { x: e.clientX, y: e.clientY }
    let last: PopoverSize | null = null
    g.setPointerCapture?.(e.pointerId)
    g.dataset.active = ''
    const move = (ev: PointerEvent) => {
      last = resizeTo(start.rect.width + ev.clientX - from.x, start.rect.height + ev.clientY - from.y, start.nat, start.at) ?? last
    }
    const end = () => {
      g.removeEventListener('pointermove', move)
      g.removeEventListener('pointerup', end)
      g.removeEventListener('pointercancel', end)
      delete g.dataset.active
      if (last) remember(last)
    }
    g.addEventListener('pointermove', move)
    g.addEventListener('pointerup', end)
    g.addEventListener('pointercancel', end)
  }

  const reset = () => {
    const el = floatingRef.current
    if (resizable) clearPopoverSize(resizable)
    if (session.current) session.current.size = null
    if (el) {
      el.style.minWidth = ''
      el.style.minHeight = ''
      delete el.dataset.resized
      el.style.transform = ''
      el.style.left = ''
      el.style.top = ''
    }
    pinnedRef.current = null
    setPinned(null)
    requestAnimationFrame(placeGrip)
  }

  const onGripKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 64 : 16
    const d = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[e.key]
    if (e.key === 'Home') {
      e.preventDefault()
      e.stopPropagation()
      reset()
      return
    }
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    const start = pinHere()
    if (!start) return
    const next = resizeTo(start.rect.width + d[0], start.rect.height + d[1], start.nat, start.at)
    if (next) remember(next)
  }

  if (!open || !anchor) return null
  const place: CSSProperties = pinned ? { left: pinned.x, top: pinned.y, transform: 'none' } : {}
  return createPortal(
    <>
      <div
        ref={(el) => {
          if (el !== floatingRef.current) cssMax.current = null
          floatingRef.current = el
          refs.setFloating(el)
        }}
        data-popover=""
        role={role}
        aria-label={rest['aria-label']}
        className={bare ? className : `popover ${className ?? ''}`}
        // until floating-ui has placed it, the panel sits at (0, 0): not seen, not under the pointer
        style={{ ...floatingStyles, ...style, ...place, ...(isPositioned ? null : UNPLACED) }}
        onMouseDown={(e) => e.stopPropagation()}
        onAnimationEnd={grip ? placeGrip : undefined}
      >
        {children}
      </div>
      {grip && (
        <button
          ref={gripRef}
          type="button"
          className="pop-grip"
          data-popover="grip"
          aria-label={t('common.resize')}
          title={t('common.resizeHint')}
          style={isPositioned ? undefined : UNPLACED}
          onPointerDown={onGripDown}
          onKeyDown={onGripKey}
          onDoubleClick={reset}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M9.5 3.5 3.5 9.5M9.5 6.5 6.5 9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="square" fill="none" />
          </svg>
        </button>
      )}
    </>,
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
