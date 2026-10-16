/**
 * What one lane draws (pure): bursts of Vorgänge as ranges with ticks (the person's typing gets a bar), single
 * writes as points, run flags (runs close together on a lane share one flag), and the selected window's ticks.
 * Marks closer than 2 px merge into one (the taller wins; several make it tall) — at 6 STD and 24 STD a lane is a
 * row of count bars. 24 STD draws from the minute histogram instead of the ops.
 */
import { type Axis, xOf } from './axis'
import { F, K, type JOp, type LaneKey } from './types'

export type TickSize = 's' | 'm' | 'l'

export interface MarkTick {
  x: number
  size: TickSize
  sel: boolean
  /** the op under it (hit testing; the newest of a merged column) */
  op?: JOp
}

export interface MarkRange {
  x0: number
  x1: number
  /** the person typing: a bar along the bottom */
  bar: boolean
}

export interface MarkPoint {
  x: number
  sel: boolean
  op: JOp
}

export interface MarkFlag {
  /** x of its pole (the first write of its first run) */
  x: number
  first: number
  last: number
  /** run keys (runs close together share a flag) */
  runs: string[]
  /** the selected window is this flag's run */
  sel: boolean
}

export interface LaneMarks {
  ranges: MarkRange[]
  ticks: MarkTick[]
  points: MarkPoint[]
  flags: MarkFlag[]
  /** synced-block copies made for this lane's writes: drawn dimmed, never counted */
  copies: MarkPoint[]
  /** Vorgänge in the span (copies never count) */
  count: number
}

export interface Sel {
  lane: LaneKey
  run?: string
  a: number
  b: number
}

/** Kinds that draw a flag at a run's start (sync pick-ups and derived writers stay points). */
const FLAG_RUNS = new Set(['agent', 'terminal', 'mcp', 'script', 'ai', 'import', 'eject', 'rewind', 'coding', 'order', 'mail', 'template'])
/** runs whose starts are this close share a flag */
const FLAG_JOIN_MS = 90_000
const MERGE_PX = 2

/** A write's weight: a schema change, a new / trashed / moved place or ≥ 3 places is tall; content or 2 places mid. */
export function tickSize(o: Pick<JOp, 'kinds' | 'n' | 'ops'>): TickSize {
  if (o.kinds & (K.SCHEMA | K.VIEW | K.CREATE | K.TRASH | K.DELETE | K.MOVE | K.RESTORE) || o.n >= 3) return 'l'
  if (o.kinds & K.CONTENT || o.n === 2 || o.ops > 1) return 'm'
  return 's'
}

const RANK: Record<TickSize, number> = { s: 0, m: 1, l: 2 }

export const isSelected = (o: JOp, sel: Sel | null): boolean => !!sel && o.l === sel.lane && (!sel.run || o.r === sel.run) && o.at >= sel.a && o.at < sel.b

const textOnly = (o: JOp) => (o.kinds & ~(K.CONTENT | K.TITLE)) === 0

export const runFlagged = (runKey: string): boolean => FLAG_RUNS.has(runKey.slice(0, runKey.indexOf(':')))

/** A synced-block copy (made by the sync service for a writer's change): drawn dimmed on its lane, never counted. */
export const isCopy = (o: Pick<JOp, 'f'>): boolean => !!((o.f ?? 0) & F.COPY)

/** Vorgänge of a lane in [t0, t1] (copies never count). */
export function countOps(ops: JOp[] | undefined, t0: number, t1: number): number {
  let n = 0
  for (const o of ops ?? []) if (!isCopy(o) && (o.t2 ?? o.at) >= t0 && o.at <= t1) n++
  return n
}

/**
 * The marks of a lane's ops (sorted by time) on an axis `width` px wide. `human`: the person's lane (typing bars).
 */
export function laneMarks(ops: JOp[], o: { ax: Axis; width: number; sel: Sel | null; human: boolean }): LaneMarks {
  const { ax, width, sel } = o
  const msPerPx = ax.total / Math.max(1, width)
  const gap = Math.max(60_000, 10 * msPerPx)
  const out: LaneMarks = { ranges: [], ticks: [], points: [], flags: [], copies: [], count: 0 }
  const inSpan: JOp[] = []
  for (const x of ops) {
    if ((x.t2 ?? x.at) < ax.t0 || x.at > ax.t1) continue
    if (isCopy(x)) out.copies.push({ x: xOf(ax, x.at, width), sel: false, op: x })
    else inSpan.push(x)
  }
  out.count = inSpan.length
  out.copies = mergePoints(out.copies)
  // bursts
  let burst: JOp[] = []
  let end = -Infinity
  const flush = () => {
    if (!burst.length) return
    const a = burst[0].at
    const b = end
    const x0 = xOf(ax, a, width)
    const x1 = xOf(ax, b, width)
    const typing = o.human && burst.every(textOnly)
    if ((burst.length >= 3 || (typing && burst.length >= 2)) && x1 - x0 >= 3) {
      out.ranges.push({ x0, x1, bar: typing })
      for (const op of burst) out.ticks.push({ x: xOf(ax, op.at, width), size: tickSize(op), sel: isSelected(op, sel), op })
    } else if (burst.length >= 3 || x1 - x0 < 3) {
      // many at one moment (an apply of several changes): one point
      out.points.push({ x: x0, sel: burst.some((op) => isSelected(op, sel)), op: burst[burst.length - 1] })
    } else for (const op of burst) out.points.push({ x: xOf(ax, op.at, width), sel: isSelected(op, sel), op })
    burst = []
  }
  for (const op of inSpan) {
    if (burst.length && op.at - end > gap) flush()
    burst.push(op)
    end = Math.max(end, op.t2 ?? op.at)
  }
  flush()
  out.ticks = mergeTicks(out.ticks)
  out.points = mergePoints(out.points)
  out.flags = laneFlags(inSpan, ax, width, sel)
  return out
}

