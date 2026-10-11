/**
 * The idle processor: everything the store listener did not do. Per queued update, in order: diff
 * (pages from the shared diff or one scan, databases by reference), places (a page or row; a changed
 * database → its schema place and its changed views), classification (ignored-only changes drop out),
 * the identity chain (an unseen change between two updates of an open segment closes it; the next one
 * starts with GAP), segments (one writer's uninterrupted stretch on one place) and folds (typing → one
 * event per page per 30 s), pins for opening segments (from the frozen `prev`), records with their
 * digests, closing segments (left + touched), and the flush: pins first, then ONE `one-recorder`
 * transaction (histograms and counters read-modified-written inside it).
 */
import type { Database, ID, Page, View } from '../../../store/types'
import { formatWriterKey, type RunNote, type Writer } from '../../../store/writer'
import { pageChanges, peekPageChanges, databaseChanges } from '../../../store/store'
import { newId } from '../../../lib/ids'
import { placeCanon, wholeCanon, partsKey, type BlockCanon, type PlaceObject } from '../model/canon'
import { classifyPage, placeKindOf } from '../model/places'
import { databaseChangesDetail } from '../model/schema'
import { touchedParts } from '../model/touched'
import { contentDelta } from '../model/counts'
import { foldsTyping, isCopyKey, isHumanSeg, laneOf, parseWriterKey, runKeyOf, segKeyOf } from '../model/writerKeys'
import { F, K, type JEvent, type JOp, type JSegment, type LaneKey, type LeftHash, type PlaceKey, type PlaceKind, type Scope } from '../model/types'
import { resolvePending, type Pending } from './attribute'
import { deps } from './deps'
import { digestLeft, digestPart, digestWhole } from './key'
import { dayKey, HI, journalIfOpen, pad13, pad8, type Batch, type Bump, type Journal, type StoreName } from './db'
import { dropMemoryPins, pagePin, pinDefsDb, schemaPin, storePins } from './pins'
import { stable } from '../model/schema'
import { RunBook } from './runs'
import type { PinInput } from '../../history/pins'

export const SEG_IDLE = 2 * 60_000
export const FOLD_MS = 30_000
const MAX_OPEN = 5000
const LAST_LH_MAX = 20_000
/** a flush hands its work over in pieces: pins per write, strings per signing round, a yield after this long */
const PIN_CHUNK = 200
const PIN_CHUNK_BYTES = 2_000_000
const DIGEST_CHUNK = 500
const YIELD_MS = 12
/** records per transaction of a big flush (writeInParts) */
const TX_RECORDS = 1500

/**
 * Go on when the page is idle (a visible tab: requestIdleCallback, the person's frames first), else in the next task
 * (a hidden tab: a MessageChannel, not throttled like a timer).
 */
export function idleTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden' && typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 1000 })
      return
    }
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(0)
  })
}

/** A queued store update (from the listener), or a run note. */
export interface QItem {
  v: string
  at: number
  scope: Scope
  order?: boolean
  w?: Writer
  pending?: Pending
  pairs?: Array<[ID, Page | undefined, Page | undefined]>
  maps?: { next: Record<ID, Page>; prev: Record<ID, Page> }
  dbsNext?: Record<ID, Database>
  dbsPrev?: Record<ID, Database>
  /** system writes: the open places that moved — [place, prev, next] (pages: Page, schema: Database, views: View) */
  sys?: Array<[PlaceKey, unknown, unknown]>
  /** the databases of a system write (for row canon) */
  sysDbs?: { next: Record<ID, Database>; prev: Record<ID, Database> }
  /** a system write while updates still waited: its places are picked when it is processed */
  sysMaps?: SysMaps
  note?: RunNote
  /** a Vorgang being recorded across slices (a big one: an import, a restore) */
  prep?: Prep
}

type Pair = [ID, Page | undefined, Page | undefined]

/** Where the recording of a Vorgang stands: its writer, its places (pages first, then schema / views), the next one. */
interface Prep {
  wk: string
  pairs: Pair[]
  dbPlaces: PlaceChange[]
  dbsNext: Record<ID, Database>
  dbsPrev: Record<ID, Database>
  i: number
  op: JOp | null
}

/** How many places a slice records between two looks at the clock. */
const CLOCK_EVERY = 16

interface OpenEv {
  rec: JEvent
  op: JOp
  /** the page before this event (content words since) */
  basePage?: Page
  words: [number, number]
  /** its digest job while no flush took it (a fold replaces the object instead of adding a job) */
  job?: Job
}

interface Open {
  rec: JSegment
  first: PlaceObject | null
  /** the raw next object (identity chain) */
  last: unknown
  lastObj: PlaceObject | null
  ev: OpenEv | null
}

/**
 * A digest to make at the flush: of the object a record names (the canonical string is built then — a job holds the
 * frozen object, never a copy of the page's text).
 */
type Job =
  | { t: 'ev'; rec: JEvent; seg: JSegment; obj: PlaceObject | null; taken?: true }
  | { t: 'open'; seg: JSegment; obj: PlaceObject | null }
  | { t: 'close'; seg: JSegment; obj: PlaceObject | null; isNew: boolean }

interface PinJob {
  seg: JSegment
  input: PinInput
  /** the content's rough size (counted once, while paused) */
  size?: number
}

/** While recording is paused (records wait in memory): at most this many Vorgänge, events, pins (and bytes of pins). */
const PAUSED_OPS = 20_000
const PAUSED_EVENTS = 60_000
const PAUSED_PINS = 2_000
const PAUSED_PIN_BYTES = 64 * 1024 * 1024
/** places deleted for good that this tab remembers (their pins never come back) */
const PURGED_MAX = 5_000
/** an event with these flags is its own: typing never folds into it, and it never folds into typing */
const NO_FOLD = F.BATCH | F.ORDER

export interface Stats {
  hot: number[]
  idleDiffScans: number
  sliceMax: number
  /** the longest stretch of the recorder's own work in one go: a slice, a timer, a part of a flush between awaits */
  taskMax: number
  /** stretches over 50 ms (≤ 20): when (performance.now), how long, what */
  long: Array<{ at: number; ms: number; what: string }>
}

/** A stretch of the recorder's own work ends now (`t0` = its start): kept in the stats; returns now. */
export function noteTask(stats: Stats, what: string, t0: number): number {
  const now = performance.now()
  const ms = now - t0
  if (ms > stats.taskMax) stats.taskMax = ms
  if (ms > 50 && stats.long.length < 20) stats.long.push({ at: Math.round(t0), ms: Math.round(ms), what })
  return now
}

/** How the flush may write (budget.ts): false = recording is paused (nothing written, records wait). */
export interface FlushGate {
  allowed(): Promise<boolean>
  /** a write failed for lack of room: free some (one day) — true when something was freed */
  onQuota(): Promise<boolean>
  /** bytes written by this flush (counters) */
  wrote(bytes: number): void
  /** the scope's copy is going away (team device wipe): drop its items */
  forgetting(scope: Scope): boolean
}

const placeObj = (pk: PlaceKind, raw: unknown, dbs: Record<ID, Database> | undefined): PlaceObject | null => {
  if (!raw) return null
  if (pk === 'schema') return { kind: 'schema', db: raw as Database }
  if (pk === 'view') return { kind: 'view', view: raw as View }
  const page = raw as Page
  return page.databaseId ? { kind: 'row', page, db: dbs?.[page.databaseId] } : { kind: 'page', page }
}

