/**
 * An MCP server's OAuth settings as readers see them (pure): every field checked again, whatever the stored
 * list says — endpoints https only (http on localhost), a client id of sane length. Never a token here.
 */
import type { McpOAuthConfig } from '../../../store/types'

/** An endpoint One may talk to: https (or http on this machine), no credentials in it. */
export function endpointOk(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2000) return false
  try {
    const u = new URL(raw)
    if (u.username || u.password) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
  } catch {
    return false
  }
}

/** The stored OAuth settings, sanitized (undefined: none, or unusable). */
export function readOAuth(raw: unknown): McpOAuthConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (!endpointOk(o.issuer) || !endpointOk(o.authorizationEndpoint) || !endpointOk(o.tokenEndpoint) || !endpointOk(o.resource) || !endpointOk(o.redirectUri)) return undefined
  if (typeof o.clientId !== 'string' || !o.clientId || o.clientId.length > 500) return undefined
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
  return {
    issuer: o.issuer,
    authorizationEndpoint: o.authorizationEndpoint,
    tokenEndpoint: o.tokenEndpoint,
    clientId: o.clientId,
    redirectUri: o.redirectUri,
    resource: o.resource,
    ...(typeof o.scope === 'string' && o.scope.length <= 1000 ? { scope: o.scope } : {}),
    ...(n(o.expiresAt) ? { expiresAt: n(o.expiresAt) } : {}),
    ...(o.refresh === true ? { refresh: true } : {}),
    ...(o.secret === true ? { secret: true } : {}),
    ...(n(o.at) ? { at: n(o.at) } : {}),
  }
}
