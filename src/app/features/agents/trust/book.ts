/**
 * Per-field trust — the verdict book of this device and member (IndexedDB "one-agents" / "runs", next to the runs):
 *   trust|<scope>|<agentId>             TrustHead (keys with a shard, revocations, grants, sample ordinals)
 *   trust|<scope>|<agentId>|e|<key>     Verdict[] of one trust key, oldest first (≤ TRUST_LIMITS.perKey, pruneKey)
 *   trust|<scope>|<agentId>|l           Lesson[] (S5)
 * `scope` = 'local:local' or 'cloud:<ws>:u:<account>' (trustScope; null while a team account is not known → nothing is
 * written). Every write is ONE readwrite transaction over the head and the shards it names, queued per agent; then the
 * other tabs are told ({ type: 'trust', agentId, keys }) and reload those. Without IndexedDB the book lives in memory.
 * Never synced, exported, backed up or sent anywhere; wiped with the device copy (cloud/device.ts) and the local reset.
 * Written only through this module.
 */
import { create } from 'zustand'
import { createStore, getMany, keys as idbKeys, promisifyRequest, type UseStore } from 'idb-keyval'
import { nanoid } from 'nanoid'
import type { ID } from '../../../store/types'
import { TRUST_KEY_RE, type TrustKey } from '../../../store/autonomy'
import { activeWorkspace, useCloud } from '../../../cloud'
import type { DiscardReason } from '../../ai/agent/types'
import * as rules from './rules'
import { TRUST_LIMITS, pruneKey } from './rules'
import { emptyBook, emptyHead, type Lesson, type TrustBook, type TrustHead, type Verdict, type VerdictKind } from './types'

export { TRUST_LIMITS }

const DAY = 86_400_000
/** an orphan head (its agent gone) is dropped only after this long without a write */
const ORPHAN_MS = 30 * DAY

export interface TrustState {
  /** the scope the books below belong to */
  scope: string | null
  /** books per agent (only agents loaded so far) */
  byAgent: Record<ID, TrustBook>
}

export const useTrust = create<TrustState>()(() => ({ scope: null, byAgent: {} }))

/** 'local:local' · 'cloud:<ws>:u:<account>' · null (a team workspace whose account is not known yet). */
export function trustScope(): string | null {
  const ref = activeWorkspace()
  if (ref.kind !== 'cloud') return `local:${ref.id}`
  const uid = useCloud.getState().user?.id
  const scope = uid ? `cloud:${ref.id}:u:${uid}` : null
  return scope && !scope.includes('|') ? scope : null
}

const headKey = (scope: string, agentId: ID) => `trust|${scope}|${agentId}`
const shardKey = (scope: string, agentId: ID, key: TrustKey) => `trust|${scope}|${agentId}|e|${key}`
const lessonsKey = (scope: string, agentId: ID) => `trust|${scope}|${agentId}|l`
const validKey = (k: unknown): k is TrustKey => typeof k === 'string' && TRUST_KEY_RE.test(k)
const validAgent = (id: unknown): id is ID => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)

/* ------------------------------------------------------------------ storage */

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-agents', 'runs'))
}
/** without IndexedDB: this tab only */
const mem = new Map<string, unknown>()

interface Writes<T> {
  put: Array<[string, unknown]>
  del: string[]
  out: T
}

/** ONE readwrite transaction: read `read`, compute what to write (null: nothing), write it. */
async function txn<T>(read: string[], compute: (vals: unknown[]) => Writes<T> | null): Promise<T | null> {
  const store = kv()
  if (store) {
    try {
      return await store('readwrite', (os) =>
        Promise.all(read.map((k) => promisifyRequest(os.get(k)))).then((vals) => {
          const w = compute(vals)
          if (!w) return null
          for (const [k, v] of w.put) os.put(v, k)
          for (const k of w.del) os.delete(k)
          return promisifyRequest(os.transaction).then(() => w.out)
        }),
      )
    } catch (e) {
      console.warn('[one] agents: no IndexedDB for the trust book, keeping it in memory', e)
      noDb = true
    }
  }
  const w = compute(read.map((k) => mem.get(k)))
  if (!w) return null
  for (const [k, v] of w.put) mem.set(k, v)
  for (const k of w.del) mem.delete(k)
  return w.out
}

async function readMany(list: string[]): Promise<unknown[]> {
  const store = kv()
  if (store) {
    try {
      return await getMany(list, store)
    } catch (e) {
      console.warn('[one] agents: no IndexedDB for the trust book, keeping it in memory', e)
      noDb = true
    }
  }
  return list.map((k) => mem.get(k))
}