/** The person (or an Undo) deleted a page, a row or a database for good: its before-images go (F13). */
const purges = (pl: { p: PlaceKey }, lane: LaneKey): boolean => (lane === 'you' || lane === 'undo') && (pl.p.startsWith('p:') || pl.p.startsWith('s:'))

/** The two states of a system write (the open places that moved are picked from them). */
export interface SysMaps {
  pagesNext: Record<ID, Page>
  pagesPrev: Record<ID, Page>
  dbsNext: Record<ID, Database>
  dbsPrev: Record<ID, Database>
  pagesMoved: boolean
  dbsMoved: boolean
}

const pkOfPlace = (p: PlaceKey, raw: unknown): PlaceKind => (p.startsWith('s:') ? 'schema' : p.startsWith('v:') ? 'view' : placeKindOf(raw as Page))

interface PlaceChange {
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  prevRaw: unknown
  nextRaw: unknown
  prevObj: PlaceObject | null
  nextObj: PlaceObject | null
  kinds: number
  f: number
  pc?: number
  mv?: [ID | null, ID | null]
  x?: JEvent['x']
  ignoredOnly: boolean
  prevDbs?: Record<ID, Database>
}

export class Processor {
  scope: Scope | null = null
  /** open segments, least recently written first (eviction takes the first) */
  readonly open = new Map<PlaceKey, Open>()
  /** segments closed but not yet summed up (what their writer left, the parts they touched): done in slices */
  private closing = new Map<PlaceKey, Open>()
  readonly runs = new RunBook(() => this.tab)
  /** places whose next segment starts after an unseen change */
  private gapNext = new Set<PlaceKey>()
  /** runs that wrote after their end without saying they go on (no noteRun): they end again once the queue is drained */
  private late = new Set<string>()
  /** this tab's last whole digest per place (LRU) */
  private lastLh = new Map<PlaceKey, string>()
  private mcpClients = new Map<string, string>()
  private vCount = 0

  // waiting for the flush
  private ops = new Map<string, JOp>()
  private events = new Map<string, JEvent>()
  private segs = new Map<string, JSegment>()
  private jobs: Job[] = []
  private pins: PinJob[] = []
  private minutes = new Map<string, Record<LaneKey, number>>()
  private quarters = new Map<string, Record<LaneKey, number>>()
  private lanes = new Map<string, Record<LaneKey, { last: number; n: number }>>()
  /** Vorgänge per day size record (`<scope>|d|<day>`) */
  private counted = new Map<string, number>()
  /** places deleted for good, to purge after the next write (`at`: when — a segment that began later is not theirs) */
  private purge: Array<{ s: Scope; p: PlaceKey; at: number }> = []
  private lostTail: { s: Scope; from: number; to: number } | null = null
  /** the size each record had when it was last written (a re-put counts only what it grew by) */
  private sizes = new WeakMap<object, number>()
  private runSizes = new Map<string, number>()
  /** the segments of the flush under way (taken from `segs`, not in the journal yet) */
  private inFlight: Map<string, JSegment> | null = null
  /** places the person deleted for good (`p:` and `s:`): no pin of theirs is written any more */
  private purged = new Set<PlaceKey>()
  /** an endRun was seen: flush right away */
  urgent = false
  lastFlush = 0
  /** the scopes this tab keeps a tab record in (`<scope>|tab|<tab>`), with the record's start */
  private tabScopes = new Map<Scope, number>()
  /** the tab is being left (page hide) with everything recorded: every flush from here marks it clean */
  private leaving = false
  /** Vorgänge in the flush under way (not in the journal yet) */
  private inFlightOps = 0
  /**
   * The tab records say "clean": everything this tab recorded is in the journal (a flush that left nothing waiting).
   * The first store update after that marks them dirty again — one put, right after the update — so a tab that dies
   * with records in memory always leaves a lost tail, and one that dies with none never does (a closing tab need not
   * write anything).
   */
  recordClean = false
  /** store updates the recorder queued (the flush compares: none came while it wrote) */
  seen = 0
  private flushing: Promise<void> = Promise.resolve()
  /** records waiting for the flush */
  get waiting(): number {
    return this.ops.size + this.events.size + this.segs.size + this.pins.length
  }
  /** digests waiting for the flush */
  get jobCount(): number {
    return this.jobs.length
  }

  /**
   * Segments not in the journal yet (open, being summed up, waiting, or in the flush under way): a prune leaves their
   * pins alone — they are on their way, not orphans — and never marks them partial behind this tab's back.
   */
  liveSegIds(): Set<string> {
    const out = new Set<string>(this.segs.keys())
    for (const k of this.inFlight?.keys() ?? []) out.add(k)
    for (const o of this.open.values()) out.add(o.rec.id)
    for (const o of this.closing.values()) out.add(o.rec.id)
    for (const p of this.pins) out.add(p.seg.id)
    return out
  }

  /** The segment records this tab holds in memory (open, being summed up, waiting, in a flush) — of a place, or all. */
  heldSegs(place?: PlaceKey): JSegment[] {
    const out = new Map<string, JSegment>()
    const add = (r: JSegment) => {
      if (!place || r.p === place) out.set(r.id, r)
    }
    for (const r of this.segs.values()) add(r)
    for (const r of this.inFlight?.values() ?? []) add(r)
    for (const o of this.open.values()) add(o.rec)
    for (const o of this.closing.values()) add(o.rec)
    return [...out.values()]
  }

  /** Run `fn` between two flushes (prunes: never while a flush stores pins or segments). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.flushing.then(fn)
    this.flushing = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  /** segments still to be summed up (finishCloses) */
  get closingCount(): number {
    return this.closing.size
  }

  constructor(
    readonly tab: string,
    private journal: () => Promise<Journal>,
    private gate: FlushGate,
    readonly stats: Stats,
    /** store updates still in the recorder's queue (not processed yet) */
    private queued: () => number = () => 0,
  ) {}

  /* ---------------------------------------------------------------- */
  /* processing                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Record one queued item; false = it is not done yet (a big Vorgang stops at `deadline` and goes on in the next
   * slice — the caller puts it back at the head of the queue).
   */
  process(it: QItem, deadline = Infinity): boolean {
    if (it.note) {
      this.note(it.note, it.at)
      return true
    }
    if (this.gate.forgetting(it.scope)) return true
    if (!it.prep) {
      if (this.scope !== it.scope) {
        this.closeAll(it.at)
        this.scope = it.scope
      }
      if (it.sysMaps) {
        const m = it.sysMaps
        it.sysMaps = undefined
        it.sys = this.sysPlaces(m)
        it.sysDbs = { next: m.dbsNext, prev: m.dbsPrev }
      }
      if (it.sys) {
        this.system(it)
        return true
      }
      const pairs = it.pairs ?? this.diffPages(it.maps)
      const dbsNext = it.dbsNext ?? {}
      const dbsPrev = it.dbsPrev ?? dbsNext
      const dbPlaces = dbsNext !== dbsPrev ? this.dbPlacesOf(dbsNext, dbsPrev) : []
      const w = it.w ?? resolvePending(it.pending ?? { agent: false, ai: false, stack: '' }, pairs, [...pairs.map(([id]) => `p:${id}`), ...dbPlaces.map((p) => p.p)])
      // a fallback is never system, and a system frame never reaches here (the listener queues open places only)
      if (w.kind === 'system') return true
      it.prep = { wk: formatWriterKey(w), pairs, dbPlaces, dbsNext, dbsPrev, i: 0, op: null }
    }
    return this.record(it, it.prep, deadline)
  }

