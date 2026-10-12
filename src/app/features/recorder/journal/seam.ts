/**
 * The test seam `window.__oneRecorder` (DEV or `?e2e` only): drain and flush, read every record, the
 * missing-frame reports, hot-path stats, real store actions under a story step's writer, bulk seeding for
 * the deck's performance, provoking a missing pin, and a raw dump of every `one-recorder` store (privacy).
 */
import { useWorkspace } from '../../../store/store'
import { currentWriter, endRun, fallbackReports, clearFallbackReports, formatWriterKey, noteRun, withWriter, type RunMeta, type Writer } from '../../../store/writer'
import { dropPins, listPinBodies, listPinMetas, pinToBody } from '../../history/pins'
import { readPinBodies, readPinMetas } from './pins'
import type { JOp, JSegment, LaneKey, PlaceKey, Scope } from '../model/types'
import { dayKey, HI, openJournal, pad13, pad8, scopeRange, STORES, type Batch } from './db'
import { journalBytes, pruneHumanPins, pruneTodayPins } from './prune'
import { digestWhole, scopeKey } from './key'
import { lostTails } from './recover'
import { scopeNow } from './scope'
import type { Recorder } from './recorder'
import { isSettled, markSettled, unmarkSettled } from '../settled'
import { ejectHook } from '../eject/hook'

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

