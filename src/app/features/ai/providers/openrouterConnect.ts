/**
 * Connecting OpenRouter with its OAuth PKCE flow (multi-provider S2, A9; docs: guides_overview_auth_oauth.md) — the
 * person signs in at openrouter.ai, which mints a key named "One" in their account; One exchanges the code for it and
 * seals it in the vault (D-S2-33). Nothing here runs at boot: the setup imports it, the boot listener and the
 * `#/oauth/openrouter` screen load it lazily.
 *
 *  - connectOpenRouter() (from the key press): the window opens synchronously FIRST, then the attempt { verifier, scope,
 *    at } is written in this tab's sessionStorage, then the window goes to openrouter.ai — so the window's copy of
 *    sessionStorage never holds the verifier and the window never exchanges anything. A blocked window → this tab goes
 *    there (or 'blocked' with `sameTab: false`); no sessionStorage → 'vault', nothing opened. A second press supersedes
 *    the first attempt (its late code → `oauth_state`).
 *  - finishOpenRouter(): only in the tab holding the attempt (oauthReturn.ts hands it the return): state (D-S2-8), age
 *    (> 10 min → `oauth_expired`), denial, workspace (`oauth_scope` — another workspace is open now: nothing exchanged),
 *    the exchange (4xx → `oauth_exchange`, no answer → `offline`), then the key is sealed under the caller's writer and
 *    checked (`GET /key`, no text): 401 → removed again; anything else keeps it (402 = valid, no credit). `user_id` is
 *    never kept or logged.
 */
import { create } from 'zustand'
import type { VerifyResult } from '@/shared/ai/adapter'
import { useWorkspace } from '../../../store/store'
import { scopeOf } from '../../../store/secrets'
import { withWriter, type Writer } from '../../../store/writer'
import { useCloud } from '../../../cloud'
import { challengeOf, randomToken } from '../mcp-servers/oauth'
import { OAUTH_KINDS, claimOf, listenForOAuth, pendingStates, redirectUri, type OAuthReturn } from '../mcp-servers/oauthReturn'
import { exchangeCode, verify } from './openrouter'

/** Why connecting did not end with a key (D-S2-33: not AIErrorCodes — that list is shared with the server). */
export type OROAuthIssue =
  /** the person turned it down at OpenRouter */
  | 'oauth_denied'
  /** the attempt is older than 10 minutes */
  | 'oauth_expired'
  /** a code without a known state (none, another attempt's, a superseded one): nothing exchanged */
  | 'oauth_state'
  /** another workspace is open in this tab now: nothing exchanged ("connect again in <workspace>") */
  | 'oauth_scope'
  /** OpenRouter refused the code (used, expired, verifier) — connect again */
  | 'oauth_exchange'
  /** the exchange got no answer (network, CORS) */
  | 'offline'
  /** this browser keeps no attempt (sessionStorage refused) */
  | 'vault'
  /** the browser blocked the window (`sameTab: false`) */
  | 'blocked'

export interface ORConnectState {
  phase: 'idle' | 'waiting' | 'working' | 'done' | 'error'
  issue?: OROAuthIssue
  detail?: string
  /** the key check after the exchange (done) */
  check?: VerifyResult
  /** a key was minted at OpenRouter and is NOT kept here (401): "delete the key 'One' at OpenRouter" */
  discarded?: boolean
  /** oauth_scope: the workspace the attempt was started in */
  workspace?: string
  /** when the phase began (ms) */
  at: number
}

/** The connection's state for the setup (UI state, never the workspace's). */
export const useORConnect = create<ORConnectState>(() => ({ phase: 'idle', at: 0 }))
const setState = (s: Omit<ORConnectState, 'at'>) => useORConnect.setState({ ...s, at: Date.now() }, true)

