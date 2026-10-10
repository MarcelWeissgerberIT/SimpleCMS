/**
 * The window meters: Vorgänge (store updates, typing folded) · Stellen (distinct places, split by kind)
 * · Wörter (Σ words added / removed) of one writer — a lane or a run — in [a, b). Synced-block copies are
 * never counted for the writer whose change they copy. Pure.
 */
import type { JSONContent } from '@tiptap/core'
import type { CanonDeps } from './canon'
import { F, type JEvent, type JOp, type JRun, type JSegment, type LaneKey } from './types'

/** Whose: a lane, or one run (key). */
export type WhoSel = { lane: LaneKey } | { run: string }

const mine = (who: WhoSel, x: { l: LaneKey; r?: string; f?: number }) => !((x.f ?? 0) & F.COPY) && ('lane' in who ? x.l === who.lane : x.r === who.run)

/** Vorgänge of W with a ≤ at < b. */
export function countOps(ops: JOp[], who: WhoSel, a: number, b: number): number {
  let n = 0
  for (const o of ops) if (o.at >= a && o.at < b && mine(who, o)) n++
  return n
}

export interface PlaceCounts {
  all: number
  rows: number
  newRows: number
  pages: number
  schema: number
  views: number
}

/** Stellen: distinct places among W's segments intersecting [a, b), split by kind (database pages count as pages). */
export function countPlaces(segs: JSegment[], who: WhoSel, a: number, b: number): PlaceCounts {
  const seen = new Map<string, JSegment>()
  const isNew = new Set<string>()
  for (const s of segs) {
    if (!mine(who, s) || s.to < a || s.from >= b) continue
    seen.set(s.p, s)
    if (s.f & F.NEW) isNew.add(s.p)
  }
  const out: PlaceCounts = { all: seen.size, rows: 0, newRows: 0, pages: 0, schema: 0, views: 0 }
  for (const [p, s] of seen) {
    if (s.pk === 'row') {
      out.rows++
      if (isNew.has(p)) out.newRows++
    } else if (s.pk === 'page' || s.pk === 'db') out.pages++
    else if (s.pk === 'schema') out.schema++
    else out.views++
  }
  return out
}

/** Wörter: Σ words added / removed over W's events in [a, b). */
export function countWords(events: JEvent[], who: WhoSel, a: number, b: number): [number, number] {
  let wa = 0
  let wd = 0
  for (const e of events) {
    if (e.at < a || e.at >= b || !mine(who, e)) continue
    wa += e.wa ?? 0
    wd += e.wd ?? 0
  }
  return [wa, wd]
}

/** A whole run's meters straight from its record (a flag click brackets the whole run). */
export function runMeters(run: JRun): { ops: number; places: PlaceCounts; words: [number, number] } {
  const p = run.places
  return {
    ops: run.ops,
    places: { all: p.rows + p.pages + p.schema + p.views, rows: p.rows, newRows: p.newRows, pages: p.pages, schema: p.schema, views: p.views },
    words: run.words,
  }
}

/** Words of a text (whitespace-separated). */
export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** Words added / removed between two texts, as multisets (order is ignored). */
export function wordDelta(before: string, after: string): [number, number] {
  const count = new Map<string, number>()
  for (const w of wordsOf(before)) count.set(w, (count.get(w) ?? 0) + 1)
  let added = 0
  for (const w of wordsOf(after)) {
    const n = count.get(w) ?? 0
    if (n > 0) count.set(w, n - 1)
    else added++
  }
  let removed = 0
  for (const n of count.values()) removed += n
  return [added, removed]
}

/** Plain text of a block (texts of its leaves, blocks separated by a space). */
export function blockText(n: JSONContent): string {
  if (typeof n.text === 'string') return n.text
  return (n.content ?? []).map(blockText).join(' ')
}

export interface ContentDelta {
  wa: number
  wd: number
  /** blocks changed / added / removed */
  bc: [number, number, number]
}

/**
 * Words added / removed by a content change, from the changed top-level blocks only: blocks pair by id
 * (a changed pair counts its word multiset difference), id-less blocks match by content.
 */
export function contentDelta(prev: JSONContent | null | undefined, next: JSONContent | null | undefined, deps: Pick<CanonDeps, 'blockKey'>): ContentDelta {
  const a = prev?.content ?? []
  const b = next?.content ?? []
  const out: ContentDelta = { wa: 0, wd: 0, bc: [0, 0, 0] }
  const idOf = (x: JSONContent) => (typeof x.attrs?.id === 'string' && x.attrs.id ? (x.attrs.id as string) : null)
  const before = new Map<string, JSONContent>()
  for (const x of a) {
    const id = idOf(x)
    if (id) before.set(id, x)
  }
  const looseBefore = new Map<string, JSONContent[]>()
  for (const x of a) {
    if (idOf(x)) continue
    const k = deps.blockKey(x)
    looseBefore.set(k, [...(looseBefore.get(k) ?? []), x])
  }
  const seen = new Set<string>()
  const added = (x: JSONContent) => {
    const n = wordsOf(blockText(x)).length
    // an empty paragraph appearing (the editor's trailing node, a new line) is no block of words
    if (!n && x.type === 'paragraph') return
    out.bc[1]++
    out.wa += n
  }
  const removed = (x: JSONContent) => {
    const n = wordsOf(blockText(x)).length
    if (!n && x.type === 'paragraph') return
    out.bc[2]++
    out.wd += n
  }
  for (const x of b) {
    const id = idOf(x)
    if (id && before.has(id)) {
      seen.add(id)
      const o = before.get(id)!
      if (o === x || deps.blockKey(o) === deps.blockKey(x)) continue
      out.bc[0]++
      const [wa, wd] = wordDelta(blockText(o), blockText(x))
      out.wa += wa
      out.wd += wd
      continue
    }
    // an id-less block, or one that just got its id (the editor assigns them): matched by content
    const same = looseBefore.get(deps.blockKey(x))
    if (same?.length) {
      same.pop()
      continue
    }
    added(x)
  }
  for (const [id, x] of before) if (!seen.has(id)) removed(x)
  for (const list of looseBefore.values()) for (const x of list) removed(x)
  return out
}
