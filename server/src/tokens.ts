import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 random bytes, URL-safe. Used for login links, invites and sessions. */
export const randomToken = (): string => randomBytes(32).toString('base64url')

/** 12 random bytes → 16 URL-safe chars. Ids for users, workspaces, sessions, invites. */
export const newId = (): string => randomBytes(12).toString('base64url')

/** Tokens are stored only as HMAC-SHA256(SECRET, token): a database leak alone cannot be replayed. */
export const hashToken = (secret: Buffer, token: string): string => createHmac('sha256', secret).update(token).digest('hex')

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Shape check before any lookup: base64url of 32 bytes is exactly 43 chars. */
export const isTokenShape = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s)

export const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString())

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
