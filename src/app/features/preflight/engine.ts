/**
 * Preflight's engine: subscribe → dirty → idle reads → `usePreflight`. A source calls `changed()`; the lamp is marked
 * dirty and read after its settle time in an idle callback (never in a render, never on a page-map walk: rows come
 * from the shared row index, built once in the first idle pass). The store is set only when a view differs.
 *
 *  - a minute tick re-reads `tick` lamps while the document is visible; back after ≥ 5 min hidden → every lamp
 *  - a new Preflight day (timer to the set time) → today's record, the tab memory reset, every lamp
 *  - a scope change (another workspace, another member) → readings dropped, acknowledgements reloaded, every lamp
 *  - `last` (lamp ids + levels) is written only when the lit set or a level changes — nothing periodic
 *  - `flush(lampId?)`: read now, without waiting for idle (the seam, tests, a card just acted on)
 */
import { ensureRowIndex, rowIndexStats } from '../../store/rowIndex'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { lampSource, lampSources, onSourcesChanged, type LampId, type LampReading, type LampSourceDef } from './registry'
import { buildView, IDS_MAX, isLit, makeAck, mcCount, panelLamps, sameView, testSchedule, type LampMeta, type ModeEffect } from './lamps'
import { putAcks, pruneAcks, readAcks } from './ack'
import { ackKey, onPrefsChanged, readHidden, readLast, readPrefs, readToday, writeLast, writeLastScope, writeToday } from './prefs'
import { nextOpenAt, preflightDay } from './day'
import { scopeKey, workspaceRef } from './scope'
import { whenIdle, type IdleDeadline } from './idle'
import { usePreflight } from './state'
import { resetQueue, useQueue } from './queue/state'
import { reducedMotion } from './touch'
import { appendLog, enterLog } from './log'
import type { AckRecord, LastCache, Level, LampView, TodayRecord } from './types'

/** a lamp is read this long after its source said "changed" (default) */
const DEFAULT_SETTLE = 250
/** an idle callback runs at the latest after this */
const IDLE_TIMEOUT = 2000
/** back from hidden after this long → every lamp is read again */
const AWAY_MS = 5 * 60_000
const TICK_MS = 60_000
const ERROR_WHY = 'features.preflight.grey.error'

interface Cached {
  /** null: the lamp is not fitted on this device */
  reading: LampReading | null
  ms: number
  at: number
}

/* ---------------- engine state (module memory, this tab) */

const cache = new Map<LampId, Cached>()
const dirty = new Set<LampId>()
/** read first in the next pass (a lamp the person just acted on) */
const urgent = new Set<LampId>()
const gen = new Map<LampId, number>()
const unsubs = new Map<LampId, () => void>()
const reads = new Map<LampId, number[]>()
let passMax = 0
let longTasks = 0
let acks: AckRecord = { v: 1, lamps: {} }
let hidden = new Set<LampId>()
let scope: string | null = null
let started = false
let active = false
let firstPass = false
let timer: ReturnType<typeof setTimeout> | null = null
let dueAt = Infinity
let cancelIdle: (() => void) | null = null
let running = false
let again = false
let stops: Array<() => void> = []
let dayTimer: ReturnType<typeof setTimeout> | null = null
let hiddenSince: number | null = null
let services: (() => () => void) | null = null
let lastWritten: string | null = null
/** lamps lit at the last rebuild (null: not counted yet in this scope) · every lamp went dark in this scope once */
let litBefore: number | null = null
let cleared = false

const S = () => usePreflight.getState()

/* ---------------- scheduling */

function schedule(ms: number): void {
  if (!active) return
  const due = Date.now() + Math.max(0, ms)
  if (timer && dueAt <= due) return
  if (timer) clearTimeout(timer)
  dueAt = due
  timer = setTimeout(() => {
    timer = null
    dueAt = Infinity
    if (cancelIdle) return
    cancelIdle = whenIdle(
      (d) => {
        cancelIdle = null
        void run(d)
      },
      { timeout: IDLE_TIMEOUT },
    )
  }, Math.max(0, ms))
}

/** Mark a lamp to be read again after its settle time (0: as soon as the browser is idle). */
export function markDirty(id: LampId, settle?: number): void {
  if (!active || !scope) return
  dirty.add(id)
  if (settle === 0) urgent.add(id)
  const src = lampSource(id)
  schedule(settle ?? src?.settle ?? DEFAULT_SETTLE)
}