export const OR_AUTH_URL = 'https://openrouter.ai/auth'
/** an attempt is good for this long (the docs: a code expires after 10 minutes) */
export const ATTEMPT_MAX_AGE = 10 * 60 * 1000
/** the person connecting: the setup's writer */
const SETUP: Writer = { kind: 'you', via: 'setup' }

interface Attempt {
  verifier: string
  /** the vault scope of the workspace it was started in */
  scope: string
  /** that workspace's name (oauth_scope says where to connect again) */
  name: string
  at: number
}

const PREFIX = OAUTH_KINDS.openrouter.prefix

const session = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** The open workspace's vault scope and name. */
function here(): { scope: string; name: string } {
  const s = useWorkspace.getState()
  const c = useCloud.getState()
  const team = c.active.kind === 'cloud' ? (c.workspaces.find((w) => w.id === (c.active as { id: string }).id)?.name ?? null) : null
  return { scope: scopeOf(s.epoch), name: team || s.settings.workspaceName.trim() || 'One' }
}

/** The consent page's address (state echoed on approval; key_label prefills the key's name). */
export function authorizeUrl(state: string, challenge: string): string {
  const u = new URL(OR_AUTH_URL)
  u.searchParams.set('callback_url', redirectUri('openrouter'))
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('key_label', 'One')
  u.searchParams.set('state', state)
  return u.href
}

let popup: Window | null = null
let resetTimer = 0

function closePopup() {
  try {
    if (popup && !popup.closed) popup.close()
  } catch {
    /* gone */
  }
  popup = null
}

/** Drop every attempt of this tab (a new press, Cancel). */
function dropAttempts() {
  const s = session()
  for (const st of pendingStates('openrouter')) {
    try {
      s?.removeItem(PREFIX + st)
    } catch {
      /* refused */
    }
  }
}

/** Take an attempt (it is used once). */
function takeAttempt(state: string): Attempt | null {
  const s = session()
  if (!s) return null
  try {
    const raw = s.getItem(PREFIX + state)
    s.removeItem(PREFIX + state)
    const a = raw ? (JSON.parse(raw) as Partial<Attempt>) : null
    return a && typeof a.verifier === 'string' && typeof a.scope === 'string' && typeof a.at === 'number' ? { verifier: a.verifier, scope: a.scope, name: typeof a.name === 'string' ? a.name : '', at: a.at } : null
  } catch {
    return null
  }
}

/**
 * "Connect account" — call it from the key press, before any await (the window must open inside the user's gesture).
 * Resolves once the window is on its way (or this tab is); the result arrives in useORConnect.
 */
export function connectOpenRouter(o: { sameTab?: boolean } = {}): Promise<void> {
  // 1 · the window, synchronously and first: its sessionStorage copy is taken now, before the attempt exists
  let w: Window | null = null
  try {
    w = window.open('', 'one-or-oauth', 'popup=yes,width=520,height=720')
  } catch {
    w = null
  }
  if (!w && o.sameTab === false) {
    setState({ phase: 'error', issue: 'blocked' })
    return Promise.resolve()
  }
  // 2 · the attempt, in this tab (a second press supersedes the first)
  const s = session()
  const state = randomToken(24)
  const verifier = randomToken(48)
  try {
    if (!s) throw new Error('no sessionStorage')
    dropAttempts()
    const { scope, name } = here()
    s.setItem(PREFIX + state, JSON.stringify({ verifier, scope, name, at: Date.now() } satisfies Attempt))
  } catch {
    try {
      w?.close()
    } catch {
      /* gone */
    }
    setState({ phase: 'error', issue: 'vault' })
    return Promise.resolve()
  }
  if (popup && popup !== w) closePopup()
  popup = w
  listenForOAuth('openrouter', (m) => void finishOpenRouter(m).catch(() => {}))
  setState({ phase: 'waiting' })
  window.clearTimeout(resetTimer)
  // 3 · then the window's address
  return (async () => {
    const url = authorizeUrl(state, await challengeOf(verifier))
    if (!w || w.closed) {
      if (o.sameTab === false) return void setState({ phase: 'error', issue: 'blocked' })
      // the browser blocked the window: this tab goes to OpenRouter and comes back to `?oauth=openrouter`
      window.location.assign(url)
      return
    }
    w.location.href = url
    // a window closed without a return: the plate resets after 10 minutes (the attempt stays: a late code is "expired")
    resetTimer = window.setTimeout(() => {
      if (useORConnect.getState().phase === 'waiting') setState({ phase: 'idle' })
    }, ATTEMPT_MAX_AGE)
  })()
}