  private diffPages(maps: QItem['maps']): Array<[ID, Page | undefined, Page | undefined]> {
    if (!maps) return []
    let c = peekPageChanges(maps.next, maps.prev)
    if (!c) {
      this.stats.idleDiffScans++
      c = pageChanges(maps.next, maps.prev)
    }
    const out: Array<[ID, Page | undefined, Page | undefined]> = c.changed.map((id) => [id, maps.prev[id], maps.next[id]])
    for (const id of c.removed) out.push([id, maps.prev[id], undefined])
    return out
  }

  /** A page or row of the Vorgang as a place change (classified). */
  private pagePlace([id, a, b]: Pair, dbsNext: Record<ID, Database>, dbsPrev: Record<ID, Database>): PlaceChange {
    const page = (b ?? a)!
    const pk = placeKindOf(page)
    const dbId = page.databaseId ?? (pk === 'db' ? id : undefined)
    const cls = classifyPage(a, b, deps, (b?.databaseId ? dbsNext[b.databaseId] : undefined) ?? (a?.databaseId ? dbsPrev[a.databaseId] : undefined))
    return {
      p: `p:${id}`,
      pk,
      ...(dbId ? { db: dbId } : {}),
      prevRaw: a,
      nextRaw: b,
      prevObj: placeObj(pk, a, dbsPrev),
      nextObj: placeObj(pk, b, dbsNext),
      kinds: cls.kinds,
      f: cls.f,
      ...(cls.pc ? { pc: cls.pc } : {}),
      ...(cls.mv ? { mv: cls.mv } : {}),
      ignoredOnly: cls.ignoredOnly,
      prevDbs: dbsPrev,
    }
  }

  /** The schema and view places of the databases that changed. */
  private dbPlacesOf(dbsNext: Record<ID, Database>, dbsPrev: Record<ID, Database>): PlaceChange[] {
    const out: PlaceChange[] = []
    const c = databaseChanges(dbsNext, dbsPrev)
    for (const id of [...c.changed, ...c.removed]) {
      const a = dbsPrev[id]
      const b = dbsNext[id]
      const d = databaseChangesDetail(a, b)
      const sp: PlaceKey = `s:${id}`
      out.push({
        p: sp,
        pk: 'schema',
        db: id,
        prevRaw: a,
        nextRaw: b,
        prevObj: a ? { kind: 'schema', db: a } : null,
        nextObj: b ? { kind: 'schema', db: b } : null,
        kinds: d.kinds,
        f: !a ? F.NEW : !b ? F.GONE : 0,
        ...(d.schema?.length ? { x: d.schema } : {}),
        ignoredOnly: !d.kinds,
        prevDbs: dbsPrev,
      })
      if (!a || !b) continue
      for (const vc of d.views) {
        const va = a.views.find((v) => v.id === vc.id)
        const vb = b.views.find((v) => v.id === vc.id)
        out.push({
          p: `v:${id}/${vc.id}`,
          pk: 'view',
          db: id,
          prevRaw: va,
          nextRaw: vb,
          prevObj: va ? { kind: 'view', view: va } : null,
          nextObj: vb ? { kind: 'view', view: vb } : null,
          kinds: K.VIEW,
          f: (!va ? F.NEW : 0) | (!vb ? F.GONE : 0) | (vc.layout ? F.LAYOUT : 0),
          x: [vc.delta],
          ignoredOnly: false,
          prevDbs: dbsPrev,
        })
      }
      // views that did not change: their open segments follow the new database object silently
    }
    return out
  }

  /**
   * The identity chain of an open segment: the place's `prev` must be what the segment last saw. An unseen
   * change that is no change of the place (stamps, an editor's ids) moves the chain on; any other closes
   * the segment (its writer's left = what it last saw) and the next segment starts with GAP.
   */
  private chain(pl: PlaceChange, at: number): Open | undefined {
    const o = this.open.get(pl.p)
    if (!o) return undefined
    if (pl.prevRaw !== o.last) {
      if (partsKey(o.lastObj, deps) !== partsKey(pl.prevObj, deps)) {
        this.close(o, at)
        this.gapNext.add(pl.p)
        return undefined
      }
      // stamps, ids, a cache: the chain moves on
      o.last = pl.prevRaw
      o.lastObj = pl.prevObj
    }
    return o
  }

  /** The open segment saw this update (its writer's own, or a change of nothing that counts). */
  private follow(o: Open | undefined, pl: PlaceChange): void {
    if (!o) return
    o.last = pl.nextRaw
    o.lastObj = pl.nextObj
  }

  /** The open places a system write moved: [place, prev, next] (pages: Page, schema: Database, views: View) — O(open). */
  sysPlaces(m: SysMaps): Array<[PlaceKey, unknown, unknown]> {
    const sys: Array<[PlaceKey, unknown, unknown]> = []
    for (const p of this.open.keys()) {
      if (p.startsWith('p:')) {
        if (!m.pagesMoved) continue
        const id = p.slice(2)
        const a = m.pagesPrev[id]
        const b = m.pagesNext[id]
        if (a !== b) sys.push([p, a, b])
      } else if (m.dbsMoved) {
        const [db, view] = p.slice(2).split('/')
        const a: Database | undefined = m.dbsPrev[db]
        const b: Database | undefined = m.dbsNext[db]
        if (a === b) continue
        if (p.startsWith('s:')) sys.push([p, a, b])
        else {
          const va = a?.views.find((v) => v.id === view)
          const vb = b?.views.find((v) => v.id === view)
          if (va !== vb) sys.push([p, va, vb])
        }
      }
    }
    return sys
  }

  /**
   * A system write: only the open places that moved, for the identity chain. Bookkeeping (a worker's heartbeat, a
   * live git line, the memory log's back-links, a load request taken) is no unseen change: One made it on purpose next
   * to the writer's work, so the open segment follows it (its writer left the place with it) — never a close, never GAP.
   */
  private system(it: QItem): void {
    const dbs = it.sysDbs
    const known = it.w?.kind === 'system' && it.w.why === 'bookkeeping'
    for (const [p, a, b] of it.sys ?? []) {
      const pk = pkOfPlace(p, b ?? a)
      let ignoredOnly = true
      if (pk === 'page' || pk === 'row' || pk === 'db') ignoredOnly = classifyPage(a as Page | undefined, b as Page | undefined, deps).ignoredOnly
      else ignoredOnly = partsKey(placeObj(pk, a, dbs?.prev), deps) === partsKey(placeObj(pk, b, dbs?.next), deps)
      const pl: PlaceChange = { p, pk, prevRaw: a, nextRaw: b, prevObj: placeObj(pk, a, dbs?.prev), nextObj: placeObj(pk, b, dbs?.next), kinds: 0, f: 0, ignoredOnly }
      const o = this.chain(pl, it.at)
      if (!o) continue
      if (ignoredOnly || known) this.follow(o, pl)
      else {
        // a system write changed the place (another tab's save): the segment ends with what its writer left
        this.close(o, it.at)
        this.gapNext.add(p)
      }
    }
  }

