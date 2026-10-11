/**
 * The flight recorder's store listener and its scheduler. The listener is the hot path: it never diffs
 * the page map — it takes the shared diff only when another subscriber already computed it (history runs
 * first) and otherwise keeps the two frozen map references for the idle processor; for system writes it
 * looks only at places with an open segment (the identity chain). Everything else runs in idle slices
 * (≤ 8 ms visible, ≤ 50 ms hidden) and flushes after 500 ms, at 50 waiting records, at a run's end or a
 * long queue. Per tab: a Web Lock for its lifetime (recovery tells gone tabs by it), a tab record with its
 * last flush, recovery of gone tabs on the first slice, retention 60 s after start and every 6 h.
 */
import { useWorkspace, peekPageChanges, type PageChanges } from '../../../store/store'
import type { Database, ID, Page } from '../../../store/types'
import { currentWriter, onRunNote, type Writer } from '../../../store/writer'
import { isDeviceCopyGoing } from '../../../cloud'
import { scopeNow, workspaceOfScope } from './scope'
import { newId } from '../../../lib/ids'
import type { JSegment, PlaceKey, Scope } from '../model/types'
import { resolveHot } from './attribute'
import { Budget } from './budget'
import { openJournal, journalIfOpen, wipeScope } from './db'
import { forgetScopeKey } from './key'
import { idleTask, noteTask, Processor, type QItem, type Stats } from './process'
import { pruneHumanPins, pruneOldestDays, pruneRetention, pruneTodayPins, type PruneOpts } from './prune'
import { recoverScope } from './recover'
import { installSeam } from './seam'
import { emitReset } from './bus'
import { causeChain, laneOf, parseWriterKey, runKeyOf } from '../model/writerKeys'

export { scopeNow }

const VISIBLE_SLICE = 8
const HIDDEN_SLICE = 50
const FLUSH_MS = 500
const PRUNE_FIRST = 60_000
const PRUNE_EVERY = 6 * 3600_000
const HOT_RING = 2048
/** what the tab still records while it is being left (page hide) */
const PAGEHIDE_MS = 40


const pairsOf = (c: PageChanges, next: Record<ID, Page>, prev: Record<ID, Page>): Array<[ID, Page | undefined, Page | undefined]> => {
  const out: Array<[ID, Page | undefined, Page | undefined]> = new Array(c.changed.length)
  for (let i = 0; i < c.changed.length; i++) {
    const id = c.changed[i]
    out[i] = [id, prev[id], next[id]]
  }
  for (const id of c.removed) out.push([id, prev[id], undefined])
  return out
}

export class Recorder {
  readonly tab = newId().slice(0, 10)
  readonly stats: Stats = { hot: [], idleDiffScans: 0, sliceMax: 0, itemMax: 0, taskMax: 0, long: [] }
  private hotRing = new Float64Array(HOT_RING)
  private hotN = 0
  /** the time of each queued item recorded (one store update's places, or a big one's part) */
  private itemRing = new Float64Array(HOT_RING)
  private itemN = 0
  readonly queue: QItem[] = []
  readonly processor: Processor
  readonly budget: Budget
  private lastState = useWorkspace.getState()
  private on = true
  private rawPending = 0
  private sliceQueued = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private dueTimer: ReturnType<typeof setTimeout> | null = null
  private pruneTimer: ReturnType<typeof setTimeout> | null = null
  private recovering = new Map<Scope, Promise<Awaited<ReturnType<typeof recoverScope>>>>()
  private offs: Array<() => void> = []
  private releaseLock: (() => void) | null = null
  private channel: MessageChannel | null = null

  constructor() {
    this.budget = new Budget({
      pruneDays: (days) => pruneOldestDays(days, this.pruneOpts()).then((n) => (n && this.budget.freed(), n)),
      pruneHumanPins: () => pruneHumanPins(Date.now(), this.pruneOpts()),
      pruneTodayPins: () => pruneTodayPins(Date.now(), this.pruneOpts()),
      serial: (fn) => this.processor.exclusive(fn),
      forgetting: (s) => {
        const ws = workspaceOfScope(s)
        return !!ws && isDeviceCopyGoing(ws)
      },
    })
    this.processor = new Processor(this.tab, openJournal, this.budget, this.stats, () => this.queue.length)
  }

  get memory(): boolean {
    return journalIfOpen()?.mode === 'memory'
  }

  /** What a prune must leave alone: this tab's segments on their way to the journal. */
  private pruneOpts(): PruneOpts {
    return { memory: this.memory, keep: this.processor.liveSegIds() }
  }