const spied: { list: Array<{ w: string | null; kind: string | null; pages: boolean; dbs: boolean }>; off: (() => void) | null } = { list: [], off: null }

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
    stats: () => ({ hot: rec.hotStats(), items: rec.itemStats(), idleDiffScans: rec.stats.idleDiffScans, queue: rec.queue.length, sliceMax: rec.stats.sliceMax, itemMax: rec.stats.itemMax, taskMax: rec.stats.taskMax, long: rec.stats.long.slice(), waiting: rec.processor.waiting }),
    resetStats: () => rec.resetStats(),
    /** real store actions under the step's writer (one update per action); the calls' results */
    step: async (s: StoryStep) => {
      const st = useWorkspace.getState() as unknown as Record<string, (...a: unknown[]) => unknown>
      if (s.note) noteRun(s.writer, s.note === true ? undefined : s.note)
      const out = withWriter(s.writer, () => s.calls.map(([name, ...args]) => st[name](...args)))
      if (s.end) endRun(s.writer)
      return out
    },
    seedBulk: (o: { events: number; inSpan: number; bigVorgang: number; spanEnd: number }) => seedBulk(rec, scopeOf(), o),
    /** a window read as the plate and the read dialog read it: meters, the held set, groups (counts, place keys) */
    readWindow: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }) => {
      const { readWindow, heldMarks } = await import('../window/read')
      const m = await readWindow({ ...sel, scope: sel.scope ?? scopeOf() }, Date.now())
      const outcomes: Record<string, number> = {}
      for (const v of m.verdicts.values()) outcomes[v.outcome] = (outcomes[v.outcome] ?? 0) + 1
      return {
        meters: m.meters,
        held: m.held.map((v) => ({ p: v.p, reason: v.reason ?? null, by: v.by, at: v.firstForeignAt ?? null })),
        marks: heldMarks(m),
        partial: m.partial.map((v) => ({ p: v.p, reason: v.reason ?? null })),
        groups: m.groups.map((g) => ({ kind: g.kind, n: g.items.length })),
        outcomes,
        incomplete: m.incomplete,
        extendTo: m.extendTo ?? null,
        unavailable: m.unavailable,
        tooMany: m.tooMany ?? null,
      }
    },
    /** an eject planned as its dialog plans it: counts and every place's outcome, why, parts (ids only, no content) */
    planEject: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }, opts?: { undoOf?: string }) => {
      const { planEject } = await import('../eject/plan')
      const t0 = performance.now()
      const r = await planEject({ ...sel, scope: sel.scope ?? scopeOf() }, opts)
      const ms = performance.now() - t0
      if ('refused' in r) return { refused: r.refused }
      const { plan } = r
      return {
        ms,
        counts: plan.counts,
        heldBy: plan.heldBy,
        extendTo: plan.extendTo ?? null,
        places: plan.places.map((x) => ({ p: x.p, pk: x.pk, outcome: x.outcome, reason: x.reason ?? null, why: x.why ?? null, back: x.parts.back, held: x.parts.held, hunks: x.hunks ?? null, fates: x.fates ?? null, notRestored: x.notRestored, toRoot: !!x.toRoot, changes: x.changes })),
      }
    },
    /** plan and eject a window as its dialog does (`discardPending` on by default) — the record's ids, outcomes, counts */
    eject: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }, opts?: { discardPending?: boolean; label?: string; undoOf?: string }) => {
      const [{ planEject }, { ejectNow }] = await Promise.all([import('../eject/plan'), import('../eject/commit')])
      const full = { ...sel, scope: sel.scope ?? scopeOf() }
      const planned = await planEject(full, opts?.undoOf ? { undoOf: opts.undoOf } : undefined)
      if ('refused' in planned) return { refused: planned.refused }
      const r = await ejectNow(full, planned, { discardPending: opts?.discardPending ?? true, ...(opts?.label ? { label: opts.label } : {}) })
      if ('refused' in r) return { refused: r.refused }
      if ('replan' in r) return { replan: true }
      return { id: r.record.id, state: r.record.state, counts: r.record.counts, outcomes: r.record.outcomes, changes: r.record.changes, agent: r.record.agent ?? null, slips: r.record.slips ?? 0 }
    },
    /** a spy on the store's updates (pages / databases): each one's writer key (null: no frame) — on, then off → the list */
    spy: (on: boolean) => {
      if (on) {
        spied.list = []
        spied.off?.()
        spied.off = useWorkspace.subscribe((s, p) => {
          if (s.pages === p.pages && s.databases === p.databases) return
          const w = currentWriter()
          spied.list.push({ w: w ? formatWriterKey(w) : null, kind: w?.kind ?? null, pages: s.pages !== p.pages, dbs: s.databases !== p.databases })
        })
        return []
      }
      spied.off?.()
      spied.off = null
      return spied.list
    },
    /** ejectNow with an already planned window whose run is `run` (refusals: an eject: run, a team scope …) */
    ejectRaw: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }) => {
      const { ejectNow } = await import('../eject/commit')
      const empty = { places: [], counts: { ops: 0, all: 0, back: 1, held: 0, partial: 0, already: 0, rows: 0, newRows: 0, pages: 0, schema: 0, views: 0 }, heldBy: [], incomplete: false, refs: new Map(), keys: new Map() }
      const r = await ejectNow({ ...sel, scope: sel.scope ?? scopeOf() }, { plan: { sel: { ...sel, scope: sel.scope ?? scopeOf() }, ...empty }, input: {} } as never, { discardPending: false })
      return 'refused' in r ? { refused: r.refused } : 'replan' in r ? { replan: true } : { id: r.record.id }
    },
    /** the eject's Undo (memory in this tab, else the planner's way back) */
    undoEject: async (id: string) => (await import('../eject/undo')).undoEject(id),
    /** the scope's eject records (ids, states, outcomes, counts — no text) */
    ejects: async (scope?: Scope) => (await import('../eject/records')).ejectsOf(scope ?? scopeOf()),
    /** finish the half-done ejects of gone tabs now (the boot does it after recovery) */
    finishEjects: async (scope?: Scope) => (await import('../eject/boot')).finishEjects(scope ?? scopeOf()),
    /** the dialog's facts about the sources of a planned window */
    ejectFacts: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }) => {
      const [{ planEject }, { facts }] = await Promise.all([import('../eject/plan'), import('../eject/sources')])
      const planned = await planEject({ ...sel, scope: sel.scope ?? scopeOf() })
      return 'refused' in planned ? { refused: planned.refused } : facts(planned)
    },
    /** the commit's test hook: 'afterWrite' stops after the store update, 'beforeSettle' / 'beforeCheck' wait (after the write / before the re-check) until releaseEject() */
    get ejectHook() {
      return ejectHook.at
    },
    set ejectHook(v: 'afterWrite' | 'beforeSettle' | 'beforeCheck' | null) {
      ejectHook.at = v
    },
    ejectWaiting: () => ejectHook.waiting,
    releaseEject: () => ejectHook.release?.(),
    /** a window loaded as the reading and the eject load it — counts only (places, own, foreign per place, breaks) */
    loadWindow: async (sel: { lane: LaneKey; run?: string; a: number; b: number; scope?: Scope }) => {
      const { loadWindow, windowCounts } = await import('../window/load')
      return windowCounts(await loadWindow({ ...sel, scope: sel.scope ?? scopeOf() }))
    },
    /** what an eject settled (features/recorder/settled.ts) — marks as the eject's sources set them */
    markSettled: (runKey: string, ids: string[], ref?: string) => markSettled(runKey, ids, ref),
    unmarkSettled: (runKey: string, ids: string[], ref?: string) => unmarkSettled(runKey, ids, ref),
    isSettled: (runKey: string, id?: string) => isSettled(runKey, id),
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
    /** the queue recorded, then the segment records this tab holds in memory (of a place, or all) */
    held: (place?: string) => rec.heldSegments(place as PlaceKey | undefined),
    lostTails: (scope?: Scope) => lostTails(scope ?? scopeOf()),
    saveStatus: (s: 'idle' | 'saving' | 'saved' | 'error', error?: { name: string; message?: string }) => rec.budget.saveStatus(s, error ? Object.assign(new Error(error.message ?? ''), { name: error.name }) : undefined),
    /** a team copy's write failed (store/storageHealth.ts) */
    copyFailed: (name = 'QuotaExceededError') => rec.budget.copyFailed(Object.assign(new Error('copy'), { name })),
    /** the journal's size as the budget counts it (Σ of the day sizes), and what the stores hold (recomputed) */
    bytes: async () => ({ counted: await journalBytes(), held: await heldBytes() }),
    /** the budget's next check with a storage estimate of the test's (quota / usage in bytes) — and limits of its own */
    budgetCheck: async (est?: { quota: number; usage: number }, limits?: { cap: number; headroom: number }) => {
      const nav = navigator.storage as unknown as { estimate: () => Promise<StorageEstimate> }
      const real = nav.estimate
      const realLimits = rec.budget.limitsFor
      if (est) nav.estimate = async () => ({ quota: est.quota, usage: est.usage })
      if (limits) rec.budget.limitsFor = () => limits
      try {
        rec.budget.forgetEstimate()
        return { allowed: await rec.budget.allowed(), paused: rec.budget.paused }
      } finally {
        nav.estimate = real
        rec.budget.limitsFor = realLimits
        rec.budget.forgetEstimate()
      }
    },
    /** the journal's next `n` record writes fail for lack of room (QuotaExceededError), before they touch IndexedDB */
    failJournalWrites: async (n: number) => {
      const j = await openJournal()
      const w = j as unknown as { write: (...a: unknown[]) => Promise<void>; __failing?: { n: number } }
      if (!w.__failing) {
        const orig = w.write.bind(j)
        const failing = { n: 0 }
        w.__failing = failing
        w.write = async (...a: unknown[]) => {
          // the flush's record writes only (a prune's deletes and counters go through)
          const b = a[0] as Batch | undefined
          if (failing.n > 0 && (b?.put?.ops?.length || b?.put?.events?.length || b?.put?.segs?.length)) {
            failing.n--
            throw new DOMException('no room', 'QuotaExceededError')
          }
          return orig(...a)
        }
      }
      w.__failing.n = n
    },
    /** what waits in memory (records, digest jobs) */
    waitingDetail: () => ({ waiting: rec.processor.waiting, jobs: rec.processor.jobCount }),
    paused: () => rec.budget.paused,
    prune: (now?: number) => rec.prune(now),
    /** the budget's pin steps: every pin of today ('today', share 1) or the person's older than 7 days ('human') */
    prunePins: (kind: 'today' | 'human', now?: number) => (kind === 'today' ? pruneTodayPins(now ?? Date.now(), {}, 1) : pruneHumanPins(now ?? Date.now(), {})),
    recover: (scope?: Scope) => rec.recover(scope ?? scopeOf()),
    recovered: (scope?: Scope) => rec.recovered(scope ?? scopeOf()),
    crash: () => rec.crash(),
    wipe: (scope?: Scope) => rec.wipe(scope ?? scopeOf()),
    stop: () => rec.stop(),
  }
  ;(window as unknown as { __oneRecorder?: unknown }).__oneRecorder = api
}