  /** Record the Vorgang's places from `prep.i` on; false = stopped at the deadline (`prep` keeps where). */
  private record(it: QItem, prep: Prep, deadline: number): boolean {
    const scope = it.scope
    const at = it.at
    const wk = prep.wk
    const parsed = parseWriterKey(wk)
    const sk = segKeyOf(wk)
    const lane = laneOf(wk, (s) => this.mcpClients.get(s))
    const run = runKeyOf(wk) ?? undefined
    const copy = isCopyKey(wk)
    const undo = lane === 'undo'
    const folds = foldsTyping(wk, sk)
    let op: JOp | null = prep.op
    const baseF = (copy ? F.COPY : 0) | (undo ? F.UNDO : 0) | (it.order ? F.ORDER : 0) | (parsed.mixed ? F.BATCH : 0)
    const total = prep.pairs.length + prep.dbPlaces.length
    // a write after its run's end (endRun closed the run's segments): the run goes on — its writes from here are one
    // stretch per place again, and it ends again when the queue is drained (endLate)
    if (run && this.runs.isEnded(run)) {
      this.runs.reopen(run)
      this.late.add(run)
    }

    for (; prep.i < total; prep.i++) {
      if (prep.i % CLOCK_EVERY === CLOCK_EVERY - 1 && performance.now() > deadline) {
        prep.op = op
        return false
      }
      const pl = prep.i < prep.pairs.length ? this.pagePlace(prep.pairs[prep.i], prep.dbsNext, prep.dbsPrev) : prep.dbPlaces[prep.i - prep.pairs.length]
      let seg: Open | undefined = this.chain(pl, at)
      if (pl.ignoredOnly) {
        this.follow(seg, pl)
        continue
      }
      if (seg && (seg.rec.sk !== sk || (isHumanSeg(sk) && at - seg.rec.to >= SEG_IDLE))) {
        this.close(seg, at)
        seg = undefined
      }
      this.follow(seg, pl)
      // typing: fold into the open event — never a refresh that carried someone else's change too (BATCH: it stays its
      // own, flagged event) or a pair out of order, and nothing folds into such an event either
      const textOnly = (pl.kinds & ~(K.CONTENT | K.TITLE)) === 0
      const plain = !(baseF & NO_FOLD) && !((seg?.ev?.rec.f ?? 0) & NO_FOLD)
      if (seg?.ev && folds && plain && textOnly && (seg.ev.rec.kinds & ~(K.CONTENT | K.TITLE)) === 0 && at - seg.ev.rec.at < FOLD_MS && !pl.f) {
        this.fold(seg, pl, at)
        continue
      }
      if (!seg) seg = this.openSeg(pl, scope, at, wk, sk, lane, run, parsed.cause)
      if (!op) {
        op = { k: `${scope}|${pad13(at)}|${it.v}`, s: scope, at, v: it.v, w: wk, l: lane, ...(run ? { r: run } : {}), n: 0, kinds: 0, p1: pl.p, ops: 1, ...(baseF ? { f: baseF } : {}) }
        this.ops.set(op.k, op)
      }
      const i = op.n++
      op.kinds |= pl.kinds
      // (a big Vorgang goes on across slices: the op is written again with every flush that has more of it)
      this.ops.set(op.k, op)
      const delta = pl.kinds & K.CONTENT ? contentDelta((pl.prevRaw as Page | undefined)?.content, (pl.nextRaw as Page | undefined)?.content, deps) : null
      const f = baseF | pl.f | (seg.rec.n === 0 ? seg.rec.f & F.GAP : 0)
      const ev: JEvent = {
        k: `${scope}|${pad13(at)}|${it.v}|${i}`,
        s: scope,
        at,
        v: it.v,
        w: wk,
        l: lane,
        ...(run ? { r: run } : {}),
        ...(parsed.change ? { c: parsed.change } : {}),
        p: pl.p,
        pk: pl.pk,
        ...(pl.db ? { db: pl.db } : {}),
        kinds: pl.kinds,
        ...(f ? { f } : {}),
        ops: 1,
        ...(delta && (delta.wa || delta.wd) ? { wa: delta.wa, wd: delta.wd } : {}),
        ...(delta && (delta.bc[0] || delta.bc[1] || delta.bc[2]) ? { bc: delta.bc } : {}),
        ...(pl.pc ? { pc: pl.pc } : {}),
        g: seg.rec.id,
        lh: '',
        ...(pl.x ? { x: pl.x } : {}),
        ...(pl.mv ? { mv: pl.mv } : {}),
      }
      this.events.set(ev.k, ev)
      this.touch(seg)
      seg.rec.n++
      seg.rec.to = at
      seg.rec.lastLh = ''
      const job: Job = { t: 'ev', rec: ev, seg: seg.rec, obj: pl.nextObj }
      seg.ev = { rec: ev, op, basePage: pl.prevRaw as Page | undefined, words: delta ? [delta.wa, delta.wd] : [0, 0], job }
      this.segs.set(seg.rec.id, seg.rec)
      this.jobs.push(job)
      if (run && !copy) this.runs.noteEvent(scope, run, ev, delta ? [delta.wa, delta.wd] : [0, 0])
      // the place is gone: nothing more can happen to it
      if (pl.f & F.GONE) {
        if (purges(pl, lane)) this.purgePlace(scope, pl.p, at)
        this.close(seg, at)
      } else if (pl.f & F.NEW) this.purged.delete(pl.p)
    }
    prep.op = op
    if (!op) return true
    if (run && !copy) this.runs.noteOp(scope, run, at)
    if (!copy) this.count(scope, lane, at)
    return true
  }

  /** An open segment just got an event: it is the most recently written (the eviction order). */
  private touch(o: Open): void {
    if (this.open.get(o.rec.p) !== o) return
    this.open.delete(o.rec.p)
    this.open.set(o.rec.p, o)
  }

  private fold(seg: Open, pl: PlaceChange, at: number): void {
    const e = seg.ev!
    e.rec.ops++
    e.rec.t2 = at
    e.rec.kinds |= pl.kinds
    e.op.ops++
    e.op.t2 = at
    e.op.kinds |= pl.kinds
    if (pl.kinds & K.CONTENT || e.rec.kinds & K.CONTENT) {
      const d = contentDelta(e.basePage?.content, (pl.nextRaw as Page | undefined)?.content, deps)
      if (e.rec.r && !((e.rec.f ?? 0) & F.COPY)) this.runs.noteEvent(e.rec.s, e.rec.r, e.rec, [d.wa - e.words[0], d.wd - e.words[1]])
      e.words = [d.wa, d.wd]
      if (d.wa || d.wd) {
        e.rec.wa = d.wa
        e.rec.wd = d.wd
      } else {
        delete e.rec.wa
        delete e.rec.wd
      }
      if (d.bc[0] || d.bc[1] || d.bc[2]) e.rec.bc = d.bc
      else delete e.rec.bc
    }
    seg.rec.to = at
    this.touch(seg)
    this.events.set(e.rec.k, e.rec)
    this.ops.set(e.op.k, e.op)
    this.segs.set(seg.rec.id, seg.rec)
    // one digest job per event while no flush took it: the fold only moves it to the newest state
    if (e.job?.t === 'ev' && !e.job.taken) e.job.obj = pl.nextObj
    else {
      e.job = { t: 'ev', rec: e.rec, seg: seg.rec, obj: pl.nextObj }
      this.jobs.push(e.job)
    }
  }

