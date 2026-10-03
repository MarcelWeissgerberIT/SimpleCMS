/**
 * The tab side of the bridge: a WebSocket on 127.0.0.1 that the One tab connects to.
 *
 *  - Handshake checks (before anything else happens): Host is loopback + our port, Origin is on
 *    the allowlist (policy.ts), subprotocol one-mcp.v1. Everything else gets a plain HTTP error.
 *  - One tab at a time. A new connection only counts once it said `hello`; then it replaces the
 *    current tab, which is told (`replaced`) and closed with 4001 — newest wins.
 *  - call(): forwards a tool call ({id, tool, args}) and waits for {id, result | error}. Reads time
 *    out after `timeoutMs`; a write the tab reports as `pending` (waiting for approval) gets the
 *    approval window instead. Without a tab, a call waits up to `waitMs` for one to connect.
 *  - Port taken (another MCP client runs a bridge): every call explains it; we retry to listen.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  MCP_APPROVAL_MS,
  MCP_CLOSE_REPLACED,
  MCP_NO_APP,
  MCP_SUBPROTOCOL,
  MCP_TOOL_NAMES,
  type AppMessage,
  type BridgeMessage,
  type McpAgentMode,
  type McpClientInfo,
  type McpToolName,
  type McpWorkspaceInfo,
} from '../../src/app/features/mcp/contract.ts'
import { isAllowedHost, isAllowedOrigin } from './policy.ts'

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
}

interface Conn {
  ws: WebSocket
  info: AppInfo | null
  alive: boolean
  origin: string
}

interface InFlight {
  conn: Conn
  timer?: ReturnType<typeof setTimeout>
  finish: (out: CallOutcome) => void
  arm: (ms: number, why: string) => void
  onPending?: (timeoutMs: number) => void
}

const MAX_PAYLOAD = 16 * 1024 * 1024
const HELLO_MS = 5000
/** a tab may ask for at most this long an approval window */
const MAX_PENDING_MS = 10 * 60_000
const TOOLS = new Set<string>(MCP_TOOL_NAMES)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

function workspaceOf(v: unknown): McpWorkspaceInfo | null {
  if (!isObj(v)) return null
  return { name: str(v.name, 120) || 'Workspace', kind: v.kind === 'team' ? 'team' : 'local', readOnly: v.readOnly === true }
}

const modeOf = (v: unknown): McpAgentMode => (v === 'apply' || v === 'read' ? v : 'ask')

