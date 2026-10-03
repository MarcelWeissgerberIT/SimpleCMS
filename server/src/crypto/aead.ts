/**
 * Encryption at rest (docs/CLOUD.md § Tenancy & encryption at rest) — Node's built-in crypto only.
 *
 * Envelope v1 (documents, file names, idempotency answers, wrapped workspace keys):
 *
 *   [0]        version byte 0x01  = AES-256-GCM, 96-bit random nonce, 128-bit tag
 *   [1..12]    nonce              (fresh `randomBytes(12)` for every seal — never reused)
 *   [13..n-16] ciphertext
 *   [n-16..n]  GCM tag
 *
 * The additional authenticated data is the version byte followed by a context string that names
 * where the ciphertext lives (`doc\n<document name>`, `file\n<workspace>\n<file id>` …): a ciphertext
 * copied to another row, file or workspace fails to authenticate instead of decrypting there.
 *
 * Stored files use the same layout written as a stream (header, ciphertext, tag at the end); they are
 * authenticated completely before a single plaintext byte is served (see `openFile`).
 */
import { type CipherGCM, createCipheriv, createDecipheriv, createHmac, type DecipherGCM, hkdfSync, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open as openFd } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'

export const KEY_BYTES = 32
export const NONCE_BYTES = 12
export const TAG_BYTES = 16
/** Format v1: AES-256-GCM with the workspace's key (or, for wrapped keys, the master key). */
export const V1 = 0x01
export const HEADER_BYTES = 1 + NONCE_BYTES
const ALGO = 'aes-256-gcm'

/** Wrong key, wrong context (a copied ciphertext), damaged or truncated data, unknown format. */
export class DecryptError extends Error {
  constructor(message = 'decryption failed') {
    super(message)
    this.name = 'DecryptError'
  }
}

const aad = (version: number, context: string) => Buffer.concat([Buffer.of(version), Buffer.from(context, 'utf8')])

function checkKey(key: Buffer) {
  if (key.length !== KEY_BYTES) throw new Error('AES-256-GCM needs a 32-byte key')
}

/** Encrypt `plaintext` for the place named by `context`. */
export function seal(key: Buffer, plaintext: Uint8Array, context: string): Buffer {
  checkKey(key)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGO, key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad(V1, context))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.of(V1), nonce, body, cipher.getAuthTag()])
}

/** Decrypt and authenticate an envelope sealed for `context`; throws DecryptError otherwise. */
export function open(key: Buffer, envelope: Uint8Array, context: string): Buffer {
  checkKey(key)
  const buf = Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength)
  if (buf.length < HEADER_BYTES + TAG_BYTES) throw new DecryptError('ciphertext too short')
  if (buf[0] !== V1) throw new DecryptError(`unknown ciphertext format ${buf[0]}`)
  const decipher = createDecipheriv(ALGO, key, buf.subarray(1, HEADER_BYTES), { authTagLength: TAG_BYTES })
  decipher.setAAD(aad(V1, context))
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(buf.subarray(HEADER_BYTES, buf.length - TAG_BYTES)), decipher.final()])
  } catch {
    throw new DecryptError('authentication failed')
  }
}

/** Short text values (file names, JSON answers) as `v1.<base64url envelope>` in a TEXT column. */
export const TEXT_PREFIX = 'v1.'
export const sealText = (key: Buffer, text: string, context: string) => TEXT_PREFIX + seal(key, Buffer.from(text, 'utf8'), context).toString('base64url')
export const isSealedText = (s: string) => s.startsWith(TEXT_PREFIX)
export function openText(key: Buffer, sealed: string, context: string): string {
  if (!isSealedText(sealed)) throw new DecryptError('not a sealed text')
  return open(key, Buffer.from(sealed.slice(TEXT_PREFIX.length), 'base64url'), context).toString('utf8')
}

/* ------------------------------------------------------------------ keys */

/** A workspace's data key, split into independent subkeys (HKDF-SHA256, domain-separated). */
export interface WorkspaceKey {
  /** AES-256-GCM: documents, files, file names, idempotency answers. */
  aead: Buffer
  /** HMAC-SHA256: keyed content fingerprints of files (ETag) — no plain hash of the content at rest. */
  mac: Buffer
}

const hkdf = (ikm: Buffer, info: string) => Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, KEY_BYTES))

export function deriveWorkspaceKey(dek: Buffer): WorkspaceKey {
  checkKey(dek)
  return { aead: hkdf(dek, 'one/workspace/aead/v1'), mac: hkdf(dek, 'one/workspace/file-mac/v1') }
}

export const newDataKey = () => randomBytes(KEY_BYTES)

/** A workspace's data key wrapped by the master key; the AAD binds it to that workspace. */
export const wrapKey = (kek: Buffer, dek: Buffer, workspaceId: string) => seal(kek, dek, `dek\n${workspaceId}`)
export function unwrapKey(kek: Buffer, wrapped: Uint8Array, workspaceId: string): Buffer {
  const dek = open(kek, wrapped, `dek\n${workspaceId}`)
  if (dek.length !== KEY_BYTES) throw new DecryptError('wrapped key has the wrong length')
  return dek
}