  /**
   * The person deleted a place for good (a page or row, or a database's schema): its pins go after the next write,
   * none is taken for it any more, and a database's view segments still open close (their pins go with the schema's).
   */
  private purgePlace(scope: Scope, p: PlaceKey, at: number): void {
    this.purge.push({ s: scope, p, at })
    this.purged.add(p)
    if (this.purged.size > PURGED_MAX) this.purged.delete(this.purged.values().next().value as PlaceKey)
    // the place's segments this tab still holds (open, or closed and not summed up yet) read purged from now on —
    // whichever flush writes them, also after this tab forgot the place (PURGED_MAX) or it was made again
    for (const o of [this.open.get(p), this.closing.get(p)])
      if (o) {
        o.rec.f |= F.PURGED
        o.rec.before = null
      }
    if (!p.startsWith('s:')) return
    const views = `v:${p.slice(2)}/`
    for (const o of [...this.open.values()])
      if (o.rec.p.startsWith(views)) {
        o.rec.f |= F.PURGED
        this.close(o, at)
      }
  }

  /** A place deleted for good (a view: its database's schema): its pins are not written. */
  private isPurged(p: PlaceKey): boolean {
    if (this.purged.has(p)) return true
    return p.startsWith('v:') && this.purged.has(`s:${p.slice(2, p.indexOf('/'))}`)
  }

  private openSeg(pl: PlaceChange, scope: Scope, at: number, wk: string, sk: string, lane: LaneKey, run: string | undefined, cause: string | undefined): Open {
    // a segment of this place still being summed up: done first (its left comes before this one's start)
    const pending = this.closing.get(pl.p)
    if (pending) this.finishClose(pending)
    if (this.open.size >= MAX_OPEN) {
      const oldest = this.open.values().next().value as Open | undefined
      if (oldest) this.close(oldest, at)
    }
    const id = `${scope}|${newId()}`
    let f = 0
    if (!pl.prevRaw) f |= F.NEW
    if (this.gapNext.delete(pl.p)) f |= F.GAP
    if (isCopyKey(wk)) f |= F.COPY
    const purged = !!(pl.f & F.GONE) && purges(pl, lane)
    if (purged) f |= F.PURGED
    const rec: JSegment = {
      id,
      s: scope,
      p: pl.p,
      pk: pl.pk,
      ...(pl.db ? { db: pl.db } : {}),
      w: wk,
      sk,
      l: lane,
      ...(run ? { r: run } : {}),
      ...(cause ? { cause } : {}),
      from: at,
      to: at,
      n: 0,
      before: null,
      bh: '',
      left: null,
      lastLh: '',
      touched: [],
      tab: this.tab,
      o: 1,
      f,
    }
    // the pin: the exact state before this segment's first Vorgang (never for a new place or a purge)
    if (pl.prevRaw && !purged) {
      if (pl.pk === 'schema' || pl.pk === 'view') {
        const db = pl.prevDbs?.[pl.db ?? '']
        if (db) this.pins.push({ seg: rec, input: { place: pl.p, meta: schemaPin(db, at, id) } })
      } else {
        const page = pl.prevRaw as Page
        // a row's definitions: its database as it was right before this update — plus what THIS writer took out of
        // the schema earlier in its stretch (an option removed, then the values cleared row by row, still reads with
        // the option); nothing the database had then is left out
        const own = page.databaseId ? this.open.get(`s:${page.databaseId}`) : undefined
        const ownDb = own && own.rec.sk === sk && own.first?.kind === 'schema' ? own.first.db : undefined
        const { meta, content } = pagePin(page, pinDefsDb(pl.prevDbs?.[page.databaseId ?? ''], ownDb), at, id)
        this.pins.push({ seg: rec, input: { place: pl.p, meta, content } })
      }
    }
    if (run) this.runs.ensure(scope, run, lane, at)
    const o: Open = { rec, first: pl.prevObj, last: pl.nextRaw, lastObj: pl.nextObj, ev: null }
    this.open.set(pl.p, o)
    this.segs.set(id, rec)
    this.jobs.push({ t: 'open', seg: rec, obj: pl.prevObj })
    return o
  }

  /**
   * Close a segment: it leaves the open set now; what its writer left (digests at the flush) and the parts it touched
   * are summed up in slices (finishCloses) — it stays marked open in the journal until then (a crash meanwhile is
   * recovered like any open segment).
   */
  close(o: Open, _at: number): void {
    if (this.open.get(o.rec.p) === o) this.open.delete(o.rec.p)
    const before = this.closing.get(o.rec.p)
    if (before && before !== o) this.finishClose(before)
    this.closing.set(o.rec.p, o)
  }

  /** Sum up a closed segment: touched parts, and the canonical state its writer left (digested at the flush). */
  private finishClose(o: Open): void {
    if (this.closing.get(o.rec.p) === o) this.closing.delete(o.rec.p)
    delete o.rec.o
    const isNew = !!(o.rec.f & F.NEW)
    o.rec.touched = isNew || !o.lastObj ? '*' : touchedParts(o.first, o.lastObj, deps)
    this.jobs.push({ t: 'close', seg: o.rec, obj: o.lastObj, isNew })
    this.segs.set(o.rec.id, o.rec)
  }

  /** Sum up closed segments until `deadline`; true = none left. */
  finishCloses(deadline = Infinity): boolean {
    let n = 0
    for (const o of this.closing.values()) {
      if (n++ % CLOCK_EVERY === CLOCK_EVERY - 1 && performance.now() > deadline) return false
      this.finishClose(o)
    }
    return true
  }

  /** Close every open segment (scope switch, settle, stop, page hide). */
  closeAll(at: number, match?: (s: JSegment) => boolean): number {
    let n = 0
    for (const o of [...this.open.values()])
      if (!match || match(o.rec)) {
        this.close(o, at)
        n++
      }
    return n
  }

  /** Close segments whose place had no event for SEG_IDLE; the next time one is due (or null). */
  closeDue(now: number): number | null {
    let next: number | null = null
    for (const o of [...this.open.values()]) {
      const due = o.rec.to + SEG_IDLE
      if (due <= now) this.close(o, now)
      else next = next === null ? due : Math.min(next, due)
    }
    return next
  }

  private note(n: RunNote, at: number): void {
    const wk = formatWriterKey(n.w)
    const run = runKeyOf(wk)
    if (n.meta?.client && n.w.kind === 'mcp') this.mcpClients.set(n.w.session, n.meta.client)
    if (!run) return
    if (n.end) this.endRunNow(run, at)
    else {
      // a run that ended goes on (a review applies its proposals later): not ended until its next end
      this.runs.reopen(run)
      this.late.delete(run)
      this.runs.meta(run, n.meta)
    }
  }

  /** A run ends: its open segments close (left and touched summed up in slices). */
  private endRunNow(run: string, at: number): void {
    this.late.delete(run)
    this.runs.end(run, at)
    this.closeAll(at, (s) => s.r === run)
    this.urgent = true
  }

  /** The queue is drained: runs that wrote after their end without going on end again (true: some did). */
  endLate(at: number): boolean {
    if (!this.late.size) return false
    for (const run of [...this.late]) this.endRunNow(run, at)
    return true
  }

