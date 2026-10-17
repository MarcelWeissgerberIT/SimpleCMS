/**
 * Work orders — this device's record of each request (types.ts OrderRecord; spec §2.8): IndexedDB `one-coding`, key
 * `<scope>|order|<rowId>` (scope `local:local` · in a team the member's own `cloud:<workspace id>:u:<account>` —
 * `orderScope()`: another member signing in on this browser never reads, follows or halts these), announced on
 * BroadcastChannel `one-coding-orders` ({ scope, row }) — a tab holding that request reads it again. Never synced,
 * exported or backed up; wiped with the device copy (cloud/device.ts wipes the `one-coding` scopes) and the local reset.
 *
 *  - Every read goes through readOrderRecord (record.ts) and, for a draft, readDraft below: a record this build cannot
 *    read is no record here (null) and is NEVER overwritten (patchOrderRecord refuses — a later build's record stays).
 *  - Drafts, discarded and finished requests are dropped after 30 days (ORDER_LIMITS.keepMs) when read.
 *  - Writes are compare-and-set through idb-keyval `update` (two tabs never lose each other's write).
 *  - `useOrderRecord(rowId)` (React): the record as this tab holds it, read on first use.
 * Without IndexedDB the records stay in this tab's memory.
 */
import { create } from 'zustand'
import { useEffect } from 'react'
import { createStore, del, get, keys, update, type UseStore } from 'idb-keyval'
import type { ID } from '../../../store/types'
import { activeWorkspace, useCloud } from '../../../cloud'
import { orderScopeOf, readOrderRecord } from './record'
import { readStoredPlan } from './plan'
import { BUDGET_RANGE } from './config'
import { readAutoWhy } from './autoCore'
import { ORDER_LIMITS, type OrderAutoWhy, type OrderCall, type OrderChainStep, type OrderDraft, type OrderProv, type OrderRecord, type OrderServerSkip, type OrderToolLeft, type PlanNote } from './types'
import { chainSuccessor } from '../chain'

export const ORDERS_CHANNEL = 'one-coding-orders'

/** This tab's records scope now (record.ts orderScopeOf; a team account not known yet: `…:u:-`, holding nothing). */
export const orderScope = (): string => orderScopeOf(activeWorkspace(), useCloud.getState().user?.id)
const scope = orderScope

const keyOf = (rowId: ID, s = scope()) => `${s}|order|${rowId}`

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-coding', 'kv'))
}

/* ------------------------------------------------------------------ reading a draft */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null)
const WHO = 200
const LEFT: readonly OrderToolLeft[] = ['notRead', 'out', 'untested']
const SKIPS: readonly OrderServerSkip[] = ['missing', 'off', 'untested', 'noReads', 'refused', 'rule', 'route', 'token']
const SERVER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const stepOrNull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999 ? v : undefined)
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000 ? v : null)

/** A stored note as this build keeps it (null: not one it can read). */
function readNote(v: unknown): PlanNote | null {
  if (!isObj(v)) return null
  const step = stepOrNull(v.step)
  switch (v.kind) {
    case 'repo':
      return typeof step === 'number' && typeof v.repo === 'string' ? { kind: 'repo', step, repo: v.repo.slice(0, 200) } : null
    case 'branch':
      return typeof step === 'number' && typeof v.branch === 'string' && (v.why === 'name' || v.why === 'base' || v.why === 'unknown' || v.why === 'kind') ? { kind: 'branch', step, branch: v.branch.slice(0, 300), why: v.why } : null
    case 'refs':
      return typeof step === 'number' && count(v.count) ? { kind: 'refs', step, count: count(v.count)! } : null
    case 'links':
    case 'keys':
      return step !== undefined && count(v.count) ? { kind: v.kind, step, count: count(v.count)! } : null
    case 'context':
      return v.why === 'noServer' || v.why === 'links' ? { kind: 'context', why: v.why } : null
    default:
      return null
  }
}

function readProv(v: unknown): OrderProv | null {
  if (!isObj(v) || typeof v.contentRev !== 'number' || !Number.isInteger(v.contentRev) || v.contentRev < 0) return null
  return { createdBy: str(v.createdBy, WHO), updatedBy: str(v.updatedBy, WHO), contentOrigin: str(v.contentOrigin, WHO), contentRev: v.contentRev }
}

