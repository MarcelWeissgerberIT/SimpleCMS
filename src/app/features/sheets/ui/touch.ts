/**
 * Touch on the grid (pointerType 'touch' — the mouse keeps its own path in Grid):
 *  - press and hold a cell (~450 ms): the long press fires AT the threshold, the finger still down —
 *    the cell locks on in signal orange (a short vibration where the device has one) and the block
 *    opens its cell menu right then (whatever iOS does with the finger afterwards no longer
 *    matters). Travels the finger on: the menu closes, a range drag follows. A swipe still
 *    scrolls; a tap still selects through the browser's compatibility mouse events.
 *  - drag along the column letters / row numbers: several columns / rows (taps: Grid as before)
 *  - selection handles: drag a corner, the opposite corner stays
 * While a gesture owns the finger the grid doesn't scroll (non-passive touchmove listeners that
 * prevent only then: touch-action can't change mid-gesture); near the edges it scrolls by itself.
 *
 * A press starts on whichever arrives first — the pointerdown or the plain touchstart (iOS doesn't
 * always deliver both, nor in the same order); the other one joins the same press, never a second.
 *
 * iOS Safari on top of that:
 *  - its own long-press gestures may take the finger: pointercancel / touchcancel instead of
 *    pointerup / touchend. Once the gesture owns the finger that is a lift.
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
import { cellFromPoint, cellUnder, targetOf, type GridTarget, type PointerPhase } from './Grid'
import { edgeScroll, type Pt } from './drag'

export const LONG_PRESS_MS = 450
/** movement (px) that makes a press a swipe */
const SLOP = 10
/** after the long press fired: how far the finger travels before it is a range drag (a finger rolling as it lifts is not) */
const HOLD_SLOP = 12
/** how long after a gesture its leftover compatibility mouse events (or a double click) are ignored */
const AFTERMATH_MS = 800
/** iOS may still start a text selection right after the finger lifted */
const SELECT_BACK_MS = 300
/** the pointerdown and the touchstart of one finger: this close in time and place */
const JOIN_MS = 600

/** What a press on the grid may not start on (they have their own handling). */
const OWN = '.sg-editor, [data-fill-handle], [data-sel-handle], [data-sel-menu], [data-resize]'

export type Corner = 'tl' | 'br'

interface Options {
  viewportRef: RefObject<HTMLDivElement | null>
  /** the sheet as it is now (read on every move) */
  sheetRef: RefObject<SheetData>
  /**
   * a header drag starts ('down'), the finger over other cells / headers ('move'), lifted ('up' —
   * `moved`: it went over another cell on the way) — header drags and long-press drags
   */
  onTarget: (target: GridTarget, phase: PointerPhase, moved?: boolean) => void
  /** a cell held to the threshold — the finger is still down */
  onHold: (pos: Pos) => void
  /** the held finger travels on: from here on a range drag */
  onHoldDrag: (pos: Pos) => void
  /** a selection handle: 'down' with its corner cell, then the cell under the moved corner */
  onHandle: (corner: Corner, pos: Pos, phase: PointerPhase) => void
  /** a handle (or the fill tab) was tapped, not dragged: a tap at this point on what lies under it */
  onTap: (x: number, y: number) => void
}

const keyOf = (t: GridTarget) => (t.kind === 'cell' ? `${t.pos.r}:${t.pos.c}` : t.kind === 'corner' ? t.kind : `${t.kind}${t.index}`)

/** What a tap at (x, y) means on the grid, looking through the handles and the fill tab. */
export const targetUnder = (x: number, y: number): GridTarget | null => targetOf(cellUnder(x, y))

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
  /** the finger's pointer (null: the press began with its touchstart — the pointerdown may join) */
  pointerId: number | null
  /** the finger's touch (null: the press began with its pointerdown — the touchstart joins) */
  touchId: number | null
  /** what the finger came down on: its touch events go there for good (iOS: its pointer events too) */
  el: HTMLElement
  axis: 'x' | 'y' | 'both'
  start: Pt
  /** the gesture drags now (the grid may scroll by itself near its edges) — default: once it owns the finger */
  drags?: () => boolean
  /** the finger at `pt`; `far`: it has travelled past the slop since it came down */
  onMove: (pt: Pt, far: boolean) => void
  /**
   * the finger lifted — or the system took it (`cancelled`: a lift as well once the gesture owned
   * the finger), or it turned out to be a swipe / pinch
   */
  onDone: (live: boolean, cancelled: boolean) => void
}

