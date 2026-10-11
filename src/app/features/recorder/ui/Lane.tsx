/**
 * One track on the tape: bursts as ranges (the person's typing with a bar), ticks and points as ONE SVG path (plus
 * one for the selected window's), run flags as buttons with their labels, the bracket. Re-renders only when its own
 * ops, the axis, the width or the window change. A press and drag along the track brackets a window there; a click
 * on a tick opens its place (more places: a popover); a click on a flag brackets its run.
 */
import { Fragment, memo, useLayoutEffect, useMemo, useRef, type PointerEvent as RPointerEvent } from 'react'
import { Eject } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fracOf, snapTime, tAtX, xOf, ZOOM, type Axis, type Zoom } from '../model/axis'
import { copiesPath, countOps, histMarks, isCopy, laneMarks, marksPath, opAt, type LaneMarks } from '../model/marks'
import type { JOp, JRun, LaneKey } from '../model/types'
import type { LaneMeta } from './lanes'
import { bracketRuns } from './actions'
import { fmtNum, hm, unit } from './format'
import { settleLaneLabels } from './settle'
import { freezeAxis, setBracket, setFocusLane, type Bracket } from './state'
import type { View } from '../model/labels'
import type { HeldMark } from '../window/read'

export interface LaneProps {
  meta: LaneMeta
  ops: JOp[] | undefined
  hist: Array<[number, number]> | undefined
  runs: Record<string, JRun>
  ax: Axis
  zoom: Zoom
  width: number
  bracket: Bracket | null
  focused: boolean
  view: View
  nowX: number | null
  phone: boolean
  onOp: (op: JOp, x: number, el: HTMLElement) => void
  /** rows of the selected window that someone changed since: diamonds at that moment (the plate's note says it) */
  held?: HeldMark[]
  /** windows an eject took back on this track (hatched, labelled; their ticks are gone) */
  out?: EjectedWindow[]
  /** the bracket is an ejected window: drawn as ejected, not as selected */
  ejected?: boolean
}

/** A window an eject took back, as its track draws it. */
export interface EjectedWindow {
  id: string
  a: number
  b: number
  at: number
  back: number
  all: number
  /** the run it ejected (none: the whole track in [a, b)) */
  run?: string
}

const DRAG_PX = 4
/** a flag's pennant is this wide: runs that reach further put their label after their end */
const PENNANT_PX = 12

