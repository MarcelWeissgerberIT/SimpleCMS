/**
 * The tab side of the bridge: a WebSocket on 127.0.0.1 that One tabs connect to.
 *
 *  - Handshake checks (before anything else happens): Host is loopback + our port, Origin is on
 *    the allowlist (policy.ts), subprotocol one-mcp.v2 (or v1, older apps). Everything else gets a
 *    plain HTTP error.
 *  - Several tabs at once, one per workspace: a connection only counts once it said `hello` with its
 *    workspace id. A newer tab of the SAME workspace (same id, same site) replaces the older one,
 *    which is told (`replaced`) and closed with 4001 — newest wins; tabs of other workspaces stay.
 *    An older app (v1, no id) is the only tab, as before: it replaces every tab, any newer tab
 *    replaces it.
 *  - call(): resolves the call's `workspace` argument to one tab (workspaces.ts), forwards
 *    {id, tool, args, workspace: <expected id>} and waits for {id, result | error}. The tab runs it
 *    only while it shows exactly that workspace; its result names the workspace it ran in and is
 *    checked against the expected id. A tab that switches workspace while a call is open fails that
 *    call. Reads time out after `timeoutMs`; a write the tab reports as `pending` (waiting for
 *    approval) gets the approval window instead. Without a tab, a call waits up to `waitMs`.
 *  - Port taken (another MCP client runs a bridge): every call explains it; we retry to listen.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  MCP_APPROVAL_MS,
  MCP_ARGS_V1,
  MCP_CLOSE_REPLACED,
  MCP_ERR,
  MCP_NO_APP,
  MCP_SUBPROTOCOL,
  MCP_SUBPROTOCOL_V1,
  MCP_TOOLS,
  MCP_WORKSPACE_ID,
  type AppMessage,
  type BridgeMessage,
  type McpAgentMode,
  type McpClientInfo,
  type McpPeer,
  type McpToolName,
  type McpWorkspaceInfo,
} from '../../src/shared/mcp/contract.ts'
import { mcpError, withCode } from '../../src/shared/mcp/errors.ts'
import { createsSomething } from '../../src/shared/mcp/duplicates.ts'

/** A call its client cancelled (only that client would read it): every refusal starts with a code (spec § 2.0). */
const CANCELLED = mcpError('rejected', '', 'The call was cancelled')

/**
 * The bridge's own refusals when the tab went away or did not answer: coded like every refusal (spec § 2.0), and — since
 * the tab may have carried the call out already — never "Nothing was changed": the agent reads what the call touches first.
 */
const UNKNOWN = 'Whether the call was carried out is not known: read what it touches (one_get_page, one_query_database) before you call again.'
const GONE = `rejected: One was closed or disconnected before it answered. ${UNKNOWN}`
const TOOK_OVER = `rejected: Another One tab took over before this one answered. ${UNKNOWN}`
const NO_ANSWER = (s: number) => `rejected: One did not answer within ${s} s (is the tab still open?). ${UNKNOWN}`
import { isAllowedHost, isAllowedOrigin } from './policy.ts'
import { describe, label, resolveWorkspace } from './workspaces.ts'

export interface BridgeOptions {
  port: number
  /** interface to bind (default 127.0.0.1 — never a public interface) */
  host?: string
  /** Origin allowlist (policy.allowedOrigins) */
  origins: string[]
  /** how long the tab may take to answer a call (ms) */
  timeoutMs: number
  /** how long a call waits for a tab to connect (ms) */
  waitMs: number
  version: string
  log: (msg: string) => void
  /** retry interval while the port is taken (ms, default 5000) */
  retryMs?: number
  /** keep-alive ping interval (ms, default 15000) */
  pingMs?: number
}

export type CallOutcome = { ok: true; result: unknown } | { ok: false; error: string }

export interface CallOptions {
  signal?: AbortSignal
  /** the tab is waiting for the person's approval */
  onPending?: (timeoutMs: number) => void
}

