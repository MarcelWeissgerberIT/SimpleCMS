/**
 * Run records (store `runs`): made from the first event of a run key, told more by `noteRun` (seq, tool,
 * client, source, action — ids and fixed keys only) and closed by `endRun`; Vorgänge, places and words
 * add up as the processor records them. A flag on the tape reads its whole run from here in O(1).
 */
import type { RunMeta } from '../../../store/writer'
import { runKindOf, runRefOf } from '../model/writerKeys'
import { F, K, type JEvent, type JRun, type LaneKey, type PlaceKey, type Scope } from '../model/types'

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

interface RunState {
  rec: JRun
  places: Map<PlaceKey, number>
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
        places: { rows: 0, newRows: 0, pages: 0, newPages: 0, schema: 0, views: 0, trashed: 0, moved: 0 },
        words: [0, 0],
        state: 'live',
      }
      st = { rec, places: new Map() }
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
    const seen = st.places.get(e.p) ?? 0
    const isNew = (e.f ?? 0) & F.NEW
    let bits = seen
    if (!seen) {
      if (e.pk === 'row') r.places.rows++
      else if (e.pk === 'page' || e.pk === 'db') r.places.pages++
      else if (e.pk === 'schema') r.places.schema++
      else r.places.views++
      bits |= 1
    }
    if (isNew && !(seen & 2)) {
      if (e.pk === 'row') r.places.newRows++
      else if (e.pk === 'page' || e.pk === 'db') r.places.newPages++
      bits |= 2
    }
    if (e.kinds & K.TRASH && !(seen & 4)) {
      r.places.trashed++
      bits |= 4
    }
    if (e.kinds & K.MOVE && !(seen & 8)) {
      r.places.moved++
      bits |= 8
    }
    st.places.set(e.p, bits)
    this.dirty.add(r.id)
  }

  /** The records changed since the last call (copies — the flush stores them). */
  takeDirty(): JRun[] {
    const out: JRun[] = []
    for (const id of this.dirty) {
      const st = this.runs.get(id)
      if (st) out.push(structuredClone(st.rec))
    }
    this.dirty.clear()
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
