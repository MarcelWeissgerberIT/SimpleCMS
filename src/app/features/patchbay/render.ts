/**
 * The cable layer's geometry and the static picture (plan §3.4, §6 A31 / U15 / U32, B5) — pure.
 *
 * Geometry (the page's wire layer, ui/Wires.tsx, B7, measures the jack centres and calls these; renderStatic uses the
 * same functions over synthetic positions):
 *  - cablePath(a, z): the mock's sagging catenary as one cubic — `dx = max(30, span · 0.42)`, `sag = 8 + rise · 0.1 +
 *    span · 0.06`; a cable that runs backwards (an automation starting a script in § 02) loops out and back in;
 *  - pointAt / fusePoint / labelPoint: a point at a share of the cable's LENGTH (not of the curve's parameter), with
 *    the tangent's angle — the fuse glyph sits at t = 0.5 turned along the cable, a label above its point;
 *  - wireStyle / paintOrder: how a wire is drawn (dashed `can`, hatched `outside`, dotted `planned`, grey "?"
 *    `unknown`) and the order the wires are painted in — each wire's halo right before it, so a later wire knocks the
 *    earlier one out where they cross and crossings read as over / under; the ones that matter most go on top (fuse
 *    paths, lit wires, content from outside, then solid, dashed, unknown, planned at the bottom);
 *  - ticksDash(len): the hatched ticks over the middle 60 % of a cable.
 *
 * renderStatic(model, layout, theme) returns the whole schematic as one SVG document — modules as plates with their
 * kind and name, jacks, net flags, folds, bus chips, cables with halos and plugs, one fuse glyph per fuse. Colours are
 * written as `var(--…)` and design-token mixes, resolved to one theme's STOCK tokens by `theme.resolve` (charts'
 * resolveVars) and flattened to rgb() / rgba() by `theme.flat` (colors.ts flatColor) — so no `var(`, `color-mix(` or
 * `oklch(` is left in the file (§6 A31). Fonts are named with fallbacks. The words come from `theme.text` (the page's
 * own strings); without it the picture names modules by their ids (Node specs). Used by "Picture · zoom" (the diagram
 * viewer, kind 'schematic') and its "Download SVG".
 */
import { flattenColors } from './colors'
import { flagId } from './layout'
import type { BusSlot, ColumnCount, FlagSlot, FoldSlot, Layout, ModuleSlot, Wire } from './layout'
import type { Column, Edge, Fuse, FuseState, Jack, Model, Module, NetLabel } from './types'

/* ------------------------------------------------------------------ geometry */

export interface Pt {
  x: number
  y: number
}

/** One cable: a cubic from `a` to `z` and its SVG path. */
export interface Cable {
  a: Pt
  c1: Pt
  c2: Pt
  z: Pt
  d: string
}

/** A cable whose end lies less than this far right of its start runs backwards: it loops out and back in. */
const MIN_FORWARD = 24

const f1 = (n: number) => String(Math.round(n * 10) / 10)

/** The sagging cable from `a` (an out jack) to `z` (an in jack, a flag); `sag` adds to the mock's sag. */
export function cablePath(a: Pt, z: Pt, sag = 0): Cable {
  const span = Math.abs(z.x - a.x)
  const rise = Math.abs(z.y - a.y)
  let c1: Pt
  let c2: Pt
  if (z.x - a.x >= MIN_FORWARD) {
    const dx = Math.max(30, span * 0.42)
    const s = 8 + rise * 0.1 + span * 0.06 + sag
    c1 = { x: a.x + dx, y: a.y + s }
    c2 = { x: z.x - dx, y: z.y + s }
  } else {
    // backwards (or straight down a column): out to the right of `a`, in from the left of `z`
    const loop = Math.max(48, span * 0.6 + 36)
    const s = 12 + rise * 0.15 + sag
    c1 = { x: a.x + loop, y: a.y + s }
    c2 = { x: z.x - loop, y: z.y - s }
  }
  return { a, c1, c2, z, d: `M${f1(a.x)},${f1(a.y)} C${f1(c1.x)},${f1(c1.y)} ${f1(c2.x)},${f1(c2.y)} ${f1(z.x)},${f1(z.y)}` }
}