function markAll(): void {
  for (const s of lampSources()) dirty.add(s.id)
  schedule(0)
}

const deadlineNow: IdleDeadline = { timeRemaining: () => 50, didTimeout: true }

async function readOne(src: LampSourceDef): Promise<void> {
  const g = (gen.get(src.id) ?? 0) + 1
  gen.set(src.id, g)
  let fitted = true
  try {
    fitted = src.fitted ? !!src.fitted() : true
  } catch (e) {
    console.warn(`[one] preflight: lamp ${src.id} could not tell whether it is fitted`, e)
    fitted = false
  }
  if (!fitted) {
    cache.set(src.id, { reading: null, ms: 0, at: Date.now() })
    return
  }
  const t0 = performance.now()
  let r: LampReading
  try {
    const out = src.read({ now: Date.now(), signal: new AbortController().signal })
    r = out instanceof Promise ? await out : out
    if (!r || typeof r !== 'object' || typeof r.count !== 'number' || !Array.isArray(r.ids)) throw new Error('not a reading')
    if (r.ids.length > IDS_MAX) r = { ...r, ids: r.ids.slice(0, IDS_MAX) }
  } catch (e) {
    console.warn(`[one] preflight: lamp ${src.id} could not be read`, e)
    r = { state: 'off', count: 0, ids: [], why: ERROR_WHY }
  }
  const ms = performance.now() - t0
  // a newer read of the same lamp started meanwhile (or the scope changed): this one is stale
  if (gen.get(src.id) !== g) return
  cache.set(src.id, { reading: r, ms, at: Date.now() })
  const list = reads.get(src.id) ?? []
  list.push(ms)
  if (list.length > 200) list.shift()
  reads.set(src.id, list)
}

async function run(deadline: IdleDeadline): Promise<void> {
  if (!active || !scope) return
  if (running) {
    again = true
    return
  }
  running = true
  const t0 = performance.now()
  try {
    if (!firstPass) {
      firstPass = true
      // the shared row index: built once per scope, in this first idle pass
      ensureRowIndex()
      for (const s of lampSources()) dirty.add(s.id)
    }
    const order = [...urgent, ...[...dirty].filter((id) => !urgent.has(id))]
    urgent.clear()
    for (const id of order) {
      if (!dirty.has(id)) continue
      dirty.delete(id)
      const src = lampSource(id)
      if (!src) {
        cache.delete(id)
        continue
      }
      await readOne(src)
      if (!deadline.didTimeout && deadline.timeRemaining() < 2 && dirty.size) {
        // out of idle time: the rest in the next idle slice
        again = true
        break
      }
    }
    rebuild()
  } finally {
    running = false
    const took = performance.now() - t0
    passMax = Math.max(passMax, took)
    if (took > 50) longTasks++
    if (again || dirty.size) {
      again = false
      if (dirty.size) schedule(0)
    }
  }
}

/** Read now, without waiting for idle: every dirty lamp, or this one. Resolves when the readings are in. */
export async function flush(lampId?: LampId): Promise<void> {
  if (!active || !scope) return
  if (lampId) dirty.add(lampId)
  if (!firstPass) {
    firstPass = true
    ensureRowIndex()
    for (const s of lampSources()) dirty.add(s.id)
  }
  // a pass running now finishes first (its readings would otherwise come in after ours)
  for (let i = 0; running && i < 100; i++) await new Promise((r) => setTimeout(r, 5))
  await run(deadlineNow)
}

/** Read every lamp now (the seam: one full pass for the perf budget, PB3). Resolves with the pass's ms. */
export async function passAll(): Promise<number> {
  if (!active || !scope) return 0
  for (const s of lampSources()) dirty.add(s.id)
  const t0 = performance.now()
  await flush()
  return performance.now() - t0
}

/* ---------------- views */

function metaOf(src: LampSourceDef): LampMeta {
  const safe = (fn: () => string, fallback: string) => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
  return {
    id: src.id,
    order: src.order,
    legend: safe(() => src.legend(), src.id),
    short: safe(() => src.short(), src.id),
    rule: safe(() => src.rule(), ''),
    thresholds: src.thresholds,
    flash: src.flash !== false,
    master: src.master !== false,
    hasQueue: !!src.queue,
    hasOpen: !!src.open,
    hasFix: !!src.fix,
  }
}

