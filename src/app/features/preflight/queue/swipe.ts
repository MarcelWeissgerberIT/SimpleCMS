/**
 * Swiping the current card on touch (§7.7): horizontal only — → apply, ← discard; a vertical drag scrolls the page
 * (`touch-action: pan-y` on the card). Threshold 72 px or a flick (> 0.5 px/ms); the card follows the finger (no
 * motion under reduced motion: it snaps back at once). A swipe right after a dialog closed by a tap is ignored
 * (ui/gesture.ts), and the click after a drag of more than 8 px is swallowed — a swipe never opens what it started on.
 */
import { useEffect, type RefObject } from 'react'
import { inClosingGesture } from '../../../ui/gesture'
import { reducedMotion } from '../touch'

export const SWIPE_PX = 72
export const FLICK = 0.5
const SLOP = 8

/** The swipe's verdict from its travel (pure): 'right' · 'left' · null. Vertical travel wins → null (it scrolls). */
export function swipeOf(dx: number, dy: number, ms: number): 'right' | 'left' | null {
  if (Math.abs(dy) > Math.abs(dx)) return null
  const fast = ms > 0 && Math.abs(dx) / ms > FLICK && Math.abs(dx) > 24
  if (Math.abs(dx) < SWIPE_PX && !fast) return null
  return dx > 0 ? 'right' : 'left'
}

export function useSwipe(ref: RefObject<HTMLElement | null>, opts: { enabled: boolean; onSwipe: (dir: 'right' | 'left') => void }): void {
  const { enabled, onSwipe } = opts
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let start: { x: number; y: number; t: number; id: number } | null = null
    let axis: 'x' | 'y' | null = null
    let moved = false
    const reset = () => {
      el.style.transform = ''
      el.style.transition = ''
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || inClosingGesture(e)) return
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
      axis = null
      moved = false
    }
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!axis && Math.hypot(dx, dy) > SLOP) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (Math.hypot(dx, dy) > SLOP) moved = true
      if (axis === 'x' && !reducedMotion()) {
        el.style.transition = 'none'
        el.style.transform = `translateX(${Math.round(dx)}px)`
      }
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const s = start
      start = null
      const dir = axis === 'x' ? swipeOf(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t) : null
      reset()
      if (dir) onSwipe(dir)
    }
    const cancel = () => {
      start = null
      reset()
    }
    // the click after a drag is not a tap
    const click = (e: MouseEvent) => {
      if (!moved) return
      moved = false
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('click', click, true)
      reset()
    }
  }, [ref, enabled, onSwipe])
}