function bezier(c: Cable, t: number): Pt {
  const u = 1 - t
  const k0 = u * u * u
  const k1 = 3 * u * u * t
  const k2 = 3 * u * t * t
  const k3 = t * t * t
  return { x: k0 * c.a.x + k1 * c.c1.x + k2 * c.c2.x + k3 * c.z.x, y: k0 * c.a.y + k1 * c.c1.y + k2 * c.c2.y + k3 * c.z.y }
}

function tangent(c: Cable, t: number): Pt {
  const u = 1 - t
  return {
    x: 3 * u * u * (c.c1.x - c.a.x) + 6 * u * t * (c.c2.x - c.c1.x) + 3 * t * t * (c.z.x - c.c2.x),
    y: 3 * u * u * (c.c1.y - c.a.y) + 6 * u * t * (c.c2.y - c.c1.y) + 3 * t * t * (c.z.y - c.c2.y),
  }
}

const STEPS = 48
const tables = new WeakMap<Cable, number[]>()

/** Cumulative lengths at STEPS + 1 evenly spaced parameters (cached per cable). */
function table(c: Cable): number[] {
  let t = tables.get(c)
  if (t) return t
  t = [0]
  let prev = c.a
  for (let i = 1; i <= STEPS; i++) {
    const p = bezier(c, i / STEPS)
    t.push(t[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y))
    prev = p
  }
  tables.set(c, t)
  return t
}

/** The cable's length. */
export function cableLength(c: Cable): number {
  const t = table(c)
  return t[t.length - 1]
}

/** The point at a share `f` (0 … 1) of the cable's length, with the tangent's angle in degrees. */
export function pointAt(c: Cable, f: number): Pt & { angle: number } {
  const t = table(c)
  const want = Math.min(1, Math.max(0, f)) * t[STEPS]
  let i = 1
  while (i < STEPS && t[i] < want) i++
  const seg = t[i] - t[i - 1]
  const u = (i - 1 + (seg > 0 ? (want - t[i - 1]) / seg : 0)) / STEPS
  const p = bezier(c, u)
  const d = tangent(c, u)
  return { ...p, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI }
}

/** Where a fuse glyph sits on its cable: halfway along it, turned along the cable. */
export const fusePoint = (c: Cable, t = 0.5): Pt & { angle: number } => pointAt(c, t)

/** Where a cable's label sits ("3 PROPOSALS"): above the point at `t`. */
export function labelPoint(c: Cable, t = 0.44, dy = -14): Pt {
  const p = pointAt(c, t)
  return { x: p.x, y: p.y + dy }
}

/** The hatched ticks of content from outside: 1.6 / 6 dashes over the middle 60 % of a cable of length `len`. */
export function ticksDash(len: number): string {
  const from = len * 0.2
  const n = Math.max(0, Math.floor((len * 0.6) / 7.6))
  return [`0 ${f1(from)}`, ...Array.from({ length: n }, () => '1.6 6'), `0 ${f1(len)}`].join(' ')
}

/* ------------------------------------------------------------------ how a wire is drawn */

export interface WireStyle {
  /** the AI decides at run time: dashed */
  can: boolean
  /** content from outside (an outside source's cable): hatched ticks */
  outside: boolean
  /** a P2 ghost cable: dotted */
  planned: boolean
  /** this device does not know: a grey "?" mid-cable */
  unknown: boolean
}

