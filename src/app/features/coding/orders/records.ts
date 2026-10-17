/**
 * Work orders — this device's record of each request (types.ts OrderRecord; spec §2.8): IndexedDB `one-coding`, key
 * `<scope>|order|<rowId>` (scope `local:local` · `cloud:<workspace id>`, coding/local.ts scope()), announced on
 * BroadcastChannel `one-coding-orders` ({ scope, row }) — a tab holding that request reads it again. Never synced,
 * exported or backed up; wiped with the device copy (cloud/device.ts wipes the `one-coding` scopes) and the local reset.
 *
 * B4's copy of the store B5 (the planner) builds in parallel — the SAME API (loadOrderRecord · orderRecordNow ·
 * patchOrderRecord → { ok, rec } · useOrderRecord · ORDERS_CHANNEL), so the planner's fuller version (it also reads a
 * draft's plan back, plan.ts readStoredPlan) replaces this file as it is:
 *  - every read goes through readOrderRecord (record.ts): a record this build cannot read is 'unreadable' and is NEVER
 *    overwritten (patchOrderRecord refuses);
 *  - drafts, discarded and finished requests are dropped after 30 days, a kept press (`want`) after 24 h, when read;
 *  - writes are compare-and-set through idb-keyval `update` (two tabs never lose each other's write).
 * Without IndexedDB the records stay in this tab's memory.
 */
import { create } from 'zustand'
import { useEffect } from 'react'
import { createStore, del, get, update, type UseStore } from 'idb-keyval'
import type { ID } from '../../../store/types'
import { scope } from '../local'
import { readOrderRecord } from './record'
import { ORDER_LIMITS, type OrderRecord } from './types'

export const ORDERS_CHANNEL = 'one-coding-orders'

const keyOf = (rowId: ID, s = scope()) => `${s}|order|${rowId}`

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-coding', 'kv'))
}

/** A stored value as this tab acts on it: `null` none · `unreadable` a record this build cannot read (never overwritten). */
export function readStored(v: unknown, now = Date.now()): OrderRecord | null | 'unreadable' {
  if (v === undefined || v === null) return null
  const rec = readOrderRecord(v)
  if (!rec) return 'unreadable'
  // drafts, discarded and finished requests: 30 days
  const at = Math.max(rec.draft?.at ?? 0, rec.chain?.confirmedAt ?? 0, rec.want?.at ?? 0)
  if ((rec.state === 'draft' || rec.state === 'discarded' || rec.state === 'done') && at + ORDER_LIMITS.keepMs < now) return null
  // a press kept longer than 24 h is gone (it never plans by itself after that)
  if (rec.want && rec.want.at + ORDER_LIMITS.wantMs < now) delete rec.want
  return rec
}

/* ------------------------------------------------------------------ this tab's copy */

interface RecordsState {
  /** `<scope>|<rowId>` → the record (null: none; 'unreadable': a later build's) */
  recs: Record<string, OrderRecord | null | 'unreadable'>
}

export const useOrderRecords = create<RecordsState>()(() => ({ recs: {} }))

const memKey = (rowId: ID, s = scope()) => `${s}|${rowId}`
const loads = new Map<string, Promise<OrderRecord | null | 'unreadable'>>()
const setMem = (k: string, v: OrderRecord | null | 'unreadable') => useOrderRecords.setState((st) => ({ recs: { ...st.recs, [k]: v } }))

async function readRaw(rowId: ID, s: string): Promise<unknown> {
  const store = kv()
  if (!store) return undefined
  try {
    return await get(keyOf(rowId, s), store)
  } catch {
    noDb = true
    return undefined
  }
}

/** This device's record of a request, read from storage (once per tab; `fresh` or a channel message reads it again). */
export function loadOrderRecord(rowId: ID, o: { fresh?: boolean } = {}): Promise<OrderRecord | null | 'unreadable'> {
  listen()
  const s = scope()
  const k = memKey(rowId, s)
  if (!o.fresh && k in useOrderRecords.getState().recs) return Promise.resolve(useOrderRecords.getState().recs[k]!)
  const pending = loads.get(k)
  if (pending && !o.fresh) return pending
  const job = (async () => {
    const raw = await readRaw(rowId, s)
    // without storage: what this tab holds
    if (raw === undefined && !kv()) return useOrderRecords.getState().recs[k] ?? null
    const rec = readStored(raw)
    setMem(k, rec)
    return rec
  })().finally(() => loads.delete(k))
  loads.set(k, job)
  return job
}

/** The record as this tab holds it now (undefined: not read yet). */
export const orderRecordNow = (rowId: ID): OrderRecord | null | 'unreadable' | undefined => useOrderRecords.getState().recs[memKey(rowId)]

/**
 * Change a request's record (compare-and-set): `fn` gets the stored record (null: none) and returns the next one (null:
 * remove it; the same object: no write). A record this build cannot read is never handed to `fn` and never
 * overwritten: `ok` false. Announced to the other tabs.
 */
export async function patchOrderRecord(rowId: ID, fn: (rec: OrderRecord | null) => OrderRecord | null): Promise<{ ok: boolean; rec: OrderRecord | null }> {
  listen()
  const s = scope()
  const k = memKey(rowId, s)
  const store = kv()
  let out: { ok: boolean; rec: OrderRecord | null } = { ok: false, rec: null }
  if (!store) {
    const now = useOrderRecords.getState().recs[k]
    if (now === 'unreadable') return out
    const next = fn(now ?? null)
    setMem(k, next)
    return { ok: true, rec: next }
  }
  try {
    await update(
      keyOf(rowId, s),
      (raw: unknown) => {
        const now = readStored(raw)
        if (now === 'unreadable') {
          out = { ok: false, rec: null }
          return raw
        }
        const next = fn(now)
        out = { ok: true, rec: next }
        if (next === now) return raw
        return next === null ? undefined : (JSON.parse(JSON.stringify(next)) as unknown)
      },
      store,
    )
    // update() writes undefined for "remove": drop the key for good
    if (out.ok && out.rec === null) await del(keyOf(rowId, s), store).catch(() => undefined)
  } catch {
    noDb = true
    return patchOrderRecord(rowId, fn)
  }
  if (out.ok) {
    setMem(k, out.rec)
    try {
      channel()?.postMessage({ scope: s, row: rowId })
    } catch {
      /* closed */
    }
  }
  return out
}

/* ------------------------------------------------------------------ other tabs */

let ch: BroadcastChannel | null | undefined
const channel = (): BroadcastChannel | null => {
  if (ch !== undefined) return ch
  try {
    ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ORDERS_CHANNEL)
  } catch {
    ch = null
  }
  return ch
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  channel()?.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { scope?: unknown; row?: unknown } | null
    if (!m || typeof m.scope !== 'string' || typeof m.row !== 'string' || m.scope !== scope()) return
    // only a request this tab holds is read again
    if (memKey(m.row) in useOrderRecords.getState().recs) void loadOrderRecord(m.row, { fresh: true })
  })
}

/** React: this device's record of a request (undefined while it is read; null: none). */
export function useOrderRecord(rowId: ID | null): OrderRecord | null | 'unreadable' | undefined {
  const k = rowId ? memKey(rowId) : ''
  const rec = useOrderRecords((st) => (k ? st.recs[k] : undefined))
  useEffect(() => {
    if (rowId) void loadOrderRecord(rowId)
  }, [rowId])
  return rec
}