const lastOf = (views: readonly LampView[], at: number): LastCache => ({ at, lamps: views.map((v) => [v.id, v.level] as [LampId, Level]) })
const litKey = (views: readonly LampView[]) =>
  views
    .filter((v) => isLit(v.level))
    .map((v) => `${v.id}:${v.level}`)
    .join(',')

/** Build the views from the cached readings + the acknowledgements, and set the store only where something differs. */
export function rebuild(): void {
  if (!scope) return
  const s = S()
  const defs = lampSources()
  const fitted = defs.filter((d) => cache.get(d.id)?.reading)
  const { shown, overflow } = panelLamps(
    fitted.map((d) => ({ id: d.id, order: d.order, ...(d.after ? { after: d.after } : {}) })),
    { hidden },
  )
  const prev = new Map(s.views.map((v) => [v.id, v]))
  let changed = shown.length !== s.views.length
  const views: LampView[] = shown.map((id, i) => {
    const src = lampSource(id)!
    const c = cache.get(id)!
    const v = buildView(metaOf(src), c.reading!, acks.lamps[id], c.ms, c.at)
    const old = prev.get(id)
    if (old && sameView(old, v)) {
      if (s.views[i] !== old) changed = true
      return old
    }
    changed = true
    return v
  })
  const ready = s.ready || defs.every((d) => cache.has(d.id))
  const lit = views.filter((v) => isLit(v.level)).length
  const mc = mcCount(views)
  const open = views.reduce((n, v) => n + (isLit(v.level) ? v.count : 0), 0)
  const newIds = views.filter((v) => v.isNew).map((v) => v.id)
  const sameNew = newIds.length === s.newIds.length && newIds.every((id, i) => id === s.newIds[i])
  const sameOverflow = overflow.length === s.overflow.length && overflow.every((id, i) => id === s.overflow[i])
  const ackedAt = views.reduce<number | null>((m, v) => {
    const a = acks.lamps[v.id]?.at
    return a && (!m || a > m) ? a : m
  }, null)
  const hiddenN = defs.filter((d) => hidden.has(d.id) && cache.get(d.id)?.reading).length
  const now = Date.now()
  const litChanged = ready && litKey(views) !== litKey(s.views)
  const patch: Partial<typeof s> = {}
  if (changed) patch.views = views
  if (!sameOverflow) patch.overflow = overflow
  if (ready !== s.ready) patch.ready = ready
  if (lit !== s.lit) patch.lit = lit
  if (mc !== s.mc) patch.mc = mc
  if (open !== s.open) patch.open = open
  if (!sameNew) patch.newIds = newIds
  if (ackedAt !== s.ackedAt) patch.ackedAt = ackedAt
  if (hiddenN !== s.hidden) patch.hidden = hiddenN
  if (litChanged && s.ready) patch.lastChange = now
  if (ready && !s.ready && !s.lastChange) patch.lastChange = now
  if (Object.keys(patch).length) usePreflight.setState(patch)
  // the Bordbuch: every lamp went dark (all clear) / a lamp lit again after that
  if (ready) {
    if (litBefore !== null && litBefore > 0 && lit === 0) appendLog({ at: now, k: 'clear' })
    else if (litBefore === 0 && lit > 0 && cleared) appendLog({ at: now, k: 'relit' })
    if (litBefore !== null && litBefore > 0 && lit === 0) cleared = true
    litBefore = lit
  }
  // the last count (for the next boot's hold and the caps before `ready`): only when the lamps or a level changed
  if (ready) {
    const last = lastOf(views, now)
    const key = JSON.stringify(last.lamps)
    if (key !== lastWritten) {
      const stored = readLast(scope)
      if (!stored || JSON.stringify(stored.lamps) !== key) writeLast(scope, last)
      lastWritten = key
      usePreflight.setState({ last })
    }
  }
}

/* ---------------- acknowledging */

/**
 * Acknowledge lamps (↵ / click on a lit cap, MASTER CAUTION, arrivals while the lamp's queue holds focus): their
 * current ids stop being new on this device. `how` goes into the Bordbuch (only when something new was acknowledged).
 */
