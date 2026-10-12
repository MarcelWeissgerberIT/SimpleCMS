/**
 * The one loader for reading a window (R2) and planning an eject (R3): W's segments on every place it touched in
 * [a, b) (a lane, or one run of it) plus the derived ones its writes in [a, b) caused (within DERIVED_HORIZON), everyone
 * else's segments on those places from W's first touch on (open ones count as having touched anything; synced copies
 * of W and an undone eject of W are transparent), virtual foreigns where the chain of digests breaks or a segment says
 * GAP, W's events, the schema events of the databases involved, lost tails, live eject records and the run records. Read-only: it flushes what
 * waits (R2) — never settles and never flushes editors; only the planner (R3) settles first.
 */
import type { ID } from '../../../store/types'
import { placeCanon, wholeCanon } from '../model/canon'
import { keySet, propKeysAt, propKeysOf, restrictRowParts } from '../model/rowkeys'
import { causedByW, foreignOf, namesW, placeChain } from '../model/chain'
import { causeChain, parseWriterKey } from '../model/writerKeys'
import { F, type EjectRecord, type JEvent, type JRun, type JSegment, type LostTail, type PlaceKey, type PlaceWindow, type Scope, type WindowSel } from '../model/types'
import { currentPlaces } from '../journal/current'
import { deps } from '../journal/deps'
import { openJournal, type Journal } from '../journal/db'
import { digestWhole } from '../journal/key'
import { segmentsOf, runOf } from '../journal/query'
import { lostTails } from '../journal/recover'
import { recorder } from '../journal/recorder'
import { pinObjectOf } from './digest'

export interface WindowData {
  sel: WindowSel
  places: Map<PlaceKey, PlaceWindow>
  runs: Record<string, JRun>
  lostTails: LostTail[]
  ejects: EjectRecord[]
  /** schema events of the window's databases from W's first touch on (propKeysAt) */
  schemaEvents: Map<ID, JEvent[]>
  /** more than MAX_PLACES places: how many (only the first LIST_PLACES are loaded) */
  tooMany?: number
}

/** Above this many places the window is "too many" (R2 lists the first LIST_PLACES, R3 refuses above 2,000). */
export const MAX_PLACES = 5000
export const LIST_PLACES = 2000
const HOUR = 3600_000
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const IN_FLIGHT = 8
/** derived writers whose segments go with the writer that caused them */
const DERIVED = new Set(['automation', 'autofill', 'kit'])
/** a follow-up (automation, autofill, kit) lands at most this long after the write that caused it */
export const DERIVED_HORIZON = 10 * 60_000

