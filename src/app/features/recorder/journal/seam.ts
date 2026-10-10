/**
 * The test seam `window.__oneRecorder` (DEV or `?e2e` only): drain and flush, read every record, the
 * missing-frame reports, hot-path stats, real store actions under a story step's writer, bulk seeding for
 * the deck's performance, provoking a missing pin, and a raw dump of every `one-recorder` store (privacy).
 */
import { useWorkspace } from '../../../store/store'
import { endRun, fallbackReports, clearFallbackReports, noteRun, withWriter, type RunMeta, type Writer } from '../../../store/writer'
import { dropPins, listPinBodies, listPinMetas, pinToBody } from '../../history/pins'
import { readPinBodies, readPinMetas } from './pins'
import type { JOp, JSegment, LaneKey, Scope } from '../model/types'
import { HI, openJournal, pad13, pad8, scopeRange, STORES, type Batch } from './db'
import { digestWhole, scopeKey } from './key'
import { lostTails } from './recover'
import { scopeNow } from './scope'
import type { Recorder } from './recorder'

export interface StoryStep {
  writer: Writer
  /** store actions, each one update: [name, ...args] */
  calls: Array<[string, ...unknown[]]>
  /** noteRun before the calls (meta or true) */
  note?: RunMeta | true
  /** endRun after the calls */
  end?: boolean
}

interface Range {
  from?: number
  to?: number
  scope?: Scope
}

const on = () => {
  if (typeof window === 'undefined') return false
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
}

const scrub = (v: unknown): unknown => {
  if (typeof CryptoKey !== 'undefined' && v instanceof CryptoKey) return '[CryptoKey]'
  if (Array.isArray(v)) return v.map(scrub)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = scrub(x)
    return o
  }
  return v
}

