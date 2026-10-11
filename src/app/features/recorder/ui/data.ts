/**
 * The deck's data while it is open: the visible span's ops and runs (one range read, with half a span to spare on
 * either side so a pan rarely reads), the 24 h strip's quarters (re-read when the strip moves on), the minute
 * histogram at 24 STD, the known lanes. A dense span (more than DENSE Vorgänge — reading thousands of ops takes longer
 * than the open budget) paints first from its minute histogram (one small read) and swaps in its ops when they are
 * read. This tab's flushes are merged straight in (no read; only the lanes that got ops change); another tab's ping
 * or a wipe / prune re-reads, debounced.
 */
import { useEffect } from 'react'
import { useCloud } from '../../../cloud'
import { scopeNow } from '../journal/scope'
import { onFlushed, onJournalChange, type Flushed } from '../journal/bus'
import { laneList, minutesInSpan, opsInSpan, quarterCounts, runsInSpan } from '../journal/query'
import { stripRange } from '../model/axis'
import type { JOp, JRun, LaneKey, Scope } from '../model/types'
import { emptyOps, useRecorderUI, type OpsWindow } from './state'
import { spanOfState, useSpan } from './clock'

const REREAD_MS = 500
/** More Vorgänge than this in the span to read: the first paint comes from the minute histogram. */
const DENSE = 1500

/** Group ops by lane, each lane sorted by time. */
export function byLane(ops: JOp[]): Record<LaneKey, JOp[]> {
  const out: Record<LaneKey, JOp[]> = {}
  for (const o of ops) (out[o.l] ??= []).push(o)
  for (const l of Object.keys(out)) out[l].sort((a, b) => a.at - b.at || (a.k < b.k ? -1 : 1))
  return out
}

/** Merge pushed ops into the loaded window: only the lanes that got ops get a new array. */
export function mergeOps(win: OpsWindow, ops: JOp[], runs: JRun[]): OpsWindow | null {
  const mine = ops.filter((o) => o.s === win.scope && o.at >= win.from - 30_000)
  const runsMine = runs.filter((r) => r.s === win.scope)
  if (!mine.length && !runsMine.length) return null
  const lanes = { ...win.lanes }
  let to = win.to
  for (const [lane, list] of Object.entries(byLane(mine))) {
    const cur = lanes[lane] ? [...lanes[lane]] : []
    for (const o of list) {
      const i = cur.findIndex((c) => c.k === o.k)
      if (i >= 0) cur[i] = o
      else {
        // usually the newest: insert from the end
        let at = cur.length
        while (at > 0 && cur[at - 1].at > o.at) at--
        cur.splice(at, 0, o)
      }
      to = Math.max(to, o.t2 ?? o.at)
    }
    lanes[lane] = cur
  }
  const runMap = runsMine.length ? { ...win.runs } : win.runs
  for (const r of runsMine) runMap[r.key] = r
  return { ...win, lanes, runs: runMap, to, rev: win.rev + 1 }
}

/** New ops among pushed ones (a fold written again is no new Vorgang): their quarters for the strip. */
function stripAdd(strip: { q0: number; counts: Record<number, number> } | null, pushed: JOp[], known: Set<string>): { q0: number; counts: Record<number, number> } | null {
  if (!strip) return strip
  let counts: Record<number, number> | null = null
  for (const o of pushed) {
    if (known.has(o.k)) continue
    const q = Math.floor(o.at / 900_000)
    if (q < strip.q0) continue
    counts ??= { ...strip.counts }
    counts[q] = (counts[q] ?? 0) + 1
  }
  return counts ? { q0: strip.q0, counts } : strip
}

let loadSeq = 0

/** The minute histogram as lanes: lane → [minute, Vorgänge][]. */
function histLanes(rows: Awaited<ReturnType<typeof minutesInSpan>>): Record<LaneKey, Array<[number, number]>> {
  const lanes: Record<LaneKey, Array<[number, number]>> = {}
  for (const h of rows) for (const [l, n] of Object.entries(h.lanes)) (lanes[l] ??= []).push([h.m, n])
  return lanes
}

/** Read the span (with room on either side) into the store. */
async function loadSpan(scope: Scope, t0: number, t1: number, runsOnly = false): Promise<void> {
  const seq = ++loadSeq
  const pad = (t1 - t0) / 2
  const from = t0 - pad
  const to = t1 + pad
  useRecorderUI.setState((s) => ({ ops: { ...s.ops, status: 'loading' } }))
  try {
    const runsRead = runsInSpan(scope, from, to)
    if (!runsOnly) {
      // a dense span: its minutes first (a few hundred records at most), the ops after
      const minutes = await minutesInSpan(scope, from, to)
      let total = 0
      for (const h of minutes) for (const n of Object.values(h.lanes)) total += n
      if (total > DENSE) {
        const runs = await runsRead
        if (seq !== loadSeq || !useRecorderUI.getState().open) return
        useRecorderUI.setState((s) => ({ hist: { from, to, lanes: histLanes(minutes) }, ops: { scope, from, to, lanes: {}, runs, rev: s.ops.rev + 1, status: 'ready', interim: true } }))
      }
    }
    const [ops, runs] = await Promise.all([runsOnly ? Promise.resolve([]) : opsInSpan(scope, from, to), runsRead])
    if (seq !== loadSeq || !useRecorderUI.getState().open) return
    useRecorderUI.setState((s) => ({ ops: { scope, from, to, lanes: byLane(ops), runs, rev: s.ops.rev + 1, status: 'ready', runsOnly } }))
  } catch (e) {
    console.warn('[recorder] the tape could not be read', e)
    if (seq === loadSeq) useRecorderUI.setState((s) => ({ ops: { ...s.ops, status: 'ready' } }))
  }
}