  start(): void {
    this.lastState = useWorkspace.getState()
    this.offs.push(useWorkspace.subscribe((state, prev) => this.listen(state, prev)))
    this.offs.push(
      onRunNote((e) => {
        if (!this.on) return
        this.queue.push({ v: '', at: Date.now(), scope: scopeNow(), note: e })
        this.schedule()
      }),
    )
    this.budget.start()
    this.offs.push(() => this.budget.stop())
    try {
      void navigator.locks?.request(`one-recorder-tab:${this.tab}`, () => new Promise<void>((resolve) => (this.releaseLock = resolve)))
    } catch {
      /* no Web Locks: recovery never closes another tab's segments */
    }
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      this.processor.closeAll(Date.now())
      this.schedule()
    }
    // leaving: what fits in a moment is recorded and written (best effort) — a tab that could not finish is not clean,
    // so the next start marks its lost tail and closes its open segments (recovery)
    const onPageHide = () => {
      const deadline = performance.now() + PAGEHIDE_MS
      const drained = this.drain(deadline)
      this.processor.closeAll(Date.now())
      // segments still closing are no loss (recovery closes them exactly); the clean mark goes out at once
      this.processor.finishCloses(deadline)
      this.processor.leave(drained)
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) this.processor.stay()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    this.offs.push(() => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    })
    this.pruneTimer = setTimeout(() => void this.prune(), PRUNE_FIRST)
    // the first slice recovers what gone tabs left open
    this.schedule()
    installSeam(this)
  }

  async stop(): Promise<void> {
    if (!this.on) return
    this.on = false
    this.offs.forEach((f) => f())
    this.offs = []
    for (const t of [this.flushTimer, this.dueTimer, this.pruneTimer]) if (t) clearTimeout(t)
    this.drain()
    this.processor.closeAll(Date.now())
    this.drain()
    await this.processor.flush({ clean: true }).catch(() => undefined)
    this.releaseLock?.()
    this.releaseLock = null
  }

  /* ---------------------------------------------------------------- */
  /* the hot path                                                      */
  /* ---------------------------------------------------------------- */

  private listen(state: ReturnType<typeof useWorkspace.getState>, prev: ReturnType<typeof useWorkspace.getState>): void {
    const order = prev !== this.lastState
    this.lastState = state
    if (!this.on || !state.ready || !prev.ready) return
    const pagesMoved = state.pages !== prev.pages
    const dbsMoved = state.databases !== prev.databases
    if (!pagesMoved && !dbsMoved) return
    const t0 = performance.now()
    const frame = currentWriter()
    let w: Writer | undefined = frame ?? undefined
    let pending: QItem['pending']
    if (!w) {
      const r = resolveHot()
      if ('w' in r) w = r.w
      else pending = r.pending
    }
    const at = Date.now()
    const scope = scopeNow()
    if (w?.kind === 'system') {
      // only places with an open segment (or one about to open: updates still queued) can be harmed by an unseen
      // change — the processor picks them when it gets there, from the two maps and the shared diff when somebody
      // computed it: O(1) here, inside the store's set(), however many segments are open
      if (this.queue.length || this.processor.open.size) {
        const c = pagesMoved ? peekPageChanges(state.pages, prev.pages) : null
        this.queue.push({ v: '', at, scope, w, sysMaps: { pagesNext: state.pages, pagesPrev: prev.pages, dbsNext: state.databases, dbsPrev: prev.databases, pagesMoved, dbsMoved, ...(c ? { changed: c } : {}) } })
      }
    } else {
      const c = pagesMoved ? peekPageChanges(state.pages, prev.pages) : null
      const item: QItem = { v: this.processor.nextV(), at, scope, dbsNext: state.databases, dbsPrev: prev.databases }
      if (order) item.order = true
      if (w) item.w = w
      else item.pending = pending
      if (c) item.pairs = pairsOf(c, state.pages, prev.pages)
      else if (pagesMoved) {
        item.maps = { next: state.pages, prev: prev.pages }
        this.rawPending++
      }
      this.queue.push(item)
      // the tab's records say "dirty" now when they said "clean" (a microtask, not this listener)
      this.processor.noteUpdate(scope)
    }
    this.schedule()
    this.hot(performance.now() - t0)
  }

  private hot(ms: number): void {
    this.hotRing[this.hotN % HOT_RING] = ms
    this.hotN++
  }

  /** Start the measurements over (the perf spec reads one kind of write at a time). */
  resetStats(): void {
    this.hotN = 0
    this.itemN = 0
    this.stats.idleDiffScans = 0
    this.stats.sliceMax = 0
    this.stats.itemMax = 0
    this.stats.taskMax = 0
    this.stats.long = []
  }

  /** p50 / p95 / max of the hot path over the last 2,048 store updates. */
  hotStats(): { p50: number; p95: number; max: number; n: number } {
    return ringStats(this.hotRing, this.hotN)
  }

  /** p50 / p95 / max of recording one queued item, over the last 2,048. */
  itemStats(): { p50: number; p95: number; max: number; n: number } {
    return ringStats(this.itemRing, this.itemN)
  }

  /* ---------------------------------------------------------------- */
  /* scheduling                                                        */
  /* ---------------------------------------------------------------- */

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  private schedule(): void {
    if (this.sliceQueued || !this.on) return
    this.sliceQueued = true
    // a hidden tab's timers are throttled; many raw maps waiting should not wait for idle either
    if (this.hidden() || this.rawPending > 50) {
      this.channel ??= new MessageChannel()
      this.channel.port1.onmessage = () => this.slice()
      this.channel.port2.postMessage(0)
    } else if (typeof requestIdleCallback === 'function') requestIdleCallback((idle) => this.slice(idle), { timeout: 2000 })
    else setTimeout(() => this.slice(), 50)
  }

  private slice(idle?: IdleDeadline): void {
    this.sliceQueued = false
    if (!this.on) return
    const t0 = performance.now()
    const scope = scopeNow()
    if (!this.recovering.has(scope)) this.recovering.set(scope, this.recover(scope))
    // an idle period: no longer than it lasts (the next frame is the person's), never more than a slice
    const budget = this.hidden() ? HIDDEN_SLICE : idle && !idle.didTimeout ? Math.min(VISIBLE_SLICE, Math.max(2, idle.timeRemaining())) : VISIBLE_SLICE
    const deadline = t0 + budget
    let done = true
    while (this.queue.length && performance.now() < deadline) if (!(done = this.take(deadline))) break
    // runs that wrote after their end end again once their writes are recorded
    if (!this.queue.length) this.processor.endLate(Date.now())
    // segments closed meanwhile are summed up in the time left
    if (done && performance.now() < deadline) done = this.processor.finishCloses(deadline)
    this.stats.sliceMax = Math.max(this.stats.sliceMax, performance.now() - t0)
    // what is processed is written; the queue goes on in slices (a flush never drains it in one go)
    const due = this.processor.urgent || this.processor.waiting >= 50 || this.queue.length > 200 || this.hidden()
    if (due) this.writeOut()
    else if (this.processor.waiting && !this.flushTimer) this.flushTimer = setTimeout(() => this.writeOut(), FLUSH_MS)
    this.armDue()
    if (this.queue.length || this.processor.closingCount) this.schedule()
    noteTask(this.stats, 'slice', t0)
  }

  /** Write what is processed (the queue stays for the slices). */
  private writeOut(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    void this.processor.flush().catch((e) => console.warn('[recorder] journal write failed', e))
  }

  /** Record the next queued item, until `deadline`; false = a big one stopped there (it stays first in the queue). */
  private take(deadline = Infinity): boolean {
    const it = this.queue[0]
    let done = true
    const t0 = performance.now()
    try {
      done = this.processor.process(it, deadline)
    } catch (e) {
      console.warn('[recorder] an update could not be recorded', e)
    }
    const ms = performance.now() - t0
    if (ms > this.stats.itemMax) this.stats.itemMax = ms
    this.itemRing[this.itemN % HOT_RING] = ms
    this.itemN++
    if (!done) return false
    this.queue.shift()
    if (it.maps) this.rawPending = Math.max(0, this.rawPending - 1)
    return true
  }

  /** Record everything queued and sum up the closed segments (until `deadline`); true = all done. */
  drain(deadline = Infinity): boolean {
    while (this.queue.length) if (!this.take(deadline) || performance.now() > deadline) return !this.queue.length && this.processor.finishCloses(deadline)
    this.processor.endLate(Date.now())
    return this.processor.finishCloses(deadline)
  }

  /** Tests: the queue recorded (closed segments not summed up), then the segment records held in memory. */
  heldSegments(place?: PlaceKey): JSegment[] {
    while (this.queue.length) if (!this.take()) break
    return this.processor.heldSegs(place).map((r) => ({ ...r }))
  }

  /** Segments due to close (2 min without an event) close on one timer to the next due time. */
  private armDue(): void {
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.dueTimer = null
    const next = this.processor.closeDue(Date.now())
    if (this.processor.waiting && !this.flushTimer) this.flushTimer = setTimeout(() => this.writeOut(), FLUSH_MS)
    if (next === null || !this.on) return
    this.dueTimer = setTimeout(
      () => {
        this.dueTimer = null
        // the queue first (in slices; the slice closes what is due after it)
        if (this.queue.length) return this.schedule()
        const t0 = performance.now()
        this.armDue()
        // the segments due are summed up in slices
        if (this.processor.closingCount) this.schedule()
        noteTask(this.stats, 'due', t0)
      },
      Math.max(50, next - Date.now()),
    )
  }

  /**
   * Record what is queued in slices, the page idle in between (a prune, a settle or a wipe waits for the queue like
   * the scheduler does — never one long task the size of the backlog); true once nothing is left.
   */
  async drainInSlices(): Promise<void> {
    for (;;) {
      const t0 = performance.now()
      const done = this.drain(t0 + (this.hidden() ? HIDDEN_SLICE : VISIBLE_SLICE))
      noteTask(this.stats, 'drain', t0)
      if (done || !this.on) return
      await idleTask()
    }
  }

  /** Write what waits (the queue first, in slices). */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    await this.drainInSlices()
    try {
      await this.processor.flush()
    } catch (e) {
      console.warn('[recorder] journal write failed', e)
      throw e
    }
  }

  /**
   * Wipe a scope's journal and pins (the Data line's "erase the tape", the test seam): what waits is written first,
   * then every record and pin of the scope goes, its key is forgotten and — the scope of this tab — nothing in memory
   * refers to them any more (open segments, the identity chain, digests).
   */
  async wipe(scope: Scope): Promise<void> {
    await this.flush().catch(() => undefined)
    await wipeScope(scope)
    forgetScopeKey(scope)
    if (scope === scopeNow()) this.processor.reset()
    emitReset(scope)
  }

  /**
   * Flush and close segments (all, or a writer's: its segmentation key, run key, writer key or lane). `causes`: also
   * the derived ones (automation, autofill, kit, a synced copy) whose cause chain names that writer — the eject plans
   * a writer with what its writes caused.
   */
  async settle(writer?: string, opts?: { causes?: boolean }): Promise<void> {
    await this.drainInSlices()
    const own = (s: JSegment) => s.sk === writer || s.r === writer || s.w === writer || s.l === writer
    const caused = (s: JSegment) => {
      const cause = s.cause ?? parseWriterKey(s.w).cause
      return !!cause && causeChain(cause).some((k) => k === writer || runKeyOf(k) === writer || laneOf(k) === writer)
    }
    this.processor.closeAll(Date.now(), writer ? (s) => own(s) || (!!opts?.causes && caused(s)) : undefined)
    await this.flush()
    this.armDue()
  }

  async recover(scope = scopeNow()): Promise<Awaited<ReturnType<typeof recoverScope>>> {
    await openJournal()
    return recoverScope(scope, this.tab, this.memory).catch((e) => {
      console.warn('[recorder] recovery failed', e)
      return { closed: 0, exact: 0, partial: 0, tails: 0 }
    })
  }

  /** The start-up recovery of a scope (started on the first slice). */
  recovered(scope = scopeNow()): Promise<Awaited<ReturnType<typeof recoverScope>>> {
    let p = this.recovering.get(scope)
    if (!p) {
      p = this.recover(scope)
      this.recovering.set(scope, p)
    }
    return p
  }

  /** Tests: the tab dies here — no more recording, nothing closed or written, the lock held until the page goes. */
  crash(): void {
    this.on = false
    this.offs.forEach((f) => f())
    this.offs = []
    for (const t of [this.flushTimer, this.dueTimer, this.pruneTimer]) if (t) clearTimeout(t)
  }

  async prune(now = Date.now()): Promise<Awaited<ReturnType<typeof pruneRetention>>> {
    if (this.pruneTimer) clearTimeout(this.pruneTimer)
    this.pruneTimer = this.on ? setTimeout(() => void this.prune(), PRUNE_EVERY) : null
    await this.flush().catch(() => undefined)
    // between two flushes: never while one stores pins whose segments are not written yet
    const res = await this.processor
      .exclusive(() => pruneRetention(now, this.pruneOpts()))
      .catch((e) => {
        console.warn('[recorder] prune failed', e)
        return { ops: 0, segs: 0, pins: 0 }
      })
    this.budget.freed()
    if (res.ops || res.segs || res.pins) emitReset(null)
    return res
  }
}

function ringStats(ring: Float64Array, total: number): { p50: number; p95: number; max: number; n: number } {
  const n = Math.min(total, ring.length)
  if (!n) return { p50: 0, p95: 0, max: 0, n: 0 }
  const xs = Array.from(ring.subarray(0, n)).sort((a, b) => a - b)
  return { p50: xs[Math.floor(n * 0.5)], p95: xs[Math.min(n - 1, Math.floor(n * 0.95))], max: xs[n - 1], n: total }
}

let current: Recorder | null = null

/** Start recording this tab's store writes (idempotent). Returns stop. */
export function startRecorder(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (!current) {
    current = new Recorder()
    current.start()
  }
  return () => void stopRecorder()
}

export async function stopRecorder(): Promise<void> {
  const r = current
  current = null
  await r?.stop()
}

/** The running recorder (seam, deck). */
export const recorder = (): Recorder | null => current
