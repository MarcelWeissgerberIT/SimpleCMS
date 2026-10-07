/**
 * "Sign in" to an MCP server instead of pasting a token — the MCP authorization spec, all in this browser:
 *
 *  1. discover(): the server's 401 (`WWW-Authenticate: Bearer resource_metadata="…"`, read when the server
 *     exposes the header) or its well-known protected-resource metadata (RFC 9728: `…/oauth-protected-resource
 *     <path>`, then the root) → the authorization servers it lists, IN ORDER: the first whose metadata (RFC 8414 /
 *     OpenID, the spec's order of addresses) can be read and used wins (one that offers dynamic registration
 *     before one that doesn't); one without metadata, unreadable (CORS) or without PKCE S256 is skipped. Only a
 *     server without resource metadata falls back to its own origin (the older spec) — a server that names its
 *     authorization servers is never asked for its own.
 *  2. dynamic client registration when offered (a public client, `token_endpoint_auth_method: none`; a secret
 *     that comes anyway is sealed as "mcp-client:<id>"). The device code grant is asked for too when the server
 *     has a device endpoint (refused: registered again without it). A registration for this redirect URI is reused.
 *  3. authorization code + PKCE in a sign-in window (or, when the browser blocks it, this tab goes there and
 *     comes back) to One's own page. The redirect URI has no fragment (RFC 6749): `<app>/?oauth=mcp`, taken by
 *     main.tsx before the hash router (oauthReturn.ts) → `#/oauth/mcp`; state + verifier per attempt in
 *     sessionStorage.
 *  4. the token exchange from this browser (CORS permitting — refused: said plainly, the token field stays).
 *     The access token becomes the server's `token` (a vault marker like a pasted one), a refresh token is
 *     sealed as "mcp-refresh:<id>" (store/secrets.ts). tokenFor() refreshes shortly before expiry, at request
 *     time; signOut() removes both. Tokens are never logged, exported, backed up or shared.
 *  5. when the redirect can't come back — the registration refuses this page as the way back, or the window
 *     never returns ("Use a code instead"): the device code flow on the same authorization server (RFC 8628,
 *     signInWithCode). Settings shows the code, the window goes to the server's page for it, One polls the
 *     token endpoint at the interval the server gives.
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
  /** the server's sign-in gave no device code (none offered, or refused) */
  | 'nocode'
  /** the device code ran out before the sign-in was finished */
  | 'expired'

export class OAuthError extends Error {
  issue: OAuthIssue
  detail: string
  /** the OAuth error code an endpoint answered with ('authorization_pending', 'invalid_grant' …; '' = none) */
  code: string
  constructor(issue: OAuthIssue, detail = '', code = '') {
    super(detail ? `${issue}: ${detail}` : issue)
    this.name = 'OAuthError'
    this.issue = issue
    this.detail = detail.slice(0, 240)
    this.code = code.slice(0, 80)
  }
}

/** Sign-ins in progress or just ended, by server id (Settings shows them). */
export interface SignInState {
  /** 'code': a device code sign-in — the person enters `userCode` at `verifyUrl` while One polls */
  phase: 'working' | 'waiting' | 'code' | 'done' | 'error'
  issue?: OAuthIssue
  detail?: string
  userCode?: string
  /** where the code is entered */
  verifyUrl?: string
  /** the same page with the code filled in, when the server offers it */
  verifyComplete?: string
  /** the code runs out (ms since epoch) */
  expiresAt?: number
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
  /** RFC 8628 device authorization endpoint (null: none) */
  deviceEndpoint: string | null
  /** the protected resource (RFC 8707) */
  resource: string
  scope: string
}

/** The device code grant (RFC 8628). */
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

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

/** A form POST to a sign-in endpoint; one that refuses the `resource` parameter (invalid_target) is asked again without it. */
async function formPost(url: string, params: URLSearchParams): Promise<Got> {
  const post = (p: URLSearchParams) => call(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: p.toString() })
  const got = await post(params)
  if (got.status === 400 && got.json?.error === 'invalid_target' && params.has('resource')) {
    const again = new URLSearchParams(params)
    again.delete('resource')
    return post(again)
  }
  return got
}