export function ackLamps(ids: readonly LampId[], how: 'enter' | 'mc' | 'open' = 'enter'): number {
  if (!scope) return 0
  const now = Date.now()
  const entries: AckRecord['lamps'] = {}
  const fresh: LampId[] = []
  for (const id of ids) {
    const r = cache.get(id)?.reading
    if (!r || r.state !== 'ok') continue
    entries[id] = makeAck(r.ids, r.count, now)
    if (S().views.find((v) => v.id === id)?.isNew) fresh.push(id)
  }
  if (!Object.keys(entries).length) return 0
  acks = putAcks(scope, entries)
  for (const id of fresh) appendLog({ at: now, k: 'ack', lamp: id, n: cache.get(id)?.reading?.count ?? 0, how })
  rebuild()
  return Object.keys(entries).length
}

/** MASTER CAUTION: acknowledge every new lamp. */
export function ackAll(): number {
  return ackLamps(
    S().views.filter((v) => v.isNew).map((v) => v.id),
    'mc',
  )
}

/* ---------------- the Preflight day */

function dayNow(): string {
  return preflightDay(Date.now(), readPrefs().at)
}

/** Change today's record (the plate mode's effects, the lamp test). */
export function updateToday(patch: Partial<TodayRecord>): void {
  if (!scope) return
  const day = dayNow()
  // the stored record is the truth (the boot hold wrote `held` there before this tab counted)
  const base: TodayRecord = readToday(scope, day)
  const next: TodayRecord = { ...base, ...patch, day }
  writeToday(scope, next)
  usePreflight.setState({ today: next })
}

/** The plate mode's effect (§5.6): remember the day's first full render, the new lamps at that point, unfold. */
export function applyModeEffect(e: ModeEffect): void {
  const patch: Partial<TodayRecord> = {}
  if (e.shown) patch.shown = true
  if (e.base) patch.base = e.base
  if (Object.keys(patch).length) updateToday(patch)
  if (e.unfold && !useQueue.getState().unfolded) useQueue.setState({ unfolded: true })
}

/** Fold the plate to the strip: the tab forgets the unfold, the new lamps now are the day's base. */
export function fold(): void {
  useQueue.setState({ unfolded: false, lamp: null })
  updateToday({ base: [...S().newIds] })
  appendLog({ at: Date.now(), k: 'fold' })
}

export function unfold(): void {
  if (!useQueue.getState().unfolded) appendLog({ at: Date.now(), k: 'unfold' })
  useQueue.setState({ unfolded: true })
}

function armDay(): void {
  if (dayTimer) clearTimeout(dayTimer)
  if (!active) return
  const at = nextOpenAt(Date.now(), readPrefs().at)
  // timers drift while a laptop sleeps: re-checked by the minute tick too
  dayTimer = setTimeout(() => newDayIfDue(), Math.min(Math.max(1000, at - Date.now() + 50), 2 ** 31 - 1))
}

function newDayIfDue(): void {
  if (!scope) return
  const day = dayNow()
  if (S().today.day === day) {
    armDay()
    return
  }
  usePreflight.setState({ today: readToday(scope, day) })
  resetQueue()
  void enterLog(scope, day)
  markAll()
  armDay()
}

/* ---------------- the lamp test (§5.6) */

let testTimers: Array<ReturnType<typeof setTimeout>> = []

/**
 * The day's lamp test on the first full render once ready: off by preference → "off"; reduced motion → "skipped";
 * else all caps on for 120 ms (phase1), then the lit caps come back `stagger` ms apart (phase2, `data-relit` set by
 * these timers on `grid`'s lit caps), done by ≤ 260 ms. Returns when it ends (ms from now), 0 when nothing runs.
 */
