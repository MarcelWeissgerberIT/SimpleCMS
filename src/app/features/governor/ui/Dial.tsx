/**
 * The consumption dial (Regler § 10.1, an SVG port of the mock's gauge.js): a tachometer that fills toward the red line —
 * the needle shows what is spent today, the amber arc starts at 75 % of the day budget, the red arc and line at the
 * budget; a dashed needle is yesterday's peak; on the halt card (`mini`) the next step runs as a dashed signal segment from
 * the needle to its end. Without a budget there is no red line. Text sizes come from the CSS; the needle moves with a
 * short mechanical ease (none with reduced motion). role="img" with a sentence for screen readers.
 */
import { memo } from 'react'
import { AMBER, C, angleOf, arcPath, dialNumerals, dialScale, dialTicks, pointAt } from '../gauge'
import './governor.css'

export interface DialProps {
  /** spent today (USD) */
  value: number
  /** the day budget (null: none — no red line) */
  budget: number | null
  /** where the next step would end (the halt card) */
  next?: number | null
  /** yesterday's total (the dashed tell-tale) */
  peak?: number | null
  /** the readout ("4,12 $") and the line under it ("von 6,00 $ · Rest 1,88 $") */
  big: string
  of: string
  /** the engraving above the readout (null: none — the mini dial) */
  unit?: string | null
  /** the lamp under the readout and its engraving; lit at the line */
  lampLabel: string
  lamp?: boolean
  /** the small dial of the halt card: fewer ticks and numerals, a bigger readout */
  mini?: boolean
  /** the whole reading as one sentence */
  label: string
  /** the readout is a lower bound (the day not read in full yet): a small "≈" before it */
  approx?: boolean
  /** a numeral in the UI's language ("0,5") */
  numeral?: (v: number) => string
}

const R = 127
const W = 8
const plain = (v: number) => String(v)

export const Dial = memo(function Dial({ value, budget, next, peak, big, of, unit, lampLabel, lamp, mini, label, approx, numeral = plain }: DialProps) {
  const lim = budget !== null && budget > 0 ? budget : null
  const s = dialScale(lim, value, next ?? (mini ? null : peak))
  const a = (v: number) => angleOf(v, s.max)
  const amberAt = lim ? lim * AMBER : Infinity
  const v1 = Math.min(value, amberAt)
  const by = mini ? 206 : 222
  const needle = a(value)
  const tail = mini ? 18 : 26
  const lampY = by + (mini ? 46 : 40)
  const lampX = C - lampLabel.length * (mini ? 6.4 : 4.4) - 6
  return (
    <svg className="gv-dial" data-mini={mini || undefined} viewBox="0 0 300 300" role="img" aria-label={label}>
      <circle className="gv-g-bezel" cx={C} cy={C} r={143} strokeWidth={9} />
      <circle className="gv-g-edge" cx={C} cy={C} r={147.5} strokeWidth={1} />
      <circle className="gv-g-face" cx={C} cy={C} r={138.5} />
      <circle className="gv-g-edge" cx={C} cy={C} r={138.5} strokeWidth={1} />
      <path className="gv-g-track" d={arcPath(R, a(0), a(s.max))} strokeWidth={W} />
      {lim && <path className="gv-g-amber" d={arcPath(134, a(amberAt), a(lim))} strokeWidth={4} />}
      {lim && <path className="gv-g-red" d={arcPath(134, a(lim), a(s.max))} strokeWidth={4} />}
      <path className="gv-g-fill" d={arcPath(R, a(0), a(v1))} strokeWidth={W} />
      {lim && value > amberAt && <path className="gv-g-amber" d={arcPath(R, a(amberAt), a(Math.min(value, lim)))} strokeWidth={W} />}
      {lim && value > lim && <path className="gv-g-red" d={arcPath(R, a(lim), a(value))} strokeWidth={W} />}
      {dialTicks(s, mini).map((tk) => {
        const [r0, r1] = tk.kind === 'major' ? [104, 121] : tk.kind === 'half' ? [110, 121] : [114, 121]
        const [x0, y0] = pointAt(r0, tk.a)
        const [x1, y1] = pointAt(r1, tk.a)
        return <line key={tk.v} className={tk.kind === 'major' ? 'gv-g-tick' : 'gv-g-tick gv-g-tick--minor'} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={tk.kind === 'major' ? 2 : 1} />
      })}
      {next != null && next > value && (
        <>
          <path className="gv-g-next" d={arcPath(R, a(value), a(next))} strokeWidth={W + 2} />
          <line className="gv-g-next-cap" {...ends(117, 141, a(next))} strokeWidth={3.5} />
        </>
      )}
      {lim && <line className="gv-g-tick gv-g-tick--red" {...ends(98, 132, a(lim))} strokeWidth={3} />}
      {dialNumerals(s, mini).map((v) => {
        const red = lim !== null && Math.abs(v - lim) < 1e-9
        // on the mini dial the budget's numeral sits a little before its line, so the needle never covers it
        const [x, y] = pointAt(mini ? (red ? 78 : 82) : 88, a(v) + (mini && red ? 8 : 0))
        return (
          <text key={v} className={red ? 'gv-g-num gv-g-num--red' : 'gv-g-num'} x={x} y={y}>
            {numeral(v)}
          </text>
        )
      })}
      {unit && (
        <text className="gv-g-unit" x={C} y={by - 30}>
          {unit}
        </text>
      )}
      <text className="gv-g-big" x={C} y={by}>
        {approx && <tspan className="gv-g-approx">≈ </tspan>}
        {big}
      </text>
      <text className="gv-g-of" x={C} y={by + (mini ? 22 : 18)}>
        {of}
      </text>
      {lamp && <circle className="gv-g-halo" cx={lampX} cy={lampY - 4} r={mini ? 10 : 7.5} strokeWidth={3} />}
      <circle className={lamp ? 'gv-g-lamp gv-g-lamp--on' : 'gv-g-lamp'} cx={lampX} cy={lampY - 4} r={mini ? 5.5 : 4} />
      <text className={lamp ? 'gv-g-lamp-lbl gv-g-lamp-lbl--on' : 'gv-g-lamp-lbl'} x={C + 8} y={lampY}>
        {lampLabel}
      </text>
      {peak != null && peak > 0 && (
        <g className="gv-g-hand" style={{ transform: `rotate(${a(peak)}deg)` }}>
          <line className="gv-g-tell" x1={C} y1={C - 34} x2={C} y2={C - 112} />
          <path className="gv-g-tell-tip" d={`M${C} ${C - 133}L${C + 4.5} ${C - 121}L${C - 4.5} ${C - 121}Z`} />
        </g>
      )}
      <g className="gv-g-hand gv-g-needle-arm" style={{ transform: `rotate(${needle}deg)` }}>
        <path className="gv-g-needle" d={`M${C} ${C - (mini ? 112 : 119)}L${C + 3.4} ${C + 4}L${C + 5} ${C + tail}L${C - 5} ${C + tail}L${C - 3.4} ${C + 4}Z`} />
      </g>
      <circle className="gv-g-hub" cx={C} cy={C} r={12.5} />
      <circle className="gv-g-hub-in" cx={C} cy={C} r={5.5} />
      <line className="gv-g-hub-slot" x1={C - 4} y1={C + 1.6} x2={C + 4} y2={C - 1.6} />
    </svg>
  )
})

/** A radial line from r0 to r1 at angle a. */
function ends(r0: number, r1: number, a: number) {
  const [x1, y1] = pointAt(r0, a)
  const [x2, y2] = pointAt(r1, a)
  return { x1, y1, x2, y2 }
}
