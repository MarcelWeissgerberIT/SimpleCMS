/**
 * "Sign in" to an MCP server instead of pasting a token — the MCP authorization spec, all in this browser:
 *
 *  1. discover(): the server's 401 (`WWW-Authenticate: Bearer resource_metadata="…"`) or its well-known
 *     protected-resource metadata → the authorization server → its metadata (RFC 8414 / OpenID, the spec's
 *     order of addresses). PKCE with S256 is required (absent = no sign-in, as the spec says).
 *  2. dynamic client registration when offered (a public client: no secret asked for; one that comes anyway
 *     is sealed as "mcp-client:<id>"); a registration for this redirect URI is reused.
 *  3. authorization code + PKCE in a sign-in window (or, when the browser blocks it, this tab goes there and
 *     comes back) to One's own page (`?oauth=mcp` → `#/oauth/mcp`, oauthReturn.ts); state + verifier per
 *     attempt in sessionStorage.
 *  4. the token exchange from this browser (CORS permitting — refused: said plainly, the token field stays).
 *     The access token becomes the server's `token` (a vault marker like a pasted one), a refresh token is
 *     sealed as "mcp-refresh:<id>" (store/secrets.ts). tokenFor() refreshes shortly before expiry, at request
 *     time; signOut() removes both. Tokens are never logged, exported, backed up or shared.
 */
import { create } from 'zustand'
import type { McpOAuthConfig, McpServerConfig } from '../../../store/types'
import { getMcpOAuthSecret, getMcpToken, setMcpOAuthSecret } from '../../../store/secrets'
import { patchServer, readServers } from './config'
import { endpointOk } from './oauthConfig'
import { PENDING_PREFIX, hasPending, listenForMcpOAuth, redirectUri, type OAuthReturn } from './oauthReturn'

export type OAuthIssue =
  /** the server offers no sign-in (no OAuth metadata) */
  | 'none'
  /** the server or its sign-in does not let a browser talk to it (CORS) */
  | 'cors'
  | 'offline'
  | 'metadata'
  /** no PKCE (S256) */
  | 'pkce'
  /** no dynamic client registration, or it was refused */
  | 'register'
  /** the sign-in was turned down there */
  | 'denied'
  /** the code came back for no attempt of this tab (expired, another browser) */
  | 'state'
  /** the token endpoint refused the code */
  | 'token'
  | 'vault'
  | 'cancelled'

export class OAuthError extends Error {
  issue: OAuthIssue
  detail: string
  constructor(issue: OAuthIssue, detail = '') {
    super(detail ? `${issue}: ${detail}` : issue)
    this.name = 'OAuthError'
    this.issue = issue
    this.detail = detail.slice(0, 240)
  }
}

/** Sign-ins in progress or just ended, by server id (Settings shows them). */
export interface SignInState {
  phase: 'working' | 'waiting' | 'done' | 'error'
  issue?: OAuthIssue
  detail?: string
}
export const useMcpSignIn = create<{ byServer: Record<string, SignInState> }>(() => ({ byServer: {} }))
const setPhase = (id: string, s: SignInState | null) =>
  useMcpSignIn.setState((st) => {
    const byServer = { ...st.byServer }
    if (s) byServer[id] = s
    else delete byServer[id]
    return { byServer }
  })

const TIMEOUT = 15_000

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

export interface Discovery {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
  /** the protected resource (RFC 8707) */
  resource: string
  scope: string
}

interface Got {
  status: number
  json: Record<string, unknown> | null
  headers: Headers
}

/** A request without credentials; a refused one (CORS / offline) throws OAuthError, an HTTP error does not. */
async function call(url: string, init: RequestInit = {}): Promise<Got> {
  let res: Response
  try {
    res = await fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(TIMEOUT) })
  } catch (e) {
    throw new OAuthError(navigator.onLine === false ? 'offline' : 'cors', e instanceof Error ? e.message : String(e))
  }
  let json: Record<string, unknown> | null = null
  const type = res.headers.get('content-type') ?? ''
  if (/json/i.test(type)) {
    try {
      const v = await res.json()
      json = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      json = null
    }
  }
  return { status: res.status, json, headers: res.headers }
}