/**
 * A key that only the holder of a high-entropy secret can derive (HKDF-SHA256 of it): the sign-in
 * redirect is sealed with the magic-link token, so the database never holds it (it can carry an
 * invite token, `#/invite/<token>`) in a readable form.
 */
export const keyFromSecret = (secret: string, info: string) => hkdf(Buffer.from(secret, 'utf8'), info)

/** Names the master key without revealing it (HMAC of a fixed label): tells "wrong DATA_KEY" apart from damage. */
export const keyId = (kek: Buffer) => createHmac('sha256', kek).update('one/kek-id/v1').digest('hex').slice(0, 16)

/* ------------------------------------------------------------------ contexts (what the AAD names) */

export const docContext = (documentName: string) => `doc\n${documentName}`
export const fileContext = (workspaceId: string, fileId: string) => `file\n${workspaceId}\n${fileId}`
export const fileNameContext = (workspaceId: string, fileId: string) => `file-name\n${workspaceId}\n${fileId}`
export const idempotencyContext = (scope: string, key: string) => `idempotency\n${scope}\n${key}`

/* ------------------------------------------------------------------ files (streamed) */

/**
 * Encrypts an upload while it streams in: `header` first, then `update()` for every chunk, then
 * `final()` (the tag). `fingerprint()` is the keyed HMAC of the plaintext (the stored "sha256").
 */
export interface FileSealer {
  header: Buffer
  update(chunk: Uint8Array): Buffer
  final(): Buffer
  fingerprint(): string
}

export function fileSealer(key: WorkspaceKey, workspaceId: string, fileId: string): FileSealer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher: CipherGCM = createCipheriv(ALGO, key.aead, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad(V1, fileContext(workspaceId, fileId)))
  const mac = createHmac('sha256', key.mac)
  return {
    header: Buffer.concat([Buffer.of(V1), nonce]),
    update(chunk) {
      mac.update(chunk)
      return cipher.update(chunk)
    },
    final() {
      const rest = cipher.final()
      return Buffer.concat([rest, cipher.getAuthTag()])
    },
    fingerprint: () => mac.digest('hex'),
  }
}

interface FileLayout {
  size: number
  nonce: Buffer
  tag: Buffer
}

async function layout(path: string): Promise<FileLayout> {
  const fh = await openFd(path, 'r')
  try {
    const { size } = await fh.stat()
    if (size < HEADER_BYTES + TAG_BYTES) throw new DecryptError('encrypted file too short')
    const head = Buffer.alloc(HEADER_BYTES)
    await fh.read(head, 0, HEADER_BYTES, 0)
    if (head[0] !== V1) throw new DecryptError(`unknown file format ${head[0]}`)
    const tag = Buffer.alloc(TAG_BYTES)
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES)
    return { size, nonce: head.subarray(1), tag }
  } finally {
    await fh.close()
  }
}

function decipherFor(key: WorkspaceKey, context: string, l: FileLayout): DecipherGCM {
  const d = createDecipheriv(ALGO, key.aead, l.nonce, { authTagLength: TAG_BYTES })
  d.setAAD(aad(V1, context))
  d.setAuthTag(l.tag)
  return d
}

function body(path: string, l: FileLayout): Readable | null {
  const end = l.size - TAG_BYTES - 1
  return end < HEADER_BYTES ? null : createReadStream(path, { start: HEADER_BYTES, end })
}

/**
 * Opens an encrypted file for reading: the whole file is authenticated first (one pass that discards
 * the output), so a damaged, truncated or swapped file is refused before anything is sent. `stream()`
 * then decrypts it again on the way out. Plaintext size = ciphertext size − header − tag.
 */
export async function openFile(path: string, key: WorkspaceKey, workspaceId: string, fileId: string): Promise<{ size: number; stream: () => Readable }> {
  const context = fileContext(workspaceId, fileId)
  const l = await layout(path)
  const check = decipherFor(key, context, l)
  const src = body(path, l)
  try {
    // the transform's flush runs final(): a wrong tag rejects the pipeline
    if (src) await pipeline(src, check, new Writable({ write: (_chunk, _enc, cb) => cb() }))
    else check.final()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err
    throw new DecryptError('file authentication failed')
  }
  return {
    size: l.size - HEADER_BYTES - TAG_BYTES,
    stream: () => {
      const d = decipherFor(key, context, l)
      const s = body(path, l)
      if (!s) {
        d.end()
        return d
      }
      s.on('error', (err) => d.destroy(err))
      return s.pipe(d)
    },
  }
}

/** Decrypts a whole encrypted file into memory (migration of a crash leftover, tests). */
export async function readFileDecrypted(path: string, key: WorkspaceKey, workspaceId: string, fileId: string): Promise<Buffer> {
  const f = await openFile(path, key, workspaceId, fileId)
  const chunks: Buffer[] = []
  for await (const chunk of f.stream()) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}