/** An endpoint's error, for the message ('' = none given). */
const errorText = (got: Got) =>
  typeof got.json?.error_description === 'string' ? got.json.error_description : typeof got.json?.error === 'string' ? got.json.error : String(got.status)

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

/** At most this many of a resource's authorization servers are tried. */
const MAX_AUTH_SERVERS = 5

/** Why an authorization server was skipped — the most telling reason is reported when none can be used. */
const SKIP_RANK: Partial<Record<OAuthIssue, number>> = { none: 0, cors: 1, metadata: 2, pkce: 3 }

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** One authorization server, checked: its endpoints, or why it can't be used (an OAuthError, not thrown). */
async function authServer(issuer: string, resource: string, scope: string): Promise<Discovery | OAuthError> {
  let meta: Record<string, unknown> | null
  try {
    meta = await firstJson(authServerMetadataUrls(issuer))
  } catch (e) {
    if (e instanceof OAuthError && e.issue === 'offline') throw e
    return new OAuthError('cors', hostOf(issuer))
  }
  if (!meta) return new OAuthError('none', hostOf(issuer))
  const authorizationEndpoint = meta.authorization_endpoint
  const tokenEndpoint = meta.token_endpoint
  if (!endpointOk(authorizationEndpoint) || !endpointOk(tokenEndpoint)) return new OAuthError('metadata', 'no authorization or token endpoint')
  const methods = Array.isArray(meta.code_challenge_methods_supported) ? meta.code_challenge_methods_supported : []
  if (!methods.includes('S256')) return new OAuthError('pkce')
  return {
    issuer: typeof meta.issuer === 'string' && endpointOk(meta.issuer) ? meta.issuer : issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: endpointOk(meta.registration_endpoint) ? meta.registration_endpoint : null,
    deviceEndpoint: endpointOk(meta.device_authorization_endpoint) ? meta.device_authorization_endpoint : null,
    resource,
    scope,
  }
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
  // the resource metadata could not be read from a browser at all (CORS): its sign-in is out of reach, not absent
  let prmRefused = false
  try {
    prm = await firstJson([...new Set([...(hinted.resourceMetadata ? [hinted.resourceMetadata] : []), ...resourceMetadataUrls(serverUrl)])])
  } catch (e) {
    if (!(e instanceof OAuthError) || e.issue !== 'cors') throw e
    prmRefused = true
  }
  const listed = Array.isArray(prm?.authorization_servers) ? prm!.authorization_servers.filter(endpointOk).slice(0, MAX_AUTH_SERVERS) : []
  // the resource's authorization servers in its order; only an older server that names none: its own origin
  const issuers = listed.length ? listed : [new URL(serverUrl).origin]
  const resource = typeof prm?.resource === 'string' && endpointOk(prm.resource) ? prm.resource : serverUrl
  const supported = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const scope = hinted.scope || supported.join(' ')
  let skipped: OAuthError | null = null
  // usable but without dynamic registration: taken only when no later one offers it
  let noRegistration: Discovery | null = null
  for (const issuer of issuers) {
    const got = await authServer(issuer, resource, scope)
    if (!(got instanceof OAuthError)) {
      if (got.registrationEndpoint) return got
      noRegistration ??= got
      continue
    }
    if (!skipped || (SKIP_RANK[got.issue] ?? 0) > (SKIP_RANK[skipped.issue] ?? 0)) skipped = got
  }
  if (noRegistration) return noRegistration
  const named = !!(prm || hinted.resourceMetadata)
  // nothing usable: a server that offers no sign-in at all, or one whose sign-in can't be used from here
  if (!skipped || skipped.issue === 'none') throw new OAuthError(named ? 'metadata' : 'none', named ? 'no authorization server metadata' : open ? 'open' : '')
  if (skipped.issue === 'cors' && !named) throw prmRefused ? new OAuthError('cors', hostOf(serverUrl)) : new OAuthError('none', open ? 'open' : '')
  throw skipped
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
/* Registration                                                        */
/* ------------------------------------------------------------------ */

interface Registration {
  clientId: string
  secret: boolean
  /** the client may use the device code grant */
  device: boolean
  /** registered without a redirect URI (device code only) */
  deviceOnly: boolean
}

/**
 * Register One at the authorization server — or reuse the registration this server already has for this
 * redirect URI (and, for `flow` 'device', the device grant).
 */
async function registration(server: McpServerConfig, disc: Discovery, redirect: string, flow: 'code' | 'device', wayBackRefused = false): Promise<Registration> {
  const had = server.oauth
  if (had && had.issuer === disc.issuer && had.redirectUri === redirect && had.clientId && (flow === 'code' ? !had.deviceOnly : had.device))
    return { clientId: had.clientId, secret: !!had.secret, device: !!had.device, deviceOnly: !!had.deviceOnly }
  if (!disc.registrationEndpoint) throw new OAuthError('register', 'no dynamic client registration')
  const code = ['authorization_code', 'refresh_token']
  const all = [...code, DEVICE_GRANT]
  // what is asked for, in order: the device grant along when the server has the device flow (refused: without
  // it); a code sign-in whose way back is refused: a client for the device flow alone, without a redirect URI
  const deviceOnly = { grants: [DEVICE_GRANT, 'refresh_token'], redirect: false }
  const asks: Array<{ grants: string[]; redirect: boolean }> =
    flow === 'device'
      ? wayBackRefused
        ? [deviceOnly]
        : [{ grants: all, redirect: true }, deviceOnly]
      : disc.deviceEndpoint
        ? [{ grants: all, redirect: true }, { grants: code, redirect: true }]
        : [{ grants: code, redirect: true }]
  let why = ''
  for (const ask of asks) {
    const got = await call(disc.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'One',
        ...(ask.redirect ? { redirect_uris: [redirect], response_types: ['code'] } : {}),
        grant_types: ask.grants,
        token_endpoint_auth_method: 'none',
        ...(disc.scope ? { scope: disc.scope } : {}),
      }),
    })
    const clientId = got.json?.client_id
    if (got.status >= 200 && got.status < 300 && typeof clientId === 'string' && clientId) {
      const secret = typeof got.json?.client_secret === 'string' && got.json.client_secret ? got.json.client_secret : null
      if (secret) {
        try {
          await setMcpOAuthSecret('client', server.id, secret)
        } catch {
          throw new OAuthError('vault')
        }
      }
      // what the server granted (it may leave a grant out without saying no)
      const granted = Array.isArray(got.json?.grant_types) ? (got.json.grant_types as unknown[]) : ask.grants
      return { clientId, secret: !!secret, device: granted.includes(DEVICE_GRANT), deviceOnly: !ask.redirect }
    }
    why = errorText(got)
    // the server failed: asking differently won't help
    if (got.status >= 500) break
  }
  throw new OAuthError('register', why)
}

