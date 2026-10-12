/**
 * The ledger (Regler P1): one entry per AI response, per device and member — IndexedDB `one-ledger` / `kv`, keys
 * `<scope>|<yyyy-mm-dd>|<id>` (the local day), never synced, exported, backed up or sent to a provider; cloud/device.ts
 * and the local reset wipe it. Ids, numbers, data classes and outcomes only — never page text.
 *  - meter(entry): this tab's subscribers (registerMeter) hear of it at once; it is written batched (one setMany per
 *    frame) and the other tabs are pinged on BroadcastChannel `one-ledger` to read again (onLedgerPing). Every tab
 *    writes only its own entries under unique keys, so nothing is counted twice.
 *  - ledgerEntries({ from, to }) / ledgerTotals(by): this scope's entries (this tab's unwritten ones included)
 *  - reserve(usd, source) / settle(id): what the requests in flight in this tab may still cost (the brake reads it later)
 *  - days older than 90 are deleted once a day; the store opens on the first meter or read — never on the boot path
 * A browser that refuses IndexedDB (or a team tab whose account is not known yet) keeps the entries in memory for the
 * tab: a request is never failed for its bookkeeping.
 */
import { createStore, delMany, getMany, keys, setMany, type UseStore } from 'idb-keyval'
import type { CostSource, LedgerEntry, Reservation, Usage } from '@/shared/ai/types'
import { addUsage, ZERO_USAGE } from '@/shared/ai/usage'
import { newId } from '../../lib/ids'
import { ledgerScope } from './scope'

export const LEDGER_DB = 'one-ledger'
/** entries are kept this many days */
export const LEDGER_DAYS = 90
const DAY_MS = 86_400_000
/** entries this tab cannot write (kept in memory) — the newest */
const MEMORY_MAX = 2000
/** one write per frame */
const FLUSH_MS = 16

let kv: UseStore | null = null
let broken = false

function store(): UseStore | null {
  if (broken || typeof indexedDB === 'undefined') return null
  try {
    return (kv ??= createStore(LEDGER_DB, 'kv'))
  } catch {
    broken = true
    return null
  }
}

function fail(e: unknown): void {
  if (!broken) console.warn('[one] ledger: kept in memory in this browser', e)
  broken = true
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day of a time, 'yyyy-MM-dd'. */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const entryKey = (scope: string, e: Pick<LedgerEntry, 'at' | 'id'>): string => `${scope}|${dayOf(e.at)}|${e.id}`

/* ------------------------------------------------------------------ */
/* Subscribers and the other tabs                                       */
/* ------------------------------------------------------------------ */

const meters = new Set<(e: LedgerEntry) => void>()
const pings = new Set<(scope: string | null) => void>()

/** Every entry this tab meters, as it is metered. Returns the unsubscribe. */
export function registerMeter(fn: (e: LedgerEntry) => void): () => void {
  meters.add(fn)
  return () => {
    meters.delete(fn)
  }
}

let bc: BroadcastChannel | null | undefined

function channel(): BroadcastChannel | null {
  if (bc !== undefined) return bc
  try {
    bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LEDGER_DB)
    if (bc)
      bc.onmessage = (ev: MessageEvent) => {
        const scope = typeof ev.data?.scope === 'string' ? (ev.data.scope as string) : null
        for (const fn of pings) fn(scope)
      }
  } catch {
    bc = null
  }
  return bc
}

