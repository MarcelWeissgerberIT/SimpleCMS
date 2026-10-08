/**
 * Coding pipeline — how this tab reaches its worker. One protocol (protocol.ts), two ways:
 *
 *  - Local: ws://127.0.0.1:<port> — the worker on this computer.
 *  - Cloud (team workspaces, docs/CODING.md § Cloud worker): wss://<this server>/coding/tab — the team server
 *    pairs this tab with the member's cloud worker. Per pairing both sides send a fresh nonce; every protocol frame
 *    then travels sealed with a key derived from THIS device's pairing secret for that download (relayBox.ts).
 *    The tab sends nothing but its sealed hello until a box of the worker opens (the worker proved it holds the
 *    same secret); a box that does not open means another worker — `untrusted`, nothing more is sent. Frames are
 *    handled in order (WebCrypto is async); a close is handled after the frames before it. The tab tells the relay
 *    it is alive every 20 s (a frozen background tab stops, and the relay lets it go).
 */
import {
  RELAY_ALIVE_MS,
  RELAY_NONCE,
  RELAY_TAB_PATH,
  WORKER_SUBPROTOCOL,
  type TabMessage,
  type WorkerMessage,
} from './protocol'
import { BoxSession, newNonce, sessionKey } from './relayBox'
import type { RelayView } from './state'

export interface LinkHandlers {
  /** the link carries protocol frames now (local: the socket opened · cloud: this pairing's key is known) — say hello */
  open(): void
  message(m: WorkerMessage): void
  /** cloud: the relay's view of the member's worker changed */
  relay(view: RelayView): void
  /** cloud: the worker went away (the link to the relay stays open; pending requests are lost) */
  lost(): void
  /** cloud: the online worker is not one this device paired with (another device's download, or its box did not open) */
  untrusted(why: 'other-device' | 'worker-unknown'): void
  /** cloud: the relay dropped this many of the worker's events */
  dropped(n: number): void
  close(code: number, reason: string): void
}

export interface LinkHandle {
  readonly via: 'local' | 'cloud'
  send(m: TabMessage): void
  close(code: number, reason: string): void
}

/** The worker on this computer. */
export function openLocalLink(port: number, h: LinkHandlers): LinkHandle {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, WORKER_SUBPROTOCOL)
  ws.onopen = () => h.open()
  ws.onmessage = (e) => {
    let msg: WorkerMessage
    try {
      msg = JSON.parse(String(e.data)) as WorkerMessage
    } catch {
      return
    }
    h.message(msg)
  }
  ws.onclose = (e) => h.close(e.code, e.reason)
  return {
    via: 'local',
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
    },
    close: (code, reason) => {
      if (ws.readyState <= WebSocket.OPEN) ws.close(code, reason)
    },
  }
}

interface Pairing {
  s: number
  tn: string
  pair: string
  box: BoxSession | null
  /** a box of the worker opened: it holds this device's secret */
  proven: boolean
  done: boolean
  timer: number
}

/** A worker answer must arrive this long after the hello, else it is not ours. */
const PROOF_MS = 20_000

/**
 * The member's cloud worker through the team server's relay. `pairFor(token)`: this device's pairing secret for
 * the download with that token id (null: none — another device's worker).
 */
export function openCloudLink(serverWsId: string, pairFor: (token: string | null) => string | null, h: LinkHandlers): LinkHandle {
  const url = `${window.location.origin.replace(/^http/, 'ws')}${RELAY_TAB_PATH}?workspace=${encodeURIComponent(serverWsId)}`
  const ws = new WebSocket(url, WORKER_SUBPROTOCOL)
  let pairing: Pairing | null = null
  let inbox: Promise<void> = Promise.resolve()
  let outbox: Promise<void> = Promise.resolve()
  let alive = 0

  const end = (p: Pairing | null, lost: boolean) => {
    if (!p || p.done) return
    p.done = true
    window.clearTimeout(p.timer)
    if (pairing === p) pairing = null
    if (lost && p.box) h.lost()
  }

  const raw = (frame: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }

  async function handle(text: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'relay') {
      if (msg.op === 'dropped') return h.dropped(Math.max(0, Math.min(1_000_000, Number(msg.n) || 0)))
      if (msg.op !== 'worker') return
      const view: RelayView = { online: msg.online === true, registered: msg.registered === true, token: typeof msg.token === 'string' ? msg.token.slice(0, 64) : null }
      // any news about the worker ends the pairing before it (a reconnect, another copy, gone)
      end(pairing, true)
      h.relay(view)
      if (!view.online) return
      const pair = pairFor(view.token)
      if (!pair) return h.untrusted('other-device')
      const s = Number(msg.s)
      if (!Number.isSafeInteger(s) || s < 1) return
      const p: Pairing = { s, tn: newNonce(), pair, box: null, proven: false, done: false, timer: 0 }
      pairing = p
      raw({ type: 'key', s, n: p.tn })
      return
    }
    const p = pairing
    if (!p || p.done || msg.s !== p.s) return
    if (msg.type === 'key') {
      if (p.box || typeof msg.n !== 'string' || !RELAY_NONCE.test(msg.n)) return
      p.box = new BoxSession(await sessionKey(p.pair, p.tn, msg.n), p.s, 'tab')
      if (p.done) return
      // the worker must answer the hello with a box that opens
      p.timer = window.setTimeout(() => {
        if (!p.proven && !p.done) {
          end(p, false)
          h.untrusted('worker-unknown')
        }
      }, PROOF_MS)
      h.open()
      return
    }
    if (msg.type !== 'box' || !p.box) return
    let plain: string
    try {
      plain = await p.box.open(msg)
    } catch {
      end(p, false)
      // the first box does not open: not the worker this device paired with · later: a broken session
      if (!p.proven) return h.untrusted('worker-unknown')
      return ws.close(4000, 'bad box')
    }
    if (p.done) return
    p.proven = true
    window.clearTimeout(p.timer)
    let m: WorkerMessage
    try {
      m = JSON.parse(plain) as WorkerMessage
    } catch {
      return
    }
    h.message(m)
  }

  ws.onopen = () => {
    alive = window.setInterval(() => raw({ type: 'relay', op: 'alive' }), RELAY_ALIVE_MS)
  }
  ws.onmessage = (e) => {
    const text = String(e.data)
    inbox = inbox.then(() => handle(text)).catch(() => {})
  }
  ws.onclose = (e) => {
    window.clearInterval(alive)
    // after the frames that came before it (a refusal is a box, then the close)
    inbox = inbox.then(() => {
      end(pairing, false)
      h.close(e.code, e.reason)
    })
  }

  return {
    via: 'cloud',
    send(m) {
      const p = pairing
      if (!p?.box || p.done) return
      // nothing but the hello before the worker proved itself
      if (!p.proven && m.type !== 'hello') return
      const text = JSON.stringify(m)
      outbox = outbox
        .then(async () => {
          const box = await p.box!.seal(text)
          if (!p.done && pairing === p) raw(box)
        })
        .catch(() => {})
    },
    close(code, reason) {
      window.clearInterval(alive)
      if (ws.readyState <= WebSocket.OPEN) ws.close(code, reason)
    },
  }
}
