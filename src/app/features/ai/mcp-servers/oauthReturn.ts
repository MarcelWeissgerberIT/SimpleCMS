/**
 * The way back from an MCP server's sign-in page (OAuth authorization code + PKCE, oauth.ts) — kept light:
 * main.tsx calls consumeMcpOAuthReturn() before anything else boots.
 *
 *  - The authorization server sends the browser to One's own page: `<app>/?oauth=mcp&code=…&state=…` (a
 *    redirect URI can't carry a "#"). The address becomes `#/oauth/mcp` (hash routing) at once — the code is
 *    kept in this page's memory only (oauthReturned()), never in the address or the history.
 *  - In a sign-in window: the code goes to the tab that started the sign-in (BroadcastChannel "one-mcp-oauth"):
 *    only the tab holding that attempt's state + PKCE verifier (sessionStorage, per attempt) answers, then
 *    finishes it; the window closes. No answer (that tab is gone): the page boots and finishes it itself.
 *  - The tab that started it listens while an attempt is open (listenForMcpOAuth) — also after a reload.
 */

export const OAUTH_CHANNEL = 'one-mcp-oauth'
/** sessionStorage key prefix of an attempt: `one.oauth.mcp:<state>` → its verifier, client and endpoints */
export const PENDING_PREFIX = 'one.oauth.mcp:'
/** the redirect URI's marker (`?oauth=mcp`) */
export const RETURN_PARAM = 'oauth'

export interface OAuthReturn {
  type: 'one-mcp-oauth'
  state: string
  code: string
  error: string
  errorDescription: string
}

interface Ack {
  type: 'one-mcp-oauth-ack'
  state: string
}

const session = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** An attempt of this tab is open with this state. */
export function hasPending(state: string): boolean {
  if (!/^[\w-]{16,128}$/.test(state)) return false
  try {
    return !!session()?.getItem(PENDING_PREFIX + state)
  } catch {
    return false
  }
}

/** Any attempt of this tab is open. */
export function anyPending(): boolean {
  const s = session()
  if (!s) return false
  try {
    for (let i = 0; i < s.length; i++) if (s.key(i)?.startsWith(PENDING_PREFIX)) return true
  } catch {
    return false
  }
  return false
}

/** The redirect URI One registers: this app's own page with the marker (no fragment — OAuth forbids it). */
export function redirectUri(): string {
  const u = new URL('./', window.location.href)
  u.search = `?${RETURN_PARAM}=mcp`
  u.hash = ''
  return u.href
}

let handler: ((msg: OAuthReturn) => void) | null = null
let channel: BroadcastChannel | null = null
/** states answered already (a code is handed on once) */
const answered = new Set<string>()

/**
 * Take the codes that come back for an attempt of this tab: `fn` gets each one once (already answered, so the
 * sign-in window closes). One handler per tab — the latest wins (oauth.ts's covers the boot-time one).
 */
export function listenForMcpOAuth(fn: (msg: OAuthReturn) => void): void {
  handler = fn
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(OAUTH_CHANNEL)
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as Partial<OAuthReturn> | null
    if (!m || m.type !== 'one-mcp-oauth' || typeof m.state !== 'string' || !hasPending(m.state)) return
    const ack: Ack = { type: 'one-mcp-oauth-ack', state: m.state }
    channel?.postMessage(ack)
    if (answered.has(m.state)) return
    answered.add(m.state)
    handler?.({ type: 'one-mcp-oauth', state: m.state, code: str(m.code), error: str(m.error), errorDescription: str(m.errorDescription) })
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : '')

/** what came back to this page load (the #/oauth/mcp screen finishes it), null: nothing */
let returned: OAuthReturn | null = null

/** The code (or error) that came back to this page load — for the #/oauth/mcp screen. */
export function oauthReturned(): OAuthReturn | null {
  return returned
}

/** "Signed in — this window closes" in the boot screen of a sign-in window. */
function bootNote(text: string) {
  const el = document.getElementById('boot')
  if (!el) return
  el.textContent = ''
  const box = document.createElement('div')
  box.append(document.createElement('i'), document.createTextNode(text))
  el.append(box)
}

/**
 * main.tsx, first thing: a return from a sign-in page? The address loses the code; in a sign-in window the
 * tab that started it takes over — then this window closes and the app does not boot (true). `closingNote`:
 * what the window says meanwhile.
 */
export async function consumeMcpOAuthReturn(closingNote = ''): Promise<boolean> {
  const q = new URLSearchParams(window.location.search)
  if (q.get(RETURN_PARAM) !== 'mcp') {
    // this tab started a sign-in before a reload: the code coming back is still taken here
    if (anyPending()) listenForMcpOAuth((m) => void import('./oauth').then((o) => o.finishSignIn(m)).catch(() => {}))
    return false
  }
  const msg: OAuthReturn = { type: 'one-mcp-oauth', state: str(q.get('state')), code: str(q.get('code')), error: str(q.get('error')), errorDescription: str(q.get('error_description')) }
  // the code leaves the address at once; the route the page shows if it finishes the sign-in itself
  returned = msg
  q.delete(RETURN_PARAM)
  for (const k of ['code', 'state', 'error', 'error_description', 'error_uri', 'iss', 'session_state']) q.delete(k)
  const rest = q.toString()
  history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}#/oauth/mcp`)
  // this tab started it (no sign-in window): finish here
  if (hasPending(msg.state) || typeof BroadcastChannel === 'undefined') return false
  const bc = new BroadcastChannel(OAUTH_CHANNEL)
  const acked = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 2500)
    bc.onmessage = (e: MessageEvent) => {
      const m = e.data as Partial<Ack> | null
      if (m?.type === 'one-mcp-oauth-ack' && m.state === msg.state) {
        window.clearTimeout(timer)
        resolve(true)
      }
    }
    bc.postMessage(msg)
  })
  bc.close()
  if (!acked) return false
  // main.tsx passes the sentence in the boot language (the workspace is not loaded here)
  if (closingNote) bootNote(closingNote)
  window.setTimeout(() => window.close(), 150)
  return true
}