/** What the journal's stores and its pins hold, measured record by record (the budget spec compares it with the count). */
async function heldBytes(): Promise<number> {
  const j = await openJournal()
  const size = (v: unknown) => JSON.stringify(scrub(v) ?? null).length * 2
  let n = 0
  // the records the budget counts (histograms and the kv bookkeeping are small and not counted)
  for (const store of ['ops', 'events', 'segs', 'runs'] as const) for (const r of await j.range<Record<string, unknown>>({ store, lo: '', hi: HI })) n += size(r)
  for (const scope of await scopesOf(j)) {
    for (const [, m] of await listPinMetas(scope)) n += size(m)
    for (const [, b] of await listPinBodies(scope)) n += size(b)
  }
  return n
}

async function scopesOf(j: Awaited<ReturnType<typeof openJournal>>): Promise<Scope[]> {
  const out = new Set<Scope>()
  for (const k of await j.keys({ store: 'kv', lo: '', hi: HI })) out.add(k.slice(0, k.indexOf('|')) as Scope)
  return [...out]
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
  const days = new Map<string, number>()
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
    days.set(dayKey(scope, at), (days.get(dayKey(scope, at)) ?? 0) + 1)
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
    ...[...days].map(([k, n]) => ({ store: 'kv' as const, key: k, fn: (cur: Record<string, unknown> | undefined) => ({ k, ops: Number(cur?.ops ?? 0) + n, bytes: Number(cur?.bytes ?? 0) + n * 400 }) })),
  ]
  await flushBatch()
}
