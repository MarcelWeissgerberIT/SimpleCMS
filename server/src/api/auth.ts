/**
 * Bearer-token auth for /api/v1 (docs/API.md § Authentication). Only `Authorization: Bearer one_…`
 * counts — the session cookie is never read on these routes, so they need no CSRF guard and a
 * browser on another site cannot use anybody's session here.
 */
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, forbidden, rateLimited } from '../errors.ts'
import { clientIp } from '../http/util.ts'
import { type ApiTokenRow, isApiTokenShape } from '../repo.ts'
import { DAY, MINUTE, safeEqual } from '../tokens.ts'

/** Failed authentications (bad tokens, unknown hook URLs) per client IP per minute before 429. */
export const BAD_AUTH_PER_MIN = 30

export const HOOKS_PREFIX = '/api/v1/hooks/'

/** Counts a failed attempt from this client; past the limit the answer is 429 instead of 401/404. */
export function failedAttempt(s: Services, c: Context<AppEnv>, error: ApiError): ApiError {
  const wait = s.limiter.hit(`api:bad:${clientIp(c, s.config)}`, BAD_AUTH_PER_MIN, MINUTE)
  return wait ? rateLimited(wait) : error
}

export function bearer(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith(HOOKS_PREFIX)) return next()
    const header = c.req.header('authorization')
    const secret = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1]
    const row = isApiTokenShape(secret) ? s.repo.apiTokenBySecret(secret) : undefined
    // the lookup is by HMAC (timing reveals nothing about the secret); compare the digests in constant time too
    if (!row || !secret || !safeEqual(row.token_hash, s.repo.hash(secret))) {
      const challenge = { 'WWW-Authenticate': 'Bearer realm="SimpleCMS One"' }
      throw failedAttempt(
        s,
        c,
        header
          ? new ApiError(401, 'invalid_token', 'The API token is invalid or was revoked', { headers: challenge })
          : new ApiError(401, 'unauthenticated', 'Send an API token: Authorization: Bearer one_…', { headers: challenge }),
      )
    }
    const wait = s.limiter.hit(`api:token:${row.id}`, s.config.apiRateLimit, MINUTE)
    if (wait) throw rateLimited(wait)
    const now = Date.now()
    if (!row.last_used_at || now - row.last_used_at > MINUTE) s.repo.touchApiToken(row.id, now)
    c.set('token', row)
    await next()
  }
}

export function requireWrite(c: Context<AppEnv>): ApiTokenRow {
  const token = c.get('token')
  if (token.scope !== 'write') throw forbidden('insufficient_scope', 'This token can only read (scope "read")')
  return token
}

/* ------------------------------------------------------------------ idempotency */

const inflight = new Map<string, Promise<unknown>>()

export interface Answer {
  status: 200 | 201
  body: unknown
}

/**
 * Create requests with an Idempotency-Key (or a webhook's deliveryId): the first answer is kept for
 * 24 h and a repeat gets it again (200, `Idempotent-Replayed: true`) without creating anything. A
 * repeat that arrives while the first is still running waits for it.
 */
export async function idempotent(s: Services, c: Context<AppEnv>, scope: string, key: string | null, wsId: string, run: () => Promise<Answer>): Promise<Response> {
  if (key !== null && (!key || key.length > 255)) throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency keys are 1–255 characters')
  if (key === null) {
    const a = await run()
    return c.json(a.body as object, a.status)
  }
  const id = `${scope}\n${key}`
  const pending = inflight.get(id)
  if (pending) await pending.catch(() => {})
  const hit = s.repo.idempotent(scope, key, Date.now() - DAY)
  if (hit) {
    c.header('Idempotent-Replayed', 'true')
    return c.json(JSON.parse(hit.body) as object, 200)
  }
  const job = run()
  inflight.set(id, job)
  try {
    const a = await job
    try {
      s.repo.rememberIdempotent(scope, key, wsId, a.status, JSON.stringify(a.body))
    } catch (err) {
      // the workspace was deleted meanwhile (foreign key): the answer stands, there is nothing to replay
      s.log.warn('idempotency key not stored', { scope, error: (err as Error).message })
    }
    return c.json(a.body as object, a.status)
  } finally {
    if (inflight.get(id) === job) inflight.delete(id)
  }
}