export function installSeam(rec: Recorder): void {
  if (!on()) return
  const scopeOf = (r?: Range) => r?.scope ?? scopeNow()
  const api = {
    flush: () => rec.flush(),
    settle: (writer?: string) => rec.settle(writer),
    ops: async (r?: Range) => {
      const s = scopeOf(r)
      const j = await openJournal()
      return j.range<JOp>({ store: 'ops', lo: `${s}|${pad13(r?.from ?? 0)}`, hi: `${s}|${pad13(r?.to ?? 9e12)}|${HI}` })
    },
    events: async (r?: Range) => {
      const s = scopeOf(r)
      const j = await openJournal()
      return j.range({ store: 'events', lo: `${s}|${pad13(r?.from ?? 0)}`, hi: `${s}|${pad13(r?.to ?? 9e12)}|${HI}` })
    },
    segments: async (r?: Range) => {
      const s = scopeOf(r)
      const j = await openJournal()
      return j.range<JSegment>({ store: 'segs', index: 'from', lo: [s, r?.from ?? 0], hi: [s, r?.to ?? 9e12] })
    },
    runs: async (r?: Range) => {
      const s = scopeOf(r)
      const j = await openJournal()
      return j.range({ store: 'runs', index: 'from', lo: [s, 0], hi: [s, 9e12] })
    },
    pins: async (scope?: Scope) => {
      const s = scope ?? scopeOf()
      const metas = [...(await listPinMetas(s))].map(([id, meta]) => ({ id, meta }))
      const bodies = [...(await listPinBodies(s))].map(([key, content]) => ({ key, content }))
      return { metas, bodies }
    },
    /** a page pin as a version body (DocDiff / PropsDiff read it unchanged) */
    pinBody: async (pinId: string, scope?: Scope) => {
      const s = scope ?? scopeOf()
      const memory = (await openJournal()).mode === 'memory'
      const meta = (await readPinMetas(s, [pinId], memory)).get(pinId)
      if (!meta || meta.kind !== 'page') return null
      const content = meta.body ? ((await readPinBodies(s, [[meta.page.id, meta.body]], memory)).get(`${meta.page.id}|${meta.body}`) ?? null) : null
      return pinToBody(meta, content)
    },
    kv: async (scope?: Scope) => {
      const s = scope ?? scopeOf()
      const j = await openJournal()
      const [lo, hi] = scopeRange(s)
      return scrub(await j.range({ store: 'kv', lo, hi }))
    },
    unknowns: () => fallbackReports(),
    clearUnknowns: () => clearFallbackReports(),
    stats: () => ({ hot: rec.hotStats(), idleDiffScans: rec.stats.idleDiffScans, queue: rec.queue.length, sliceMax: rec.stats.sliceMax }),
    /** real store actions under the step's writer (one update per action); the calls' results */
    step: async (s: StoryStep) => {
      const st = useWorkspace.getState() as unknown as Record<string, (...a: unknown[]) => unknown>
      if (s.note) noteRun(s.writer, s.note === true ? undefined : s.note)
      const out = withWriter(s.writer, () => s.calls.map(([name, ...args]) => st[name](...args)))
      if (s.end) endRun(s.writer)
      return out
    },
    seedBulk: (o: { events: number; inSpan: number; bigVorgang: number; spanEnd: number }) => seedBulk(rec, scopeOf(), o),
    dropPin: async (segmentId: string) => {
      const j = await openJournal()
      const seg = await j.get<JSegment>('segs', segmentId)
      if (seg?.before) await dropPins(seg.s, [seg.before])
    },
    rawDump: async () => {
      const j = await openJournal()
      const out: Record<string, unknown[]> = {}
      for (const store of STORES) out[store] = scrub(await j.range({ store, lo: '', hi: HI })) as unknown[]
      return out
    },
    /** the scope's digest key, described (never the key itself) */
    key: async (scope?: Scope) => {
      const key = await scopeKey(scope ?? scopeOf())
      let exportRejects = false
      try {
        await crypto.subtle.exportKey('raw', key)
      } catch {
        exportRejects = true
      }
      return { type: key.type, extractable: key.extractable, algorithm: key.algorithm.name, usages: key.usages, exportRejects }
    },
    digest: (text: string, scope?: Scope) => digestWhole(scope ?? scopeOf(), text),
    scope: () => scopeOf(),
    tab: () => rec.tab,
    mode: async () => (await openJournal()).mode,
    open: () => [...rec.processor.open.values()].map((o) => ({ ...o.rec })),
    lostTails: (scope?: Scope) => lostTails(scope ?? scopeOf()),
    saveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => rec.budget.saveStatus(s),
    paused: () => rec.budget.paused,
    prune: (now?: number) => rec.prune(now),
    recover: (scope?: Scope) => rec.recover(scope ?? scopeOf()),
    recovered: (scope?: Scope) => rec.recovered(scope ?? scopeOf()),
    crash: () => rec.crash(),
    wipe: (scope?: Scope) => rec.wipe(scope ?? scopeOf()),
    stop: () => rec.stop(),
  }
  ;(window as unknown as { __oneRecorder?: unknown }).__oneRecorder = api
}

