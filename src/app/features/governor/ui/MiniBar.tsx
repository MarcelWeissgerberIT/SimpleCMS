/**
 * The mini bar (Regler § 5.5 / § 10.2): a static CSS bar — the needle tick is what was spent, the dashed segment what this
 * request (or the next step) may add, the red line the limit; amber hatching from 75 % of it. No animation, no Dial
 * (the dial loads lazily; this sits in the features chunk: the brake note and the status cell draw it).
 */
import type { CSSProperties } from 'react'
import { miniBar } from '../gauge'
import './cells.css'

export function MiniBar({ spent, add = 0, limit, size = 'note', label }: { spent: number; add?: number; limit: number | null; size?: 'note' | 'cell'; label?: string }) {
  const g = miniBar(spent, add, limit)
  const style = { '--gv-needle': `${g.needle}%`, '--gv-to': `${g.to}%`, '--gv-red': `${g.red ?? 100}%`, '--gv-amber': `${g.amber ?? 100}%` } as CSSProperties
  return (
    <span
      className="gv-minibar"
      data-size={size}
      data-over={g.over || undefined}
      data-limit={g.red !== null || undefined}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {g.amber !== null && <span className="gv-minibar__amber" />}
      <span className="gv-minibar__fill" />
      {g.to > g.needle && <span className="gv-minibar__add" />}
      <span className="gv-minibar__needle" />
      {g.red !== null && <span className="gv-minibar__red" />}
    </span>
  )
}
