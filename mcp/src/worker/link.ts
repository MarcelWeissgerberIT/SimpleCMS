/**
 * one-worker — the link to the One tab: a WebSocket on 127.0.0.1 with the same door as the MCP bridge
 * (mcp/src/policy.ts): Host must be loopback + our port, Origin on the allow-list, subprotocol
 * one-worker.v1, a hello with a workspace id within 5 s. The worker is bound to ONE workspace (worker.json
 * "workspace"): a tab of any other workspace — or any tab while none is set — is refused (4003). The
 * newest tab of that workspace wins (the older one is closed with 4001).
 *
 * The same port answers POST /task for the task tools Claude Code calls during a run (task-mcp): no
 * Origin allowed (browsers always send one), a bearer token that only that run's MCP config holds.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  WORKER_CLOSE_REFUSED,
  WORKER_CLOSE_REPLACED,
  WORKER_SUBPROTOCOL,
  WORKSPACE_ID,
  type TabMessage,
  type WorkerInfo,
  type WorkerMessage,
  type WorkspaceRef,
} from '../../../src/app/features/coding/protocol.ts'
import { isAllowedHost, isAllowedOrigin } from '../policy.ts'

export interface LinkOptions {
  port: number
  host?: string
  origins: string[]
  /** the workspace this worker serves (null = none yet: every tab is refused) */
  workspace: string | null
  log: (msg: string) => void
  info: () => WorkerInfo
  onConnect: (ws: WorkspaceRef) => void
  onDisconnect: () => void
  onRequest: (msg: Extract<TabMessage, { type: 'req' }>) => Promise<unknown>
  onNudge: () => void
  onTask: (token: string, tool: string, args: Record<string, unknown>) => Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }>
  /** ms a request to the tab may take (default 30000) */
  timeoutMs?: number
  pingMs?: number
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** A request to the tab, without its id. */
export type ReqBody = DistOmit<Extract<WorkerMessage, { type: 'req' }>, 'id' | 'type'>

interface Conn {
  ws: WebSocket
  workspace: WorkspaceRef | null
  alive: boolean
}

