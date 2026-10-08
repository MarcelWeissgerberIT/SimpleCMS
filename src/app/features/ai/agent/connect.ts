/**
 * AI terminal — /connect (/verbinden): an MCP server from the prompt. Without a word: the servers and how they stand.
 * With a name, codeword or address: the server (an address not known yet is added), switched on, then signed in — the
 * sign-in window opens from the key press itself — or, when its token works, only tested (no window). A task that
 * failed because a server rejected its token offers the same: "Sign in to <server>" (a key, or ↵ on the empty prompt),
 * then "Run the task again".
 *
 * The window must open inside the person's key press / click: everything up to signIn() runs synchronously (no await,
 * no dynamic import on that path — oauth.ts is imported statically). signIn runs with `sameTab: false`: a blocked
 * window ends as 'blocked' here instead of this tab going to the sign-in page (the conversation lives in this tab).
 */
import { isAIConfigured } from '../client'
import { MAX_SERVERS, addServer, findServer, needsSignIn, patchServer, readServers } from '../mcp-servers/config'
import { OAuthError, signIn, signInWithCode } from '../mcp-servers/oauth'
import { checkServer, whenChecked } from '../mcp-servers/checks'
import { patchConnect, pushEcho, type ConnectState } from './state'

export type { ConnectState }

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const info = (input: string, key: string, vars?: Record<string, string | number>) => pushEcho(input, 'info', { key, ...(vars ? { vars } : {}) })

/** A connection test takes at most this long here (checks.ts has no limit of its own). */
const CHECK_WAIT = 60_000

/**
 * /connect [name | codeword | address]. Synchronous until signIn() was called (the window opens in this tick).
 * `retry`: started from a task that failed / left the server out — once connected, ↵ runs that task again.
 */
export function connectCommand(input: string, arg: string, retry?: ConnectState['retry']): void {
  const q = arg.trim()
  if (!q) {
    pushEcho(input, 'servers')
    return
  }
  let server = findServer(q)
  let added = false
  if (!server) {
    if (!/^https?:\/\//i.test(q)) {
      info(input, 'features.agent.connect.unknown', { query: q })
      return
    }
    const res = addServer(q)
    if ('problem' in res) {
      if (res.problem === 'full') info(input, 'features.agent.connect.full', { max: MAX_SERVERS })
      else info(input, `features.ai.mcp.err.url.${res.problem}`)
      return
    }
    server = res.server
    added = true
  }
  let switchedOn = false
  if (!server.enabled) {
    patchServer(server.id, { enabled: true })
    switchedOn = true
  }
  const how: ConnectState['how'] = added || needsSignIn(server) ? 'signin' : 'test'
  const id = server.id
  const entry = pushEcho(input, 'connect', { connect: { serverId: id, name: server.name, host: hostOf(server.url), how, phase: 'working', ...(added ? { added } : {}), ...(switchedOn ? { switchedOn } : {}), ...(retry ? { retry } : {}) } })
  // the window opens right here, inside the key press
  if (how === 'signin') track(entry, id, signIn(id, { sameTab: false }))
  else void runTest(entry, id)
}

/** the sign-in attempt a line follows (a code started from it replaces the window's: only the newest reports) */
const attempts = new Map<string, number>()

function track(entry: string, id: string, p: Promise<void>): void {
  const n = (attempts.get(entry) ?? 0) + 1
  attempts.set(entry, n)
  p.then(
    () => attempts.get(entry) === n && void afterSignIn(entry, id),
    (e: unknown) => attempts.get(entry) === n && void onSignInError(entry, id, e),
  )
}

/** "Use a code instead" on a line waiting for its window (a click: the window opens for the code page). */
export function codeFromTerminal(entry: string, id: string): void {
  patchConnect(entry, { phase: 'working', issue: undefined, detail: undefined })
  track(entry, id, signInWithCode(id))
}

/** "Sign in to <server>" under a task (a key, or ↵ on the empty prompt): /connect <server> logged and started. */
export function signInFromTerminal(server: string, opts: { retry?: ConnectState['retry'] } = {}): void {
  connectCommand(`/connect ${server}`, server, opts.retry)
}

/** Signed in: the connection test the sign-in started (oauth.ts keepTokens), then how it went. */
async function afterSignIn(entry: string, id: string): Promise<void> {
  if (!readServers().some((s) => s.id === id)) return patchConnect(entry, { phase: 'failed', issue: 'gone' })
  patchConnect(entry, { phase: 'testing' })
  if (!(await whenChecked(id, CHECK_WAIT))) return patchConnect(entry, { phase: 'failed', issue: 'noAnswer' })
  settle(entry, id)
}

async function onSignInError(entry: string, id: string, e: unknown): Promise<void> {
  const err = e instanceof OAuthError ? e : new OAuthError('token', e instanceof Error ? e.message : String(e))
  // an open server: no sign-in needed (its window closed at once) — the connection test says whether it works
  if (err.issue === 'none' && err.detail === 'open') {
    patchConnect(entry, { open: true })
    return runTest(entry, id)
  }
  patchConnect(entry, { phase: 'failed', issue: err.issue, detail: err.detail })
}

/** A connection test without a window (the token works, or the server is open). */
async function runTest(entry: string, id: string): Promise<void> {
  const server = readServers().find((s) => s.id === id)
  if (!server) return patchConnect(entry, { phase: 'failed', issue: 'gone' })
  patchConnect(entry, { phase: 'testing' })
  // without Claude nothing can be tested: signed in, tested later
  if (!isAIConfigured()) return patchConnect(entry, { phase: 'ok', untested: true })
  const done = await Promise.race([checkServer(id, server.prompt.trim() ? 'test' : 'guide').then(() => true), new Promise<boolean>((r) => window.setTimeout(() => r(false), CHECK_WAIT))])
  if (!done) return patchConnect(entry, { phase: 'failed', issue: 'noAnswer' })
  settle(entry, id)
}

/** How the server stands now (it may have been removed meanwhile). */
function settle(entry: string, id: string): void {
  const s = readServers().find((x) => x.id === id)
  if (!s) return patchConnect(entry, { phase: 'failed', issue: 'gone' })
  if (s.checkError) return patchConnect(entry, { phase: 'failed', issue: 'check', detail: s.checkError, ...(s.checkAuth ? { auth: true } : {}) })
  patchConnect(entry, { phase: 'ok', tools: s.tools?.length ?? 0, ...(isAIConfigured() ? {} : { untested: true }) })
}