/** A wire's style from its edges (a bus wire: dashed / dotted only when all of its cables are; hatched when any is). */
export function wireStyle(wire: Pick<Wire, 'edges'>, edges: ReadonlyMap<string, Edge>): WireStyle {
  const list = wire.edges.map((id) => edges.get(id)).filter((e): e is Edge => !!e)
  const all = (k: keyof Edge) => list.length > 0 && list.every((e) => !!e[k])
  const any = (k: keyof Edge) => list.some((e) => !!e[k])
  // hatched = content from outside on this cable (§2.2 `outside`); a cable that only carries content written from
  // outside (`tainted`) keeps its plain look — the reader's net tag is hatched instead (the mock draws it so, B6)
  return { can: all('can'), outside: any('outside'), planned: all('planned'), unknown: any('unknown') }
}

/**
 * The order wires are painted in (each right after its own halo): planned, unknown, dashed, solid, from outside, then
 * the given `lit` wires (hover / selection) and the wires on a fuse path on top. Stable within a rank.
 */
export function paintOrder(wires: readonly Wire[], edges: ReadonlyMap<string, Edge>, opts: { fuse?: Iterable<string>; lit?: Iterable<string> } = {}): string[] {
  const fuse = new Set(opts.fuse ?? [])
  const lit = new Set(opts.lit ?? [])
  const rank = (w: Wire) => {
    if (w.edges.some((e) => fuse.has(e)) || fuse.has(w.id)) return 6
    if (lit.has(w.id) || w.edges.some((e) => lit.has(e))) return 5
    const s = wireStyle(w, edges)
    if (s.planned) return 0
    if (s.unknown) return 1
    if (s.outside) return 4
    return s.can ? 2 : 3
  }
  return wires
    .map((w, i) => ({ id: w.id, r: rank(w), i }))
    .sort((p, q) => p.r - q.r || p.i - q.i)
    .map((x) => x.id)
}

/** The edges on fuse paths (the glyph's edge and every step's), for paintOrder and the frames. */
export function fuseEdges(fuses: readonly Pick<Fuse, 'at' | 'chain'>[]): Set<string> {
  const out = new Set<string>()
  for (const f of fuses) {
    out.add(f.at)
    for (const s of f.chain.steps) out.add(s.edge)
  }
  return out
}

/* ------------------------------------------------------------------ the static picture: positions */

/** Synthetic measures of the picture (px). */
export const STATIC = { pad: 20, head: 34, col: 300, chan: 96, row: 56, gap: 8, flag: 30, fold: 34, pitch: 21, jackInset: 13 }

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface StaticGeometry {
  width: number
  height: number
  /** slot id → its box */
  boxes: Map<string, Box>
  /** anchor (jack key, flag id, bus id) → its point */
  anchors: Map<string, Pt>
}

const colX = (col: Column) => STATIC.pad + (col - 1) * (STATIC.col + STATIC.chan)
const rowY = (row: number) => STATIC.pad + STATIC.head + (row - 1) * (STATIC.row + STATIC.gap)
const rowsH = (span: number) => span * STATIC.row + (span - 1) * STATIC.gap

/** Monospace and proportional text widths, approximated (the picture is drawn without a DOM). */
const MONO_EM = 0.6
const SANS_EM = 0.55
const textW = (s: string, size: number, mono: boolean) => s.length * size * (mono ? MONO_EM : SANS_EM)