/** What One keeps of a sign-in: where it lives and the client — never a token. */
function configOf(disc: Discovery, reg: Registration, redirect: string): McpOAuthConfig {
  return {
    issuer: disc.issuer,
    authorizationEndpoint: disc.authorizationEndpoint,
    tokenEndpoint: disc.tokenEndpoint,
    clientId: reg.clientId,
    redirectUri: redirect,
    resource: disc.resource,
    ...(disc.scope ? { scope: disc.scope } : {}),
    ...(reg.secret ? { secret: true } : {}),
    ...(disc.deviceEndpoint ? { deviceEndpoint: disc.deviceEndpoint } : {}),
    ...(reg.device ? { device: true } : {}),
    ...(reg.deviceOnly ? { deviceOnly: true } : {}),
  }
}

/** The registration stays with the server (a second sign-in reuses it); a current sign-in's token state stays too. */
function keepConfig(serverId: string, cfg: McpOAuthConfig): void {
  const now = readServers().find((s) => s.id === serverId)
  if (!now) throw new OAuthError('cancelled')
  patchServer(serverId, { oauth: { ...cfg, ...(now.oauth?.at && now.token ? { at: now.oauth.at, expiresAt: now.oauth.expiresAt, refresh: now.oauth.refresh } : {}) } })
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
/** the latest sign-in attempt per server (an older one that ends late leaves the state and the window alone) */
const attempts = new Map<string, number>()
/** A sign-in window is waited for at most this long. */
const WAIT_MAX = 10 * 60 * 1000

/** Stop waiting for a sign-in (the person closed the window, or wants to start over). */
export function cancelSignIn(serverId: string): void {
  cancels.get(serverId)?.()
}

/** A wait of `serverId` that Cancel (or a newer attempt) ends; it unregisters itself. */
function cancellable<T>(serverId: string, run: (resolve: (v: T) => void, reject: (e: OAuthError) => void) => () => void): Promise<T> {
  let cancel: () => void = () => {}
  return new Promise<T>((resolve, reject) => {
    const cleanup = run(resolve, reject)
    cancel = () => {
      cleanup()
      reject(new OAuthError('cancelled'))
    }
    cancels.set(serverId, cancel)
  }).finally(() => {
    if (cancels.get(serverId) === cancel) cancels.delete(serverId)
  })
}

function listen() {
  listenForMcpOAuth((msg) => {
    const fn = waiting.get(msg.state)
    if (fn) fn(msg)
    // an attempt this tab started before a reload: finish it all the same
    else void finishSignIn(msg).catch(() => {})
  })
}

/** A new attempt for this server (an older one still waiting gives way). */
function nextAttempt(serverId: string): number {
  cancelSignIn(serverId)
  const attempt = (attempts.get(serverId) ?? 0) + 1
  attempts.set(serverId, attempt)
  return attempt
}

/** Synchronously, inside the click: a blank window the sign-in page goes into (null: the browser blocked it). */
function blankWindow(): Window | null {
  try {
    return window.open('', 'one-mcp-oauth', 'popup=yes,width=520,height=720')
  } catch {
    return null
  }
}

function closeWindow(w: Window | null) {
  try {
    if (w && !w.closed) w.close()
  } catch {
    /* gone */
  }
}

/** A sign-in attempt failed: its window closes and Settings says why — unless a newer attempt took over. */
function failed(serverId: string, attempt: number, e: unknown, popup: Window | null): never {
  const err = e instanceof OAuthError ? e : new OAuthError('token', e instanceof Error ? e.message : String(e))
  if (attempts.get(serverId) === attempt) {
    closeWindow(popup)
    setPhase(serverId, err.issue === 'cancelled' ? null : { phase: 'error', issue: err.issue, detail: err.detail })
  }
  throw err
}

/**
 * "Sign in" (a click — the sign-in window opens right away, before anything is fetched, so the browser lets
 * it). Resolves when signed in; throws OAuthError (the state for Settings is in useMcpSignIn as well).
 */
export async function signIn(serverId: string): Promise<void> {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) return
  const attempt = nextAttempt(serverId)
  const popup = blankWindow()
  setPhase(serverId, { phase: 'working' })
  try {
    const disc = await discover(server.url)
    const redirect = redirectUri()
    let reg: Registration
    try {
      reg = await registration(server, disc, redirect, 'code')
    } catch (e) {
      // the server's sign-in won't take this page as the way back: a code instead, in the same window
      if (e instanceof OAuthError && e.issue === 'register' && disc.deviceEndpoint && disc.registrationEndpoint) return await deviceFlow(serverId, attempt, popup, disc, true)
      throw e
    }
    const cfg = configOf(disc, reg, redirect)
    keepConfig(serverId, cfg)
    const state = randomToken(24)
    const verifier = randomToken(48)
    putPending(state, { serverId, verifier, cfg, at: Date.now() })
    const url = authorizeUrl(cfg, state, await challengeOf(verifier))
    if (!popup || popup.closed) {
      // the browser blocked the window: this tab goes to the sign-in and comes back to `?oauth=mcp` → #/oauth/mcp
      window.location.assign(url)
      return
    }
    listen()
    if (attempts.get(serverId) === attempt) setPhase(serverId, { phase: 'waiting' })
    // the code comes back over BroadcastChannel (oauthReturn.ts). Whether the window was closed can't be told
    // reliably (a sign-in page with COOP cuts the link to it), so the wait ends with the code, Cancel or a timeout.
    const msg = await cancellable<OAuthReturn>(serverId, (resolve, reject) => {
      popup.location.href = url
      const timer = window.setTimeout(() => reject(new OAuthError('cancelled')), WAIT_MAX)
      waiting.set(state, (m) => {
        window.clearTimeout(timer)
        resolve(m)
      })
      return () => window.clearTimeout(timer)
    }).finally(() => waiting.delete(state))
    await finishSignIn(msg)
  } catch (e) {
    failed(serverId, attempt, e, popup)
  }
}

