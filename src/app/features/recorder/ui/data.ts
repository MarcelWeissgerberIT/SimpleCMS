/**
 * The deck's data while it is open: the visible span's ops and runs (one range read — the first paint needs only
 * the span; half a span on either side follows once that is painted, so a pan rarely reads), the 24 h strip's
 * quarters (re-read when the strip moves on), the minute histogram at 24 STD, the known lanes. A very dense span (more
 * than DENSE Vorgänge) paints its minute histogram while its ops are still being read. This tab's flushes are merged
 * straight in (no read): ops by key into the loaded window (never past its edges — what lies beyond is read when the
 * span gets there), new Vorgänge into the strip and the minute bars (synced-block copies are never counted); a push
 * that lands while a read is under way is merged into its result. Another tab's ping or a wipe / prune re-reads,
 * debounced.
 */
import { useEffect } from 'react'
import { useCloud } from '../../../cloud'
import { scopeNow } from '../journal/scope'
import { onFlushed, onJournalChange, type Flushed } from '../journal/bus'
import { laneList, minutesInSpan, opsInSpan, quarterCounts, runsInSpan } from '../journal/query'
import { lostTails } from '../journal/recover'
import { stripRange } from '../model/axis'
import { isCopy } from '../model/marks'
import type { JOp, JRun, LaneKey, Scope } from '../model/types'
import { emptyOps, useRecorderUI, type OpsWindow, type RecorderUI } from './state'
import { spanOfState, useSpan } from './clock'

const REREAD_MS = 500
/** More Vorgänge than this in the span: its minute histogram is painted while the ops are read. */
const DENSE = 12_000
/** A typing fold starts up to this much before the ops it represents. */
const FOLD_MS = 30_000

const byTime = (a: JOp, b: JOp): number => a.at - b.at || (a.k < b.k ? -1 : 1)

/** Group ops by lane, each lane sorted by time (a range read comes in key order — by time already). */
export function byLane(ops: JOp[]): Record<LaneKey, JOp[]> {
  const out: Record<LaneKey, JOp[]> = {}
  for (const o of ops) (out[o.l] ??= []).push(o)
  for (const l of Object.keys(out)) {
    const list = out[l]
    let sorted = true
    for (let i = 1; i < list.length && sorted; i++) sorted = byTime(list[i - 1], list[i]) <= 0
    if (!sorted) list.sort(byTime)
  }
  return out
}

/**
 * Merge pushed ops into the loaded window: only the lanes that got ops get a new array. Only ops inside the loaded
 * range [from − fold, to] — a push never widens the window (a later span that reaches past `to` reads; a widened
 * window would claim a stretch it never read).
 */
export function mergeOps(win: OpsWindow, ops: JOp[], runs: JRun[]): OpsWindow | null {
  const mine = ops.filter((o) => o.s === win.scope && o.at >= win.from - FOLD_MS && o.at <= win.to)
  const runsMine = runs.filter((r) => r.s === win.scope)
  if (!mine.length && !runsMine.length) return null
  const lanes = { ...win.lanes }
  for (const [lane, list] of Object.entries(byLane(mine))) {
    const old = lanes[lane] ?? []
    if (list.length > 8) {
      // many (the room on either side): by key, then one sort — never a search per op
      const add = new Map(list.map((o) => [o.k, o]))
      const cur = old.map((c) => {
        const o = add.get(c.k)
        if (!o) return c
        add.delete(c.k)
        return o
      })
      for (const o of add.values()) cur.push(o)
      lanes[lane] = cur.sort(byTime)
      continue
    }
    const cur = [...old]
    for (const o of list) {
      const i = cur.findIndex((c) => c.k === o.k)
      if (i >= 0) cur[i] = o
      else {
        // usually the newest: insert from the end
        let at = cur.length
        while (at > 0 && cur[at - 1].at > o.at) at--
        cur.splice(at, 0, o)
      }
    }
    lanes[lane] = cur
  }
  const runMap = runsMine.length ? { ...win.runs } : win.runs
  for (const r of runsMine) runMap[r.key] = r
  return { ...win, lanes, runs: runMap, rev: win.rev + 1 }
}

/** New Vorgänge (counted ones) into the 24 h strip: their quarters. */
export function stripAdd(strip: RecorderUI['strip'], added: JOp[]): RecorderUI['strip'] {
  if (!strip) return strip
  let counts: Record<number, number> | null = null
  for (const o of added) {
    const q = Math.floor(o.at / 900_000)
    if (q < strip.q0 || q >= strip.q0 + 96) continue
    counts ??= { ...strip.counts }
    counts[q] = (counts[q] ?? 0) + 1
  }
  return counts ? { q0: strip.q0, counts } : strip
}