export function runLampTest(grid: HTMLElement | null): number {
  const s = S()
  if (!s.ready || s.today.test || s.testing !== 'off') return 0
  if (!readPrefs().test) {
    updateToday({ test: 'off' })
    appendLog({ at: Date.now(), k: 'test', skipped: 'off' })
    return 0
  }
  if (reducedMotion()) {
    updateToday({ test: 'skipped' })
    appendLog({ at: Date.now(), k: 'test', skipped: 'motion' })
    return 0
  }
  for (const t of testTimers) clearTimeout(t)
  testTimers = []
  const lit = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.pf-cap[data-lit]')) : []
  const plan = testSchedule(lit.length)
  usePreflight.setState({ testing: 'phase1', lastChange: Date.now() })
  updateToday({ test: 'ran' })
  appendLog({ at: Date.now(), k: 'test', ok: s.views.length, of: s.views.length, flash: s.views.filter((v) => v.isNew && v.flash).length })
  testTimers.push(
    setTimeout(() => {
      usePreflight.setState({ testing: 'phase2' })
      lit.forEach((el, i) => {
        testTimers.push(setTimeout(() => el.setAttribute('data-relit', ''), Math.max(0, plan.relitAt(i) - plan.on)))
      })
    }, plan.on),
  )
  testTimers.push(
    setTimeout(() => {
      for (const el of lit) el.removeAttribute('data-relit')
      usePreflight.setState({ testing: 'off' })
    }, plan.end),
  )
  return plan.end
}

/* ---------------- sources */

function subscribeAll(): void {
  const live = new Set(lampSources().map((s) => s.id))
  for (const [id, off] of unsubs) {
    if (live.has(id) && lampSource(id)) continue
    off()
    unsubs.delete(id)
    cache.delete(id)
  }
  for (const src of lampSources()) {
    if (unsubs.has(src.id)) continue
    try {
      unsubs.set(
        src.id,
        src.subscribe(() => markDirty(src.id)),
      )
    } catch (e) {
      console.warn(`[one] preflight: lamp ${src.id} could not subscribe`, e)
      unsubs.set(src.id, () => {})
    }
    dirty.add(src.id)
  }
}

function unsubscribeAll(): void {
  for (const off of unsubs.values()) {
    try {
      off()
    } catch {
      /* gone */
    }
  }
  unsubs.clear()
}

/* ---------------- scope */

function enterScope(next: string | null): void {
  if (next === scope) return
  scope = next
  cache.clear()
  dirty.clear()
  urgent.clear()
  gen.clear()
  firstPass = false
  lastWritten = null
  resetQueue()
  litBefore = null
  cleared = false
  void enterLog(next, next ? dayNow() : '')
  if (!next) {
    usePreflight.setState({ scope: null, ready: false, views: [], overflow: [], lit: 0, mc: 0, open: 0, newIds: [], today: { day: '', base: [] }, last: null, ackedAt: null, hidden: 0, lastChange: 0 })
    return
  }
  writeLastScope(workspaceRef(), next)
  acks = readAcks(next)
  hidden = new Set(readHidden(next))
  const last = readLast(next)
  usePreflight.setState({ scope: next, ready: false, views: [], overflow: [], lit: 0, mc: 0, open: 0, newIds: [], today: readToday(next, dayNow()), last, ackedAt: null, hidden: 0, lastChange: last?.at ?? 0 })
  // acknowledgements of lamps that left the panel long ago go
  pruneAcks(next, new Set(lampSources().map((s) => s.id)), Date.now())
  acks = readAcks(next)
  armDay()
  // the first pass: in idle, within 2 s of boot (the row index is built there)
  cancelIdle?.()
  cancelIdle = null
  markAll()
}

/* ---------------- start / stop */

function activate(): void {
  if (active) return
  active = true
  usePreflight.setState({ on: true })
  subscribeAll()
  stops.push(onSourcesChanged(() => {
    subscribeAll()
    schedule(0)
  }))
  // another workspace or another member: their own acknowledgements, day and lamps
  let prevActive = useCloud.getState().active
  let prevUser = useCloud.getState().user?.id ?? null
  stops.push(
    useCloud.subscribe((c) => {
      const uid = c.user?.id ?? null
      if (c.active === prevActive && uid === prevUser) return
      prevActive = c.active
      prevUser = uid
      enterScope(scopeKey())
    }),
  )
  // the UI's language: legends and second lines are read again
  let lang = useWorkspace.getState().settings.language
  stops.push(
    useWorkspace.subscribe((s) => {
      if (s.settings.language === lang) return
      lang = s.settings.language
      markAll()
    }),
  )
  // another tab acknowledged (or hid) a lamp
  const onStorage = (e: StorageEvent) => {
    if (!scope || !e.key) return
    if (e.key === ackKey(scope)) {
      acks = readAcks(scope)
      rebuild()
    } else if (e.key === `one.preflight.hidden:${scope}`) {
      hidden = new Set(readHidden(scope))
      rebuild()
    }
  }
  window.addEventListener('storage', onStorage)
  stops.push(() => window.removeEventListener('storage', onStorage))
  // the minute tick (visible only) and coming back after a while
  const tick = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    newDayIfDue()
    for (const s of lampSources()) if (s.tick) markDirty(s.id)
  }, TICK_MS)
  stops.push(() => clearInterval(tick))
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now()
      return
    }
    const away = hiddenSince !== null ? Date.now() - hiddenSince : 0
    hiddenSince = null
    newDayIfDue()
    if (away >= AWAY_MS) markAll()
  }
  document.addEventListener('visibilitychange', onVisibility)
  stops.push(() => document.removeEventListener('visibilitychange', onVisibility))
  if (services) {
    try {
      stops.push(services())
    } catch (e) {
      console.warn('[one] preflight: a lamp service did not start', e)
    }
  }
  enterScope(scopeKey())
}

