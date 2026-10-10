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
import { pad13, pad8, type Batch, type Bump, type Journal } from './db'
import { pagePin, schemaPin, storePins } from './pins'
import { RunBook } from './runs'
import type { PinInput } from '../../history/pins'

export const SEG_IDLE = 2 * 60_000
export const FOLD_MS = 30_000
const MAX_OPEN = 5000
const LAST_LH_MAX = 20_000

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
  note?: RunNote
}

interface OpenEv {
  rec: JEvent
  op: JOp
  /** the page before this event (content words since) */
  basePage?: Page
  words: [number, number]
}

interface Open {
  rec: JSegment
  first: PlaceObject | null
  /** the raw next object (identity chain) */
  last: unknown
  lastObj: PlaceObject | null
  ev: OpenEv | null
}

type Job =
  | { t: 'ev'; rec: JEvent; seg: JSegment; canon: string | null }
  | { t: 'open'; seg: JSegment; canon: string | null }
  | { t: 'close'; seg: JSegment; parts: Record<string, string> | null; blocks?: BlockCanon[]; whole: string | null; isNew: boolean }

interface PinJob {
  seg: JSegment
  input: PinInput
  /** content identity (pages with content) */
  ckey: string | null
}

export interface Stats {
  hot: number[]
  idleDiffScans: number
  sliceMax: number
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
  readonly open = new Map<PlaceKey, Open>()
  readonly runs = new RunBook(() => this.tab)
  /** places whose next segment starts after an unseen change */
  private gapNext = new Set<PlaceKey>()
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
  private counted = new Map<Scope, number>()
  private purge: Array<{ s: Scope; p: PlaceKey }> = []
  private lostTail: { s: Scope; from: number; to: number } | null = null
  /** an endRun was seen: flush right away */
  urgent = false
  lastFlush = 0
  private flushing: Promise<void> = Promise.resolve()
  /** records waiting for the flush */
  get waiting(): number {
    return this.ops.size + this.events.size + this.segs.size + this.pins.length
  }

  constructor(
    readonly tab: string,
    private journal: () => Promise<Journal>,
    private gate: FlushGate,
    readonly stats: Stats,
  ) {}

  /* ---------------------------------------------------------------- */
  /* processing                                                        */
  /* ---------------------------------------------------------------- */