/** Positions of every slot and anchor of a layout, at the picture's measures. */
export function staticGeometry(model: Model, layout: Layout, flagText: (net: NetLabel, side: 'in' | 'out') => string = (n) => n.key): StaticGeometry {
  const boxes = new Map<string, Box>()
  const anchors = new Map<string, Pt>()
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const nets = new Map(model.nets.map((n) => [n.key, n]))
  for (const s of layout.slots) {
    const x = colX(s.col)
    const y = rowY(s.row)
    const h = rowsH(s.span)
    if (s.kind === 'module') {
      boxes.set(s.id, { x, y, w: STATIC.col, h })
      const m = mods.get(s.id)
      if (!m) continue
      const place = (list: Jack[], jx: number) => {
        const pitch = Math.min(STATIC.pitch, (h - 8) / Math.max(1, list.length))
        list.forEach((j, i) => anchors.set(j.key, { x: jx, y: y + h / 2 + (i - (list.length - 1) / 2) * pitch }))
      }
      place(m.inJacks, x + STATIC.jackInset)
      place(m.outJacks, x + STATIC.col - STATIC.jackInset)
    } else if (s.kind === 'flag') {
      const n = nets.get(s.net)
      const label = n ? flagText(n, s.side) : s.net
      const w = Math.min(STATIC.col, Math.max(120, textW(label, 10.5, true) + 46))
      const fy = y + (STATIC.row - STATIC.flag) / 2
      const fx = s.side === 'out' ? x : x + STATIC.col - w
      boxes.set(s.id, { x: fx, y: fy, w, h: STATIC.flag })
      anchors.set(s.id, s.side === 'out' ? { x: fx, y: fy + STATIC.flag / 2 } : { x: fx + w, y: fy + STATIC.flag / 2 })
    } else if (s.kind === 'fold') {
      boxes.set(s.id, { x, y: y + (STATIC.row - STATIC.fold) / 2, w: STATIC.col, h: STATIC.fold })
    } else {
      const bw = 56
      const by = y + (STATIC.row - 24) / 2
      boxes.set(s.id, { x, y: by, w: bw, h: 24 })
      anchors.set(s.id, { x, y: by + 12 })
    }
  }
  const width = STATIC.pad * 2 + STATIC.col * 3 + STATIC.chan * 2
  const height = rowY(layout.rows + 1) - STATIC.gap + STATIC.pad
  return { width, height, boxes, anchors }
}

/* ------------------------------------------------------------------ the static picture: words */

export interface StaticText {
  /** a module's name ("Inbox-Helfer") */
  name(m: Module): string
  /** its kind line ("AGENT", "MCP SERVER", "WEBHOOK") */
  kind(m: Module): string
  /** a jack's label ("READ 3", "WRITE? 4", "OUT 2", "EVERYTHING · 9 DB"; '' = none) */
  jack(j: Jack, m: Module): string
  /** a net flag's name ("MAILS · „WEITERLEITEN“") */
  flag(n: NetLabel, side: 'in' | 'out'): string
  /** a column head ("§ 01 SOURCES · 4 · 3 IDLE") */
  column(col: Column, count: ColumnCount): string
  /** a fold ("3 IDLE · kanal · bildwerk · wiki") */
  fold(f: FoldSlot): string
  /** a bus chip ("+3") */
  bus(b: BusSlot): string
  /** a fuse's label ("F1") */
  fuse(f: Pick<Fuse, 'key' | 'label'>): string
}

/** Words from ids alone (the picture without the page's strings — Node specs). */
const IDS: StaticText = {
  name: (m) => ('name' in m.ref ? m.ref.name : null) ?? m.key.slice(m.key.indexOf(':') + 1),
  kind: (m) => m.kind.toUpperCase(),
  jack: (j) => (j.count !== undefined ? `${j.role.toUpperCase()} ${j.count}` : ''),
  flag: (n) => n.key,
  column: (col, c) => `§ 0${col} · ${c.placed}`,
  fold: (f) => `${f.modules.length} ${f.why.toUpperCase()}`,
  bus: (b) => `+${b.edges.length}`,
  fuse: (f) => f.label,
}

/* ------------------------------------------------------------------ the static picture: SVG */

/**
 * The picture's colours, as design tokens and mixes of them (the mock's definitions). `theme.resolve` writes one
 * theme's stock values in, `theme.flat` turns what is left into rgb() / rgba().
 * B6 adds --pb-cable / --pb-halo / --pb-plug to tokens.css: the cable, halo and plug entries then read those tokens.
 */