function deactivate(): void {
  if (!active) {
    // off from the start: the state says so (its default is on, read before the engine starts)
    if (usePreflight.getState().on) usePreflight.setState({ on: false, ready: false })
    return
  }
  active = false
  for (const stop of stops.splice(0)) {
    try {
      stop()
    } catch {
      /* gone */
    }
  }
  unsubscribeAll()
  if (timer) clearTimeout(timer)
  timer = null
  dueAt = Infinity
  cancelIdle?.()
  cancelIdle = null
  if (dayTimer) clearTimeout(dayTimer)
  dayTimer = null
  for (const t of testTimers) clearTimeout(t)
  testTimers = []
  scope = null
  cache.clear()
  dirty.clear()
  firstPass = false
  resetQueue()
  void enterLog(null, '')
  usePreflight.setState({ on: false, scope: null, ready: false, views: [], overflow: [], lit: 0, mc: 0, open: 0, newIds: [], testing: 'off' })
}

/**
 * Start Preflight (main.tsx, once, after the Outbox): on while this device's preference says so, idle otherwise.
 * `startServices` runs only while it is on (the built-in lamps' background reads: server proposals, slot priming).
 */
export function startEngine(registerBuiltIns: () => void, startServices: () => () => void): () => void {
  if (started) return () => {}
  started = true
  registerBuiltIns()
  services = startServices
  const apply = () => (readPrefs().on ? activate() : deactivate())
  const off = onPrefsChanged(() => {
    apply()
    // the day may begin at another time now
    if (active) newDayIfDue()
  })
  apply()
  return () => {
    off()
    deactivate()
    started = false
  }
}

/* ---------------- reading out (the seam, the rule card) */

/** The last reading of each lamp (null: not fitted here). */
export function readings(): Record<LampId, LampReading | null> {
  const out: Record<LampId, LampReading | null> = {}
  for (const [id, c] of cache) out[id] = c.reading
  return out
}

/** When a lamp was last read and how long it took. */
export function lastRead(id: LampId): { at: number; ms: number } | null {
  const c = cache.get(id)
  return c ? { at: c.at, ms: c.ms } : null
}

/** The acknowledgement of a lamp on this device. */
export function ackOf(id: LampId) {
  return acks.lamps[id] ?? null
}

export function acksNow(): AckRecord {
  return acks
}

/** Hide / show a lamp on this device. */
export function setHidden(next: ReadonlySet<LampId>): void {
  hidden = new Set(next)
  rebuild()
}

const p95 = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
}

export function stats() {
  const out: Record<LampId, { n: number; p95: number; max: number }> = {}
  for (const [id, xs] of reads) out[id] = { n: xs.length, p95: Number(p95(xs).toFixed(2)), max: Number(Math.max(0, ...xs).toFixed(2)) }
  return { reads: out, passMax: Number(passMax.toFixed(2)), longTasks, rowIndex: rowIndexStats(), active, scope }
}

/** Render counters (PB5): components note their renders here; the seam reads them. */
export const renderCounts: Record<string, number> = {}
export function noteRender(name: string): void {
  renderCounts[name] = (renderCounts[name] ?? 0) + 1
}

/** The engine is counting (the preference is on and a scope is known). */
export const engineActive = (): boolean => active && !!scope