/** New Vorgänge (counted ones) into the minute histogram (24 STD's lanes): only the lanes that got some change. */
export function histAdd(hist: RecorderUI['hist'], added: JOp[]): RecorderUI['hist'] {
  if (!hist) return hist
  let lanes: Record<LaneKey, Array<[number, number]>> | null = null
  for (const o of added) {
    if (o.at < hist.from || o.at > hist.to) continue
    const m = Math.floor(o.at / 60_000)
    lanes ??= { ...hist.lanes }
    const cur = lanes[o.l] === hist.lanes[o.l] ? [...(lanes[o.l] ?? [])] : lanes[o.l]
    let i = cur.length
    while (i > 0 && cur[i - 1][0] > m) i--
    if (i > 0 && cur[i - 1][0] === m) cur[i - 1] = [m, cur[i - 1][1] + 1]
    else cur.splice(i, 0, [m, 1])
    lanes[o.l] = cur
  }
  return lanes ? { ...hist, lanes } : hist
}

/* ---------- pushes that land while a read is under way ---------- */

let pushSeq = 0
const pushLog: Array<{ n: number; ops: JOp[]; runs: JRun[] }> = []
/** a strip / histogram read is under way (a counted push meanwhile: read again when it is done) */
const counting = { strip: 0, hist: 0, staleStrip: false, staleHist: false }

function logPush(f: Flushed): void {
  pushLog.push({ n: ++pushSeq, ops: f.ops, runs: f.runs })
  while (pushLog.length > 200) pushLog.shift()
}

/** The window with every push since `mark` merged in. */
function withPushes(win: OpsWindow, mark: number): OpsWindow {
  let out = win
  for (const p of pushLog) if (p.n > mark) out = mergeOps(out, p.ops, p.runs) ?? out
  return out
}

let loadSeq = 0

/** The minute histogram as lanes: lane → [minute, Vorgänge][]. */
function histLanes(rows: Awaited<ReturnType<typeof minutesInSpan>>): Record<LaneKey, Array<[number, number]>> {
  const lanes: Record<LaneKey, Array<[number, number]>> = {}
  for (const h of rows) for (const [l, n] of Object.entries(h.lanes)) (lanes[l] ??= []).push([h.m, n])
  return lanes
}

/** After the next painted frame (the first paint goes out before the room on either side is read). */
const afterPaint = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))

/**
 * Read the span into the store: first exactly the visible span (its ops, the runs reaching into it) — the first
 * paint —, then half a span on either side.
 */
async function loadSpan(scope: Scope, t0: number, t1: number, runsOnly = false): Promise<void> {
  const seq = ++loadSeq
  const mark = pushSeq
  const pad = (t1 - t0) / 2
  const live = () => seq === loadSeq && useRecorderUI.getState().open
  useRecorderUI.setState((s) => ({ ops: { ...s.ops, status: 'loading' } }))
  try {
    const runsRead = runsInSpan(scope, t0 - pad, t1 + pad)
    if (runsOnly) {
      // 24 STD: the lanes draw from the minute histogram; the runs only
      const runs = await runsRead
      if (!live()) return
      useRecorderUI.setState((s) => ({ ops: withPushes({ scope, from: t0 - pad, to: t1 + pad, lanes: {}, runs, rev: s.ops.rev + 1, status: 'ready', runsOnly: true }, mark) }))
      return
    }
    let opsDone = false
    const opsRead = opsInSpan(scope, t0, t1).then((ops) => {
      opsDone = true
      return ops
    })
    // a very dense span: its minutes (a few dozen records) are painted while the ops are still on their way
    void minutesInSpan(scope, t0, t1)
      .then(async (minutes) => {
        let total = 0
        for (const h of minutes) for (const n of Object.values(h.lanes)) total += n
        if (total <= DENSE || opsDone) return
        const runs = await runsRead
        if (opsDone || !live()) return
        useRecorderUI.setState((s) => ({ hist: { from: t0, to: t1, lanes: histLanes(minutes) }, ops: { scope, from: t0, to: t1, lanes: {}, runs, rev: s.ops.rev + 1, status: 'ready', interim: true } }))
      })
      .catch(() => undefined)
    const [ops, runs] = await Promise.all([opsRead, runsRead])
    if (!live()) return
    useRecorderUI.setState((s) => ({ ops: withPushes({ scope, from: t0, to: t1, lanes: byLane(ops), runs, rev: s.ops.rev + 1, status: 'ready' }, mark) }))

    // the room on either side, once the span is on screen
    await afterPaint()
    if (!live()) return
    const [left, right] = await Promise.all([opsInSpan(scope, t0 - pad, t0), opsInSpan(scope, t1, t1 + pad)])
    if (!live()) return
    useRecorderUI.setState((s) => {
      const w = s.ops
      if (w.scope !== scope || w.from !== t0 || w.to !== t1 || w.status !== 'ready') return {}
      const wide = { ...w, from: t0 - pad, to: t1 + pad }
      return { ops: mergeOps(wide, [...left, ...right], []) ?? wide }
    })
  } catch (e) {
    console.warn('[recorder] the tape could not be read', e)
    if (seq === loadSeq) useRecorderUI.setState((s) => ({ ops: { ...s.ops, status: 'ready' } }))
  }
}

