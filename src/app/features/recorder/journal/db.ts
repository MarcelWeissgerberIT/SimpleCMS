/**
 * The journal's storage: IndexedDB `one-recorder` (raw API — the journal needs indexes and key ranges),
 * per device, every key starting with its scope. Opened lazily on the first write or read (never during
 * boot); a version change elsewhere (a reset, a newer build) closes it, the next use reopens it. Without
 * IndexedDB (private mode) the same API keeps everything in this tab's memory.
 */
import { dropPinsOfScope } from '../../history/pins'
import type { Scope } from '../model/types'

export const RECORDER_DB = 'one-recorder'
const VERSION = 1

export type StoreName = 'ops' | 'events' | 'segs' | 'runs' | 'minutes' | 'quarters' | 'checkpoints' | 'ejects' | 'kv'
export const STORES: StoreName[] = ['ops', 'events', 'segs', 'runs', 'minutes', 'quarters', 'checkpoints', 'ejects', 'kv']

const KEY_PATH: Record<StoreName, string> = { ops: 'k', events: 'k', segs: 'id', runs: 'id', minutes: 'k', quarters: 'k', checkpoints: 'k', ejects: 'id', kv: 'k' }

type IndexPath = string | string[]
const INDEXES: Partial<Record<StoreName, Array<[string, IndexPath]>>> = {
  ops: [
    ['lane', ['s', 'l', 'at']],
    ['run', ['s', 'r']],
  ],
  events: [
    ['place', ['s', 'p', 'at']],
    ['seg', 'g'],
    ['lane', ['s', 'l', 'at']],
    ['run', ['s', 'r']],
  ],
  segs: [
    ['place', ['s', 'p', 'from']],
    ['lane', ['s', 'l', 'from']],
    ['from', ['s', 'from']],
    ['run', ['s', 'r']],
    // sparse: only open segments carry `o`
    ['open', ['s', 'o']],
  ],
  runs: [['from', ['s', 'from']]],
  ejects: [['at', ['s', 'at']]],
}

export const pad13 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(13, '0')
export const pad8 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(8, '0')
/** The upper end of a string key range. */
export const HI = '￿'
/** Every key of a scope. */
export const scopeRange = (s: Scope): [string, string] => [`${s}|`, `${s}|${HI}`]

/* ------------------------------------------------------------------ */
/* Keys (IndexedDB order) — the memory backend compares the same way   */
/* ------------------------------------------------------------------ */

export type JKey = number | string | JKey[]

function rank(k: JKey): number {
  return typeof k === 'number' ? 0 : typeof k === 'string' ? 1 : 2
}

export function cmpKey(a: JKey, b: JKey): number {
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'number' || typeof a === 'string') return a < (b as typeof a) ? -1 : a > (b as typeof a) ? 1 : 0
  const bb = b as JKey[]
  for (let i = 0; i < Math.min(a.length, bb.length); i++) {
    const c = cmpKey(a[i], bb[i])
    if (c) return c
  }
  return a.length - bb.length
}

const validPart = (v: unknown): v is number | string => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string'

/** A record's key on an index path (undefined: not in that index — IndexedDB skips it the same way). */
function keyOn(rec: Record<string, unknown>, path: IndexPath): JKey | undefined {
  if (typeof path === 'string') return validPart(rec[path]) ? (rec[path] as JKey) : undefined
  const out: JKey[] = []
  for (const p of path) {
    if (!validPart(rec[p])) return undefined
    out.push(rec[p] as JKey)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The backend                                                         */
/* ------------------------------------------------------------------ */

/** A record read-modify-written in the batch's transaction (histograms, counters). */
export interface Bump {
  store: StoreName
  key: string
  fn: (cur: Record<string, unknown> | undefined) => Record<string, unknown>
}

export interface Batch {
  put?: Partial<Record<StoreName, Array<Record<string, unknown>>>>
  bump?: Bump[]
  del?: Array<{ store: StoreName; key: string }>
}

export interface RangeQuery {
  store: StoreName
  /** an index name (absent: the primary key) */
  index?: string
  lo: JKey
  hi: JKey
  limit?: number
}

export interface Journal {
  mode: 'idb' | 'memory'
  /** One transaction: puts, read-modify-writes, deletes. */
  write(b: Batch): Promise<void>
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  range<T>(q: RangeQuery): Promise<T[]>
  /** Primary keys in a range (no values). */
  keys(q: RangeQuery): Promise<string[]>
  /** Add a record only if its key is free; false when it is taken. */
  add(store: StoreName, rec: Record<string, unknown>): Promise<boolean>
  /** Delete every record in a range (an index range deletes the records it points to). */
  deleteRange(q: RangeQuery): Promise<number>
  close(): void
}

/** a transaction's puts are handed over in pieces of about this long */
const PUT_PIECE_MS = 8

const req2p = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
const tx2p = (t: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new DOMException('aborted', 'AbortError'))
  })