/** `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` */
export function parseWwwAuthenticate(h: string | null): { resourceMetadata: string | null; scope: string } {
  if (!h) return { resourceMetadata: null, scope: '' }
  const meta = /resource_metadata="([^"]+)"/i.exec(h)?.[1] ?? null
  const scope = /\bscope="([^"]*)"/i.exec(h)?.[1] ?? ''
  return { resourceMetadata: meta && endpointOk(meta) ? meta : null, scope }
}

/** RFC 9728: `/.well-known/oauth-protected-resource` between host and path, then at the root. */
export function resourceMetadataUrls(server: string): string[] {
  const u = new URL(server)
  const path = u.pathname.replace(/\/+$/, '')
  const out = [`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`]
  return [...new Set(out)]
}

/** The authorization server's metadata addresses in the spec's order (OAuth, then OpenID). */
export function authServerMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer)
  const path = u.pathname.replace(/\/+$/, '')
  if (!path)
    return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`]
  return [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`]
}

/** The first of `urls` that answers with JSON (null: none did). A CORS refusal of every one throws 'cors'. */
async function firstJson(urls: string[]): Promise<Record<string, unknown> | null> {
  let refused = 0
  for (const url of urls) {
    try {
      const got = await call(url, { headers: { accept: 'application/json' } })
      if (got.status >= 200 && got.status < 300 && got.json) return got.json
    } catch (e) {
      if (e instanceof OAuthError && e.issue === 'offline') throw e
      refused += 1
    }
  }
  if (refused === urls.length) throw new OAuthError('cors')
  return null
}

/** Where the MCP server's sign-in lives. Throws OAuthError. */
export async function discover(serverUrl: string): Promise<Discovery> {
  // the server's own answer first: a 401 names its metadata (the header must be exposed to read it)
  let hinted: { resourceMetadata: string | null; scope: string } = { resourceMetadata: null, scope: '' }
  let open = false
  try {
    const probe = await call(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'One', version: '1' } } }),
    })
    if (probe.status === 401 || probe.status === 403) hinted = parseWwwAuthenticate(probe.headers.get('www-authenticate'))
    else if (probe.status >= 200 && probe.status < 300) open = true
  } catch (e) {
    if (e instanceof OAuthError && e.issue === 'offline') throw e
    /* CORS on the server itself: its metadata may still be readable */
  }
  let prm: Record<string, unknown> | null = null
  try {
    prm = await firstJson(hinted.resourceMetadata ? [hinted.resourceMetadata, ...resourceMetadataUrls(serverUrl)] : resourceMetadataUrls(serverUrl))
  } catch (e) {
    if (!(e instanceof OAuthError) || e.issue !== 'cors') throw e
  }
  const servers = Array.isArray(prm?.authorization_servers) ? prm!.authorization_servers.filter(endpointOk) : []
  // an older server without resource metadata: its own origin is the authorization server
  const issuer = servers[0] ?? new URL(serverUrl).origin
  let meta: Record<string, unknown> | null
  try {
    meta = await firstJson(authServerMetadataUrls(issuer))
  } catch (e) {
    if (e instanceof OAuthError && e.issue === 'cors') throw new OAuthError(prm || hinted.resourceMetadata ? 'cors' : 'none')
    throw e
  }
  // no metadata anywhere: a server that answered without a sign-in, or one that offers none
  if (!meta) throw new OAuthError(prm || hinted.resourceMetadata ? 'metadata' : 'none', open ? 'open' : '')
  const authorizationEndpoint = meta.authorization_endpoint
  const tokenEndpoint = meta.token_endpoint
  if (!endpointOk(authorizationEndpoint) || !endpointOk(tokenEndpoint)) throw new OAuthError('metadata', 'no authorization or token endpoint')
  const methods = Array.isArray(meta.code_challenge_methods_supported) ? meta.code_challenge_methods_supported : []
  if (!methods.includes('S256')) throw new OAuthError('pkce')
  const resource = typeof prm?.resource === 'string' && endpointOk(prm.resource) ? prm.resource : serverUrl
  const supported = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return {
    issuer: typeof meta.issuer === 'string' && endpointOk(meta.issuer) ? meta.issuer : issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: endpointOk(meta.registration_endpoint) ? meta.registration_endpoint : null,
    resource,
    scope: hinted.scope || supported.join(' '),
  }
}

