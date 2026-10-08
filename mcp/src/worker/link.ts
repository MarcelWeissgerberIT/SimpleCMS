/**
 * one-worker — the link to the One tab. Two ways, one protocol:
 *
 * Local: a WebSocket on 127.0.0.1 with the same door as the MCP bridge (mcp/src/policy.ts): Host must be
 * loopback + our port, Origin on the allow-list, subprotocol one-worker.v1, a hello with a workspace id within
 * 5 s. The worker is bound to ONE workspace (worker.json "workspace"): a tab of any other workspace — or any
 * tab while none is set — is refused (4003). The newest tab of that workspace wins (the older one gets 4001).
 * A worker downloaded from One (a preset, preset.ts) also needs the download's pairing secret in the hello —
 * compared in constant time; none or another one is refused (4003, reason "pair").
 *
 * Cloud (a cloud preset, docs/CODING.md § Cloud worker): no tab ever connects here — the worker dials the team
 * server (cloud.ts), which pairs it with its member's tab. Per pairing both sides send a fresh nonce; every
 * protocol frame then travels sealed with a key derived from the download's pairing secret (box.ts). The first
 * box that opens is the tab's proof that it holds the secret (a box that does not open: refused, "pair"); the
 * worker's boxed welcome is its proof to the tab. The relay sees sizes and timing, never content, and can
 * neither forge, replay nor reorder a frame.
 *
 * The same port answers POST /task for the task tools Claude Code calls during a run (task-mcp): no
 * Origin allowed (browsers always send one), a bearer token that only that run's MCP config holds — and,
 * through `http`, the local setup page under /setup (setup.ts, with its own door). Both stay local in cloud mode.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  RELAY_MAX_PLAIN,
  RELAY_NONCE,
  WORKER_CLOSE_REFUSED,
  WORKER_CLOSE_REPLACED,
  WORKER_SUBPROTOCOL,
  WORKSPACE_ID,
  type RefusedReason,
  type TabMessage,
  type WorkerInfo,
  type WorkerMessage,
  type WorkspaceRef,
} from '../../../src/app/features/coding/protocol.ts'
import { isAllowedHost, isAllowedOrigin } from '../policy.ts'
import { BoxSession, newNonce, sessionKey } from './box.ts'
import { CloudDial, type CloudFatal } from './cloud.ts'
import { sameSecret } from './preset.ts'

export interface CloudLink {
  /** wss://<server>/coding/worker */
  url: string
  token: string
  version: string
  onFatal: (reason: CloudFatal, message: string) => void
  /** test seams (cloud.ts) */
  backoffMs?: number[]
}