async function loadStrip(scope: Scope, t1: number): Promise<void> {
  const r = stripRange(t1)
  try {
    const counts = await quarterCounts(scope, r.q0, r.q0 + 96)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ strip: { q0: r.q0, counts: Object.fromEntries(counts) } })
  } catch {
    /* the strip stays empty */
  }
}

async function loadHist(scope: Scope, t0: number, t1: number): Promise<void> {
  try {
    const rows = await minutesInSpan(scope, t0, t1)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ hist: { from: t0, to: t1, lanes: histLanes(rows) } })
  } catch {
    /* ops stay the source */
  }
}

async function loadKnown(scope: Scope): Promise<void> {
  try {
    const lanes = await laneList(scope)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ known: Object.keys(lanes) })
  } catch {
    /* the filter lists the lanes of the span */
  }
}

/** Mount once in the deck: keeps the store's data in step with the span, this tab's flushes and other tabs. */
export function useDeckData(): void {
  const span = useSpan()
  const zoom = useRecorderUI((s) => s.span.zoom)
  const cloudKey = useCloud((s) => `${s.active.kind}:${s.active.kind === 'cloud' ? s.active.id : ''}:${s.user?.id ?? ''}`)

  // the span: read when it leaves what is loaded (or the scope changed); 24 STD draws from the minute histogram and
  // reads only the runs
  useEffect(() => {
    const scope = scopeNow()
    const w = useRecorderUI.getState().ops
    if (w.scope === scope && w.status !== 'idle' && span.t0 >= w.from && span.t1 <= w.to && (zoom === '24h') === w.runsOnly) return
    void loadSpan(scope, span.t0, span.t1, zoom === '24h')
  }, [span.t0, span.t1, cloudKey, zoom])

  // the strip moves on with the tape's right edge (a new quarter)
  const q0 = stripRange(span.t1).q0
  useEffect(() => {
    void loadStrip(scopeNow(), span.t1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q0, cloudKey])

  // 24 STD: lanes from the minute histogram
  useEffect(() => {
    if (zoom !== '24h') {
      if (useRecorderUI.getState().hist) useRecorderUI.setState({ hist: null })
      return
    }
    const h = useRecorderUI.getState().hist
    if (h && span.t0 >= h.from && span.t1 <= h.to && !useRecorderUI.getState().ops.interim) return
    void loadHist(scopeNow(), span.t0 - 6 * 3600_000, span.t1 + 6 * 3600_000)
  }, [zoom, span.t0, span.t1, cloudKey])

  useEffect(() => {
    void loadKnown(scopeNow())
  }, [cloudKey])

  // this tab's flushes: merged; other tabs and wipes: re-read (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const reread = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const s = useRecorderUI.getState()
        if (!s.open) return
        const scope = scopeNow()
        const w = s.ops.scope === scope && s.ops.status !== 'idle' ? s.ops : null
        const cur = spanOfState(s)
        void loadSpan(scope, w ? w.from + (w.to - w.from) / 4 : cur.t0, w ? w.to - (w.to - w.from) / 4 : cur.t1, s.span.zoom === '24h')
        void loadStrip(scope, cur.t1)
        void loadKnown(scope)
        if (s.span.zoom === '24h') void loadHist(scope, cur.t0 - 6 * 3600_000, cur.t1 + 6 * 3600_000)
      }, REREAD_MS)
    }
    const offFlush = onFlushed((f: Flushed) => {
      const s = useRecorderUI.getState()
      if (!s.open || s.ops.status === 'idle') return
      const seen = new Set<string>()
      for (const list of Object.values(s.ops.lanes)) for (const o of list) seen.add(o.k)
      const next = mergeOps(s.ops, f.ops, f.runs)
      if (!next) return
      const lanes = new Set(s.known)
      const added = f.ops.filter((o) => o.s === s.ops.scope && !lanes.has(o.l)).map((o) => o.l)
      useRecorderUI.setState({ ops: next, strip: stripAdd(s.strip, f.ops.filter((o) => o.s === s.ops.scope), seen), ...(added.length ? { known: [...s.known, ...new Set(added)] } : {}) })
    })
    const offChange = onJournalChange((c, local) => {
      if (local && c.kind === 'flushed') return
      if (c.kind === 'flushed' && !c.scopes.includes(scopeNow())) return
      if (c.kind === 'reset' && c.scope && c.scope !== scopeNow()) return
      reread()
    })
    return () => {
      offFlush()
      offChange()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // closing: nothing loaded stays (the store's close already empties it)
  useEffect(
    () => () => {
      loadSeq++
      useRecorderUI.setState({ ops: emptyOps() })
    },
    [],
  )
}
