/**
 * The tape's time axis (pure): zoom levels, the loupe (a piecewise linear map that gives the selected window
 * k times the room of the time around it) with its inverse, the visible span, ruler ticks and labels within
 * the density limits, the phone fit, a run's bracket rounded to the 5-minute tick, and the 24 h strip.
 * Times are epoch ms; "local" alignment (ticks on whole local minutes / hours) takes the time zone offset as a
 * function, so Node specs pin it.
 *
 *   u(t) = (t − T0) + (k − 1) · (clamp(t, a, b) − clamp(T0, a, b))      — the loupe's units
 *        = t − T0                              if t ≤ a      (T0 ≤ a: exactly the design's three cases)
 *        = (a − T0) + (t − a) · k              if a < t ≤ b
 *        = (a − T0) + (b − a) · k + (t − b)    if t > b
 *   x(t) = u(t) / u(T1) · width
 */

export type Zoom = '15m' | '75m' | '6h' | '24h'
export const ZOOMS: Zoom[] = ['15m', '75m', '6h', '24h']

const S = 1000
const M = 60_000
const H = 3_600_000
export const DAY = 24 * H
export const QUARTER = 15 * M

/** Ruler tick classes: 10-second · minute · 5-minute · 15-minute (heights 3 · 4 · 9 · 13 px at 75 MIN). */
export type TickClass = 's' | 'm' | 't' | 'h'

export interface ZoomSpec {
  /** the visible span */
  span: number
  /** following now, the right edge is now rounded up to this step */
  edge: number
  /** tick levels, finest first */
  ticks: Array<{ step: number; cls: TickClass }>
  /** labels (HH:MM) every … */
  label: number
  /** 15 MIN: a short label (":mm") every minute between the long ones */
  minorLabel?: number
  /** the loupe works at this zoom (15 MIN: off) */
  loupe: boolean
  /** a dragged bracket edge snaps to this step */
  snap: number
}

export const ZOOM: Record<Zoom, ZoomSpec> = {
  '15m': { span: 15 * M, edge: M, ticks: [{ step: 10 * S, cls: 's' }, { step: M, cls: 'm' }, { step: 5 * M, cls: 't' }, { step: 15 * M, cls: 'h' }], label: 5 * M, minorLabel: M, loupe: false, snap: 10 * S },
  '75m': { span: 75 * M, edge: 5 * M, ticks: [{ step: 10 * S, cls: 's' }, { step: M, cls: 'm' }, { step: 5 * M, cls: 't' }, { step: 15 * M, cls: 'h' }], label: 15 * M, loupe: true, snap: M },
  '6h': { span: 6 * H, edge: 15 * M, ticks: [{ step: M, cls: 's' }, { step: 5 * M, cls: 'm' }, { step: 15 * M, cls: 't' }, { step: H, cls: 'h' }], label: H, loupe: true, snap: 5 * M },
  '24h': { span: DAY, edge: H, ticks: [{ step: 5 * M, cls: 's' }, { step: 15 * M, cls: 'm' }, { step: H, cls: 't' }, { step: 3 * H, cls: 'h' }], label: 3 * H, loupe: true, snap: 15 * M },
}

/** Least distance between two drawn ticks / two labels (px). */
export const TICK_MIN_PX = 4
export const LABEL_MIN_PX = 28
/** The loupe never gives the window more than this many times its room. */
export const LOUPE_MAX = 6

/** Minutes east of UTC at `t`, in ms (the local clock = t + offset). */
export type Offset = (t: number) => number
export const localOffset: Offset = (t) => -new Date(t).getTimezoneOffset() * M

/** `t` rounded down / up to a whole local step (a minute, a quarter, an hour …). */
export const alignDown = (t: number, step: number, off: Offset = localOffset): number => {
  const o = off(t)
  return Math.floor((t + o) / step) * step - o
}
export const alignUp = (t: number, step: number, off: Offset = localOffset): number => {
  const o = off(t)
  return Math.ceil((t + o) / step) * step - o
}

/* ------------------------------------------------------------------ */
/* The loupe                                                           */
/* ------------------------------------------------------------------ */

export interface Zone {
  a: number
  b: number
  k: number
}

