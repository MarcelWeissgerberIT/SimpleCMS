import type { MiddlewareHandler } from 'hono'
import type { Config } from '../config.ts'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

/**
 * CSP for the app and landing page:
 * - scripts/styles/fonts come from this origin (inline styles: the boot screen, React style props, KaTeX)
 * - connect: own API + /collab websocket, plus any https: — the browser calls api.anthropic.com with the
 *   user's own key and posts automation webhooks to user-configured endpoints (n8n, Make, Zapier …)
 * - frames: page embeds (YouTube, Figma, Maps, any https page); the app itself may never be framed
 */
export function appCsp(config: Config): string {
  const ws = config.publicUrl.replace(/^http/, 'ws')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' data: blob: https:",
    `connect-src 'self' ${ws} https:`,
    'frame-src https:',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** For API responses (JSON). Static files get the app policy: a worker script (sw.js) runs under its own response's CSP. */
export const LOCKED_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox"

export function securityHeaders(config: Config): MiddlewareHandler<AppEnv> {
  const csp = appCsp(config)
  const hsts = config.publicUrl.startsWith('https://')
  return async (c, next) => {
    await next()
    const h = c.res.headers
    const api = c.req.path.startsWith('/api/') && !(h.get('content-type') ?? '').startsWith('text/html')
    if (!h.has('content-security-policy')) h.set('Content-Security-Policy', api ? LOCKED_CSP : csp)
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('X-Frame-Options', 'DENY')
    if (!h.has('referrer-policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    h.set('Cross-Origin-Opener-Policy', 'same-origin')
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    if (hsts) h.set('Strict-Transport-Security', 'max-age=31536000')
  }
}

/**
 * Same-origin check for browser requests. Browsers always send Origin on cross-site POST/PUT/PATCH/DELETE
 * and WebSocket handshakes; non-browser clients (curl, tests) send none and cannot ride a victim's cookie.
 * The request's own Host also counts, so a dev proxy (Vite on another port) keeps working.
 */
export function isSameOrigin(origin: string | null | undefined, host: string | null | undefined, publicUrl: string): boolean {
  if (!origin) return true
  if (origin === 'null') return false
  if (origin === publicUrl) return true
  try {
    return !!host && new URL(origin).host === host
  } catch {
    return false
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF guard (with SameSite=Lax cookies): mutating API requests must come from our origin and carry
 * Content-Type: application/json — a cross-site <form> cannot send that. Not for /api/v1 (no cookie
 * there, see app.ts PUBLIC_API). Exceptions:
 * - PUT …/files/:id carries the file's own content type; PUT always needs a CORS preflight, which we never grant.
 * - POST /api/auth/verify is the confirmation form of a magic link (Origin-checked, holds a single-use token).
 */
export function csrfGuard(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // the public API (/api/v1) never reads the cookie: bearer tokens / webhook secrets from servers
    // (n8n, Zapier, scripts) — and One's own automations, whose no-cors retry is text/plain
    if (!MUTATING.has(c.req.method) || c.req.path.startsWith('/api/v1/')) return next()
    const site = c.req.header('sec-fetch-site')
    if ((site && site !== 'same-origin' && site !== 'none') || !isSameOrigin(c.req.header('origin'), c.req.header('host'), config.publicUrl)) {
      throw new ApiError(403, 'bad_origin', 'Cross-origin request rejected')
    }
    const path = c.req.path
    const exempt = (c.req.method === 'PUT' && /^\/api\/workspaces\/[^/]+\/files\/[^/]+$/.test(path)) || (c.req.method === 'POST' && path === '/api/auth/verify')
    if (exempt) return next()
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (type !== 'application/json') throw new ApiError(400, 'json_required', 'Mutating requests need Content-Type: application/json')
    return next()
  }
}
