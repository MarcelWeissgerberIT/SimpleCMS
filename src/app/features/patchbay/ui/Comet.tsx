/**
 * The run's dot (plan §3.10, §1.7) — one rAF loop for the whole rack, inside the cable layer (Wires.tsx), on top of the
 * cables. The legs come from the live signal (live/live.ts useLive `legs`: `{ edgeId, at, run }`, ≤ 12 waiting, in order
 * per run): each leg moves its run's dot 600 ms along the cable that carries the edge (render.ts pointAt on the drawn
 * cubic — the same curve the cable is), knocked out of the plate by a halo, then the next leg of that run takes it on, or
 * it fades (160 ms) where it arrived. ≤ 1 dot per run (a chain's legs follow each other); a leg whose cable is not drawn
 * (folded, filtered) is skipped in its slot. No frame, no shimmer, no wash.
 *
 * With `prefers-reduced-motion: reduce` there is no dot at all (the run's cables carry the static ink emphasis instead,
 * Wires.tsx `data-hot`). The loop runs only while a leg waits, plays or fades; positions are written straight to the SVG
 * (no React render per frame). Each dot carries `data-edge` / `data-t` for the specs.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { LEG_MS, type LiveLeg } from '../live/core'
import { useLive } from '../live/live'
import { pointAt, type Cable } from '../render'
import { useReducedMotion } from './motion'
import { dotAt, FADE_MS } from './liveWin'

/** The cable a leg runs along (its edge's drawn wire), or null. */
export type CableOf = (edgeId: string) => Cable | null

export function Comets({ cableOf }: { cableOf: CableOf }) {
  const reduced = useReducedMotion()
  const legs = useLive((s) => s.legs)
  // the legs of each run (a leg the core already let go of stays here until its dot faded)
  const kept = useRef(new Map<string, LiveLeg[]>())
  const byRun = useMemo(() => {
    const now = Date.now()
    const next = new Map<string, LiveLeg[]>()
    for (const l of legs) {
      const list = next.get(l.run)
      if (list) list.push(l)
      else next.set(l.run, [l])
    }
    // a run whose last leg just left the queue keeps it until its fade is over
    for (const [run, list] of kept.current) {
      if (next.has(run)) continue
      const last = list[list.length - 1]
      if (last && now < last.at + LEG_MS + FADE_MS) next.set(run, [last])
    }
    kept.current = next
    return next
  }, [legs])
  const runs = useMemo(() => [...byRun.keys()], [byRun])
  const g = useRef<SVGGElement>(null)

  // a layout effect that draws at once: a new run's dot is placed before the frame that shows it is painted
  useLayoutEffect(() => {
    if (reduced || !runs.length) return
    let frame = 0
    const tick = () => {
      frame = 0
      const root = g.current
      if (!root) return
      const now = Date.now()
      let busy = false
      for (const el of root.querySelectorAll<SVGGElement>('[data-run]')) {
        const list = byRun.get(el.dataset.run!) ?? []
        if (list.some((l) => now < l.at + LEG_MS + FADE_MS)) busy = true
        const dot = dotAt(list, now, (e) => !!cableOf(e))
        const c = dot ? cableOf(dot.edge) : null
        if (!dot || !c) {
          if (el.style.opacity !== '0') el.style.opacity = '0'
          el.dataset.edge = ''
          continue
        }
        const p = pointAt(c, dot.t)
        el.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`)
        el.style.opacity = String(Math.max(0, Math.min(1, dot.opacity)))
        el.dataset.edge = dot.edge
        el.dataset.t = dot.t.toFixed(2)
      }
      if (busy) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [reduced, runs, byRun, cableOf])

  if (reduced) return null
  return (
    <g ref={g} className="pb-comets" aria-hidden="true">
      {runs.map((run) => (
        <g key={run} data-run={run} data-edge="" style={{ opacity: 0 }} data-testid="pb-comet">
          <circle className="pb-comet-knock" r={6.6} />
          <circle className="pb-comet" r={4.4} />
        </g>
      ))}
    </g>
  )
}