export class Bridge {
  state: 'idle' | 'listening' | 'in-use' | 'closed' = 'idle'
  private opts: BridgeOptions
  private http: Server
  private wss: WebSocketServer
  private app: Conn | null = null
  private client: McpClientInfo | null = null
  private inflight = new Map<string, InFlight>()
  private waiters = new Set<(c: Conn | null) => void>()
  private seq = 0
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
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false, handleProtocols: () => MCP_SUBPROTOCOL })
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
    for (const f of [...this.inflight.values()]) f.finish({ ok: false, error: 'The One bridge stopped.' })
    for (const w of [...this.waiters]) w(null)
    for (const ws of this.wss.clients) ws.close(1001, 'bridge stopped')
    await new Promise<void>((r) => this.wss.close(() => r()))
    await new Promise<void>((r) => (this.http.listening ? this.http.close(() => r()) : r()))
    this.http.closeAllConnections?.()
  }

  /** The connected tab (after its hello), for status output and tests. */
  get connected(): AppInfo | null {
    return this.app?.info ?? null
  }

  /** The MCP client that launched us — passed on to the tab ("Connected · Claude Desktop"). */
  setClient(client: McpClientInfo | null): void {
    this.client = client ? { name: client.name.slice(0, 80), version: client.version.slice(0, 40) } : null
    if (this.app) this.send(this.app, { type: 'client', client: this.client })
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
    if (!protocols.includes(MCP_SUBPROTOCOL)) return this.refuse(socket, 400, 'Bad Request', `protocol ${JSON.stringify(protocols.join(', '))} (this bridge speaks ${MCP_SUBPROTOCOL} — update One or the bridge)`)
    this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws, origin!))
  }

  private adopt(ws: WebSocket, origin: string) {
    const conn: Conn = { ws, info: null, alive: true, origin }
    // a connection only replaces the current tab once it introduced itself
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
      if (this.app !== conn) return
      this.app = null
      this.opts.log('One tab disconnected')
      this.failCalls(conn, 'One was closed or disconnected before it answered.')
    })
  }

  private receive(conn: Conn, msg: AppMessage, hello: ReturnType<typeof setTimeout>) {
    switch (msg.type) {
      case 'hello': {
        const workspace = workspaceOf(msg.workspace)
        if (msg.app !== 'one' || !workspace) return void conn.ws.close(1008, 'bad hello')
        clearTimeout(hello)
        const first = !conn.info
        conn.info = { version: str(msg.version, 40), workspace, mode: modeOf(msg.mode) }
        if (!first) return
        const old = this.app
        this.app = conn
        if (old && old !== conn) {
          this.send(old, { type: 'replaced' })
          old.ws.close(MCP_CLOSE_REPLACED, 'replaced by a newer tab')
          this.failCalls(old, 'Another One tab took over before this one answered.')
          this.opts.log('a newer One tab took over')
        }
        this.opts.log(`One connected: workspace ${JSON.stringify(workspace.name)} (${workspace.kind}${workspace.readOnly ? ', view only' : ''}) · agent changes: ${conn.info.mode}`)
        this.send(conn, { type: 'welcome', bridge: this.opts.version, client: this.client })
        for (const w of [...this.waiters]) w(conn)
        return
      }
      case 'status': {
        const workspace = workspaceOf(msg.workspace)
        if (conn.info && workspace) conn.info = { ...conn.info, workspace, mode: modeOf(msg.mode) }
        return
      }
      case 'pending': {
        const f = this.inflight.get(String(msg.id))
        if (!f || f.conn !== conn) return
        const ms = Math.min(MAX_PENDING_MS, Math.max(1000, Number(msg.timeoutMs) || MCP_APPROVAL_MS))
        // a little slack: the tab's own approval timeout answers first
        f.arm(ms + 10_000, 'The change was not approved in time. Nothing was changed.')
        f.onPending?.(ms)
        return
      }
      case 'result':
      case 'error': {
        const f = this.inflight.get(String(msg.id))
        if (!f || f.conn !== conn) return
        if (msg.type === 'result') f.finish({ ok: true, result: msg.result ?? null })
        else f.finish({ ok: false, error: str(msg.error, 8000) || 'The call failed in One.' })
        return
      }
    }
  }

  /* ------------------------------------------------------------------ calls */

  private inUseMessage(): string {
    const p = this.opts.port
    return `Another One MCP bridge is already using port ${p} (probably started by another MCP client). Quit that client, or run this one on another port: set ONE_MCP_PORT for the bridge and the same port in One → Settings → Agents · MCP.`
  }

  /** Wait (up to `ms`) for a tab to connect. */
  private waitForApp(ms: number, signal?: AbortSignal): Promise<Conn | null> {
    if (this.app?.info) return Promise.resolve(this.app)
    if (ms <= 0 || signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const done = (c: Conn | null) => {
        clearTimeout(timer)
        this.waiters.delete(done)
        signal?.removeEventListener('abort', onAbort)
        resolve(c)
      }
      const onAbort = () => done(null)
      const timer = setTimeout(() => done(null), ms)
      this.waiters.add(done)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Forward one tool call to the connected tab. Never throws. */
  async call(tool: McpToolName, args: Record<string, unknown>, opts: CallOptions = {}): Promise<CallOutcome> {
    if (!TOOLS.has(tool)) return { ok: false, error: `Unknown tool ${JSON.stringify(tool)}.` }
    if (this.state === 'in-use') return { ok: false, error: this.inUseMessage() }
    if (this.state !== 'listening') return { ok: false, error: 'The One bridge is not running.' }
    const conn = await this.waitForApp(this.opts.waitMs, opts.signal)
    if (opts.signal?.aborted) return { ok: false, error: 'Cancelled.' }
    if (!conn) return { ok: false, error: MCP_NO_APP }
    const id = `c${++this.seq}`
    return new Promise<CallOutcome>((resolve) => {
      const onAbort = () => {
        this.send(conn, { type: 'cancel', id })
        entry.finish({ ok: false, error: 'Cancelled.' })
      }
      const entry: InFlight = {
        conn,
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
      entry.arm(this.opts.timeoutMs, `One did not answer within ${Math.round(this.opts.timeoutMs / 1000)} s. Is the tab still open?`)
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      this.send(conn, { type: 'call', id, tool, args })
    })
  }

  private failCalls(conn: Conn, error: string) {
    for (const f of [...this.inflight.values()]) if (f.conn === conn) f.finish({ ok: false, error })
  }

  /* ------------------------------------------------------------------ plumbing */

  private send(conn: Conn, msg: BridgeMessage) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg))
  }

  private ping() {
    for (const ws of this.wss.clients) {
      const conn = ws === this.app?.ws ? this.app : null
      if (conn && !conn.alive) {
        this.opts.log('One tab stopped answering — dropping the connection')
        ws.terminate()
        continue
      }
      if (conn) conn.alive = false
      try {
        ws.ping()
      } catch {
        /* closing */
      }
    }
  }
}
