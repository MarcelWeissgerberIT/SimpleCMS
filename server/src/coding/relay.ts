/**
 * Coding relay (docs/CLOUD.md § Coding relay): a member's cloud worker dials /coding/worker with its worker
 * token; the member's One tab opens /coding/tab with its session. The relay pairs exactly one tab with one
 * worker per (workspace, member) and passes frames between them. The tab ⇄ worker protocol travels end to end
 * encrypted with a key only the downloading browser and the worker file hold (frames.ts): the relay forwards
 * sealed boxes it can neither read nor forge, and keeps none of them.
 *
 *  - The newest tab of the member wins (the older one gets 4001), the newest connection of a token wins (4001).
 *    A close handler acts only while its socket is still the pair's current side.
 *  - A pending token (a fresh download) becomes the member's active one on its first connection; only then is
 *    the older token revoked and its worker closed ("replaced", 4401).
 *  - Load: per socket 2,000 frames / 128 MiB per 10 s. Over it, the worker's events (`k: 'e'`) are dropped and
 *    the tab is told how many; a tab or a worker far over it (8,000 / 512 MiB) is closed (1008). A destination whose
 *    send buffer passes 32 MiB is closed (1013) — never the healthy source; all buffers together stay below 256 MiB.
 *  - Liveness: WebSocket pings (crossws, CODING_PING_MS); a tab must send `alive` (a frozen background tab
 *    stops) or it is let go (4408); a sweep re-checks sessions, memberships and tokens every minute.
 *
 * Built on crossws (Hocuspocus' own WebSocket layer) — no WebSocket library of our own.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import nodeAdapter from 'crossws/adapters/node'
import type { Message, Peer } from 'crossws'
import { cookieFromHeader, SESSION_COOKIE, type Sessions } from '../auth/sessions.ts'
import type { RateLimiter } from '../auth/ratelimit.ts'
import type { Config } from '../config.ts'
import type { CloseReason, CodingControl } from '../context.ts'
import { isSameOrigin } from '../http/security.ts'
import { ipOfUpgrade } from '../http/util.ts'
import type { Logger } from '../log.ts'
import { isWorkerTokenShape, type Repo } from '../repo.ts'
import { MINUTE, safeEqual } from '../tokens.ts'
import { checkFrame, RELAY_CLOSE_AUTH, RELAY_CLOSE_FORBIDDEN, RELAY_CLOSE_IDLE, RELAY_MAX_FRAME, RELAY_TAB_PATH, RELAY_WORKER_PATH, WORKER_SUBPROTOCOL } from './frames.ts'

const WINDOW_MS = 10_000
const SOFT_FRAMES = 2000
const SOFT_BYTES = 128 * 1024 * 1024
const HARD_FRAMES = 8000
const HARD_BYTES = 512 * 1024 * 1024
const DEST_BUFFER_MAX = 32 * 1024 * 1024
const TOTAL_BUFFER_MAX = 256 * 1024 * 1024
const BAD_AUTH_PER_MIN = 30
const WORKER_CONNECTS_PER_MIN = 30
const TAB_CONNECTS_PER_MIN = 60
const ID = /^[A-Za-z0-9_-]{1,64}$/

type Gate = { kind: 'tab'; workspaceId: string; userId: string; sessionId: string } | { kind: 'worker'; workspaceId: string; userId: string; tokenId: string }

interface Window {
  start: number
  frames: number
  bytes: number
}

interface TabSide {
  kind: 'tab'
  peer: Peer
  pair: Pair
  sessionId: string
  lastAlive: number
  win: Window
  /** why the relay let it go (tab-gone's reason) */
  gone?: 'closed' | 'ended' | 'idle'
}

interface WorkerSide {
  kind: 'worker'
  peer: Peer
  pair: Pair
  tokenId: string
  since: number
  win: Window
}

type Side = TabSide | WorkerSide

