/**
 * A fake team-server relay for cloud workers (docs/CODING.md § Cloud worker): a WebSocket server on 127.0.0.1
 * that records the worker's upgrade headers, can refuse it with any HTTP status, greets it (`ready`), pairs it
 * with a test tab (`tab-open`) and closes it with any code. The tab side (RelayTab) does what One's tab does:
 * the nonce exchange, then every protocol frame sealed with the tab's own WebCrypto box (relayBox.ts) — so these
 * tests check the worker against the real tab crypto. It answers `next` / `heartbeat` / `finish` like FakeTab.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { WORKER_SUBPROTOCOL, type StageOutcome, type TabMessage, type TaskPayload, type WorkerMessage, type WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { BoxSession, newNonce, sessionKey } from '../../src/app/features/coding/relayBox.ts'
import { waitFor } from './helpers.ts'

type Req = Extract<WorkerMessage, { type: 'req' }>

export class FakeRelay {
  readonly http: Server
  readonly wss: WebSocketServer
  port = 0
  workspace: { id: string; name: string }
  /** the headers of every worker upgrade */
  upgrades: IncomingHttpHeaders[] = []
  /** answer the next upgrades with this instead (null: accept) */
  refuse: { status: number; text: string; headers?: Record<string, string> } | null = null
  /** what GET /api/coding/worker answers */
  check: { status: number; body: unknown } = { status: 200, body: {} }
  /** greet a worker with `ready` (off: a test sends its own) */
  autoReady = true
  worker: WebSocket | null = null
  /** every frame the worker sent, parsed */
  frames: Array<Record<string, unknown>> = []
  tab: RelayTab | null = null
  s = 0

  private constructor(workspace: { id: string; name: string }) {
    this.workspace = workspace
    this.http = createServer((req, res) => this.request(req, res))
    this.wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has(WORKER_SUBPROTOCOL) ? WORKER_SUBPROTOCOL : false) })
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(req, socket, head))
  }

  static async start(workspace: { id: string; name: string }): Promise<FakeRelay> {
    const relay = new FakeRelay(workspace)
    await new Promise<void>((resolve) => relay.http.listen(0, '127.0.0.1', () => resolve()))
    relay.port = (relay.http.address() as AddressInfo).port
    return relay
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private request(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/api/coding/worker') {
      this.upgrades.push(req.headers)
      res.writeHead(this.check.status, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify(this.check.body))
    }
    res.writeHead(404)
    res.end()
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    this.upgrades.push(req.headers)
    const r = this.refuse
    if (r) {
      const extra = Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join('')
      socket.end(`HTTP/1.1 ${r.status} ${r.text.split(':')[0]}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(r.text)}\r\n${extra}\r\n${r.text}`)
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.worker?.terminate()
      this.worker = ws
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>
        this.frames.push(msg)
        if (this.tab && msg.s === this.tab.s && (msg.type === 'key' || msg.type === 'box')) this.tab.fromWorker(msg)
        if (msg.type === 'relay' && msg.op === 'close-tab' && this.tab && msg.s === this.tab.s) this.tab.closed = { code: Number(msg.code), reason: String(msg.reason) }
      })
      if (this.autoReady) this.send({ type: 'relay', op: 'ready', workspace: this.workspace })
    })
  }

  /** How many worker upgrades came in (refused ones too). */
  get attempts(): number {
    return this.upgrades.filter((h) => h.upgrade === 'websocket').length
  }

  send(msg: unknown) {
    this.worker?.send(JSON.stringify(msg))
  }

  async connected(ms = 8000): Promise<void> {
    await waitFor(() => this.worker?.readyState === WebSocket.OPEN, ms, () => 'the worker connects')
  }

  /** A tab of the member arrives: a new pairing; the tab sends its nonce (with this pairing secret). */
  openTab(pair: string): RelayTab {
    this.s += 1
    const tab = new RelayTab(this, this.s, pair)
    this.tab = tab
    this.send({ type: 'relay', op: 'tab-open', s: this.s })
    this.send({ type: 'key', s: this.s, n: tab.tn })
    return tab
  }

  tabGone(reason = 'closed') {
    if (!this.tab) return
    this.send({ type: 'relay', op: 'tab-gone', s: this.tab.s, reason })
    this.tab = null
  }

  /** The connection drops without a word. */
  drop() {
    this.worker?.terminate()
    this.worker = null
    this.tab = null
  }

  closeWorker(code: number, reason: string) {
    this.worker?.close(code, reason)
    this.tab = null
  }

  async stop() {
    this.worker?.terminate()
    await new Promise<void>((r) => this.wss.close(() => r()))
    await new Promise<void>((r) => this.http.close(() => r()))
    this.http.closeAllConnections?.()
  }
}