export interface Axis {
  t0: number
  t1: number
  /** null: no loupe (none selected, off, outside the span, or k = 1) */
  zone: Zone | null
  /** u(t1) */
  total: number
}

/**
 * The loupe factor for a window of `len` in a span: at most 6×, and the window never takes more than 60 % of the
 * width (k = 1.5 · (span − len) / len gives exactly 60 %).
 */
export function loupeK(span: number, len: number): number {
  if (!(len > 0) || len >= span) return 1
  return Math.min(LOUPE_MAX, Math.max(1, (1.5 * (span - len)) / len))
}

const clamp = (t: number, a: number, b: number) => (t < a ? a : t > b ? b : t)

/** The axis of a span with an optional window (the FULL bracket — a window partly outside the span still warps it exactly). */
export function makeAxis(t0: number, t1: number, zone?: Zone | null): Axis {
  const z = zone && zone.k > 1 && zone.b > zone.a && zone.b > t0 && zone.a < t1 ? zone : null
  const ax: Axis = { t0, t1, zone: z, total: 1 }
  ax.total = Math.max(1, uOf(ax, t1))
  return ax
}

/** The loupe's units of `t` (ms of unwarped time count 1, inside the window k). */
export function uOf(ax: Axis, t: number): number {
  const z = ax.zone
  if (!z) return t - ax.t0
  return t - ax.t0 + (z.k - 1) * (clamp(t, z.a, z.b) - clamp(ax.t0, z.a, z.b))
}

/** The inverse: the time at loupe units `u`. */
export function tOfU(ax: Axis, u: number): number {
  const z = ax.zone
  if (!z) return ax.t0 + u
  const ua = uOf(ax, z.a)
  const ub = uOf(ax, z.b)
  if (u <= ua) return z.a + (u - ua)
  if (u <= ub) return z.a + (u - ua) / z.k
  return z.b + (u - ub)
}

/** Where `t` sits on the tape: 0 … 1 of its width. */
export const fracOf = (ax: Axis, t: number): number => uOf(ax, t) / ax.total
/** Position in px on a tape `width` wide. */
export const xOf = (ax: Axis, t: number, width: number): number => fracOf(ax, t) * width
/** The time under a pixel. */
export const tAtX = (ax: Axis, x: number, width: number): number => tOfU(ax, (x / Math.max(1, width)) * ax.total)
/** CSS left of a moment (percent of the tape). */
export const pct = (ax: Axis, t: number): string => `${(fracOf(ax, t) * 100).toFixed(3)}%`

/* ------------------------------------------------------------------ */
/* The span                                                            */
/* ------------------------------------------------------------------ */

export interface Span {
  t0: number
  t1: number
}

/** Following now: the right edge is now rounded up to the zoom's edge step (a sliver of future always stays). */
export function followSpan(now: number, zoom: Zoom, off: Offset = localOffset): Span {
  const z = ZOOM[zoom]
  let t1 = alignUp(now, z.edge, off)
  if (t1 - now < z.span * 0.02) t1 = alignUp(t1 + 1, z.edge, off)
  return { t0: t1 - z.span, t1 }
}

/**
 * A span that keeps `t` inside with at least 10 % margin on either side: the current one when it does, else the
 * span moved just enough (never past the edge that follows `now`).
 */
export function spanAround(t: number, zoom: Zoom, cur: Span | null, now: number, off: Offset = localOffset): Span {
  const span = ZOOM[zoom].span
  const live = followSpan(now, zoom, off)
  const margin = span * 0.1
  if (cur && cur.t1 - cur.t0 === span && t >= cur.t0 + margin && t <= cur.t1 - margin) return cur
  let t1 = cur && cur.t1 - cur.t0 === span ? cur.t1 : t + span / 2
  if (t > t1 - margin) t1 = t + margin
  if (t < t1 - span + margin) t1 = t - margin + span
  t1 = Math.min(live.t1, t1)
  return { t0: t1 - span, t1 }
}

/** The span moved by `dt` (pan), never past the edge that follows now. */
export function panSpan(cur: Span, dt: number, now: number, zoom: Zoom, floor: number, off: Offset = localOffset): Span {
  const span = cur.t1 - cur.t0
  const live = followSpan(now, zoom, off)
  let t1 = Math.min(live.t1, cur.t1 + dt)
  if (t1 - span < floor - span / 2) t1 = floor + span / 2
  return { t0: t1 - span, t1 }
}

