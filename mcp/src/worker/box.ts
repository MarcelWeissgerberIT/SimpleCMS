/**
 * one-worker — the end-to-end box of the tab ⇄ worker protocol through the team server's relay (cloud mode,
 * docs/CODING.md § Cloud worker → Encryption). The node:crypto twin of src/app/features/coding/relayBox.ts
 * (WebCrypto in the tab); mcp/test/worker-box.test.ts checks both against each other and fixed vectors.
 *
 * Session key = HKDF-SHA256(ikm = the pairing secret's 32 bytes, salt = tab nonce ‖ worker nonce,
 * info "one-worker-relay v1") → AES-256-GCM. Each frame: a random 12-byte iv, AAD "wt:<s>:<seq>" (worker → tab)
 * or "tw:<s>:<seq>" (tab → worker); seq rises strictly per direction. Synchronous (node:crypto), so frames
 * are sealed and opened in the order they come.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { RELAY_BOX_INFO, RELAY_IV, RELAY_NONCE, type RelayBox } from '../../../src/app/features/coding/protocol.ts'

const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/** 32 random bytes, base64url (a key-exchange nonce). */
export const newNonce = (): string => randomBytes(32).toString('base64url')

/** The session key of one pairing. Throws on a malformed secret or nonce. */
export function sessionKey(pair: string, tabNonce: string, workerNonce: string, info: string = RELAY_BOX_INFO): Buffer {
  if (!RELAY_NONCE.test(pair) || !RELAY_NONCE.test(tabNonce) || !RELAY_NONCE.test(workerNonce)) throw new Error('bad key material')
  const salt = Buffer.concat([Buffer.from(tabNonce, 'base64url'), Buffer.from(workerNonce, 'base64url')])
  return Buffer.from(hkdfSync('sha256', Buffer.from(pair, 'base64url'), salt, Buffer.from(info, 'utf8'), 32))
}

export class BoxSession {
  private sent = 0
  private seen = 0
  readonly s: number
  private readonly key: Buffer
  private readonly out: 'tw' | 'wt'
  private readonly into: 'tw' | 'wt'

  constructor(key: Buffer, s: number, side: 'tab' | 'worker' = 'worker') {
    this.key = key
    this.s = s
    this.out = side === 'tab' ? 'tw' : 'wt'
    this.into = side === 'tab' ? 'wt' : 'tw'
  }

  seal(text: string, droppable = false, iv: Buffer = randomBytes(12)): RelayBox {
    const seq = ++this.sent
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(`${this.out}:${this.s}:${seq}`, 'utf8'))
    const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])
    return { type: 'box', s: this.s, seq, iv: iv.toString('base64url'), data: ct.toString('base64'), ...(droppable ? { k: 'e' as const } : {}) }
  }

  /** The plain frame — or throws (another pairing, a replayed / reordered box, tampered or another key). */
  open(box: { s?: unknown; seq?: unknown; iv?: unknown; data?: unknown }): string {
    const seq = box.seq
    if (box.s !== this.s || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= this.seen) throw new Error('box out of order')
    if (typeof box.iv !== 'string' || !RELAY_IV.test(box.iv) || typeof box.data !== 'string' || !B64.test(box.data)) throw new Error('bad box')
    const raw = Buffer.from(box.data, 'base64')
    if (raw.length < 16) throw new Error('bad box')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(box.iv, 'base64url'))
    decipher.setAAD(Buffer.from(`${this.into}:${this.s}:${seq}`, 'utf8'))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    const plain = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8')
    this.seen = seq
    return plain
  }
}
