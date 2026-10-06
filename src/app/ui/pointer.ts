/**
 * A pointer that is really moving vs. one that rests.
 *
 * A list that opens under a resting pointer (a menu below the click that opened it, a long menu
 * shifted on screen, content scrolling underneath) still gets mouseenter / mousemove from the
 * browser for whatever appears below it — that is not the person pointing at an item, and it must
 * not highlight "Delete". `usePointerIntent()` tells the two apart: an event counts once the pointer
 * stands somewhere else than where it stood when the list opened.
 */
import { useCallback, useRef, useState } from 'react'

interface Point {
  x: number
  y: number
}

let last: Point | null = null

if (typeof document !== 'undefined') {
  const note = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY }
  }
  document.addEventListener('pointermove', note, { capture: true, passive: true })
  document.addEventListener('pointerdown', note, { capture: true, passive: true })
}

export interface PointerIntent {
  /** the pointer has moved since the list opened */
  moved: boolean
  /** Call from mouseenter / mousemove: is this real movement (also flips `moved`)? */
  check: (e: { clientX: number; clientY: number }) => boolean
}

export function usePointerIntent(): PointerIntent {
  const start = useRef<Point | null>(last)
  const movedRef = useRef(false)
  const [moved, setMoved] = useState(false)
  const check = useCallback((e: { clientX: number; clientY: number }) => {
    if (movedRef.current) return true
    const s = start.current
    if (!s) {
      // no pointer seen before the list opened: this first event only tells where it rests
      start.current = { x: e.clientX, y: e.clientY }
      return false
    }
    if (Math.abs(e.clientX - s.x) < 1 && Math.abs(e.clientY - s.y) < 1) return false
    movedRef.current = true
    setMoved(true)
    return true
  }, [])
  return { moved, check }
}
