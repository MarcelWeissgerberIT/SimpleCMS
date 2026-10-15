/**
 * The one run bus (plan §1.6, §1.7, §6 A24 / A25) — started by startPatchbay() (service.ts; main.tsx wires it, B8):
 *
 *  - the tally: `onRunNote` → runs today per module on this device, counted ONCE per (writer kind, run id) — a note that
 *    tells more about a run counted already adds nothing; a writer without runs (autofill's watch) counts one per note
 *    without meta (runs.ts RunBook). Stored in IndexedDB `one-patchbay` under `<scope>|runs|<day>` (cache.ts), written
 *    with idb-keyval `update` — one transaction, so two tabs never lose a count (automations fire only in their own tab)
 *    and a run another tab counted already is not counted twice (`seen`). Batched (≤ 250 ms, and when the tab is
 *    hidden; never before the app's first paint — B17); a day's record rolls at local midnight (older days of the scope
 *    are dropped on the first write of a day).
 *    Never synced, exported or backed up; wipePatchbay() (cache.ts) removes it with the device copy and the local reset.
 *  - the route: while `#/patchbay` is open the live signal runs (live.ts, loaded then — its own chunk); when the route
 *    closes every live listener goes. Nothing here reads the page map, the ledger or IndexedDB at boot: the store opens
 *    with the first run counted.
 *
 * Public in the area: startRunBus() · readTally(scope?, day?) · onTally(fn) (this tab's counts as they happen) ·
 * flushTally() · forgetTally(scope | null) (a wipe: drop what waits — every wipePatchbay runs it first, cache.ts
 * onPatchbayWipe) · TALLY_CHANNEL (other tabs: "read again").
 * Seam (DEV / `?e2e`): `window.__onePatchbayLive` — start, flush, tally, pending, stats (the live listeners: loaded /
 * active / calls — the spy that proves nothing runs while the route is closed), snapshot, legLog, wipe(scope?).
 */
import { createStore, delMany, keys, type UseStore } from 'idb-keyval'
import { useWorkspace } from '../../../store/store'
import { onRunNote, type RunNote } from '../../../store/writer'
import { parseHash } from '../../../lib/router'
import { onPatchbayWipe, PATCHBAY_DB, PATCHBAY_STORE, readCache, runsKey, updateCache, wipePatchbay } from '../cache'
import { patchbayScope } from '../scope'
import type { ModuleKey } from '../types'
import { addToTally, dayOf, EMPTY_TALLY, isTally, RunBook, type TallyHit, type TallyRecord, type WriterLookups } from './runs'

/** BroadcastChannel name: a tab wrote runs (`{ type: 'runs', scope, day }`) — the others read again. */
export const TALLY_CHANNEL = 'one-patchbay'
const FLUSH_MS = 250

/** What the bus needs of the workspace (O(1) reads). */
export const APP_LOOKUPS: WriterLookups = {
  taskDb: (task) => useWorkspace.getState().pages[task]?.databaseId ?? null,
  mailDb: () => useWorkspace.getState().settings.mail?.databaseId ?? null,
}

/** A counted start, with where it goes. */
export interface TallyNote {
  scope: string
  day: string
  module: ModuleKey
  at: number
}

const book = new RunBook(APP_LOOKUPS)
let pending: Array<{ scope: string; day: string; hit: TallyHit }> = []
/** records this browser could not store (IndexedDB refused): this tab keeps them */
const memory = new Map<string, TallyRecord>()
let timer = 0
let chain: Promise<void> = Promise.resolve()
const pruned = new Set<string>()
const listeners = new Set<(n: TallyNote) => void>()
let started = false
let stopAll: (() => void) | null = null

/** Hear this tab's counted starts as they happen (the live readout adds them at once). Returns the unsubscribe. */
export function onTally(fn: (n: TallyNote) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** One run note → a counted start (or nothing). Never throws into the run that noted (store/writer.ts loops its listeners). */
function onNote(e: RunNote): void {
  try {
    const r = book.read(e)
    if (!r || !r.start) return
    const scope = patchbayScope()
    if (!scope) return
    const at = Date.now()
    const day = dayOf(at)
    pending.push({ scope, day, hit: { module: r.module, at, ...(r.seen ? { seen: r.seen } : {}) } })
    for (const fn of [...listeners]) fn({ scope, day, module: r.module, at })
    flushSoon()
  } catch (err) {
    console.warn('[patchbay] the run bus skipped a note', err)
  }
}

/**
 * B17: `one-patchbay` is never opened before the app's first paint — a run noted while the app boots (a repeating
 * template catching up, a service's first pass) waits in memory until two frames have passed since the bus started
 * (or the tab is hidden: nothing paints there, and leaving still flushes).
 */
let painted = false
const canFlush = (): boolean => painted || (typeof document !== 'undefined' && document.visibilityState === 'hidden')

function flushSoon(): void {
  if (!timer && canFlush()) timer = window.setTimeout(() => void flushTally(), FLUSH_MS)
}

function whenPainted(): void {
  if (painted) return
  if (typeof requestAnimationFrame !== 'function') {
    painted = true
    return
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      painted = true
      if (pending.length) flushSoon()
    }),
  )
}

/** Write what waits now (serialised: one flush after another). */
export function flushTally(): Promise<void> {
  if (timer) {
    window.clearTimeout(timer)
    timer = 0
  }
  const batch = pending
  pending = []
  chain = chain.then(() => (batch.length ? write(batch) : undefined)).catch((err) => console.warn('[patchbay] runs today not stored', err))
  return chain
}