/** Flags at the starts of runs (runs that start within 90 s of the previous one's end share it). */
function laneFlags(ops: JOp[], ax: Axis, width: number, sel: Sel | null): MarkFlag[] {
  const runs = new Map<string, { first: number; last: number }>()
  for (const op of ops) {
    if (!op.r || !runFlagged(op.r)) continue
    const r = runs.get(op.r)
    if (!r) runs.set(op.r, { first: op.at, last: op.t2 ?? op.at })
    else {
      r.first = Math.min(r.first, op.at)
      r.last = Math.max(r.last, op.t2 ?? op.at)
    }
  }
  const list = [...runs].sort((a, b) => a[1].first - b[1].first)
  const flags: MarkFlag[] = []
  for (const [key, r] of list) {
    const cur = flags[flags.length - 1]
    if (cur && r.first - cur.last <= FLAG_JOIN_MS && !(sel?.run && (sel.run === key || cur.runs.includes(sel.run)))) {
      cur.runs.push(key)
      cur.last = Math.max(cur.last, r.last)
      continue
    }
    flags.push({ x: xOf(ax, r.first, width), first: r.first, last: r.last, runs: [key], sel: !!sel?.run && sel.run === key })
  }
  return flags
}

function mergeTicks(ticks: MarkTick[]): MarkTick[] {
  if (ticks.length < 2) return ticks
  ticks.sort((a, b) => a.x - b.x)
  const out: MarkTick[] = []
  let n = 0
  for (const t of ticks) {
    const last = out[out.length - 1]
    if (last && t.x - last.x < MERGE_PX && t.sel === last.sel) {
      n++
      if (RANK[t.size] > RANK[last.size] || n >= 2) last.size = n >= 2 ? 'l' : t.size
      if (t.op && (!last.op || t.op.at >= last.op.at)) last.op = t.op
      continue
    }
    n = 0
    out.push({ ...t })
  }
  return out
}

function mergePoints(points: MarkPoint[]): MarkPoint[] {
  if (points.length < 2) return points
  points.sort((a, b) => a.x - b.x)
  const out: MarkPoint[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && p.x - last.x < MERGE_PX) {
      last.sel ||= p.sel
      if (p.op.at >= last.op.at) last.op = p.op
      continue
    }
    out.push({ ...p })
  }
  return out
}

/** 24 STD: a lane from its minute histogram ([minute index, Vorgänge]), one count bar per merged column. */
export function histMarks(minutes: Array<[number, number]>, o: { ax: Axis; width: number }): LaneMarks {
  const out: LaneMarks = { ranges: [], ticks: [], points: [], flags: [], copies: [], count: 0 }
  const ticks: MarkTick[] = []
  for (const [m, n] of minutes) {
    const t = m * 60_000 + 30_000
    if (t < o.ax.t0 || t > o.ax.t1) continue
    out.count += n
    ticks.push({ x: xOf(o.ax, t, o.width), size: n >= 4 ? 'l' : n >= 2 ? 'm' : 's', sel: false })
  }
  out.ticks = mergeTicks(ticks)
  return out
}

/** The op nearest to `x` within `tol` px among a lane's marks (a click on the tape). */
export function opAt(marks: LaneMarks, x: number, tol = 4): JOp | null {
  let best: JOp | null = null
  let bestD = tol
  for (const t of marks.ticks) {
    const d = Math.abs(t.x - x)
    if (t.op && d <= bestD) {
      best = t.op
      bestD = d
    }
  }
  for (const p of marks.points) {
    const d = Math.abs(p.x - x)
    if (d <= bestD) {
      best = p.op
      bestD = d
    }
  }
  // a dimmed copy only where nothing of the lane's own is
  if (!best)
    for (const p of marks.copies) {
      const d = Math.abs(p.x - x)
      if (d <= bestD) {
        best = p.op
        bestD = d
      }
    }
  return best
}

/** The dimmed copies as one SVG path (short ticks). */
export function copiesPath(points: MarkPoint[], laneH: number): string {
  const base = laneH - 7
  let d = ''
  for (const p of points) d += `M${(p.x - 0.75).toFixed(2)} ${base}h1.5v-6h-1.5z`
  return d
}

/** Tick and point shapes as one SVG path (1.5 px ticks from the lane's bottom − 7; points are a "T"). */
export function marksPath(ticks: MarkTick[], points: MarkPoint[], laneH: number, sel: boolean): string {
  const base = laneH - 7
  const H: Record<TickSize, number> = { s: 8, m: 11, l: 14 }
  let d = ''
  for (const t of ticks) if (t.sel === sel) d += `M${(t.x - 0.75).toFixed(2)} ${base}h1.5v-${H[t.size]}h-1.5z`
  for (const p of points) if (p.sel === sel) d += `M${(p.x - 1).toFixed(2)} ${base}h2v-14h-2zM${(p.x - 3).toFixed(2)} ${base - 14}h6v-3h-6z`
  return d
}
