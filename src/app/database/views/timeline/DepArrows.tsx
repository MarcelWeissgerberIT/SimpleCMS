/**
 * Timeline dependency arrows (SVG, in lane coordinates): blocker end → dependent start, hairline
 * ink, signal orange when the dependent starts before its blocker ends. Arrows are focusable:
 * click / focus selects, Delete removes, Esc deselects. A draft line follows a connector drag.
 */
import { memo } from 'react'
import { useT } from '../../../i18n'
import type { ID } from '../../../store/types'

export interface BarGeom {
  /** row index in the view */
  i: number
  /** first and last day index (inclusive) */
  s: number
  e: number
  title: string
}

export interface DepEdge {
  from: ID
  to: ID
  violated: boolean
}

const GAP = 8
const HEAD = 6

/** Elbow path from the blocker's right edge to the dependent's left edge. */
export function edgePath(a: BarGeom, b: BarGeom, dw: number, rowH: number, barMid: number): { d: string; head: string } {
  const x1 = (a.e + 1) * dw - 1
  const y1 = a.i * rowH + barMid
  const x2 = b.s * dw + 1
  const y2 = b.i * rowH + barMid
  let d: string
  if (x2 - x1 >= GAP * 2) {
    const xm = x1 + GAP
    d = `M${x1} ${y1}H${xm}V${y2}H${x2 - 1}`
  } else {
    // backwards (or too tight): drop into the gap next to the dependent's row, then come in from the left
    const yGap = b.i > a.i ? b.i * rowH + 3 : (b.i + 1) * rowH - 3
    d = `M${x1} ${y1}H${x1 + GAP}V${yGap}H${x2 - GAP * 1.5}V${y2}H${x2 - 1}`
  }
  const head = `M${x2 - HEAD} ${y2 - 3.5}L${x2} ${y2}L${x2 - HEAD} ${y2 + 3.5}Z`
  return { d, head }
}

export const DepArrows = memo(function DepArrows({
  edges,
  geom,
  dw,
  rowH,
  barMid,
  width,
  height,
  left,
  selected,
  onSelect,
  onRemove,
  draft,
}: {
  edges: DepEdge[]
  geom: Map<ID, BarGeom>
  dw: number
  rowH: number
  barMid: number
  width: number
  height: number
  left: number
  selected: string | null
  onSelect: (key: string | null) => void
  onRemove: (edge: DepEdge) => void
  draft: { from: ID; x: number; y: number } | null
}) {
  const t = useT()
  const src = draft ? geom.get(draft.from) : undefined
  return (
    <svg className="dbtl-deps" style={{ left, width, height }} width={width} height={height} role="group" aria-label={t('database.dep.title')}>
      {edges.map((edge) => {
        const a = geom.get(edge.from)
        const b = geom.get(edge.to)
        if (!a || !b) return null
        const key = `${edge.from}>${edge.to}`
        const { d, head } = edgePath(a, b, dw, rowH, barMid)
        const label = t(edge.violated ? 'database.dep.arrowViolated' : 'database.dep.arrow', { from: a.title, to: b.title })
        return (
          <g key={key} className="dbtl-dep" data-violated={edge.violated} data-selected={selected === key} data-from={edge.from} data-to={edge.to}>
            <path className="dbtl-dep__line" d={d} />
            <path className="dbtl-dep__head" d={head} />
            <path
              className="dbtl-dep__hit"
              d={d}
              tabIndex={0}
              role="button"
              aria-label={label}
              aria-pressed={selected === key}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                ;(e.currentTarget as SVGPathElement).focus()
                onSelect(key)
              }}
              onFocus={() => onSelect(key)}
              onBlur={() => onSelect(null)}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault()
                  e.stopPropagation()
                  onRemove(edge)
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  ;(e.currentTarget as SVGPathElement).blur()
                }
              }}
            >
              <title>{label}</title>
            </path>
          </g>
        )
      })}
      {draft && src && <path className="dbtl-depdraft" d={`M${(src.e + 1) * dw - 1} ${src.i * rowH + barMid}L${draft.x} ${draft.y}`} />}
    </svg>
  )
})