const MAX_PAYLOAD = 8 * 1024 * 1024
const HELLO_MS = 5000
const OUTBOX_MAX = 4000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function workspaceOf(v: unknown): WorkspaceRef | null {
  if (!isObj(v) || typeof v.id !== 'string' || !WORKSPACE_ID.test(v.id)) return null
  const kind = v.kind === 'team' ? 'team' : 'local'
  if (!v.id.startsWith(`${kind}:`)) return null
  const name = (typeof v.name === 'string' ? v.name : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'Workspace'
  return { id: v.id, name, kind, readOnly: v.readOnly === true }
}

export class WorkerLink {
  state: 'idle' | 'listening' | 'in-use' | 'closed' = 'idle'
  private opts: LinkOptions
  private http: Server
  private wss: WebSocketServer
  private tab: Conn | null = null
  private conns = new Set<Conn>()
  private seq = 0
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  /** events while no tab is connected (sent on the next connect) */
  private outbox: WorkerMessage[] = []
  private pinger: ReturnType<typeof setInterval> | null = null
  private refusals = 0

  constructor(opts: LinkOptions) {
    this.opts = opts
    this.http = createServer((req, res) => void this.httpRequest(req, res))
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false, handleProtocols: (offered) => (offered.has(WORKER_SUBPROTOCOL) ? WORKER_SUBPROTOCOL : false) })
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(req, socket, head))
    this.http.on('clientError', (_e, socket) => socket.destroy())
  }

  get connected(): WorkspaceRef | null {
    return this.tab?.workspace ?? null
  }

  start(): Promise<'listening' | 'in-use'> {
    return new Promise((resolve) => {
      const onError = (e: NodeJS.ErrnoException) => {
        this.state = 'in-use'
        this.opts.log(e.code === 'EADDRINUSE' ? `port ${this.opts.port} is in use — is another one-worker running? (set "port" in worker.json and the same port in One)` : `cannot listen on 127.0.0.1:${this.opts.port}: ${e.message}`)
        resolve('in-use')
      }
      this.http.once('error', onError)
      this.http.listen(this.opts.port, this.opts.host ?? '127.0.0.1', () => {
        this.http.off('error', onError)
        this.state = 'listening'
        this.pinger = setInterval(() => this.ping(), this.opts.pingMs ?? 15_000)
        resolve('listening')
      })
    })
  }

  async close(): Promise<void> {
    this.state = 'closed'
    if (this.pinger) clearInterval(this.pinger)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('worker stopped'))
    }
    this.pending.clear()
    for (const ws of this.wss.clients) ws.close(1001, 'worker stopped')
    await new Promise<void>((r) => this.wss.close(() => r()))
    await new Promise<void>((r) => (this.http.listening ? this.http.close(() => r()) : r()))
    this.http.closeAllConnections?.()
  }

  /* ------------------------------------------------------------------ messages */

  /** Send to the tab; events wait in the outbox while none is connected. */
  send(msg: WorkerMessage): void {
    if (this.tab?.workspace && this.tab.ws.readyState === WebSocket.OPEN) this.tab.ws.send(JSON.stringify(msg))
    else if (msg.type === 'event') {
      this.outbox.push(msg)
      if (this.outbox.length > OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - OUTBOX_MAX)
    }
  }

  /** Ask the tab; rejects when no tab is connected, on its error, or after the timeout. */
  request(body: ReqBody, timeoutMs = this.opts.timeoutMs ?? 30_000): Promise<unknown> {
    const tab = this.tab
    if (!tab?.workspace || tab.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('One is not connected'))
    const id = `w${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('One did not answer in time'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      tab.ws.send(JSON.stringify({ type: 'req', id, ...body }))
    })
  }

  /* ------------------------------------------------------------------ handshake */

  private refuse(socket: Duplex, status: number, text: string, why: string) {
    if (this.refusals++ < 20) this.opts.log(`refused a connection: ${why}`)
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
    socket.destroy()
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy())
    if (!isAllowedHost(req.headers.host, this.opts.port)) return this.refuse(socket, 403, 'Forbidden', `host ${JSON.stringify(req.headers.host ?? '')}`)
    if (!isAllowedOrigin(req.headers.origin, this.opts.origins)) return this.refuse(socket, 403, 'Forbidden', `origin ${JSON.stringify(req.headers.origin ?? '(none)')} is not allowed`)
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim())
    if (!protocols.includes(WORKER_SUBPROTOCOL)) return this.refuse(socket, 400, 'Bad Request', `protocol ${JSON.stringify(protocols.join(', '))} (this worker speaks ${WORKER_SUBPROTOCOL})`)
    this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws))
  }

  private adopt(ws: WebSocket) {
    const conn: Conn = { ws, workspace: null, alive: true }
    this.conns.add(conn)
    const hello = setTimeout(() => {
      if (!conn.workspace) ws.close(1008, 'hello expected')
    }, HELLO_MS)
    ws.on('message', (data: RawData, binary: boolean) => {
      if (binary) return
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (isObj(msg)) this.receive(conn, msg as TabMessage, hello)
    })
    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('error', (e) => this.opts.log(`connection error: ${e.message}`))
    ws.on('close', () => {
      clearTimeout(hello)
      this.conns.delete(conn)
      if (this.tab !== conn) return
      this.tab = null
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('One disconnected'))
      }
      this.pending.clear()
      this.opts.log('One disconnected')
      this.opts.onDisconnect()
    })
  }

  private refuseTab(conn: Conn, reason: 'workspace' | 'unbound', offered: WorkspaceRef) {
    if (this.refusals++ < 20)
      this.opts.log(
        reason === 'unbound'
          ? `refused the tab of ${JSON.stringify(offered.name)}: this worker is not bound to a workspace yet — set "workspace": ${JSON.stringify(offered.id)} in worker.json if it should serve that one`
          : `refused the tab of ${JSON.stringify(offered.name)} (${offered.id}): this worker serves ${this.opts.workspace}`,
      )
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({ type: 'refused', reason } satisfies WorkerMessage))
    conn.ws.close(WORKER_CLOSE_REFUSED, reason === 'unbound' ? 'worker not bound' : 'another workspace')
  }

  private receive(conn: Conn, msg: TabMessage, hello: ReturnType<typeof setTimeout>) {
    switch (msg.type) {
      case 'hello': {
        const ws = workspaceOf(msg.workspace)
        if (msg.app !== 'one' || !ws) return void conn.ws.close(1008, 'bad hello')
        clearTimeout(hello)
        if (!this.opts.workspace) return this.refuseTab(conn, 'unbound', ws)
        if (ws.id !== this.opts.workspace) return this.refuseTab(conn, 'workspace', ws)
        if (conn.workspace) return
        conn.workspace = ws
        const old = this.tab
        if (old && old !== conn) {
          old.ws.close(WORKER_CLOSE_REPLACED, 'replaced by a newer tab')
          for (const p of this.pending.values()) {
            clearTimeout(p.timer)
            p.reject(new Error('another One tab took over'))
          }
          this.pending.clear()
        }
        this.tab = conn
        this.opts.log(`One connected: ${JSON.stringify(ws.name)} (${ws.kind})`)
        conn.ws.send(JSON.stringify({ type: 'welcome', ...this.opts.info() } satisfies WorkerMessage))
        for (const m of this.outbox.splice(0)) conn.ws.send(JSON.stringify(m))
        this.opts.onConnect(ws)
        return
      }
      case 'status': {
        if (!conn.workspace) return
        const ws = workspaceOf(msg.workspace)
        // the tab now shows another workspace: it may not stay connected
        if (!ws || ws.id !== this.opts.workspace) return this.refuseTab(conn, 'workspace', ws ?? { id: '?', name: '?', kind: 'local', readOnly: false })
        conn.workspace = ws
        return
      }
      case 'nudge':
        if (conn === this.tab) this.opts.onNudge()
        return
      case 'res': {
        if (conn !== this.tab) return
        const p = this.pending.get(String(msg.id))
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(String(msg.id))
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(String(msg.error ?? 'One refused').slice(0, 2000)))
        return
      }
      case 'req': {
        if (conn !== this.tab) return
        const id = String(msg.id)
        this.opts
          .onRequest(msg)
          .then((result) => conn.ws.readyState === WebSocket.OPEN && conn.ws.send(JSON.stringify({ type: 'res', id, ok: true, result } satisfies WorkerMessage)))
          .catch((e: unknown) => conn.ws.readyState === WebSocket.OPEN && conn.ws.send(JSON.stringify({ type: 'res', id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies WorkerMessage)))
        return
      }
    }
  }

  private ping() {
    for (const conn of this.conns) {
      if (!conn.alive) {
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

  /* ------------------------------------------------------------------ task tools (HTTP) */

  private async httpRequest(req: IncomingMessage, res: ServerResponse) {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', connection: 'close', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== '/task') {
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', connection: 'close', upgrade: 'websocket' })
      return void res.end('one-worker: WebSocket only.\n')
    }
    // browsers always send Origin: no web page may call the task tools
    if (req.headers.origin !== undefined || !isAllowedHost(req.headers.host, this.opts.port)) return reply(403, { ok: false, error: 'forbidden' })
    const token = /^Bearer ([a-f0-9]{48})$/.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!token) return reply(401, { ok: false, error: 'no token' })
    let raw = ''
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 64 * 1024) return reply(413, { ok: false, error: 'too large' })
      raw += String(chunk)
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, { ok: false, error: 'bad json' })
    }
    if (!isObj(body) || typeof body.tool !== 'string') return reply(400, { ok: false, error: 'bad request' })
    const out = await this.opts.onTask(token, body.tool, isObj(body.args) ? body.args : {})
    if (out.ok) reply(200, out)
    else reply(out.status, { ok: false, error: out.error })
  }
}
