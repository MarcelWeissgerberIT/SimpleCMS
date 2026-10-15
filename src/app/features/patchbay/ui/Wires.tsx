/**
 * The cable layer (plan §3.4): one SVG over the bench, drawn from the layout's wires between the anchors the rack
 * carries (`data-j`: jack sockets, net-flag ends, bus chips). Jack centres are measured relative to the bench after
 * layout — again on a resize of the bench or the grid (ResizeObserver), when the fonts are ready, and when the layout
 * changes — batched into one animation frame. Each wire: its halo (the plate's colour: crossings read as over / under),
 * the cable (the sagging catenary of render.ts `cablePath`; dashed when the AI decides, dotted when planned), the
 * hatched ticks of content from outside, and plugs on the jack ends. The order comes from render.ts `paintOrder` — lit
 * wires and fuse paths on top.
 *
 * Lit (ui/lit.ts): hovered / selected cables thicken in ink (never orange); with a selection or a lit flag the rest
 * dims. B7 adds the fuse glyph and its leader, cable labels, forced-colours rules and the perf marks.
 */
import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { Layout } from '../layout'
import { cableLength, cablePath, paintOrder, ticksDash, wireStyle, type Cable, type Pt } from '../render'
import type { Edge, Model } from '../types'
import type { Lit } from './lit'

interface Drawn {
  id: string
  cable: Cable
  len: number
  plugs: Pt[]
}

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

export function Wires({ bench, layout, model, lit, fuseEdges }: { bench: RefObject<HTMLElement | null>; layout: Layout; model: Model; lit: Lit | null; fuseEdges: Set<string> }) {
  // what was measured, and for which layout: a new layout (the workspace changed under the page) draws nothing until it
  // is measured — in the same layout pass, before the frame is painted — never an old wire against the new layout
  const [drawn, setDrawn] = useState<{ layout: Layout; w: number; h: number; wires: Drawn[] } | null>(null)
  const edges = useMemo(() => new Map<string, Edge>(model.edges.map((e) => [e.id, e])), [model])

  useLayoutEffect(() => {
    const el = bench.current
    if (!el) return
    let frame = 0
    let alive = true
    const draw = () => {
      frame = 0
      if (!alive || !el.isConnected) return
      const at = measure(el)
      const wires: Drawn[] = []
      for (const w of layout.wires) {
        const a = at.get(w.from)
        const z = at.get(w.to)
        if (!a || !z) continue
        const cable = cablePath(a.pt, z.pt)
        wires.push({ id: w.id, cable, len: cableLength(cable), plugs: [a, z].filter((x) => x.plug).map((x) => x.pt) })
      }
      setDrawn({ layout, w: el.offsetWidth, h: el.offsetHeight, wires })
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    draw()
    const ro = new ResizeObserver(soon)
    ro.observe(el)
    // a module that grows (a window appears, a name wraps at a large text size) moves its jacks
    for (const g of el.querySelectorAll('.pb-grid, .pb-mod, .pb-flag, .pb-fold, .pb-bus')) ro.observe(g)
    void document.fonts?.ready.then(soon)
    window.addEventListener('resize', soon)
    return () => {
      alive = false
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', soon)
    }
  }, [bench, layout])

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
  return (
    <svg className="pb-wires" width={drawn.w} height={drawn.h} viewBox={`0 0 ${drawn.w} ${drawn.h}`} aria-hidden="true" data-testid="pb-wires">
      {order.map((id) => {
        const d = draws.get(id)
        const w = byId.get(id)
        if (!d || !w) return null
        const s = wireStyle(w, edges)
        const isLit = w.edges.some((e) => litEdges.has(e))
        const onPath = w.edges.some((e) => fuseEdges.has(e))
        const cls = ['pb-w', s.can && 'pb-w--can', s.planned && 'pb-w--planned', s.unknown && 'pb-w--unknown', isLit && 'pb-w--lit', dimming && !isLit && 'pb-w--dim'].filter(Boolean).join(' ')
        return (
          <g key={id} data-wire={id} data-path={onPath || undefined} data-outside={s.outside || undefined}>
            <path className="pb-w-halo" d={d.cable.d} />
            <path className={cls} d={d.cable.d} />
            {s.outside && <path className={`pb-w-ticks${dimming && !isLit ? ' pb-w--dim' : ''}`} d={d.cable.d} strokeDasharray={ticksDash(d.len)} />}
          </g>
        )
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
    </svg>
  )
}