/* ------------------------------------------------------------------ */
/* PKCE                                                                */
/* ------------------------------------------------------------------ */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

/** One attempt (sessionStorage, this tab): what the token exchange needs. */
interface Pending {
  serverId: string
  verifier: string
  cfg: McpOAuthConfig
  at: number
}

/** Attempts older than this are not finished any more. */
const PENDING_MAX_AGE = 30 * 60 * 1000

function putPending(state: string, p: Pending) {
  try {
    window.sessionStorage.setItem(PENDING_PREFIX + state, JSON.stringify(p))
  } catch {
    throw new OAuthError('vault', 'sessionStorage is not available')
  }
}

/** Take an attempt (it is used once). */
function takePending(state: string): Pending | null {
  if (!hasPending(state)) return null
  let p: Pending | null = null
  try {
    p = JSON.parse(window.sessionStorage.getItem(PENDING_PREFIX + state) ?? 'null') as Pending | null
    window.sessionStorage.removeItem(PENDING_PREFIX + state)
  } catch {
    return null
  }
  if (!p || typeof p.serverId !== 'string' || typeof p.verifier !== 'string' || !p.cfg || Date.now() - (p.at ?? 0) > PENDING_MAX_AGE) return null
  return p
}

/** Register One at the authorization server (or reuse the registration this server already has for this redirect URI). */
async function registration(server: McpServerConfig, disc: Discovery, redirect: string): Promise<{ clientId: string; secret: boolean }> {
  const had = server.oauth
  if (had && had.issuer === disc.issuer && had.redirectUri === redirect && had.clientId) return { clientId: had.clientId, secret: !!had.secret }
  if (!disc.registrationEndpoint) throw new OAuthError('register', 'no dynamic client registration')
  const got = await call(disc.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'One',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(disc.scope ? { scope: disc.scope } : {}),
    }),
  })
  const clientId = got.json?.client_id
  if (got.status < 200 || got.status >= 300 || typeof clientId !== 'string' || !clientId) throw new OAuthError('register', typeof got.json?.error_description === 'string' ? got.json.error_description : String(got.status))
  const secret = typeof got.json?.client_secret === 'string' && got.json.client_secret ? got.json.client_secret : null
  if (secret) {
    try {
      await setMcpOAuthSecret('client', server.id, secret)
    } catch {
      throw new OAuthError('vault')
    }
  }
  return { clientId, secret: !!secret }
}

