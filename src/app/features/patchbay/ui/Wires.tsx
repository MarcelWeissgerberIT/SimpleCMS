/**
 * The cable layer (plan §3.4): one SVG over the bench, drawn from the layout's wires between the anchors the rack
 * carries (`data-j`: jack sockets, net-flag ends, bus chips). Jack centres are measured relative to the bench after
 * layout — again on a resize of the bench, the grid or a slot (ResizeObserver), when the fonts are ready, on a window
 * resize and when the layout changes — batched into one animation frame (performance mark `pb-relayout`: measure +
 * render + commit, ≤ 16 ms on bigPatchbay(60)).
 *
 * Layers, bottom to top: the selected fuse's leader; each wire's halo right before its cable (the plate's colour:
 * crossings read as over / under) in render.ts `paintOrder` (lit wires and fuse paths on top), the sagging catenary
 * (dashed when the AI decides, dotted when planned), the hatched ticks of content from outside; the plugs; the grey "?"
 * of a cable this device does not know; cable labels on a solid plate backing (B14 feeds them: "3 PROPOSALS"); the fuse
 * glyphs at the middle of their cable, turned along it (glass, caps, the zig-zag wire in signal, a dashed ring, "F1";
 * an allowed fuse in ink; fuses sharing a way out share one glyph, "F2 · F4").
 *
 * The active fuse (store.ts activeFuse: the selected one, else the first open one — the plate's tab, B8) gets the
 * dashed leader down to its plate (`#pb-fuse-plate`, its `[data-pb-plate-tab]` when it has one) only while the glyph
 * and the plate are both in view; otherwise its glyph carries a short "↓ F1" stub (§6 U15). A click on a glyph selects
 * that fuse and brings its plate into view (the only pointer target in the layer). The glyphs' centres are published
 * (usePbGlyphs) so the plate can put its tab under the glyph.
 *
 * Lit (ui/lit.ts): hovered / selected cables thicken in ink (never orange); with a selection or a lit flag the rest
 * dims. Forced colours (patchbay.css): cables CanvasText, fuse paths and glyphs Highlight.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { create } from 'zustand'
import type { Translate } from '@/shared/i18n'
import type { Layout } from '../layout'
import { cableLength, cablePath, fuseGroupLabel, fuseGroups, fusePoint, glyphSpots, labelPoint, paintOrder, pointAt, ticksDash, wireStyle, type Cable, type Pt } from '../render'
import type { Edge, Model } from '../types'
import type { Lit } from './lit'
import { blinkOf, blinkStyle } from '../blink'

interface Drawn {
  id: string
  cable: Cable
  len: number
  plugs: Pt[]
}

/** A fuse as the layer draws it. */
export interface GlyphFuse {
  key: string
  label: string
  /** its exit edge (the glyph sits on the wire carrying it) */
  at: string
  allowed: boolean
  /** its signature (the blink: 3× on a fuse's first appearance per key and signature, blink.ts — B8) */
  sig?: string
}

/** The glyphs' centres relative to the bench (the plate's tab sits under its glyph, B8). */
export const usePbGlyphs = create<Record<string, Pt>>(() => ({}))

const RELAYOUT = 'pb-relayout'
const RELAYOUT_START = 'pb-relayout:start'
/** The glyph's ring: rx 25 · ry 15 (the leader and the stub start under it). */
const RING_Y = 15
const STUB = 9

/** Every anchor's centre relative to the bench. */
function measure(bench: HTMLElement): Map<string, { pt: Pt; plug: boolean }> {
  const b = bench.getBoundingClientRect()
  const out = new Map<string, { pt: Pt; plug: boolean }>()
  for (const el of bench.querySelectorAll<HTMLElement>('[data-j]')) {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height && !el.offsetParent) continue
    out.set(el.dataset.j!, { pt: { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top }, plug: el.classList.contains('pb-jack') })
  }
  return out
}

/** The ancestors that clip the bench (the main region scrolls) — read once per effect. */
function clippers(bench: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let el = bench.parentElement; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if (oy !== 'visible') out.push(el)
  }
  return out
}

/** The part of the window the bench can be seen in (the window cut by every clipping ancestor). */
function viewport(clip: readonly HTMLElement[]): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (const el of clip) {
    const r = el.getBoundingClientRect()
    top = Math.max(top, r.top)
    bottom = Math.min(bottom, r.bottom)
  }
  return { top, bottom }
}