/**
 * "Sign in with a code" / "Use a code instead" (a click: the window opens right away) — the device code flow
 * (RFC 8628) on the same authorization server, for when the way back to this page can't work. Throws OAuthError.
 */
export async function signInWithCode(serverId: string): Promise<void> {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) return
  const attempt = nextAttempt(serverId)
  const popup = blankWindow()
  setPhase(serverId, { phase: 'working' })
  try {
    await deviceFlow(serverId, attempt, popup)
  } catch (e) {
    failed(serverId, attempt, e, popup)
  }
}

/** Device codes are polled at least this far apart, and for at most this long. */
const MIN_INTERVAL = 1000
const MAX_CODE_LIFE = 30 * 60 * 1000

/** RFC 8628: a code from the device endpoint, shown in Settings (and opened in the window), then the token endpoint polled. */
async function deviceFlow(serverId: string, attempt: number, popup: Window | null, known?: Discovery, wayBackRefused = false): Promise<void> {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) throw new OAuthError('cancelled')
  const disc = known ?? (await discover(server.url))
  if (!disc.deviceEndpoint) throw new OAuthError('nocode', 'no device authorization endpoint')
  const redirect = redirectUri()
  const reg = await registration(readServers().find((s) => s.id === serverId) ?? server, disc, redirect, 'device', wayBackRefused)
  const cfg = configOf(disc, reg, redirect)
  keepConfig(serverId, cfg)
  const got = await formPost(disc.deviceEndpoint, new URLSearchParams({ client_id: cfg.clientId, ...(cfg.scope ? { scope: cfg.scope } : {}), resource: cfg.resource }))
  const j = got.json
  const deviceCode = typeof j?.device_code === 'string' ? j.device_code : ''
  const userCode = typeof j?.user_code === 'string' ? j.user_code.slice(0, 64) : ''
  // `verification_url` is an older spelling some servers still send
  const verifyUrl = j?.verification_uri ?? j?.verification_url
  if (got.status < 200 || got.status >= 300 || !deviceCode || !userCode || !endpointOk(verifyUrl)) throw new OAuthError('nocode', errorText(got), typeof j?.error === 'string' ? j.error : '')
  const complete = j?.verification_uri_complete
  const verifyComplete = endpointOk(complete) ? complete : undefined
  const ttl = Number(j?.expires_in)
  const expiresAt = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl * 1000, MAX_CODE_LIFE) : 10 * 60 * 1000)
  const every = Number(j?.interval)
  let interval = Number.isFinite(every) && every > 0 ? Math.min(Math.max(every * 1000, MIN_INTERVAL), 60_000) : 5000
  if (popup && !popup.closed) {
    try {
      popup.location.href = verifyComplete ?? verifyUrl
    } catch {
      /* the window went elsewhere: the link in Settings */
    }
  }
  if (attempts.get(serverId) === attempt) setPhase(serverId, { phase: 'code', userCode, verifyUrl, ...(verifyComplete ? { verifyComplete } : {}), expiresAt })
  const tokens = await cancellable<Tokens>(serverId, (resolve, reject) => {
    let timer = 0
    let over = false
    const end = (fn: () => void) => {
      if (over) return
      over = true
      window.clearTimeout(timer)
      fn()
    }
    const tick = async () => {
      if (over) return
      if (Date.now() > expiresAt) return end(() => reject(new OAuthError('expired')))
      try {
        const t = await tokenRequest(cfg, serverId, { grant_type: DEVICE_GRANT, device_code: deviceCode })
        return end(() => resolve(t))
      } catch (e) {
        const err = e instanceof OAuthError ? e : new OAuthError('token', String(e))
        if (err.code === 'slow_down') interval += 5000
        else if (err.code === 'access_denied') return end(() => reject(new OAuthError('denied')))
        else if (err.code === 'expired_token') return end(() => reject(new OAuthError('expired')))
        // still waiting for the person (or briefly offline): ask again later
        else if (err.code !== 'authorization_pending' && err.issue !== 'offline') return end(() => reject(err))
      }
      if (!over) timer = window.setTimeout(() => void tick(), interval)
    }
    timer = window.setTimeout(() => void tick(), interval)
    return () => {
      over = true
      window.clearTimeout(timer)
    }
  })
  closeWindow(popup)
  await keepTokens(serverId, cfg, tokens)
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
  const got = await formPost(cfg.tokenEndpoint, body)
  const access = got.json?.access_token
  if (got.status < 200 || got.status >= 300 || typeof access !== 'string' || !access) throw new OAuthError('token', errorText(got), typeof got.json?.error === 'string' ? got.json.error : '')
  const type = got.json?.token_type
  if (typeof type === 'string' && type.toLowerCase() !== 'bearer') throw new OAuthError('token', `token type ${type}`)
  const ttl = Number(got.json?.expires_in)
  return {
    access,
    refresh: typeof got.json?.refresh_token === 'string' && got.json.refresh_token ? got.json.refresh_token : null,
    expiresAt: Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : undefined,
  }
}