/** The authorization request's address. */
function authorizeUrl(cfg: McpOAuthConfig, state: string, challenge: string): string {
  const u = new URL(cfg.authorizationEndpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', state)
  u.searchParams.set('resource', cfg.resource)
  if (cfg.scope) u.searchParams.set('scope', cfg.scope)
  return u.href
}

/** Codes coming back while a sign-in waits. */
const waiting = new Map<string, (msg: OAuthReturn) => void>()
/** the waits, by server: Cancel ends one */
const cancels = new Map<string, () => void>()
/** the latest sign-in attempt per server (an older one that ends late leaves the state alone) */
const attempts = new Map<string, number>()
/** A sign-in window is waited for at most this long. */
const WAIT_MAX = 10 * 60 * 1000

/** Stop waiting for a sign-in (the person closed the window, or wants to start over). */
export function cancelSignIn(serverId: string): void {
  cancels.get(serverId)?.()
}

function listen() {
  listenForMcpOAuth((msg) => {
    const fn = waiting.get(msg.state)
    if (fn) fn(msg)
    // an attempt this tab started before a reload: finish it all the same
    else void finishSignIn(msg).catch(() => {})
  })
}

/**
 * "Sign in" (a click — the sign-in window opens right away, before anything is fetched, so the browser lets
 * it). Resolves when signed in; throws OAuthError (the state for Settings is in useMcpSignIn as well).
 */
export async function signIn(serverId: string): Promise<void> {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) return
  // a sign-in of this server still waiting: it gives way to this one
  cancelSignIn(serverId)
  const attempt = (attempts.get(serverId) ?? 0) + 1
  attempts.set(serverId, attempt)
  // synchronously, inside the click: a blank window the sign-in page goes into
  let popup: Window | null = null
  try {
    popup = window.open('', 'one-mcp-oauth', 'popup=yes,width=520,height=720')
  } catch {
    popup = null
  }
  setPhase(serverId, { phase: 'working' })
  try {
    const disc = await discover(server.url)
    const redirect = redirectUri()
    const reg = await registration(server, disc, redirect)
    const cfg: McpOAuthConfig = {
      issuer: disc.issuer,
      authorizationEndpoint: disc.authorizationEndpoint,
      tokenEndpoint: disc.tokenEndpoint,
      clientId: reg.clientId,
      redirectUri: redirect,
      resource: disc.resource,
      ...(disc.scope ? { scope: disc.scope } : {}),
      ...(reg.secret ? { secret: true } : {}),
    }
    // the registration stays with the server (a second sign-in reuses it); the tokens come later
    const now = readServers().find((s) => s.id === serverId)
    if (!now) throw new OAuthError('cancelled')
    patchServer(serverId, { oauth: { ...cfg, ...(now.oauth?.at && now.token ? { at: now.oauth.at, expiresAt: now.oauth.expiresAt, refresh: now.oauth.refresh } : {}) } })
    const state = randomToken(24)
    const verifier = randomToken(48)
    putPending(state, { serverId, verifier, cfg, at: Date.now() })
    const url = authorizeUrl(cfg, state, await challengeOf(verifier))
    if (!popup || popup.closed) {
      // the browser blocked the window: this tab goes to the sign-in and comes back to #/oauth/mcp
      window.location.assign(url)
      return
    }
    listen()
    setPhase(serverId, { phase: 'waiting' })
    // the code comes back over BroadcastChannel (oauthReturn.ts). Whether the window was closed can't be told
    // reliably (a sign-in page with COOP cuts the link to it), so the wait ends with the code, Cancel or a timeout.
    const msg = await new Promise<OAuthReturn>((resolve, reject) => {
      popup!.location.href = url
      const timer = window.setTimeout(() => reject(new OAuthError('cancelled')), WAIT_MAX)
      waiting.set(state, (m) => {
        window.clearTimeout(timer)
        resolve(m)
      })
      cancels.set(serverId, () => {
        window.clearTimeout(timer)
        reject(new OAuthError('cancelled'))
      })
    }).finally(() => {
      waiting.delete(state)
      cancels.delete(serverId)
    })
    await finishSignIn(msg)
  } catch (e) {
    try {
      if (popup && !popup.closed) popup.close()
    } catch {
      /* gone */
    }
    const err = e instanceof OAuthError ? e : new OAuthError('token', e instanceof Error ? e.message : String(e))
    // a newer attempt of this server owns the state now
    if (attempts.get(serverId) === attempt) setPhase(serverId, err.issue === 'cancelled' ? null : { phase: 'error', issue: err.issue, detail: err.detail })
    throw err
  }
}

/** The token endpoint's answer, checked. */
interface Tokens {
  access: string
  refresh: string | null
  expiresAt: number | undefined
}

async function tokenRequest(cfg: McpOAuthConfig, serverId: string, params: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: cfg.clientId, resource: cfg.resource })
  if (cfg.secret) {
    const secret = await getMcpOAuthSecret('client', serverId)
    if (secret) body.set('client_secret', secret)
  }
  const got = await call(cfg.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() })
  const access = got.json?.access_token
  if (got.status < 200 || got.status >= 300 || typeof access !== 'string' || !access) {
    const why = typeof got.json?.error_description === 'string' ? got.json.error_description : typeof got.json?.error === 'string' ? got.json.error : String(got.status)
    throw new OAuthError('token', why)
  }
  const type = got.json?.token_type
  if (typeof type === 'string' && type.toLowerCase() !== 'bearer') throw new OAuthError('token', `token type ${type}`)
  const ttl = Number(got.json?.expires_in)
  return {
    access,
    refresh: typeof got.json?.refresh_token === 'string' && got.json.refresh_token ? got.json.refresh_token : null,
    expiresAt: Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : undefined,
  }
}