interface Followed {
  /** the gesture takes the finger over */
  own: () => void
  /** not this gesture after all (a swipe) */
  stop: () => void
  /** the finger's pointerdown arrived after its touchstart */
  joinPointer: (id: number) => void
  readonly live: boolean
  readonly done: boolean
  readonly pointerId: number | null
  readonly start: Pt
  readonly since: number
}

export function useTouchGestures({ viewportRef, sheetRef, onTarget, onHold, onHoldDrag, onHandle, onTap }: Options) {
  const handlers = useRef({ onTarget, onHold, onHoldDrag, onHandle, onTap })
  handlers.current = { onTarget, onHold, onHoldDrag, onHandle, onTap }
  /** a gesture owns the finger (the grid must not scroll) */
  const [busy, setBusy] = useState(false)
  /** the cell of a long press that fired and hasn't moved yet */
  const [armed, setArmed] = useState<Pos | null>(null)
  const lock = useRef(false)
  /** a touch is down on the grid (mouse events and a contextmenu now are the browser's, not the user's) */
  const pressing = useRef(false)
  /** when the last long press / drag ended (0: a new touch began since) */
  const ended = useRef(0)
  /** the press on the grid being followed (one finger at a time) */
  const current = useRef<Followed | null>(null)

  /** Follow one finger until it lifts; the grid scrolls by itself near its edges. */
  const follow = ({ pointerId: firstPointer, touchId: firstTouch, el, axis, start, drags = () => true, onMove, onDone }: Follow): Followed => {
    const vp = viewportRef.current!
    let pt = start
    let raf = 0
    let live = false
    let far = false
    let done = false
    let pointerId = firstPointer
    let touchId = firstTouch
    /** the pointer was cancelled before the gesture owned the finger, the touch goes on: follow that */
    let pointerGone = false
    const since = performance.now()
    pressing.current = true
    pageSelect(true)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (live && far && drags() && edgeScroll(vp, sheetRef.current, pt, axis)) onMove(pt, far)
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
      if (current.current === followed) current.current = null
      pageSelect(false)
      if (live) {
        lock.current = false
        setBusy(false)
        ended.current = performance.now()
      }
      onDone(live, cancelled)
    }

    const pointerMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId && !pointerGone) to(ev.clientX, ev.clientY)
    }
    const pointerUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false)
    }
    const pointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
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
      const t = ev.changedTouches[0]
      if (!t) return
      // this finger's own touchstart (its pointerdown came first) — else a lone new finger: the press
      // before lost its end somewhere, it is over
      if (touchId === null && Math.hypot(t.clientX - start.x, t.clientY - start.y) <= SLOP * 2) touchId = t.identifier
      else if (t.identifier !== touchId) finish(true)
    }
    const touchMove = (ev: TouchEvent) => {
      if (live && ev.cancelable) ev.preventDefault()
      const t = mine(ev)
      if (!t) return
      // the pointer is gone (or never came) and the browser no longer waits for this page: it scrolls —
      // a swipe (or, owned already, the end of the drag: no range following a scrolling page)
      if ((pointerGone || pointerId === null) && !ev.cancelable) return finish(true)
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
    const followed: Followed = {
      own: () => {
        if (live || done) return
        live = true
        lock.current = true
        setBusy(true)
        raf = requestAnimationFrame(tick)
      },
      stop: () => finish(true),
      joinPointer: (id: number) => {
        pointerId = id
      },
      get live() {
        return live
      },
      get done() {
        return done
      },
      get pointerId() {
        return pointerId
      },
      start,
      since,
    }
    current.current = followed
    return followed
  }

  /** A finger came down on the grid (its pointerdown or its touchstart, whichever came first). */
  const press = (el: HTMLElement, start: Pt, ids: { pointerId: number | null; touchId: number | null }) => {
    ended.current = 0
    if (el.closest(OWN)) return
    const target = targetOf(el)
    const vp = viewportRef.current
    if (!vp || !target || target.kind === 'corner') return
    const axis = target.kind === 'col' ? 'x' : target.kind === 'row' ? 'y' : 'both'
    const at = (pt: Pt): GridTarget => {
      const p = cellFromPoint(vp, sheetRef.current, pt.x, pt.y)
      return target.kind === 'cell' ? { kind: 'cell', pos: p } : target.kind === 'col' ? { kind: 'col', index: p.c } : { kind: 'row', index: p.r }
    }
    let last: GridTarget = target
    let moved = false
    /** the long press fired here (the finger's point at the threshold) */
    let heldAt: Pt | null = null
    /** the held finger travelled on: a range drag */
    let dragging = false
    let pt = start
    const emit = (p: Pt) => {
      const next = at(p)
      if (keyOf(next) === keyOf(last)) return
      last = next
      moved = true
      handlers.current.onTarget(next, 'move')
    }
    const begin = () => {
      g.own()
      if (target.kind === 'cell') {
        heldAt = pt
        setArmed(target.pos)
        buzz()
        handlers.current.onHold(target.pos)
      } else handlers.current.onTarget(target, 'down')
    }
    const timer = target.kind === 'cell' ? window.setTimeout(begin, LONG_PRESS_MS) : 0
    const g = follow({
      ...ids,
      el,
      axis,
      start,
      // a held cell scrolls the grid only once its range drag began (the menu stays put before)
      drags: () => target.kind !== 'cell' || dragging,
      onMove: (p, far) => {
        pt = p
        if (g.live) {
          if (target.kind !== 'cell') return far ? emit(p) : undefined
          if (!dragging) {
            if (!heldAt || Math.hypot(p.x - heldAt.x, p.y - heldAt.y) <= HOLD_SLOP) return
            dragging = true
            setArmed(null)
            handlers.current.onHoldDrag(target.pos)
          }
          return emit(p)
        }
        const dx = Math.abs(p.x - start.x)
        const dy = Math.abs(p.y - start.y)
        // a cell: any early movement is a swipe (the browser scrolls); a header: along its strip is a drag
        if (target.kind === 'cell') {
          if (far) g.stop()
        } else if ((axis === 'x' ? dx : dy) > SLOP) {
          begin()
          emit(p)
        } else if ((axis === 'x' ? dy : dx) > SLOP) g.stop()
      },
      onDone: (live) => {
        window.clearTimeout(timer)
        setArmed(null)
        if (live) handlers.current.onTarget(last, 'up', moved)
      },
    })
  }

  /** pointerdown on the grid: a long press on a cell, a drag along the headers. */
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return
    const cur = current.current
    if (cur && !cur.done) {
      // the finger's touchstart began this press: the pointer joins it
      if (cur.pointerId === null && performance.now() - cur.since < JOIN_MS && Math.hypot(e.clientX - cur.start.x, e.clientY - cur.start.y) <= SLOP * 2) {
        cur.joinPointer(e.pointerId)
        return
      }
      // a press whose end never came: over
      cur.stop()
    }
    press(e.target as HTMLElement, { x: e.clientX, y: e.clientY }, { pointerId: e.pointerId, touchId: null })
  }
  const pressRef = useRef(press)
  pressRef.current = press

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    // there from the start: iOS only lets touchmove stop the scrolling when a non-passive listener was there at touchstart
    const block = (e: TouchEvent) => {
      if (lock.current && e.cancelable) e.preventDefault()
    }
    // a finger whose pointerdown hasn't come (yet): the press starts with its touchstart
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || (current.current && !current.current.done)) return
      const t = e.changedTouches[0]
      if (t) pressRef.current(e.target as HTMLElement, { x: t.clientX, y: t.clientY }, { pointerId: null, touchId: t.identifier })
    }
    vp.addEventListener('touchmove', block, { passive: false })
    vp.addEventListener('touchstart', touchStart, { passive: true })
    return () => {
      vp.removeEventListener('touchmove', block)
      vp.removeEventListener('touchstart', touchStart)
    }
  }, [viewportRef])

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
      current.current?.stop()
      // the finger rarely lands on the exact corner: keep its offset; 2px inwards is the corner's cell
      const box = e.currentTarget.getBoundingClientRect()
      const inward = corner === 'br' ? -2 : 2
      const off = { x: e.clientX - (box.left + box.width / 2) - inward, y: e.clientY - (box.top + box.height / 2) - inward }
      const cellAt = (pt: Pt) => cellFromPoint(vp, sheetRef.current, pt.x - off.x, pt.y - off.y)
      const start = { x: e.clientX, y: e.clientY }
      let last = cellAt(start)
      let end = start
      const g = follow({
        pointerId: e.pointerId,
        touchId: null,
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