/** The member's One tab behind the relay — the real tab crypto, the FakeTab answers. */
export class RelayTab {
  readonly relay: FakeRelay
  readonly s: number
  readonly pair: string
  readonly tn = newNonce()
  box: BoxSession | null = null
  messages: WorkerMessage[] = []
  /** boxes that did not open (another key: the worker is not the one this tab paired with) */
  unopened = 0
  closed: { code: number; reason: string } | null = null
  queue: TaskPayload[] = []
  outcomes: Array<{ taskId: string; stageId: string; outcome: StageOutcome; finishId?: string }> = []
  heartbeats = 0
  /** answer `finish` (off: the outcome stays unconfirmed at the worker) */
  answerFinish = true
  private chain: Promise<void> = Promise.resolve()
  private seq = 0
  private pending = new Map<string, (m: Extract<WorkerMessage, { type: 'res' }>) => void>()

  constructor(relay: FakeRelay, s: number, pair: string) {
    this.relay = relay
    this.s = s
    this.pair = pair
  }

  /** Frames of the worker, in order (WebCrypto is async). */
  fromWorker(msg: Record<string, unknown>) {
    this.chain = this.chain.then(async () => {
      if (msg.type === 'key') {
        if (!this.box) this.box = new BoxSession(await sessionKey(this.pair, this.tn, String(msg.n)), this.s, 'tab')
        return
      }
      if (!this.box) return
      let text: string
      try {
        text = await this.box.open(msg)
      } catch {
        this.unopened++
        return
      }
      const m = JSON.parse(text) as WorkerMessage
      this.messages.push(m)
      if (m.type === 'req') await this.answer(m)
      if (m.type === 'res') this.pending.get(m.id)?.(m)
    })
  }

  async keyed(ms = 5000) {
    await waitFor(() => !!this.box, ms, () => 'the worker nonce')
  }

  async send(msg: TabMessage) {
    if (!this.box) throw new Error('no key yet')
    this.relay.send(await this.box.seal(JSON.stringify(msg)))
  }

  async hello(workspace: WorkspaceRef) {
    await this.keyed()
    await this.send({ type: 'hello', app: 'one', version: 'test', workspace })
  }

  private async answer(msg: Req) {
    const reply = (result: unknown) => this.send({ type: 'res', id: msg.id, ok: true, result })
    if (msg.op === 'next') {
      const match = this.queue.findIndex((t) => msg.repos.includes(t.repo) || (!t.repo && msg.docs))
      const task = match >= 0 ? this.queue.splice(match, 1)[0]! : null
      return reply({ task })
    }
    if (msg.op === 'heartbeat') {
      this.heartbeats++
      return reply({ ok: true })
    }
    if (msg.op === 'finish') {
      this.outcomes.push({ taskId: msg.taskId, stageId: msg.stageId, outcome: msg.outcome, finishId: msg.finishId })
      if (this.answerFinish) return reply({ ok: true })
    }
  }

  async run(task: TaskPayload, ms = 20_000): Promise<StageOutcome> {
    const before = this.outcomes.length
    this.queue.push(task)
    await this.send({ type: 'nudge' })
    await waitFor(() => this.outcomes.length > before, ms, () => JSON.stringify(this.messages.slice(-5)))
    return this.outcomes[this.outcomes.length - 1]!.outcome
  }

  request(body: Record<string, unknown>, ms = 20_000): Promise<Extract<WorkerMessage, { type: 'res' }>> {
    const id = `t${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer')), ms)
      this.pending.set(id, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      void this.send({ type: 'req', id, ...body } as TabMessage)
    })
  }

  next<T extends WorkerMessage['type']>(type: T, ms = 5000): Promise<Extract<WorkerMessage, { type: T }>> {
    return waitFor(() => this.messages.some((m) => m.type === type), ms, () => JSON.stringify(this.messages)).then(() => this.messages.find((m) => m.type === type) as Extract<WorkerMessage, { type: T }>)
  }
}