/** Straight to IndexedDB (deck performance only): ops, events, segments and histograms written consistently. */
async function seedBulk(rec: Recorder, scope: Scope, o: { events: number; inSpan: number; bigVorgang: number; spanEnd: number }): Promise<void> {
  const j = await openJournal()
  const lanes: LaneKey[] = ['you', 'agent:bulk', 'terminal', 'mcp:bulk', 'script:bulk', 'sync:folder']
  const spanStart = o.spanEnd - 75 * 60_000
  const monthStart = o.spanEnd - 30 * 24 * 3600_000
  const total = Math.max(o.events, o.inSpan)
  let batch: Batch = { put: { ops: [], events: [], segs: [] }, bump: [] }
  const minutes = new Map<string, Record<LaneKey, number>>()
  const quarters = new Map<string, Record<LaneKey, number>>()
  const laneTotals: Record<LaneKey, { last: number; total: number }> = {}
  const flushBatch = async () => {
    await j.write(batch)
    batch = { put: { ops: [], events: [], segs: [] }, bump: [] }
  }
  for (let i = 0; i < total; i++) {
    const inSpan = i < o.inSpan
    const at = Math.floor(inSpan ? spanStart + ((i + 0.5) / o.inSpan) * (o.spanEnd - spanStart - 1000) : monthStart + ((i - o.inSpan + 0.5) / Math.max(1, total - o.inSpan)) * (spanStart - monthStart))
    const l = lanes[i % lanes.length]
    const big = inSpan && i === Math.floor(o.inSpan / 2)
    const n = big ? o.bigVorgang : 1
    const v = `bulk.${i.toString(36)}`
    const r = l === 'you' ? undefined : `${l === 'sync:folder' ? 'sync:folder' : l}:run${Math.floor(i / 50)}`
    const segId = `${scope}|bulk${i.toString(36)}`
    batch.put!.ops!.push({ k: `${scope}|${pad13(at)}|${v}`, s: scope, at, v, w: l === 'you' ? 'you' : `${l}:x`, l, ...(r ? { r } : {}), n, kinds: 4, p1: `p:bulk${i}`, ops: 1 })
    for (let p = 0; p < n; p++) {
      const place = `p:bulk${big ? `${i}-${p}` : i}`
      batch.put!.events!.push({ k: `${scope}|${pad13(at)}|${v}|${p}`, s: scope, at, v, w: 'x', l, ...(r ? { r } : {}), p: place, pk: 'row', kinds: 4, ops: 1, g: big ? `${segId}-${p}` : segId, lh: 'bulk' })
      batch.put!.segs!.push({ id: big ? `${segId}-${p}` : segId, s: scope, p: place, pk: 'row', w: 'x', sk: r ?? 'you', l, ...(r ? { r } : {}), from: at, to: at, n: 1, before: null, bh: '-', left: null, lastLh: 'bulk', touched: '*', tab: rec.tab, f: 0 })
    }
    const add = (m: Map<string, Record<LaneKey, number>>, key: string) => {
      const cur = m.get(key) ?? {}
      cur[l] = (cur[l] ?? 0) + 1
      m.set(key, cur)
    }
    add(minutes, `${scope}|${pad8(Math.floor(at / 60_000))}`)
    add(quarters, `${scope}|${pad8(Math.floor(at / 900_000))}`)
    laneTotals[l] = { last: Math.max(laneTotals[l]?.last ?? 0, at), total: (laneTotals[l]?.total ?? 0) + 1 }
    if (batch.put!.ops!.length >= 2000 || batch.put!.events!.length >= 5000) await flushBatch()
  }
  const hist = (store: 'minutes' | 'quarters', m: Map<string, Record<LaneKey, number>>) =>
    [...m].map(([k, add]) => ({
      store,
      key: k,
      fn: (cur: Record<string, unknown> | undefined) => {
        const lanes = { ...((cur?.lanes as Record<LaneKey, number>) ?? {}) }
        for (const [l, n] of Object.entries(add)) lanes[l] = (lanes[l] ?? 0) + n
        return { k, s: scope, m: Number(k.slice(k.lastIndexOf('|') + 1)), lanes }
      },
    }))
  batch.bump = [
    ...hist('minutes', minutes),
    ...hist('quarters', quarters),
    {
      store: 'kv',
      key: `${scope}|lanes`,
      fn: (cur) => {
        const l = { ...((cur?.lanes as Record<LaneKey, { last: number; total: number }>) ?? {}) }
        for (const [lane, v] of Object.entries(laneTotals)) l[lane] = { last: Math.max(l[lane]?.last ?? 0, v.last), total: (l[lane]?.total ?? 0) + v.total }
        return { k: `${scope}|lanes`, lanes: l }
      },
    },
    { store: 'kv', key: `${scope}|n|bulk`, fn: (cur) => ({ k: `${scope}|n|bulk`, ops: Number(cur?.ops ?? 0) + total, bytes: Number(cur?.bytes ?? 0) + total * 400 }) },
  ]
  await flushBatch()
}
