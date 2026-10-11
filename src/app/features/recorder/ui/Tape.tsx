/**
 * The tape: the ruler (ticks as one SVG path, labels, the window's dimension line), the loupe's band, the tracks,
 * the future's hatch, the now line and the playhead (a slider: drag its head, or the keys). A drag on the ruler pans
 * the span, a click there moves the playhead. Desktop: the tape is as wide as its column; phone: it is drawn wider
 * and scrolled so the story fits (bracket … held marks, or the minutes around the playhead).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useLang, useT } from '../../../i18n'
import { phoneFit, rulerLabels, rulerTicks, tAtX, xOf, type Axis, type Zoom } from '../model/axis'
import type { View } from '../model/labels'
import { isCopy } from '../model/marks'
import type { JOp, JRun, LaneKey } from '../model/types'
import { Lane } from './Lane'
import type { LaneMeta } from './lanes'
import { movePlayhead, panBy, tapeFloor } from './actions'
import { useNow } from './clock'
import { fmtDayLong, hm, hms, mm, unit } from './format'
import { onTapeKey } from './keys'
import { settleHeads } from './settle'
import { freezeAxis, setFocusLane, useRecorderUI, type Bracket } from './state'
import { focusLost } from '../../../ui/focus'
import { TickPopover, type TickAt } from './TickPopover'

export interface TapeProps {
  lanes: LaneMeta[]
  laneOps: Record<LaneKey, JOp[]>
  hist: Record<LaneKey, Array<[number, number]>> | null
  runs: Record<string, JRun>
  ax: Axis
  zoom: Zoom
  bracket: Bracket | null
  playhead: number | null
  focusLane: LaneKey | null
  phone: boolean
  /** the moment the span was computed (the tape re-renders when the span moves, not every second) */
  now: number
  empty: boolean
  /** stretches whose recording was lost (hatched, labelled "Recording interrupted") */
  gaps: Array<{ from: number; to: number }>
}

const RULER_H: Record<string, number> = { s: 3, m: 4, t: 9, h: 13 }

