/**
 * Run records (store `runs`): made from the first event of a run key, told more by `noteRun` (seq, tool,
 * client, source, action — ids and fixed keys only) and closed by `endRun`; Vorgänge, places and words
 * add up as the processor records them. A flag on the tape reads its whole run from here in O(1).
 *
 * A run can go on in another tab or after a reload (a review applying a proposal days later): before a record made
 * here is first written, the stored one is read and merged in (`adopt`) — its Vorgänge, words, meta and the places of
 * its stored events — so a record is never overwritten by a fresh one that knows only this tab's part.
 */
import type { RunMeta } from '../../../store/writer'
import { runKindOf, runRefOf } from '../model/writerKeys'
import { F, K, type JEvent, type JRun, type LaneKey, type PlaceKey, type PlaceKind, type RunPlaces, type Scope } from '../model/types'

const META_KEYS = ['seq', 'tool', 'source', 'action', 'client'] as const
const ID = /^[A-Za-z0-9 ._-]{1,40}$/

/** Run meta as the journal keeps it: fixed keys, numbers and identifiers only. */
export function cleanMeta(meta: RunMeta | undefined): JRun['meta'] | undefined {
  if (!meta) return undefined
  const out: NonNullable<JRun['meta']> = {}
  for (const k of META_KEYS) {
    const v = meta[k]
    if (k === 'seq') {
      if (typeof v === 'number' && Number.isFinite(v)) out.seq = Math.floor(v)
    } else if (typeof v === 'string' && ID.test(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** A place's bits in a run: 1 written · 2 made by it · 4 trashed by it · 8 moved by it. */
interface PlaceBits {
  b: number
  pk: PlaceKind
}

interface RunState {
  rec: JRun
  places: Map<PlaceKey, PlaceBits>
  /** the stored record (if any) is merged in — only then may this one be written */
  adopted: boolean
}

/** The bits one event gives its place. */
function eventBits(e: Pick<JEvent, 'kinds' | 'f'>): number {
  return 1 | ((e.f ?? 0) & F.NEW ? 2 : 0) | (e.kinds & K.TRASH ? 4 : 0) | (e.kinds & K.MOVE ? 8 : 0)
}

const emptyPlaces = (): RunPlaces => ({ rows: 0, newRows: 0, pages: 0, newPages: 0, schema: 0, views: 0, trashed: 0, moved: 0 })

/** What a set of places adds up to. */
export function countPlaces(places: Iterable<PlaceBits>): RunPlaces {
  const r = emptyPlaces()
  for (const { b, pk } of places) addBits(r, b, pk)
  return r
}

function addBits(r: RunPlaces, bits: number, pk: PlaceKind): void {
  if (bits & 1) {
    if (pk === 'row') r.rows++
    else if (pk === 'page' || pk === 'db') r.pages++
    else if (pk === 'schema') r.schema++
    else r.views++
  }
  if (bits & 2) {
    if (pk === 'row') r.newRows++
    else if (pk === 'page' || pk === 'db') r.newPages++
  }
  if (bits & 4) r.trashed++
  if (bits & 8) r.moved++
}

/** How the book reads what is stored (the processor's journal). */
export interface RunStoreRead {
  run(id: string): Promise<JRun | undefined>
  events(scope: Scope, runKey: string): Promise<JEvent[]>
}

export class RunBook {
  private runs = new Map<string, RunState>()
  /** meta noted before the run's first event */
  private early = new Map<string, JRun['meta']>()
  private ended = new Map<string, number>()
  /** runs whose record changed since the last flush */
  dirty = new Set<string>()

  constructor(private tab: () => string) {}

  meta(runKey: string, meta: RunMeta | undefined): void {
    const m = cleanMeta(meta)
    if (!m) return
    const st = [...this.runs.values()].find((r) => r.rec.key === runKey)
    if (st) {
      st.rec.meta = { ...st.rec.meta, ...m }
      this.dirty.add(st.rec.id)
    } else this.early.set(runKey, { ...this.early.get(runKey), ...m })
  }

  end(runKey: string, at: number): void {
    this.ended.set(runKey, at)
    for (const st of this.runs.values())
      if (st.rec.key === runKey && !st.rec.ended) {
        st.rec.ended = at
        this.dirty.add(st.rec.id)
      }
  }

  isEnded(runKey: string): boolean {
    return this.ended.has(runKey)
  }

  /** The run goes on after its end (noteRun again, a review applying its proposals): ended again by the next end. */
  reopen(runKey: string): void {
    if (!this.ended.delete(runKey)) return
    for (const st of this.runs.values())
      if (st.rec.key === runKey && st.rec.ended) {
        delete st.rec.ended
        this.dirty.add(st.rec.id)
      }
  }

  /** The record of a run in a scope (made on its first event). */
  ensure(scope: Scope, runKey: string, lane: LaneKey, at: number): JRun | null {
    const id = `${scope}|${runKey}`
    let st = this.runs.get(id)
    if (!st) {
      const kind = runKindOf(runKey)
      if (!kind) return null
      const meta = this.early.get(runKey)
      const rec: JRun = {
        id,
        s: scope,
        key: runKey,
        l: lane,
        kind,
        ref: runRefOf(runKey),
        ...(meta ? { meta } : {}),
        from: at,
        to: at,
        ops: 0,
        places: emptyPlaces(),
        words: [0, 0],
        state: 'live',
      }
      st = { rec, places: new Map(), adopted: false }
      this.runs.set(id, st)
      // the runs map stays small: older finished runs leave memory (their records are stored)
      if (this.runs.size > 500) {
        for (const [k, v] of this.runs) {
          if (this.runs.size <= 400) break
          if (v.rec.ended && !this.dirty.has(k)) this.runs.delete(k)
        }
      }
    }
    this.dirty.add(id)
    return st.rec
  }

  /** A new Vorgang of the run. */
  noteOp(scope: Scope, runKey: string, at: number): void {
    const st = this.runs.get(`${scope}|${runKey}`)
    if (!st) return
    st.rec.ops++
    st.rec.to = Math.max(st.rec.to, at)
    this.dirty.add(st.rec.id)
  }

  /** An event of the run (places and words; a folded event's words are passed as the change since the last call). */
  noteEvent(scope: Scope, runKey: string, e: Pick<JEvent, 'p' | 'pk' | 'kinds' | 'f' | 'at'>, words: [number, number]): void {
    const st = this.runs.get(`${scope}|${runKey}`)
    if (!st) return
    const r = st.rec
    r.to = Math.max(r.to, e.at)
    r.words = [r.words[0] + words[0], r.words[1] + words[1]]
    const seen = st.places.get(e.p)
    const bits = eventBits(e)
    const pk = seen?.pk ?? e.pk
    addBits(r.places, bits & ~(seen?.b ?? 0), pk)
    st.places.set(e.p, { b: (seen?.b ?? 0) | bits, pk })
    this.dirty.add(r.id)
  }

  /**
   * Before a record made in this tab is first written: the stored one (another tab's, an earlier boot's, or this
   * tab's before its state left memory) is merged in — Vorgänge and words add up, the meta joins, the places are the
   * union of its stored events' and this tab's. Returns the stored records merged (their bytes are counted already)
   * and the keys of runs that had ended there and go on here (the processor ends them again). A record whose read
   * failed stays unadopted and is not written (`takeDirty` keeps it back).
   */
  async adopt(read: RunStoreRead): Promise<{ merged: JRun[]; ended: string[] }> {
    const merged: JRun[] = []
    const ended: string[] = []
    for (const id of [...this.dirty]) {
      const st = this.runs.get(id)
      if (!st || st.adopted) continue
      try {
        const stored = await read.run(id)
        const evs = stored ? await read.events(st.rec.s, st.rec.key) : []
        // (this tab went on recording meanwhile: everything below is synchronous)
        if (st.adopted) continue
        st.adopted = true
        if (!stored) continue
        const r = st.rec
        for (const e of evs) {
          if ((e.f ?? 0) & F.COPY) continue
          const cur = st.places.get(e.p)
          st.places.set(e.p, { b: (cur?.b ?? 0) | eventBits(e), pk: cur?.pk ?? e.pk })
        }
        r.places = countPlaces(st.places.values())
        r.ops += stored.ops
        r.words = [r.words[0] + stored.words[0], r.words[1] + stored.words[1]]
        r.from = Math.min(r.from, stored.from)
        r.to = Math.max(r.to, stored.to)
        if (stored.meta || r.meta) r.meta = { ...stored.meta, ...r.meta }
        if (stored.state !== 'live') r.state = stored.state
        if (stored.ended && !r.ended && !this.ended.has(r.key)) ended.push(r.key)
        merged.push(stored)
      } catch {
        /* read again with the next flush */
      }
    }
    return { merged, ended }
  }

  /** The records changed since the last call (copies — the flush stores them). */
  takeDirty(): JRun[] {
    const out: JRun[] = []
    for (const id of [...this.dirty]) {
      const st = this.runs.get(id)
      // not merged with what is stored yet: stays dirty, written once it is
      if (st && !st.adopted) continue
      if (st) out.push(structuredClone(st.rec))
      this.dirty.delete(id)
    }
    return out
  }

  /** The record of a run key in memory (seam, tests). */
  get(scope: Scope, runKey: string): JRun | undefined {
    return this.runs.get(`${scope}|${runKey}`)?.rec
  }

  clear(): void {
    this.runs.clear()
    this.early.clear()
    this.ended.clear()
    this.dirty.clear()
  }

  /** this book's tab (for the seam) */
  get tabId(): string {
    return this.tab()
  }
}