/** A stored draft as this build keeps it (null: not one it can read — the record then holds no draft). */
export function readDraft(v: unknown): OrderDraft | null {
  if (!isObj(v) || typeof v.hash !== 'string' || v.hash.length > 128 || !ID_RE.test(String(v.run)) || !isTime(v.at)) return null
  const plan = readStoredPlan(v.plan)
  if (!plan) return null
  const src = isObj(v.source) ? v.source : {}
  const prov: Record<ID, OrderProv> = {}
  if (isObj(src.prov)) for (const [id, p] of Object.entries(src.prov).slice(0, 16)) if (ID_RE.test(id)) { const r = readProv(p); if (r) prov[id] = r }
  const pins: Record<ID, number> = {}
  if (isObj(src.pins)) for (const [id, rev] of Object.entries(src.pins).slice(0, 16)) if (ID_RE.test(id) && typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) pins[id] = rev
  const fps: Record<ID, string> = {}
  if (isObj(src.fps)) for (const [id, fp] of Object.entries(src.fps).slice(0, 16)) if (ID_RE.test(id) && typeof fp === 'string' && /^[0-9a-f]{64}$/.test(fp)) fps[id] = fp
  const tools = Array.isArray(src.tools) ? src.tools.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 64)).slice(0, 64) : []
  const left = Array.isArray(src.left) ? src.left.flatMap((x) => (isObj(x) && typeof x.tool === 'string' && LEFT.includes(x.why as OrderToolLeft) ? [{ tool: x.tool.slice(0, 64), why: x.why as OrderToolLeft }] : [])).slice(0, 64) : []
  const calls: OrderCall[] = Array.isArray(src.calls)
    ? src.calls.flatMap((c) => (isObj(c) && typeof c.tool === 'string' ? [{ tool: c.tool.slice(0, 64), args: str(c.args, 200) ?? '', bytes: typeof c.bytes === 'number' && c.bytes >= 0 ? Math.floor(c.bytes) : 0, ok: c.ok === true }] : [])).slice(0, 24)
    : []
  const notes = Array.isArray(v.notes) ? v.notes.slice(0, 64).map(readNote).filter((n): n is PlanNote => !!n) : []
  const auto = isObj(v.auto) && isTime(v.auto.at) && Array.isArray(v.auto.reasons) ? { at: v.auto.at, reasons: v.auto.reasons.slice(0, 32).map(readAutoWhy).filter((r): r is OrderAutoWhy => !!r) } : null
  const pressFps: Record<ID, string> = {}
  if (isObj(v.pressFps)) for (const [id, fp] of Object.entries(v.pressFps).slice(0, 16)) if (ID_RE.test(id) && typeof fp === 'string' && /^[0-9a-f]{64}$/.test(fp)) pressFps[id] = fp
  const answers = Array.isArray(v.answers) ? v.answers.flatMap((a) => (isObj(a) && typeof a.q === 'string' && typeof a.a === 'string' ? [{ q: a.q.slice(0, 300), a: a.a.slice(0, 2000) }] : [])).slice(0, 5) : undefined
  return {
    plan,
    hash: v.hash,
    at: v.at,
    run: String(v.run),
    receipt: isObj(v.receipt) ? (v.receipt as unknown as OrderDraft['receipt']) : null,
    edited: v.edited === true,
    source: {
      rev: typeof src.rev === 'number' && Number.isInteger(src.rev) && src.rev >= 0 ? src.rev : 0,
      prov,
      pins,
      ...(Object.keys(fps).length ? { fps } : {}),
      server: typeof src.server === 'string' && SERVER_RE.test(src.server) ? src.server : null,
      tools,
      left,
      calls,
      ...(isObj(src.skip) && typeof src.skip.server === 'string' && SERVER_RE.test(src.skip.server) && SKIPS.includes(src.skip.why as OrderServerSkip) ? { skip: { server: src.skip.server, why: src.skip.why as OrderServerSkip } } : {}),
    },
    ...(answers?.length ? { answers } : {}),
    ...(notes.length ? { notes } : {}),
    ...(v.over === 'halted' || v.over === 'done' ? { over: v.over } : {}),
    ...(v.budget === null ? { budget: null } : typeof v.budget === 'number' && Number.isFinite(v.budget) ? { budget: Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], v.budget)) } : {}),
    ...(auto?.reasons.length ? { auto } : {}),
    ...(Object.keys(pressFps).length ? { pressFps } : {}),
    ...(isObj(v.from) && typeof v.from.n === 'number' && Number.isInteger(v.from.n) && v.from.n >= 1 && v.from.n <= 999 && ID_RE.test(String(v.from.run)) ? { from: { n: v.from.n, run: String(v.from.run) } } : {}),
  }
}

