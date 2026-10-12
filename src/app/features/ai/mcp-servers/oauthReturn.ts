/**
 * The way back from a sign-in page (OAuth authorization code + PKCE) — kept light: main.tsx calls consumeOAuthReturn()
 * before anything else boots. Two kinds share it: an MCP server's sign-in (oauth.ts, `?oauth=mcp`) and connecting
 * OpenRouter (providers/openrouterConnect.ts, `?oauth=openrouter`, multi-provider S2).
 *
 *  - The sign-in page sends the browser to One's own page: `<app>/?oauth=<kind>&code=…&state=…` (a redirect URI can't
 *    carry a "#"). The address becomes `#/oauth/<kind>` (hash routing) at once — the code is kept in this page's memory
 *    only (oauthReturned()), never in the address or the history.
 *  - In a sign-in window: the code goes to the tab that started the attempt (BroadcastChannel per kind): only the tab
 *    holding that attempt's state + PKCE verifier (sessionStorage, per attempt and kind) answers, then finishes it; the
 *    window closes. No answer (that tab is gone): an MCP page boots and finishes it itself; an OpenRouter page never boots
 *    a workspace and never exchanges anything (it holds no verifier) — it says where to go instead.
 *  - The tab that started it listens while an attempt is open — also after a reload (the listener is set up here, at boot).
 *  - OpenRouter (D-S2-8): a denial comes back without `state` — taken only while exactly one attempt is pending in the
 *    tab; a code without a known state is answered (so the window closes) and refused there (`oauth_state`).
 */

export type OAuthKind = 'mcp' | 'openrouter'

interface KindDef {
  /** the BroadcastChannel a sign-in window hands its return on */
  channel: string
  /** sessionStorage key prefix of an attempt: `<prefix><state>` */
  prefix: string
  /** the message's `type` */
  type: OAuthReturn['type']
  /** the route this page shows when it finishes the attempt itself */
  route: string
}

export const OAUTH_KINDS: Record<OAuthKind, KindDef> = {
  mcp: { channel: 'one-mcp-oauth', prefix: 'one.oauth.mcp:', type: 'one-mcp-oauth', route: '#/oauth/mcp' },
  openrouter: { channel: 'one-or-oauth', prefix: 'one.oauth.openrouter:', type: 'one-or-oauth', route: '#/oauth/openrouter' },
}

export const OAUTH_CHANNEL = OAUTH_KINDS.mcp.channel
/** sessionStorage key prefix of an MCP attempt: `one.oauth.mcp:<state>` → its verifier, client and endpoints */
export const PENDING_PREFIX = OAUTH_KINDS.mcp.prefix
/** the redirect URI's marker (`?oauth=mcp` | `?oauth=openrouter`) */
export const RETURN_PARAM = 'oauth'

export interface OAuthReturn {
  type: 'one-mcp-oauth' | 'one-or-oauth'
  state: string
  code: string
  error: string
  errorDescription: string
}

interface Ack {
  type: 'one-mcp-oauth-ack' | 'one-or-oauth-ack'
  state: string
  /** false: answered by the tab that is connecting, but not one of its attempts (refused there) */
  taken: boolean
}

const STATE_RE = /^[\w-]{16,128}$/

const session = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** An attempt of this tab is open with this state. */
export function hasPending(state: string, kind: OAuthKind = 'mcp'): boolean {
  if (!STATE_RE.test(state)) return false
  try {
    return !!session()?.getItem(OAUTH_KINDS[kind].prefix + state)
  } catch {
    return false
  }
}

/** The states of this tab's open attempts of a kind. */
export function pendingStates(kind: OAuthKind = 'mcp'): string[] {
  const s = session()
  if (!s) return []
  const prefix = OAUTH_KINDS[kind].prefix
  const out: string[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(prefix)) out.push(k.slice(prefix.length))
    }
  } catch {
    return []
  }
  return out
}

/** Any attempt of this tab is open. */
export function anyPending(kind: OAuthKind = 'mcp'): boolean {
  return pendingStates(kind).length > 0
}

/** The redirect URI One registers: this app's own page with the marker (no fragment — OAuth forbids it). */
export function redirectUri(kind: OAuthKind = 'mcp'): string {
  const u = new URL('./', window.location.href)
  u.search = `?${RETURN_PARAM}=${kind}`
  u.hash = ''
  return u.href
}

/**
 * Is a return this tab's to answer? 'take': one of its attempts (an OpenRouter denial without `state` while exactly one
 * attempt is pending counts); 'refuse' (OpenRouter only): this tab is connecting, but the return is none of its attempts
 * (no state, an unknown or superseded one) — answered, finished as `oauth_state`; null: not this tab's.
 */
export function claimOf(kind: OAuthKind, msg: Pick<OAuthReturn, 'state' | 'code' | 'error'>): 'take' | 'refuse' | null {
  if (hasPending(msg.state, kind)) return 'take'
  if (kind !== 'openrouter') return null
  const open = pendingStates(kind)
  if (!open.length) return null
  if (!msg.state && msg.error && !msg.code && open.length === 1) return 'take'
  return 'refuse'
}

const handlers: Partial<Record<OAuthKind, (msg: OAuthReturn, claim: 'take' | 'refuse') => void>> = {}
const channels: Partial<Record<OAuthKind, BroadcastChannel>> = {}
/** returns answered already, per kind (a return is handed on once) */
const answered: Record<OAuthKind, Set<string>> = { mcp: new Set(), openrouter: new Set() }

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : '')

/**
 * Take the returns that come for this tab's attempts of a kind: `fn` gets each one once (answered already, so the
 * sign-in window closes). One handler per tab and kind — the latest wins.
 */