export interface LinkOptions {
  port: number
  host?: string
  origins: string[]
  /** the workspace this worker serves (null = none yet: every tab is refused) */
  workspace: string | null
  /** a downloaded worker's pairing secret: a tab must say hello with it (null = a worker.json worker: not asked) */
  pair?: string | null
  /** cloud mode: dial the team server's relay instead of taking tabs on 127.0.0.1 */
  cloud?: CloudLink | null
  /** other HTTP requests (the setup page); resolves true when answered */
  http?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
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

/** One tab's connection: a local WebSocket, or a pairing the team server's relay carries (cloud). */
interface Conn {
  /** local only (pinged) */
  ws: WebSocket | null
  workspace: WorkspaceRef | null
  alive: boolean
  /** a relay pairing whose first box opened with this download's key: the tab holds the pairing secret */
  proven: boolean
  send(text: string, droppable?: boolean): void
  close(code: number, reason: string): void
  isOpen(): boolean
}

/** One relay pairing (cloud): its nonce, its box once both nonces are known, its tab. */
interface Pairing {
  s: number
  wn: string
  box: BoxSession | null
  /** a box of the tab opened (later ones that do not: a broken session, not another device) */
  opened: boolean
  /** the pairing is over: its conn sends nothing more */
  ended: boolean
  conn: Conn
  hello: ReturnType<typeof setTimeout>
}

const MAX_PAYLOAD = 8 * 1024 * 1024
const HELLO_MS = 5000
/** a relayed tab: the key exchange and the hello within this */
const RELAY_HELLO_MS = 15_000
const OUTBOX_MAX = 4000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function workspaceOf(v: unknown): WorkspaceRef | null {
  if (!isObj(v) || typeof v.id !== 'string' || !WORKSPACE_ID.test(v.id)) return null
  const kind = v.kind === 'team' ? 'team' : 'local'
  if (!v.id.startsWith(`${kind}:`)) return null
  const name = (typeof v.name === 'string' ? v.name : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'Workspace'
  return { id: v.id, name, kind, readOnly: v.readOnly === true }
}

/**
 * A frame too large for the relay (a huge diff): diffs and edit hunks are left out; still too large, a finish
 * reports the failure instead (never a 1009 → reconnect → resend loop) and anything else is dropped (null).
 */
export function shrinkForRelay(text: string, max = RELAY_MAX_PLAIN): string | null {
  if (text.length <= max) return text
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const slim = (git: unknown) => (isObj(git) && Array.isArray(git.files) ? { ...git, files: git.files.map((f) => (isObj(f) ? { ...f, diff: null, truncated: true } : f)) } : git)
  if (isObj(msg.outcome)) msg.outcome = { ...msg.outcome, git: slim(msg.outcome.git) }
  if (isObj(msg.result)) msg.result = { ...msg.result, git: slim(msg.result.git) }
  if (msg.git) msg.git = slim(msg.git)
  if (Array.isArray(msg.lines)) msg.lines = msg.lines.map((l) => (isObj(l) ? { ...l, e: undefined } : l))
  const again = JSON.stringify(msg)
  if (again.length <= max) return again
  if (msg.type === 'req' && msg.op === 'finish') return JSON.stringify({ ...msg, outcome: { status: 'failed', error: 'The outcome was too large to send through the team server.' } })
  if (msg.type === 'res') return JSON.stringify({ type: 'res', id: msg.id, ok: false, error: 'The answer was too large to send through the team server.' })
  return null
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
  private dial: CloudDial | null = null
  private pairing: Pairing | null = null

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

  /** Cloud mode: the team server it dials (host), else null. */
  get via(): string | null {
    return this.dial?.host ?? (this.opts.cloud ? new URL(this.opts.cloud.url).host : null)
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
        if (this.opts.cloud) this.startDial(this.opts.cloud)
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
    if (this.pairing) this.endPairing(this.pairing)
    await this.dial?.stop()
    for (const ws of this.wss.clients) ws.close(1001, 'worker stopped')
    await new Promise<void>((r) => this.wss.close(() => r()))
    await new Promise<void>((r) => (this.http.listening ? this.http.close(() => r()) : r()))
    this.http.closeAllConnections?.()
  }

  /* ------------------------------------------------------------------ messages */

  /** Send to the tab; events wait in the outbox while none is connected. */
  send(msg: WorkerMessage): void {
    if (this.tab?.workspace && this.tab.isOpen()) this.tab.send(JSON.stringify(msg), msg.type === 'event')
    else if (msg.type === 'event') {
      this.outbox.push(msg)
      if (this.outbox.length > OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - OUTBOX_MAX)
    }
  }

  /** Tell the connected tab what the worker is now (a fresh `welcome`: the repos changed in the setup page). */
  announce(): void {
    if (this.tab?.workspace && this.tab.isOpen()) this.tab.send(JSON.stringify({ type: 'welcome', ...this.opts.info() } satisfies WorkerMessage))
  }

  /** Ask the tab; rejects when no tab is connected, on its error, or after the timeout. */
  request(body: ReqBody, timeoutMs = this.opts.timeoutMs ?? 30_000): Promise<unknown> {
    const tab = this.tab
    if (!tab?.workspace || !tab.isOpen()) return Promise.reject(new Error('One is not connected'))
    const id = `w${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('One did not answer in time'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      tab.send(JSON.stringify({ type: 'req', id, ...body }))
    })
  }

  /* ------------------------------------------------------------------ handshake (local) */

  private refuse(socket: Duplex, status: number, text: string, why: string) {
    if (this.refusals++ < 20) this.opts.log(`refused a connection: ${why}`)
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
    socket.destroy()
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => socket.destroy())
    // a cloud worker takes its tab through the team server only — never one on this port
    if (this.opts.cloud) return this.refuse(socket, 403, 'Forbidden', `this worker connects through ${this.via} (cloud mode) — One tabs reach it there`)
    if (!isAllowedHost(req.headers.host, this.opts.port)) return this.refuse(socket, 403, 'Forbidden', `host ${JSON.stringify(req.headers.host ?? '')}`)
    if (!isAllowedOrigin(req.headers.origin, this.opts.origins)) return this.refuse(socket, 403, 'Forbidden', `origin ${JSON.stringify(req.headers.origin ?? '(none)')} is not allowed`)
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim())
    if (!protocols.includes(WORKER_SUBPROTOCOL)) return this.refuse(socket, 400, 'Bad Request', `protocol ${JSON.stringify(protocols.join(', '))} (this worker speaks ${WORKER_SUBPROTOCOL})`)
    this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws))
  }

  private adopt(ws: WebSocket) {
    const conn: Conn = {
      ws,
      workspace: null,
      alive: true,
      proven: false,
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
      isOpen: () => ws.readyState === WebSocket.OPEN,
    }
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
      this.gone(conn)
    })
  }

  /** A tab's connection ended (its socket closed, or its relay pairing ended). */
  private gone(conn: Conn) {
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
  }

  /* ------------------------------------------------------------------ the relay (cloud) */

  private startDial(cloud: CloudLink) {
    if (!this.opts.workspace) return
    this.dial = new CloudDial({
      url: cloud.url,
      token: cloud.token,
      workspace: this.opts.workspace,
      version: cloud.version,
      log: this.opts.log,
      backoffMs: cloud.backoffMs,
      onTabOpen: (s) => this.tabOpen(s),
      onTabGone: (s) => {
        if (this.pairing?.s === s) this.endPairing(this.pairing)
      },
      onFrame: (msg) => this.relayFrame(msg),
      onDown: () => {
        if (this.pairing) this.endPairing(this.pairing)
      },
      onFatal: (reason, message) => {
        if (this.pairing) this.endPairing(this.pairing)
        cloud.onFatal(reason, message)
      },
    })
    this.dial.start()
  }

  /** The relay paired a tab with this worker: a fresh nonce, then wait for the tab's nonce and its sealed hello. */
  private tabOpen(s: number) {
    if (this.pairing) this.endPairing(this.pairing)
    const dial = this.dial!
    const pairing = { s, wn: newNonce(), box: null, opened: false, ended: false } as unknown as Pairing
    pairing.conn = {
      ws: null,
      workspace: null,
      alive: true,
      proven: false,
      send: (text, droppable) => {
        if (pairing.ended || !pairing.box) return
        const fit = shrinkForRelay(text)
        if (fit === null) return this.opts.log('left out a message too large for the team server')
        dial.send({ ...pairing.box.seal(fit, droppable === true) })
      },
      close: (code, reason) => {
        if (pairing.ended) return
        dial.send({ type: 'relay', op: 'close-tab', s, code, reason: reason.replace(/[^a-z0-9 -]/gi, '').slice(0, 60) })
        this.endPairing(pairing)
      },
      isOpen: () => !pairing.ended && this.pairing === pairing && dial.open,
    }
    pairing.hello = setTimeout(() => {
      if (!pairing.conn.workspace) pairing.conn.close(1008, 'hello expected')
    }, RELAY_HELLO_MS)
    this.pairing = pairing
    dial.send({ type: 'key', s, n: pairing.wn })
  }

  private endPairing(pairing: Pairing) {
    if (pairing.ended) return
    pairing.ended = true
    clearTimeout(pairing.hello)
    if (this.pairing === pairing) this.pairing = null
    this.gone(pairing.conn)
  }

  private relayFrame(msg: Record<string, unknown>) {
    const pairing = this.pairing
    if (!pairing || msg.s !== pairing.s) return
    if (msg.type === 'key') {
      if (pairing.box || typeof msg.n !== 'string' || !RELAY_NONCE.test(msg.n)) return pairing.conn.close(1008, 'bad key')
      try {
        pairing.box = new BoxSession(sessionKey(this.opts.pair ?? '', msg.n, pairing.wn), pairing.s, 'worker')
      } catch {
        pairing.conn.close(1008, 'bad key')
      }
      return
    }
    if (msg.type !== 'box') return
    if (!pairing.box) return pairing.conn.close(1008, 'key first')
    let text: string
    try {
      text = pairing.box.open(msg)
    } catch {
      if (pairing.opened) return pairing.conn.close(1008, 'bad box')
      // the very first box does not open: this tab does not hold this download's pairing secret
      if (this.refusals++ < 20) this.opts.log('refused a One tab that is not paired with this file (another device or an older download) — download the cloud worker again on the device that should hand out the work')
      return pairing.conn.close(WORKER_CLOSE_REFUSED, 'pair')
    }
    pairing.opened = true
    pairing.conn.proven = true
    let frame: unknown
    try {
      frame = JSON.parse(text)
    } catch {
      return
    }
    if (isObj(frame)) this.receive(pairing.conn, frame as TabMessage, pairing.hello)
  }

  /* ------------------------------------------------------------------ the protocol */

  private refuseTab(conn: Conn, reason: RefusedReason, offered: WorkspaceRef) {
    if (this.refusals++ < 20)
      this.opts.log(
        reason === 'unbound'
          ? `refused the tab of ${JSON.stringify(offered.name)}: this worker is not bound to a workspace yet — set "workspace": ${JSON.stringify(offered.id)} in worker.json if it should serve that one`
          : reason === 'pair'
            ? `refused a tab of ${JSON.stringify(offered.name)}: it did not bring this download's pairing key — start the file One downloaded last, or download the worker again (One → Settings → Coding worker)`
            : `refused the tab of ${JSON.stringify(offered.name)} (${offered.id}): this worker serves ${this.opts.workspace}`,
      )
    if (conn.isOpen()) conn.send(JSON.stringify({ type: 'refused', reason, ...(this.opts.pair ? { paired: true } : {}) } satisfies WorkerMessage))
    conn.close(WORKER_CLOSE_REFUSED, reason === 'unbound' ? 'worker not bound' : reason === 'pair' ? 'not paired' : 'another workspace')
  }

  private receive(conn: Conn, msg: TabMessage, hello: ReturnType<typeof setTimeout>) {
    switch (msg.type) {
      case 'hello': {
        const ws = workspaceOf(msg.workspace)
        if (msg.app !== 'one' || !ws) return void conn.close(1008, 'bad hello')
        clearTimeout(hello)
        if (!this.opts.workspace) return this.refuseTab(conn, 'unbound', ws)
        if (ws.id !== this.opts.workspace) return this.refuseTab(conn, 'workspace', ws)
        // a downloaded worker: only the browser that downloaded it (its pairing secret, constant-time) — through the
        // relay, the opened box already proved it
        if (this.opts.pair && !conn.proven && !sameSecret(this.opts.pair, (msg as { pair?: unknown }).pair)) return this.refuseTab(conn, 'pair', ws)
        if (conn.workspace) return
        conn.workspace = ws
        const old = this.tab
        if (old && old !== conn) {
          old.close(WORKER_CLOSE_REPLACED, 'replaced by a newer tab')
          for (const p of this.pending.values()) {
            clearTimeout(p.timer)
            p.reject(new Error('another One tab took over'))
          }
          this.pending.clear()
        }
        this.tab = conn
        this.opts.log(`One connected: ${JSON.stringify(ws.name)} (${ws.kind}${conn.ws ? '' : `, through ${this.via}`})`)
        conn.send(JSON.stringify({ type: 'welcome', ...this.opts.info() } satisfies WorkerMessage))
        for (const m of this.outbox.splice(0)) conn.send(JSON.stringify(m), true)
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
          .then((result) => conn.isOpen() && conn.send(JSON.stringify({ type: 'res', id, ok: true, result } satisfies WorkerMessage)))
          .catch((e: unknown) => conn.isOpen() && conn.send(JSON.stringify({ type: 'res', id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies WorkerMessage)))
        return
      }
    }
  }

  private ping() {
    for (const conn of this.conns) {
      if (!conn.ws) continue
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
      if (this.opts.http && (await this.opts.http(req, res).catch(() => false))) return
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