/** A stored value as this tab acts on it: `null` none · `unreadable` a record this build cannot read (never overwritten). */
export function readStored(v: unknown, now = Date.now()): OrderRecord | null | 'unreadable' {
  if (v === undefined || v === null) return null
  const rec = readOrderRecord(v)
  if (!rec) return 'unreadable'
  if (rec.draft) {
    const draft = readDraft((v as Obj).draft)
    if (draft) rec.draft = draft
    else delete rec.draft
  }
  // drafts, discarded and finished requests: 30 days
  const at = Math.max(rec.draft?.at ?? 0, rec.chain?.confirmedAt ?? 0, rec.want?.at ?? 0)
  if ((rec.state === 'draft' || rec.state === 'discarded' || rec.state === 'done') && at + ORDER_LIMITS.keepMs < now) return null
  // a press kept longer than 24 h is gone (the plate says "abgelaufen — ↵ erneut")
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

/** This device's record of a request, read from storage (once per tab; a channel message reads it again). */
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
 * overwritten: false. Announced to the other tabs.
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

/** The rows of this scope with a record on this device (IndexedDB keys `<scope>|order|<row>`; without storage: this tab's). */
export async function recordRowIds(): Promise<ID[]> {
  const s = scope()
  const store = kv()
  if (!store) {
    const prefix = `${s}|`
    return Object.keys(useOrderRecords.getState().recs).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
  }
  const prefix = `${s}|order|`
  try {
    return (await keys(store)).map(String).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ a chain's next step */

/**
 * The step a running chain on this device starts once `taskId` (one of its steps) is done (coding/chain.ts
 * chainSuccessor) — from this tab's copy of the records (every record of this scope is read at start). null: none.
 */
export function chainSuccessorNow(taskId: ID): { row: ID; step: number; taskId: ID; kind: OrderChainStep['kind'] } | null {
  const prefix = `${scope()}|`
  for (const [key, rec] of Object.entries(useOrderRecords.getState().recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable' || rec.state !== 'running' || !rec.chain || rec.chain.halted) continue
    if (!rec.chain.steps.some((s) => s.id === taskId)) continue
    const next = chainSuccessor(rec.chain, taskId)
    return next ? { row: key.slice(prefix.length), step: next.n, taskId: next.id, kind: next.kind } : null
  }
  return null
}

/** The chain step a task is on this device (a running, halted or finished chain's record), null: none. */
export function chainStepOf(taskId: ID): { row: ID; n: number } | null {
  const prefix = `${scope()}|`
  for (const [key, rec] of Object.entries(useOrderRecords.getState().recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable' || !rec.chain) continue
    const step = rec.chain.steps.find((s) => s.id === taskId)
    if (step) return { row: key.slice(prefix.length), n: step.n }
  }
  return null
}

/**
 * Orders B10 — the Patchbay's live leg of a move: the request a chain step belongs to and the step before it (its task
 * id; null for the first step — the planner's cable). From this tab's copy of the records; null: no chain step.
 */
export function chainLegOf(taskId: ID): { row: ID; prev: ID | null } | null {
  const prefix = `${scope()}|`
  for (const [key, rec] of Object.entries(useOrderRecords.getState().recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable' || !rec.chain) continue
    const steps = [...rec.chain.steps].sort((a, b) => a.n - b.n)
    const i = steps.findIndex((s) => s.id === taskId)
    if (i >= 0) return { row: key.slice(prefix.length), prev: i > 0 ? steps[i - 1].id : null }
  }
  return null
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