/** Run `fn` over `items`, `n` at a time. */
async function pool<T, R>(items: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/** Segments on one place from `from` on (index `place`). */
const placeRange = (j: Journal, s: Scope, p: PlaceKey, from: number) => j.range<JSegment>({ store: 'segs', index: 'place', lo: [s, p, from], hi: [s, p, Number.MAX_SAFE_INTEGER] })

/** Read a window. `settle` (the planner, R3): W's open segments close first — the caller flushed the editors. */
export async function loadWindow(sel: WindowSel, opts?: { settle?: boolean }): Promise<WindowData> {
  const rec = recorder()
  if (opts?.settle) await rec?.settle(sel.run ?? sel.lane, { causes: true })
  else await rec?.flush().catch(() => undefined)
  const j = await openJournal()
  const s = sel.scope
  const now = Date.now()
  const memory = j.mode === 'memory'

  // live eject records of the last 30 days (Δ8: "ejected" is read from them, never from JRun.state)
  const ejects = (await j.range<EjectRecord>({ store: 'ejects', index: 'at', lo: [s, now - MONTH], hi: [s, now] })).filter((e) => e.state !== 'aborted')
  const undone = new Set(ejects.filter((e) => e.undone && (e.writer === (sel.run ?? sel.lane) || e.lane === sel.lane)).map((e) => e.id))

  // 1. W's own segments (synced copies are never W's)
  const own = (await segmentsOf(s, sel.run ? { run: sel.run } : { lane: sel.lane }, sel.a, sel.b)).filter((g) => !(g.f & F.COPY))
  const ownIds = new Set(own.map((g) => g.id))
  if (!own.length) return { sel, places: new Map(), runs: {}, lostTails: [], ejects, schemaEvents: new Map() }
  let minFrom = Math.min(...own.map((g) => g.from))

  // 2. derived segments (automation / autofill / kit) that W's writes IN THE WINDOW caused — they land after b, within
  // the horizon: one bounded range; a follow-up's cause is W's latest write before it (by its writer key where the
  // cause names one), and that write must lie in [a, b) — a follow-up of W's later (or earlier) write is not W's here
  const derivedIds = new Set<string>()
  const reach = Math.min(now, sel.b + DERIVED_HORIZON)
  const derived = (await j.range<JSegment>({ store: 'segs', index: 'from', lo: [s, sel.a], hi: [s, reach + 1] })).filter((g) => !ownIds.has(g.id) && !(g.f & F.COPY) && DERIVED.has(parseWriterKey(g.w).kind) && causedByW(sel, g.cause))
  if (derived.length) {
    const wEvents = sel.run
      ? await j.range<JEvent>({ store: 'events', index: 'run', lo: [s, sel.run], hi: [s, sel.run] })
      : await j.range<JEvent>({ store: 'events', index: 'lane', lo: [s, sel.lane, sel.a - DERIVED_HORIZON], hi: [s, sel.lane, reach + 1] })
    const writes = wEvents.filter((e) => !((e.f ?? 0) & F.COPY)).map((e) => ({ at: e.at, end: e.t2 ?? e.at, own: parseWriterKey(e.w).own }))
    for (const g of derived) {
      const named = new Set(causeChain(g.cause ?? '').filter((k) => namesW(sel, k)))
      const near = writes.filter((x) => x.at <= g.from && g.from - Math.min(x.end, g.from) <= DERIVED_HORIZON).map((x) => ({ ...x, t: Math.min(x.end, g.from) }))
      const byKey = near.filter((x) => named.has(x.own))
      const cause = (byKey.length ? byKey : near).reduce<{ t: number } | null>((m, x) => (!m || x.t > m.t ? x : m), null)
      if (!cause || cause.t < sel.a || cause.t >= sel.b) continue
      own.push(g)
      ownIds.add(g.id)
      derivedIds.add(g.id)
    }
  }
  minFrom = Math.min(minFrom, ...own.map((g) => g.from))

  // places in order of W's first touch; above MAX_PLACES only the first LIST_PLACES are read
  const firstOf = new Map<PlaceKey, number>()
  for (const g of own) firstOf.set(g.p, Math.min(firstOf.get(g.p) ?? Infinity, g.from))
  let placeKeys = [...firstOf.keys()].sort((x, y) => firstOf.get(x)! - firstOf.get(y)!)
  const tooMany = placeKeys.length > MAX_PLACES ? placeKeys.length : undefined
  if (tooMany) placeKeys = placeKeys.slice(0, LIST_PLACES)
  const wanted = new Set(placeKeys)

  // 3. every segment on those places from W's first touch on
  const byPlace = new Map<PlaceKey, JSegment[]>()
  for (const p of placeKeys) byPlace.set(p, [])
  if (minFrom >= now - 6 * HOUR) {
    for (const g of await j.range<JSegment>({ store: 'segs', index: 'from', lo: [s, minFrom], hi: [s, now + 1] })) if (wanted.has(g.p)) byPlace.get(g.p)!.push(g)
  } else {
    await pool(placeKeys, IN_FLIGHT, async (p) => byPlace.get(p)!.push(...(await placeRange(j, s, p, firstOf.get(p)!))))
  }
  // W's own segments that began before the range (a window reaching back): never lost
  for (const g of own) if (wanted.has(g.p) && !byPlace.get(g.p)!.some((x) => x.id === g.id)) byPlace.get(g.p)!.push(g)

  // the window's databases now (rows compare over the property keys a database had)
  const dbIds = new Set<ID>()
  for (const g of own) if (g.db && wanted.has(g.p)) dbIds.add(g.db)
  const objs = currentPlaces(placeKeys)

  // 5. schema events of those databases from W's first touch on
  const schemaEvents = new Map<ID, JEvent[]>()
  await pool([...dbIds], IN_FLIGHT, async (db) => {
    schemaEvents.set(db, await j.range<JEvent>({ store: 'events', index: 'place', lo: [s, `s:${db}`, minFrom], hi: [s, `s:${db}`, Number.MAX_SAFE_INTEGER] }))
  })
  const propsNow = (db: ID | undefined) => {
    if (!db) return []
    for (const o of objs.values()) if (o?.kind === 'row' && o.page.databaseId === db && o.db) return o.db.properties
    return []
  }

  // chain breaks: consecutive segments whose before is not what the one before left (bhr explains a property added
  // or deleted; segments without one — older tapes, another tab's first write — are re-digested from their pin)
  type Break = { p: PlaceKey; prev: JSegment; next: JSegment }
  const breaks: Break[] = []
  const chains = new Map<PlaceKey, JSegment[]>()
  for (const p of placeKeys) {
    const { chain, breaks: br } = placeChain(sel, byPlace.get(p)!, ownIds, undone)
    chains.set(p, chain)
    for (const [prev, next] of br) breaks.push({ p, prev, next })
  }
  const unexplained = new Set<string>()
  await pool(breaks, IN_FLIGHT, async ({ p, prev, next }) => {
    if (next.bhr || !next.before || next.pk !== 'row' || !prev.left) return void unexplained.add(next.id)
    const obj = await pinObjectOf(s, next.before, p, memory).catch(() => null)
    if (!obj || obj.kind !== 'row') return void unexplained.add(next.id)
    const prevKeys = propKeysOf(prev.left.parts)
    const keys = prevKeys ? keySet(prevKeys) : propKeysAt(propsNow(prev.db), schemaEvents.get(prev.db ?? '') ?? [], prev.to)
    if (!keys) return void unexplained.add(next.id)
    const d = await digestWhole(s, wholeCanon(restrictRowParts(placeCanon(obj, deps).parts, keys)))
    if (d !== prev.left.h) unexplained.add(next.id)
  })

  // 4. W's events, per own segment
  const ownList = own.filter((g) => wanted.has(g.p))
  const eventsBySeg = new Map<string, JEvent[]>()
  await pool(ownList, IN_FLIGHT * 2, async (g) => eventsBySeg.set(g.id, await j.range<JEvent>({ store: 'events', index: 'seg', lo: g.id, hi: g.id })))

  const places = new Map<PlaceKey, PlaceWindow>()
  const cloud = s.startsWith('cloud:')
  for (const p of placeKeys) {
    const mine = ownList.filter((g) => g.p === p).sort((x, y) => x.from - y.from)
    const first = mine[0]
    const ownEvents = mine.flatMap((g) => eventsBySeg.get(g.id) ?? []).sort((x, y) => x.at - y.at || (x.k < y.k ? -1 : 1))
    const foreign = foreignOf(chains.get(p) ?? [], ownIds, unexplained)
    // cut: one of W's own (not derived) segments has events outside [a, b)
    const cut = ownEvents.some((e) => !derivedIds.has(e.g) && (e.at < sel.a || (e.t2 ?? e.at) >= sel.b))
    const unavailable = cloud && !objs.get(p)
    places.set(p, { p, pk: first.pk, ...(first.db ? { db: first.db } : {}), own: mine, foreign, ownEvents, cut, ...(unavailable ? { unavailable: true } : {}) })
  }

  // 6. lost tails over the window's reach; 7. the run records
  const tails = (await lostTails(s)).filter((t) => t.to >= minFrom && t.from <= now)
  const runKeys = [...new Set(ownList.map((g) => g.r).filter((r): r is string => !!r))]
  const runs: Record<string, JRun> = {}
  await pool(runKeys, IN_FLIGHT, async (r) => {
    const run = await runOf(s, r)
    if (run) runs[r] = run
  })
  return { sel, places, runs, lostTails: tails, ejects, schemaEvents, ...(tooMany ? { tooMany } : {}) }
}

/** What a loaded window holds, counted (the seam: no ids of content, no digests). */
export function windowCounts(d: WindowData): { places: number; own: number; foreign: Record<string, Array<{ lane: string | null; at: number }>>; breaks: number; tooMany: number | null; tails: number } {
  const foreign: Record<string, Array<{ lane: string | null; at: number }>> = {}
  let own = 0
  let breaks = 0
  for (const [p, w] of d.places) {
    own += w.own.length
    if (w.foreign.length) foreign[p] = w.foreign.map((f) => ({ lane: f.lane, at: f.from }))
    breaks += w.foreign.filter((f) => f.lane === null).length
  }
  return { places: d.places.size, own, foreign, breaks, tooMany: d.tooMany ?? null, tails: d.lostTails.length }
}