  private count(scope: Scope, lane: LaneKey, at: number): void {
    const add = (m: Map<string, Record<LaneKey, number>>, key: string) => {
      const cur = m.get(key) ?? {}
      cur[lane] = (cur[lane] ?? 0) + 1
      m.set(key, cur)
    }
    add(this.minutes, `${scope}|${pad8(Math.floor(at / 60_000))}`)
    add(this.quarters, `${scope}|${pad8(Math.floor(at / 900_000))}`)
    const l = this.lanes.get(scope) ?? {}
    const cur = l[lane] ?? { last: 0, n: 0 }
    l[lane] = { last: Math.max(cur.last, at), n: cur.n + 1 }
    this.lanes.set(scope, l)
    const day = dayKey(scope, at)
    this.counted.set(day, (this.counted.get(day) ?? 0) + 1)
  }

  /** A run of the next Vorgang id. */
  nextV(): string {
    return `${this.tab}.${(this.vCount++).toString(36)}`
  }

  /* ---------------------------------------------------------------- */
  /* flush                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Write everything waiting (serialised: one flush at a time). `clean`: the tab is being left and everything is
   * recorded — the flush's own transaction marks it ended cleanly (no second write the closing tab may not finish).
   */
  flush(opts: { clean?: boolean } = {}): Promise<void> {
    const run = this.flushing.then(() => this.flushNow(opts))
    this.flushing = run.catch(() => undefined)
    return run
  }

  private async flushNow(opts: { clean?: boolean } = {}): Promise<void> {
    this.urgent = false
    if (!this.waiting && !this.jobs.length && !this.runs.dirty.size && !this.purge.length) {
      if (opts.clean || this.leaving) this.markCleanNow()
      return
    }
    // every stretch between two awaits is one piece of the recorder's work (stats.taskMax)
    let t = performance.now()
    const lap = async <T>(p: Promise<T>): Promise<T> => {
      noteTask(this.stats, 'flush', t)
      try {
        return await p
      } finally {
        t = performance.now()
      }
    }
    if (!(await lap(this.gate.allowed()))) {
      this.capWhilePaused()
      return
    }
    // take what is waiting now (processing goes on meanwhile into fresh sets)
    const ops = [...this.ops.values()]
    const events = this.events
    const segs = this.segs
    const jobs = this.jobs
    const pins = this.pins
    const minutes = this.minutes
    const quarters = this.quarters
    const lanes = this.lanes
    const counted = this.counted
    const purge = this.purge
    const lost = this.lostTail
    this.ops = new Map()
    this.events = new Map()
    this.segs = new Map()
    this.jobs = []
    this.pins = []
    this.minutes = new Map()
    this.quarters = new Map()
    this.lanes = new Map()
    this.counted = new Map()
    this.purge = []
    this.lostTail = null
    this.inFlight = segs
    this.inFlightOps = ops.length
    for (const job of jobs) if (job.t === 'ev') job.taken = true
    const runs = this.runs.takeDirty()
    const j = await lap(this.journal())
    const memory = j.mode === 'memory'
    /** bytes this flush adds per day size record (re-written records count only what they grew by) */
    const grew = new Map<string, number>()
    const addBytes = (scope: Scope, at: number, n: number) => {
      if (!n) return
      const k = dayKey(scope, at)
      grew.set(k, (grew.get(k) ?? 0) + n)
    }
    /** sizes to remember once the write landed */
    const sized: Array<[object, number]> = []
    let clean = false
    const runSized: Array<[string, number]> = []

    try {
      // 1. pins first (their bodies addressed by the exact content's digest), so a segment never names a pin that is
      // not there; in pieces of ≤ PIN_CHUNK pins / bytes — each piece its own write (pins are kept by id, a piece is
      // complete). Never a pin of a place the person deleted for good meanwhile.
      const byScope = new Map<Scope, PinJob[]>()
      for (const p of pins) if (!this.isPurged(p.input.place)) byScope.set(p.seg.s, [...(byScope.get(p.seg.s) ?? []), p])
      for (const [scope, list] of byScope) {
        let from = 0
        while (from < list.length) {
          let size = 0
          let to = from
          while (to < list.length && (to === from || (to - from < PIN_CHUNK && size < PIN_CHUNK_BYTES))) {
            const p = list[to++]
            size += approxSize(p.input.meta) + (p.input.content ? approxSize(p.input.content) : 0)
          }
          const piece = list.slice(from, to)
          from = to
          await lap(
            Promise.all(
              piece.map(async (p) => {
                // the body's address: the exact content, block ids and task ids included (contentKey would ignore them)
                if (p.input.meta.kind === 'page') p.input.meta.body = p.input.content ? await digestPart(scope, 'cx', stable(p.input.content)) : null
              }),
            ),
          )
          const kept = await lap(storePins(scope, piece.map((p) => p.input), memory))
          piece.forEach((p, i) => {
            // a segment purged while its pin was on its way keeps none (the pin goes with the place's purge)
            p.seg.before = p.seg.f & F.PURGED ? null : (kept.ids[i] ?? null)
            segs.set(p.seg.id, p.seg)
            addBytes(scope, p.input.meta.at, kept.bytes[i] ?? 0)
          })
        }
      }

      // 2. digests, in the order the records were made: each job's canonical string is built now (from the frozen
      // object it holds), signed in pieces — the page idle in between
      const digests: Array<string | LeftHash> = []
      for (let i = 0; i < jobs.length; i += DIGEST_CHUNK) {
        if (i) await lap(idleTask())
        const piece = jobs.slice(i, i + DIGEST_CHUNK)
        const inputs: Array<{ whole: string | null; parts?: Record<string, string>; blocks?: BlockCanon[] }> = []
        for (const job of piece) {
          if (performance.now() - t > YIELD_MS) await lap(idleTask())
          if (!job.obj) inputs.push({ whole: null })
          else {
            const c = placeCanon(job.obj, deps)
            inputs.push({ whole: wholeCanon(c.parts, c.blocks), parts: c.parts, blocks: c.blocks })
          }
        }
        digests.push(
          ...(await lap(
            Promise.all(
              piece.map(async (job, k) => {
                const c = inputs[k]
                if (job.t === 'ev' || job.t === 'open') return c.whole === null ? '-' : digestWhole(job.seg.s, c.whole)
                if (c.whole === null) return { h: '-', parts: {} }
                return digestLeft(job.seg.s, { parts: c.parts ?? {}, blocks: c.blocks }, c.whole, job.isNew)
              }),
            ),
          )),
        )
      }
      for (let i = 0; i < jobs.length; i++) {
        if (i % 256 === 255 && performance.now() - t > YIELD_MS) await lap(idleTask())
        const job = jobs[i]
        const d = digests[i]
        if (job.t === 'ev') {
          job.rec.lh = d as string
          job.seg.lastLh = d as string
          this.noteLh(job.seg.p, d as string)
          events.set(job.rec.k, job.rec)
        } else if (job.t === 'open') {
          job.seg.bh = d as string
          const mine = this.lastLh.get(job.seg.p)
          if (mine !== undefined && mine !== job.seg.bh && !(job.seg.f & F.NEW)) job.seg.f |= F.GAP
        } else {
          job.seg.left = d as LeftHash
          if (!job.seg.lastLh) job.seg.lastLh = (d as LeftHash).h
          this.noteLh(job.seg.p, (d as LeftHash).h)
        }
        segs.set(job.seg.id, job.seg)
      }
      // a segment of a place deleted for good meanwhile reads purged
      for (const g of segs.values())
        if (this.isPurged(g.p) && (!(g.f & F.PURGED) || g.before)) {
          g.f |= F.PURGED
          g.before = null
        }

      // 3. ONE transaction (its puts go in in pieces, journal/db.ts)
      const put = { ops: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>>, segs: [] as Array<Record<string, unknown>> }
      let n = 0
      for (const [list, into, when] of [
        [ops, put.ops, (r: JOp) => r.at],
        [events.values(), put.events, (r: JEvent) => r.at],
        [segs.values(), put.segs, (r: JSegment) => r.from],
      ] as Array<[Iterable<JOp & JEvent & JSegment>, Array<Record<string, unknown>>, (r: JOp & JEvent & JSegment) => number]>)
        for (const r of list) {
          if (n++ % 256 === 255 && performance.now() - t > YIELD_MS) await lap(idleTask())
          const copy = { ...r } as Record<string, unknown>
          const size = approxSize(copy)
          addBytes(r.s, when(r), size - (this.sizes.get(r) ?? 0))
          sized.push([r, size])
          into.push(copy)
        }
      for (const r of runs) {
        const size = approxSize(r)
        addBytes(r.s, r.from, size - (this.runSizes.get(r.id) ?? 0))
        runSized.push([r.id, size])
      }
      const batch: Batch = { put: { ...put, runs: runs as unknown as Array<Record<string, unknown>> }, bump: [] }
      const bump = batch.bump as Bump[]
      for (const [key, add] of minutes) bump.push({ store: 'minutes', key, fn: (cur) => histAdd(key, cur, add) })
      for (const [key, add] of quarters) bump.push({ store: 'quarters', key, fn: (cur) => histAdd(key, cur, add) })
      const now = Date.now()
      for (const [scope, add] of lanes)
        bump.push({
          store: 'kv',
          key: `${scope}|lanes`,
          fn: (cur) => {
            const l = { ...((cur?.lanes as Record<LaneKey, { last: number; total: number }>) ?? {}) }
            for (const [lane, v] of Object.entries(add)) l[lane] = { last: Math.max(l[lane]?.last ?? 0, v.last), total: (l[lane]?.total ?? 0) + v.n }
            return { k: `${scope}|lanes`, lanes: l }
          },
        })
      // the days' sizes: Vorgänge and the bytes this flush added (read-modify-written in the transaction — tabs never
      // lose each other's counts)
      let bytes = 0
      for (const k of new Set([...grew.keys(), ...counted.keys()])) {
        const b = grew.get(k) ?? 0
        const o = counted.get(k) ?? 0
        bytes += b
        bump.push({ store: 'kv', key: k, fn: (cur) => ({ k, ops: Number(cur?.ops ?? 0) + o, bytes: Math.max(0, Number(cur?.bytes ?? 0) + b) }) })
      }
      const scopes = new Set<Scope>([...ops.map((o) => o.s), ...[...segs.values()].map((s) => s.s)])
      if (this.scope) scopes.add(this.scope)
      // the tab's record: clean when this flush lands everything recorded (nothing waits behind it in memory, no
      // update waits in the queue) — or the tab is being left
      const seen0 = this.seen
      clean = !!opts.clean || this.leaving || (!this.ops.size && !this.events.size && !this.queued())
      for (const scope of scopes) {
        const start = this.tabScopes.get(scope) ?? now
        this.tabScopes.set(scope, start)
        bump.push({ store: 'kv', key: `${scope}|tab|${this.tab}`, fn: (cur) => ({ k: `${scope}|tab|${this.tab}`, start: Number(cur?.start ?? start), lastFlush: now, clean }) })
      }
      if (lost) batch.put!.kv = [{ k: `${lost.s}|gap|${pad13(lost.from)}`, from: lost.from, to: lost.to, tab: this.tab }]
      await this.writeInParts(j, batch, lap)
      if (clean) {
        // an update that came while the write ran: the records must say dirty again
        if (this.seen === seen0) this.recordClean = true
        else this.markDirty()
      }
      for (const [r, size] of sized) this.sizes.set(r, size)
      for (const [id, size] of runSized) {
        this.runSizes.delete(id)
        this.runSizes.set(id, size)
      }
      while (this.runSizes.size > 2000) this.runSizes.delete(this.runSizes.keys().next().value as string)
      this.gate.wrote(bytes)
      this.lastFlush = now
    } catch (e) {
      // put back what was taken (a later flush tries again); a pin already kept stays referenced
      for (const o of ops) if (!this.ops.has(o.k)) this.ops.set(o.k, o)
      for (const [k, e2] of events) if (!this.events.has(k)) this.events.set(k, e2)
      for (const [k, s] of segs) if (!this.segs.has(k)) this.segs.set(k, s)
      for (const [k, v] of minutes) this.minutes.set(k, mergeCounts(this.minutes.get(k), v))
      for (const [k, v] of quarters) this.quarters.set(k, mergeCounts(this.quarters.get(k), v))
      for (const [s, v] of lanes) {
        const cur = this.lanes.get(s) ?? {}
        for (const [lane, x] of Object.entries(v)) cur[lane] = { last: Math.max(cur[lane]?.last ?? 0, x.last), n: (cur[lane]?.n ?? 0) + x.n }
        this.lanes.set(s, cur)
      }
      for (const [s, n] of counted) this.counted.set(s, (this.counted.get(s) ?? 0) + n)
      for (const r of runs) this.runs.dirty.add(r.id)
      this.purge.push(...purge)
      throw e
    } finally {
      this.inFlight = null
      this.inFlightOps = 0
    }

    // 4. after the write: what the person deleted for good loses its pins
    if (purge.length) await lap(this.applyPurge(j, purge, memory))
    noteTask(this.stats, 'flush', t)
  }