async function allKeys(): Promise<string[]> {
  const store = kv()
  if (store) {
    try {
      return (await idbKeys(store)).filter((k): k is string => typeof k === 'string' && k.startsWith('trust|'))
    } catch {
      noDb = true
    }
  }
  return [...mem.keys()].filter((k) => k.startsWith('trust|'))
}

async function deleteKeys(list: string[]): Promise<void> {
  if (!list.length) return
  await txn([], () => ({ put: [], del: list, out: true }))
}

/* ------------------------------------------------------------------ readers (every record sanitized) */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function numMap(raw: unknown): Record<TrustKey, number> {
  const out: Record<TrustKey, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = num(v)
    if (validKey(k) && n !== null) out[k] = n
  }
  return out
}

function readHead(raw: unknown): TrustHead {
  if (!raw || typeof raw !== 'object') return emptyHead()
  const r = raw as Record<string, unknown>
  const direct: TrustHead['direct'] = {}
  if (r.direct && typeof r.direct === 'object')
    for (const [k, v] of Object.entries(r.direct as Record<string, unknown>)) {
      const d = v as { since?: unknown; n?: unknown } | null
      const since = num(d?.since)
      const n = num(d?.n)
      if (validKey(k) && since !== null && n !== null && n >= 0) direct[k] = { since, n: Math.floor(n) }
    }
  return { v: 1, keys: numMap(r.keys), lastRevoke: numMap(r.lastRevoke), revoked: numMap(r.revoked), granted: numMap(r.granted), direct, at: num(r.at) ?? 0 }
}

const KINDS = new Set<VerdictKind>(['accept', 'edited', 'discard', 'undone', 'spot:ok', 'spot:wrong'])
const REASONS = new Set<DiscardReason>(['wrong', 'notNow', 'duplicate', 'done'])
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

function readVerdict(raw: unknown, key: TrustKey): Verdict | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 64)
  const at = num(r.at)
  const run = str(r.run)
  const change = str(r.change)
  if (!id || at === null || !run || !change || r.key !== key || !KINDS.has(r.v as VerdictKind)) return null
  const v: Verdict = { id, key, v: r.v as VerdictKind, at, run, change }
  if (REASONS.has(r.reason as DiscardReason)) v.reason = r.reason as DiscardReason
  if (r.single === true) v.single = true
  const row = str(r.row, 64)
  if (row) v.row = row
  const lesson = str(r.lesson, 64)
  if (lesson) v.lesson = lesson
  if (r.jev === 'held' || r.jev === 'marked' || r.jev === 'clear') v.jev = r.jev
  return v
}

function readShard(raw: unknown, key: TrustKey): Verdict[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => readVerdict(x, key))
    .filter((x): x is Verdict => !!x)
    .sort((a, b) => a.at - b.at)
    .slice(-TRUST_LIMITS.perKey)
}

function readLessons(raw: unknown): Lesson[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Lesson => !!x && typeof x === 'object' && typeof (x as Lesson).id === 'string' && validKey((x as Lesson).key)).slice(-TRUST_LIMITS.lessons)
}

/* ------------------------------------------------------------------ the tab's copy + other tabs */

const TAB = Math.random().toString(36).slice(2)
let channel: BroadcastChannel | null | undefined
function chan(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-agents') : null
  return channel
}

type Message = { type: 'trust'; agentId: ID; keys: TrustKey[]; scope: string; from: string; drop?: true }

function post(m: Omit<Message, 'type' | 'from'>) {
  try {
    chan()?.postMessage({ ...m, type: 'trust', from: TAB } satisfies Message)
  } catch {
    /* closed */
  }
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  chan()?.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as Message | null
    // runs.ts posts { type: 'runs' } on the same channel: only ours
    if (m?.type !== 'trust' || m.from === TAB || !validAgent(m.agentId) || m.scope !== trustScope()) return
    if (!(m.agentId in useTrust.getState().byAgent)) return
    if (m.drop) forget(m.agentId)
    else void refresh(m.agentId, Array.isArray(m.keys) ? m.keys.filter(validKey) : [])
  })
}

/** Keep the tab's copy for the current scope only (a workspace switch starts empty). */
function inScope(scope: string): void {
  if (useTrust.getState().scope !== scope) useTrust.setState({ scope, byAgent: {} })
}

