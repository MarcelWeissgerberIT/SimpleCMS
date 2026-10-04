/**
 * Touch on the grid (pointerType 'touch' — the mouse keeps its own path in Grid):
 *  - press and hold a cell (~400 ms, a short vibration), then drag: a range selection. A swipe
 *    still scrolls; a tap still selects through the browser's compatibility mouse events.
 *  - drag along the column letters / row numbers: several columns / rows (taps: Grid as before)
 *  - selection handles: drag a corner, the opposite corner stays
 * While a gesture owns the finger the grid doesn't scroll (a non-passive touchmove listener:
 * touch-action can't change mid-gesture); near the edges it scrolls by itself.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SheetData } from '../model'
import type { Pos } from '../ops'
import { cellFromPoint, targetOf, type GridTarget, type PointerPhase } from './Grid'
import { edgeScroll, type Pt } from './drag'

const LONG_PRESS_MS = 400
/** movement (px) that makes a press a swipe */
const SLOP = 8
/** how long after a gesture its leftover compatibility mouse events (or a double click) are ignored */
const AFTERMATH_MS = 600

export type Corner = 'tl' | 'br'

interface Options {
  viewportRef: RefObject<HTMLDivElement | null>
  /** the sheet as it is now (read on every move) */
  sheetRef: RefObject<SheetData>
  /** a long press on a cell ('down'), the finger over other cells ('move'), lifted ('up'); header drags the same */
  onTarget: (target: GridTarget, phase: PointerPhase) => void
  /** a selection handle: 'down' with its corner cell, then the cell under the moved corner */
  onHandle: (corner: Corner, pos: Pos, phase: PointerPhase) => void
  /** a handle (or the fill tab) was tapped, not dragged: a tap at this point on what lies under it */
  onTap: (x: number, y: number) => void
}

const keyOf = (t: GridTarget) => (t.kind === 'cell' ? `${t.pos.r}:${t.pos.c}` : t.kind === 'corner' ? t.kind : `${t.kind}${t.index}`)

/** What a tap at (x, y) means on the grid, looking through the handles and the fill tab. */
export function targetUnder(x: number, y: number): GridTarget | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-sel-handle], [data-fill-handle]')) continue
    return targetOf(el)
  }
  return null
}

/** A short tick where the device can vibrate (and the page may: after a first tap). */
function buzz() {
  try {
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    if (nav.userActivation?.hasBeenActive) nav.vibrate?.(8)
  } catch {
    // no vibration here
  }
}