  process(it: QItem): void {
    if (it.note) return this.note(it.note, it.at)
    if (this.gate.forgetting(it.scope)) return
    if (this.scope !== it.scope) {
      this.closeAll(it.at)
      this.scope = it.scope
    }
    if (it.sys) return this.system(it)
    const pairs = it.pairs ?? this.diffPages(it.maps)
    const dbsNext = it.dbsNext ?? {}
    const dbsPrev = it.dbsPrev ?? dbsNext
    const places = this.placesOf(pairs, dbsNext, dbsPrev)
    const w = it.w ?? resolvePending(it.pending ?? { agent: false, ai: false, stack: '' }, pairs, places.map((p) => p.p))
    if (w.kind === 'system') {
      // a fallback is never system, and a system frame never reaches here (the listener queues open places only)
      return
    }
    const wk = formatWriterKey(w)
    this.record(it, wk, places)
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

  private placesOf(pairs: Array<[ID, Page | undefined, Page | undefined]>, dbsNext: Record<ID, Database>, dbsPrev: Record<ID, Database>): PlaceChange[] {
    const out: PlaceChange[] = []
    for (const [id, a, b] of pairs) {
      const page = (b ?? a)!
      const pk = placeKindOf(page)
      const dbId = page.databaseId ?? (pk === 'db' ? id : undefined)
      const cls = classifyPage(a, b, deps, (b?.databaseId ? dbsNext[b.databaseId] : undefined) ?? (a?.databaseId ? dbsPrev[a.databaseId] : undefined))
      out.push({
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
      })
    }
    if (dbsNext !== dbsPrev) {
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

  /** A system write: only the open places that moved, for the identity chain. */
  private system(it: QItem): void {
    const dbs = it.sysDbs
    for (const [p, a, b] of it.sys ?? []) {
      const pk = pkOfPlace(p, b ?? a)
      let ignoredOnly = true
      if (pk === 'page' || pk === 'row' || pk === 'db') ignoredOnly = classifyPage(a as Page | undefined, b as Page | undefined, deps).ignoredOnly
      else ignoredOnly = partsKey(placeObj(pk, a, dbs?.prev), deps) === partsKey(placeObj(pk, b, dbs?.next), deps)
      const pl: PlaceChange = { p, pk, prevRaw: a, nextRaw: b, prevObj: placeObj(pk, a, dbs?.prev), nextObj: placeObj(pk, b, dbs?.next), kinds: 0, f: 0, ignoredOnly }
      const o = this.chain(pl, it.at)
      if (!o) continue
      if (ignoredOnly) this.follow(o, pl)
      else {
        // a system write changed the place (another tab's save): the segment ends with what its writer left
        this.close(o, it.at)
        this.gapNext.add(p)
      }
    }
  }

  private record(it: QItem, wk: string, places: PlaceChange[]): void {
    const scope = it.scope
    const at = it.at
    const parsed = parseWriterKey(wk)
    const sk = segKeyOf(wk)
    const lane = laneOf(wk, (s) => this.mcpClients.get(s))
    const run = runKeyOf(wk) ?? undefined
    const copy = isCopyKey(wk)
    const undo = lane === 'undo'
    const folds = foldsTyping(wk, sk)
    let op: JOp | null = null
    const baseF = (copy ? F.COPY : 0) | (undo ? F.UNDO : 0) | (it.order ? F.ORDER : 0) | (parsed.mixed ? F.BATCH : 0)

    for (const pl of places) {
      let seg: Open | undefined = this.chain(pl, at)
      if (pl.ignoredOnly) {
        this.follow(seg, pl)
        continue
      }
      if (seg && (seg.rec.sk !== sk || (isHumanSeg(sk) && at - seg.rec.to >= SEG_IDLE) || (seg.rec.r && this.runs.isEnded(seg.rec.r)))) {
        this.close(seg, at)
        seg = undefined
      }
      this.follow(seg, pl)
      // typing: fold into the open event
      const textOnly = (pl.kinds & ~(K.CONTENT | K.TITLE)) === 0
      if (seg?.ev && folds && textOnly && (seg.ev.rec.kinds & ~(K.CONTENT | K.TITLE)) === 0 && at - seg.ev.rec.at < FOLD_MS && !pl.f) {
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
      seg.rec.n++
      seg.rec.to = at
      seg.rec.lastLh = ''
      seg.ev = { rec: ev, op, basePage: pl.prevRaw as Page | undefined, words: delta ? [delta.wa, delta.wd] : [0, 0] }
      this.segs.set(seg.rec.id, seg.rec)
      this.jobs.push({ t: 'ev', rec: ev, seg: seg.rec, canon: this.canonOf(pl.nextObj) })
      if (run && !copy) this.runs.noteEvent(scope, run, ev, delta ? [delta.wa, delta.wd] : [0, 0])
      // the place is gone: nothing more can happen to it
      if (pl.f & F.GONE) {
        if ((lane === 'you' || lane === 'undo') && pl.p.startsWith('p:')) this.purge.push({ s: scope, p: pl.p })
        this.close(seg, at)
      }
    }
    if (!op) return
    if (run && !copy) this.runs.noteOp(scope, run, at)
    if (!copy) this.count(scope, lane, at)
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
    this.events.set(e.rec.k, e.rec)
    this.ops.set(e.op.k, e.op)
    this.segs.set(seg.rec.id, seg.rec)
    this.jobs.push({ t: 'ev', rec: e.rec, seg: seg.rec, canon: this.canonOf(pl.nextObj) })
  }

  private canonOf(o: PlaceObject | null): string | null {
    if (!o) return null
    const { parts, blocks } = placeCanon(o, deps)
    return wholeCanon(parts, blocks)
  }

  private openSeg(pl: PlaceChange, scope: Scope, at: number, wk: string, sk: string, lane: LaneKey, run: string | undefined, cause: string | undefined): Open {
    if (this.open.size >= MAX_OPEN) {
      let oldest: Open | null = null
      for (const o of this.open.values()) if (!oldest || o.rec.to < oldest.rec.to) oldest = o
      if (oldest) this.close(oldest, at)
    }
    const id = `${scope}|${newId()}`
    let f = 0
    if (!pl.prevRaw) f |= F.NEW
    if (this.gapNext.delete(pl.p)) f |= F.GAP
    if (isCopyKey(wk)) f |= F.COPY
    const purged = pl.f & F.GONE && (lane === 'you' || lane === 'undo') && pl.p.startsWith('p:')
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
        if (db) this.pins.push({ seg: rec, input: { place: pl.p, meta: schemaPin(db, at, id) }, ckey: null })
      } else {
        const page = pl.prevRaw as Page
        // a row's definitions: its database before THIS writer changed the schema (an option removed, then the
        // values cleared row by row, still reads with the option), else the database as it was then
        const own = page.databaseId ? this.open.get(`s:${page.databaseId}`) : undefined
        const ownDb = own && own.rec.sk === sk && own.first?.kind === 'schema' ? own.first.db : undefined
        const { meta, content } = pagePin(page, ownDb ?? pl.prevDbs?.[page.databaseId ?? ''], at, id)
        this.pins.push({ seg: rec, input: { place: pl.p, meta, content }, ckey: content ? deps.contentKey(content) : null })
      }
    }
    if (run) this.runs.ensure(scope, run, lane, at)
    const o: Open = { rec, first: pl.prevObj, last: pl.nextRaw, lastObj: pl.nextObj, ev: null }
    this.open.set(pl.p, o)
    this.segs.set(id, rec)
    this.jobs.push({ t: 'open', seg: rec, canon: this.canonOf(pl.prevObj) })
    return o
  }

  /** Close a segment: what its writer left (digests at the flush) and the parts it touched. */
  close(o: Open, _at: number): void {
    if (this.open.get(o.rec.p) === o) this.open.delete(o.rec.p)
    delete o.rec.o
    const isNew = !!(o.rec.f & F.NEW)
    o.rec.touched = isNew || !o.lastObj ? '*' : touchedParts(o.first, o.lastObj, deps)
    let parts: Record<string, string> | null = null
    let blocks: BlockCanon[] | undefined
    let whole: string | null = null
    if (o.lastObj) {
      const c = placeCanon(o.lastObj, deps)
      parts = c.parts
      blocks = c.blocks
      whole = wholeCanon(c.parts, c.blocks)
    }
    this.jobs.push({ t: 'close', seg: o.rec, parts, blocks, whole, isNew })
    this.segs.set(o.rec.id, o.rec)
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
    if (n.end) {
      this.runs.end(run, at)
      this.closeAll(at, (s) => s.r === run)
      this.urgent = true
    } else this.runs.meta(run, n.meta)
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
    this.counted.set(scope, (this.counted.get(scope) ?? 0) + 1)
  }

  /** A run of the next Vorgang id. */
  nextV(): string {
    return `${this.tab}.${(this.vCount++).toString(36)}`
  }

  /* ---------------------------------------------------------------- */
  /* flush                                                             */
  /* ---------------------------------------------------------------- */

  /** Write everything waiting (serialised: one flush at a time). */
  flush(): Promise<void> {
    const run = this.flushing.then(() => this.flushNow())
    this.flushing = run.catch(() => undefined)
    return run
  }

  private async flushNow(): Promise<void> {
    this.urgent = false
    if (!this.waiting && !this.jobs.length && !this.runs.dirty.size && !this.purge.length) return
    if (!(await this.gate.allowed())) {
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
    const runs = this.runs.takeDirty()
    const j = await this.journal()
    const memory = j.mode === 'memory'

    try {
      // 1. pins first (their bodies addressed by the content's digest), so a segment never names a pin that is not there
      const byScope = new Map<Scope, PinJob[]>()
      for (const p of pins) byScope.set(p.seg.s, [...(byScope.get(p.seg.s) ?? []), p])
      let pinBytes = 0
      for (const [scope, list] of byScope) {
        for (const p of list) pinBytes += approxSize(p.input.meta) + (p.input.content ? approxSize(p.input.content) : 0)
        await Promise.all(
          list.map(async (p) => {
            if (p.input.meta.kind === 'page') p.input.meta.body = p.ckey !== null ? await digestPart(scope, 'c', p.ckey) : null
          }),
        )
        const ids = await storePins(scope, list.map((p) => p.input), memory)
        list.forEach((p, i) => {
          p.seg.before = ids[i] ?? null
          segs.set(p.seg.id, p.seg)
        })
      }

      // 2. digests, in the order the records were made
      const digests = await Promise.all(
        jobs.map(async (job) => {
          if (job.t === 'ev' || job.t === 'open') return job.canon === null ? '-' : digestWhole(job.seg.s, job.canon)
          if (!job.whole) return { h: '-', parts: {} }
          return digestLeft(job.seg.s, { parts: job.parts ?? {}, blocks: job.blocks }, job.whole, job.isNew)
        }),
      )
      jobs.forEach((job, i) => {
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
      })

      // 3. ONE transaction
      const batch: Batch = {
        put: {
          ops: ops.map((o) => ({ ...o })),
          events: [...events.values()].map((e) => ({ ...e })),
          segs: [...segs.values()].map((s) => ({ ...s })),
          runs: runs as unknown as Array<Record<string, unknown>>,
        },
        bump: [],
      }
      const bump = batch.bump as Bump[]
      for (const [key, add] of minutes) bump.push({ store: 'minutes', key, fn: (cur) => histAdd(key, cur, add) })
      for (const [key, add] of quarters) bump.push({ store: 'quarters', key, fn: (cur) => histAdd(key, cur, add) })
      let bytes = pinBytes
      for (const list of Object.values(batch.put ?? {})) for (const r of list ?? []) bytes += approxSize(r)
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
      const scopes = new Set<Scope>([...ops.map((o) => o.s), ...[...segs.values()].map((s) => s.s), ...counted.keys()])
      if (this.scope) scopes.add(this.scope)
      for (const scope of scopes) {
        const n = counted.get(scope) ?? 0
        const share = scopes.size ? Math.ceil(bytes / scopes.size) : 0
        bump.push({ store: 'kv', key: `${scope}|n|${this.tab}`, fn: (cur) => ({ k: `${scope}|n|${this.tab}`, ops: Number(cur?.ops ?? 0) + n, bytes: Number(cur?.bytes ?? 0) + share }) })
        bump.push({ store: 'kv', key: `${scope}|tab|${this.tab}`, fn: (cur) => ({ k: `${scope}|tab|${this.tab}`, start: Number(cur?.start ?? now), lastFlush: now, clean: false }) })
      }
      if (lost) batch.put!.kv = [{ k: `${lost.s}|gap|${pad13(lost.from)}`, from: lost.from, to: lost.to, tab: this.tab }]
      await this.write(j, batch)
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
    }

    // 4. after the write: what the person deleted for good loses its pins
    if (purge.length) await this.applyPurge(j, purge, memory)
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

  private async applyPurge(j: Journal, list: Array<{ s: Scope; p: PlaceKey }>, memory: boolean): Promise<void> {
    const { dropPinsOfPlace } = await import('../../history/pins')
    for (const { s, p } of list) {
      if (!memory) await dropPinsOfPlace(s, p).catch(() => undefined)
      const segs = await j.range<JSegment>({ store: 'segs', index: 'place', lo: [s, p, 0], hi: [s, p, Number.MAX_SAFE_INTEGER] })
      const put = segs.filter((g) => !(g.f & F.PURGED)).map((g) => ({ ...g, f: g.f | F.PURGED }))
      if (put.length) await j.write({ put: { segs: put } })
    }
  }

  /** Paused: records wait in memory (at most 20,000 Vorgänge — beyond, the oldest go and a lost tail is noted). */
  private capWhilePaused(): void {
    if (this.ops.size <= 20_000) return
    const list = [...this.ops.values()].sort((a, b) => a.at - b.at)
    const drop = list.slice(0, list.length - 20_000)
    for (const o of drop) this.ops.delete(o.k)
    const drops = new Set(drop.map((o) => o.v))
    for (const [k, e] of this.events) if (drops.has(e.v)) this.events.delete(k)
    const from = drop[0].at
    const to = drop[drop.length - 1].at
    this.lostTail = { s: drop[0].s, from: Math.min(this.lostTail?.from ?? from, from), to: Math.max(this.lostTail?.to ?? to, to) }
  }

  private noteLh(p: PlaceKey, h: string): void {
    this.lastLh.delete(p)
    this.lastLh.set(p, h)
    if (this.lastLh.size > LAST_LH_MAX) this.lastLh.delete(this.lastLh.keys().next().value as PlaceKey)
  }

  /** Forget everything in memory (the journal was wiped / the recorder stops). */
  reset(): void {
    this.open.clear()
    this.gapNext.clear()
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
