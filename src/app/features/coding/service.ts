/**
 * Coding pipeline — the tab side of the worker link (features/coding/protocol.ts).
 *
 *  - Switched on per device (a download of the worker switches it on; Settings → Coding worker): connect to
 *    ws://127.0.0.1:<port> (subprotocol one-worker.v1), say hello with this workspace's id (the same ids as
 *    the MCP bridge) and this device's pairing secret for it (download.ts), retry with backoff while no
 *    worker runs. A worker bound to another workspace (or none, or a download paired with another browser)
 *    refuses: no retry until the person asks. A newer tab of the same workspace takes over (4001).
 *  - "Change repositories" sends `open-setup`: the worker opens its local setup page; One never sees it.
 *  - The worker asks: `next` (tasks.ts picks and claims one), `heartbeat`, `finish` (the outcome into the
 *    row and the page); it streams `event`s (log lines, git state, notes, questions) into this device's log.
 *  - The person acts: Stop and the fixed git verbs go to the worker as requests; everything else is a store
 *    write that nudges the worker.
 *  - The tab only ever serves its own workspace: switching workspace drops the link (and reconnects as the
 *    new one, which a worker of the old one refuses).
 */
import { useWorkspace, pageChanges } from '../../store/store'
import { t } from '../../i18n'
import { BRAND } from '@/shared/brand'
import { currentWorkspace, workspaceInfo } from '../mcp/identity'
import {
  WORKER_CLOSE_REFUSED,
  WORKER_CLOSE_REPLACED,
  WORKER_SUBPROTOCOL,
  type GitResult,
  type GitVerb,
  type OpenSetupResult,
  type TabMessage,
  type WorkerMessage,
  type WorkspaceRef,
} from './protocol'
import { DEFAULT_CODING, CODING_STORAGE_KEY, loadCodingSettings, saveCodingSettings, useCoding, validPort, type CodingSettings } from './state'
import { appendLog, patchTask, flushLogs, loadTask } from './local'
import { codingDbId, addRepoOptions, codingProps } from './schema'
import { finishStage, heartbeat, pickNext, setNudge, taskContext, gitSummary } from './tasks'
import { startTrustWatch } from './trust'
import { useCloud } from '../../cloud'

const set = useCoding.setState
const get = useCoding.getState

/* ------------------------------------------------------------------ settings */

function patchSettings(patch: Partial<CodingSettings>) {
  const s = get()
  const next: CodingSettings = { enabled: s.enabled, port: s.port, pairs: s.pairs, ...patch }
  saveCodingSettings(next)
  set(next)
}

/** Look for the worker every 1.5 s until then (after a download: the person is about to start it). */
let fastUntil = 0

/**
 * A worker was downloaded for `workspaceId` (download.ts): keep its pairing secret (replacing the last one),
 * switch the link on and look for it often for ten minutes. A connected worker stays connected.
 */
export function pairDownloaded(workspaceId: string, secret: string) {
  patchSettings({ enabled: true, pairs: { ...get().pairs, [workspaceId]: { secret, at: Date.now() } } })
  fastUntil = Date.now() + 10 * 60_000
  if (get().conn === 'connected') return
  disconnect(false)
  attempt = 0
  failingSince = 0
  connect()
}

/** "Connect to a coding worker on this computer". */
export function setCodingEnabled(on: boolean) {
  patchSettings({ enabled: on })
  if (on) {
    attempt = 0
    connect()
  } else disconnect()
}

export function setCodingPort(port: number) {
  const p = validPort(port)
  if (!p || p === get().port) return
  patchSettings({ port: p })
  if (get().enabled) reconnect()
}

/** "Retry now" / "Use this tab". */
export function reconnect() {
  if (!get().enabled) return setCodingEnabled(true)
  disconnect(false)
  attempt = 0
  connect()
}

/* ------------------------------------------------------------------ connection */

let socket: WebSocket | null = null
let retryTimer = 0
let attempt = 0
let failingSince = 0
let seq = 0
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>()
/** the workspace this link said hello as */
let helloAs: string | null = null