  /**
   * The tab is left (page hide) with its queue recorded: when no Vorgang waits (nothing new since the last flush, none
   * in a flush under way), its records say "clean" right now — one put, issued in this task (a closing tab runs no
   * later task to finish a read-modify-write); segments still closing are no loss, recovery closes them exactly.
   * Every flush from here marks the tab clean in its own transaction. `drained`: the queue was recorded in time.
   */
  leave(drained: boolean): void {
    if (drained) {
      this.leaving = true
      if (!this.ops.size && !this.events.size && !this.inFlightOps) this.markCleanNow()
    }
    void this.flush().catch(() => undefined)
  }

  /** The tab is shown again (back from the page cache): it is not being left any more. */
  stay(): void {
    this.leaving = false
  }

  /**
   * A store update was queued: when the tab records said "clean", they say "dirty" from now (issued in a microtask
   * right after the update — never on the hot path).
   */
  noteUpdate(scope: Scope): void {
    this.seen++
    if (!this.recordClean) return
    this.recordClean = false
    queueMicrotask(() => this.markDirty(scope))
  }

  /** Mark the tab records dirty (a tab without one yet gets one for this scope). */
  private markDirty(scope?: Scope): void {
    this.recordClean = false
    const j = journalIfOpen()
    if (!j) return
    const now = Date.now()
    if (scope && !this.tabScopes.has(scope)) this.tabScopes.set(scope, now)
    const kv = [...this.tabScopes].map(([s, start]) => ({ k: `${s}|tab|${this.tab}`, start, lastFlush: this.lastFlush || now, clean: false }))
    if (kv.length) void j.write({ put: { kv } }).catch(() => undefined)
  }

  /** Mark this tab's records clean, synchronously issued (no read first). */
  private markCleanNow(): void {
    const j = journalIfOpen()
    if (!j || !this.tabScopes.size) return
    const kv = [...this.tabScopes].map(([s, start]) => ({ k: `${s}|tab|${this.tab}`, start, lastFlush: this.lastFlush || Date.now(), clean: true }))
    this.recordClean = true
    void j.write({ put: { kv } }, { commit: true }).catch(() => undefined)
  }

