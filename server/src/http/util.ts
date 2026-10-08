import type { IncomingMessage } from 'node:http'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Config } from '../config.ts'
import type { AppEnv } from '../context.ts'
import { badRequest, unauthenticated } from '../errors.ts'
import type { Auth } from '../auth/sessions.ts'

/** Parses and validates a JSON body; every failure is a 400 with a stable code. */
export async function body<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    const text = await c.req.text()
    raw = text ? JSON.parse(text) : {}
  } catch {
    throw badRequest('invalid_json', 'Request body is not valid JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw badRequest('invalid_request', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), z.treeifyError(parsed.error))
  }
  return parsed.data
}

export function requireAuth(c: Context<AppEnv>): Auth {
  const auth = c.get('auth')
  if (!auth) throw unauthenticated()
  return auth
}

/**
 * Behind Caddy/a reverse proxy (TRUST_PROXY=1) the client is the right-most X-Forwarded-For entry:
 * the one our proxy appended, not anything the client sent itself.
 */
export function clientIp(c: Context<AppEnv>, config: Config): string {
  if (config.trustProxy) {
    const xff = c.req.header('x-forwarded-for')
    const last = xff?.split(',').pop()?.trim()
    if (last) return last
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** clientIp() for a raw WebSocket upgrade (no Hono context): the same TRUST_PROXY rule. */
export function ipOfUpgrade(req: IncomingMessage, config: Config): string {
  if (config.trustProxy) {
    const raw = req.headers['x-forwarded-for']
    const last = (Array.isArray(raw) ? raw.join(',') : raw)?.split(',').pop()?.trim()
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Only same-origin absolute paths; "//evil.com" and "/\evil.com" would leave the site. */
export function safeRedirect(raw: string | null | undefined, fallback = '/app/'): string {
  if (!raw || raw.length > 512) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\u0000-\u001f\u007f]/.test(raw)) return fallback
  return raw
}

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