function idbJournal(db: IDBDatabase): Journal {
  const source = (st: IDBObjectStore, index?: string) => (index ? st.index(index) : st)
  return {
    mode: 'idb',
    async write(b) {
      const names = new Set<StoreName>([...(Object.keys(b.put ?? {}) as StoreName[]), ...(b.bump ?? []).map((x) => x.store), ...(b.del ?? []).map((x) => x.store)])
      if (!names.size) return
      const t = db.transaction([...names], 'readwrite')
      const done = tx2p(t)
      // the puts go in in pieces: a piece's last request carries on in its callback (the transaction stays active)
      // — a put clones its record right away, and thousands of them at once would block the page
      const puts: Array<[IDBObjectStore, Record<string, unknown>]> = []
      for (const [name, recs] of Object.entries(b.put ?? {}) as Array<[StoreName, Array<Record<string, unknown>>]>) {
        const st = t.objectStore(name)
        for (const r of recs) puts.push([st, r])
      }
      let i = 0
      const piece = () => {
        const t0 = performance.now()
        let last: IDBRequest | null = null
        while (i < puts.length) {
          const [st, r] = puts[i++]
          last = st.put(r)
          if ((i & 63) === 0 && performance.now() - t0 > PUT_PIECE_MS) break
        }
        if (i < puts.length && last) last.onsuccess = piece
      }
      piece()
      for (const x of b.bump ?? []) {
        const st = t.objectStore(x.store)
        const r = st.get(x.key)
        r.onsuccess = () => st.put(x.fn(r.result as Record<string, unknown> | undefined))
      }
      for (const x of b.del ?? []) t.objectStore(x.store).delete(x.key)
      await done
    },
    async get<T>(store: StoreName, key: string) {
      const t = db.transaction(store, 'readonly')
      return (await req2p(t.objectStore(store).get(key))) as T | undefined
    },
    async range<T>(q: RangeQuery) {
      const t = db.transaction(q.store, 'readonly')
      return (await req2p(source(t.objectStore(q.store), q.index).getAll(IDBKeyRange.bound(q.lo, q.hi), q.limit))) as T[]
    },
    async keys(q) {
      const t = db.transaction(q.store, 'readonly')
      const st = t.objectStore(q.store)
      if (!q.index) return (await req2p(st.getAllKeys(IDBKeyRange.bound(q.lo, q.hi), q.limit))).map(String)
      return (await req2p(st.index(q.index).getAllKeys(IDBKeyRange.bound(q.lo, q.hi), q.limit))).map(String)
    },
    async add(store, rec) {
      const t = db.transaction(store, 'readwrite')
      const done = tx2p(t)
      const r = t.objectStore(store).add(rec)
      r.onerror = (e) => {
        // the key is taken: not an error of the transaction
        e.preventDefault()
      }
      try {
        await done
        return !r.error
      } catch {
        return false
      }
    },
    async deleteRange(q) {
      const t = db.transaction(q.store, 'readwrite')
      const done = tx2p(t)
      const st = t.objectStore(q.store)
      let n = 0
      if (!q.index) {
        const c = st.count(IDBKeyRange.bound(q.lo, q.hi))
        c.onsuccess = () => {
          n = c.result
          st.delete(IDBKeyRange.bound(q.lo, q.hi))
        }
      } else {
        const r = st.index(q.index).openKeyCursor(IDBKeyRange.bound(q.lo, q.hi))
        r.onsuccess = () => {
          const cur = r.result
          if (!cur) return
          st.delete(cur.primaryKey)
          n++
          cur.continue()
        }
      }
      await done
      return n
    },
    close() {
      db.close()
    },
  }
}

