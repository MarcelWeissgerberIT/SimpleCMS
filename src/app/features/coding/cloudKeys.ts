/**
 * Cloud worker — this device's pairing keys (docs/CODING.md § Cloud worker → Encryption). One per cloud download
 * of this device, kept as a NON-EXTRACTABLE WebCrypto HKDF key (relayBox.ts importPairKey) in IndexedDB
 * "one-coding" / "kv" under `cloud:<server workspace id>|cloudpair|<token id>` — wiped with the workspace's copy
 * on this device (cloud/device.ts). Script running in One can derive session keys with it only while it runs; it
 * can never read the secret out (the raw secret exists only in the downloaded file). Which token ids this device
 * holds keys for is in localStorage `one.coding` → `cloudPairs` (state.ts) — ids only. Without IndexedDB (some
 * private modes) the keys live in this tab's memory.
 */
import { createStore, delMany, get as idbGet, set as idbSet, type UseStore } from 'idb-keyval'
import { importPairKey, type SessionKey } from './relayBox'

const mem = new Map<string, SessionKey>()

let db: UseStore | null = null
const kv = (): UseStore | null => {
  if (typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-coding', 'kv'))
}

/** `team:<id>` → the IndexedDB key (the scope `cloud:<id>` local.ts and the device wipe use). */
const keyOf = (workspaceId: string, token: string) => `cloud:${workspaceId.replace(/^team:/, '')}|cloudpair|${token}`

const isKey = (v: unknown): v is SessionKey => typeof CryptoKey !== 'undefined' && v instanceof CryptoKey && v.extractable === false && v.algorithm.name === 'HKDF'

/** Keep a fresh download's pairing secret as this device's key (the raw secret is not stored anywhere). */
export async function keepCloudKey(workspaceId: string, token: string, secret: string): Promise<void> {
  const key = await importPairKey(secret)
  const k = keyOf(workspaceId, token)
  mem.set(k, key)
  const store = kv()
  if (!store) return
  try {
    await idbSet(k, key, store)
  } catch {
    /* private mode: this tab keeps it */
  }
}

/** This device's key for the cloud download with that token id (null: none here). */
export async function cloudKey(workspaceId: string, token: string): Promise<SessionKey | null> {
  const k = keyOf(workspaceId, token)
  const known = mem.get(k)
  if (known) return known
  const store = kv()
  if (!store) return null
  try {
    const v = await idbGet<unknown>(k, store)
    if (!isKey(v)) return null
    mem.set(k, v)
    return v
  } catch {
    return null
  }
}

/** Forget the keys of these downloads (revoked, replaced, gone from the server's list). */
export async function dropCloudKeys(workspaceId: string, tokens: readonly string[]): Promise<void> {
  if (!tokens.length) return
  const ks = tokens.map((t) => keyOf(workspaceId, t))
  for (const k of ks) mem.delete(k)
  const store = kv()
  if (!store) return
  try {
    await delMany(ks, store)
  } catch {
    /* gone with the database */
  }
}