/** Signed in: the access token becomes the server's token (sealed by the store), the refresh token goes to the vault. */
async function keepTokens(serverId: string, cfg: McpOAuthConfig, tokens: Tokens): Promise<McpServerConfig> {
  const server = readServers().find((s) => s.id === serverId)
  if (!server) throw new OAuthError('cancelled')
  const signed: McpOAuthConfig = { ...cfg, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}), at: Date.now() }
  delete signed.refresh
  patchServer(serverId, { token: tokens.access, oauth: { ...signed, ...(tokens.refresh ? { refresh: true } : {}) }, checkError: undefined, checkAuth: undefined })
  try {
    await setMcpOAuthSecret('refresh', serverId, tokens.refresh)
  } catch {
    patchServer(serverId, { oauth: signed })
  }
  setPhase(serverId, { phase: 'done' })
  // test the connection with the new token (and write the usage prompt when there is none)
  const { checkServer } = await import('./checks')
  void checkServer(serverId, server.prompt.trim() ? 'test' : 'guide')
  return readServers().find((s) => s.id === serverId) ?? server
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
    return await keepTokens(serverId, cfg, tokens)
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
  cancelSignIn(serverId)
  const o = server.oauth
  const kept = o ? { ...o } : undefined
  if (kept) {
    delete kept.at
    delete kept.expiresAt
    delete kept.refresh
  }
  patchServer(serverId, { token: '', ...(kept ? { oauth: kept } : {}) })
  void setMcpOAuthSecret('refresh', serverId, null).catch(() => {})
  setPhase(serverId, null)
}

/* ------------------------------------------------------------------ */
/* At request time                                                     */
/* ------------------------------------------------------------------ */

/** Refresh this long before the access token expires (a generation run can take minutes on one token). */
const EARLY = 5 * 60_000
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
 * that expires within a few minutes is refreshed first (one refresh at a time per server).
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

/** The server's sign-in offers a code (device flow) — known once a sign-in looked it up. */
export const offersCode = (s: Pick<McpServerConfig, 'oauth'>) => !!s.oauth?.deviceEndpoint
