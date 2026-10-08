/**
 * MCP sign-in e2e helpers: a mocked MCP server + authorization server (metadata, dynamic registration, PKCE, token,
 * refresh), one whose sign-in offers a code (RFC 8628), one without any sign-in — and a dump of everything the origin
 * stores (no token may be in it in the clear). Nothing reaches a real host.
 */
import { createHash } from 'node:crypto'
import type { BrowserContext, Page, Route } from '@playwright/test'
import type { AnyState } from './terminal'

export const MCP_URL = 'https://mcp.oauth.test/mcp'
export const AUTH = 'https://auth.oauth.test'
export const ACCESS1 = 'oauth-e2e-ACCESS-token-one-7H2q'
export const ACCESS2 = 'oauth-e2e-ACCESS-token-two-9K4z'
export const REFRESH1 = 'oauth-e2e-REFRESH-token-one-3M8x'
export const REFRESH2 = 'oauth-e2e-REFRESH-token-two-5P1w'

export interface AuthLog {
  registered: AnyState[]
  authorize: URLSearchParams[]
  token: URLSearchParams[]
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-expose-headers': 'WWW-Authenticate' }

/** The MCP server (401 + resource metadata) and its authorization server (metadata, DCR, authorize, token). */
export async function mockOAuth(ctx: BrowserContext): Promise<AuthLog> {
  const log: AuthLog = { registered: [], authorize: [], token: [] }
  const json = (route: Route, status: number, body: unknown, extra: Record<string, string> = {}) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
  let challenge = ''
  await ctx.route('https://mcp.oauth.test/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    if (path === '/mcp') return json(route, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="https://mcp.oauth.test/.well-known/oauth-protected-resource/mcp", scope="records:read"` })
    if (path === '/.well-known/oauth-protected-resource/mcp') return json(route, 200, { resource: MCP_URL, authorization_servers: [AUTH], scopes_supported: ['records:read'] })
    return json(route, 404, {})
  })
  await ctx.route(`${AUTH}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(route, 200, { issuer: AUTH, authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, registration_endpoint: `${AUTH}/register`, code_challenge_methods_supported: ['S256'], response_types_supported: ['code'] })
    if (url.pathname === '/register') {
      log.registered.push(JSON.parse(req.postData() ?? '{}'))
      return json(route, 201, { client_id: 'one-e2e-client', token_endpoint_auth_method: 'none' })
    }
    if (url.pathname === '/authorize') {
      log.authorize.push(url.searchParams)
      challenge = url.searchParams.get('code_challenge') ?? ''
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'CODE-e2e-1')
      back.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({ status: 302, headers: { location: back.href } })
    }
    if (url.pathname === '/token') {
      const p = new URLSearchParams(req.postData() ?? '')
      log.token.push(p)
      if (p.get('grant_type') === 'authorization_code') {
        // PKCE: the verifier must hash to the challenge the authorization request carried
        const ok = p.get('code') === 'CODE-e2e-1' && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === challenge && p.get('client_id') === 'one-e2e-client'
        return ok ? json(route, 200, { access_token: ACCESS1, refresh_token: REFRESH1, token_type: 'Bearer', expires_in: 3600 }) : json(route, 400, { error: 'invalid_grant' })
      }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === REFRESH1) return json(route, 200, { access_token: ACCESS2, refresh_token: REFRESH2, token_type: 'Bearer', expires_in: 3600 })
      return json(route, 400, { error: 'invalid_grant' })
    }
    return json(route, 404, {})
  })
  return log
}

export const CODES_HOST = 'https://mcp.codes.test'
export const CODES_AUTH = 'https://auth.codes.test'

export interface CodeLog {
  reg: AnyState[]
  devices: URLSearchParams[]
  polls: URLSearchParams[]
  /** device-code polls answered "authorization_pending" before the tokens */
  pending: number
}

/**
 * An MCP server whose sign-in offers a code (RFC 8628). `wayBack` false: registering this page as the way back is
 * refused (a client for the device grant alone is not); true: it is accepted, but the sign-in page never returns.
 */
export async function mockCodeAuth(ctx: BrowserContext, { wayBack }: { wayBack: boolean }): Promise<CodeLog> {
  const log: CodeLog = { reg: [], devices: [], polls: [], pending: 1 }
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const html = (route: Route, title: string) => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: `<!doctype html><title>${title}</title><p>${title}</p>` })
  await ctx.route(`${CODES_HOST}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    if (path === '/mcp') return route.fulfill({ status: 401, headers: { ...CORS, 'www-authenticate': `Bearer resource_metadata="${CODES_HOST}/.well-known/oauth-protected-resource/mcp"` }, body: '' })
    if (path === '/.well-known/oauth-protected-resource/mcp') return json(route, 200, { resource: `${CODES_HOST}/mcp`, authorization_servers: [CODES_AUTH] })
    return json(route, 404, {})
  })
  let polled = 0
  await ctx.route(`${CODES_AUTH}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(route, 200, { issuer: CODES_AUTH, authorization_endpoint: `${CODES_AUTH}/authorize`, token_endpoint: `${CODES_AUTH}/token`, registration_endpoint: `${CODES_AUTH}/register`, device_authorization_endpoint: `${CODES_AUTH}/device`, code_challenge_methods_supported: ['S256'] })
    if (url.pathname === '/register') {
      const body = JSON.parse(req.postData() ?? '{}')
      log.reg.push(body)
      if (body.redirect_uris && !wayBack) return json(route, 400, { error: 'invalid_redirect_uri', error_description: 'redirect not allowed' })
      return json(route, 201, { client_id: 'codes-e2e-client', grant_types: body.grant_types })
    }
    if (url.pathname === '/authorize') return html(route, 'Sign in')
    if (url.pathname === '/device') {
      log.devices.push(new URLSearchParams(req.postData() ?? ''))
      polled = 0
      return json(route, 200, { device_code: 'DEVICE-e2e-1', user_code: 'WDJB-MJHT', verification_uri: `${CODES_AUTH}/activate`, verification_uri_complete: `${CODES_AUTH}/activate?user_code=WDJB-MJHT`, expires_in: 600, interval: 1 })
    }
    if (url.pathname === '/activate') return html(route, 'Enter the code')
    if (url.pathname === '/token') {
      const p = new URLSearchParams(req.postData() ?? '')
      log.polls.push(p)
      if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code' || p.get('device_code') !== 'DEVICE-e2e-1' || p.get('client_id') !== 'codes-e2e-client') return json(route, 400, { error: 'invalid_grant' })
      // the person has not allowed it yet
      if (++polled <= log.pending) return json(route, 400, { error: 'authorization_pending' })
      return json(route, 200, { access_token: 'codes-e2e-ACCESS-Rt55', refresh_token: 'codes-e2e-REFRESH-Yu66', token_type: 'Bearer', expires_in: 3600 })
    }
    return json(route, 404, {})
  })
  return log
}

/** A server without any sign-in (404 everywhere) — or, `open`, one that answers the probe (no sign-in needed). */
export async function mockPlainMcp(ctx: BrowserContext, host: string, opts: { open?: boolean } = {}): Promise<void> {
  await ctx.route(`${host}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    if (opts.open && path === '/mcp') return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'open', version: '1' } } }) })
    return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: '{}' })
  })
}

/** Every IndexedDB record and local/session storage of the origin, as text. */
export function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = []
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        const [keys, values] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          const k = tx.objectStore(store).getAllKeys()
          const v = tx.objectStore(store).getAll()
          tx.oncomplete = () => resolve([k.result, v.result])
          tx.onerror = () => reject(tx.error)
        })
        parts.push(`${name}/${store} ${JSON.stringify(keys)} ${JSON.stringify(values, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? '[bytes]' : v))}`)
      }
      db.close()
    }
    parts.push(`localStorage ${JSON.stringify({ ...localStorage })}`, `sessionStorage ${JSON.stringify({ ...sessionStorage })}`)
    return parts.join('\n')
  })
}
