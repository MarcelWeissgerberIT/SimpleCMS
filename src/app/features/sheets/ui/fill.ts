/**
 * Dragging the fill handle (mouse, pen or finger): the range follows the pointer along the axis
 * it moved further on (down / up / right / left), the grid scrolls by itself near its edges,
 * Ctrl / ⌘ / ⌥ switches to the alternate fill, Esc cancels. A tap twice in a row is the
 * double-click (fill down to the end of the neighbour column) — on touch a tap belongs to the cell
 * under the tab (`onTouchTap`).
 */
import { useCallback, useRef, useState, type RefObject } from 'react'
import type { FillMode, Rect } from '../engine'
import type { SheetData } from '../model'
import type { Pos } from '../ops'
import { cellFromPoint, offsets } from './Grid'
import { edgeScroll } from './drag'

export interface FillDrag {
  src: Rect
  /** src ∪ the extension (null: the pointer is still inside the selection) */
  dest: Rect | null
  mode: FillMode
}

/** The selection extended to reach `p` along the axis it is further away on. */
export function extendTo(src: Rect, p: Pos): Rect | null {
  const down = p.r - src.bottom
  const up = src.top - p.r
  const right = p.c - src.right
  const left = src.left - p.c
  const v = Math.max(down, up)
  const h = Math.max(right, left)
  if (v <= 0 && h <= 0) return null
  if (v >= h) return down > 0 ? { ...src, bottom: p.r } : { ...src, top: p.r }
  return right > 0 ? { ...src, right: p.c } : { ...src, left: p.c }
}

const DOUBLE_MS = 450

interface Options {
  viewportRef: RefObject<HTMLDivElement | null>
  /** the sheet as it is now (read on every move) */
  sheetRef: RefObject<SheetData>
  onApply: (src: Rect, dest: Rect, mode: FillMode) => void
  onDouble: (src: Rect) => void
  /** a finger tapped the fill tab without dragging (its hit area lies over a neighbouring cell) */
  onTouchTap?: (x: number, y: number) => void
}

export function useFillDrag({ viewportRef, sheetRef, onApply, onDouble, onTouchTap }: Options) {
  const [drag, setDrag] = useState<FillDrag | null>(null)
  /** the last tap on the handle (no drag): a second one on the same selection soon after is a double-click */
  const lastTap = useRef({ at: 0, key: '' })
  const handlers = useRef({ onApply, onDouble, onTouchTap })
  handlers.current = { onApply, onDouble, onTouchTap }

  const start = useCallback(
    (e: React.PointerEvent<HTMLElement>, src: Rect) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const vp = viewportRef.current
      if (!vp) return
      e.preventDefault()
      e.stopPropagation()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // not capturable (synthetic events): the window listeners still follow the pointer
      }
      const id = e.pointerId
      const finger = e.pointerType === 'touch' && !!handlers.current.onTouchTap
      const x0 = e.clientX
      const y0 = e.clientY
      let pt = { x: x0, y: y0 }
      let alt = e.ctrlKey || e.metaKey || e.altKey
      let moved = false
      let dest: Rect | null = null
      let raf = 0
      const xs = offsets(sheetRef.current)

      const update = () => {
        const sheet = sheetRef.current
        dest = moved ? extendTo(src, cellFromPoint(vp, sheet, pt.x, pt.y, xs)) : null
        setDrag({ src, dest, mode: alt ? 'alt' : 'auto' })
      }

      // scroll while the pointer is near (or past) an edge of the visible part of the grid
      const tick = () => {
        raf = requestAnimationFrame(tick)
        if (moved && edgeScroll(vp, sheetRef.current, pt)) update()
      }

      const finish = (apply: boolean) => {
        cancelAnimationFrame(raf)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
        window.removeEventListener('keyup', key, true)
        setDrag(null)
        if (!apply) return
        const tap = `${src.top}:${src.left}:${src.bottom}:${src.right}`
        if (dest) {
          lastTap.current = { at: 0, key: '' }
          handlers.current.onApply(src, dest, alt ? 'alt' : 'auto')
        } else if (!moved && finger) {
          handlers.current.onTouchTap?.(pt.x, pt.y)
        } else if (!moved) {
          const now = performance.now()
          if (lastTap.current.key === tap && now - lastTap.current.at < DOUBLE_MS) {
            lastTap.current = { at: 0, key: '' }
            handlers.current.onDouble(src)
          } else lastTap.current = { at: now, key: tap }
        }
      }
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return
        pt = { x: ev.clientX, y: ev.clientY }
        alt = ev.ctrlKey || ev.metaKey || ev.altKey
        if (!moved && Math.hypot(pt.x - x0, pt.y - y0) > 4) moved = true
        update()
      }
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return
        alt = ev.ctrlKey || ev.metaKey || ev.altKey
        finish(true)
      }
      const cancel = (ev: PointerEvent) => {
        if (ev.pointerId === id) finish(false)
      }
      const key = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault()
          ev.stopPropagation()
          finish(false)
        } else if (ev.key === 'Control' || ev.key === 'Meta' || ev.key === 'Alt') {
          alt = ev.type === 'keydown'
          update()
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
      window.addEventListener('keyup', key, true)
      raf = requestAnimationFrame(tick)
      setDrag({ src, dest: null, mode: alt ? 'alt' : 'auto' })
    },
    [viewportRef, sheetRef],
  )

  return { drag, start }
}