/** Another tab wrote entries (of `scope`): read again. Returns the unsubscribe. */
export function onLedgerPing(fn: (scope: string | null) => void): () => void {
  channel()
  pings.add(fn)
  return () => {
    pings.delete(fn)
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

let pending: LedgerEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<void> = Promise.resolve()
/** entries this tab could not write: no scope yet, or storage refused */
const memory: LedgerEntry[] = []
let hooked = false

function remember(e: LedgerEntry): void {
  memory.push(e)
  if (memory.length > MEMORY_MAX) memory.splice(0, memory.length - MEMORY_MAX)
}

/** Record one response (the scope is this member's). Never throws. */
export function meter(entry: LedgerEntry): LedgerEntry {
  const scope = ledgerScope()
  const e: LedgerEntry = { ...entry, scope: scope ?? '' }
  for (const fn of meters) {
    try {
      fn(e)
    } catch (err) {
      console.warn('[one] ledger: a meter subscriber failed', err)
    }
  }
  if (!scope || !store()) {
    remember(e)
    return e
  }
  pending.push(e)
  timer ??= setTimeout(() => void flushLedger(), FLUSH_MS)
  if (!hooked && typeof window !== 'undefined') {
    hooked = true
    window.addEventListener('pagehide', () => void flushLedger())
  }
  return e
}

/** Write what is pending now (one setMany); resolves when every earlier write finished too. */
export function flushLedger(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const batch = pending
  pending = []
  queue = queue.then(async () => {
    if (!batch.length) return
    const st = store()
    if (!st) {
      batch.forEach(remember)
      return
    }
    try {
      await setMany(
        batch.map((e): [string, LedgerEntry] => [entryKey(e.scope, e), e]),
        st,
      )
      channel()?.postMessage({ scope: batch[0].scope })
    } catch (err) {
      fail(err)
      batch.forEach(remember)
      return
    }
    await pruneOnce()
  })
  return queue
}

let prunedDay = ''

/** Days older than LEDGER_DAYS go, once a day per tab. */
async function pruneOnce(now = Date.now()): Promise<void> {
  const today = dayOf(now)
  if (prunedDay === today) return
  prunedDay = today
  const st = store()
  if (!st) return
  const cutoff = dayOf(now - LEDGER_DAYS * DAY_MS)
  try {
    const old = (await keys(st)).filter((k) => {
      const day = String(k).split('|')[1] ?? ''
      return day < cutoff
    })
    if (old.length) await delMany(old, st)
  } catch (err) {
    fail(err)
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A stored entry, or null (anything that is not one is skipped). */
function readEntry(v: unknown): LedgerEntry | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.at !== 'number' || !isObj(v.usage) || !isObj(v.served)) return null
  return v as unknown as LedgerEntry
}

export interface LedgerRange {
  /** from this time on (ms) */
  from?: number
  /** up to this time (ms, inclusive) */
  to?: number
}

/** This member's entries on this device in a range, oldest first (this tab's unwritten ones included). */
export async function ledgerEntries(range: LedgerRange = {}): Promise<LedgerEntry[]> {
  await flushLedger()
  const scope = ledgerScope()
  const inRange = (e: LedgerEntry) => (range.from === undefined || e.at >= range.from) && (range.to === undefined || e.at <= range.to)
  const out = new Map<string, LedgerEntry>()
  const st = scope ? store() : null
  if (st && scope) {
    const fromDay = range.from !== undefined ? dayOf(range.from) : ''
    const toDay = range.to !== undefined ? dayOf(range.to) : '￿'
    try {
      const ks = (await keys(st)).map(String).filter((k) => {
        const [s, d = ''] = k.split('|')
        return s === scope && d >= fromDay && d <= toDay
      })
      for (const v of await getMany(ks, st)) {
        const e = readEntry(v)
        if (e && inRange(e)) out.set(e.id, e)
      }
    } catch (err) {
      fail(err)
    }
  }
  for (const e of memory) if (e.scope === (scope ?? '') && inRange(e)) out.set(e.id, e)
  return [...out.values()].sort((a, b) => a.at - b.at)
}

export type TotalsBy = 'provider' | 'model' | 'purpose' | 'source'

export interface LedgerTotal {
  /** provider · 'p:model' · purpose · source */
  key: string
  requests: number
  usage: Usage
  /** the priced part */
  usd: number
  /** responses without a price (their usd is not in `usd`) */
  unpriced: number
  /** how the sum was priced: 'estimate' when any response was estimated, else the first source met */
  source: CostSource
}

const keyBy = (e: LedgerEntry, by: TotalsBy): string =>
  by === 'provider' ? e.served.p : by === 'model' ? `${e.served.p}:${e.served.model}` : by === 'purpose' ? e.purpose : e.source

/** Sums of entries per provider, model, purpose or source (pure). */
export function totalsOf(list: readonly LedgerEntry[], by: TotalsBy): LedgerTotal[] {
  const rows = new Map<string, LedgerTotal>()
  for (const e of list) {
    const key = keyBy(e, by)
    const row = rows.get(key) ?? { key, requests: 0, usage: ZERO_USAGE, usd: 0, unpriced: 0, source: e.costSource }
    row.requests += 1
    row.usage = addUsage(row.usage, e.usage)
    if (e.usd === null) row.unpriced += 1
    else row.usd += e.usd
    if (e.costSource === 'estimate') row.source = 'estimate'
    rows.set(key, row)
  }
  return [...rows.values()]
}

export async function ledgerTotals(by: TotalsBy, range: LedgerRange = {}): Promise<LedgerTotal[]> {
  return totalsOf(await ledgerEntries(range), by)
}

/** Delete this member's entries on this device (the seam; the device copy and the reset delete the whole store). */
export async function wipeLedgerScope(scope = ledgerScope()): Promise<void> {
  await flushLedger()
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i].scope === (scope ?? '')) memory.splice(i, 1)
  const st = scope ? store() : null
  if (!st || !scope) return
  try {
    const mine = (await keys(st)).filter((k) => String(k).split('|')[0] === scope)
    if (mine.length) await delMany(mine, st)
  } catch (err) {
    fail(err)
  }
}

/* ------------------------------------------------------------------ */
/* Reservations (in this tab)                                           */
/* ------------------------------------------------------------------ */

const MAX_OPEN = 200
const open = new Map<string, Reservation>()

/** A request is about to be sent: what it may cost is held until it settles. */
export function reserve(usd: number, source: string): Reservation {
  const r: Reservation = { id: newId(), usd: Number.isFinite(usd) ? Math.max(0, usd) : 0, at: Date.now(), source }
  open.set(r.id, r)
  // a request that never settles (a crashed path) cannot grow the book without end
  if (open.size > MAX_OPEN) open.delete(open.keys().next().value as string)
  return r
}

/** The request ended (answered, failed or stopped): its reservation is released. */
export function settle(id: string | null | undefined): void {
  if (id) open.delete(id)
}

/** What the open reservations of this tab add up to (USD). */
export const reservedUsd = (): number => [...open.values()].reduce((sum, r) => sum + r.usd, 0)

/** Open reservations of this tab (the seam). */
export const openReservations = (): Reservation[] => [...open.values()]

/* ------------------------------------------------------------------ */
/* e2e seam                                                             */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneLedger?: unknown }).__oneLedger = {
    entries: (range?: LedgerRange) => ledgerEntries(range),
    totals: (by: TotalsBy, range?: LedgerRange) => ledgerTotals(by, range),
    flush: flushLedger,
    wipe: () => wipeLedgerScope(),
    reserved: () => ({ usd: reservedUsd(), open: openReservations().length }),
    scope: ledgerScope,
  }
}