function setBook(scope: string, agentId: ID, book: TrustBook): void {
  if (useTrust.getState().scope !== scope) return
  useTrust.setState((s) => ({ byAgent: { ...s.byAgent, [agentId]: book } }))
}

function forget(agentId: ID): void {
  if (!(agentId in useTrust.getState().byAgent)) return
  useTrust.setState((s) => {
    const byAgent = { ...s.byAgent }
    delete byAgent[agentId]
    return { byAgent }
  })
}

/** Writes per agent and scope, one after another. */
const queues = new Map<string, Promise<unknown>>()

/** Load an agent's book (head, every shard it lists, lessons) into useTrust — after this tab's queued writes. */
export async function loadBook(agentId: ID): Promise<TrustBook> {
  listen()
  const scope = trustScope()
  if (!scope || !validAgent(agentId)) return emptyBook()
  inScope(scope)
  await queues.get(`${scope}|${agentId}`)
  const [rawHead] = await readMany([headKey(scope, agentId)])
  const head = readHead(rawHead)
  const keys = Object.keys(head.keys)
  const vals = await readMany([...keys.map((k) => shardKey(scope, agentId, k)), lessonsKey(scope, agentId)])
  const entries: Record<TrustKey, Verdict[]> = {}
  keys.forEach((k, i) => {
    const list = readShard(vals[i], k)
    if (list.length) entries[k] = list
  })
  const book: TrustBook = { head, entries, lessons: readLessons(vals[keys.length]) }
  setBook(scope, agentId, book)
  return book
}

/** Another tab wrote: read the head, the named shards and the lessons again. */
async function refresh(agentId: ID, keys: TrustKey[]): Promise<void> {
  const scope = trustScope()
  if (!scope) return
  const vals = await readMany([headKey(scope, agentId), ...keys.map((k) => shardKey(scope, agentId, k)), lessonsKey(scope, agentId)])
  const cur = useTrust.getState().byAgent[agentId]
  if (!cur) return
  const head = readHead(vals[0])
  const entries: Record<TrustKey, Verdict[]> = {}
  for (const k of Object.keys(head.keys)) if (cur.entries[k]) entries[k] = cur.entries[k]
  keys.forEach((k, i) => {
    const list = readShard(vals[i + 1], k)
    if (list.length && k in head.keys) entries[k] = list
    else delete entries[k]
  })
  setBook(scope, agentId, { head, entries, lessons: readLessons(vals[keys.length + 1]) })
}

const sameList = (a: Verdict[] | undefined, b: Verdict[] | undefined) =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((x, i) => x.id === b![i].id && x.v === b![i].v && x.reason === b![i].reason && x.lesson === b![i].lesson)

/**
 * Change an agent's book: `fn` gets the head, the shards of `keys` and the lessons AS STORED (inside one readwrite
 * transaction, after this tab's queued writes) and returns the next book — null leaves it as it is. Only the named
 * shards are written (an empty list deletes its shard); the head's `keys` follow, and past TRUST_LIMITS.keys the least
 * recently written key that is not granted here loses its shard. `fn` must be pure. Never takes the run lock.
 * Resolves with the book as written (only the named shards), or null (no scope, nothing changed, failed).
 */
export function patchBook(agentId: ID, keys: TrustKey[], fn: (b: TrustBook) => TrustBook | null): Promise<TrustBook | null> {
  listen()
  const scope = trustScope()
  if (!scope || !validAgent(agentId)) return Promise.resolve(null)
  inScope(scope)
  const named = [...new Set(keys.filter(validKey))]
  const q = `${scope}|${agentId}`
  const job = (queues.get(q) ?? Promise.resolve())
    .then(() => write(scope, agentId, named, fn))
    .catch((e) => {
      console.warn('[one] agents: could not write the trust book', e)
      return null
    })
  queues.set(q, job)
  return job
}

