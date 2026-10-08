/**
 * one-worker — cloud mode (docs/CODING.md § Cloud worker): instead of waiting for a tab on 127.0.0.1, the worker
 * dials the team server's relay (wss://<server>/coding/worker) with its worker token and keeps that connection up.
 * The relay pairs it with its member's One tab; what travels between them is end-to-end encrypted (box.ts,
 * link.ts) — this file only carries frames and reads the relay's own control frames.
 *
 *  - Refusals that mean "this file will never be let in again" end the worker (exit 2, so a service manager with
 *    RestartPreventExitStatus=2 does not restart it in a loop): the token was revoked or replaced by a newer
 *    download, the person left the workspace, the server has no relay, another copy of this file took over.
 *  - A viewer (for now): it tries again every 5 minutes. Everything else (network, a server restart, 5xx from a
 *    proxy): reconnect with backoff 1 → 30 s (± 20 %), forever; 429: after Retry-After.
 *  - No frame and no ping for 75 s: the connection is dead (a NAT dropped it) — reconnect.
 * Redirects are never followed; Node's own TLS checks apply (NODE_EXTRA_CA_CERTS for a private CA). HTTPS proxies
 * are not supported yet.
 */
import WebSocket, { type RawData } from 'ws'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { RELAY_CLOSE_AUTH, RELAY_CLOSE_FORBIDDEN, RELAY_MAX_FRAME, WORKER_CLOSE_REPLACED, WORKER_SUBPROTOCOL } from '../../../src/app/features/coding/protocol.ts'

export type CloudFatal = 'revoked' | 'replaced' | 'forbidden' | 'no-relay' | 'protocol' | 'workspace' | 'took-over'

export interface DialOptions {
  url: string
  token: string
  /** "team:<id>" — the relay's `ready` must name the same */
  workspace: string
  version: string
  log: (msg: string) => void
  onTabOpen: (s: number) => void
  onTabGone: (s: number, reason: string) => void
  /** a key or box frame of the paired tab */
  onFrame: (msg: Record<string, unknown>) => void
  /** the connection to the relay is gone (the tab with it) */
  onDown: () => void
  onFatal: (reason: CloudFatal, message: string) => void
  /** test seams: backoff steps (ms) and the watchdog */
  backoffMs?: number[]
  watchdogMs?: number
}

