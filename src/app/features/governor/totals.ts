/**
 * The Regler's totals in this tab (Regler § 5.4) — what the brake compares, synchronously:
 *  - today / this month of the open scope (this workspace's member on this device) and of the person's device line
 *    (every scope metered in this browser while a device limit is set — device.ts deviceLineScopes);
 *  - the open reservations here and in the other tabs (book.ts).
 * Kept in memory from the ledger (tally.ts): this tab's meters as they happen, the other tabs' delta pings (once per
 * batch; an older tab's ping → one debounced read), a full key-range read of the day at start, on becoming visible, after
 * a day roll and every 10 minutes while visible. The month's closed days are records in IndexedDB `one-governor`
 * (`<scope>|day|<yyyy-MM-dd>`, computed once from the ledger — closed days never change). Each read writes the scope's
 * localStorage cache `one.governor.today:<scope>` (the synchronous lower bound after the next boot).
 *
 * Nothing at module load touches storage: startTotals() (install.ts, after first paint) subscribes; loadToday() /
 * loadMonth() read in idle. useGovernorTotals mirrors the numbers for the UI; window.__oneGovernor is the seam (DEV / ?e2e).
 */
import { create } from 'zustand'
import { createStore, delMany, getMany, keys, setMany, type UseStore } from 'idb-keyval'
import type { LedgerEntry } from '@/shared/ai/types'
import { adjust, flushLedger, ledgerDayRead, ledgerOpens, ledgerScopesSince, onLedgerDelta, registerMeter, reserve, settle, type LedgerDelta } from './ledger'
import { ledgerScope } from './scope'
import { bookOthers, onBookChange, reservedNow, reservedOthersNow, startBook } from './book'
import { DEVICE_LINE_SPANS_BROWSER, deviceLimitOf, deviceLineScopes, knownScopes, localKV, mergeScopes, noteScope, type ScopeSeen } from './device'
import { closedDaysBefore, dayOf, monthOf, nextMidnight } from './clock'
import { applyDayRead, closedDaysOf, closedTally, cacheOf, readDayRecord, deltaTally, meterTally, monthSpentOf, newTally, readTodayCache, rollTally, sumTallies, tallyKnown, todayOf, type Tally } from './tally'
import { wipePaused } from './paused'
import { allowOnce, clearAllowances } from './allow'
import { whenIdle } from '../../lib/idle'

export const GOVERNOR_DB = 'one-governor'
export const TODAY_PREFIX = 'one.governor.today:'
const FULL_READ_MS = 10 * 60_000
const OLD_PING_MS = 1000
const SCOPES_FRESH_MS = 60_000

/** What the brake reads — synchronous, O(scopes of the device line). */
export interface TotalsNow {
  /** the open scope's day was read in full (else the numbers are a lower bound: "≈") */
  known: boolean
  day: string
  month: string
  /** the open ledger scope (null: a team account not known yet — no budgeted request) */
  scopeId: string | null
  scope: { spentToday: number; spentMonth: number; unpricedToday: number }
  /** the person's line: every scope it counts (device.ts) */
  device: { spentToday: number; spentMonth: number; scopes: string[] }
  /** open reservations of this tab and the others — of `scope`, else of every scope the device line counts — never `except` */
  reserved(scope?: string, except?: string): number
}

/* ------------------------------------------------------------------ */
/* The one-governor store                                               */
/* ------------------------------------------------------------------ */

let gkv: UseStore | null = null
let gbroken = false
let gopens = 0

/** IndexedDB `one-governor` / `kv` (opened on its first transaction — never at boot). */
export function governorStore(): UseStore | null {
  if (gbroken || typeof indexedDB === 'undefined') return null
  try {
    if (!gkv) {
      const st = createStore(GOVERNOR_DB, 'kv')
      let first = true
      gkv = (mode, cb) => {
        if (first) gopens += 1
        first = false
        return st(mode, cb)
      }
    }
    return gkv
  } catch {
    gbroken = true
    return null
  }
}

/** How often the ledger's and the governor's databases were opened in this tab (the first-paint check: 0 / 0). */
export const governorOpened = (): { ledger: number; governor: number } => ({ ledger: ledgerOpens(), governor: gopens })