export function Tape(p: TapeProps) {
  const t = useT()
  const lang = useLang()
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [clientW, setClientW] = useState(0)
  // the ruler's digits are this wide (mono, the text size's)
  const [charW, setCharW] = useState(6.5)
  const [scrollX, setScrollX] = useState(0)
  const [tick, setTick] = useState<TickAt | null>(null)

  // the tape's width (its column; the label column and the plate vary)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      setClientW(el.clientWidth)
      setCharW(6.5 * (Number(getComputedStyle(el).getPropertyValue('--text-scale')) || 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // phone: drawn wider and scrolled so the story fits — held still while a drag runs (the playhead follows the finger;
  // the tape is fitted again on release)
  const dragging = useRecorderUI((s) => s.axisFrozen !== null)
  const lastFit = useRef<ReturnType<typeof phoneFit> | null>(null)
  const fit = useMemo(() => {
    if (!p.phone || !clientW) return null
    if (dragging && lastFit.current) return lastFit.current
    const ax = p.ax
    const at = p.playhead ?? p.now
    let from: number
    let to: number
    if (p.bracket && p.bracket.b > ax.t0 && p.bracket.a < ax.t1) {
      from = p.bracket.a - 60_000
      to = Math.max(p.bracket.b, at) + 40 * (ax.total / Math.max(1, clientW))
    } else {
      from = at - 15 * 60_000
      to = at + 5 * 60_000
    }
    from = Math.max(ax.t0, from)
    to = Math.min(ax.t1, Math.max(to, from + 60_000))
    return phoneFit(ax, clientW, from, to)
  }, [p.phone, clientW, p.ax, p.bracket, p.playhead, p.now, dragging])
  lastFit.current = fit
  const width = fit ? fit.width : clientW

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = fit ? fit.scrollLeft : 0
    setScrollX(el.scrollLeft)
  }, [fit])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => setScrollX(el.scrollLeft))
  }, [])

  const view: View = useMemo(() => (p.phone ? { left: scrollX, right: scrollX + clientW } : { left: 0, right: width }), [p.phone, scrollX, clientW, width])
  const nowX = p.now < p.ax.t1 ? xOf(p.ax, p.now, width) : null

  const ticks = useMemo(() => (width ? rulerTicks(p.ax, p.zoom, width) : []), [p.ax, p.zoom, width])
  const labels = useMemo(() => (width ? rulerLabels(p.ax, p.zoom, width, undefined, charW) : []), [p.ax, p.zoom, width, charW])
  const tickPaths = useMemo(() => {
    const d: Record<string, string> = { s: '', m: '', t: '', h: '' }
    for (const k of ticks) d[k.cls] += `M${(xOf(p.ax, k.t, width) - 0.5).toFixed(2)} 24h1v-${RULER_H[k.cls]}h-1z`
    return d
  }, [ticks, p.ax, width])

  // heads at the edges; ruler labels under them hidden (re-run when the heads or the view move)
  const [headTick, setHeadTick] = useState(0)
  useLayoutEffect(() => {
    if (innerRef.current) settleHeads(innerRef.current, view)
  }, [view, labels, p.playhead, headTick, width])

  // the window's dimension line and the loupe's band
  const z = p.bracket
  const zx0 = z ? Math.max(0, xOf(p.ax, z.a, width)) : 0
  const zx1 = z ? Math.min(width, xOf(p.ax, z.b, width)) : 0
  const zoneOn = !!z && zx1 > zx0

  // a drag on the ruler pans, a click moves the playhead there
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.playhead__h')) return
    const el = e.currentTarget
    const box = el.getBoundingClientRect()
    const x0 = e.clientX
    let last = x0
    let moved = false
    const msPerPx = p.ax.total / Math.max(1, width)
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return
      if (!moved) {
        moved = true
        el.dataset.drag = ''
      }
      panBy(-(ev.clientX - last) * msPerPx)
      last = ev.clientX
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      delete el.dataset.drag
      if (moved || ev.type === 'pointercancel') return
      const tAt = tAtX(p.ax, ev.clientX - box.left, width)
      movePlayhead(Math.min(Date.now(), Math.max(tapeFloor(), tAt)))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // Shift + wheel and sideways scrolling pan the span (the wheel never zooms)
  const onWheel = (e: React.WheelEvent) => {
    if (p.phone) return
    const dx = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0
    if (!dx) return
    panBy(dx * (p.ax.total / Math.max(1, width)))
  }

  const onOp = useCallback((op: JOp, x: number, el: HTMLElement) => setTick({ op, x, y: el.getBoundingClientRect().top, lane: el.dataset.lane ?? op.l }), [])
  // the places' popover closed: focus that went with it goes to the track that was clicked (its keys work again)
  const closeTick = useCallback(() => {
    const lane = tick?.lane
    setTick(null)
    requestAnimationFrame(() => {
      if (!lane || !focusLost()) return
      const el = scrollRef.current?.querySelector<HTMLElement>(`.lane[data-lane="${CSS.escape(lane)}"]`)
      if (!el) return
      setFocusLane(lane)
      el.focus({ preventScroll: true })
    })
  }, [tick])
  const lanesKeys = p.lanes.map((l) => l.lane)
  const focusLane = p.focusLane && lanesKeys.includes(p.focusLane) ? p.focusLane : (p.bracket?.lane && lanesKeys.includes(p.bracket.lane) ? p.bracket.lane : lanesKeys[0])

  return (
    <div className="reel" onKeyDown={(e) => onTapeKey(e, lanesKeys)} onWheel={onWheel}>
      <div className="reel__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="reel__inner" ref={innerRef} style={fit ? { width } : undefined}>
          <div className="ruler" onPointerDown={onRulerDown}>
            {zoneOn && <div className="ruler__zone" style={{ left: zx0, width: zx1 - zx0 }} />}
            {width > 0 && (
              <svg className="ruler__ticks" width={width} height="100%" viewBox={`0 0 ${width} 24`} preserveAspectRatio="none" aria-hidden="true">
                {(['s', 'm', 't', 'h'] as const).map((c) => tickPaths[c] && <path key={c} className={c} d={tickPaths[c]} />)}
              </svg>
            )}
            {labels.map((l) => (
              <span key={`${l.kind}${l.t}`} className="ruler__l" data-kind={l.kind} style={{ left: xOf(p.ax, l.t, width) }}>
                {l.fmt === 'hm' ? hm(l.t) : mm(l.t)}
              </span>
            ))}
          </div>
          {zoneOn && p.ax.zone && <div className="zone" style={{ left: zx0, width: zx1 - zx0 }} />}
          <div className="lanes" role="group" aria-label={t('features.recorder.deck.lanesAria')}>
            {p.lanes.map((m) => (
              <Lane
                key={m.lane}
                meta={m}
                ops={p.hist ? undefined : p.laneOps[m.lane]}
                hist={p.hist ? (p.hist[m.lane] ?? []) : undefined}
                runs={p.runs}
                ax={p.ax}
                zoom={p.zoom}
                width={width}
                bracket={p.bracket}
                focused={m.lane === focusLane}
                view={view}
                nowX={nowX}
                phone={p.phone}
                onOp={onOp}
              />
            ))}
          </div>
          {p.gaps.map((g) => (
            <Lost key={g.from} ax={p.ax} width={width} gap={g} />
          ))}
          {p.empty && <span className="reel__empty">{t('features.recorder.deck.empty')}</span>}
          <Heads ax={p.ax} width={width} playhead={p.playhead} onMove={() => setHeadTick((n) => n + 1)} />
        </div>
      </div>
      {tick && <TickPopover at={tick} onClose={closeTick} />}
    </div>
  )
}