/* ------------------------------------------------------------------ */
/* Ruler                                                               */
/* ------------------------------------------------------------------ */

export interface Tick {
  t: number
  cls: TickClass
}

/** Ticks of the ruler: each level drawn where its ticks are ≥ 4 px apart (inside the window: k times wider). */
export function rulerTicks(ax: Axis, zoom: Zoom, width: number, off: Offset = localOffset): Tick[] {
  const ppm = width / ax.total
  const k = ax.zone?.k ?? 1
  const out = new Map<number, TickClass>()
  const levels = ZOOM[zoom].ticks
  for (let i = levels.length - 1; i >= 0; i--) {
    const { step, cls } = levels[i]
    const pxOut = step * ppm
    if (pxOut * k < TICK_MIN_PX) continue
    // only inside the window when the level is too dense outside it
    const [from, to] = pxOut >= TICK_MIN_PX ? [ax.t0, ax.t1] : [Math.max(ax.t0, ax.zone!.a), Math.min(ax.t1, ax.zone!.b)]
    for (let t = alignUp(from, step, off); t <= to; t += step) {
      if (out.has(t)) continue
      if (pxOut < TICK_MIN_PX && !(ax.zone && t >= ax.zone.a && t <= ax.zone.b)) continue
      out.set(t, cls)
    }
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([t, cls]) => ({ t, cls }))
}

export interface RulerLabel {
  t: number
  /** 'hm' = "07:15" · 'm' = ":32" */
  fmt: 'hm' | 'm'
  /** base (every label step) · zone (inside the window, centred) · end (the window's end, bold) · minor (15 MIN) */
  kind: 'base' | 'zone' | 'end' | 'minor'
}

const LABEL_STEPS = [M, 5 * M, 15 * M, H, 3 * H]

/** Where a ruler label sits: base / end labels start 4 px right of their tick, zone / minor ones are centred on it. */
export function labelExtent(l: Pick<RulerLabel, 'fmt' | 'kind'>, x: number, charW: number): [number, number] {
  const w = (l.fmt === 'hm' ? 5 : 3) * charW
  return l.kind === 'zone' || l.kind === 'minor' ? [x - w / 2, x + w / 2] : [x + 4, x + 4 + w]
}

/**
 * The ruler's labels: the zoom's own, the window's finer ones and its end — ticks ≥ 28 px apart and never touching
 * (6 px between their extents, `charW` = the mono digit's width), the more important first.
 */
export function rulerLabels(ax: Axis, zoom: Zoom, width: number, off: Offset = localOffset, charW = 6.5): RulerLabel[] {
  const z = ZOOM[zoom]
  const ppm = width / ax.total
  const cand: Array<RulerLabel & { pri: number }> = []
  const zone = ax.zone
  const inside = (t: number) => !!zone && t > zone.a && t <= zone.b
  for (let t = alignUp(ax.t0, z.label, off); t <= ax.t1; t += z.label) if (!inside(t)) cand.push({ t, fmt: 'hm', kind: 'base', pri: 2 })
  if (z.minorLabel)
    for (let t = alignUp(ax.t0, z.minorLabel, off); t <= ax.t1; t += z.minorLabel)
      if ((t + off(t)) % z.label !== 0 && !inside(t)) cand.push({ t, fmt: 'm', kind: 'minor', pri: 1 })
  if (zone) {
    const step = LABEL_STEPS.find((s) => s < z.label && s * ppm * zone.k >= LABEL_MIN_PX)
    if (step)
      for (let t = alignUp(Math.max(zone.a, ax.t0), step, off); t < Math.min(zone.b, ax.t1 + 1); t += step)
        if (t > zone.a) cand.push({ t, fmt: step < H ? 'm' : 'hm', kind: 'zone', pri: 1 })
    if (zone.b <= ax.t1) cand.push({ t: zone.b, fmt: 'hm', kind: 'end', pri: 3 })
  }
  const kept: Array<RulerLabel & { pri: number; x: number; ext: [number, number] }> = []
  for (const c of cand.map((c) => ({ ...c, x: xOf(ax, c.t, width) })).sort((a, b) => b.pri - a.pri || a.t - b.t)) {
    const ext = labelExtent(c, c.x, charW)
    if (kept.some((k) => Math.abs(k.x - c.x) < LABEL_MIN_PX || (ext[0] < k.ext[1] + 6 && ext[1] > k.ext[0] - 6))) continue
    kept.push({ ...c, ext })
  }
  return kept.sort((a, b) => a.t - b.t).map(({ t, fmt, kind }) => ({ t, fmt, kind }))
}