async function write(scope: string, agentId: ID, named: TrustKey[], fn: (b: TrustBook) => TrustBook | null): Promise<TrustBook | null> {
  let dropped: TrustKey[] = []
  const out = await txn<TrustBook>([headKey(scope, agentId), ...named.map((k) => shardKey(scope, agentId, k)), lessonsKey(scope, agentId)], (vals) => {
    const before: TrustBook = { head: readHead(vals[0]), entries: {}, lessons: readLessons(vals[named.length + 1]) }
    named.forEach((k, i) => (before.entries[k] = readShard(vals[i + 1], k)))
    const stored = { lessons: before.lessons, entries: { ...before.entries } }
    const next = fn({ head: structuredClone(before.head), entries: { ...before.entries }, lessons: before.lessons })
    if (!next) return null
    const now = Date.now()
    const head: TrustHead = { ...readHead(next.head), at: now }
    const put: Array<[string, unknown]> = []
    const del: string[] = []
    const entries: Record<TrustKey, Verdict[]> = {}
    for (const k of named) {
      const list = (next.entries[k] ?? []).filter((v) => v.key === k).slice(-TRUST_LIMITS.perKey)
      if (!list.length) {
        if (stored.entries[k]?.length) del.push(shardKey(scope, agentId, k))
        delete head.keys[k]
        continue
      }
      entries[k] = list
      if (!sameList(list, stored.entries[k])) {
        put.push([shardKey(scope, agentId, k), list])
        head.keys[k] = now
      } else head.keys[k] ??= now
    }
    // at most TRUST_LIMITS.keys shards: the least recently written key that is not granted here goes
    const over = Object.keys(head.keys).length - TRUST_LIMITS.keys
    if (over > 0) {
      dropped = Object.keys(head.keys)
        .filter((k) => !(k in head.granted) && !(k in entries))
        .sort((a, b) => head.keys[a] - head.keys[b])
        .slice(0, over)
      for (const k of dropped) {
        delete head.keys[k]
        del.push(shardKey(scope, agentId, k))
      }
    }
    let lessons = stored.lessons
    if (next.lessons !== before.lessons) {
      lessons = readLessons(next.lessons)
      if (lessons.length) put.push([lessonsKey(scope, agentId), lessons])
      else del.push(lessonsKey(scope, agentId))
    }
    put.push([headKey(scope, agentId), head])
    return { put, del, out: { head, entries, lessons } }
  })
  if (!out) return null
  const cur = useTrust.getState().byAgent[agentId]
  if (cur) {
    const entries = { ...cur.entries }
    for (const k of [...named, ...dropped]) delete entries[k]
    setBook(scope, agentId, { head: out.head, entries: { ...entries, ...out.entries }, lessons: out.lessons })
  }
  post({ agentId, keys: [...named, ...dropped], scope })
  return out
}

/** Record verdicts (each gets an id and, unless given, the time now); each key's shard is pruned. Resolves with what was written. */
export async function noteVerdicts(agentId: ID, list: Array<Omit<Verdict, 'id' | 'at'> & { at?: number }>): Promise<Verdict[]> {
  const now = Date.now()
  const made: Verdict[] = list
    .filter((x) => validKey(x.key))
    .map((x) => {
      const v: Verdict = { id: nanoid(10), key: x.key, v: x.v, at: x.at ?? now, run: x.run, change: x.change }
      if (x.reason) v.reason = x.reason
      if (x.single) v.single = true
      if (x.row) v.row = x.row
      if (x.lesson) v.lesson = x.lesson
      if (x.jev) v.jev = x.jev
      return v
    })
  if (!made.length || !trustScope()) return []
  const keys = [...new Set(made.map((v) => v.key))]
  const out = await patchBook(agentId, keys, (b) => {
    for (const k of keys) b.entries[k] = pruneKey([...(b.entries[k] ?? []), ...made.filter((v) => v.key === k)])
    for (const v of made) if (v.v === 'undone' || v.v === 'spot:wrong') b.head.lastRevoke[v.key] = Math.max(b.head.lastRevoke[v.key] ?? 0, v.at)
    return b
  })
  return out ? made : []
}

/** The keys to look in: the hint, else every key the stored head lists. */
async function keysOf(agentId: ID, hint?: TrustKey[]): Promise<TrustKey[]> {
  if (hint) return hint.filter(validKey)
  const scope = trustScope()
  if (!scope) return []
  const [raw] = await readMany([headKey(scope, agentId)])
  return Object.keys(readHead(raw).keys)
}

/**
 * Take verdicts back (an Undo of the person's own decision): the entries of these changes of `run` whose kind is in
 * `v`. `hint`: the keys they were written under (else every key of the book). Resolves with how many went.
 */
export async function voidVerdicts(agentId: ID, run: string, changes: string[], v: VerdictKind[], hint?: TrustKey[]): Promise<number> {
  const keys = await keysOf(agentId, hint)
  if (!keys.length || !changes.length) return 0
  let n = 0
  await patchBook(agentId, keys, (b) => {
    n = 0
    for (const k of keys) {
      const list = b.entries[k] ?? []
      const left = list.filter((x) => !(x.run === run && changes.includes(x.change) && v.includes(x.v)))
      n += list.length - left.length
      b.entries[k] = left
    }
    return n ? b : null
  })
  return n
}