/**
 * A stretch whose recording was lost (a tab closed before it had written what it recorded): hatched across the
 * tracks, so it never reads as a quiet time; its label shows only where it fits whole (the plate names it too).
 */
function Lost({ ax, width, gap }: { ax: Axis; width: number; gap: { from: number; to: number } }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  // never narrower than 3 px: a lost stretch of seconds still shows where it was
  const x0 = xOf(ax, Math.max(ax.t0, gap.from), width)
  const x1 = Math.max(xOf(ax, Math.min(ax.t1, gap.to), width), Math.min(width, x0 + 3))
  useLayoutEffect(() => {
    const el = ref.current
    const l = el?.querySelector<HTMLElement>('.lost__l')
    if (!el || !l) return
    l.toggleAttribute('data-hidden', l.offsetWidth + 8 > el.clientWidth)
  })
  if (x1 - x0 < 1) return null
  const title = t('features.recorder.deck.lostTailTitle', { from: hm(gap.from), to: hm(gap.to) })
  return (
    <div ref={ref} className="lost" style={{ left: x0, width: x1 - x0 }} data-from={gap.from} data-to={gap.to} aria-hidden="true">
      <span className="lost__l" title={title}>
        {t('features.recorder.deck.lostTail')}
      </span>
    </div>
  )
}

/** The playhead (a slider), the now line and the future's hatch — the only part that ticks every second. */
function Heads({ ax, width, playhead, onMove }: { ax: Axis; width: number; playhead: number | null; onMove: () => void }) {
  const t = useT()
  const lang = useLang()
  const now = useNow(playhead === null ? 1000 : 5000)
  const at = playhead ?? now
  const x = (time: number) => xOf(ax, Math.max(ax.t0, Math.min(ax.t1, time)), width)
  const px = x(at)
  const nx = x(now)
  const nowOff = now > ax.t1
  const since = useRecorderUI((s) => (playhead === null ? 0 : sinceCount(s.ops.lanes, playhead)))

  // a head that moved sideways settles again
  useLayoutEffect(onMove, [Math.round(px), Math.round(nx), playhead === null])

  // drag the head: the axis holds still meanwhile
  const onDown = (e: RPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.focus({ preventScroll: true })
    const box = el.closest('.reel__inner')?.getBoundingClientRect()
    if (!box) return
    el.setPointerCapture(e.pointerId)
    freezeAxis(ax.zone ? { k: ax.zone.k, zone: [ax.zone.a, ax.zone.b] } : { k: 1, zone: [0, 0] })
    const move = (ev: PointerEvent) => movePlayhead(Math.min(Date.now(), Math.max(tapeFloor(), tAtX(ax, ev.clientX - box.left, width))))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      freezeAxis(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // what a screen reader hears changes only when the person moves the playhead: at now it says "Now" (the clock's
  // seconds would be read out every second), its bounds are the moment it was last moved
  const movedAt = useMemo(() => Date.now(), [playhead])
  const date = fmtDayLong(t, lang, at)
  const valueText = playhead === null ? t('features.recorder.deck.sliderNow') : t('features.recorder.deck.sliderText', { date, time: hms(at), ops: unit(t, lang, 'ops', since) })
  const valueMax = Math.max(movedAt, playhead ?? 0)
  return (
    <>
      {now < ax.t1 && <div className="future" style={{ left: nx }} />}
      {playhead !== null && (
        <div className="now" style={{ left: nowOff ? width : nx }}>
          <span className="now__l" data-line={nowOff ? width + 10 : nx}>
            {t('features.recorder.tape.now')}
            <span className="head__arrow"> →</span>
          </span>
        </div>
      )}
      <div className="playhead" style={{ left: px }} aria-hidden={false}>
        <span
          className="playhead__h"
          role="slider"
          tabIndex={0}
          data-line={px}
          aria-label={t('features.recorder.deck.slider')}
          aria-valuemin={tapeFloor(movedAt)}
          aria-valuemax={valueMax}
          aria-valuenow={playhead ?? valueMax}
          aria-valuetext={valueText}
          aria-orientation="horizontal"
          onPointerDown={onDown}
        >
          {playhead === null ? t('features.recorder.tape.now') : hms(at)}
          <span className="head__arrow"> →</span>
        </span>
      </div>
    </>
  )
}

/** Vorgänge after the playhead on the loaded tape (synced-block copies never count). */
function sinceCount(lanes: Record<LaneKey, JOp[]>, at: number): number {
  let n = 0
  for (const ops of Object.values(lanes)) for (const o of ops) if (o.at > at && !isCopy(o)) n++
  return n
}