  /**
   * A big flush (an import's thousands of places) goes in several transactions of ≤ TX_RECORDS records, the page idle
   * between them: segments, events, ops, runs, kv — the counters and histograms (read-modify-write) with the last one.
   * A tab dying in between leaves records without their counts (never counts without records) — and a lost tail.
   */
  private async writeInParts(j: Journal, batch: Batch, lap: <T>(p: Promise<T>) => Promise<T>): Promise<void> {
    const order: StoreName[] = ['segs', 'events', 'ops', 'runs', 'kv']
    const all: Array<[StoreName, Record<string, unknown>]> = []
    for (const store of order) for (const r of batch.put?.[store] ?? []) all.push([store, r])
    if (all.length <= TX_RECORDS) return lap(this.write(j, batch))
    for (let i = 0; i < all.length; i += TX_RECORDS) {
      const last = i + TX_RECORDS >= all.length
      const put: NonNullable<Batch['put']> = {}
      for (const [store, r] of all.slice(i, i + TX_RECORDS)) (put[store] ??= []).push(r)
      await lap(this.write(j, last ? { put, bump: batch.bump, del: batch.del } : { put }))
      if (!last) await lap(idleTask())
    }
  }

  private async write(j: Journal, batch: Batch): Promise<void> {
    try {
      await j.write(batch)
    } catch (e) {
      if ((e as DOMException)?.name !== 'QuotaExceededError') throw e
      // the workspace always wins: free a day, try once more
      if (!(await this.gate.onQuota())) throw e
      await j.write(batch)
    }
  }

  private async applyPurge(j: Journal, list: Array<{ s: Scope; p: PlaceKey; at: number }>, memory: boolean): Promise<void> {
    const { dropPinsOfPlace, dropPinsOfDatabase } = await import('../../history/pins')
    const { giveBack } = await import('./prune')
    for (const { s, p, at } of list) {
      const db = p.startsWith('s:') ? p.slice(2) : null
      if (memory) dropMemoryPins(s, p)
      else {
        const freed = await (db ? dropPinsOfDatabase(s, db) : dropPinsOfPlace(s, p)).catch(() => [])
        await giveBack(j, s, freed).catch(() => undefined)
      }
      // its segments (a database: its schema's and every view's) read purged
      const ranges: Array<[string, string]> = db ? [[p, p], [`v:${db}/`, `v:${db}/${HI}`]] : [[p, p]]
      for (const [lo, hi] of ranges) {
        // only segments that began before the delete (the same id made again later has segments of its own)
        const segs = await j.range<JSegment>({ store: 'segs', index: 'place', lo: [s, lo, 0], hi: [s, hi, at] })
        const put = segs.filter((g) => !(g.f & F.PURGED) || g.before).map((g) => ({ ...g, f: g.f | F.PURGED, before: null }))
        if (put.length) await j.write({ put: { segs: put } })
      }
    }
  }

  /**
   * Paused: records wait in memory — at most PAUSED_OPS Vorgänge / PAUSED_EVENTS events (beyond, the oldest go with
   * their events, digest jobs and closed segments, and a lost tail is noted) and PAUSED_PINS pins / PAUSED_PIN_BYTES
   * (beyond, the oldest pins go: their segments read partial).
   */
  private capWhilePaused(): void {
    if (this.ops.size > PAUSED_OPS || this.events.size > PAUSED_EVENTS) {
      const list = [...this.ops.values()].sort((a, b) => a.at - b.at)
      let events = this.events.size
      const drop: JOp[] = []
      for (const o of list) {
        if (list.length - drop.length <= PAUSED_OPS && events <= PAUSED_EVENTS) break
        drop.push(o)
        events -= o.n
      }
      const drops = new Set(drop.map((o) => o.v))
      for (const o of drop) this.ops.delete(o.k)
      const segsOf = new Set<string>()
      for (const [k, e] of this.events)
        if (drops.has(e.v)) {
          this.events.delete(k)
          segsOf.add(e.g)
        }
      // their digest jobs go too (a job would put its event back), and closed segments nothing waits for any more
      const live = new Set<string>([...this.open.values(), ...this.closing.values()].map((o) => o.rec.id))
      for (const e of this.events.values()) live.add(e.g)
      const gone = new Set([...segsOf].filter((g) => !live.has(g)))
      for (const g of gone) this.segs.delete(g)
      this.jobs = this.jobs.filter((job) => !(job.t === 'ev' ? drops.has(job.rec.v) : gone.has(job.seg.id)))
      this.pins = this.pins.filter((p) => !gone.has(p.seg.id))
      if (drop.length) {
        const from = drop[0].at
        const to = drop[drop.length - 1].at
        this.lostTail = { s: drop[0].s, from: Math.min(this.lostTail?.from ?? from, from), to: Math.max(this.lostTail?.to ?? to, to) }
      }
    }
    let bytes = 0
    for (const p of this.pins) bytes += (p.size ??= p.input.content ? approxSize(p.input.content) : 0)
    if (this.pins.length > PAUSED_PINS || bytes > PAUSED_PIN_BYTES) {
      // the oldest pins go (their segments keep `before: null` — partial, never guessed)
      this.pins.sort((a, b) => a.seg.from - b.seg.from)
      while (this.pins.length && (this.pins.length > PAUSED_PINS || bytes > PAUSED_PIN_BYTES)) bytes -= this.pins.shift()!.size ?? 0
    }
  }

  private noteLh(p: PlaceKey, h: string): void {
    this.lastLh.delete(p)
    this.lastLh.set(p, h)
    if (this.lastLh.size > LAST_LH_MAX) this.lastLh.delete(this.lastLh.keys().next().value as PlaceKey)
  }

  /** Forget everything in memory (the journal was wiped / the recorder stops). */
  reset(): void {
    this.open.clear()
    this.closing.clear()
    this.gapNext.clear()
    this.late.clear()
    this.lastLh.clear()
    this.ops.clear()
    this.events.clear()
    this.segs.clear()
    this.jobs = []
    this.pins = []
    this.minutes.clear()
    this.quarters.clear()
    this.lanes.clear()
    this.counted.clear()
    this.purge = []
    this.purged.clear()
    if (this.scope) this.tabScopes.delete(this.scope)
    this.runs.clear()
  }
}

function histAdd(key: string, cur: Record<string, unknown> | undefined, add: Record<LaneKey, number>): Record<string, unknown> {
  const lanes = { ...((cur?.lanes as Record<LaneKey, number>) ?? {}) }
  for (const [l, n] of Object.entries(add)) lanes[l] = (lanes[l] ?? 0) + n
  const [s, m] = [key.slice(0, key.lastIndexOf('|')), Number(key.slice(key.lastIndexOf('|') + 1))]
  return { k: key, s, m, lanes }
}

function mergeCounts(a: Record<LaneKey, number> | undefined, b: Record<LaneKey, number>): Record<LaneKey, number> {
  const out = { ...(a ?? {}) }
  for (const [l, n] of Object.entries(b)) out[l] = (out[l] ?? 0) + n
  return out
}

/** A record's rough size in bytes (counters, budget). */
function approxSize(r: unknown): number {
  try {
    return JSON.stringify(r).length * 2
  } catch {
    return 256
  }
}