/** Text on a solid plate backing (a cable's label, a glyph's "F1", the stub): the backing is measured after render. */
function Backed({ x, y, text, className, pad = 3 }: { x: number; y: number; text: string; className: string; pad?: number }) {
  const bg = useRef<SVGRectElement>(null)
  const tx = useRef<SVGTextElement>(null)
  useLayoutEffect(() => {
    const t = tx.current
    const r = bg.current
    if (!t || !r) return
    let bb: DOMRect
    try {
      bb = t.getBBox()
    } catch {
      return
    }
    r.setAttribute('x', String(bb.x - pad))
    r.setAttribute('y', String(bb.y - 1))
    r.setAttribute('width', String(bb.width + pad * 2))
    r.setAttribute('height', String(bb.height + 2))
  })
  return (
    <g className={className}>
      <rect ref={bg} className={`${className}-bg`} rx={2} />
      <text ref={tx} x={x} y={y} textAnchor="middle" dominantBaseline="central" className={`${className}-t`}>
        {text}
      </text>
    </g>
  )
}

/** One wire: its halo, the cable, the hatched ticks (memo: a hover re-renders only the wires whose look changed). */
const WireView = memo(function WireView({ id, d, len, cls, outside, dim, path }: { id: string; d: string; len: number; cls: string; outside: boolean; dim: boolean; path: boolean }) {
  return (
    <g data-wire={id} data-path={path || undefined} data-outside={outside || undefined}>
      <path className="pb-w-halo" d={d} />
      <path className={cls} d={d} />
      {outside && <path className={`pb-w-ticks${dim ? ' pb-w--dim' : ''}`} d={d} strokeDasharray={ticksDash(len)} />}
    </g>
  )
})

/**
 * One glyph per way out (render.ts fuseGroups: fuses sharing an exit edge share it, its label names them all). A click
 * selects its fuse — the next of its group when one of them is active already.
 */
function Glyph({ group, c, at: share, active, leader, t, onSelect }: { group: GlyphFuse[]; c: Cable; at: number; active: string | null; leader: boolean; t: Translate; onSelect: (key: string) => void }) {
  const p = fusePoint(c, share)
  const allowed = group.every((f) => f.allowed)
  const label = fuseGroupLabel(group.map((f) => f.label))
  const at = group.findIndex((f) => f.key === active)
  const mine = at >= 0 ? group[at] : group[0]
  const stub = at >= 0
  // the ring blinks with the plate's LED (same id and signature → in step), only for an open fuse
  const open = group.find((f) => !f.allowed)
  const blink = useMemo(() => (open ? blinkOf(open.key, open.sig ?? open.key) : { on: false, delay: 0 }), [open])
  return (
    <g
      className={allowed ? 'pb-fuse pb-fuse--allowed' : 'pb-fuse'}
      data-fuse={mine.key}
      data-fuses={group.map((f) => f.key).join(' ')}
      data-label={label}
      data-active={at >= 0 || undefined}
      transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(at >= 0 && group.length > 1 ? group[(at + 1) % group.length].key : mine.key)
      }}
      data-testid="pb-glyph"
    >
      <title>{group.map((f) => t(f.allowed ? 'features.patchbay.glyph.allowed' : 'features.patchbay.glyph.title', { f: f.label })).join(' · ')}</title>
      {stub && !leader && <path className="pb-fuse-stub" d={`M0,${RING_Y} V${RING_Y + STUB}`} />}
      <ellipse className="pb-fuse-ring" rx={25} ry={RING_Y} data-blink={blink.on || undefined} style={blinkStyle(blink) as CSSProperties | undefined} />
      <g transform={`rotate(${p.angle.toFixed(1)})`}>
        <rect className="pb-fuse-glass" x={-15} y={-6.5} width={30} height={13} rx={2.5} />
        <rect className="pb-fuse-cap" x={-18} y={-7.5} width={5.5} height={15} rx={1} />
        <rect className="pb-fuse-cap" x={12.5} y={-7.5} width={5.5} height={15} rx={1} />
        <path className="pb-fuse-wire" d="M-12.5,0 L-5,0 L-2,-3 L2,3 L5,0 L12.5,0" />
      </g>
      <Backed x={0} y={-24} text={label} className="pb-fuse-lbl" />
      {stub && !leader && <Backed x={0} y={RING_Y + STUB + 8} text={t('features.patchbay.glyph.stub', { f: mine.label })} className="pb-fuse-stubl" />}
    </g>
  )
}

export interface WiresProps {
  bench: RefObject<HTMLElement | null>
  layout: Layout
  model: Model
  lit: Lit | null
  /** every edge on an open fuse's path */
  fuseEdges: Set<string>
  /** the fuses to draw a glyph for (open and allowed), F-order */
  fuses: GlyphFuse[]
  /** the active fuse (the leader / stub is its) */
  active: string | null
  onFuse: (key: string) => void
  /** cable labels by wire id (B14: "3 PROPOSALS") */
  labels?: ReadonlyMap<string, string>
  t: Translate
}