async function write(batch: Array<{ scope: string; day: string; hit: TallyHit }>): Promise<void> {
  const groups = new Map<string, { scope: string; day: string; hits: TallyHit[] }>()
  for (const p of batch) {
    const k = runsKey(p.scope, p.day)
    const g = groups.get(k) ?? { scope: p.scope, day: p.day, hits: [] }
    g.hits.push(p.hit)
    groups.set(k, g)
  }
  for (const [k, g] of groups) {
    const ok = await updateCache<TallyRecord>(k, (cur) => addToTally(cur, g.hits))
    if (ok) void pruneOlder(g.scope, g.day)
    // refused (private mode, blocked site data): this tab keeps its own count
    else memory.set(k, addToTally(memory.get(k), g.hits))
    post({ type: 'runs', scope: g.scope, day: g.day })
  }
}

let kv: UseStore | null = null

/** The first write of a day drops the scope's older days (a day's record rolls at local midnight). */
async function pruneOlder(scope: string, day: string): Promise<void> {
  const k = `${scope}|${day}`
  if (pruned.has(k) || typeof indexedDB === 'undefined') return
  pruned.add(k)
  try {
    kv ??= createStore(PATCHBAY_DB, PATCHBAY_STORE)
    const prefix = `${scope}|runs|`
    const old = (await keys(kv)).filter((x): x is string => typeof x === 'string' && x.startsWith(prefix) && x.slice(prefix.length) < day)
    if (old.length) await delMany(old, kv)
  } catch {
    /* kept: a later day tries again */
  }
}

let bc: BroadcastChannel | null | undefined
function post(msg: { type: 'runs'; scope: string; day: string }): void {
  try {
    if (bc === undefined) bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(TALLY_CHANNEL)
    bc?.postMessage(msg)
  } catch {
    /* no other tab hears it: they read again when they open */
  }
}

/** Runs today (or of `day`) of a scope: what is stored, plus what this tab has not written yet. */
export async function readTally(scope: string | null = patchbayScope(), day: string = dayOf(Date.now())): Promise<TallyRecord> {
  if (!scope) return EMPTY_TALLY
  // every flush begun so far is stored (one begun meanwhile is waited for too): what is not, waits in `pending`
  for (let c = chain; ; c = chain) {
    await c
    if (c === chain) break
  }
  const k = runsKey(scope, day)
  // taken before the read: a flush that begins during it writes after it (IndexedDB keeps the order)
  const mine = pending.filter((p) => p.scope === scope && p.day === day).map((p) => p.hit)
  const stored = (await readCache(k, isTally)) ?? memory.get(k) ?? null
  return mine.length ? addToTally(stored, mine) : (stored ?? EMPTY_TALLY)
}

/** A wipe (the device copy, the local reset): what waits for that scope (null: every scope) is dropped, the book forgets. */
export function forgetTally(scope: string | null): void {
  const inScope = (s: string) => scope === null || s === scope || s.startsWith(`${scope}:u:`)
  pending = pending.filter((p) => !inScope(p.scope))
  for (const k of [...memory.keys()]) if (inScope(k.slice(0, k.indexOf('|')))) memory.delete(k)
  for (const k of [...pruned]) if (inScope(k.slice(0, k.lastIndexOf('|')))) pruned.delete(k)
  book.reset()
}

// every wipe (cloud/device.ts through wipePatchbay — the device copy of a team workspace) drops what waits first
onPatchbayWipe(forgetTally)

/* ------------------------------------------------------------------ the route */

type LiveApi = typeof import('./live')
let live: LiveApi | null = null
let liveStop: (() => void) | null = null
let routeOpen = false

function onRoute(): void {
  const open = parseHash(window.location.hash).name === 'patchbay'
  if (open === routeOpen) return
  routeOpen = open
  if (!open) {
    liveStop?.()
    liveStop = null
    return
  }
  void import('./live')
    .then((m) => {
      live = m
      if (routeOpen && !liveStop) liveStop = m.startLive()
    })
    .catch((err) => console.warn('[patchbay] the live signal did not load', err))
}

/**
 * The bus (startPatchbay → service.ts): the tally's note listener, its flush when the tab is hidden, and the route
 * watch that runs the live signal only while `#/patchbay` is open. Started once; returns the stop.
 */
export function startRunBus(): () => void {
  if (started && stopAll) return stopAll
  started = true
  whenPainted()
  const offNote = onRunNote(onNote)
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushTally()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
  window.addEventListener('hashchange', onRoute)
  onRoute()
  stopAll = () => {
    offNote()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onHide)
    window.removeEventListener('hashchange', onRoute)
    liveStop?.()
    liveStop = null
    routeOpen = false
    void flushTally()
    started = false
    stopAll = null
  }
  return stopAll
}

/* ------------------------------------------------------------------ seam */

const seamOn = (() => {
  try {
    return typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))
  } catch {
    return false
  }
})()

if (seamOn) {
  ;(window as unknown as { __onePatchbayLive?: unknown }).__onePatchbayLive = {
    start: () => {
      startRunBus()
    },
    flush: () => flushTally(),
    tally: (day?: string) => readTally(undefined, day),
    pending: () => pending.length,
    /** the live listeners: loaded (the chunk), active (subscriptions now), calls (every listener call so far) */
    stats: () => (live ? live.liveStats() : { loaded: false, active: 0, calls: 0 }),
    snapshot: () => (live ? live.liveView() : null),
    legLog: () => (live ? live.legLog() : []),
    /** the device-copy wipe as cloud/device.ts runs it: what waits is dropped (the wipe hook), then the records go */
    wipe: async (scope?: string | null) => {
      await wipePatchbay(scope === undefined ? patchbayScope() : scope)
    },
  }
}