const C = {
  bg: 'var(--bg)',
  plate: 'var(--plate)',
  plateEdge: 'var(--plate-edge)',
  plateLo: 'var(--plate-lo)',
  surface: 'var(--surface)',
  modEdge: 'color-mix(in srgb, var(--ink) 26%, transparent)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  signal: 'var(--signal)',
  signalInk: 'var(--signal-ink)',
  // tokens.css --pb-* (B6): the page's wire layer and the picture draw the same cable
  cable: 'var(--pb-cable)',
  halo: 'var(--pb-halo)',
  plug: 'var(--pb-cable)',
  plugRing: 'var(--pb-plug)',
  jack: 'var(--toggle-window)',
  jackRing: 'var(--screw-head)',
  foldEdge: 'color-mix(in srgb, var(--ink) 30%, transparent)',
  screw: 'var(--screw-head)',
}

const SANS = "Archivo, 'Archivo Variable', 'Helvetica Neue', Arial, sans-serif"
const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace"

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cut a text to a width with "…". */
function fit(s: string, width: number, size: number, mono: boolean): string {
  const max = Math.floor(width / (size * (mono ? MONO_EM : SANS_EM)))
  if (s.length <= max) return s
  return max <= 1 ? '…' : `${s.slice(0, max - 1).trimEnd()}…`
}

type Attrs = Record<string, string | number | undefined>
const attrs = (a: Attrs) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? f1(v) : esc(v!)}"`)
    .join('')