const BACKOFF = [600, 1200, 2500, 5000, 8000, 12_000]
const delay = () => (Date.now() < fastUntil ? 1500 : failingSince && Date.now() - failingSince > 120_000 ? 30_000 : BACKOFF[Math.min(attempt, BACKOFF.length - 1)])

function me(): WorkspaceRef {
  const { role: _role, ...info } = workspaceInfo()
  return info
}

function send(msg: TabMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

function schedule() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || socket) return
  retryTimer = window.setTimeout(connect, delay())
}

function connect() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || socket) return
  // between workspaces (loading, signed out): wait
  if (!currentWorkspace()) {
    set({ conn: 'waiting' })
    return schedule()
  }
  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${get().port}`, WORKER_SUBPROTOCOL)
  } catch {
    set({ conn: 'blocked' })
    return
  }
  socket = ws
  let refused = false
  set((s) => ({ conn: attempt === 0 && s.conn !== 'waiting' ? 'connecting' : 'waiting' }))
  ws.onopen = () => {
    const self = me()
    helloAs = self.id
    // this device's pairing with the worker downloaded for this workspace (a worker.json worker ignores it)
    const pair = get().pairs[self.id]?.secret
    ws.send(JSON.stringify({ type: 'hello', app: 'one', version: BRAND.version, workspace: self, ...(pair ? { pair } : {}) } satisfies TabMessage))
  }
  ws.onmessage = (e) => {
    let msg: WorkerMessage
    try {
      msg = JSON.parse(String(e.data)) as WorkerMessage
    } catch {
      return
    }
    if (msg.type === 'refused') {
      refused = true
      set({ refused: msg.reason === 'unbound' || msg.reason === 'pair' ? msg.reason : 'workspace', refusedPaired: msg.paired === true })
      return
    }
    void receive(msg)
  }
  ws.onclose = (e) => {
    if (socket !== ws) return
    socket = null
    helloAs = null
    for (const p of pending.values()) {
      window.clearTimeout(p.timer)
      p.reject(new Error(t('features.coding.err.gone')))
    }
    pending.clear()
    set({ worker: null, busy: [] })
    if (!get().enabled) return set({ conn: 'off' })
    if (refused || e.code === WORKER_CLOSE_REFUSED) return set({ conn: 'refused' })
    if (e.code === WORKER_CLOSE_REPLACED) return set({ conn: 'replaced' })
    const was = get().conn === 'connected'
    if (was) {
      attempt = 0
      failingSince = 0
    } else {
      attempt += 1
      failingSince ||= Date.now()
    }
    set({ conn: 'waiting' })
    schedule()
  }
}

function disconnect(off = true) {
  window.clearTimeout(retryTimer)
  const ws = socket
  socket = null
  helloAs = null
  if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, off ? 'switched off' : 'reconnecting')
  set({ conn: off ? 'off' : 'connecting', worker: null, busy: [], refused: null, refusedPaired: false })
}

/* ------------------------------------------------------------------ messages */

function reply(id: string, result: unknown) {
  send({ type: 'res', id, ok: true, result })
}
function fail(id: string, error: string) {
  send({ type: 'res', id, ok: false, error })
}

async function receive(msg: WorkerMessage) {
  switch (msg.type) {
    case 'welcome': {
      attempt = 0
      failingSince = 0
      const { type: _type, ...info } = msg
      set({ conn: 'connected', refused: null, worker: info, busy: info.busy ?? [], spentToday: info.spentToday ?? 0 })
      const dbId = codingDbId()
      if (dbId) addRepoOptions(dbId, (info.repos ?? []).map((r) => r.name))
      // tasks of this worker that were running when the link dropped: still running there
      for (const b of info.busy ?? []) void patchTask(b.taskId, { state: 'running', stageId: b.stageId })
      return
    }
    case 'status':
      set({ busy: msg.busy ?? [], spentToday: msg.spentToday ?? 0 })
      return
    case 'res': {
      const p = pending.get(msg.id)
      if (!p) return
      window.clearTimeout(p.timer)
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error))
      return
    }
    case 'event':
      return onEvent(msg)
    case 'req':
      return onRequest(msg)
  }
}

/** The worker's events belong to tasks of this workspace's Coding database only. */
function ownTask(taskId: string): boolean {
  return !!taskContext(taskId)
}

function onEvent(msg: Extract<WorkerMessage, { type: 'event' }>) {
  const taskId = String(msg.taskId)
  if (!ownTask(taskId)) return
  switch (msg.kind) {
    case 'log':
      appendLog(taskId, (Array.isArray(msg.lines) ? msg.lines : []).filter((l) => l && typeof l.s === 'string').map((l) => ({ t: Number(l.t) || Date.now(), k: l.k, s: l.s.slice(0, 8000) })))
      return
    case 'git': {
      void patchTask(taskId, { git: msg.git })
      const ctx = taskContext(taskId)
      if (ctx?.props.git && msg.git) useWorkspace.getState().setRowProperty(taskId, ctx.props.git, gitSummary(msg.git))
      return
    }
    case 'note':
      return
    case 'question':
      void patchTask(taskId, { question: String(msg.text).slice(0, 4000) })
      return
  }
}

async function onRequest(msg: Extract<WorkerMessage, { type: 'req' }>) {
  const id = String(msg.id)
  // the tab answers only while it shows the workspace it said hello as
  const now = currentWorkspace()
  if (!now || now.id !== helloAs) return fail(id, 'One switched workspace')
  try {
    switch (msg.op) {
      case 'next': {
        const name = get().worker?.name ?? String(msg.worker ?? '')
        const task = await pickNext(Array.isArray(msg.repos) ? msg.repos.map(String) : [], name)
        return reply(id, { task })
      }
      case 'heartbeat':
        heartbeat(Array.isArray(msg.taskIds) ? msg.taskIds.map(String) : [], get().worker?.name ?? '')
        return reply(id, { ok: true })
      case 'finish':
        await finishStage(String(msg.taskId), String(msg.stageId), msg.outcome ?? { status: 'failed', error: 'no outcome' })
        void flushLogs()
        return reply(id, { ok: true })
      default:
        return fail(id, 'unknown request')
    }
  } catch (e) {
    console.warn('[one] coding: a worker request failed', e)
    return fail(id, e instanceof Error ? e.message : String(e))
  }
}

/** Ask the worker (Stop, git verbs). */
function request(body: Omit<Extract<TabMessage, { type: 'req' }>, 'id' | 'type'>, timeoutMs = 120_000): Promise<unknown> {
  if (!socket || socket.readyState !== WebSocket.OPEN || get().conn !== 'connected') return Promise.reject(new Error(t('features.coding.err.noWorker')))
  const id = `t${++seq}`
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(t('features.coding.err.timeout')))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    socket!.send(JSON.stringify({ type: 'req', id, ...body }))
  })
}

/**
 * "Change repositories": the worker opens its setup page on its own screen. One never learns the page's
 * address or key — it only hears whether a browser opened.
 */
export async function openWorkerSetup(): Promise<OpenSetupResult> {
  const res = (await request({ op: 'open-setup' } as never, 20_000)) as OpenSetupResult | null
  return { opened: res?.opened === true, ...(res?.reason === 'off' || res?.reason === 'no-browser' ? { reason: res.reason } : {}) }
}

/** Ask the worker for work now (debounced). */
let nudgeTimer = 0
export function nudgeWorker() {
  if (get().conn !== 'connected') return
  window.clearTimeout(nudgeTimer)
  nudgeTimer = window.setTimeout(() => send({ type: 'nudge' }), 150)
}

/** Stop the task's running stage (the worker ends Claude Code's whole process tree). */
export async function stopTask(taskId: string): Promise<void> {
  await request({ op: 'stop', taskId } as never, 15_000)
}

/** One of the fixed git verbs for a task's branch. Updates the git state and the PR field. */
export async function gitTask(taskId: string, verb: GitVerb, message?: string): Promise<GitResult> {
  const ctx = taskContext(taskId)
  if (!ctx) throw new Error(t('features.coding.err.noTask'))
  const repo = ctx.props.repo ? ctx.db.properties.find((p) => p.id === ctx.props.repo)?.options?.find((o) => o.id === ctx.row.properties[ctx.props.repo!])?.name : null
  if (!repo) throw new Error(t('features.coding.err.noRepo'))
  const branch = ctx.props.branch ? String(ctx.row.properties[ctx.props.branch] ?? '').trim() || null : null
  const res = (await request({ op: 'git', taskId, verb, repo, branch, title: ctx.row.title.trim() || t('common.untitled'), ...(message ? { message } : {}) } as never)) as GitResult
  await loadTask(taskId)
  const s = useWorkspace.getState()
  if (res?.git) {
    await patchTask(taskId, { git: res.git })
    if (ctx.props.git) s.setRowProperty(taskId, ctx.props.git, gitSummary(res.git))
  }
  if (res?.url && ctx.props.pr) s.setRowProperty(taskId, ctx.props.pr, res.url)
  if (verb === 'discard' || verb === 'cleanup') {
    if (ctx.props.git) s.setRowProperty(taskId, ctx.props.git, null)
    if (res?.branchGone && ctx.props.branch) s.setRowProperty(taskId, ctx.props.branch, null)
    await patchTask(taskId, { git: null })
  }
  return res
}

/** Is the worker on this device working on the task right now? */
export function isRunning(taskId: string): boolean {
  return get().busy.some((b) => b.taskId === taskId)
}

/* ------------------------------------------------------------------ start */

let started = false

/** Background service (main.tsx, after the workspace loaded). Does nothing until switched on. */
export function startCoding() {
  if (started || typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  started = true
  setNudge(nudgeWorker)
  startTrustWatch()
  if (get().enabled) connect()
  // the tab shows another workspace now: this link belongs to the old one
  const onWorkspace = () => {
    const now = currentWorkspace()
    if (!get().enabled) return
    if (socket && helloAs && now?.id !== helloAs) reconnect()
    else if (!socket && get().conn === 'refused' && now && now.id !== helloAs) reconnect()
  }
  useWorkspace.subscribe((s, prev) => {
    if (s.epoch !== prev.epoch || s.ready !== prev.ready) onWorkspace()
    // tasks changed (a new task, a stage moved): the worker may have work
    if (get().conn !== 'connected' || s.pages === prev.pages) return
    const dbId = codingDbId()
    if (!dbId) return
    const props = s.databases[dbId] ? codingProps(s.databases[dbId]) : null
    for (const id of pageChanges(s.pages, prev.pages).changed) {
      const now = s.pages[id]
      const before = prev.pages[id]
      if (now?.databaseId !== dbId) continue
      if (!before || (props?.stage && now.properties[props.stage] !== before.properties[props.stage]) || (props?.repo && now.properties[props.repo] !== before.properties[props.repo])) {
        nudgeWorker()
        break
      }
    }
  })
  useCloud.subscribe((s, prev) => {
    if (s.active !== prev.active || s.status !== prev.status) onWorkspace()
  })
  // settings changed in another tab: switching off disconnects everywhere
  window.addEventListener('storage', (e) => {
    if (e.key !== CODING_STORAGE_KEY) return
    const next = e.newValue ? loadCodingSettings() : { ...DEFAULT_CODING }
    if (!next.enabled && get().enabled) {
      set({ enabled: false })
      disconnect()
    }
    if (next.port !== get().port) set({ port: next.port })
    // a download in another tab: its pairing is this device's now (used on the next hello)
    set({ pairs: next.pairs })
  })
  const wake = () => {
    if (document.visibilityState !== 'visible' || !get().enabled || socket) return
    if (get().conn === 'waiting') {
      attempt = Math.min(attempt, 1)
      connect()
    }
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('pagehide', () => {
    void flushLogs()
    if (socket) socket.close(1001, 'tab closed')
  })
}
