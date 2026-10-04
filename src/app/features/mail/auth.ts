/**
 * Google sign-in for Gmail (Google Identity Services, token model) with the user's OWN OAuth client ID.
 *
 *  - The GIS script (accounts.google.com/gsi/client) is loaded on demand — only when someone connects.
 *  - Scope: gmail.readonly, nothing else. No client secret exists in this flow (a client ID is public).
 *  - The access token lives in this module's memory only: never stored, logged or sent anywhere but
 *    gmail.googleapis.com (and Google's revoke endpoint on "Disconnect"). It expires after about an hour;
 *    reconnecting asks Google again — without a screen when access was granted before.
 */
import { GMAIL_SCOPE } from './settings'

export const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void
}

interface GisOAuth2 {
  initTokenClient: (cfg: {
    client_id: string
    scope: string
    prompt?: string
    login_hint?: string
    include_granted_scopes?: boolean
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type?: string; message?: string }) => void
  }) => TokenClient
  revoke?: (token: string, done?: () => void) => void
  hasGrantedAllScopes?: (r: TokenResponse, ...scopes: string[]) => boolean
}

type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GisOAuth2 } } }

/** gis_load · popup (blocked) · closed · denied · scope (Gmail not ticked) · client (rejected client ID) · unknown */
export type AuthCode = 'gis_load' | 'popup' | 'closed' | 'denied' | 'scope' | 'client' | 'unknown'

export class AuthError extends Error {
  code: AuthCode
  constructor(code: AuthCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'AuthError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ token (memory only) */

let token: { value: string; expiresAt: number } | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** A token that is still good for at least a minute, or null. */
export function currentToken(): string | null {
  if (!token) return null
  if (token.expiresAt - 60_000 <= Date.now()) return null
  return token.value
}

export function tokenExpiresAt(): number | null {
  return token?.expiresAt ?? null
}

export function clearToken(): void {
  if (!token) return
  token = null
  changed()
}

/** Called when the token appears or goes. */
export function onTokenChange(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Test hook only (dev / ?e2e): a token without Google's window (team workspaces in the cloud suite). */
export function setTokenForTests(value: string, expiresInSec = 3600): void {
  token = { value, expiresAt: Date.now() + expiresInSec * 1000 }
  changed()
}

/* ------------------------------------------------------------------ the GIS script */

let gis: Promise<GisOAuth2> | null = null

function oauth2(): GisOAuth2 | null {
  return (window as GoogleWindow).google?.accounts?.oauth2 ?? null
}

/** Load Google's sign-in script once (on demand). */
export function loadGis(): Promise<GisOAuth2> {
  const ready = oauth2()
  if (ready) return Promise.resolve(ready)
  gis ??= new Promise<GisOAuth2>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => {
      const o = oauth2()
      if (o) resolve(o)
      else reject(new AuthError('gis_load'))
    }
    s.onerror = () => reject(new AuthError('gis_load'))
    document.head.appendChild(s)
  }).catch((e) => {
    gis = null
    document.querySelectorAll(`script[src="${GIS_SRC}"]`).forEach((x) => x.remove())
    throw e
  })
  return gis
}

/** Start loading early (the Connect button is about to be pressed): the popup must open within the click's grace period. */
export function preloadGis(): void {
  loadGis().catch(() => {})
}

const CLIENT_ERRORS = /invalid_client|unauthorized_client|redirect_uri|origin|idpiframe/i

/**
 * Ask Google for an access token (opens Google's window — call it from a click). `prompt: ''` shows the
 * consent screen only the first time; `hint` (the known address) picks the account without asking.
 */
export async function requestToken(clientId: string, opts: { prompt?: '' | 'none' | 'consent' | 'select_account'; hint?: string | null } = {}): Promise<string> {
  const o = await loadGis()
  return new Promise<string>((resolve, reject) => {
    let client: TokenClient
    try {
      client = o.initTokenClient({
        client_id: clientId,
        scope: GMAIL_SCOPE,
        prompt: opts.prompt ?? '',
        include_granted_scopes: false,
        ...(opts.hint ? { login_hint: opts.hint } : {}),
        callback: (r) => {
          if (r.error) {
            const code: AuthCode = r.error === 'access_denied' ? 'denied' : CLIENT_ERRORS.test(r.error) ? 'client' : r.error === 'interaction_required' || r.error === 'login_required' || r.error === 'consent_required' ? 'closed' : 'unknown'
            return reject(new AuthError(code, r.error))
          }
          if (!r.access_token) return reject(new AuthError('unknown', 'no token'))
          const granted = o.hasGrantedAllScopes ? o.hasGrantedAllScopes(r, GMAIL_SCOPE) : (r.scope ?? '').split(/\s+/).includes(GMAIL_SCOPE)
          if (!granted) return reject(new AuthError('scope'))
          const ttl = Number(r.expires_in) > 0 ? Number(r.expires_in) : 3599
          token = { value: r.access_token, expiresAt: Date.now() + ttl * 1000 }
          changed()
          resolve(r.access_token)
        },
        error_callback: (e) => reject(new AuthError(e?.type === 'popup_failed_to_open' ? 'popup' : e?.type === 'popup_closed' ? 'closed' : 'unknown', e?.type)),
      })
    } catch (e) {
      return reject(new AuthError('client', e instanceof Error ? e.message : String(e)))
    }
    client.requestAccessToken({ prompt: opts.prompt ?? '', ...(opts.hint ? { login_hint: opts.hint } : {}) })
  })
}

/** "Disconnect": revoke the token at Google (when the script is there) and forget it. */
export function revokeToken(): void {
  const value = token?.value
  clearToken()
  const o = oauth2()
  if (value && o?.revoke) {
    try {
      o.revoke(value, () => {})
    } catch {
      /* gone already */
    }
  }
}
