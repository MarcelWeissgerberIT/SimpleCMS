/**
 * Cloud worker — the end-to-end box of the tab ⇄ worker protocol through the team server's relay
 * (docs/CODING.md § Cloud worker → Encryption). WebCrypto only, no runtime imports: the worker has its own
 * node:crypto twin (mcp/src/worker/box.ts) and mcp/test/worker-box.test.ts checks both against each other
 * and against fixed test vectors.
 *
 *  - Both sides send a fresh 32-byte nonce (`key` frames, visible to the server). The session key is
 *    HKDF-SHA256(ikm = the pairing secret's 32 bytes, salt = tab nonce ‖ worker nonce, info "one-worker-relay v1")
 *    → AES-256-GCM, non-extractable.
 *  - Every protocol frame is sealed as { seq, iv, data }: a random 12-byte iv, AAD "tw:<s>:<seq>" (tab → worker)
 *    or "wt:<s>:<seq>" (worker → tab), `s` = the relay's pairing number. A box whose seq does not rise, whose
 *    direction or pairing is another one, or that does not open ends the session.
 *  - The server sees sizes, timing and the plaintext `k: 'e'` mark of droppable events — never content.
 */
import type { RelayBox } from './protocol'

export type BoxDir = 'tw' | 'wt'
/** WebCrypto's CryptoKey (spelled so it type-checks with and without the DOM lib: the worker tests load this file too). */
export type SessionKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  return fromB64(std + '='.repeat((4 - (std.length % 4)) % 4))
}

/** Standard base64 (large payloads: chunked, or the built-in Uint8Array.toBase64 where there is one). */
export function toB64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64
  if (typeof native === 'function') return native(s)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 32 random bytes, base64url (a key-exchange nonce). */
export function newNonce(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)))
}

const NONCE = /^[A-Za-z0-9_-]{43}$/
const IV = /^[A-Za-z0-9_-]{16}$/
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/** = protocol.ts RELAY_BOX_INFO (repeated here: this file has no runtime imports; worker-box.test.ts checks they agree). */
export const BOX_INFO = 'one-worker-relay v1'

/**
 * A download's pairing secret as the HKDF key this device keeps (cloudKeys.ts): NON-EXTRACTABLE — script in One can
 * derive session keys with it while it runs, never read the secret out. Throws on a malformed secret.
 */
export async function importPairKey(pair: string): Promise<SessionKey> {
  if (!NONCE.test(pair)) throw new Error('bad key material')
  return crypto.subtle.importKey('raw', fromB64url(pair), 'HKDF', false, ['deriveKey'])
}

/**
 * The session key of one pairing (non-extractable) — from the pairing secret, or from its kept HKDF key
 * (importPairKey). Throws on a malformed secret or nonce.
 */
export async function sessionKey(pair: string | SessionKey, tabNonce: string, workerNonce: string, info: string = BOX_INFO): Promise<SessionKey> {
  if (!NONCE.test(tabNonce) || !NONCE.test(workerNonce)) throw new Error('bad key material')
  const salt = new Uint8Array(64)
  salt.set(fromB64url(tabNonce), 0)
  salt.set(fromB64url(workerNonce), 32)
  const base = typeof pair === 'string' ? await importPairKey(pair) : pair
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * One pairing's box on one side: seals what this side sends (its own direction, rising seq) and opens what
 * the other side sent (the other direction, seq strictly above the last one). Calls must not overlap per
 * direction — the transport chains them (WebCrypto is async).
 */
export class BoxSession {
  private sent = 0
  private seen = 0
  readonly key: SessionKey
  readonly s: number
  private readonly out: BoxDir
  private readonly into: BoxDir

  constructor(key: SessionKey, s: number, side: 'tab' | 'worker') {
    this.key = key
    this.s = s
    this.out = side === 'tab' ? 'tw' : 'wt'
    this.into = side === 'tab' ? 'wt' : 'tw'
  }

  async seal(text: string, droppable = false, iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12))): Promise<RelayBox> {
    const seq = ++this.sent
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${this.out}:${this.s}:${seq}`) }, this.key, enc.encode(text)))
    return { type: 'box', s: this.s, seq, iv: toB64url(iv), data: toB64(ct), ...(droppable ? { k: 'e' as const } : {}) }
  }

  /** The plain frame — or throws (wrong pairing, a replayed / reordered box, tampered or another key). */
  async open(box: { s?: unknown; seq?: unknown; iv?: unknown; data?: unknown }): Promise<string> {
    const seq = box.seq
    if (box.s !== this.s || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= this.seen) throw new Error('box out of order')
    if (typeof box.iv !== 'string' || !IV.test(box.iv) || typeof box.data !== 'string' || !B64.test(box.data)) throw new Error('bad box')
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv), additionalData: enc.encode(`${this.into}:${this.s}:${seq}`) }, this.key, fromB64(box.data))
    this.seen = seq
    return dec.decode(plain)
  }
}