/** A code came back (to this tab, or to #/oauth/mcp): exchange it and keep the tokens. Throws OAuthError. */
export async function finishSignIn(msg: Pick<OAuthReturn, 'state' | 'code' | 'error' | 'errorDescription'>): Promise<McpServerConfig> {
  const pending = takePending(msg.state)
  if (!pending) throw new OAuthError('state')
  const { serverId, cfg } = pending
  setPhase(serverId, { phase: 'working' })
  try {
    if (msg.error) throw new OAuthError(msg.error === 'access_denied' ? 'denied' : 'token', msg.errorDescription || msg.error)
    if (!msg.code) throw new OAuthError('token', 'no code')
    const tokens = await tokenRequest(cfg, serverId, { grant_type: 'authorization_code', code: msg.code, redirect_uri: cfg.redirectUri, code_verifier: pending.verifier })
    const server = readServers().find((s) => s.id === serverId)
    if (!server) throw new OAuthError('cancelled')
    // the store seals the access token and keeps its marker (like a pasted token)
    patchServer(serverId, {
      token: tokens.access,
      oauth: { ...cfg, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}), ...(tokens.refresh ? { refresh: true } : {}), at: Date.now() },
      checkError: undefined,
      checkAuth: undefined,
    })
    try {
      await setMcpOAuthSecret('refresh', serverId, tokens.refresh)
    } catch {
      patchServer(serverId, { oauth: { ...cfg, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}), at: Date.now() } })
    }
    setPhase(serverId, { phase: 'done' })
    // test the connection with the new token (and write the usage prompt when there is none)
    const { checkServer } = await import('./checks')
    void checkServer(serverId, server.prompt.trim() ? 'test' : 'guide')
    return readServers().find((s) => s.id === serverId) ?? server
  } catch (e) {
    const err = e instanceof OAuthError ? e : new OAuthError('token', e instanceof Error ? e.message : String(e))
    setPhase(serverId, { phase: 'error', issue: err.issue, detail: err.detail })
    throw err
  }
}

/** Sign out: the access token and the refresh token leave this browser (the registration stays for next time). */
export function signOut(serverId: string): void {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) return
  const o = server.oauth
  patchServer(serverId, { token: '', ...(o ? { oauth: { issuer: o.issuer, authorizationEndpoint: o.authorizationEndpoint, tokenEndpoint: o.tokenEndpoint, clientId: o.clientId, redirectUri: o.redirectUri, resource: o.resource, ...(o.scope ? { scope: o.scope } : {}), ...(o.secret ? { secret: true } : {}) } } : {}) })
  void setMcpOAuthSecret('refresh', serverId, null).catch(() => {})
  setPhase(serverId, null)
}

/* ------------------------------------------------------------------ */
/* At request time                                                     */
/* ------------------------------------------------------------------ */

/** Refresh this long before the access token expires. */
const EARLY = 60_000
const refreshing = new Map<string, Promise<string | null>>()

async function refresh(server: McpServerConfig): Promise<string | null> {
  const o = server.oauth
  if (!o) return null
  const rt = await getMcpOAuthSecret('refresh', server.id)
  if (!rt) return null
  let tokens: Tokens
  try {
    tokens = await tokenRequest(o, server.id, { grant_type: 'refresh_token', refresh_token: rt })
  } catch {
    // refused (revoked, expired): the request goes with what there is; a 401 then asks for a sign-in
    return null
  }
  const now = readServers().find((s) => s.id === server.id)
  if (!now?.oauth) return null
  patchServer(server.id, { token: tokens.access, oauth: { ...now.oauth, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : { expiresAt: undefined }), refresh: true } })
  if (tokens.refresh && tokens.refresh !== rt) await setMcpOAuthSecret('refresh', server.id, tokens.refresh).catch(() => {})
  return tokens.access
}

/**
 * The bearer token for a request ('' = none, null = not available in this browser): an OAuth access token
 * that expires within a minute is refreshed first (one refresh at a time per server).
 */
export async function tokenFor(server: McpServerConfig): Promise<string | null> {
  const o = server.oauth
  if (o?.refresh && o.expiresAt && server.token && o.expiresAt - Date.now() < EARLY) {
    let job = refreshing.get(server.id)
    if (!job) {
      job = refresh(server).finally(() => refreshing.delete(server.id))
      refreshing.set(server.id, job)
    }
    const fresh = await job
    if (fresh) return fresh
  }
  return getMcpToken(server)
}

/** Signed in with OAuth right now (an access token from a sign-in is set). */
export const signedIn = (s: Pick<McpServerConfig, 'oauth' | 'token'>) => !!s.oauth?.at && !!s.token
