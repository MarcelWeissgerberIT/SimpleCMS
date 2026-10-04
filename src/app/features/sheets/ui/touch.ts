/**
 * Touch on the grid (pointerType 'touch' — the mouse keeps its own path in Grid):
 *  - press and hold a cell (~400 ms): the long press arms — the cell locks on in signal orange (a
 *    short vibration where the device has one); then drag: a range selection; lifted without
 *    leaving the cell, the block offers what a long press can do there. A swipe still scrolls; a
 *    tap still selects through the browser's compatibility mouse events.
 *  - drag along the column letters / row numbers: several columns / rows (taps: Grid as before)
 *  - selection handles: drag a corner, the opposite corner stays
 * While a gesture owns the finger the grid doesn't scroll (non-passive touchmove listeners that
 * prevent only then: touch-action can't change mid-gesture); near the edges it scrolls by itself.
 *
 * iOS Safari on top of that:
 *  - its own long-press gestures may take the finger: pointercancel / touchcancel instead of
 *    pointerup / touchend. Once the gesture owns the finger that is a lift (in place: the panel;
 *    after a drag: the range stays).
 *  - it sends the finger's pointer events to the pressed cell even after that cell left the DOM
 *    (a virtualised row scrolled away): the finger's touch events, which go there too, carry the
 *    gesture on.
 *  - a long press selects text next to an unselectable element: the page can't be selected while a
 *    finger is down on the grid (and a moment after).
 *  - it sends compatibility mouse events (mousemove / mousedown / click at the finger's point) after
 *    a long press too: ignored while a finger is down and for a moment after a gesture.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SheetData } from '../model'
import type { Pos } from '../ops'
import { cellFromPoint, targetOf, type GridTarget, type PointerPhase } from './Grid'
import { edgeScroll, type Pt } from './drag'

const LONG_PRESS_MS = 400
/** movement (px) that makes a press a swipe — and, once the long press armed, a drag */
const SLOP = 8
/** how long after a gesture its leftover compatibility mouse events (or a double click) are ignored */
const AFTERMATH_MS = 800
/** iOS may still start a text selection right after the finger lifted */
const SELECT_BACK_MS = 300

export type Corner = 'tl' | 'br'