interface Pair {
  key: string
  workspaceId: string
  userId: string
  tab: TabSide | null
  worker: WorkerSide | null
  /** the pairing number: rises whenever a tab or a worker joins — frames of an older pairing are dropped */
  s: number
  dropped: number
  droppedTimer: ReturnType<typeof setTimeout> | null
}

export interface CodingRelay extends CodingControl {
  /** Is this upgrade for the relay (/coding/tab, /coding/worker)? */
  owns(url: string | undefined): boolean
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  destroy(): Promise<void>
}

export function createCodingRelay(deps: { config: Config; log: Logger; repo: Repo; sessions: Sessions; limiter: RateLimiter }): CodingRelay {
  const { config, log, repo, sessions, limiter } = deps
  const pairs = new Map<string, Pair>()
  const sides = new Map<Peer, Side>()
  const gates = new WeakMap<object, Gate>()

  const warn = (msg: string, fields: Record<string, unknown>) => {
    // never a token, a frame or a task title — and at most 20 lines a minute
    if (!limiter.hit('coding:log', 20, MINUTE)) log.warn(msg, fields)
  }

  const pairOf = (workspaceId: string, userId: string): Pair => {
    const key = `${workspaceId}\n${userId}`
    let pair = pairs.get(key)
    if (!pair) {
      pair = { key, workspaceId, userId, tab: null, worker: null, s: 0, dropped: 0, droppedTimer: null }
      pairs.set(key, pair)
    }
    return pair
  }

  const send = (side: Side | null, msg: unknown) => {
    if (!side) return
    try {
      side.peer.send(JSON.stringify(msg))
    } catch {
      /* closing */
    }
  }

  const shut = (peer: Peer, code: number, reason: string) => {
    try {
      peer.close(code, reason)
    } catch {
      /* gone */
    }
  }
  const close = (side: Side, code: number, reason: string) => shut(side.peer, code, reason)

  const registered = (pair: Pair) => repo.codingWorkers(pair.workspaceId, pair.userId).length > 0

  /** The tab's view of its worker. */
  const tellTab = (pair: Pair) => send(pair.tab, { type: 'relay', op: 'worker', online: !!pair.worker, registered: registered(pair), token: pair.worker?.tokenId ?? null, s: pair.s })

  /** Both sides are there: a new pairing (fresh nonces on both ends). */
  const pairUp = (pair: Pair) => {
    pair.s += 1
    tellTab(pair)
    if (pair.tab && pair.worker) send(pair.worker, { type: 'relay', op: 'tab-open', s: pair.s })
  }

  const forget = (pair: Pair) => {
    if (pair.tab || pair.worker) return
    if (pair.droppedTimer) clearTimeout(pair.droppedTimer)
    pairs.delete(pair.key)
  }

  /* ------------------------------------------------------------------ crossws */

  const adapter = nodeAdapter({
    idleTimeout: Math.max(0.05, config.codingPingMs / 1000),
    serverOptions: { maxPayload: RELAY_MAX_FRAME, perMessageDeflate: false, clientTracking: false },
    hooks: {
      upgrade: (request) => {
        const gate = gates.get(request as object)
        if (!gate) return new Response('Forbidden', { status: 403 })
        return { protocol: WORKER_SUBPROTOCOL, context: { gate } }
      },
      open: (peer) => {
        const gate = (peer.context as { gate?: Gate }).gate
        if (!gate) return shut(peer, 1008, 'no gate')
        if (gate.kind === 'worker') adoptWorker(peer, gate)
        else adoptTab(peer, gate)
      },
      message: (peer, message) => receive(peer, message),
      close: (peer, details) => gone(peer, details.code ?? 1005),
      error: () => {
        /* the close hook follows */
      },
    },
  })

  function adoptWorker(peer: Peer, gate: Extract<Gate, { kind: 'worker' }>) {
    // the token or the membership may have changed while the socket was upgrading
    if (!repo.codingWorkerLive(gate.tokenId)) return shut(peer, RELAY_CLOSE_AUTH, 'revoked')
    const role = repo.memberRole(gate.workspaceId, gate.userId)
    if (!role || role === 'viewer') return shut(peer, RELAY_CLOSE_FORBIDDEN, role ? 'viewer' : 'forbidden')
    // a fresh download's first connection: it becomes the member's token, the older one goes
    const { activated, replaced } = repo.activateCodingWorker(gate.tokenId)
    const pair = pairOf(gate.workspaceId, gate.userId)
    const side: WorkerSide = { kind: 'worker', peer, pair, tokenId: gate.tokenId, since: Date.now(), win: { start: Date.now(), frames: 0, bytes: 0 } }
    sides.set(peer, side)
    const old = pair.worker
    pair.worker = side
    if (old) {
      log.info('coding worker replaced', { workspace: gate.workspaceId, user: gate.userId, worker: old.tokenId })
      // the same token twice: run one copy only (4001) · an older download's token: it is gone for good (4401)
      close(old, old.tokenId === gate.tokenId ? 4001 : RELAY_CLOSE_AUTH, 'replaced')
    }
    for (const id of replaced) control.closeWorker(id, 'replaced')
    repo.touchCodingWorker(gate.tokenId)
    send(side, { type: 'relay', op: 'ready', workspace: { id: `team:${gate.workspaceId}`, name: repo.workspaceById(gate.workspaceId)?.name ?? 'Workspace' } })
    pairUp(pair)
    log.info('coding worker connected', { workspace: gate.workspaceId, user: gate.userId, worker: gate.tokenId, activated: activated || undefined, replaced: replaced.length || undefined })
  }

  function adoptTab(peer: Peer, gate: Extract<Gate, { kind: 'tab' }>) {
    const role = repo.memberRole(gate.workspaceId, gate.userId)
    // a signed-in caller who may not run tasks here learns why (a non-member and a missing workspace look the same)
    if (!role) return shut(peer, RELAY_CLOSE_FORBIDDEN, 'forbidden')
    if (role === 'viewer') return shut(peer, RELAY_CLOSE_FORBIDDEN, 'viewer')
    if (!sessions.isValid(gate.sessionId)) return shut(peer, RELAY_CLOSE_AUTH, 'session-ended')
    const pair = pairOf(gate.workspaceId, gate.userId)
    const side: TabSide = { kind: 'tab', peer, pair, sessionId: gate.sessionId, lastAlive: Date.now(), win: { start: Date.now(), frames: 0, bytes: 0 } }
    sides.set(peer, side)
    const old = pair.tab
    pair.tab = side
    if (old) {
      send(pair.worker, { type: 'relay', op: 'tab-gone', s: pair.s, reason: 'replaced' })
      close(old, 4001, 'replaced')
    }
    pairUp(pair)
  }

  /** Over the per-socket budget? 'soft': drop what may be dropped · 'hard': close it. */
  function budget(side: Side, bytes: number): 'ok' | 'soft' | 'hard' {
    const now = Date.now()
    if (now - side.win.start > WINDOW_MS) side.win = { start: now, frames: 0, bytes: 0 }
    side.win.frames += 1
    side.win.bytes += bytes
    if (side.win.frames > HARD_FRAMES || side.win.bytes > HARD_BYTES) return 'hard'
    if (side.win.frames > SOFT_FRAMES || side.win.bytes > SOFT_BYTES) return 'soft'
    return 'ok'
  }

  /** To the other side — unless its send buffer is full: then the slow destination goes, not the source. */
  function forward(dest: Side, text: string) {
    if (dest.peer.bufferedAmount > DEST_BUFFER_MAX) {
      if (dest.kind === 'tab') dest.gone = 'closed'
      warn('coding relay: slow side closed', { workspace: dest.pair.workspaceId, side: dest.kind })
      return close(dest, 1013, 'slow')
    }
    try {
      dest.peer.send(text)
    } catch {
      /* closing */
    }
  }

  function noteDropped(pair: Pair) {
    pair.dropped += 1
    pair.droppedTimer ??= setTimeout(() => {
      pair.droppedTimer = null
      const n = pair.dropped
      pair.dropped = 0
      if (n) send(pair.tab, { type: 'relay', op: 'dropped', n })
    }, 1000)
  }

  function receive(peer: Peer, message: Message) {
    const side = sides.get(peer)
    if (!side) return
    const raw = message.rawData
    if (typeof raw !== 'string') return close(side, 1003, 'text frames only')
    const load = budget(side, raw.length)
    const frame = checkFrame(raw, side.kind)
    if (!frame) {
      warn('coding relay: frame not allowed', { side: side.kind, workspace: side.pair.workspaceId })
      return close(side, 1008, 'frame not allowed')
    }
    const pair = side.pair
    if (side.kind === 'tab') {
      if (pair.tab !== side) return
      if (frame.kind === 'alive') {
        side.lastAlive = Date.now()
        return
      }
      // a tab sends no droppable frames: under the soft budget it is only forwarded (the tab paces big uploads itself,
      // the destination's buffer check guards the worker) — far over it, it is closed
      if (load === 'hard') return close(side, 1008, 'rate')
      if ((frame.kind === 'key' || frame.kind === 'box') && pair.worker && frame.s === pair.s) forward(pair.worker, frame.text)
      return
    }
    if (pair.worker !== side) return
    if (load === 'hard') return close(side, 1008, 'rate')
    if (frame.kind === 'close-tab') {
      if (pair.tab && frame.s === pair.s) {
        pair.tab.gone = 'closed'
        close(pair.tab, frame.code, frame.reason || 'refused')
      }
      return
    }
    if (frame.kind === 'alive' || !pair.tab || frame.s !== pair.s) return
    if (load === 'soft' && frame.kind === 'box' && frame.droppable) return noteDropped(pair)
    forward(pair.tab, frame.text)
  }

  function gone(peer: Peer, code: number) {
    const side = sides.get(peer)
    if (!side) return
    sides.delete(peer)
    const pair = side.pair
    if (side.kind === 'tab') {
      // only the current tab unpairs (a replaced one was already announced)
      if (pair.tab === side) {
        pair.tab = null
        send(pair.worker, { type: 'relay', op: 'tab-gone', s: pair.s, reason: side.gone ?? 'closed' })
      }
    } else if (pair.worker === side) {
      pair.worker = null
      tellTab(pair)
      repo.touchCodingWorker(side.tokenId)
      log.info('coding worker disconnected', { workspace: pair.workspaceId, worker: side.tokenId, code })
    }
    forget(pair)
  }

  /* ------------------------------------------------------------------ the upgrade gate */

  function reject(socket: Duplex, status: number, text: string, headers: Record<string, string> = {}) {
    const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
    socket.end(`HTTP/1.1 ${status} ${text.split(':')[0]}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n${extra}\r\n${text}`)
    setTimeout(() => socket.destroy(), 1000).unref()
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, gate: Gate) {
    const request = { url: `http://relay${req.url ?? '/'}`, headers: new Headers(), context: {} }
    gates.set(request, gate)
    void adapter.handleUpgrade(req, socket, head, request as unknown as Request).catch(() => socket.destroy())
  }

  function upgradeWorker(req: IncomingMessage, socket: Duplex, head: Buffer, offered: boolean) {
    const ip = ipOfUpgrade(req, config)
    const refuse = (status: number, text: string, why: string, headers?: Record<string, string>) => {
      warn('coding relay refused', { path: RELAY_WORKER_PATH, reason: why })
      reject(socket, status, text, headers)
    }
    // a worker is never a web page
    if (req.headers.origin !== undefined) return refuse(403, 'Forbidden: origin', 'origin')
    if (!offered) return refuse(400, 'Bad Request: protocol', 'protocol')
    const secret = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? ''))?.[1]
    const row = isWorkerTokenShape(secret) ? repo.codingWorkerBySecret(secret) : undefined
    // the lookup is by HMAC; compare the digests in constant time too
    if (!row || !secret || !safeEqual(row.token_hash, repo.hash(secret))) {
      const wait = limiter.hit(`coding:bad:${ip}`, BAD_AUTH_PER_MIN, MINUTE)
      return wait ? refuse(429, 'Too Many Requests', 'bad token (limited)', { 'Retry-After': String(wait) }) : refuse(401, 'Unauthorized', 'bad token')
    }
    const role = repo.memberRole(row.workspace_id, row.user_id)
    if (!role) return refuse(403, 'Forbidden: membership', 'no member')
    if (role === 'viewer') return refuse(403, 'Forbidden: viewer', 'viewer')
    if (req.headers['x-one-workspace'] !== `team:${row.workspace_id}`) return refuse(403, 'Forbidden: workspace', 'workspace')
    const wait = limiter.hit(`coding:worker:${row.id}`, WORKER_CONNECTS_PER_MIN, MINUTE)
    if (wait) return refuse(429, 'Too Many Requests', 'reconnecting too often', { 'Retry-After': String(wait) })
    upgrade(req, socket, head, { kind: 'worker', workspaceId: row.workspace_id, userId: row.user_id, tokenId: row.id })
  }

  function upgradeTab(req: IncomingMessage, socket: Duplex, head: Buffer, offered: boolean, url: URL) {
    const refuse = (status: number, text: string, why: string, headers?: Record<string, string>) => {
      warn('coding relay refused', { path: RELAY_TAB_PATH, reason: why })
      reject(socket, status, text, headers)
    }
    // browsers always send Origin on a WebSocket: it must be this server's
    if (!req.headers.origin || !isSameOrigin(req.headers.origin, req.headers.host, config.publicUrl)) return refuse(403, 'Forbidden: origin', 'origin')
    if (!offered) return refuse(400, 'Bad Request: protocol', 'protocol')
    const auth = sessions.resolve(cookieFromHeader(req.headers.cookie, SESSION_COOKIE))
    if (!auth) return refuse(401, 'Unauthorized', 'no session')
    const workspaceId = url.searchParams.get('workspace') ?? ''
    if (!ID.test(workspaceId)) return refuse(400, 'Bad Request: workspace', 'workspace')
    const wait = limiter.hit(`coding:tab:${auth.session.id}`, TAB_CONNECTS_PER_MIN, MINUTE)
    if (wait) return refuse(429, 'Too Many Requests', 'reconnecting too often', { 'Retry-After': String(wait) })
    upgrade(req, socket, head, { kind: 'tab', workspaceId, userId: auth.user.id, sessionId: auth.session.id })
  }

  /* ------------------------------------------------------------------ timers */

  // a tab that stopped saying `alive` (frozen in the background) is let go; buffers stay bounded
  const idleMs = Math.max(1000, config.codingPingMs * 6)
  const watch = setInterval(
    () => {
      const now = Date.now()
      let total = 0
      let biggest: Side | null = null
      for (const pair of pairs.values()) {
        if (pair.tab && now - pair.tab.lastAlive > idleMs) {
          pair.tab.gone = 'idle'
          close(pair.tab, RELAY_CLOSE_IDLE, 'idle')
        }
        for (const side of [pair.tab, pair.worker]) {
          if (!side) continue
          const n = side.peer.bufferedAmount
          total += n
          if (!biggest || n > biggest.peer.bufferedAmount) biggest = side
        }
      }
      if (total > TOTAL_BUFFER_MAX && biggest) {
        warn('coding relay: buffers full', { total })
        close(biggest, 1013, 'slow')
      }
    },
    Math.min(5000, Math.max(100, config.codingPingMs)),
  )
  watch.unref()

  // revoked or expired sessions (logout elsewhere, CLI revoke-sessions), lost memberships, revoked tokens (CLI revoke-workers)
  const sweep = setInterval(
    () => {
      for (const pair of [...pairs.values()]) {
        const role = repo.memberRole(pair.workspaceId, pair.userId)
        const allowed = !!role && role !== 'viewer'
        if (pair.tab) {
          if (!sessions.isValid(pair.tab.sessionId)) {
            pair.tab.gone = 'ended'
            close(pair.tab, RELAY_CLOSE_AUTH, 'session-ended')
          } else if (!allowed) {
            pair.tab.gone = 'ended'
            close(pair.tab, RELAY_CLOSE_FORBIDDEN, role ? 'viewer' : 'membership-revoked')
          }
        }
        if (pair.worker) {
          if (!repo.codingWorkerLive(pair.worker.tokenId)) close(pair.worker, RELAY_CLOSE_AUTH, 'revoked')
          else if (!allowed) close(pair.worker, RELAY_CLOSE_FORBIDDEN, role ? 'viewer' : 'membership-revoked')
        }
      }
    },
    Math.min(60_000, Math.max(200, Math.round(config.codingPingMs * 2.4))),
  )
  sweep.unref()

  /* ------------------------------------------------------------------ control (REST hooks) */

  const closeWhere = (match: (pair: Pair) => boolean, which: 'both' | 'tab', code: number, reason: string) => {
    let n = 0
    for (const pair of [...pairs.values()]) {
      if (!match(pair)) continue
      if (pair.tab) {
        pair.tab.gone = 'ended'
        close(pair.tab, code, reason)
        n++
      }
      if (which === 'both' && pair.worker) {
        close(pair.worker, code, reason)
        n++
      }
    }
    if (n) log.info('coding relay connections closed', { reason, count: n })
    return n
  }

  const control: CodingControl = {
    closeUser: (userId, workspaceId, reason: CloseReason) => closeWhere((p) => p.userId === userId && p.workspaceId === workspaceId, 'both', RELAY_CLOSE_FORBIDDEN, reason),
    closeWorkspace: (workspaceId, reason) => closeWhere((p) => p.workspaceId === workspaceId, 'both', RELAY_CLOSE_FORBIDDEN, reason),
    closeSession: (sessionId, reason) => closeWhere((p) => p.tab?.sessionId === sessionId, 'tab', RELAY_CLOSE_AUTH, reason),
    closeWorker(workerId, reason) {
      let n = 0
      for (const pair of pairs.values()) {
        if (pair.worker?.tokenId !== workerId) continue
        close(pair.worker, RELAY_CLOSE_AUTH, reason)
        n++
      }
      if (n) log.info(`coding worker ${reason}`, { worker: workerId })
      return n
    },
    refresh(workspaceId, userId) {
      // only while no worker is connected does `registered` change what the tab shows; an online worker's pairing is
      // never announced again (the tab would take it for a new one) — a worker that goes is announced by gone()
      const pair = pairs.get(`${workspaceId}\n${userId}`)
      if (pair?.tab && !pair.worker) tellTab(pair)
    },
    online(workspaceId) {
      const out = new Map<string, { since: number; tab: boolean }>()
      for (const pair of pairs.values()) if (pair.workspaceId === workspaceId && pair.worker) out.set(pair.worker.tokenId, { since: pair.worker.since, tab: !!pair.tab })
      return out
    },
  }

  return {
    ...control,
    owns(url) {
      const path = (url ?? '/').split('?')[0]
      return path === RELAY_TAB_PATH || path === RELAY_WORKER_PATH
    },
    handleUpgrade(req, socket, head) {
      socket.on('error', () => socket.destroy())
      if (!config.codingRelay) return reject(socket, 404, 'Not Found: relay off')
      const url = new URL(req.url ?? '/', 'http://relay')
      const offered = String(req.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim())
        .includes(WORKER_SUBPROTOCOL)
      if (url.pathname === RELAY_WORKER_PATH) return upgradeWorker(req, socket, head, offered)
      if (url.pathname === RELAY_TAB_PATH) return upgradeTab(req, socket, head, offered, url)
      reject(socket, 404, 'Not Found')
    },
    async destroy() {
      clearInterval(watch)
      clearInterval(sweep)
      for (const pair of pairs.values()) if (pair.droppedTimer) clearTimeout(pair.droppedTimer)
      for (const side of [...sides.values()]) close(side, 1001, 'server stopping')
      await adapter.close?.(1001, 'server stopping')
    },
  }
}
