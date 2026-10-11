/**
 * What the deck's keys and gestures do: move the playhead (the span follows with a 10 % margin), jump to runs,
 * bracket a window at the playhead or a run from its flag, pan the span. All in the deck's own store.
 */
import { followSpan, panSpan, runBracket, spanAround, ZOOM } from '../model/axis'
import { isCopy, runFlagged } from '../model/marks'
import type { JOp, LaneKey } from '../model/types'
import { spanOfState } from './clock'
import { sayRun } from './live'
import { setBracket, setPlayhead, setSpanEnd, useRecorderUI } from './state'

const MIN = 60_000
const TAPE_DAYS = 30

/** The earliest moment the tape can show (30 days back). */
export const tapeFloor = (now = Date.now()): number => now - TAPE_DAYS * 24 * 3600_000

/** The playhead to `t` (clamped to [floor, now]; at now it follows the clock); the span keeps it inside. */
export function movePlayhead(t: number | null): void {
  const now = Date.now()
  if (t === null || t >= now - 500) {
    setPlayhead(null)
    setSpanEnd('now')
    return
  }
  const at = Math.max(tapeFloor(now), Math.round(t))
  setPlayhead(at)
  const s = useRecorderUI.getState()
  const cur = spanOfState(s, now)
  const next = spanAround(at, s.span.zoom, cur, now)
  if (next !== cur) setSpanEnd(next.t1 >= followSpan(now, s.span.zoom).t1 ? 'now' : next.t1)
}

/** The playhead moved by `dt` ms from where it is (now when it follows the clock). */
export function stepPlayhead(dt: number): void {
  const s = useRecorderUI.getState()
  movePlayhead((s.playhead ?? Date.now()) + dt)
}

/** Where the playhead is. */
export const playheadAt = (): number => useRecorderUI.getState().playhead ?? Date.now()

/** Run starts on the loaded tape (one per run key), oldest first — of one lane, or of all. */
export function runStarts(lane?: LaneKey): Array<{ t: number; run: string; lane: LaneKey }> {
  const lanes = useRecorderUI.getState().ops.lanes
  const firsts = new Map<string, { t: number; lane: LaneKey }>()
  for (const [l, ops] of Object.entries(lanes)) {
    if (lane && l !== lane) continue
    for (const o of ops) if (o.r && runFlagged(o.r) && !isCopy(o) && !firsts.has(o.r)) firsts.set(o.r, { t: o.at, lane: l })
  }
  return [...firsts].map(([run, v]) => ({ run, ...v })).sort((a, b) => a.t - b.t)
}

/** The playhead to the previous run's start (before the playhead, any lane) — said in the live region. */
export function prevRun(): void {
  const at = playheadAt() - 1000
  const before = runStarts().filter((r) => r.t < at)
  const hit = before[before.length - 1]
  if (!hit) return
  movePlayhead(hit.t)
  sayRun(hit.run, hit.lane, hit.t)
}

/** The first and last write of a run on the loaded tape (its record when known). */
export function runSpanOf(run: string): { first: number; last: number; lane: LaneKey } | null {
  const s = useRecorderUI.getState()
  let first = Infinity
  let last = -Infinity
  let lane: LaneKey | null = null
  for (const [l, ops] of Object.entries(s.ops.lanes))
    for (const o of ops)
      if (o.r === run) {
        first = Math.min(first, o.at)
        last = Math.max(last, o.t2 ?? o.at)
        lane = l
      }
  const rec = s.ops.runs[run]
  if (rec) {
    first = Math.min(first, rec.from)
    last = Math.max(last, rec.to)
    lane ??= rec.l
  }
  return lane && Number.isFinite(first) ? { first, last, lane } : null
}

/** A flag's click: its run (or runs) bracketed whole, edges rounded outward to the 5-minute tick. */
export function bracketRuns(lane: LaneKey, runs: string[]): void {
  let first = Infinity
  let last = -Infinity
  for (const r of runs) {
    const sp = runSpanOf(r)
    if (!sp) continue
    first = Math.min(first, sp.first)
    last = Math.max(last, sp.last)
  }
  if (!Number.isFinite(first)) return
  const { a, b } = runBracket(first, last)
  setBracket({ lane, ...(runs.length === 1 ? { run: runs[0] } : {}), a, b })
}

/** `[` / `]`: the window's start / end at the playhead on a lane (swapped when reversed; at least one step wide). */
export function bracketEdge(edge: 'start' | 'end', lane: LaneKey): void {
  const s = useRecorderUI.getState()
  const at = playheadAt()
  const step = ZOOM[s.span.zoom].snap
  const cur = s.bracket && s.bracket.lane === lane ? s.bracket : null
  let a = edge === 'start' ? at : (cur?.a ?? at - step)
  let b = edge === 'end' ? at : (cur?.b ?? at + step)
  if (b < a) [a, b] = [b, a]
  if (b - a < step) {
    if (edge === 'start') b = a + step
    else a = b - step
  }
  setBracket({ lane, a, b })
}

/** Pan the span by `dt` ms (it stops following now). */
export function panBy(dt: number): void {
  const s = useRecorderUI.getState()
  const now = Date.now()
  const cur = spanOfState(s, now)
  const next = panSpan(cur, dt, now, s.span.zoom, tapeFloor(now))
  setSpanEnd(next.t1 >= followSpan(now, s.span.zoom).t1 ? 'now' : next.t1)
}

/** Center the span on `t` (a click in the 24 h strip). */
export function spanTo(t: number): void {
  const s = useRecorderUI.getState()
  const half = ZOOM[s.span.zoom].span / 2
  const cur = spanOfState(s)
  panBy(t + half - cur.t1)
}

/** The ops of a lane near `t` (the tick under a click, for tests and keys). */
export function opsNear(lane: LaneKey, t: number, tol: number): JOp[] {
  return (useRecorderUI.getState().ops.lanes[lane] ?? []).filter((o) => Math.abs(o.at - t) <= tol)
}

export { MIN }
