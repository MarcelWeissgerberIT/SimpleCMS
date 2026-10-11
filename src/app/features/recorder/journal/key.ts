/**
 * The journal's digest key: one non-extractable HMAC-SHA-256 key per scope, made on this device and kept
 * in `kv <scope>|hmac` (never exported, never synced). Two tabs making it at once end with the same key
 * (`add` fails for the second, which reads the first). Values are not readable from the tape; it is useless
 * outside this browser profile — but equal values give equal digests within a scope.
 */
import type { LeftHash, Scope } from '../model/types'
import { openJournal, onJournalClosed } from './db'

const keys = new Map<Scope, Promise<CryptoKey>>()
onJournalClosed(() => keys.clear())

const isKey = (v: unknown): v is CryptoKey => typeof CryptoKey !== 'undefined' && v instanceof CryptoKey && v.extractable === false && v.algorithm.name === 'HMAC'

const kvKey = (s: Scope) => `${s}|hmac`

const generate = () => crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']) as Promise<CryptoKey>

async function load(scope: Scope): Promise<CryptoKey> {
  const j = await openJournal()
  const read = async () => (await j.get<{ k: string; key: unknown }>('kv', kvKey(scope)))?.key
  const have = await read()
  if (isKey(have)) return have
  const made = await generate()
  if (await j.add('kv', { k: kvKey(scope), key: made })) return made
  // another tab was first: take its key
  const theirs = await read()
  if (isKey(theirs)) return theirs
  throw new Error('[recorder] no digest key')
}

/** The scope's key (made on first use). */
export function scopeKey(scope: Scope): Promise<CryptoKey> {
  let p = keys.get(scope)
  if (!p) {
    p = load(scope)
    keys.set(scope, p)
    p.catch(() => keys.delete(scope))
  }
  return p
}

/** Forget a scope's key in this tab (the scope was wiped). */
export function forgetScopeKey(scope: Scope): void {
  keys.delete(scope)
  blockCache.clear()
  blockBytes = 0
}

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(scope: Scope, text: string, bytes: number): Promise<string> {
  const key = await scopeKey(scope)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)))
  return b64url(sig.subarray(0, bytes))
}

/** The whole digest of a place (9 bytes → 12 chars). */
export const digestWhole = (scope: Scope, canon: string): Promise<string> => sign(scope, `h\u0000${canon}`, 9)

/** One part's digest (6 bytes → 8 chars); input `<partKey>\0<canonical>`. */
export const digestPart = (scope: Scope, part: string, canon: string): Promise<string> => sign(scope, `${part}\u0000${canon}`, 6)

/** Every part of a place, signed in one batch. */
export async function digestParts(scope: Scope, parts: Record<string, string>): Promise<Record<string, string>> {
  const keys = Object.keys(parts)
  const sigs = await Promise.all(keys.map((k) => digestPart(scope, k, parts[k])))
  const out: Record<string, string> = {}
  keys.forEach((k, i) => (out[k] = sigs[i]))
  return out
}

/* block digests: an LRU keyed by the block's canonical string (a typing pause re-signs only changed blocks) */

const BLOCK_MAX = 4000
const BLOCK_BYTES = 8_000_000
const blockCache = new Map<string, string>()
let blockBytes = 0

/** A top-level block's digest (8 chars). */
export async function digestBlock(scope: Scope, canon: string): Promise<string> {
  const k = `${scope}\u0000${canon}`
  const hit = blockCache.get(k)
  if (hit) {
    blockCache.delete(k)
    blockCache.set(k, hit)
    return hit
  }
  const d = await digestPart(scope, 'b', canon)
  blockCache.set(k, d)
  blockBytes += k.length * 2
  while (blockCache.size > BLOCK_MAX || blockBytes > BLOCK_BYTES) {
    const first = blockCache.keys().next().value as string | undefined
    if (first === undefined) break
    blockCache.delete(first)
    blockBytes -= first.length * 2
  }
  return d
}

/**
 * What a writer left on a place: the whole digest, part digests and (pages) the ordered block digests — a place the
 * writer created too (a NEW row or page compares part by part like any other; Δ28).
 */
export async function digestLeft(scope: Scope, c: { parts: Record<string, string>; blocks?: Array<{ id: string | null; canon: string }> }, whole: string): Promise<LeftHash> {
  const h = await digestWhole(scope, whole)
  const out: LeftHash = { h, parts: await digestParts(scope, c.parts) }
  if (c.blocks) out.blocks = await Promise.all(c.blocks.map(async (b) => `${b.id ?? '#'}=${await digestBlock(scope, b.canon)}`))
  return out
}