async function loadStrip(scope: Scope, t1: number): Promise<void> {
  const r = stripRange(t1)
  counting.strip++
  counting.staleStrip = false
  try {
    const counts = await quarterCounts(scope, r.q0, r.q0 + 96)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ strip: { q0: r.q0, counts: Object.fromEntries(counts) } })
  } catch {
    /* the strip stays empty */
  } finally {
    counting.strip--
  }
  // a new Vorgang landed while it was read: read again (counting it into a read that may hold it is a double count)
  if (counting.staleStrip && !counting.strip && useRecorderUI.getState().open) void loadStrip(scope, t1)
}

async function loadHist(scope: Scope, t0: number, t1: number): Promise<void> {
  counting.hist++
  counting.staleHist = false
  try {
    const rows = await minutesInSpan(scope, t0, t1)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ hist: { from: t0, to: t1, lanes: histLanes(rows) } })
  } catch {
    /* ops stay the source */
  } finally {
    counting.hist--
  }
  if (counting.staleHist && !counting.hist && useRecorderUI.getState().open) void loadHist(scope, t0, t1)
}

/** The scope's lost stretches (a handful of kv records): the tape hatches them. */
async function loadGaps(scope: Scope): Promise<void> {
  try {
    const tails = await lostTails(scope)
    if (!useRecorderUI.getState().open) return
    useRecorderUI.setState({ gaps: tails.filter((g) => g.to > g.from).map((g) => ({ from: g.from, to: g.to })) })
  } catch {
    /* no hatch */
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
    if (w.scope === scope && w.status !== 'idle' && span.t0 >= w.from && span.t1 <= w.to && (zoom === '24h') === !!w.runsOnly) return
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
    void loadGaps(scopeNow())
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
        const cur = spanOfState(s)
        void loadSpan(scope, cur.t0, cur.t1, s.span.zoom === '24h')
        void loadStrip(scope, cur.t1)
        void loadKnown(scope)
        void loadGaps(scope)
        if (s.span.zoom === '24h') void loadHist(scope, cur.t0 - 6 * 3600_000, cur.t1 + 6 * 3600_000)
      }, REREAD_MS)
    }
    const offFlush = onFlushed((f: Flushed) => {
      logPush(f)
      const s = useRecorderUI.getState()
      if (!s.open) return
      const scope = s.ops.scope ?? scopeNow()
      // new Vorgänge of this scope (a fold written again is none; synced-block copies are never counted)
      const fresh = new Set(f.fresh ?? [])
      const added = f.ops.filter((o) => o.s === scope && fresh.has(o.k) && !isCopy(o))
      if (added.length) {
        if (counting.strip) counting.staleStrip = true
        if (counting.hist) counting.staleHist = true
      }
      const patch: Partial<RecorderUI> = {}
      const next = s.ops.status === 'idle' ? null : mergeOps(s.ops, f.ops, f.runs)
      if (next) patch.ops = next
      const strip = stripAdd(s.strip, added)
      if (strip !== s.strip) patch.strip = strip
      const hist = histAdd(s.hist, added)
      if (hist !== s.hist) patch.hist = hist
      const known = new Set(s.known)
      const newLanes = [...new Set(f.ops.filter((o) => o.s === scope && !known.has(o.l)).map((o) => o.l))]
      if (newLanes.length) patch.known = [...s.known, ...newLanes]
      if (Object.keys(patch).length) useRecorderUI.setState(patch)
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