/** The same API in this tab's memory (no IndexedDB): small and slow is fine — memory mode is capped. */
export function memoryJournal(): Journal {
  const stores = new Map<StoreName, Map<string, Record<string, unknown>>>(STORES.map((s) => [s, new Map()]))
  const pathOf = (q: RangeQuery): IndexPath => (q.index ? (INDEXES[q.store]?.find(([n]) => n === q.index)?.[1] ?? KEY_PATH[q.store]) : KEY_PATH[q.store])
  const select = (q: RangeQuery) => {
    const path = pathOf(q)
    const out: Array<[JKey, Record<string, unknown>]> = []
    for (const rec of stores.get(q.store)!.values()) {
      const k = keyOn(rec, path)
      if (k === undefined || cmpKey(k, q.lo) < 0 || cmpKey(k, q.hi) > 0) continue
      out.push([k, rec])
    }
    out.sort((a, b) => cmpKey(a[0], b[0]) || cmpKey(String(a[1][KEY_PATH[q.store]]), String(b[1][KEY_PATH[q.store]])))
    return q.limit ? out.slice(0, q.limit) : out
  }
  const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : v)
  return {
    mode: 'memory',
    async write(b) {
      for (const [name, recs] of Object.entries(b.put ?? {}) as Array<[StoreName, Array<Record<string, unknown>>]>) for (const r of recs) stores.get(name)!.set(String(r[KEY_PATH[name]]), clone(r))
      for (const x of b.bump ?? []) {
        const m = stores.get(x.store)!
        m.set(x.key, x.fn(m.get(x.key)))
      }
      for (const x of b.del ?? []) stores.get(x.store)!.delete(x.key)
    },
    async get<T>(store: StoreName, key: string) {
      const v = stores.get(store)!.get(key)
      return (v ? clone(v) : undefined) as T | undefined
    },
    async range<T>(q: RangeQuery) {
      return select(q).map(([, r]) => clone(r)) as T[]
    },
    async keys(q) {
      return select(q).map(([, r]) => String(r[KEY_PATH[q.store]]))
    },
    async add(store, rec) {
      const m = stores.get(store)!
      const k = String(rec[KEY_PATH[store]])
      if (m.has(k)) return false
      m.set(k, rec)
      return true
    },
    async deleteRange(q) {
      const hit = select({ ...q, limit: undefined })
      for (const [, r] of hit) stores.get(q.store)!.delete(String(r[KEY_PATH[q.store]]))
      return hit.length
    },
    close() {},
  }
}

/* ------------------------------------------------------------------ */
/* Opening                                                             */
/* ------------------------------------------------------------------ */

let opening: Promise<Journal> | null = null
let current: Journal | null = null
let memory: Journal | null = null
const closeListeners = new Set<() => void>()

/** The journal closed (version change, reset): caches built on it should be dropped. */
export function onJournalClosed(fn: () => void): () => void {
  closeListeners.add(fn)
  return () => closeListeners.delete(fn)
}

function forget() {
  try {
    current?.close()
  } catch {
    /* already closed */
  }
  current = null
  opening = null
  closeListeners.forEach((l) => l())
}

let resetHooked = false
function hookReset() {
  if (resetHooked || typeof BroadcastChannel === 'undefined') return
  resetHooked = true
  try {
    // the shell's reset channel (shell/lib/reset.ts): let go of the database before it is deleted
    const ch = new BroadcastChannel('one-reset')
    ch.onmessage = (e) => {
      if ((e.data as { type?: string } | null)?.type === 'reset') forget()
    }
  } catch {
    /* unsupported */
  }
}

function upgrade(db: IDBDatabase) {
  for (const name of STORES) {
    if (db.objectStoreNames.contains(name)) continue
    const st = db.createObjectStore(name, { keyPath: KEY_PATH[name] })
    for (const [index, path] of INDEXES[name] ?? []) st.createIndex(index, path)
  }
}

/** Open (or reuse) the journal. Falls back to memory when this browser has no IndexedDB. */
export function openJournal(): Promise<Journal> {
  if (current) return Promise.resolve(current)
  if (memory) return Promise.resolve(memory)
  if (opening) return opening
  hookReset()
  opening = new Promise<Journal>((resolve) => {
    const toMemory = () => {
      memory ??= memoryJournal()
      opening = null
      resolve(memory)
    }
    let req: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined') return toMemory()
      req = indexedDB.open(RECORDER_DB, VERSION)
    } catch {
      return toMemory()
    }
    req.onupgradeneeded = () => upgrade(req.result)
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => forget()
      db.onclose = () => {
        if (current?.mode === 'idb') forget()
      }
      current = idbJournal(db)
      resolve(current)
    }
    req.onerror = () => toMemory()
    // blocked: an older connection is still open elsewhere — the open completes once it lets go
  })
  return opening
}

/** The journal if it is open right now (no open is started). */
export const journalIfOpen = (): Journal | null => current ?? memory

/** Close this tab's connection (tests, reset). */
export function closeJournal(): void {
  forget()
}

/** Delete every record of a scope in every store (its HMAC key included), then its pins. */
export async function wipeScope(scope: Scope): Promise<void> {
  const j = await openJournal()
  const [lo, hi] = scopeRange(scope)
  for (const store of STORES) await j.deleteRange({ store, lo, hi })
  await dropPinsOfScope(scope)
}

export const wipeRecorderScope = wipeScope