/* ------------------------------------------------------------------ */
/* Tallies                                                              */
/* ------------------------------------------------------------------ */

const tallies = new Map<string, Tally>()
let scopesCache: { at: number; list: ScopeSeen[] } | null = null
const noted = new Set<string>()

function readCache(scope: string) {
  try {
    const raw = localKV()?.getItem(`${TODAY_PREFIX}${scope}`)
    return raw ? readTodayCache(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeCache(t: Tally, now: number): void {
  try {
    localKV()?.setItem(`${TODAY_PREFIX}${t.scope}`, JSON.stringify(cacheOf(t, now)))
  } catch {
    /* storage refused: the next boot starts at the ledger read */
  }
}

/** A scope's tally (seeded from its cache the first time this tab needs it). */
function tallyFor(scope: string, now: number): Tally {
  let t = tallies.get(scope)
  if (!t) {
    t = newTally(scope, now, readCache(scope))
    tallies.set(scope, t)
  }
  if (rollTally(t, now)) scheduleRead()
  return t
}

function scopesNow(now: number): ScopeSeen[] {
  if (!scopesCache || now - scopesCache.at > SCOPES_FRESH_MS) scopesCache = { at: now, list: knownScopes(now) }
  return scopesCache.list
}

/** The scopes the device line counts now. */
const deviceScopes = (scope: string | null, now: number): string[] => deviceLineScopes(scope, scopesNow(now))

/** The totals now (sync): the brake, the lamp, the status cell. */
export function totalsNow(now = Date.now()): TotalsNow {
  const scopeId = ledgerScope()
  const day = dayOf(now)
  const t = scopeId ? tallyFor(scopeId, now) : null
  const today = t ? todayOf(t) : { usd: 0, unpriced: 0 }
  const scopes = deviceScopes(scopeId, now)
  const dev = sumTallies(scopes.map((s) => tallyFor(s, now)))
  return {
    known: !!t && tallyKnown(t),
    day,
    month: monthOf(day),
    scopeId,
    scope: { spentToday: today.usd, spentMonth: t ? monthSpentOf(t) : 0, unpricedToday: today.unpriced },
    device: { spentToday: dev.today, spentMonth: dev.month, scopes },
    reserved: (scope?: string, except?: string) => reservedNow(scope !== undefined ? [scope] : DEVICE_LINE_SPANS_BROWSER ? null : scopes, except),
  }
}

/* ------------------------------------------------------------------ */
/* The UI's mirror                                                      */
/* ------------------------------------------------------------------ */

export interface GovernorTotalsView {
  known: boolean
  day: string
  scope: string | null
  spentToday: number
  spentMonth: number
  unpricedToday: number
  deviceToday: number
  deviceMonth: number
  /** other workspaces of this browser counted by the device line */
  otherScopes: number
  reservedHere: number
  reservedOthers: number
  at: number
}

export const useGovernorTotals = create<GovernorTotalsView>(() => ({
  known: false,
  day: '',
  scope: null,
  spentToday: 0,
  spentMonth: 0,
  unpricedToday: 0,
  deviceToday: 0,
  deviceMonth: 0,
  otherScopes: 0,
  reservedHere: 0,
  reservedOthers: 0,
  at: 0,
}))

function publish(): void {
  const now = Date.now()
  const n = totalsNow(now)
  useGovernorTotals.setState({
    known: n.known,
    day: n.day,
    scope: n.scopeId,
    spentToday: n.scope.spentToday,
    spentMonth: n.scope.spentMonth,
    unpricedToday: n.scope.unpricedToday,
    deviceToday: n.device.spentToday,
    deviceMonth: n.device.spentMonth,
    otherScopes: n.device.scopes.filter((s) => s !== n.scopeId).length,
    reservedHere: n.scopeId ? n.reserved(n.scopeId) : 0,
    reservedOthers: reservedOthersNow(),
    at: now,
  })
}

/* ------------------------------------------------------------------ */
/* Live: meters, pings, reads                                           */
/* ------------------------------------------------------------------ */

let started = false
let readTimer: ReturnType<typeof setTimeout> | null = null
let cancelIdle: (() => void) | null = null
let reading: Promise<void> | null = null

/** A scope the cached list does not hold yet (the other tab noted it before its ping): read the list again. */
function seeScope(scope: string): void {
  if (scopesCache && !scopesCache.list.some((s) => s.scope === scope)) scopesCache = null
}

/**
 * A scope metered in this browser today goes on the device line's list — whether a line is set or not (install.ts
 * registers it at boot), so a line set later counts what every workspace spent before it. Once per scope and day; no I/O
 * but that one localStorage write.
 */
export function noteMetered(e: LedgerEntry): void {
  if (!e.scope) return
  const now = Date.now()
  const key = `${e.scope}|${dayOf(now)}`
  if (noted.has(key)) return
  noted.add(key)
  noteScope(e.scope, now)
  scopesCache = null
}

let noting = false

/** Note every metered scope from now on (idempotent; install.ts at boot, before any request). */
export function startNoting(): void {
  if (noting) return
  noting = true
  registerMeter(noteMetered)
}

function onMeter(e: LedgerEntry): void {
  if (!e.scope) return
  const now = Date.now()
  meterTally(tallyFor(e.scope, now), e, now)
  noteMetered(e)
  seeScope(e.scope)
  publish()
}

function onDelta(d: LedgerDelta): void {
  const now = Date.now()
  if (!d.scope) return scheduleRead(OLD_PING_MS)
  // another workspace's first spend today counts on the device line at once, not after the list's 60 s
  seeScope(d.scope)
  if (deltaTally(tallyFor(d.scope, now), d, now) === 'read') scheduleRead(OLD_PING_MS)
  publish()
}

/** A full read soon (debounced; in idle). */
function scheduleRead(delay = 0): void {
  if (!started) return
  if (readTimer) clearTimeout(readTimer)
  readTimer = setTimeout(() => {
    readTimer = null
    cancelIdle?.()
    cancelIdle = whenIdle(() => void loadToday(), { timeout: 3000 })
  }, delay)
}

/** Start following the ledger (idempotent; install.ts after first paint). No storage is touched here. */
export function startTotals(): void {
  if (started || typeof window === 'undefined') return
  started = true
  startNoting()
  registerMeter(onMeter)
  onLedgerDelta(onDelta)
  startBook()
  onBookChange(publish)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRead()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleRead()
  }, FULL_READ_MS)
  // the midnight timer only refreshes the view (it fires late after sleep — the gate rolls the day itself)
  const midnight = () =>
    setTimeout(() => {
      publish()
      scheduleRead()
      midnight()
    }, Math.max(1000, nextMidnight(Date.now()) - Date.now() + 500))
  midnight()
  publish()
}

/** The scopes a read covers: the open one, and the device line's others while a device limit is set. */
function scopesToRead(now: number): string[] {
  const scope = ledgerScope()
  const out = scope ? [scope] : []
  if (deviceLimitOf()) for (const s of deviceLineScopes(scope, knownScopes(now))) if (!out.includes(s)) out.push(s)
  return out
}

/**
 * The device line's list from the ledger's own keys of this month (once each time the line is followed or moves — install.ts):
 * a workspace that spent before anything noted it (an older build's tab, spend before this build) counts too.
 */
export async function noteLedgerScopes(now = Date.now()): Promise<void> {
  const found = await ledgerScopesSince(`${monthOf(dayOf(now))}-01`)
  if (mergeScopes(found, now)) scopesCache = null
}

/** Read today of the open scope (and of the device line's scopes while a device limit is set) from the ledger. */
export function loadToday(): Promise<void> {
  if (reading) return reading
  reading = (async () => {
    scopesCache = null
    for (const s of scopesToRead(Date.now())) {
      const startedAt = Date.now()
      const day = dayOf(startedAt)
      const read = await ledgerDayRead(s, day)
      const t = tallyFor(s, Date.now())
      // a memory-only read (the ledger refused) is no total: the floor and the deltas heard stay, the cache is not written
      if (applyDayRead(t, day, read, startedAt, Date.now())) writeCache(t, Date.now())
    }
    publish()
  })().finally(() => {
    reading = null
  })
  return reading
}

/**
 * Read the month's closed days of the same scopes: their records in `one-governor`, a missing one computed once from a
 * complete ledger read and stored (a closed day never changes). A day the ledger could not read in full writes no record
 * and leaves the month's floor as it was. The brake's start check awaits it when a month limit is set.
 */
export async function loadMonth(): Promise<void> {
  for (const s of scopesToRead(Date.now())) {
    const day = dayOf(Date.now())
    const days = closedDaysBefore(day)
    const st = governorStore()
    const ks = days.map((d) => `${s}|day|${d}`)
    let stored: unknown[] = []
    if (st && ks.length)
      try {
        stored = await getMany(ks, st)
      } catch {
        stored = []
      }
    const r = await closedDaysOf(days, stored, (d) => ledgerDayRead(s, d))
    if (st && r.fresh.length) await setMany(r.fresh.map(([d, rec]) => [`${s}|day|${d}`, rec]), st).catch(() => {})
    if (!r.complete) continue
    const t = tallyFor(s, Date.now())
    if (closedTally(t, day, r.sum, Date.now())) writeCache(t, Date.now())
  }
  publish()
}

/**
 * A closed day's total of a scope (#/regler: yesterday's peak on the dial): its `one-governor` record, else one ledger
 * read of that day (stored when the ledger answered in full — a closed day never changes). null: nothing known.
 */
export async function dayTotal(scope: string, day: string): Promise<number | null> {
  const st = governorStore()
  const key = `${scope}|day|${day}`
  if (day >= dayOf(Date.now())) return null
  let stored: unknown[] = []
  if (st)
    try {
      stored = await getMany([key], st)
    } catch {
      stored = []
    }
  const rec = readDayRecord(stored[0])
  if (rec) return rec.usd
  const r = await closedDaysOf([day], [], (d) => ledgerDayRead(scope, d))
  if (st && r.fresh.length) await setMany(r.fresh.map(([d, x]) => [`${scope}|day|${d}`, x]), st).catch(() => {})
  return r.complete || r.sum > 0 ? r.sum : null
}

/** This scope's derived data goes: its `one-governor` records, its cache, its paused rows (the seam, the device copy). */
export async function wipeGovernorScope(scope = ledgerScope()): Promise<void> {
  if (!scope) return
  tallies.delete(scope)
  try {
    localKV()?.removeItem(`${TODAY_PREFIX}${scope}`)
  } catch {
    /* blocked storage */
  }
  wipePaused(scope)
  const st = governorStore()
  if (!st) return
  try {
    const mine = (await keys(st)).filter((k) => String(k).split('|')[0] === scope)
    if (mine.length) await delMany(mine, st)
  } catch {
    /* storage refused */
  }
}

/* ------------------------------------------------------------------ */
/* e2e seam                                                             */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneGovernor?: unknown }).__oneGovernor = {
    /** the brake's numbers now (functions stripped) */
    totals: () => {
      const n = totalsNow()
      return { known: n.known, day: n.day, month: n.month, scopeId: n.scopeId, scope: n.scope, device: n.device, reserved: n.reserved() }
    },
    reserved: (scope?: string, except?: string) => totalsNow().reserved(scope, except),
    reservedOthers: () => reservedOthersNow(),
    others: bookOthers,
    opened: governorOpened,
    start: startTotals,
    load: async () => {
      await loadToday()
      await loadMonth()
    },
    flush: async () => {
      await flushLedger()
      await reading
    },
    wipe: async () => {
      clearAllowances()
      await wipeGovernorScope()
    },
    reserve: (usd: number, source: string) => reserve(usd, source).id,
    /** E on a one-shot: the token a retry carries as run.allowance */
    allowOnce: (usd?: number) => allowOnce(usd).id,
    adjust: (id: string, usd: number) => adjust(id, usd),
    settle: (id: string) => settle(id),
    view: () => useGovernorTotals.getState(),
    /** the UI pieces in a test frame with fictional props (ui/harness.tsx — loaded only from here) */
    ui: {
      open: async (o?: Record<string, unknown>) => (await import('./ui/harness')).openFrame(o),
      show: async (kind: 'note' | 'halt' | 'plate' | 'month', props: Record<string, unknown>) => (await import('./ui/harness')).showPiece(kind, props),
      log: async () => (await import('./ui/harness')).frameLog(),
      close: async () => (await import('./ui/harness')).closeFrame(),
    },
  }
}
