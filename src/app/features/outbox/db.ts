/**
 * Slips on this device: IndexedDB `one-outbox` / `kv`, one record per slip (`<scope>|slip|<id>`). Never synced,
 * exported or backed up; cloud/device.ts removes a team workspace's records with its copy. Every change is a
 * read-modify-write in ONE transaction (idb-keyval `update`), so a compare-and-set holds across tabs; the writer
 * tells the other tabs which slips changed (BroadcastChannel `one-outbox`) and they read those records again.
 * Fail closed: when the store cannot be opened or written (private mode, blocked site data) staging is refused and
 * every send key stays off — never a slip that lives only in memory.
 */
import { createStore, entries, get, update, delMany, type UseStore } from 'idb-keyval'
import { SLIP_ID, SLIP_STATES, type Slip, type SlipId } from './types'

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

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

/**
 * A stored record the Outbox can show: an older, newer or damaged record is left alone (never shown, never sent) —
 * the reader must not crash on what another version or a hand-edited store left there.
 */
export function isSlip(v: unknown, scope?: string): v is Slip {
  if (!obj(v) || v.v !== 1 || !str(v.id) || !SLIP_ID.test(v.id) || !str(v.scope) || (scope !== undefined && v.scope !== scope)) return false
  if (!SLIP_STATES.includes(v.state as Slip['state']) || typeof v.createdAt !== 'number' || typeof v.updatedAt !== 'number') return false
  const t = v.target
  const r = v.route
  if (!obj(t) || !str(t.dbId) || !str(t.rowId) || !str(t.key) || !str(t.serverId) || !str(t.serverName)) return false
  if (!obj(r) || !str(r.profileId) || !str(r.routeId) || !str(r.tool) || !str(r.sig) || !obj(r.snapshot)) return false
  if (!obj(v.origin) || !obj(v.params) || !obj(v.args) || !str(v.argsHash) || !str(v.title) || !obj(v.seal)) return false
  if (!Array.isArray(v.after) || !Array.isArray(v.answers) || !Array.isArray(v.sources) || !Array.isArray(v.log)) return false
  if (!Array.isArray((v.seal as Record<string, unknown>).addresses) || !Array.isArray((v.seal as Record<string, unknown>).hidden)) return false
  return v.draft === null || obj(v.draft)
}

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
  for (const [k, v] of await entries<IDBValidKey, unknown>(store())) {
    if (typeof k === 'string' && k.startsWith(prefix) && isSlip(v, scope) && k === slipKey(scope, v.id)) out.push(v)
  }
  return out
}

export async function readSlip(scope: string, id: SlipId): Promise<Slip | undefined> {
  const v = await get<unknown>(slipKey(scope, id), store())
  return isSlip(v, scope) && v.id === id ? v : undefined
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
      after = fn(isSlip(cur, scope) && cur.id === id ? cur : undefined)
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