export function Wires({ bench, layout, model, lit, fuseEdges, fuses, active, onFuse, labels, t }: WiresProps) {
  // what was measured, and for which layout: a new layout (the workspace changed under the page) draws nothing until it
  // is measured — in the same layout pass, before the frame is painted — never an old wire against the new layout
  const [drawn, setDrawn] = useState<{ layout: Layout; w: number; h: number; wires: Drawn[] } | null>(null)
  // the active fuse's leader: from under its glyph down to its plate's tab (null: no plate, or one of them out of view)
  const [leader, setLeader] = useState<{ x: number; y1: number; y2: number } | null>(null)
  const edges = useMemo(() => new Map<string, Edge>(model.edges.map((e) => [e.id, e])), [model])
  const activeRef = useRef(active)
  activeRef.current = active

  // the glyphs: one per wire a fuse's exit runs in (bench coordinates, from the drawn cables); each fuse → its glyph
  const { groups, glyphs } = useMemo(() => {
    const groups: Array<{ wire: string; fuses: GlyphFuse[]; c: Cable; t: number }> = []
    const glyphs = new Map<string, Pt>()
    if (!drawn) return { groups, glyphs }
    const byWire = new Map(drawn.wires.map((d) => [d.id, d]))
    for (const g of fuseGroups(fuses, layout.wires)) {
      const d = byWire.get(g.wire)
      if (d) groups.push({ ...g, c: d.cable, t: 0.5 })
    }
    // glyphs of cables running together keep apart (the same rule as the static picture)
    glyphSpots(groups.map((g) => g.c)).forEach((t, i) => (groups[i].t = t))
    for (const g of groups) {
      const p = fusePoint(g.c, g.t)
      for (const f of g.fuses) glyphs.set(f.key, { x: p.x, y: p.y })
    }
    return { groups, glyphs }
  }, [drawn, fuses, layout])

  useLayoutEffect(() => {
    const el = bench.current
    if (!el) return
    let frame = 0
    let alive = true
    const draw = () => {
      frame = 0
      if (!alive || !el.isConnected) return
      try {
        performance.mark(RELAYOUT_START)
      } catch {
        /* no user timing here */
      }
      const at = measure(el)
      const wires: Drawn[] = []
      for (const w of layout.wires) {
        const a = at.get(w.from)
        const z = at.get(w.to)
        if (!a || !z) continue
        const cable = cablePath(a.pt, z.pt)
        wires.push({ id: w.id, cable, len: cableLength(cable), plugs: [a, z].filter((x) => x.plug).map((x) => x.pt) })
      }
      // committed in this frame (before it is painted): the cables never trail the modules by a frame, and the perf mark
      // measures exactly measure + render + commit
      const next = { layout, w: el.offsetWidth, h: el.offsetHeight, wires }
      if (first) setDrawn(next)
      else flushSync(() => setDrawn(next))
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    // the first draw runs inside this layout effect (a plain state update); later ones in their own frame
    let first = true
    draw()
    first = false
    const ro = new ResizeObserver(soon)
    ro.observe(el)
    // a module that grows (a window appears, a name wraps at a large text size) moves its jacks; the page growing below
    // the bench (the fuse plate mounting) moves the leader's end
    for (const g of el.querySelectorAll('.pb-grid, .pb-mod, .pb-flag, .pb-fold, .pb-bus')) ro.observe(g)
    if (el.parentElement) ro.observe(el.parentElement)
    void document.fonts?.ready.then(soon)
    window.addEventListener('resize', soon)
    return () => {
      alive = false
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', soon)
    }
  }, [bench, layout])

  // measure + render + commit of one relayout (the perf budget, §4 B7)
  useLayoutEffect(() => {
    if (!drawn) return
    try {
      if (performance.getEntriesByName(RELAYOUT_START, 'mark').length) {
        performance.measure(RELAYOUT, RELAYOUT_START)
        performance.clearMarks(RELAYOUT_START)
        if (performance.getEntriesByName(RELAYOUT, 'measure').length > 200) performance.clearMeasures(RELAYOUT)
      }
    } catch {
      /* no user timing here */
    }
  }, [drawn])

  // publish the glyphs' centres (only when they moved)
  useLayoutEffect(() => {
    const next: Record<string, Pt> = {}
    for (const [k, p] of glyphs) next[k] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }
    const cur = usePbGlyphs.getState()
    const same = Object.keys(cur).length === Object.keys(next).length && Object.entries(next).every(([k, p]) => cur[k]?.x === p.x && cur[k]?.y === p.y)
    if (!same) usePbGlyphs.setState(next, true)
  }, [glyphs])
  useLayoutEffect(() => () => usePbGlyphs.setState({}, true), [])

  // the leader: only for the active fuse, only while its glyph and its plate are both in view — checked after every
  // relayout and on scroll (one frame)
  useLayoutEffect(() => {
    const el = bench.current
    if (!el) return
    let frame = 0
    const clip = clippers(el)
    const check = () => {
      frame = 0
      const key = activeRef.current
      const p = key ? glyphs.get(key) : undefined
      const plate = document.getElementById('pb-fuse-plate')
      let next: { x: number; y1: number; y2: number } | null = null
      if (p && plate && el.isConnected) {
        const b = el.getBoundingClientRect()
        const tab = plate.querySelector<HTMLElement>('[data-pb-plate-tab]') ?? plate
        const pr = tab.getBoundingClientRect()
        const vp = viewport(clip)
        const gy = b.top + p.y
        const glyphIn = gy - RING_Y >= vp.top && gy + RING_Y <= vp.bottom
        const plateIn = pr.bottom > vp.top && pr.top < vp.bottom && pr.height > 0
        const below = pr.top - b.top > p.y + RING_Y
        if (glyphIn && plateIn && below) next = { x: p.x, y1: p.y + RING_Y, y2: pr.top - b.top }
      }
      setLeader((cur) => (cur === next || (cur && next && cur.x === next.x && cur.y1 === next.y1 && cur.y2 === next.y2) ? cur : next))
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', soon, { capture: true, passive: true })
    window.addEventListener('resize', soon)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', soon, { capture: true })
      window.removeEventListener('resize', soon)
    }
  }, [bench, glyphs, active])

  const byId = useMemo(() => new Map(layout.wires.map((w) => [w.id, w])), [layout])
  if (!drawn || drawn.layout !== layout) return null
  const litEdges = lit?.edges ?? new Set<string>()
  const dimming = !!lit && lit.mode !== 'hover'
  const order = paintOrder(
    drawn.wires.map((d) => byId.get(d.id)!),
    edges,
    { lit: litEdges, fuse: fuseEdges },
  )
  const draws = new Map(drawn.wires.map((d) => [d.id, d]))
  const unknown: Array<{ id: string; p: Pt }> = []
  const labelled: Array<{ id: string; p: Pt; text: string }> = []
  return (
    <svg className="pb-wires" width={drawn.w} height={drawn.h} viewBox={`0 0 ${drawn.w} ${drawn.h}`} aria-hidden="true" data-testid="pb-wires" data-leader={leader ? 'on' : 'off'}>
      {leader && <path className="pb-leader" d={`M${leader.x.toFixed(1)},${leader.y1.toFixed(1)} V${leader.y2.toFixed(1)}`} data-testid="pb-leader" />}
      {order.map((id) => {
        const d = draws.get(id)
        const w = byId.get(id)
        if (!d || !w) return null
        const s = wireStyle(w, edges)
        const isLit = w.edges.some((e) => litEdges.has(e))
        const onPath = w.edges.some((e) => fuseEdges.has(e))
        const dim = dimming && !isLit
        if (s.unknown) unknown.push({ id, p: pointAt(d.cable, 0.5) })
        const text = labels?.get(id)
        if (text) labelled.push({ id, p: labelPoint(d.cable), text })
        const cls = ['pb-w', s.can && 'pb-w--can', s.planned && 'pb-w--planned', s.unknown && 'pb-w--unknown', isLit && 'pb-w--lit', dim && 'pb-w--dim'].filter(Boolean).join(' ')
        return <WireView key={id} id={id} d={d.cable.d} len={d.len} cls={cls} outside={s.outside} dim={dim} path={onPath} />
      })}
      <g className="pb-plugs">
        {drawn.wires.flatMap((d) =>
          d.plugs.map((p, i) => (
            <g key={`${d.id}:${i}`}>
              <circle className="pb-plug" cx={p.x} cy={p.y} r={5.6} />
              <circle className="pb-plug-ring" cx={p.x} cy={p.y} r={2.4} />
            </g>
          )),
        )}
      </g>
      {unknown.map(({ id, p }) => (
        <g key={`q:${id}`} className="pb-wq" transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}>
          <title>{t('features.patchbay.wire.unknown')}</title>
          <rect x={-8} y={-8} width={16} height={16} rx={2} />
          <text y={0.5} textAnchor="middle" dominantBaseline="central">
            ?
          </text>
        </g>
      ))}
      {labelled.map(({ id, p, text }) => (
        <Backed key={`l:${id}`} x={p.x} y={p.y} text={text} className="pb-wlabel" pad={4} />
      ))}
      {groups.map((g) => (
        <Glyph key={g.wire} group={g.fuses} c={g.c} at={g.t} active={active} leader={!!leader && g.fuses.some((f) => f.key === active)} t={t} onSelect={onFuse} />
      ))}
    </svg>
  )
}
