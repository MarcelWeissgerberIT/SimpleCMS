/**
 * Slips on this device: IndexedDB `one-outbox` / `kv`, one record per slip (`<scope>|slip|<id>`). Never synced,
 * exported or backed up; cloud/device.ts removes a team workspace's records with its copy. Every change is a
 * read-modify-write in ONE transaction (idb-keyval `update`), so a compare-and-set holds across tabs; the writer
 * tells the other tabs which slips changed (BroadcastChannel `one-outbox`) and they read those records again.
 * Fail closed: when the store cannot be opened or written (private mode, blocked site data) staging is refused and
 * every send key stays off — never a slip that lives only in memory.
 */
import { createStore, entries, get, update, delMany, type UseStore } from 'idb-keyval'
import type { Slip, SlipId } from './types'

let kv: UseStore | null = null
let broken: string | null = null

function store(): UseStore {
  if (broken) throw new Error(broken)
  try {
    return (kv ??= createStore('one-outbox', 'kv'))
  } catch (e) {
    broken = (e as Error)?.message || 'blocked'
    throw e
  }
}

export const slipKey = (scope: string, id: SlipId) => `${scope}|slip|${id}`

/** Can this device keep slips? (one read; false and the reason when the store is blocked) */
export async function probeStorage(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (typeof indexedDB === 'undefined') return { ok: false, reason: 'no IndexedDB' }
  try {
    await get('probe', store())
    return { ok: true }
  } catch (e) {
    broken = (e as Error)?.message || 'blocked'
    return { ok: false, reason: broken }
  }
}

/** This workspace's slips. */
export async function loadSlips(scope: string): Promise<Slip[]> {
  const prefix = `${scope}|slip|`
  const out: Slip[] = []
  for (const [k, v] of await entries<IDBValidKey, Slip>(store())) {
    if (typeof k === 'string' && k.startsWith(prefix) && v && typeof v === 'object' && v.v === 1) out.push(v)
  }
  return out
}

export async function readSlip(scope: string, id: SlipId): Promise<Slip | undefined> {
  return get<Slip>(slipKey(scope, id), store())
}

/**
 * Change one slip in one transaction: `fn` gets the stored slip (undefined: none) and returns the new one, or the
 * same object to leave it. Resolves with what is stored afterwards.
 */
export async function updateSlip(scope: string, id: SlipId, fn: (cur: Slip | undefined) => Slip | undefined): Promise<Slip | undefined> {
  let after: Slip | undefined
  await update<Slip | undefined>(
    slipKey(scope, id),
    (cur) => {
      after = fn(cur)
      return after
    },
    store(),
  )
  return after
}

export async function dropSlips(scope: string, ids: SlipId[]): Promise<void> {
  if (ids.length) await delMany(ids.map((id) => slipKey(scope, id)), store())
}

/* ------------------------------------------------------------------ tabs */

const TAB = Math.random().toString(36).slice(2)
let channel: BroadcastChannel | null | undefined

function chan(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-outbox') : null
  return channel
}

/** Tell the other tabs which slips changed. */
export function postChanged(scope: string, ids: SlipId[]): void {
  try {
    chan()?.postMessage({ scope, ids, from: TAB })
  } catch {
    /* closed channel */
  }
}

export function onChanged(fn: (scope: string, ids: SlipId[]) => void): () => void {
  const c = chan()
  if (!c) return () => {}
  const h = (e: MessageEvent) => {
    const d = e.data as { scope?: unknown; ids?: unknown; from?: unknown } | null
    if (!d || d.from === TAB || typeof d.scope !== 'string' || !Array.isArray(d.ids)) return
    fn(d.scope, d.ids.filter((x): x is string => typeof x === 'string'))
  }
  c.addEventListener('message', h)
  return () => c.removeEventListener('message', h)
}

/** This tab's id (a send attempt names it). */
export const tabId = () => TAB