/* ------------------------------------------------------------------ */
/* Phone fit, brackets, snapping                                       */
/* ------------------------------------------------------------------ */

/**
 * The phone's tape is drawn wider than its viewport and scrolled so [from, to] fills the viewport:
 * iw = clientWidth · u(T1) / (u(to) − u(from)), scrollLeft = frac(from) · iw.
 */
export function phoneFit(ax: Axis, clientWidth: number, from: number, to: number): { width: number; scrollLeft: number } {
  const du = uOf(ax, to) - uOf(ax, from)
  const width = du > 0 ? Math.max(clientWidth, (clientWidth * ax.total) / du) : clientWidth
  return { width, scrollLeft: Math.max(0, fracOf(ax, from) * width) }
}

/**
 * A run's window from its flag: edges rounded OUTWARD to the 5-minute tick, half-open — a last write at exactly
 * 07:35:00.000 gives 07:40, never cut.
 */
export function runBracket(first: number, last: number, step = 5 * M, off: Offset = localOffset): { a: number; b: number } {
  const a = alignDown(first, step, off)
  const b = alignDown(last, step, off) + step
  return { a, b }
}

/** Snap a time to the nearest step or edge within `tol` ms (edges win). */
export function snapTime(t: number, step: number, edges: number[], tol: number, off: Offset = localOffset): number {
  let best = t
  let bestD = tol
  for (const e of edges) {
    const d = Math.abs(e - t)
    if (d <= bestD) {
      best = e
      bestD = d
    }
  }
  if (best !== t) return best
  const lo = alignDown(t, step, off)
  return t - lo < lo + step - t ? lo : lo + step
}

/** The loupe's label: "6" at full strength, else rounded (never below 2 while a window is shown). */
export const loupeLabel = (k: number): number => Math.max(1, Math.round(k))

/* ------------------------------------------------------------------ */
/* The 24 h strip                                                      */
/* ------------------------------------------------------------------ */

export interface Strip {
  /** quarter index (ms / 15 min) of the first bar */
  q0: number
  from: number
  to: number
  /** 96 bars, Vorgänge per quarter */
  bars: number[]
}

/** The 96 quarters ending with the one that holds the tape's right edge. */
export function stripRange(t1: number): { q0: number; from: number; to: number } {
  const qEnd = Math.ceil(t1 / QUARTER)
  const q0 = qEnd - 96
  return { q0, from: q0 * QUARTER, to: qEnd * QUARTER }
}

/** Bars from the quarter histogram (quarter index → Vorgänge). */
export function stripBars(t1: number, counts: Map<number, number>): Strip {
  const r = stripRange(t1)
  const bars = new Array<number>(96)
  for (let i = 0; i < 96; i++) bars[i] = counts.get(r.q0 + i) ?? 0
  return { ...r, bars }
}

/** A bar is hot when its quarter overlaps the window [a, b). */
export const quarterHot = (q: number, w: { a: number; b: number } | null): boolean => !!w && q * QUARTER < w.b && (q + 1) * QUARTER > w.a

/** Bar heights in percent: share of the busiest quarter, at least 2 px worth (8 %) when > 0. */
export function barHeights(bars: number[]): number[] {
  const max = Math.max(1, ...bars)
  return bars.map((n) => (n > 0 ? Math.max(8, Math.round((n / max) * 100)) : 0))
}

/** The strip's hour marks every 3 local hours (the first and each midnight carry the weekday). */
export function stripTicks(from: number, to: number, off: Offset = localOffset): Array<{ t: number; day: boolean }> {
  const out: Array<{ t: number; day: boolean }> = []
  let first = true
  for (let t = alignUp(from, 3 * H, off); t < to; t += 3 * H) {
    const midnight = (t + off(t)) % DAY === 0
    out.push({ t, day: first || midnight })
    first = false
  }
  return out
}
