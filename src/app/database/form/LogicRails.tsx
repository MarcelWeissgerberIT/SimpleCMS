/**
 * Logic connectors in the builder's left gutter: a hairline from each question a condition looks
 * at down to the question it shows or hides — like the wiring on a schematic. Edges of the card
 * being pointed at / edited light up in the signal colour.
 */
import { useLayoutEffect, useState } from 'react'

export interface Edge {
  from: string
  to: string
}

interface Placed extends Edge {
  y1: number
  y2: number
  lane: number
}

const LANES = 4
const GUTTER = 22
const HEAD = 17

/** `layout`: changes whenever the cards move (order, page breaks), so the rails are measured again. */
export function LogicRails({ list, edges, active, hidden, layout }: { list: HTMLElement | null; edges: Edge[]; active: string | null; hidden?: boolean; layout: string }) {
  const [placed, setPlaced] = useState<Placed[]>([])
  const [height, setHeight] = useState(0)
  const key = edges.map((e) => `${e.from}>${e.to}`).join(',')

  useLayoutEffect(() => {
    if (!list || !edges.length) {
      setPlaced([])
      return
    }
    const measure = () => {
      const top = list.getBoundingClientRect().top
      const yOf = (k: string) => {
        const el = list.querySelector<HTMLElement>(`[data-fb-key="${CSS.escape(k)}"]`)
        return el ? el.getBoundingClientRect().top - top + HEAD : null
      }
      const spans = edges
        .map((e) => ({ ...e, y1: yOf(e.from), y2: yOf(e.to) }))
        .filter((e): e is Edge & { y1: number; y2: number } => e.y1 !== null && e.y2 !== null)
        .sort((a, b) => a.y2 - a.y1 - (b.y2 - b.y1))
      // short spans take the inner lanes; overlapping spans never share one
      const used: Array<Array<[number, number]>> = Array.from({ length: LANES }, () => [])
      const out: Placed[] = spans.map((s) => {
        const lo = Math.min(s.y1, s.y2)
        const hi = Math.max(s.y1, s.y2)
        let lane = used.findIndex((l) => l.every(([a, b]) => hi < a - 2 || lo > b + 2))
        if (lane < 0) lane = LANES - 1
        used[lane].push([lo, hi])
        return { ...s, lane }
      })
      setPlaced(out)
      setHeight(list.scrollHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, layout, list])

  if (!placed.length || hidden) return null
  return (
    <svg className="fb-rails" width={GUTTER} height={height} aria-hidden>
      {placed.map((e) => {
        const x = GUTTER - 7 - e.lane * 4
        const on = !!active && (e.from === active || e.to === active)
        return (
          <g key={`${e.from}>${e.to}`} className="fb-rail" data-on={on || undefined}>
            <path d={`M ${GUTTER} ${e.y1} H ${x} V ${e.y2} H ${GUTTER - 1}`} fill="none" />
            <circle cx={GUTTER - 1.5} cy={e.y1} r={1.75} />
            <path className="fb-rail__tip" d={`M ${GUTTER - 4} ${e.y2 - 3} L ${GUTTER - 0.5} ${e.y2} L ${GUTTER - 4} ${e.y2 + 3}`} fill="none" />
          </g>
        )
      })}
    </svg>
  )
}