const BACKOFF = [1000, 2000, 5000, 10_000, 20_000, 30_000]
const VIEWER_RETRY_MS = 5 * 60_000
const WATCHDOG_MS = 75_000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export class CloudDial {
  private opts: DialOptions
  private ws: WebSocket | null = null
  private ready = false
  private stopped = false
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastSeen = 0
  /** an HTTP refusal of the last upgrade (read in the close handler) */
  private refusal: { status: number; body: string; retryAfter: number } | null = null
  private failures = 0
  readonly host: string

  constructor(opts: DialOptions) {
    this.opts = opts
    this.host = new URL(opts.url).host
  }

  /** Connected and greeted by the relay. */
  get open(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN
  }

  start(): void {
    this.stopped = false
    this.connect()
    this.watchdog = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastSeen > (this.opts.watchdogMs ?? WATCHDOG_MS)) {
        this.opts.log(`no word from ${this.host} for a while — reconnecting`)
        this.ws.terminate()
      }
    }, 5000)
    this.watchdog.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    if (this.watchdog) clearInterval(this.watchdog)
    const ws = this.ws
    this.ws = null
    this.ready = false
    if (!ws || ws.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve())
      ws.close(1000, 'worker stopped')
      setTimeout(() => {
        ws.terminate()
        resolve()
      }, 1500).unref?.()
    })
  }

  /** A frame to the relay (a box, a key, close-tab). False: not connected (the caller keeps or drops it). */
  send(frame: Record<string, unknown>): boolean {
    if (!this.open) return false
    this.ws!.send(JSON.stringify(frame))
    return true
  }

  private connect() {
    if (this.stopped) return
    this.refusal = null
    const ws = new WebSocket(this.opts.url, [WORKER_SUBPROTOCOL], {
      headers: { authorization: `Bearer ${this.opts.token}`, 'x-one-workspace': this.opts.workspace, 'user-agent': `one-worker/${this.opts.version}` },
      maxPayload: RELAY_MAX_FRAME,
      perMessageDeflate: false,
      handshakeTimeout: 15_000,
      followRedirects: false,
    })
    this.ws = ws
    this.ready = false
    ws.on('unexpected-response', (req: ClientRequest, res: IncomingMessage) => {
      const refusal = { status: res.statusCode ?? 0, body: '', retryAfter: Number(res.headers['retry-after']) || 0 }
      this.refusal = refusal
      const end = () => {
        req.destroy()
        ws.terminate()
      }
      res.setEncoding('utf8')
      res.on('data', (d: string) => (refusal.body = (refusal.body + d).slice(0, 300)))
      res.on('end', end)
      res.on('error', end)
      setTimeout(end, 2000).unref?.()
    })
    ws.on('open', () => {
      this.lastSeen = Date.now()
    })
    ws.on('ping', () => {
      this.lastSeen = Date.now()
    })
    ws.on('message', (data: RawData, binary: boolean) => {
      this.lastSeen = Date.now()
      if (binary || this.ws !== ws) return
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (!isObj(msg)) return
      if (msg.type === 'relay') return this.control(msg)
      if (this.ready) this.opts.onFrame(msg)
    })
    ws.on('error', (e: Error) => {
      if (this.failures++ < 3 && !this.refusal) this.opts.log(`cannot reach ${this.host}: ${e.message}`)
    })
    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return
      const wasReady = this.ready
      this.ws = null
      this.ready = false
      if (wasReady) this.opts.onDown()
      if (this.stopped) return
      this.closed(code, reason.toString())
    })
  }

  private control(msg: Record<string, unknown>) {
    if (msg.op === 'ready') {
      const ws = isObj(msg.workspace) ? msg.workspace : {}
      if (ws.id !== this.opts.workspace) return this.fatal('workspace', `${this.host} paired this worker with another workspace (${String(ws.id)}) than its file names (${this.opts.workspace}) — download the cloud worker again`)
      this.ready = true
      this.attempt = 0
      this.failures = 0
      const name = String(ws.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
      this.opts.log(`connected to ${this.host} for ${JSON.stringify(name)} — waiting for a One tab`)
      return
    }
    if (!this.ready) return
    const s = Number(msg.s)
    if (!Number.isSafeInteger(s) || s < 1) return
    if (msg.op === 'tab-open') this.opts.onTabOpen(s)
    else if (msg.op === 'tab-gone') this.opts.onTabGone(s, String(msg.reason ?? 'closed'))
  }

  private fatal(reason: CloudFatal, message: string) {
    if (this.stopped) return
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    if (this.watchdog) clearInterval(this.watchdog)
    this.ws?.terminate()
    this.opts.onFatal(reason, message)
  }

  /** Why the connection ended → stop for good, wait, or back off. */
  private closed(code: number, reason: string) {
    const r = this.refusal
    if (r) {
      const body = r.body.toLowerCase()
      if (r.status === 401) return this.fatal('revoked', `${this.host} refused this file's worker token: it was revoked, replaced by a newer download, or never used within a day of the download — download the cloud worker again (One → Settings → Coding worker → Cloud)`)
      if (r.status === 403 && body.includes('viewer')) return this.wait(VIEWER_RETRY_MS, `you are a viewer in this workspace now — viewers run no coding tasks; trying again every 5 minutes`)
      if (r.status === 403 && body.includes('workspace')) return this.fatal('workspace', `${this.host} says this worker's token belongs to another workspace — download the cloud worker again`)
      if (r.status === 403) return this.fatal('forbidden', `${this.host} refused this worker: the person it belongs to is no longer a member of the workspace`)
      if (r.status === 404) return this.fatal('no-relay', `${this.host} has no worker relay (an older One server, or CODING_RELAY=off) — ask its admin, or run the worker locally`)
      if (r.status === 400 || r.status === 426) return this.fatal('protocol', `${this.host} does not speak this worker's protocol (HTTP ${r.status}) — download the worker again from that server`)
      if (r.status === 429) return this.wait(Math.max(30, r.retryAfter) * 1000, `${this.host} asks to slow down — trying again in ${Math.max(30, r.retryAfter)} s`)
      if (this.attempt < 2) this.opts.log(`${this.host} answered HTTP ${r.status} — trying again`)
      return this.backoff()
    }
    if (code === RELAY_CLOSE_AUTH) {
      if (reason === 'replaced') return this.fatal('replaced', 'a newer download replaced this file\'s token — start the new one-worker-cloud.mjs instead (this one stops)')
      return this.fatal('revoked', `this worker's token was revoked (${reason || 'revoked'}) — download the cloud worker again to use it`)
    }
    if (code === RELAY_CLOSE_FORBIDDEN) {
      if (reason === 'role-changed' || reason === 'viewer') return this.wait(VIEWER_RETRY_MS, 'your role in this workspace changed (viewers run no coding tasks) — trying again every 5 minutes')
      return this.fatal('forbidden', `${this.host} let this worker go: ${reason || 'not allowed'} — the person it belongs to left the workspace, or it was deleted`)
    }
    if (code === WORKER_CLOSE_REPLACED) return this.fatal('took-over', 'another worker started with this file\'s token took over — run one copy only')
    if (this.attempt < 2 || code === 1001) this.opts.log(`the connection to ${this.host} ended (${code}${reason ? ` ${reason}` : ''}) — reconnecting`)
    this.backoff()
  }

  private wait(ms: number, message: string) {
    this.opts.log(message)
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => this.connect(), ms)
  }

  private backoff() {
    const steps = this.opts.backoffMs ?? BACKOFF
    const base = steps[Math.min(this.attempt, steps.length - 1)]!
    this.attempt++
    const ms = Math.round(base * (0.8 + Math.random() * 0.4))
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => this.connect(), ms)
  }
}
