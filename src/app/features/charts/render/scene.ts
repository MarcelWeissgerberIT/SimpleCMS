/**
 * The chart renderer: (spec, data, size) → an SVG scene (VNode tree) + readout targets.
 * Pure — no DOM, no React — so the live block, the static export and the downloads draw
 * exactly the same picture.
 *
 * Instrument look: hairline grid (--rule), ink-3 baseline, mono tick and axis labels,
 * thin marks with a 2px rounded data end, square line markers with a surface ring, a 2px
 * surface gap between touching fills, value labels with a surface halo, selective labels.
 */
import type { ChartData, ChartKind, ChartSpec } from '../types'
import { looksLikeTime } from '../spec'
import { h, type VNode } from './vnode'
import { categoryColors, seriesColor } from './palette'
import { clip, formatValue, monoWidth, niceTicks, sansWidth, tickFormatter, type FormatOptions } from './scale'

export interface SceneText {
  other: string
  total: string
  /** "vs. {label}" under a KPI */
  versus: (label: string) => string
  noData: string
}

export interface SceneOptions {
  width: number
  /** plot height (legend, title and donut list come on top) */
  height: number
  lang: 'en' | 'de'
  text: SceneText
  /** draw the title inside the SVG (downloads) */
  title?: boolean
  /** paint the surface behind the chart (downloads) */
  background?: boolean
}

export interface TargetRow {
  name: string
  color: string
  value: string
}

export interface SceneTarget {
  i: number
  label: string
  /** tooltip anchor (SVG coordinates) */
  x: number
  y: number
  rows: TargetRow[]
  /** hover area */
  hit: { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'path'; d: string } | { kind: 'circle'; cx: number; cy: number; r: number }
}

export interface Scene {
  svg: VNode
  width: number
  height: number
  targets: SceneTarget[]
  /** line-like: a vertical crosshair at the active target */
  crosshair: { top: number; bottom: number } | null
  /** the active target gets a marker of this size (line, area, sparkline) */
  marker: boolean
}

const FONT_MONO = 'var(--font-mono)'
const FONT_SANS = 'var(--font-sans)'
const TICK = { 'font-family': FONT_MONO, 'font-size': 10, 'letter-spacing': 0.4, fill: 'var(--ink-3)' }
const XLABEL = { ...TICK, fill: 'var(--ink-2)' }
const VALUE = { 'font-family': FONT_MONO, 'font-size': 11, 'font-weight': 700, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }
const VALUE_MINOR = { ...VALUE, 'font-weight': 500, fill: 'var(--ink-2)' }
const LEGEND = { 'font-family': FONT_MONO, 'font-size': 10, 'letter-spacing': 0.8, fill: 'var(--ink-2)' }

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