export function listenForOAuth(kind: OAuthKind, fn: (msg: OAuthReturn, claim: 'take' | 'refuse') => void): void {
  handlers[kind] = fn
  if (channels[kind] || typeof BroadcastChannel === 'undefined') return
  const def = OAUTH_KINDS[kind]
  const bc = new BroadcastChannel(def.channel)
  channels[kind] = bc
  bc.onmessage = (e: MessageEvent) => {
    const m = e.data as Partial<OAuthReturn> | null
    if (!m || m.type !== def.type || typeof m.state !== 'string') return
    const msg: OAuthReturn = { type: def.type, state: str(m.state), code: str(m.code), error: str(m.error), errorDescription: str(m.errorDescription) }
    const claim = claimOf(kind, msg)
    if (!claim) return
    const ack: Ack = { type: `${def.type}-ack`, state: msg.state, taken: claim === 'take' }
    bc.postMessage(ack)
    const once = `${msg.state}|${msg.code}|${msg.error}`
    if (answered[kind].has(once)) return
    answered[kind].add(once)
    handlers[kind]?.(msg, claim)
  }
}

/** The MCP sign-in's listener (oauth.ts) — as before. */
export function listenForMcpOAuth(fn: (msg: OAuthReturn) => void): void {
  listenForOAuth('mcp', (m) => fn(m))
}

/** what came back to this page load, per kind (the #/oauth/<kind> screen finishes it) */
const returned: Partial<Record<OAuthKind, OAuthReturn>> = {}

/** The code (or error) that came back to this page load — for the #/oauth/<kind> screen. */
export function oauthReturned(kind: OAuthKind = 'mcp'): OAuthReturn | null {
  return returned[kind] ?? null
}

/** A sentence (and a way into One) in the boot screen of a sign-in window. */
function bootNote(text: string, link?: { href: string; text: string }) {
  const el = document.getElementById('boot')
  if (!el) return
  el.textContent = ''
  const box = document.createElement('div')
  box.append(document.createElement('i'), document.createTextNode(text))
  if (link) {
    const a = document.createElement('a')
    a.href = link.href
    a.textContent = link.text
    a.style.cssText = 'margin-left:.6em;color:inherit;text-decoration:underline'
    box.append(a)
  }
  el.append(box)
}

/** What a sign-in window says (main.tsx passes the sentences in the boot language — no workspace is loaded here). */
export type OAuthNote = (what: 'closing' | 'handed' | 'orphan' | 'openOne', kind: OAuthKind) => string

/** The listener a tab that started an attempt before a reload sets up at boot. */
function relisten(kind: OAuthKind) {
  if (!anyPending(kind)) return
  if (kind === 'mcp') listenForMcpOAuth((m) => void import('./oauth').then((o) => o.finishSignIn(m)).catch(() => {}))
  else listenForOAuth('openrouter', (m) => void import('../providers/openrouterConnect').then((o) => o.finishOpenRouter(m)).catch(() => {}))
}

/**
 * main.tsx, first thing: a return from a sign-in page? The address loses the code; in a sign-in window the tab that
 * started it takes over — then this window closes and the app does not boot (true). An OpenRouter return no tab takes
 * never boots a workspace here (true): the window says where to go.
 */
export async function consumeOAuthReturn(note: OAuthNote = () => ''): Promise<boolean> {
  const q = new URLSearchParams(window.location.search)
  const kind = q.get(RETURN_PARAM)
  if (kind !== 'mcp' && kind !== 'openrouter') {
    // this tab started an attempt before a reload: the return coming back is still taken here
    relisten('mcp')
    relisten('openrouter')
    return false
  }
  const def = OAUTH_KINDS[kind]
  const msg: OAuthReturn = { type: def.type, state: str(q.get('state')), code: str(q.get('code')), error: str(q.get('error')), errorDescription: str(q.get('error_description')) }
  // the code leaves the address at once; the route the page shows if it finishes the attempt itself
  returned[kind] = msg
  q.delete(RETURN_PARAM)
  for (const k of ['code', 'state', 'error', 'error_description', 'error_uri', 'iss', 'session_state']) q.delete(k)
  const rest = q.toString()
  history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${def.route}`)
  // this tab started it (no sign-in window, or the tab itself went there): finish here
  if (claimOf(kind, msg)) return false
  if (typeof BroadcastChannel === 'undefined') {
    if (kind === 'mcp') return false
    bootNote(note('orphan', kind), { href: './', text: note('openOne', kind) })
    return true
  }
  const bc = new BroadcastChannel(def.channel)
  const ack = await new Promise<Ack | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 2500)
    bc.onmessage = (e: MessageEvent) => {
      const m = e.data as Partial<Ack> | null
      if (m?.type === `${def.type}-ack` && m.state === msg.state) {
        window.clearTimeout(timer)
        resolve({ type: m.type, state: m.state, taken: m.taken !== false })
      }
    }
    bc.postMessage(msg)
  })
  bc.close()
  if (!ack) {
    if (kind === 'mcp') return false
    // no tab is connecting: nothing is exchanged here (this page holds no verifier) and no workspace boots
    bootNote(note('orphan', kind), { href: './', text: note('openOne', kind) })
    return true
  }
  // "Connected" only for a code the connecting tab took; a denial or a refused return is just handed back
  const text = kind === 'mcp' ? note('closing', kind) : note(ack.taken && msg.code && !msg.error ? 'closing' : 'handed', kind)
  if (text) bootNote(text)
  window.setTimeout(() => window.close(), 150)
  return true
}

/** The MCP-only entry point of earlier builds (kept as an alias). */
export function consumeMcpOAuthReturn(closingNote = ''): Promise<boolean> {
  return consumeOAuthReturn((what, kind) => (kind === 'mcp' && what === 'closing' ? closingNote : ''))
}