const tag = (name: string, a: Attrs, body?: string) => (body === undefined ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${body}</${name}>`)
const text = (x: number, y: number, s: string, a: Attrs) => tag('text', { x, y, ...a }, esc(s))

export interface StaticTheme {
  /** `var(--x)` → one theme's stock value (charts' resolveVars(text, 'light' | 'dark')); none: tokens stay */
  resolve?: (text: string) => string
  /** one colour function → rgb() / rgba() (colors.ts flatColor); none: functions stay */
  flat?: (css: string) => string
  /** the page's words (else ids) */
  text?: Partial<StaticText>
  /** the picture's title (the workspace's name) */
  title?: string
  /** fuses with their state (default model.fuses): an allowed one is drawn in ink, the others in signal */
  fuses?: readonly (Fuse | FuseState)[]
}

/** The whole schematic as one standalone SVG document. */
export function renderStatic(model: Model, layout: Layout, theme: StaticTheme = {}): string {
  const tx: StaticText = { ...IDS, ...theme.text }
  const geo = staticGeometry(model, layout, (n, side) => tx.flag(n, side))
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const edges = new Map(model.edges.map((e) => [e.id, e]))
  const nets = new Map(model.nets.map((n) => [n.key, n]))
  const fuses = theme.fuses ?? model.fuses
  const open = fuses.filter((f) => (f as FuseState).allowed?.state !== 'allowed')
  // what an open fuse runs through: its modules get the dashed signal frame, its flags the dashed signal outline
  const onPath = new Set<string>()
  const pathEdges = fuseEdges(open)
  for (const f of open) {
    if (f.chain.source) onPath.add(f.chain.source)
    if (f.chain.decider) onPath.add(f.chain.decider)
    for (const s of f.chain.steps) {
      onPath.add(s.from)
      if (typeof s.to === 'string') onPath.add(s.to)
    }
  }
  for (const id of pathEdges) {
    const e = edges.get(id)
    if (!e) continue
    if (e.to.startsWith('net:')) (onPath.add(flagId(e.to, 'out')), onPath.add(flagId(e.to, 'in')))
    if (e.from.startsWith('net:')) (onPath.add(flagId(e.from, 'in')), onPath.add(flagId(e.from, 'out')))
  }

  const out: string[] = []
  const { width, height } = geo
  out.push(tag('rect', { x: 0, y: 0, width, height, fill: C.bg }))
  out.push(tag('rect', { x: 6, y: 6, width: width - 12, height: height - 12, rx: 6, fill: C.plate, stroke: C.plateEdge, 'stroke-width': 1 }))
  for (const [sx, sy] of [
    [14, 14],
    [width - 14, 14],
    [14, height - 14],
    [width - 14, height - 14],
  ])
    out.push(tag('circle', { cx: sx, cy: sy, r: 3.2, fill: C.screw, stroke: C.plateEdge, 'stroke-width': 0.8 }))
  if (theme.title) out.push(text(STATIC.pad + 6, STATIC.pad - 2, theme.title, { 'font-family': SANS, 'font-size': 13, 'font-weight': 700, fill: C.ink }))

  // column heads
  for (const col of [1, 2, 3] as const) {
    const x = colX(col)
    const y = STATIC.pad + STATIC.head / 2 + 4
    out.push(text(x + 2, y, tx.column(col, layout.cols[col]), { 'font-family': MONO, 'font-size': 10.5, 'letter-spacing': 0.8, fill: C.ink2 }))
    out.push(
      tag('line', { x1: x, y1: STATIC.pad + STATIC.head - 6, x2: x + STATIC.col, y2: STATIC.pad + STATIC.head - 6, stroke: C.plateLo, 'stroke-width': 1 }),
    )
  }

  // plates: modules, folds, flags, bus chips
  for (const s of layout.slots) {
    const b = geo.boxes.get(s.id)
    if (!b) continue
    if (s.kind === 'module') out.push(modulePlate(mods.get(s.id), s, b, tx, onPath.has(s.id), geo))
    else if (s.kind === 'fold') {
      out.push(tag('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2, fill: 'none', stroke: C.foldEdge, 'stroke-width': 1, 'stroke-dasharray': '4 3' }))
      out.push(text(b.x + 12, b.y + b.h / 2 + 4, fit(tx.fold(s), b.w - 24, 12, false), { 'font-family': SANS, 'font-size': 12, fill: C.ink2 }))
    } else if (s.kind === 'flag') out.push(flagPlate(nets.get(s.net), s, b, tx, onPath.has(s.id)))
    else {
      out.push(tag('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2, fill: C.surface, stroke: C.ink3, 'stroke-width': 1 }))
      out.push(text(b.x + b.w / 2, b.y + 16, tx.bus(s), { 'font-family': MONO, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', fill: C.ink }))
    }
  }

  // cables: each halo right before its cable, in paint order; plugs and marks above them all
  const byId = new Map(layout.wires.map((w) => [w.id, w]))
  const cables = new Map<string, Cable>()
  const wiresOut: string[] = []
  const plugs: string[] = []
  const marks: string[] = []
  for (const id of paintOrder(layout.wires, edges, { fuse: pathEdges })) {
    const w = byId.get(id)!
    const a = geo.anchors.get(w.from)
    const z = geo.anchors.get(w.to)
    if (!a || !z) continue
    const c = cablePath(a, z)
    cables.set(w.id, c)
    const st = wireStyle(w, edges)
    const path = w.edges.some((e) => pathEdges.has(e))
    wiresOut.push(tag('path', { d: c.d, fill: 'none', stroke: C.halo, 'stroke-width': 6.5, 'stroke-linecap': 'round' }))
    wiresOut.push(
      tag('path', {
        d: c.d,
        fill: 'none',
        stroke: st.planned ? C.ink2 : C.cable,
        'stroke-width': st.planned ? 2.2 : 2.6,
        'stroke-linecap': st.can && !st.planned ? 'butt' : 'round',
        'stroke-dasharray': st.planned ? '0.1 5' : st.can ? '7 5' : undefined,
        class: path ? 'pb-wire pb-wire--path' : 'pb-wire',
      }),
    )
    if (st.outside) wiresOut.push(tag('path', { d: c.d, fill: 'none', stroke: C.cable, 'stroke-width': 9, 'stroke-dasharray': ticksDash(cableLength(c)) }))
    for (const [p, end] of [
      [a, w.from],
      [z, w.to],
    ] as const) {
      if (end.startsWith('flag:')) continue // a net flag has no jack
      plugs.push(
        st.planned
          ? tag('circle', { cx: p.x, cy: p.y, r: 5.6, fill: C.plate, stroke: C.ink3, 'stroke-width': 1.2, 'stroke-dasharray': '1.5 2' })
          : tag('circle', { cx: p.x, cy: p.y, r: 5.6, fill: C.plug }) +
              tag('circle', { cx: p.x, cy: p.y, r: 2.4, fill: 'none', stroke: C.plugRing, 'stroke-width': 1 }),
      )
    }
    if (st.unknown) {
      const m = pointAt(c, 0.5)
      marks.push(
        tag('rect', { x: m.x - 8, y: m.y - 8, width: 16, height: 16, rx: 2, fill: C.surface, stroke: C.ink3, 'stroke-width': 1 }) +
          text(m.x, m.y + 4, '?', { 'font-family': MONO, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', fill: C.ink2 }),
      )
    }
  }

  // one glyph per fuse, on the wire its edge runs in
  for (const f of fuses) {
    const w = layout.wires.find((x) => x.edges.includes(f.at) || x.id === f.at)
    const c = w && cables.get(w.id)
    if (!c) continue
    marks.push(fuseGlyph(f, c, tx, (f as FuseState).allowed?.state === 'allowed'))
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(width)} ${f1(height)}" width="${f1(width)}" height="${f1(height)}" font-family="${esc(SANS)}">`,
    ...out,
    `<g>${wiresOut.join('')}</g>`,
    `<g>${plugs.join('')}</g>`,
    `<g>${marks.join('')}</g>`,
    '</svg>',
  ].join('')
  const resolved = theme.resolve ? theme.resolve(svg) : svg
  return theme.flat ? flattenColors(resolved, theme.flat) : resolved
}