/** "Cancel": the attempt ends here (a code that still comes back is refused as `oauth_state`). */
export function cancelOpenRouter(): void {
  window.clearTimeout(resetTimer)
  dropAttempts()
  closePopup()
  setState({ phase: 'idle' })
}

/** finished in this tab (a return is used once; the screen and the listener may both see it) */
const finished = new Map<string, Promise<ORConnectState>>()

/**
 * A return for this tab (oauthReturn.ts hands it over, or the `#/oauth/openrouter` screen): exchange, seal, check.
 * Resolves the final state (also in useORConnect); never throws.
 */
export function finishOpenRouter(msg: Pick<OAuthReturn, 'state' | 'code' | 'error' | 'errorDescription'>, writer: Writer = SETUP): Promise<ORConnectState> {
  const once = `${msg.state}|${msg.code}|${msg.error}`
  let job = finished.get(once)
  if (!job) {
    job = finish(msg, writer).then((s) => {
      setState(s)
      return useORConnect.getState()
    })
    finished.set(once, job)
  }
  return job
}

async function finish(msg: Pick<OAuthReturn, 'state' | 'code' | 'error' | 'errorDescription'>, writer: Writer): Promise<Omit<ORConnectState, 'at'>> {
  const claim = claimOf('openrouter', msg)
  if (claim !== 'take') return { phase: 'error', issue: 'oauth_state' }
  // a denial without state: the one attempt of this tab (claimOf checked there is exactly one)
  const attempt = takeAttempt(msg.state || (pendingStates('openrouter')[0] ?? ''))
  if (!attempt) return { phase: 'error', issue: 'oauth_state' }
  window.clearTimeout(resetTimer)
  popup = null
  if (Date.now() - attempt.at > ATTEMPT_MAX_AGE) return { phase: 'error', issue: 'oauth_expired' }
  if (msg.error) return { phase: 'error', issue: msg.error === 'access_denied' ? 'oauth_denied' : 'oauth_exchange', detail: (msg.errorDescription || msg.error).slice(0, 240) }
  if (!msg.code) return { phase: 'error', issue: 'oauth_state' }
  // the attempt belongs to the workspace it was started in: nothing is exchanged for another one
  if (attempt.scope !== here().scope) return { phase: 'error', issue: 'oauth_scope', workspace: attempt.name }
  setState({ phase: 'working' })
  const ex = await exchangeCode(msg.code, attempt.verifier)
  if (!ex.ok) return { phase: 'error', issue: ex.status === null ? 'offline' : 'oauth_exchange', detail: ex.detail }
  // a key exists at OpenRouter now: sealed (D-S2-33) — the same workspace still open?
  if (attempt.scope !== here().scope) return { phase: 'error', issue: 'oauth_scope', workspace: attempt.name, discarded: true }
  withWriter(writer, () => useWorkspace.getState().updateSettings({ aiKeys: { openrouter: ex.key } }))
  const check = await verify(ex.key).catch((): VerifyResult => ({ ok: false, code: 'offline' }))
  if (!check.ok && check.code === 'invalid_key') {
    // OpenRouter does not know the key it just handed out: not kept (it can be deleted there)
    withWriter(writer, () => useWorkspace.getState().updateSettings({ aiKeys: { openrouter: '' } }))
    return { phase: 'done', check, discarded: true }
  }
  return { phase: 'done', check }
}