interface Frame {
  nodes: VNode[]
  top: number
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

export function buildScene(spec: ChartSpec, data: ChartData, opts: SceneOptions): Scene {
  const width = Math.max(120, Math.round(opts.width))
  const fmt: FormatOptions = { lang: opts.lang, unit: spec.unit || data.unit, decimals: spec.decimals }
  const hasValues = data.series.some((s) => s.values.some(finite))
  if (data.error || !data.labels.length || !hasValues) return messageScene(spec, width, opts, data.error || opts.text.noData)
  const frame: Frame = { nodes: [], top: 6 }
  if (opts.title && spec.title) {
    frame.nodes.push(h('text', { x: 0, y: 16, 'font-family': FONT_SANS, 'font-size': 15, 'font-weight': 700, fill: 'var(--ink)' }, spec.title))
    frame.top = 30
  }
  const ctx: Ctx = { spec, data, width, height: Math.max(80, Math.round(opts.height)), fmt, opts, frame }
  const kind: ChartKind = spec.kind
  const body =
    kind === 'donut'
      ? donut(ctx)
      : kind === 'kpi'
        ? kpi(ctx)
        : kind === 'sparkline'
          ? sparkline(ctx)
          : kind === 'barH'
            ? barH(ctx)
            : kind === 'scatter'
              ? scatter(ctx)
              : xy(ctx, kind)
  return finish(ctx, body)
}

/* ------------------------------------------------------------------ */
/* Frame pieces                                                        */
/* ------------------------------------------------------------------ */

interface Ctx {
  spec: ChartSpec
  data: ChartData
  width: number
  height: number
  fmt: FormatOptions
  opts: SceneOptions
  frame: Frame
}

interface Body {
  nodes: VNode[]
  height: number
  targets: SceneTarget[]
  crosshair?: { top: number; bottom: number } | null
  marker?: boolean
}

function finish(ctx: Ctx, body: Body): Scene {
  const height = Math.ceil(body.height)
  const children: VNode[] = []
  if (ctx.opts.background) children.push(h('rect', { x: 0, y: 0, width: ctx.width, height, fill: 'var(--surface)' }))
  children.push(...ctx.frame.nodes, ...body.nodes)
  const svg = h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${ctx.width} ${height}`,
      width: ctx.width,
      height,
      class: `ch-svg ch-svg--${ctx.spec.kind}`,
      role: 'img',
      'aria-label': ctx.spec.title || undefined,
      'font-family': FONT_SANS,
    },
    ...children,
  )
  return { svg, width: ctx.width, height, targets: body.targets, crosshair: body.crosshair ?? null, marker: !!body.marker }
}

function messageScene(spec: ChartSpec, width: number, opts: SceneOptions, message: string): Scene {
  const height = Math.max(96, Math.min(opts.height, 160))
  const text = clip(message.toLocaleUpperCase(opts.lang === 'de' ? 'de-DE' : 'en-US'), Math.max(8, Math.floor((width - 80) / 6.4)))
  const tw = monoWidth(text, 10.5)
  const cx = width / 2
  const cy = height / 2
  const nodes: VNode[] = []
  if (opts.background) nodes.push(h('rect', { x: 0, y: 0, width, height, fill: 'var(--surface)' }))
  if (opts.title && spec.title) nodes.push(h('text', { x: 0, y: 16, 'font-family': FONT_SANS, 'font-size': 15, 'font-weight': 700, fill: 'var(--ink)' }, spec.title))
  const line = Math.max(0, Math.min(80, (width - tw) / 2 - 16))
  if (line > 8) {
    nodes.push(h('line', { x1: cx - tw / 2 - 12 - line, x2: cx - tw / 2 - 12, y1: cy, y2: cy, stroke: 'var(--rule-strong)', 'stroke-width': 1 }))
    nodes.push(h('line', { x1: cx + tw / 2 + 12, x2: cx + tw / 2 + 12 + line, y1: cy, y2: cy, stroke: 'var(--rule-strong)', 'stroke-width': 1 }))
  }
  nodes.push(h('text', { x: cx, y: cy, dy: '0.35em', 'text-anchor': 'middle', 'font-family': FONT_MONO, 'font-size': 10.5, 'letter-spacing': 0.84, fill: 'var(--ink-3)', class: 'ch-message' }, text))
  const svg = h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, width, height, class: 'ch-svg ch-svg--empty', role: 'img', 'aria-label': message }, ...nodes)
  return { svg, width, height, targets: [], crosshair: null, marker: false }
}

/** Legend row(s) for ≥ 2 series (or forced); returns the height used. */
function legend(ctx: Ctx, items: Array<{ name: string; color: string }>, style: 'bar' | 'line', y0: number): number {
  const show = ctx.spec.showLegend ?? items.length >= 2
  if (!show || !items.length) return 0
  const upper = (s: string) => s.toLocaleUpperCase(ctx.fmt.lang === 'de' ? 'de-DE' : 'en-US')
  let x = 0
  let row = 0
  const rowH = 16
  for (const it of items) {
    const label = clip(upper(it.name), 28)
    const w = (style === 'line' ? 14 : 9) + 6 + monoWidth(label, 10) + label.length * 0.8 + 16
    if (x > 0 && x + w > ctx.width) {
      x = 0
      row++
    }
    const cy = y0 + row * rowH + 7
    if (style === 'line') ctx.frame.nodes.push(h('rect', { x, y: cy - 1, width: 14, height: 2, fill: it.color, class: 'ch-key' }))
    else ctx.frame.nodes.push(h('rect', { x, y: cy - 4.5, width: 9, height: 9, rx: 1, fill: it.color, class: 'ch-key' }))
    ctx.frame.nodes.push(h('text', { ...LEGEND, x: x + (style === 'line' ? 20 : 15), y: cy, dy: '0.35em' }, label))
    x += w
  }
  return (row + 1) * rowH + 8
}

/** Rounded data end (2px) away from the baseline; square at the baseline. */
function barPath(x: number, w: number, base: number, end: number): string {
  const up = end <= base
  const len = Math.abs(base - end)
  const r = Math.max(0, Math.min(2, w / 2, len))
  if (up) return `M${x},${base}V${end + r}q0,${-r} ${r},${-r}H${x + w - r}q${r},0 ${r},${r}V${base}Z`
  return `M${x},${base}V${end - r}q0,${r} ${r},${r}H${x + w - r}q${r},0 ${r},${-r}V${base}Z`
}

/** Rounded data end to the right (or left for negatives); square at the baseline. */
function hbarPath(y: number, hh: number, base: number, end: number): string {
  const right = end >= base
  const len = Math.abs(end - base)
  const r = Math.max(0, Math.min(2, hh / 2, len))
  if (right) return `M${base},${y}H${end - r}q${r},0 ${r},${r}V${y + hh - r}q0,${r} ${-r},${r}H${base}Z`
  return `M${base},${y}H${end + r}q${-r},0 ${-r},${r}V${y + hh - r}q0,${r} ${r},${r}H${base}Z`
}

const seriesColors = (ctx: Ctx) => ctx.data.series.map((s, i) => seriesColor(i, ctx.spec.colors?.[i] ?? s.color))

function rowsAt(ctx: Ctx, i: number, colors: string[]): TargetRow[] {
  return ctx.data.series.map((s, k) => ({ name: s.name, color: colors[k], value: formatValue(s.values[i], ctx.fmt) }))
}

/** Which x labels to print: every `step`-th (and labels clipped to their slot). */
function labelPlan(labels: string[], spacing: number): { step: number; chars: number } {
  const longest = Math.min(16, Math.max(1, ...labels.map((l) => l.length)))
  const need = longest * 6.2 + 10
  const step = Math.max(1, Math.ceil(need / Math.max(1, spacing)))
  const chars = Math.max(3, Math.floor((spacing * step - 8) / 6.2))
  return { step, chars }
}

/* ------------------------------------------------------------------ */
/* Bar / stacked / line / area                                         */
/* ------------------------------------------------------------------ */

function xy(ctx: Ctx, kind: 'bar' | 'stacked' | 'line' | 'area' | 'scatter' | 'barH' | 'donut' | 'kpi' | 'sparkline'): Body {
  const { data, spec, width, fmt } = ctx
  const colors = seriesColors(ctx)
  const lineLike = kind === 'line' || kind === 'area'
  const stacked = kind === 'stacked'
  const legendH = legend(ctx, data.series.map((s, i) => ({ name: s.name, color: colors[i] })), lineLike ? 'line' : 'bar', ctx.frame.top)
  const top = ctx.frame.top + legendH + 16
  const n = data.labels.length
  const S = data.series.length

  // value domain
  let lo = Infinity
  let hi = -Infinity
  const all: number[] = []
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0
      let neg = 0
      for (const s of data.series) {
        const v = s.values[i]
        if (!finite(v)) continue
        if (v >= 0) pos += v
        else neg += v
        all.push(v)
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    }
  } else
    for (const s of data.series)
      for (const v of s.values)
        if (finite(v)) {
          all.push(v)
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
  if (kind === 'line') {
    // lines may float, but counts and small ranges read better from zero
    if (lo >= 0 && lo <= hi * 0.6) lo = 0
  } else {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  if (spec.yMin !== undefined) lo = spec.yMin
  if (spec.yMax !== undefined) hi = spec.yMax
  const integer = all.every(Number.isInteger) && spec.decimals === undefined
  const showGrid = spec.showGrid !== false
  const plotH = Math.max(40, ctx.height - 22 - 16)
  const ticks = niceTicks(lo, hi, Math.max(2, Math.min(8, Math.round(plotH / 46))), { integer, fixedMin: spec.yMin !== undefined, fixedMax: spec.yMax !== undefined })
  const tf = tickFormatter(ticks.step, fmt)
  const tickText = ticks.ticks.map(tf)
  const ml = showGrid ? Math.max(24, Math.ceil(Math.max(...tickText.map((s) => monoWidth(s, 10) + s.length * 0.4))) + 12) : 6
  const lastLabel = lineLike ? formatValue(data.series[0]?.values[n - 1], fmt) : ''
  const mr = lineLike ? Math.max(14, Math.min(60, monoWidth(lastLabel, 11) / 2 + 4)) : 8
  const pw = Math.max(40, width - ml - mr)
  const bottom = top + plotH
  const span = ticks.max - ticks.min || 1
  const y = (v: number) => bottom - ((Math.max(ticks.min, Math.min(ticks.max, v)) - ticks.min) / span) * plotH
  const base = y(Math.max(ticks.min, Math.min(ticks.max, 0)))

  const band = pw / Math.max(1, n)
  const inset = lineLike && n > 1 ? Math.min(12, band / 2) : 0
  const xAt = (i: number) => (lineLike && n > 1 ? ml + inset + ((pw - inset * 2) * i) / (n - 1) : ml + band * i + band / 2)
  const spacing = lineLike && n > 1 ? (pw - inset * 2) / (n - 1) : band
  const nodes: VNode[] = []

  // grid + ticks
  if (showGrid)
    ticks.ticks.forEach((v, i) => {
      const yy = Math.round(y(v)) + 0.5
      nodes.push(h('line', { x1: ml, x2: ml + pw, y1: yy, y2: yy, stroke: v === 0 ? 'var(--ink-3)' : 'var(--rule)', 'stroke-width': 1, class: v === 0 ? 'ch-base' : 'ch-grid' }))
      nodes.push(h('text', { ...TICK, x: ml - 8, y: yy, dy: '0.32em', 'text-anchor': 'end', class: 'ch-tick' }, tickText[i]))
    })
  if (!showGrid || ticks.min > 0 || ticks.max < 0) {
    const yy = Math.round(showGrid ? y(ticks.min) : base) + 0.5
    nodes.push(h('line', { x1: ml, x2: ml + pw, y1: yy, y2: yy, stroke: 'var(--ink-3)', 'stroke-width': 1, class: 'ch-base' }))
  }

  // x labels
  const plan = labelPlan(data.labels, spacing)
  data.labels.forEach((l, i) => {
    if (i % plan.step !== 0) return
    const x = xAt(i)
    const anchor = lineLike && n > 1 && i === 0 && x - ml < 20 ? 'start' : 'middle'
    nodes.push(h('text', { ...XLABEL, x: anchor === 'start' ? x - 4 : x, y: bottom + 16, 'text-anchor': anchor, class: 'ch-xlabel', 'data-i': i }, clip(l, plan.chars)))
  })

  const targets: SceneTarget[] = []
  const labelW = Math.max(...all.map((v) => monoWidth(formatValue(v, fmt), 11)))
  const valuesMode = spec.showValues ?? (showGrid ? undefined : true)

  if (kind === 'bar' || kind === 'stacked') {
    const single = stacked || S === 1
    const groupW = single ? Math.max(3, Math.min(44, band * 0.62)) : Math.max(S * 3, Math.min(band * 0.8, S * 22 + (S - 1) * 2))
    const barW = single ? groupW : Math.max(2, (groupW - (S - 1) * 2) / S)
    const tops: number[] = []
    for (let i = 0; i < n; i++) {
      const cx = xAt(i)
      let pos = 0
      let neg = 0
      let topY = base
      const segs: VNode[] = []
      data.series.forEach((s, k) => {
        const v = s.values[i]
        if (!finite(v) || v === 0) return
        if (stacked) {
          const from = v >= 0 ? pos : neg
          const to = from + v
          if (v >= 0) pos = to
          else neg = to
          const y0 = y(from)
          const y1 = y(to)
          const gap = Math.abs(y0 - y1) > 4 && from !== 0 ? 2 : 0
          const yy0 = v >= 0 ? y0 - gap : y0 + gap
          segs.push(h('path', { d: barPath(cx - barW / 2, barW, yy0, y1), fill: colors[k], class: 'ch-bar', 'data-i': i }))
          topY = Math.min(topY, y1)
        } else {
          const x0 = single ? cx - barW / 2 : cx - groupW / 2 + k * (barW + 2)
          const y1 = y(v)
          segs.push(h('path', { d: barPath(x0, barW, base, Math.abs(y1 - base) < 1 ? base + (v > 0 ? -1 : 1) : y1), fill: colors[k], class: 'ch-bar', 'data-i': i }))
          topY = Math.min(topY, y1)
        }
      })
      nodes.push(...segs)
      tops.push(topY)
      targets.push({ i, label: data.labels[i], x: cx, y: topY, rows: rowsAt(ctx, i, colors), hit: { kind: 'rect', x: ml + band * i, y: top - 8, w: band, h: plotH + 26 } })
    }
    // value labels: totals for stacks, single series on the caps
    if (valuesMode !== false && (stacked || S === 1)) {
      const totals = data.labels.map((_, i) => (stacked ? data.series.reduce((s, ser) => s + (finite(ser.values[i]) ? ser.values[i]! : 0), 0) : (data.series[0].values[i] ?? null)))
      const fits = band >= Math.max(30, labelW + 6) && n <= 40
      const peak = totals.reduce<number>((bi, v, i) => (finite(v) && (!finite(totals[bi]) || v > (totals[bi] as number)) ? i : bi), 0)
      const uniquePeak = totals.filter((v) => v === totals[peak]).length === 1
      totals.forEach((v, i) => {
        if (!finite(v) || v === 0) return
        const all = valuesMode === true || (valuesMode === undefined && fits)
        if (!(all && fits) && !(uniquePeak && i === peak)) return
        const neg = v < 0
        nodes.push(h('text', { ...(i === peak && uniquePeak ? VALUE : VALUE_MINOR), x: xAt(i), y: neg ? y(v) + 14 : tops[i] - 6, 'text-anchor': 'middle', class: 'ch-value' }, formatValue(v, fmt)))
      })
    }
    return { nodes, height: bottom + 24, targets }
  }

  // line / area
  const series = data.series.map((s, k) => {
    const pts = s.values.map((v, i) => (finite(v) ? ([xAt(i), y(v)] as const) : null))
    return { s, k, pts }
  })
  if (kind === 'area') {
    const zero = Math.max(top, Math.min(bottom, base))
    for (const { k, pts } of series) {
      let run: Array<readonly [number, number]> = []
      const flush = () => {
        if (run.length >= 2) nodes.push(h('path', { d: `M${run[0][0]},${zero}L${run.map((p) => p.join(',')).join('L')}L${run[run.length - 1][0]},${zero}Z`, fill: colors[k], 'fill-opacity': S === 1 ? 0.12 : 0.08, class: 'ch-area' }))
        run = []
      }
      for (const p of pts) {
        if (p) run.push(p)
        else flush()
      }
      flush()
    }
  }
  for (const { k, pts } of series) {
    let d = ''
    let open = false
    for (const p of pts) {
      if (!p) {
        open = false
        continue
      }
      d += `${open ? 'L' : 'M'}${p[0]},${p[1]}`
      open = true
    }
    if (d) nodes.push(h('path', { d, fill: 'none', stroke: colors[k], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'ch-line' }))
  }
  const markers = n <= 36
  if (markers)
    for (const { k, pts } of series)
      pts.forEach((p, i) => {
        if (p) nodes.push(h('rect', { x: p[0] - 3.5, y: p[1] - 3.5, width: 7, height: 7, fill: colors[k], stroke: 'var(--surface)', 'stroke-width': 2, class: 'ch-dot', 'data-i': i }))
      })
  // value labels: the last value (and a unique peak) of a single series; the last of each when several
  if (valuesMode !== false) {
    const fitsAll = spacing >= labelW + 6 && valuesMode === true
    const placed: number[] = []
    for (const { s, pts } of series.slice(0, 4)) {
      const idx = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)
      if (!idx.length) continue
      const last = idx[idx.length - 1]
      const vals = idx.map((i) => s.values[i] as number)
      const max = Math.max(...vals)
      const peak = idx[vals.indexOf(max)]
      const unique = vals.filter((v) => v === max).length === 1
      const pick = fitsAll ? idx : S === 1 ? [...new Set([last, ...(unique && peak !== last ? [peak] : [])])] : [last]
      for (const i of pick) {
        const p = pts[i]!
        const ly = p[1] - 9
        if (!fitsAll && S > 1 && placed.some((yy) => Math.abs(yy - ly) < 13)) continue
        placed.push(ly)
        const anchor = i === n - 1 && n > 1 ? 'end' : 'middle'
        nodes.push(h('text', { ...(i === last ? VALUE : VALUE_MINOR), x: anchor === 'end' ? p[0] + 4 : p[0], y: ly, 'text-anchor': anchor, class: 'ch-value' }, formatValue(s.values[i], fmt)))
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const ys = series.map((s) => s.pts[i]?.[1]).filter(finite)
    const left = i === 0 ? ml : (xAt(i - 1) + xAt(i)) / 2
    const right = i === n - 1 ? ml + pw : (xAt(i) + xAt(i + 1)) / 2
    targets.push({ i, label: data.labels[i], x: xAt(i), y: ys.length ? Math.min(...ys) : bottom, rows: rowsAt(ctx, i, colors), hit: { kind: 'rect', x: left, y: top - 8, w: Math.max(1, right - left), h: plotH + 26 } })
  }
  return { nodes, height: bottom + 24, targets, crosshair: { top, bottom }, marker: true }
}

/* ------------------------------------------------------------------ */
/* Horizontal bars                                                     */
/* ------------------------------------------------------------------ */

function barH(ctx: Ctx): Body {
  const { data, spec, width, fmt } = ctx
  const colors = seriesColors(ctx)
  const legendH = legend(ctx, data.series.map((s, i) => ({ name: s.name, color: colors[i] })), 'bar', ctx.frame.top)
  const top = ctx.frame.top + legendH + 4
  const n = data.labels.length
  const S = data.series.length
  const rowH = Math.max(14, Math.min(40, (ctx.height - 26) / Math.max(1, n)))
  const plotH = rowH * n
  const all = data.series.flatMap((s) => s.values.filter(finite))
  let lo = Math.min(0, ...all)
  let hi = Math.max(0, ...all)
  if (spec.yMin !== undefined) lo = spec.yMin
  if (spec.yMax !== undefined) hi = spec.yMax
  const integer = all.every(Number.isInteger) && spec.decimals === undefined
  const labelCol = Math.min(width * 0.36, Math.max(...data.labels.map((l) => sansWidth(l, 12))) + 14)
  const valueW = Math.max(...all.map((v) => monoWidth(formatValue(v, fmt), 11))) + 10
  const showGrid = spec.showGrid !== false
  const ml = labelCol
  const mr = valueW
  const pw = Math.max(40, width - ml - mr)
  const ticks = niceTicks(lo, hi, Math.max(2, Math.min(6, Math.round(pw / 90))), { integer, fixedMin: spec.yMin !== undefined, fixedMax: spec.yMax !== undefined })
  const span = ticks.max - ticks.min || 1
  const x = (v: number) => ml + ((Math.max(ticks.min, Math.min(ticks.max, v)) - ticks.min) / span) * pw
  const base = x(Math.max(ticks.min, Math.min(ticks.max, 0)))
  const bottom = top + plotH
  const nodes: VNode[] = []
  const tf = tickFormatter(ticks.step, fmt)
  if (showGrid)
    ticks.ticks.forEach((v) => {
      const xx = Math.round(x(v)) + 0.5
      nodes.push(h('line', { x1: xx, x2: xx, y1: top, y2: bottom, stroke: v === 0 ? 'var(--ink-3)' : 'var(--rule)', 'stroke-width': 1, class: v === 0 ? 'ch-base' : 'ch-grid' }))
      nodes.push(h('text', { ...TICK, x: xx, y: bottom + 14, 'text-anchor': 'middle', class: 'ch-tick' }, tf(v)))
    })
  else nodes.push(h('line', { x1: Math.round(base) + 0.5, x2: Math.round(base) + 0.5, y1: top, y2: bottom, stroke: 'var(--ink-3)', 'stroke-width': 1, class: 'ch-base' }))
  const thick = S === 1 ? Math.max(3, Math.min(22, rowH * 0.62)) : Math.max(2, Math.min(16, (rowH * 0.8 - (S - 1) * 2) / S))
  const group = S * thick + (S - 1) * 2
  const chars = Math.max(4, Math.floor((labelCol - 12) / 6.4))
  const targets: SceneTarget[] = []
  const valuesMode = spec.showValues ?? true
  for (let i = 0; i < n; i++) {
    const cy = top + rowH * i + rowH / 2
    nodes.push(h('text', { x: ml - 10, y: cy, dy: '0.35em', 'text-anchor': 'end', 'font-family': FONT_SANS, 'font-size': 12, fill: 'var(--ink-2)', class: 'ch-ylabel', 'data-i': i }, clip(data.labels[i], chars)))
    let ends = base
    data.series.forEach((s, k) => {
      const v = s.values[i]
      if (!finite(v)) return
      const y0 = cy - group / 2 + k * (thick + 2)
      const end = x(v)
      nodes.push(h('path', { d: hbarPath(y0, thick, base, Math.abs(end - base) < 1 ? base + (v >= 0 ? 1 : -1) : end), fill: colors[k], class: 'ch-bar', 'data-i': i }))
      if (valuesMode !== false && rowH >= 14 && (S === 1 || thick >= 10))
        nodes.push(h('text', { ...(S === 1 ? VALUE : VALUE_MINOR), x: v >= 0 ? end + 6 : end - 6, y: y0 + thick / 2, dy: '0.35em', 'text-anchor': v >= 0 ? 'start' : 'end', class: 'ch-value' }, formatValue(v, fmt)))
      ends = Math.max(ends, end)
    })
    targets.push({ i, label: data.labels[i], x: Math.min(ends, ml + pw), y: cy - group / 2, rows: rowsAt(ctx, i, colors), hit: { kind: 'rect', x: 0, y: top + rowH * i, w: width, h: rowH } })
  }
  return { nodes, height: bottom + (showGrid ? 22 : 6), targets }
}

/* ------------------------------------------------------------------ */
/* Scatter                                                             */
/* ------------------------------------------------------------------ */

function scatter(ctx: Ctx): Body {
  const { data, spec, width, fmt } = ctx
  const numLabels = data.labels.length > 0 && data.labels.every((l) => l.trim() !== '' && Number.isFinite(Number(l)))
  // x from numeric labels · else from the first series (x, y columns) · else 1 … n
  const pairMode = !numLabels && data.series.length >= 2
  const xs = numLabels ? data.labels.map(Number) : pairMode ? data.series[0].values : data.labels.map((_, i) => i + 1)
  const ys = pairMode ? data.series.slice(1) : data.series
  const colors = ys.map((s, i) => seriesColor(i, ctx.spec.colors?.[i] ?? s.color))
  const legendH = legend(ctx, ys.map((s, i) => ({ name: s.name, color: colors[i] })), 'bar', ctx.frame.top)
  const top = ctx.frame.top + legendH + 10
  const plotH = Math.max(40, ctx.height - 22 - 16)
  const vx = xs.filter(finite)
  const vy = ys.flatMap((s) => s.values.filter(finite))
  const tx = niceTicks(Math.min(...vx), Math.max(...vx), Math.max(2, Math.min(8, Math.round(width / 110))), { integer: vx.every(Number.isInteger) })
  const ty = niceTicks(spec.yMin ?? Math.min(...vy), spec.yMax ?? Math.max(...vy), Math.max(2, Math.min(8, Math.round(plotH / 46))), { integer: vy.every(Number.isInteger) && spec.decimals === undefined, fixedMin: spec.yMin !== undefined, fixedMax: spec.yMax !== undefined })
  const tfx = tickFormatter(tx.step, { lang: fmt.lang })
  const tfy = tickFormatter(ty.step, fmt)
  const tyText = ty.ticks.map(tfy)
  const ml = Math.max(24, Math.ceil(Math.max(...tyText.map((s) => monoWidth(s, 10)))) + 12)
  const mr = 12
  const pw = Math.max(40, width - ml - mr)
  const bottom = top + plotH
  const X = (v: number) => ml + ((v - tx.min) / (tx.max - tx.min || 1)) * pw
  const Y = (v: number) => bottom - ((v - ty.min) / (ty.max - ty.min || 1)) * plotH
  const nodes: VNode[] = []
  ty.ticks.forEach((v, i) => {
    const yy = Math.round(Y(v)) + 0.5
    nodes.push(h('line', { x1: ml, x2: ml + pw, y1: yy, y2: yy, stroke: i === 0 ? 'var(--ink-3)' : 'var(--rule)', 'stroke-width': 1, class: i === 0 ? 'ch-base' : 'ch-grid' }))
    nodes.push(h('text', { ...TICK, x: ml - 8, y: yy, dy: '0.32em', 'text-anchor': 'end', class: 'ch-tick' }, tyText[i]))
  })
  tx.ticks.forEach((v) => {
    const xx = Math.round(X(v)) + 0.5
    nodes.push(h('line', { x1: xx, x2: xx, y1: top, y2: bottom, stroke: 'var(--rule)', 'stroke-width': 1, class: 'ch-grid' }))
    nodes.push(h('text', { ...XLABEL, x: xx, y: bottom + 16, 'text-anchor': 'middle', class: 'ch-xlabel' }, tfx(v)))
  })
  if (pairMode) nodes.push(h('text', { ...TICK, x: ml + pw, y: bottom - 6, 'text-anchor': 'end', class: 'ch-axis-title' }, clip(data.series[0].name.toLocaleUpperCase(), 30)))
  const targets: SceneTarget[] = []
  const order = xs.map((x, i) => ({ x, i })).filter((p) => finite(p.x)).sort((a, b) => (a.x as number) - (b.x as number))
  for (const { x, i } of order) {
    const rows: TargetRow[] = ys.map((s, k) => ({ name: s.name, color: colors[k], value: formatValue(s.values[i], fmt) }))
    if (pairMode) rows.unshift({ name: data.series[0].name, color: 'var(--ink-3)', value: formatValue(x, { lang: fmt.lang }) })
    const yv = ys.map((s) => s.values[i]).filter(finite)
    ys.forEach((s, k) => {
      const v = s.values[i]
      if (finite(v)) nodes.push(h('circle', { cx: X(x as number), cy: Y(v), r: 4, fill: colors[k], stroke: 'var(--surface)', 'stroke-width': 2, class: 'ch-point', 'data-i': i }))
    })
    if (!yv.length) continue
    const cy = Y(Math.max(...yv))
    targets.push({ i, label: pairMode || !numLabels ? data.labels[i] : formatValue(x, { lang: fmt.lang }), x: X(x as number), y: cy, rows, hit: { kind: 'circle', cx: X(x as number), cy, r: 10 } })
  }
  return { nodes, height: bottom + 24, targets, marker: false }
}

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */

const MAX_SLICES = 6

function donut(ctx: Ctx): Body {
  const { data, spec, width, fmt, opts } = ctx
  const s = data.series[0]
  type Slice = { i: number; label: string; value: number; color: string }
  const own = data.labelColors ?? []
  const palette = categoryColors(data.labels.length, own, spec.colors ?? [])
  let slices: Slice[] = data.labels.map((label, i) => ({ i, label, value: Math.max(0, s.values[i] ?? 0), color: palette[i] })).filter((x) => x.value > 0)
  if (slices.length > MAX_SLICES) {
    const head = [...slices].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1)
    const keep = new Set(head.map((x) => x.i))
    const rest = slices.filter((x) => !keep.has(x.i))
    slices = [...slices.filter((x) => keep.has(x.i)), { i: -1, label: opts.text.other, value: rest.reduce((a, x) => a + x.value, 0), color: 'var(--ink-3)' }]
  }
  const total = slices.reduce((a, x) => a + x.value, 0) || 1
  const wide = width >= 440
  const top = ctx.frame.top + 6
  const D = Math.max(96, Math.min(ctx.height - 12, wide ? Math.min(260, width * 0.42) : Math.min(240, width - 24)))
  const r = D / 2
  const ri = r * 0.62
  const cx = wide ? r + 4 : width / 2
  const cy = top + r
  const nodes: VNode[] = []
  const targets: SceneTarget[] = []
  let a0 = -Math.PI / 2
  const pt = (a: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]
  const one = slices.length === 1
  for (const sl of slices) {
    const a1 = a0 + (sl.value / total) * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const [x0, y0] = pt(a0, r)
    const [x1, y1] = pt(a1, r)
    const [x2, y2] = pt(a1, ri)
    const [x3, y3] = pt(a0, ri)
    const d = one
      ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0M${cx - ri},${cy}a${ri},${ri} 0 1,1 ${2 * ri},0a${ri},${ri} 0 1,1 ${-2 * ri},0Z`
      : `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${ri},${ri} 0 ${large} 0 ${x3},${y3}Z`
    const idx = targets.length
    nodes.push(h('path', { d, fill: sl.color, 'fill-rule': 'evenodd', stroke: 'var(--surface)', 'stroke-width': one ? 0 : 2, 'stroke-linejoin': 'round', class: 'ch-slice', 'data-i': idx }))
    const mid = (a0 + a1) / 2
    const [ax, ay] = pt(mid, (r + ri) / 2)
    const share = `${formatValue((sl.value / total) * 100, { lang: fmt.lang, decimals: 1 })}%`
    targets.push({ i: idx, label: sl.label, x: ax, y: ay, rows: [{ name: s.name, color: sl.color, value: `${formatValue(sl.value, fmt)} · ${share}` }], hit: { kind: 'path', d } })
    a0 = a1
  }
  // centre: the total
  const totalText = formatValue(slices.reduce((a, x) => a + x.value, 0), fmt)
  const size = Math.max(14, Math.min(30, (ri * 1.5) / Math.max(1, totalText.length * 0.68)))
  nodes.push(h('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-family': FONT_SANS, 'font-size': size, 'font-weight': 800, 'font-stretch': '125%', fill: 'var(--ink)', class: 'ch-center' }, totalText))
  nodes.push(h('text', { ...TICK, x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'ch-centerlabel' }, opts.text.total.toLocaleUpperCase()))

  // legend list: swatch · label · value · share
  const listX = wide ? D + 32 : 0
  const listW = wide ? width - listX : width
  let ly = wide ? top + Math.max(0, r - (slices.length * 24) / 2) : top + D + 18
  const chars = Math.max(6, Math.floor((listW - 130) / 6.6))
  slices.forEach((sl, k) => {
    const cyy = ly + 10
    nodes.push(h('rect', { x: listX, y: cyy - 4.5, width: 9, height: 9, rx: 1, fill: sl.color, class: 'ch-key', 'data-i': k }))
    nodes.push(h('text', { x: listX + 17, y: cyy, dy: '0.35em', 'font-family': FONT_SANS, 'font-size': 12.5, fill: 'var(--ink)', class: 'ch-legend-label', 'data-i': k }, clip(sl.label, chars)))
    nodes.push(h('text', { ...TICK, x: listX + listW - 46, y: cyy, dy: '0.35em', 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ink)', class: 'ch-legend-value' }, formatValue(sl.value, fmt)))
    nodes.push(h('text', { ...TICK, x: listX + listW - 2, y: cyy, dy: '0.35em', 'text-anchor': 'end', class: 'ch-legend-share' }, `${formatValue((sl.value / total) * 100, { lang: fmt.lang, decimals: 0 })}%`))
    nodes.push(h('line', { x1: listX, x2: listX + listW, y1: ly + 21.5, y2: ly + 21.5, stroke: 'var(--rule)', 'stroke-width': 1 }))
    const t = targets[k]
    targets.push({ ...t, i: k, hit: { kind: 'rect', x: listX, y: ly, w: listW, h: 22 } })
    ly += 24
  })
  const height = wide ? Math.max(top + D + 8, ly + 6) : ly + 6
  return { nodes, height, targets }
}

/* ------------------------------------------------------------------ */
/* KPI + sparkline                                                     */
/* ------------------------------------------------------------------ */

function lastTwo(values: (number | null)[]): { last: number | null; lastIdx: number; prev: number | null; prevIdx: number } {
  let lastIdx = -1
  let prevIdx = -1
  for (let i = values.length - 1; i >= 0; i--) {
    if (!finite(values[i])) continue
    if (lastIdx < 0) lastIdx = i
    else {
      prevIdx = i
      break
    }
  }
  return { last: lastIdx >= 0 ? values[lastIdx] : null, lastIdx, prev: prevIdx >= 0 ? values[prevIdx] : null, prevIdx }
}

function spark(values: (number | null)[], x0: number, y0: number, w: number, hh: number, color: string, dense: boolean): { nodes: VNode[]; pts: Array<[number, number] | null> } {
  const vals = values.filter(finite)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const n = values.length
  const X = (i: number) => x0 + (n > 1 ? (w * i) / (n - 1) : w / 2)
  const Y = (v: number) => y0 + hh - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * hh
  const pts = values.map((v, i) => (finite(v) ? ([X(i), Y(v)] as [number, number]) : null))
  let d = ''
  let open = false
  for (const p of pts) {
    if (!p) {
      open = false
      continue
    }
    d += `${open ? 'L' : 'M'}${p[0]},${p[1]}`
    open = true
  }
  const nodes: VNode[] = []
  const real = pts.filter((p): p is [number, number] => !!p)
  if (dense && real.length >= 2) nodes.push(h('path', { d: `M${real[0][0]},${y0 + hh}L${real.map((p) => p.join(',')).join('L')}L${real[real.length - 1][0]},${y0 + hh}Z`, fill: color, 'fill-opacity': 0.1, class: 'ch-area' }))
  if (d) nodes.push(h('path', { d, fill: 'none', stroke: color, 'stroke-width': dense ? 2 : 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'ch-line' }))
  const last = real[real.length - 1]
  if (last) nodes.push(h('rect', { x: last[0] - 3.5, y: last[1] - 3.5, width: 7, height: 7, fill: 'var(--signal)', stroke: 'var(--surface)', 'stroke-width': 2, class: 'ch-dot' }))
  return { nodes, pts }
}

function kpi(ctx: Ctx): Body {
  const { data, width, fmt, opts } = ctx
  const s = data.series[0]
  const timeLike = looksLikeTime(data)
  const nodes: VNode[] = []
  const top = ctx.frame.top
  const H = ctx.height
  const { last, lastIdx, prev, prevIdx } = lastTwo(s.values)
  // time series: the latest bucket vs the one before · categories: the total
  const total = s.values.reduce<number>((a, v) => a + (finite(v) ? v : 0), 0)
  const value = timeLike || s.values.filter(finite).length === 1 ? last : total
  const caption = (timeLike && lastIdx >= 0 ? `${s.name} · ${data.labels[lastIdx]}` : data.series.length > 1 || s.values.length > 1 ? `${s.name} · ${opts.text.total}` : s.name).toLocaleUpperCase()
  const wide = width >= 420
  const sparkW = wide ? Math.min(260, width * 0.38) : width
  const numW = wide ? width - sparkW - 24 : width
  const text = formatValue(value, fmt)
  let size = Math.max(28, Math.min(72, H * 0.38))
  const est = (sz: number) => sansWidth(text, sz) * 1.2
  while (size > 22 && est(size) > numW) size -= 2
  nodes.push(h('text', { ...TICK, 'font-size': 10.5, 'letter-spacing': 0.84, x: 0, y: top + 12, class: 'ch-kpi-label' }, clip(caption, Math.floor(numW / 7))))
  const numY = top + 18 + size * 0.86
  nodes.push(h('text', { x: -2, y: numY, 'font-family': FONT_SANS, 'font-size': size, 'font-weight': 800, 'font-stretch': '125%', 'letter-spacing': -size * 0.02, fill: 'var(--ink)', class: 'ch-kpi-value' }, text))
  let y = numY + 22
  if (timeLike && finite(last) && finite(prev)) {
    const diff = last - prev
    const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '■'
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±'
    const delta = pct !== null ? `${sign}${formatValue(Math.abs(pct), { lang: fmt.lang, decimals: 1 })}%` : `${sign}${formatValue(Math.abs(diff), fmt)}`
    nodes.push(h('text', { x: 0, y, 'font-family': FONT_MONO, 'font-size': 11, 'letter-spacing': 0.4, fill: 'var(--ink-2)', class: 'ch-kpi-delta' }, h('tspan', { fill: diff > 0 ? 'var(--signal)' : 'var(--ink)' }, arrow), ` ${delta}  ${opts.text.versus(data.labels[prevIdx] ?? '')}`.toLocaleUpperCase()))
    y += 10
  }
  const targets: SceneTarget[] = []
  let height = Math.max(H, y + 8)
  if (s.values.filter(finite).length >= 2) {
    const sx = wide ? width - sparkW : 0
    const sy = wide ? top + 18 : y + 8
    const sh = wide ? Math.max(36, Math.min(H - 36, size + 20)) : 44
    const sp = spark(s.values, sx + 4, sy, sparkW - 8, sh, 'var(--ink-3)', false)
    nodes.push(...sp.nodes)
    sp.pts.forEach((p, i) => {
      if (!p) return
      targets.push({ i, label: data.labels[i], x: p[0], y: p[1], rows: [{ name: s.name, color: 'var(--ink-3)', value: formatValue(s.values[i], fmt) }], hit: { kind: 'rect', x: p[0] - (sparkW / s.values.length) / 2, y: sy - 6, w: sparkW / s.values.length, h: sh + 12 } })
    })
    height = Math.max(height, sy + sh + 10)
  }
  return { nodes, height, targets, crosshair: null, marker: true }
}

function sparkline(ctx: Ctx): Body {
  const { data, width, fmt } = ctx
  const colors = seriesColors(ctx)
  const s = data.series[0]
  const top = ctx.frame.top
  const nodes: VNode[] = []
  const { last } = lastTwo(s.values)
  const lastText = formatValue(last, fmt)
  nodes.push(h('text', { ...TICK, 'font-size': 10.5, 'letter-spacing': 0.84, x: 0, y: top + 12, class: 'ch-kpi-label' }, clip(s.name.toLocaleUpperCase(), Math.floor((width - 120) / 7))))
  nodes.push(h('text', { x: width, y: top + 16, 'text-anchor': 'end', 'font-family': FONT_SANS, 'font-size': 20, 'font-weight': 800, 'font-stretch': '125%', fill: 'var(--ink)', class: 'ch-kpi-value' }, lastText))
  const sy = top + 30
  const sh = Math.max(24, ctx.height - 54)
  const sp = spark(s.values, 4, sy, width - 8, sh, colors[0], true)
  nodes.push(...sp.nodes)
  // min / max ticks under the line
  const vals = s.values.filter(finite)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  nodes.push(h('text', { ...TICK, x: 0, y: sy + sh + 16, class: 'ch-tick' }, `${data.labels[0] ?? ''}`))
  nodes.push(h('text', { ...TICK, x: width, y: sy + sh + 16, 'text-anchor': 'end', class: 'ch-tick' }, `${data.labels[data.labels.length - 1] ?? ''}`))
  nodes.push(h('text', { ...TICK, x: width / 2, y: sy + sh + 16, 'text-anchor': 'middle', class: 'ch-tick' }, `${formatValue(lo, fmt)} – ${formatValue(hi, fmt)}`))
  const targets: SceneTarget[] = []
  const n = s.values.length
  sp.pts.forEach((p, i) => {
    if (!p) return
    const w = (width - 8) / Math.max(1, n - 1)
    targets.push({ i, label: data.labels[i], x: p[0], y: p[1], rows: [{ name: s.name, color: colors[0], value: formatValue(s.values[i], fmt) }], hit: { kind: 'rect', x: p[0] - w / 2, y: sy - 6, w, h: sh + 12 } })
  })
  return { nodes, height: sy + sh + 22, targets, crosshair: { top: sy, bottom: sy + sh }, marker: true }
}
