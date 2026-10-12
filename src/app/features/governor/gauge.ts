/**
 * The Regler's drawn instruments — geometry only (pure: Node specs load it; the components in ui/ draw it):
 *  - the dial (Dial.tsx, a port of the mock's gauge.js): a tachometer that fills toward the red line — the scale, its
 *    ticks and numerals, the angle of a value, arcs;
 *  - the mini bar (MiniBar.tsx, BrakeNote / StatusCell): needle = spent, dashed segment = this request or step, red line;
 *  - the month bar (MonthBar.tsx): closed days, today, the forecast marker, the red line and providers' soft limits.
 * Positions are percentages / SVG units; nothing here knows a colour or a language.
 */

/** degrees on each side of 12 o'clock */
export const SWEEP = 125
/** the dial's centre in its 300 × 300 view box */
export const C = 150
/** amber from this share of the budget */
export const AMBER = 0.75

/** numeral steps: 1 · 2 · 5 per decade (no quarters — they crowd the dial) */
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000]

const finite = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
const r2 = (n: number) => Math.round(n * 100) / 100

export interface DialScale {
  /** the scale's end */
  max: number
  /** between two numerals */
  step: number
}

/**
 * The dial's scale: about 1,25 × the budget (6 $ → 0 … 7,5), never below what it must show (the value, the next step's
 * end); without a budget it follows the value. At most nine numerals; the end on a half step.
 */
export function dialScale(budget: number | null, value: number, next?: number | null): DialScale {
  const need = Math.max(budget && budget > 0 ? budget * 1.25 : 0, finite(value) * (budget ? 1.05 : 1.25), finite(next) * 1.05, budget ? 0 : 1)
  const step = STEPS.find((s) => need / s <= 9) ?? STEPS[STEPS.length - 1]
  const half = step / 2
  return { max: Math.max(step, Math.ceil(need / half - 1e-9) * half), step }
}

/** The angle of a value (degrees from 12 o'clock, −SWEEP … +SWEEP). */
export const angleOf = (v: number, max: number): number => -SWEEP + (2 * SWEEP * Math.min(Math.max(0, finite(v)), max)) / max

/** A point at radius r and angle a. */
export const pointAt = (r: number, a: number): [number, number] => [r2(C + r * Math.sin((a * Math.PI) / 180)), r2(C - r * Math.cos((a * Math.PI) / 180))]

/** An arc's SVG path, clockwise from a0 to a1 (empty when it has no length). */
export function arcPath(r: number, a0: number, a1: number): string {
  if (!(a1 > a0)) return ''
  const [x0, y0] = pointAt(r, a0)
  const [x1, y1] = pointAt(r, a1)
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

export interface DialTick {
  v: number
  a: number
  kind: 'major' | 'half' | 'minor'
}

/** Ticks: a major one at every step, a half one between, quarter ones between those (the mini dial: majors and halves). */
export function dialTicks(s: DialScale, mini = false): DialTick[] {
  const per = mini ? 2 : 4
  const unit = s.step / per
  const n = Math.round(s.max / unit)
  const out: DialTick[] = []
  for (let i = 0; i <= n; i++) {
    // the angle from the exact value: rounded to cents, a quarter of a 0,1 step (0,025) would sit off its place
    out.push({ v: r2(i * unit), a: angleOf(i * unit, s.max), kind: i % per === 0 ? 'major' : i % 2 === 0 || mini ? 'half' : 'minor' })
  }
  return out
}

/** Numerals at the majors (the mini dial leaves out 0, the first and the last — the readout sits there). */
export function dialNumerals(s: DialScale, mini = false): number[] {
  const out: number[] = []
  for (let v = 0; v <= s.max + 1e-9; v = r2(v + s.step)) {
    const last = v + s.step > s.max + 1e-9
    if (mini && (v === 0 || v === s.step || last)) continue
    out.push(v)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* the mini bar                                                         */
/* ------------------------------------------------------------------ */

export interface MiniBarGeom {
  /** the needle (spent) */
  needle: number
  /** this request's segment: from the needle to its upper end */
  to: number
  /** the red line (null: no limit) */
  red: number | null
  /** amber from (null: no limit) */
  amber: number | null
  /** the segment crosses the red line */
  over: boolean
}

/** The mini bar in percent of its width: room past the red line for a request that crosses it. */
export function miniBar(spent: number, add: number, limit: number | null): MiniBarGeom {
  const s = Math.max(0, finite(spent))
  const end = s + Math.max(0, finite(add))
  const lim = limit !== null && limit > 0 ? limit : null
  const max = Math.max(lim ? lim * 1.2 : 0, end * 1.06, s * 1.25, 0.01)
  const pct = (v: number) => r2(Math.min(100, (v / max) * 100))
  return { needle: pct(s), to: pct(end), red: lim ? pct(lim) : null, amber: lim ? pct(lim * AMBER) : null, over: lim !== null && end > lim }
}

/* ------------------------------------------------------------------ */
/* the month bar                                                        */
/* ------------------------------------------------------------------ */

export interface MonthGeom {
  /** closed days' spend */
  closed: number
  /** today's segment ends here */
  today: number
  /** the forecast marker (clamped to the bar; `over` says it runs past the limit) */
  forecast: number
  /** the red line (null: no month limit) */
  red: number | null
  amber: number | null
  /** soft limits per provider as ticks (`i`: the input's index) */
  soft: Array<{ at: number; i: number }>
  /** the forecast for the whole month (USD) and the average per day so far */
  projection: number
  average: number
  over: boolean
}

export interface MonthInput {
  /** spend of the month so far (today included) */
  spent: number
  /** today's part of it */
  today: number
  /** the month limit (null: none) */
  limit: number | null
  /** day of the month (1 …) and the month's days */
  day: number
  days: number
  /** providers' soft monthly limits (S2 Workspace.ai.limits), drawn as ticks */
  soft?: readonly number[]
}

/** The month bar: Ø per day so far × the month's days is the forecast; the scale is the limit, else the forecast. */
export function monthBar(m: MonthInput): MonthGeom {
  const spent = Math.max(0, finite(m.spent))
  const today = Math.min(spent, Math.max(0, finite(m.today)))
  const day = Math.max(1, Math.floor(finite(m.day)))
  const days = Math.max(day, Math.floor(finite(m.days)) || 30)
  const average = spent / day
  const projection = average * days
  const lim = m.limit !== null && m.limit > 0 ? m.limit : null
  const max = lim ?? Math.max(projection * 1.1, spent * 1.25, 0.01)
  const pct = (v: number) => r2(Math.min(100, Math.max(0, (v / max) * 100)))
  return {
    closed: pct(spent - today),
    today: pct(spent),
    forecast: pct(projection),
    red: lim ? 100 : null,
    amber: lim ? pct(lim * AMBER) : null,
    soft: (m.soft ?? []).flatMap((x, i) => (x > 0 && x < max ? [{ at: pct(x), i }] : [])),
    projection,
    average,
    over: lim !== null && projection > lim,
  }
}
