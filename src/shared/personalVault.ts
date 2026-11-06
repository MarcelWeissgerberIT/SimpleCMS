/** Personal secrets: client-side authenticated encryption. The server stores only this envelope. */
export type VaultKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
export const VAULT_ITERATIONS = 600_000
export const VAULT_MAX = 160_000
export interface VaultEnvelope { v: 1; salt: string; iv: string; data: string; iterations: number }
export interface PersonalConnection { id: string; name: string; url: string; token: string; tools: string[] }
export const connectionUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port && u.port !== '443') return null
    if (!u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname) || (u.hostname.endsWith('.local') || u.hostname.endsWith('.localhost')) || u.hostname.includes(':')) return null
    return u.href
  } catch { return null }
}
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
export function isVaultEnvelope(v: unknown): v is VaultEnvelope {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return Object.keys(o).sort().join(',') === 'data,iterations,iv,salt,v' && o.v === 1 && o.iterations === VAULT_ITERATIONS &&
    typeof o.salt === 'string' && o.salt.length === 24 && /^[A-Za-z0-9+/]{22}==$/.test(o.salt) && typeof o.iv === 'string' && o.iv.length === 16 && B64.test(o.iv) &&
    typeof o.data === 'string' && o.data.length >= 24 && o.data.length <= VAULT_MAX && B64.test(o.data)
}
export function validConnection(v: unknown): v is PersonalConnection {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as PersonalConnection
  return typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) && typeof o.name === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(o.name) &&
    !['one', 'one-task'].includes(o.name) && typeof o.url === 'string' && o.url.length <= 500 && connectionUrl(o.url) !== null && typeof o.token === 'string' && o.token.length >= 8 && o.token.length <= 8192 && !/[\r\n]/.test(o.token) &&
    Array.isArray(o.tools) && o.tools.length >= 1 && o.tools.length <= 60 && o.tools.every(t => typeof t === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(t))
}
const bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const base64 = (v: ArrayBuffer | Uint8Array) => btoa(Array.from(new Uint8Array(v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v), c => String.fromCharCode(c)).join(''))
const aad = (account: string) => new TextEncoder().encode('one-personal-secrets/v1\n' + account)
export async function deriveVaultKey(passphrase: string, salt: string): Promise<VaultKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(salt), iterations: VAULT_ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export const vaultSalt = () => base64(crypto.getRandomValues(new Uint8Array(16)))
export async function encryptConnections(key: VaultKey, salt: string, account: string, entries: PersonalConnection[]): Promise<VaultEnvelope> {
  if (entries.length > 20 || !entries.every(validConnection) || new Set(entries.map(e => e.name)).size !== entries.length || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Invalid personal connections')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(account) }, key, new TextEncoder().encode(JSON.stringify(entries)))
  const envelope: VaultEnvelope = { v: 1, salt, iv: base64(iv), data: base64(data), iterations: VAULT_ITERATIONS }
  if (!isVaultEnvelope(envelope)) throw new Error('Personal vault is too large')
  return envelope
}
export async function decryptConnections(key: VaultKey, envelope: VaultEnvelope, account: string): Promise<PersonalConnection[]> {
  if (!isVaultEnvelope(envelope)) throw new Error('Invalid personal vault')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: aad(account) }, key, bytes(envelope.data))
  const entries: unknown = JSON.parse(new TextDecoder().decode(plain))
  if (!Array.isArray(entries) || entries.length > 20 || !entries.every(validConnection) || new Set(entries.map(e => e.id)).size !== entries.length || new Set(entries.map(e => e.name)).size !== entries.length) throw new Error('Invalid personal connections')
  return entries
}