export const Lane = memo(function Lane(p: LaneProps) {
  const t = useT()
  const lang = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const sel = p.bracket && p.bracket.lane === p.meta.lane && !p.ejected ? p.bracket : null
  const human = p.meta.lane === 'you' || p.meta.lane.startsWith('member:')
  // an ejected window's writes are no longer drawn: the hatched block stands for them
  const drawn = useMemo(() => (p.out?.length && p.ops ? p.ops.filter((o) => !p.out!.some((e) => o.at >= e.a && o.at < e.b && (!e.run || o.r === e.run))) : p.ops), [p.ops, p.out])
  const marks: LaneMarks = useMemo(
    () =>
      // not measured yet (the deck's first render): nothing to draw — the marks come with the tape's width
      p.width <= 0
        ? { ranges: [], ticks: [], points: [], flags: [], copies: [], count: 0 }
        : p.hist
          ? histMarks(p.hist, { ax: p.ax, width: p.width })
          : laneMarks(drawn ?? [], { ax: p.ax, width: p.width, sel, human }),
    [p.hist, drawn, p.ax, p.width, sel, human],
  )
  const plain = useMemo(() => marksPath(marks.ticks, marks.points, 30, false), [marks])
  const hot = useMemo(() => marksPath(marks.ticks, marks.points, 30, true), [marks])
  const dim = useMemo(() => copiesPath(marks.copies, 30), [marks])

  // labels flip / hide on this lane (its own pass: a data push never re-runs the whole tape)
  useLayoutEffect(() => {
    if (ref.current) settleLaneLabels(ref.current, p.view, p.nowX)
  })

  const flagLabel = (runs: string[]): string => {
    const recs = runs.map((r) => p.runs[r]).filter((r): r is JRun => !!r)
    const ops = recs.reduce((n, r) => n + r.ops, 0) || (p.ops ?? []).filter((o) => o.r && runs.includes(o.r) && !isCopy(o)).length
    const kind = runs[0].slice(0, runs[0].indexOf(':'))
    const places = recs.reduce((n, r) => n + r.places.rows + r.places.pages + r.places.schema + r.places.views, 0)
    const trashed = recs.reduce((n, r) => n + r.places.trashed, 0)
    const placesText = () => {
      const rows = recs.reduce((n, r) => n + r.places.rows, 0)
      const pages = recs.reduce((n, r) => n + r.places.pages, 0)
      if (rows === places && rows) return unit(t, lang, 'rows', rows)
      if (pages === places && pages) return unit(t, lang, 'pages', pages)
      return unit(t, lang, 'places', places)
    }
    if (kind === 'agent') {
      const seq = recs.length === 1 ? recs[0].meta?.seq : undefined
      const span = places ? t('features.recorder.flag.runSpan', { ops: unit(t, lang, 'ops', ops), places: unit(t, lang, 'places', places) }) : unit(t, lang, 'ops', ops)
      return seq ? `${t('features.recorder.flag.run', { n: seq })} · ${span}` : span
    }
    if (kind === 'terminal') return recs.length === 1 && recs[0].meta?.tool ? recs[0].meta.tool : t('features.recorder.flag.applied', { n: fmtNum(ops, lang) })
    if (kind === 'mcp') {
      if (trashed) return t('features.recorder.flag.toTrash', { n: fmtNum(trashed, lang) })
      return recs.length === 1 && recs[0].meta?.tool ? recs[0].meta.tool : unit(t, lang, 'ops', ops)
    }
    if (kind === 'script') return places ? t('features.recorder.flag.scriptRun', { places: placesText() }) : unit(t, lang, 'ops', ops)
    return unit(t, lang, 'ops', ops)
  }

  // press + drag along the track: a window on it; a click: the tick under the pointer
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.flag')) return
    const lane = e.currentTarget
    const box = lane.getBoundingClientRect()
    const x0 = e.clientX - box.left
    const touch = e.pointerType === 'touch'
    const step = ZOOM[p.zoom].snap
    const edges = marks.flags.flatMap((f) => [f.first, f.last])
    const snap = (x: number) => snapTime(tAtX(p.ax, x, p.width), step, edges, 6 * (p.ax.total / p.width))
    let moved = false
    const id = e.pointerId
    if (!touch) lane.setPointerCapture(id)
    const move = (ev: PointerEvent) => {
      if (touch) return
      const x = ev.clientX - box.left
      if (!moved && Math.abs(x - x0) < DRAG_PX) return
      if (!moved) {
        moved = true
        // the axis holds still while the window is drawn (the loupe would warp it under the pointer)
        freezeAxis(p.ax.zone ? { k: p.ax.zone.k, zone: [p.ax.zone.a, p.ax.zone.b] } : { k: 1, zone: [0, 0] })
      }
      const a = snap(Math.min(x0, x))
      let b = snap(Math.max(x0, x))
      if (b - a < step) b = a + step
      setBracket({ lane: p.meta.lane, a, b })
    }
    const up = (ev: PointerEvent) => {
      lane.removeEventListener('pointermove', move)
      lane.removeEventListener('pointerup', up)
      lane.removeEventListener('pointercancel', up)
      if (moved) {
        freezeAxis(null)
        return
      }
      if (ev.type === 'pointercancel') return
      setFocusLane(p.meta.lane)
      const op = opAt(marks, ev.clientX - box.left, touch ? 10 : 5)
      if (op) p.onOp(op, ev.clientX, lane)
    }
    lane.addEventListener('pointermove', move)
    lane.addEventListener('pointerup', up)
    lane.addEventListener('pointercancel', up)
  }

  const W = Math.max(1, p.width)
  const x = (time: number) => xOf(p.ax, time, W)
  const selRun = sel?.run
  const leadFlag = sel ? marks.flags.find((f) => f.sel) : undefined
  const laneAria = t('features.recorder.lane.aria', { lane: p.meta.title, ops: unit(t, lang, 'ops', marks.count) })

  return (
    <div
      ref={ref}
      className="lane"
      role="group"
      aria-label={laneAria}
      aria-current={sel ? 'true' : undefined}
      data-lane={p.meta.lane}
      data-sel={sel ? '' : undefined}
      tabIndex={p.focused ? 0 : -1}
      onFocus={(e) => e.target === e.currentTarget && setFocusLane(p.meta.lane)}
      onPointerDown={onPointerDown}
    >
      {marks.ranges.map((r, i) => (
        <i key={i} className={r.bar ? 'ev ev--bar' : 'ev'} style={{ left: r.x0, width: Math.max(1, r.x1 - r.x0) }} />
      ))}
      <svg className="lane__marks" width={W} height="100%" viewBox={`0 0 ${W} 30`} preserveAspectRatio="none" aria-hidden="true">
        {dim && <path className="copy" d={dim} />}
        {plain && <path className="ev" d={plain} />}
        {hot && <path className="sel" d={hot} />}
      </svg>
      {marks.flags.map((f) => {
        const lead = f === leadFlag && sel
        const label = flagLabel(f.runs)
        const left = lead ? x(sel.a) - 9 : f.x
        if (lead && fracOf(p.ax, sel.a) < 0) return null
        return (
          <button
            key={f.runs.join(' ')}
            type="button"
            className="flag"
            style={{ left }}
            tabIndex={-1}
            data-runs={f.runs.join(' ')}
            data-sel={f.sel ? '' : undefined}
            data-lead={lead ? '' : undefined}
            aria-label={t('features.recorder.flag.aria', { label, time: hm(f.first) })}
            title={`${label} · ${hm(f.first)}`}
            onClick={() => bracketRuns(p.meta.lane, f.runs)}
          />
        )
      })}
      {marks.flags.map((f) => {
        const lead = f === leadFlag && sel
        const label = flagLabel(f.runs)
        if (lead) {
          const rec = selRun ? p.runs[selRun] : undefined
          const seq = rec?.meta?.seq
          const head = seq ? t('features.recorder.flag.run', { n: seq }) : p.meta.title
          const ops = rec?.ops ?? marks.count
          const places = rec ? rec.places.rows + rec.places.pages + rec.places.schema + rec.places.views : 0
          const tail = places ? t('features.recorder.flag.runSpan', { ops: unit(t, lang, 'ops', ops), places: unit(t, lang, 'places', places) }) : unit(t, lang, 'ops', ops)
          return (
            <span key={`l${f.runs[0]}`} className="ev-l" data-sel="" data-lead="" data-anchor={x(sel.a)} data-shift="lead" data-gap={0} data-alt={x(sel.b) + 12} style={{ left: x(sel.a) - 24 }}>
              {head}
              <br />
              {tail}
            </span>
          )
        }
        // a flag whose runs reach past its pennant (a burst of ticks): the label after the range's end, flipping to its
        // start — never over its own ticks (tape.js `ev-l--after`)
        const end = x(f.last)
        const ranged = end - f.x > PENNANT_PX
        return (
          <span
            key={`l${f.runs[0]}`}
            className="ev-l"
            data-sel={f.sel ? '' : undefined}
            data-anchor={ranged ? end : f.x}
            data-shift={ranged ? 8 : 14}
            data-gap={ranged ? 8 : 6}
            data-start={ranged ? f.x : undefined}
            data-flips="1"
            style={{ left: ranged ? end + 8 : f.x + 14 }}
          >
            {label}
          </span>
        )
      })}
      {sel && <div className="bracket" style={{ left: x(sel.a), width: Math.max(2, x(sel.b) - x(sel.a)) }} />}
      {p.out?.map((e) => {
        const x0 = x(e.a)
        const x1 = x(e.b)
        if (x1 < 0 || x0 > W) return null
        return (
          <Fragment key={e.id}>
            <div className="bracket bracket--out" style={{ left: x0, width: Math.max(2, x1 - x0) }} data-eject={e.id} />
            <span className="ev-l ev-l--out" data-anchor={x1} data-shift={8} data-gap={8} data-start={x0} data-flips="1" style={{ left: x1 + 8 }}>
              <Eject aria-hidden />
              {t('features.recorder.flag.out', { time: hm(e.at), back: fmtNum(e.back, lang), all: fmtNum(e.all, lang) })}
            </span>
          </Fragment>
        )
      })}
      {p.held?.map((h) => (
        <Fragment key={h.p}>
          <i className="held" style={{ left: x(h.at) }} data-held={h.p} aria-hidden="true" />
          <span className="held__n" data-anchor={x(h.at)} data-shift={8} data-gap={8} data-flips="1" style={{ left: x(h.at) + 8 }} aria-hidden="true">
            {h.label}
          </span>
        </Fragment>
      ))}
    </div>
  )
})

/** For the lane labels: Vorgänge of a lane in the span (ops or histogram; synced-block copies never count). */
export function laneCount(ops: JOp[] | undefined, hist: Array<[number, number]> | undefined, t0: number, t1: number): number {
  if (hist) {
    let n = 0
    for (const [m, c] of hist) {
      const t = m * 60_000 + 30_000
      if (t >= t0 && t <= t1) n += c
    }
    return n
  }
  return countOps(ops, t0, t1)
}

export type { LaneKey }