export function useTouchGestures({ viewportRef, sheetRef, onTarget, onHandle, onTap }: Options) {
  const handlers = useRef({ onTarget, onHandle, onTap })
  handlers.current = { onTarget, onHandle, onTap }
  /** a gesture owns the finger (the grid must not scroll) */
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  /** a touch is down on the grid (its contextmenu is not the cell menu) */
  const pressing = useRef(false)
  /** when the last long press / drag ended (0: a new touch began since) */
  const ended = useRef(0)

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const block = (e: TouchEvent) => {
      if (lock.current && e.cancelable) e.preventDefault()
    }
    vp.addEventListener('touchmove', block, { passive: false })
    return () => vp.removeEventListener('touchmove', block)
  }, [viewportRef])

  /** Follow one finger until it lifts; the grid scrolls by itself near its edges. */
  const follow = (id: number, axis: 'x' | 'y' | 'both', start: Pt, onMove: (pt: Pt) => void, onDone: (live: boolean) => void) => {
    const vp = viewportRef.current!
    let pt = start
    let raf = 0
    let live = false
    pressing.current = true
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (live && edgeScroll(vp, sheetRef.current, pt, axis)) onMove(pt)
    }
    const finish = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      pressing.current = false
      if (live) {
        lock.current = false
        setBusy(false)
        ended.current = performance.now()
      }
      onDone(live)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      pt = { x: ev.clientX, y: ev.clientY }
      onMove(pt)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === id) finish()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return {
      /** the gesture takes the finger over */
      own: () => {
        if (live) return
        live = true
        lock.current = true
        setBusy(true)
        raf = requestAnimationFrame(tick)
      },
      stop: finish,
      get live() {
        return live
      },
    }
  }

  /** pointerdown on the grid: a long press on a cell, a drag along the headers. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      ended.current = 0
      const el = e.target as Element
      if (el.closest('.sg-editor, [data-fill-handle], [data-sel-handle], [data-resize]')) return
      const target = targetOf(el)
      const vp = viewportRef.current
      if (!vp || !target || target.kind === 'corner') return
      const start = { x: e.clientX, y: e.clientY }
      const axis = target.kind === 'col' ? 'x' : target.kind === 'row' ? 'y' : 'both'
      const at = (pt: Pt): GridTarget => {
        const p = cellFromPoint(vp, sheetRef.current, pt.x, pt.y)
        return target.kind === 'cell' ? { kind: 'cell', pos: p } : target.kind === 'col' ? { kind: 'col', index: p.c } : { kind: 'row', index: p.r }
      }
      let last: GridTarget = target
      const emit = (pt: Pt) => {
        const next = at(pt)
        if (keyOf(next) === keyOf(last)) return
        last = next
        handlers.current.onTarget(next, 'move')
      }
      const begin = () => {
        g.own()
        if (target.kind === 'cell') buzz()
        handlers.current.onTarget(target, 'down')
      }
      const timer = target.kind === 'cell' ? window.setTimeout(begin, LONG_PRESS_MS) : 0
      const g = follow(
        e.pointerId,
        axis,
        start,
        (pt) => {
          if (g.live) return emit(pt)
          const dx = Math.abs(pt.x - start.x)
          const dy = Math.abs(pt.y - start.y)
          // a cell: any early movement is a swipe (the browser scrolls); a header: along its strip is a drag
          if (target.kind === 'cell') {
            if (Math.hypot(dx, dy) > SLOP) g.stop()
          } else if ((axis === 'x' ? dx : dy) > SLOP) {
            begin()
            emit(pt)
          } else if ((axis === 'x' ? dy : dx) > SLOP) g.stop()
        },
        (live) => {
          window.clearTimeout(timer)
          if (live) handlers.current.onTarget(last, 'up')
        },
      )
    },
    [viewportRef, sheetRef], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** pointerdown on a selection handle: the corner follows the finger, the opposite corner stays. */
  const startHandle = useCallback(
    (corner: Corner, e: React.PointerEvent<HTMLElement>) => {
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
      ended.current = 0
      // the finger rarely lands on the exact corner: keep its offset; 2px inwards is the corner's cell
      const box = e.currentTarget.getBoundingClientRect()
      const inward = corner === 'br' ? -2 : 2
      const off = { x: e.clientX - (box.left + box.width / 2) - inward, y: e.clientY - (box.top + box.height / 2) - inward }
      const cellAt = (pt: Pt) => cellFromPoint(vp, sheetRef.current, pt.x - off.x, pt.y - off.y)
      const start = { x: e.clientX, y: e.clientY }
      let last = cellAt(start)
      let end = start
      const g = follow(
        e.pointerId,
        'both',
        start,
        (pt) => {
          end = pt
          if (!g.live) {
            if (Math.hypot(pt.x - start.x, pt.y - start.y) <= SLOP) return
            g.own()
            handlers.current.onHandle(corner, last, 'down')
          }
          const p = cellAt(pt)
          if (p.r === last.r && p.c === last.c) return
          last = p
          handlers.current.onHandle(corner, p, 'move')
        },
        (live) => {
          if (live) handlers.current.onHandle(corner, last, 'up')
          // a tap: the hit area lies over neighbouring cells — the tap is theirs
          else handlers.current.onTap(end.x, end.y)
        },
      )
    },
    [viewportRef, sheetRef], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return {
    busy,
    onPointerDown,
    startHandle,
    /** a touch is down, or a gesture just ended: a contextmenu now is the long press, not a request for the cell menu */
    quietContext: () => pressing.current || (ended.current > 0 && performance.now() - ended.current < AFTERMATH_MS),
    /** the compatibility mouse events / double click the browser may still send after a long press or drag */
    aftermath: () => ended.current > 0 && performance.now() - ended.current < AFTERMATH_MS,
  }
}