interface Options {
  viewportRef: RefObject<HTMLDivElement | null>
  /** the sheet as it is now (read on every move) */
  sheetRef: RefObject<SheetData>
  /**
   * a long press on a cell ('down'), the finger over other cells ('move'), lifted ('up' — `moved`:
   * it went over another cell on the way); header drags the same
   */
  onTarget: (target: GridTarget, phase: PointerPhase, moved?: boolean) => void
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

/** WebKit on a touch screen (Safari and every other browser on iPhone / iPad). */
const webkitTouch = () => typeof CSS !== 'undefined' && !!CSS.supports?.('-webkit-touch-callout', 'none')

let selectBack = 0
/** the page's own -webkit-user-select while a finger holds it off (null: not held off) */
let savedSelect: string | null = null

/** iOS: the whole page unselectable while a finger is down on the grid (`off`), back a moment after it lifted. */
function pageSelect(off: boolean) {
  if (!webkitTouch()) return
  const style = document.documentElement.style
  window.clearTimeout(selectBack)
  if (off) {
    if (savedSelect === null) {
      savedSelect = style.getPropertyValue('-webkit-user-select')
      style.setProperty('-webkit-user-select', 'none')
    }
    return
  }
  selectBack = window.setTimeout(() => {
    if (savedSelect === null) return
    if (savedSelect) style.setProperty('-webkit-user-select', savedSelect)
    else style.removeProperty('-webkit-user-select')
    savedSelect = null
  }, SELECT_BACK_MS)
}

interface Follow {
  /** the finger's pointer */
  id: number
  /** what the finger came down on: its touch events go there for good (iOS: its pointer events too) */
  el: HTMLElement
  axis: 'x' | 'y' | 'both'
  start: Pt
  /** the finger at `pt`; `far`: it has travelled past the slop since it came down */
  onMove: (pt: Pt, far: boolean) => void
  /**
   * the finger lifted — or the system took it (`cancelled`: a lift as well once the gesture owned
   * the finger), or it turned out to be a swipe / pinch
   */
  onDone: (live: boolean, cancelled: boolean) => void
}

export function useTouchGestures({ viewportRef, sheetRef, onTarget, onHandle, onTap }: Options) {
  const handlers = useRef({ onTarget, onHandle, onTap })
  handlers.current = { onTarget, onHandle, onTap }
  /** a gesture owns the finger (the grid must not scroll) */
  const [busy, setBusy] = useState(false)
  /** the cell of a long press that armed and hasn't moved yet (lift: the panel · move: a range) */
  const [armed, setArmed] = useState<Pos | null>(null)
  const lock = useRef(false)
  /** a touch is down on the grid (mouse events and a contextmenu now are the browser's, not the user's) */
  const pressing = useRef(false)
  /** when the last long press / drag ended (0: a new touch began since) */
  const ended = useRef(0)

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    // there from the start: iOS only lets touchmove stop the scrolling when a non-passive listener was there at touchstart
    const block = (e: TouchEvent) => {
      if (lock.current && e.cancelable) e.preventDefault()
    }
    vp.addEventListener('touchmove', block, { passive: false })
    return () => vp.removeEventListener('touchmove', block)
  }, [viewportRef])

  /** Follow one finger until it lifts; the grid scrolls by itself near its edges. */
  const follow = ({ id, el, axis, start, onMove, onDone }: Follow) => {
    const vp = viewportRef.current!
    let pt = start
    let raf = 0
    let live = false
    let far = false
    let done = false
    /** the finger's touch (touch events), known from its touchstart */
    let touchId: number | null = null
    /** the pointer was cancelled before the gesture owned the finger, the touch goes on: follow that */
    let pointerGone = false
    pressing.current = true
    pageSelect(true)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (live && far && edgeScroll(vp, sheetRef.current, pt, axis)) onMove(pt, far)
    }
    const to = (x: number, y: number) => {
      pt = { x, y }
      if (!far && Math.hypot(x - start.x, y - start.y) > SLOP) far = true
      onMove(pt, far)
    }
    const finish = (cancelled: boolean) => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('touchstart', touchStart, true)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('touchend', touchEnd)
      el.removeEventListener('touchcancel', touchEnd)
      pressing.current = false
      pageSelect(false)
      if (live) {
        lock.current = false
        setBusy(false)
        ended.current = performance.now()
      }
      onDone(live, cancelled)
    }

    const pointerMove = (ev: PointerEvent) => {
      if (ev.pointerId === id && !pointerGone) to(ev.clientX, ev.clientY)
    }
    const pointerUp = (ev: PointerEvent) => {
      if (ev.pointerId === id) finish(false)
    }
    const pointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      // the gesture owns the finger: the system took it (iOS) — a lift. Before: a scroll began — unless
      // the finger stayed put and its touch goes on (then that decides)
      if (!live && !far && touchId !== null) pointerGone = true
      else finish(true)
    }
    const mine = (ev: TouchEvent) => {
      if (touchId === null && ev.targetTouches.length === 1) touchId = ev.targetTouches[0].identifier
      return Array.from(ev.changedTouches).find((t) => t.identifier === touchId) ?? null
    }
    const touchStart = (ev: TouchEvent) => {
      // a second finger before the gesture owns the first: a pinch, not a long press
      if (ev.touches.length > 1) {
        if (!live) finish(true)
        return
      }
      if (touchId === null && ev.target === el) touchId = ev.changedTouches[0]?.identifier ?? null
    }
    const touchMove = (ev: TouchEvent) => {
      if (live && ev.cancelable) ev.preventDefault()
      const t = mine(ev)
      if (!t) return
      // the pointer is gone and the browser no longer waits for this page: it scrolls — a swipe (or,
      // owned already, the end of the drag: no range following a scrolling page)
      if (pointerGone && !ev.cancelable) return finish(true)
      to(t.clientX, t.clientY)
    }
    const touchEnd = (ev: TouchEvent) => {
      if (mine(ev)) finish(ev.type === 'touchcancel')
    }

    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('touchstart', touchStart, true)
    el.addEventListener('touchmove', touchMove, { passive: false })
    el.addEventListener('touchend', touchEnd)
    el.addEventListener('touchcancel', touchEnd)
    return {
      /** the gesture takes the finger over */
      own: () => {
        if (live || done) return
        live = true
        lock.current = true
        setBusy(true)
        raf = requestAnimationFrame(tick)
      },
      /** not this gesture after all (a swipe) */
      stop: () => finish(true),
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
      const el = e.target as HTMLElement
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
      let moved = false
      const emit = (pt: Pt) => {
        const next = at(pt)
        if (keyOf(next) === keyOf(last)) return
        last = next
        if (!moved) setArmed(null)
        moved = true
        handlers.current.onTarget(next, 'move')
      }
      const begin = () => {
        g.own()
        if (target.kind === 'cell') {
          setArmed(target.pos)
          buzz()
        }
        handlers.current.onTarget(target, 'down')
      }
      const timer = target.kind === 'cell' ? window.setTimeout(begin, LONG_PRESS_MS) : 0
      const g = follow({
        id: e.pointerId,
        el,
        axis,
        start,
        onMove: (pt, far) => {
          // owned: a range once the finger travels (a finger rolling as it lifts is still "in place")
          if (g.live) return far ? emit(pt) : undefined
          const dx = Math.abs(pt.x - start.x)
          const dy = Math.abs(pt.y - start.y)
          // a cell: any early movement is a swipe (the browser scrolls); a header: along its strip is a drag
          if (target.kind === 'cell') {
            if (far) g.stop()
          } else if ((axis === 'x' ? dx : dy) > SLOP) {
            begin()
            emit(pt)
          } else if ((axis === 'x' ? dy : dx) > SLOP) g.stop()
        },
        onDone: (live) => {
          window.clearTimeout(timer)
          setArmed(null)
          if (live) handlers.current.onTarget(last, 'up', moved)
        },
      })
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
      const g = follow({
        id: e.pointerId,
        el: e.target as HTMLElement,
        axis: 'both',
        start,
        onMove: (pt, far) => {
          end = pt
          if (!g.live) {
            if (!far) return
            g.own()
            handlers.current.onHandle(corner, last, 'down')
          }
          const p = cellAt(pt)
          if (p.r === last.r && p.c === last.c) return
          last = p
          handlers.current.onHandle(corner, p, 'move')
        },
        onDone: (live, cancelled) => {
          if (live) handlers.current.onHandle(corner, last, 'up')
          // a tap: the hit area lies over neighbouring cells — the tap is theirs
          else if (!cancelled) handlers.current.onTap(end.x, end.y)
        },
      })
    },
    [viewportRef, sheetRef], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return {
    busy,
    armed,
    onPointerDown,
    startHandle,
    /**
     * A finger is down on the grid, or a long press / drag ended moments ago: mouse events, a double
     * click or a contextmenu now are the browser's leftovers (iOS sends them at the finger's point), not a
     * tap, a right-click or a drag of their own.
     */
    aftermath: () => pressing.current || (ended.current > 0 && performance.now() - ended.current < AFTERMATH_MS),
  }
}