function modulePlate(m: Module | undefined, s: ModuleSlot, b: Box, tx: StaticText, path: boolean, geo: StaticGeometry): string {
  if (!m) return ''
  const ghost = m.tags.includes('ghost')
  const parts: string[] = []
  parts.push(
    tag('rect', {
      x: b.x,
      y: b.y,
      width: b.w,
      height: b.h,
      rx: 4,
      fill: C.surface,
      stroke: path ? C.signal : ghost ? C.ink3 : C.modEdge,
      'stroke-width': path ? 1.5 : 1,
      'stroke-dasharray': path ? '4 3' : ghost ? '1.5 2.5' : undefined,
      class: 'pb-mod',
    }),
  )
  if (!ghost)
    for (const [sx, sy] of [
      [b.x + 5, b.y + 5],
      [b.x + b.w - 5, b.y + 5],
      [b.x + 5, b.y + b.h - 5],
      [b.x + b.w - 5, b.y + b.h - 5],
    ])
      parts.push(tag('circle', { cx: sx, cy: sy, r: 2.2, fill: C.screw, stroke: C.plateEdge, 'stroke-width': 0.6 }))
  // jacks (labels left of the out jacks)
  let labelW = 0
  for (const j of m.outJacks) {
    const p = geo.anchors.get(j.key)
    if (!p) continue
    const l = tx.jack(j, m)
    if (l) {
      labelW = Math.max(labelW, textW(l, 9.5, true) + 8)
      parts.push(text(p.x - 11, p.y + 3.4, l, { 'font-family': MONO, 'font-size': 9.5, 'font-weight': 600, 'text-anchor': 'end', fill: C.ink3 }))
    }
  }
  for (const j of [...m.inJacks, ...m.outJacks]) {
    const p = geo.anchors.get(j.key)
    if (p) parts.push(tag('circle', { cx: p.x, cy: p.y, r: 6, fill: C.jack, stroke: C.jackRing, 'stroke-width': 2 }))
  }
  const left = b.x + (m.inJacks.length ? 30 : 14)
  const right = b.x + b.w - (m.outJacks.length ? 30 : 14) - labelW
  const avail = Math.max(40, right - left)
  const top = s.span === 2 ? b.y + 8 : b.y + b.h / 2 - 18
  parts.push(
    text(left, top + 13, fit(tx.kind(m), avail, 10, true), { 'font-family': MONO, 'font-size': 10, 'letter-spacing': 0.6, fill: path ? C.signalInk : C.ink3 }),
  )
  parts.push(
    text(left, top + 31, fit(tx.name(m), avail, 13.5, false), { 'font-family': SANS, 'font-size': 13.5, 'font-weight': 650, fill: ghost ? C.ink2 : C.ink }),
  )
  return `<g>${parts.join('')}</g>`
}