export interface AppInfo {
  version: string
  workspace: McpWorkspaceInfo
  mode: McpAgentMode
  /**
   * The tools the tab runs and the arguments each takes (its hello, contract 2) — null: an older tab, judged against
   * MCP_ARGS_V1. A call to anything else is refused here (app_outdated) and never reaches the tab.
   */
  tools: ReadonlyMap<string, ReadonlySet<string>> | null
  /** the tab's contract revision (hello), 1 for older tabs */
  contract: number
}

interface Conn {
  ws: WebSocket
  info: AppInfo | null
  alive: boolean
  origin: string
  /** speaks one-mcp.v2: its calls are bound to its workspace id */
  bound: boolean
  /** hello order (higher = newer) */
  seq: number
  /** the peers list last sent to it */
  peers: string
}

type Live = Conn & { info: AppInfo }

interface InFlight {
  conn: Conn
  /** the tool called (an older tab's creating answers carry a note — olderNote) */
  tool?: McpToolName
  /** the workspace id the call is bound to (v2 tabs) */
  expected: string | null
  timer?: ReturnType<typeof setTimeout>
  finish: (out: CallOutcome) => void
  arm: (ms: number, why: string) => void
  onPending?: (timeoutMs: number) => void
}

/** What an older tab's creating answer says (repeats are joined only by up-to-date tabs). */
export const OLDER_REPEATS =
  'This One tab is an older version: it does not recognise a repeated call — calling again makes it a second time. If you are unsure whether this call went through, read first (one_search, one_get_page) before you call again.'

const MAX_PAYLOAD = 16 * 1024 * 1024
const HELLO_MS = 5000
/** a tab may ask for at most this long an approval window */
const MAX_PENDING_MS = 10 * 60_000
/** The arguments this bridge's own contract declares per tool (`workspace` included: the bridge's routing argument). */
const TOOLS = new Map<string, ReadonlySet<string>>(MCP_TOOLS.map((t) => [t.name, new Set(Object.keys(t.inputSchema.properties))]))
/** Contract 1 (One before T-a): a tab whose hello names no tools takes exactly these. */
const V1_TOOLS = new Map<string, ReadonlySet<string>>(Object.entries(MCP_ARGS_V1).map(([name, args]) => [name, new Set(args)]))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * The workspace a hello / status names. v2 tabs must name it by a valid id (else null: the message is
 * refused); an id from a v1 tab is ignored — it could not keep a call inside that workspace.
 */
function workspaceOf(v: unknown, bound: boolean): McpWorkspaceInfo | null {
  if (!isObj(v)) return null
  const name = str(v.name, 120).replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Workspace'
  const base = { name, kind: v.kind === 'team' ? ('team' as const) : ('local' as const), readOnly: v.readOnly === true }
  if (!bound) return base
  const id = typeof v.id === 'string' ? v.id : ''
  if (!MCP_WORKSPACE_ID.test(id) || !id.startsWith(`${base.kind}:`)) return null
  return { id, ...base }
}

const modeOf = (v: unknown): McpAgentMode => (v === 'apply' || v === 'read' ? v : 'ask')

const NAME = /^[a-z][a-z0-9_]{0,63}$/
const ARG = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** A hello's `tools`: tool name → argument names (bounded, names only); null when it names none (an older tab). */
function toolsOf(v: unknown): Map<string, Set<string>> | null {
  if (!isObj(v)) return null
  const out = new Map<string, Set<string>>()
  for (const [name, args] of Object.entries(v).slice(0, 200)) {
    if (!NAME.test(name) || !Array.isArray(args)) continue
    out.set(name, new Set(args.filter((a): a is string => typeof a === 'string' && ARG.test(a)).slice(0, 100)))
  }
  return out
}

/** The refusal of an argument a tool does not declare — the team server's words (tools.ts argumentError). */
const takesNo = (tool: string, key: string) => mcpError('bad_argument', key, `${tool} takes no argument ${JSON.stringify(key)} (it takes: ${[...(TOOLS.get(tool) ?? [])].join(', ') || 'none'})`)

