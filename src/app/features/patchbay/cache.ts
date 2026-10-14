/**
 * The Patchbay's device stores — keys and helpers (plan §1.2, §1.6, §1.12; written by B4 lazy cache, B13 run tally,
 * B12 setup band). Per device and member scope ('local:local' | 'cloud:<ws>:u:<account>', scope.ts), never synced,
 * exported or backed up; wiped with the device copy and the local reset (B9 wires PATCHBAY_DB / wipePatchbay there).
 *
 * IndexedDB `one-patchbay` / `kv` (idb-keyval, read-modify-write in one transaction with `update`):
 *  - `<scope>|lazy`        LazyCache — the lazy readings, ids and hosts only (B4)
 *  - `<scope>|runs|<day>`  RunTally — runs today on this device (B13; rolls at local midnight)
 *  - `<scope>|setup`       SetupState — the setup band / strip (B12)
 * localStorage (per device): `one.patchbay.seen` (NEW tag), `one.patchbay.patch` (the Patching switch),
 * `one.patchbay.order:<scope>` (stable row order, module keys only). sessionStorage: `one.patchbay.return` (the return
 * chip). No DOM here; IndexedDB is opened on the first call (never at boot).
 *
 * Wiping (B9 wires it): `wipePatchbay('cloud:<ws>')` — the device copy of a team workspace — takes every member's scope
 * of it along (`cloud:<ws>:u:<account>`, each member signed in here has their own; cloud/device.ts knows only workspace
 * ids), as the recorder's wipeScope does; `inPatchbayScope(key, scope)` is that rule for a key, and PATCHBAY_DB /
 * PATCHBAY_STORE name the store for a caller that opens it itself.
 */
import { createStore, del, delMany, get, keys, set, update, type UseStore } from 'idb-keyval'

export const PATCHBAY_DB = 'one-patchbay'
export const PATCHBAY_STORE = 'kv'

/** localStorage keys (every one starts with LS_PREFIX — the local reset drops them by prefix). */
export const LS_PREFIX = 'one.patchbay.'
export const LS_SEEN = 'one.patchbay.seen'
export const LS_PATCH = 'one.patchbay.patch'
const ORDER_PREFIX = 'one.patchbay.order:'
export const lsOrder = (scope: string) => `${ORDER_PREFIX}${scope}`
/** sessionStorage: the return chip (ids only). */
export const SS_RETURN = 'one.patchbay.return'

export const lazyKey = (scope: string) => `${scope}|lazy`
export const runsKey = (scope: string, day: string) => `${scope}|runs|${day}`
export const setupKey = (scope: string) => `${scope}|setup`

let kv: UseStore | null = null
let broken = false

/** The store (null: IndexedDB missing or refused — every helper then reads nothing and writes nothing). */
function store(): UseStore | null {
  if (broken || typeof indexedDB === 'undefined') return null
  try {
    return (kv ??= createStore(PATCHBAY_DB, PATCHBAY_STORE))
  } catch {
    broken = true
    return null
  }
}

/** Read a record; `check` says whether it is one this build can use (anything else reads as none). */
export async function readCache<T>(key: string, check: (v: unknown) => v is T): Promise<T | null> {
  const st = store()
  if (!st) return null
  try {
    const v = await get<unknown>(key, st)
    return check(v) ? v : null
  } catch {
    return null
  }
}

/** Write a record (false: not kept — the store is blocked). */
export async function writeCache(key: string, value: unknown): Promise<boolean> {
  const st = store()
  if (!st) return false
  try {
    await set(key, value, st)
    return true
  } catch {
    return false
  }
}

/** Change a record in one transaction (atomic across tabs); `fn` gets what is stored (undefined: none). */
export async function updateCache<T>(key: string, fn: (cur: T | undefined) => T): Promise<boolean> {
  const st = store()
  if (!st) return false
  try {
    await update<T>(key, (cur) => fn(cur), st)
    return true
  } catch {
    return false
  }
}

export async function dropCache(key: string): Promise<void> {
  const st = store()
  if (!st) return
  try {
    await del(key, st)
  } catch {
    /* nothing to drop */
  }
}

/**
 * Does `key` (an IndexedDB key `<scope>|…`, or a scope itself) belong to `scope`? A workspace scope without a member
 * (`cloud:<ws>`) holds every member's scope of it (`cloud:<ws>:u:<account>`); `null` = every scope.
 */
export function inPatchbayScope(key: string, scope: string | null): boolean {
  if (scope === null) return true
  if (key === scope || key.startsWith(`${scope}|`)) return true
  if (!scope.startsWith('cloud:') || scope.includes(':u:') || !key.startsWith(`${scope}:u:`)) return false
  // the member's id runs up to the record's '|' (or to the end: a scope)
  const member = key.slice(scope.length + 3).split('|')[0]
  return member.length > 0 && !member.includes(':')
}

/**
 * Remove every record of a scope (the device copy's wipe of a team workspace: `cloud:<ws>` takes each member's scope of
 * it along; `null` = every scope: the local reset) — the IndexedDB records and the scope's row order in localStorage;
 * with `null` also the device's own switches (`one.patchbay.*`) and this tab's return chip.
 */
export async function wipePatchbay(scope: string | null): Promise<void> {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (scope === null ? k.startsWith(LS_PREFIX) : k.startsWith(ORDER_PREFIX) && inPatchbayScope(k.slice(ORDER_PREFIX.length), scope)) window.localStorage.removeItem(k)
    }
    if (scope === null) window.sessionStorage.removeItem(SS_RETURN)
  } catch {
    /* no storage here */
  }
  const st = store()
  if (!st) return
  try {
    const all = (await keys(st)).filter((k): k is string => typeof k === 'string' && inPatchbayScope(k, scope))
    if (all.length) await delMany(all, st)
  } catch {
    /* blocked: nothing kept either */
  }
}

/** localStorage, never throwing (private mode, blocked site data). */
export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* this tab keeps it in memory, if anything */
  }
}