function flagPlate(n: NetLabel | undefined, s: FlagSlot, b: Box, tx: StaticText, path: boolean): string {
  const k = 14
  const m = 0.75
  // a pentagon pointing along the signal: the § 03 flag's tip to the right (away from its writer), the § 01 flag's
  // tip to the right too (into its listener)
  const d = `M${f1(b.x + m)},${f1(b.y + m)} H${f1(b.x + b.w - k)} L${f1(b.x + b.w - m)},${f1(b.y + b.h / 2)} L${f1(b.x + b.w - k)},${f1(b.y + b.h - m)} H${f1(b.x + m)} Z`
  const label = n ? tx.flag(n, s.side) : s.net
  return (
    tag('path', {
      d,
      fill: C.surface,
      stroke: path ? C.signal : C.ink2,
      'stroke-width': path ? 1.5 : 1,
      'stroke-dasharray': path ? '4 3' : undefined,
      class: 'pb-flag',
    }) +
    text(b.x + 10, b.y + b.h / 2 + 3.6, fit(label, b.w - 34, 10.5, true), {
      'font-family': MONO,
      'font-size': 10.5,
      'font-weight': 700,
      'letter-spacing': 0.4,
      fill: C.ink,
    })
  )
}

function fuseGlyph(f: Fuse | FuseState, c: Cable, tx: StaticText, allowed: boolean): string {
  const p = fusePoint(c)
  const tone = allowed ? C.ink2 : C.signal
  const body = [
    tag('rect', { x: -15, y: -6.5, width: 30, height: 13, rx: 2.5, fill: C.surface, stroke: C.ink, 'stroke-width': 1.2 }),
    tag('rect', { x: -18, y: -7.5, width: 5.5, height: 15, rx: 1, fill: C.plateEdge }),
    tag('rect', { x: 12.5, y: -7.5, width: 5.5, height: 15, rx: 1, fill: C.plateEdge }),
    tag('path', { d: 'M-12.5,0 L-5,0 L-2,-3 L2,3 L5,0 L12.5,0', fill: 'none', stroke: tone, 'stroke-width': 1.6 }),
  ].join('')
  const label = tx.fuse(f)
  const lw = textW(label, 10.5, true) + 6
  return tag(
    'g',
    { transform: `translate(${f1(p.x)},${f1(p.y)})`, class: allowed ? 'pb-fuse pb-fuse--allowed' : 'pb-fuse' },
    tag('ellipse', { rx: 25, ry: 15, fill: C.plate, stroke: tone, 'stroke-width': 1.4, 'stroke-dasharray': '3 2.5' }) +
      tag('g', { transform: `rotate(${f1(p.angle)})` }, body) +
      tag('rect', { x: -lw / 2, y: -32, width: lw, height: 14, rx: 2, fill: C.plate }) +
      text(0, -21.5, label, {
        'font-family': MONO,
        'font-size': 10.5,
        'font-weight': 700,
        'letter-spacing': 0.6,
        'text-anchor': 'middle',
        fill: allowed ? C.ink2 : C.signalInk,
      }),
  )
}