/** Arguments a call passes that this bridge's contract does not declare for the tool (`additionalProperties: false`). */
function undeclared(tool: string, args: Record<string, unknown>): string[] {
  const known = TOOLS.get(tool)
  return known ? Object.keys(args).filter((k) => !known.has(k)) : Object.keys(args)
}

export class Bridge {
  state: 'idle' | 'listening' | 'in-use' | 'closed' = 'idle'
  private opts: BridgeOptions
  private http: Server
  private wss: WebSocketServer
  /** every open connection (also those that did not say hello yet) */
  private conns = new Set<Conn>()
  /** the tabs that said hello, oldest first */
  private apps: Live[] = []
  private client: McpClientInfo | null = null
  private inflight = new Map<string, InFlight>()
  private waiters = new Set<(c: Conn | null) => void>()
  private seq = 0
  private helloSeq = 0
  /** the workspace this MCP session last sent a call to (calls without `workspace` stay there) */
  private last: McpWorkspaceInfo | null = null
  private pinger: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private refusals = 0

  constructor(opts: BridgeOptions) {
    this.opts = opts
    this.http = createServer((_req, res) => {
      // plain HTTP: nothing to see — no CORS headers, no information
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', connection: 'close', upgrade: 'websocket' })
      res.end('One MCP bridge: WebSocket only.\n')
    })
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PAYLOAD,
      perMessageDeflate: false,
      // the newest version both sides speak
      handleProtocols: (offered) => (offered.has(MCP_SUBPROTOCOL) ? MCP_SUBPROTOCOL : MCP_SUBPROTOCOL_V1),
    })
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(req, socket, head))
    this.http.on('clientError', (_e, socket) => socket.destroy())
  }

  /* ------------------------------------------------------------------ lifecycle */

  /** Listen on the port. Resolves 'in-use' when another bridge has it (we keep retrying). */
  start(): Promise<'listening' | 'in-use'> {
    return new Promise((resolve) => {
      const onError = (e: NodeJS.ErrnoException) => {
        this.http.off('listening', onListening)
        if (e.code === 'EADDRINUSE') {
          if (this.state !== 'in-use') this.opts.log(`port ${this.opts.port} is in use (another One bridge?) — retrying every ${Math.round((this.opts.retryMs ?? 5000) / 1000)} s`)
          this.state = 'in-use'
          this.retry = setTimeout(() => void this.start(), this.opts.retryMs ?? 5000)
          resolve('in-use')
        } else {
          this.opts.log(`cannot listen on ${this.opts.host ?? '127.0.0.1'}:${this.opts.port}: ${e.message}`)
          this.state = 'in-use'
          resolve('in-use')
        }
      }
      const onListening = () => {
        this.http.off('error', onError)
        this.state = 'listening'
        this.opts.log(`waiting for One on ws://${this.opts.host ?? '127.0.0.1'}:${this.opts.port}`)
        this.pinger ??= setInterval(() => this.ping(), this.opts.pingMs ?? 15_000)
        resolve('listening')
      }
      this.http.once('error', onError)
      this.http.once('listening', onListening)
      this.http.listen(this.opts.port, this.opts.host ?? '127.0.0.1')
    })
  }

  async close(): Promise<void> {
    this.state = 'closed'
    if (this.retry) clearTimeout(this.retry)
    if (this.pinger) clearInterval(this.pinger)
    for (const f of [...this.inflight.values()]) f.finish({ ok: false, error: mcpError('rejected', '', 'The One bridge stopped while the call ran', 'Ask the person whether to start the bridge again; read before you call again.') })
    for (const w of [...this.waiters]) w(null)
    for (const ws of this.wss.clients) ws.close(1001, 'bridge stopped')
    await new Promise<void>((r) => this.wss.close(() => r()))
    await new Promise<void>((r) => (this.http.listening ? this.http.close(() => r()) : r()))
    this.http.closeAllConnections?.()
  }

  /** The newest connected tab (after its hello), for status output and tests. */
  get connected(): AppInfo | null {
    return this.apps.at(-1)?.info ?? null
  }

  /** The MCP client that launched us — passed on to the tabs ("Connected · Claude Desktop"). */
  setClient(client: McpClientInfo | null): void {
    this.client = client ? { name: client.name.slice(0, 80), version: client.version.slice(0, 40) } : null
    for (const app of this.apps) this.send(app, { type: 'client', client: this.client })
  }

  /* ------------------------------------------------------------------ handshake */

  private refuse(socket: Duplex, status: number, text: string, why: string) {
    // a page in a loop must not flood stderr
    if (this.refusals++ < 20) this.opts.log(`refused a connection: ${why}`)
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
    socket.destroy()
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy())
    const origin = req.headers.origin
    if (!isAllowedHost(req.headers.host, this.opts.port)) return this.refuse(socket, 403, 'Forbidden', `host ${JSON.stringify(req.headers.host ?? '')}`)
    if (!isAllowedOrigin(origin, this.opts.origins)) return this.refuse(socket, 403, 'Forbidden', `origin ${JSON.stringify(origin ?? '(none)')} is not allowed (set ONE_ORIGINS to add one)`)
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim())
    if (!protocols.includes(MCP_SUBPROTOCOL) && !protocols.includes(MCP_SUBPROTOCOL_V1))
      return this.refuse(socket, 400, 'Bad Request', `protocol ${JSON.stringify(protocols.join(', '))} (this bridge speaks ${MCP_SUBPROTOCOL} and ${MCP_SUBPROTOCOL_V1} — update One or the bridge)`)
    this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws, origin!))
  }

  private adopt(ws: WebSocket, origin: string) {
    const conn: Conn = { ws, info: null, alive: true, origin, bound: ws.protocol === MCP_SUBPROTOCOL, seq: 0, peers: '' }
    this.conns.add(conn)
    // a connection only counts (and only replaces a tab) once it introduced itself
    const hello = setTimeout(() => {
      if (!conn.info) ws.close(1008, 'hello expected')
    }, HELLO_MS)
    ws.on('message', (data: RawData, binary: boolean) => {
      if (binary) return
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (isObj(msg)) this.receive(conn, msg as AppMessage, hello)
    })
    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('error', (e) => this.opts.log(`connection error: ${e.message}`))
    ws.on('close', () => {
      clearTimeout(hello)
      this.conns.delete(conn)
      if (!this.drop(conn)) return
      this.opts.log(`One tab disconnected: ${conn.info ? label(conn.info.workspace) : ''}`)
      this.failCalls(conn, GONE)
      this.sendPeers()
    })
  }

  /** Remove a tab from the connected ones; false when it was not one. */
  private drop(conn: Conn): boolean {
    const i = this.apps.indexOf(conn as Live)
    if (i < 0) return false
    this.apps.splice(i, 1)
    return true
  }

  /** The same workspace: same id from the same site (a local id is only unique per site). */
  private same(a: Live, b: Live): boolean {
    return a.bound && b.bound && a.origin === b.origin && a.info.workspace.id === b.info.workspace.id
  }

  private replace(old: Live, why: string) {
    this.drop(old)
    this.send(old, { type: 'replaced' })
    old.ws.close(MCP_CLOSE_REPLACED, 'replaced by a newer tab')
    this.failCalls(old, TOOK_OVER)
    this.opts.log(why)
  }

  private receive(conn: Conn, msg: AppMessage, hello: ReturnType<typeof setTimeout>) {
    switch (msg.type) {
      case 'hello': {
        const workspace = workspaceOf(msg.workspace, conn.bound)
        if (msg.app !== 'one' || !workspace) return void conn.ws.close(1008, 'bad hello')
        clearTimeout(hello)
        if (conn.info) return this.update(conn as Live, workspace, msg.mode)
        conn.info = { version: str(msg.version, 40), workspace, mode: modeOf(msg.mode), tools: toolsOf(msg.tools), contract: Number.isInteger(msg.contract) && Number(msg.contract) > 0 ? Number(msg.contract) : 1 }
        conn.seq = ++this.helloSeq
        const live = conn as Live
        // an older app (v1) is the only tab, as it always was; otherwise the same workspace's older tab leaves
        for (const old of [...this.apps]) {
          if (!live.bound || !old.bound) this.replace(old, 'a newer One tab took over (an older One version connects one tab at a time)')
          else if (this.same(old, live)) this.replace(old, `a newer tab of ${label(workspace)} took over`)
        }
        this.apps.push(live)
        this.opts.log(`One connected: workspace ${label(workspace)} (${workspace.kind}${workspace.readOnly ? ', view only' : ''}${live.bound ? '' : ', older One version'}) · agent changes: ${live.info.mode}`)
        this.send(live, { type: 'welcome', bridge: this.opts.version, client: this.client })
        for (const w of [...this.waiters]) w(live)
        this.sendPeers()
        return
      }
      case 'status': {
        if (!conn.info) return
        const workspace = workspaceOf(msg.workspace, conn.bound)
        // a v2 tab that cannot name its workspace any more is not served
        if (!workspace) return void conn.ws.close(1008, 'bad status')
        this.update(conn as Live, workspace, msg.mode)
        return
      }
      case 'pending': {
        const f = this.inflight.get(String(msg.id))
        if (!f || f.conn !== conn) return
        const ms = Math.min(MAX_PENDING_MS, Math.max(1000, Number(msg.timeoutMs) || MCP_APPROVAL_MS))
        // a little slack: the tab's own approval timeout answers first
        f.arm(ms + 10_000, mcpError('approval_timeout', '', 'The change was not approved in time'))
        f.onPending?.(ms)
        return
      }
      case 'result':
      case 'error': {
        const f = this.inflight.get(String(msg.id))
        if (!f || f.conn !== conn) return
        // an older tab (contract 1) words its refusals without a code: the code is put first here (shared withCode)
        if (msg.type === 'error') {
          const said = str(msg.error, 8000)
          return f.finish({ ok: false, error: !said ? 'rejected: The call failed in One. Nothing was confirmed — read what the call touches again before you call again.' : conn.info && conn.info.contract < 2 ? withCode(said) : said })
        }
        f.finish(this.olderNote(f, this.checked(f, msg.result ?? null)))
        return
      }
    }
  }

  /** A tab's workspace or mode changed (status, or a repeated hello). */
  private update(conn: Live, workspace: McpWorkspaceInfo, mode: unknown) {
    const before = conn.info.workspace
    conn.info = { ...conn.info, workspace, mode: modeOf(mode) }
    if (conn.bound && workspace.id !== before.id) {
      // it shows another workspace now: calls meant for the old one can't be answered there
      for (const [id, f] of [...this.inflight]) {
        if (f.conn !== conn || f.expected === workspace.id) continue
        this.send(conn, { type: 'cancel', id })
        f.finish({ ok: false, error: this.switched(before, workspace) })
      }
      conn.seq = ++this.helloSeq
      for (const old of [...this.apps]) if (old !== conn && this.same(old, conn)) this.replace(old, `a newer tab of ${label(workspace)} took over`)
      this.opts.log(`a One tab switched from ${label(before)} to ${label(workspace)}`)
    }
    if (workspace.name !== before.name || workspace.kind !== before.kind || workspace.id !== before.id) this.sendPeers()
  }

  private switched(from: McpWorkspaceInfo, to: McpWorkspaceInfo): string {
    return `${MCP_ERR.mismatch}: this call was meant for the workspace ${label(from)}, but that One tab switched to ${label(to)} before it answered. It was not carried out in ${JSON.stringify(to.name)}. Ask the person which workspace to use (one_list_workspaces shows what is connected).`
  }

  /**
   * A tab's result. v2: it must name the workspace it ran in, and that must be the call's — anything
   * else is refused (the result never reaches the agent). v1 tabs can't say: their name is added.
   */
  /**
   * A creating call answered by an older One tab (contract 1): repeats are joined only by tabs of contract 2 (the
   * instructions promise it for an up-to-date tab) — the answer says so, so a model reads before it repeats a call.
   */
  private olderNote(f: InFlight, out: CallOutcome): CallOutcome {
    if (!out.ok || !f.tool || !createsSomething(f.tool) || (f.conn.info?.contract ?? 1) >= 2 || !isObj(out.result)) return out
    return { ok: true, result: { ...out.result, repeatsJoined: false, note: OLDER_REPEATS } }
  }

  private checked(f: InFlight, result: unknown): CallOutcome {
    const info = f.conn.info
    if (!f.conn.bound) {
      if (isObj(result) && info) return { ok: true, result: { ...result, workspace: { ...(isObj(result.workspace) ? result.workspace : {}), id: null, name: info.workspace.name } } }
      return { ok: true, result }
    }
    const ran = isObj(result) && isObj(result.workspace) ? result.workspace.id : undefined
    if (!f.expected || ran !== f.expected) {
      this.opts.log(`refused a result from ${info ? label(info.workspace) : 'a tab'}: it ran in ${JSON.stringify(ran ?? null)}, the call was for ${JSON.stringify(f.expected)}`)
      return { ok: false, error: `${MCP_ERR.mismatch}: One answered from another workspace than the one this call was meant for (${JSON.stringify(f.expected)}), so the answer was dropped. Ask the person which workspace to use (one_list_workspaces).` }
    }
    return { ok: true, result }
  }

  /* ------------------------------------------------------------------ peers */

  /** Tell every v2 tab which other workspaces are connected (only when that changed). */
  private sendPeers() {
    for (const app of this.apps) {
      if (!app.bound) continue
      const peers: McpPeer[] = this.apps.filter((o) => o !== app && !(o.bound && o.info.workspace.id === app.info.workspace.id)).map((o) => ({ name: o.info.workspace.name, kind: o.info.workspace.kind }))
      const key = JSON.stringify(peers)
      if (key === app.peers) continue
      app.peers = key
      this.send(app, { type: 'peers', workspaces: peers })
    }
  }

  /* ------------------------------------------------------------------ calls */

  private inUseMessage(): string {
    const p = this.opts.port
    return `rejected: Another One MCP bridge is already using port ${p} (probably started by another MCP client). Nothing was changed. Ask the person to quit that client, or to run this one on another port: set ONE_MCP_PORT for the bridge and the same port in One → Settings → Agents · MCP.`
  }

  /** Wait (up to `ms`) for a tab to connect. */
  private waitForApp(ms: number, signal?: AbortSignal): Promise<boolean> {
    if (this.apps.length) return Promise.resolve(true)
    if (ms <= 0 || signal?.aborted) return Promise.resolve(false)
    return new Promise((resolve) => {
      const done = (c: Conn | null) => {
        clearTimeout(timer)
        this.waiters.delete(done)
        signal?.removeEventListener('abort', onAbort)
        resolve(!!c)
      }
      const onAbort = () => done(null)
      const timer = setTimeout(() => done(null), ms)
      this.waiters.add(done)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private ready(): string | null {
    if (this.state === 'in-use') return this.inUseMessage()
    if (this.state !== 'listening') return mcpError('rejected', '', 'The One bridge is not running', 'Ask the person to restart their MCP client (it starts the bridge).')
    return null
  }

  /** one_list_workspaces: the connected workspaces, newest first. No content. Its arguments: none (strict, as every tool). */
  async listWorkspaces(signal?: AbortSignal, args: Record<string, unknown> = {}): Promise<CallOutcome> {
    const extra = undeclared('one_list_workspaces', args)
    if (extra.length) return { ok: false, error: takesNo('one_list_workspaces', extra[0]!) }
    const down = this.ready()
    if (down) return { ok: false, error: down }
    await this.waitForApp(this.opts.waitMs, signal)
    if (signal?.aborted) return { ok: false, error: CANCELLED }
    const newest = this.apps.reduce((m, a) => Math.max(m, a.seq), 0)
    const workspaces = [...this.apps].sort((a, b) => b.seq - a.seq).map((a) => describe(a, a.seq === newest))
    return {
      ok: true,
      result: {
        workspaces,
        ...(this.last ? { lastUsed: { id: this.last.id ?? null, name: this.last.name } } : {}),
        hint: workspaces.length
          ? workspaces.length > 1
            ? 'Pass "workspace" (an id from here, or the exact name) to every other tool. Ids of pages and databases belong to their workspace.'
            : 'One workspace is connected: the other tools work there; "workspace" may be left out.'
          : MCP_NO_APP,
      },
    }
  }

  /** Forward one tool call to the tab of the workspace it is meant for. Never throws. */
  async call(tool: McpToolName, args: Record<string, unknown>, opts: CallOptions = {}): Promise<CallOutcome> {
    if (!TOOLS.has(tool)) return { ok: false, error: mcpError('bad_argument', '', `Unknown tool ${JSON.stringify(tool)}`, 'tools/list names the tools there are.') }
    // strict arguments: what the tool does not declare is refused here, never dropped on the way
    const extra = undeclared(tool, args)
    if (extra.length) return { ok: false, error: takesNo(tool, extra[0]!) }
    const down = this.ready()
    if (down) return { ok: false, error: down }
    // `workspace` is the bridge's argument: it picks the tab and is never forwarded as a tool argument
    const { workspace: target, ...rest } = args
    const any = await this.waitForApp(this.opts.waitMs, opts.signal)
    if (opts.signal?.aborted) return { ok: false, error: CANCELLED }
    if (!any) return { ok: false, error: MCP_NO_APP }
    const picked = resolveWorkspace(this.apps, target, this.last)
    if (!picked.ok) return picked
    const conn = picked.target
    // what the tab runs (its hello; an older tab: contract 1) — anything newer would be dropped or misread there
    const outdated = this.outdated(conn, tool, rest)
    if (outdated) return { ok: false, error: outdated }
    const expected = conn.bound ? conn.info.workspace.id! : null
    this.last = conn.info.workspace
    const id = `c${++this.seq}`
    return new Promise<CallOutcome>((resolve) => {
      const onAbort = () => {
        this.send(conn, { type: 'cancel', id })
        entry.finish({ ok: false, error: CANCELLED })
      }
      const entry: InFlight = {
        conn,
        expected,
        tool,
        onPending: opts.onPending,
        arm: (ms, why) => {
          clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            this.send(conn, { type: 'cancel', id })
            entry.finish({ ok: false, error: why })
          }, ms)
        },
        finish: (out) => {
          if (!this.inflight.has(id)) return
          clearTimeout(entry.timer)
          this.inflight.delete(id)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve(out)
        },
      }
      this.inflight.set(id, entry)
      entry.arm(this.opts.timeoutMs, NO_ANSWER(Math.round(this.opts.timeoutMs / 1000)))
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      this.send(conn, expected ? { type: 'call', id, tool, args: rest, workspace: expected } : { type: 'call', id, tool, args: rest })
    })
  }

  /** A call this tab cannot run as meant (a tool or an argument it does not announce) → app_outdated; null when it can. */
  private outdated(conn: Live, tool: string, args: Record<string, unknown>): string | null {
    const tools = conn.info.tools ?? V1_TOOLS
    const takes = tools.get(tool)
    const what = conn.info.tools ? 'this One tab' : 'this One tab (an older version)'
    if (!takes) return mcpError('app_outdated', '', `${what} has no ${tool} yet — the bridge is newer than One there`)
    const missing = Object.keys(args).find((k) => !takes.has(k))
    if (missing) return mcpError('app_outdated', missing, `${what} does not know ${JSON.stringify(missing)} of ${tool} yet — the bridge is newer than One there`)
    return null
  }

  private failCalls(conn: Conn, error: string) {
    for (const f of [...this.inflight.values()]) if (f.conn === conn) f.finish({ ok: false, error })
  }

  /* ------------------------------------------------------------------ plumbing */

  private send(conn: Conn, msg: BridgeMessage) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg))
  }

  private ping() {
    for (const conn of this.conns) {
      if (!conn.alive) {
        this.opts.log('a One tab stopped answering — dropping the connection')
        conn.ws.terminate()
        continue
      }
      conn.alive = false
      try {
        conn.ws.ping()
      } catch {
        /* closing */
      }
    }
  }
}