/** Give a verdict a reason afterwards (an Undo's "why"); `hint`: its key. */
export async function reasonVerdict(agentId: ID, id: string, reason: DiscardReason, hint?: TrustKey[]): Promise<void> {
  const keys = await keysOf(agentId, hint)
  if (!keys.length) return
  await patchBook(agentId, keys, (b) => {
    let hit = false
    for (const k of keys) b.entries[k] = (b.entries[k] ?? []).map((x) => (x.id === id ? ((hit = true), { ...x, reason }) : x))
    return hit ? b : null
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Forget an agent's books in every scope of this browser (the agent was deleted). */
export async function dropBooks(agentId: ID): Promise<void> {
  if (!validAgent(agentId)) return
  forget(agentId)
  const re = new RegExp(`^trust\\|[^|]+\\|${escapeRe(agentId)}(\\||$)`)
  try {
    await deleteKeys((await allKeys()).filter((k) => re.test(k)))
  } catch {
    /* nothing stored */
  }
  const scope = trustScope()
  if (scope) post({ agentId, keys: [], scope, drop: true })
}

/**
 * Drop the books of this scope whose agent is gone (not in `agentIds`) and whose head was not written for 30 days —
 * a slow sync never costs a book. Resolves with how many agents' books went.
 */
export async function sweepOrphanBooks(agentIds: Set<ID>): Promise<number> {
  const scope = trustScope()
  if (!scope) return 0
  const prefix = `trust|${scope}|`
  const all = (await allKeys()).filter((k) => k.startsWith(prefix))
  const orphans = [...new Set(all.map((k) => k.slice(prefix.length).split('|')[0]))].filter((id) => validAgent(id) && !agentIds.has(id))
  if (!orphans.length) return 0
  const heads = await readMany(orphans.map((id) => headKey(scope, id)))
  const now = Date.now()
  const gone = orphans.filter((_, i) => now - readHead(heads[i]).at > ORPHAN_MS)
  if (!gone.length) return 0
  const drop = new Set(gone)
  await deleteKeys(all.filter((k) => drop.has(k.slice(prefix.length).split('|')[0])))
  for (const id of gone) forget(id)
  return gone.length
}

/* ------------------------------------------------------------------ e2e seam (dev, or ?e2e) */

/** Replace an agent's book in this scope (head keys follow the entries unless given). */
async function seed(agentId: ID, raw: Partial<{ head: Partial<TrustHead>; entries: Record<TrustKey, Array<Partial<Verdict>>>; lessons: Lesson[] }>): Promise<TrustBook | null> {
  const scope = trustScope()
  if (!scope || !validAgent(agentId)) return null
  const re = new RegExp(`^trust\\|${escapeRe(scope)}\\|${escapeRe(agentId)}(\\||$)`)
  await deleteKeys((await allKeys()).filter((k) => re.test(k)))
  const head = readHead({ ...emptyHead(), ...(raw.head ?? {}) })
  const entries: Record<TrustKey, Verdict[]> = {}
  for (const [k, list] of Object.entries(raw.entries ?? {})) {
    if (!validKey(k)) continue
    const clean = readShard(
      list.map((x, i) => ({ id: x.id ?? nanoid(10), run: 'seed', change: `seed-${i}`, at: Date.now() - (list.length - i) * 60_000, ...x, key: k })),
      k,
    )
    if (!clean.length) continue
    entries[k] = clean
    head.keys[k] ??= clean[clean.length - 1].at
  }
  head.at = Date.now()
  const lessons = readLessons(raw.lessons ?? [])
  const put: Array<[string, unknown]> = [[headKey(scope, agentId), head], ...Object.entries(entries).map(([k, l]): [string, unknown] => [shardKey(scope, agentId, k), l])]
  if (lessons.length) put.push([lessonsKey(scope, agentId), lessons])
  await txn([], () => ({ put, del: [], out: true }))
  const book = { head, entries, lessons }
  if (agentId in useTrust.getState().byAgent) setBook(scope, agentId, book)
  post({ agentId, keys: Object.keys(entries), scope })
  return book
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneAgentTrust?: unknown }).__oneAgentTrust = {
    seed,
    book: loadBook,
    rules,
    scope: trustScope,
    keys: allKeys,
    flushWatch: () => import('./watch').then((m) => m.flushWatch()),
  }
}
