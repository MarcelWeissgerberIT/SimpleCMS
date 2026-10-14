/**
 * One MCP — the tab side of the local bridge.
 *
 *  - Enabled per device (Settings → Agents · MCP): connect to ws://127.0.0.1:<port> (subprotocol
 *    one-mcp.v2, or v1 with an older bridge), say hello (workspace id + name, mode), retry with
 *    backoff while no bridge runs — faster again when the tab gets focus. A newer tab of the same
 *    workspace takes over (bridge closes us with 4001): no retry then, until "Use this tab".
 *  - The workspace boundary: a v2 call names the workspace id it is meant for and runs only while
 *    this tab shows exactly that workspace (identity.ts) — checked when it arrives and again right
 *    before a write is applied; otherwise it is refused with workspace_mismatch. A change waiting for
 *    approval is cancelled the moment the tab's workspace changes. Every result names the workspace
 *    it ran in. The tab only ever has its own workspace's data.
 *  - Calls: reads answer straight from the store; writes are planned (validated), then approved on
 *    the card (Ask first) or applied right away (Apply directly); Read only refuses them. Every
 *    call lands in the activity log. Team workspaces: writes go through the store like any edit
 *    (and so through cloud sync); viewers can't write.
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { nanoid } from 'nanoid'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { BRAND } from '@/shared/brand'
import { MCP_APPROVAL_MS, MCP_CLOSE_REPLACED, MCP_ERR, MCP_SUBPROTOCOL, MCP_SUBPROTOCOLS, MCP_TOOLS, MCP_WORKSPACE_ID, type AppMessage, type BridgeMessage, type McpAgentMode, type McpToolName } from './contract'
import { currentWorkspace, workspaceInfo, type McpIdentity } from './identity'
import { READ_TOOLS, readTarget } from './read'
import { McpToolError } from './values'
import { mcpMessage, planWrite, type WritePlan } from './write'
import { planRunScript } from './script'
import { warmMembers } from '../workitems'
import { DEFAULT_SETTINGS, loadSettings, MCP_STORAGE_KEY, saveSettings, useMcp, validPort, type ActivityState, type McpActivity, type McpSettings, type Verdict } from './state'
import { endRun, noteRun, withWriter, type Writer } from '../../store/writer'
import { localNetworkPermission } from '../../lib/localNetwork'

const set = useMcp.setState
const get = useMcp.getState

/* ------------------------------------------------------------------ */
/* Messages the agent gets (model-facing, English)                     */
/* ------------------------------------------------------------------ */

const ERR = {
  readOnly: 'One is set to "Agents can only read" (Settings → Agents · MCP). Nothing was changed.',
  viewer: 'You can only view this team workspace in One, so agents cannot change it either. Nothing was changed.',
  signedOut: 'One is not signed in to this team workspace. Sign in in the One tab first.',
  reject: 'The person rejected this change in One. Nothing was changed. Do not retry it; ask them what they want instead.',
  timeout: `The change was not approved within ${MCP_APPROVAL_MS / 60_000} minutes, so nothing was changed.`,
  cancel: 'Cancelled. Nothing was changed.',
  mode: 'Agent changes were switched to read-only in One while this change waited. Nothing was changed.',
  gone: 'One disconnected while this change waited for approval. Nothing was changed.',
  workspace: `${MCP_ERR.mismatch}: the One tab switched to another workspace while this change waited for approval, so it was cancelled. Nothing was changed. Ask the person which workspace to use.`,
} as const

/** The workspace boundary's refusals (model-facing). */
function mismatch(expected: string | undefined, now: McpIdentity | null): string {
  if (!expected) return `${MCP_ERR.mismatch}: the call did not say which workspace it is meant for, so One did not run it. Nothing was done.`
  if (!now) return `${MCP_ERR.mismatch}: this call was meant for the workspace ${expected}, but the One tab is between workspaces right now (loading, signed out or removed from it). Nothing was done. Ask the person which workspace to use.`
  return `${MCP_ERR.mismatch}: this call was meant for the workspace ${expected}, but this One tab now shows ${JSON.stringify(now.name)} (${now.id}). Nothing was done. Ask the person which workspace to use (one_list_workspaces).`
}

/** Every answer names the workspace it ran in (the bridge checks it against the call's). */
function stamped(result: unknown, ws: McpIdentity): Record<string, unknown> {
  const obj = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : { result }
  const own = obj.workspace && typeof obj.workspace === 'object' ? (obj.workspace as Record<string, unknown>) : {}
  return { ...obj, workspace: { ...own, id: ws.id, name: ws.name } }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function patchSettings(patch: Partial<McpSettings>) {
  const s = get()
  const next: McpSettings = { enabled: s.enabled, mode: s.mode, port: s.port, ...patch }
  saveSettings(next)
  set(next)
}

/** "Allow AI agents on this computer". */
export function setMcpEnabled(on: boolean) {
  patchSettings({ enabled: on })
  if (on) {
    mountOverlay()
    attempt = 0
    connect()
  } else disconnect()
}

export function setMcpMode(mode: McpAgentMode) {
  patchSettings({ mode })
  // read only: whatever waits for approval is refused now
  if (mode === 'read') for (const a of get().approvals) settle(a.id, 'mode')
  sendStatus()
}

export function setMcpPort(port: number) {
  const p = validPort(port)
  if (!p || p === get().port) return
  patchSettings({ port: p })
  if (get().enabled) {
    disconnect(false)
    attempt = 0
    connect()
  }
}

/** "Use this tab" / "Retry now". */
export function connectMcpNow() {
  if (!get().enabled) return setMcpEnabled(true)
  disconnect(false)
  attempt = 0
  connect()
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

let socket: WebSocket | null = null
/** the bridge speaks one-mcp.v2: calls are bound to a workspace id */
let bound = false
let retryTimer = 0
let attempt = 0
let failingSince = 0
let lastTry = 0
/** status last sent to the bridge (only changes are sent) */
let lastStatus = ''

const BACKOFF = [500, 1000, 2000, 4000, 7000, 10_000]

function delay(): number {
  // a long wait (no bridge for minutes): every 30 s; focus / visibility retry at once anyway
  if (failingSince && Date.now() - failingSince > 120_000) return 30_000
  return BACKOFF[Math.min(attempt, BACKOFF.length - 1)]
}

function hello(): AppMessage {
  return { type: 'hello', app: 'one', version: BRAND.version, workspace: workspaceMsg(), mode: get().mode }
}

function send(msg: AppMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** hello / status: the workspace as the bridge keys it (no team role). */
function workspaceMsg() {
  const { role: _role, ...info } = workspaceInfo()
  return info
}

function sendStatus() {
  if (get().conn !== 'connected') return
  const msg: AppMessage = { type: 'status', workspace: workspaceMsg(), mode: get().mode }
  const key = JSON.stringify(msg)
  if (key === lastStatus) return
  lastStatus = key
  send(msg)
}

function schedule() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || socket) return
  retryTimer = window.setTimeout(connect, delay())
}

function connect() {
  window.clearTimeout(retryTimer)
  if (!get().enabled || socket) return
  lastTry = Date.now()
  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${get().port}`, MCP_SUBPROTOCOLS)
  } catch {
    // Safari (and older Firefox): an https page may not open ws:// at all — mixed content
    set({ conn: 'blocked', blocked: 'insecure' })
    return
  }
  socket = ws
  let replaced = false
  set((s) => ({ conn: attempt === 0 && s.conn !== 'waiting' ? 'connecting' : 'waiting' }))
  ws.onopen = () => {
    lastStatus = ''
    // an older bridge picks v1: one tab at a time, calls not bound to a workspace (as before)
    bound = ws.protocol === MCP_SUBPROTOCOL
    set({ legacy: !bound, peers: [] })
    ws.send(JSON.stringify(hello()))
  }
  ws.onmessage = (e) => {
    let msg: BridgeMessage
    try {
      msg = JSON.parse(String(e.data)) as BridgeMessage
    } catch {
      return
    }
    if (msg.type === 'replaced') replaced = true
    else receive(msg)
  }
  ws.onclose = (e) => {
    if (socket !== ws) return
    socket = null
    const wasConnected = get().conn === 'connected'
    // approvals of this connection can never be answered now
    for (const a of get().approvals) settle(a.id, 'gone')
    set({ peers: [], session: null })
    if (!get().enabled) return set({ conn: 'off', client: null })
    if (replaced || e.code === MCP_CLOSE_REPLACED) return set({ conn: 'replaced', client: null })
    if (wasConnected) {
      attempt = 0
      failingSince = 0
    } else {
      attempt += 1
      failingSince ||= Date.now()
    }
    set({ conn: 'waiting', client: null })
    void localNetworkPermission().then((p) => {
      if (socket || !get().enabled || get().conn !== 'waiting') return
      if (p === 'denied') set({ conn: 'blocked', blocked: 'permission', prompt: false })
      else {
        set({ prompt: p === 'prompt' })
        schedule()
      }
    })
  }
}

function disconnect(off = true) {
  window.clearTimeout(retryTimer)
  const ws = socket
  socket = null
  for (const a of get().approvals) settle(a.id, 'gone')
  if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, off ? 'switched off' : 'reconnecting')
  set({ conn: off ? 'off' : 'connecting', client: null, session: null, blocked: null, busy: 0, peers: [] })
}

/** The tab came back into view: a waiting connection retries now. */
function wake() {
  const s = get()
  if (!s.enabled || socket || Date.now() - lastTry < 1000) return
  if (s.conn === 'waiting' || s.conn === 'blocked') {
    attempt = Math.min(attempt, 1)
    if (s.conn === 'blocked') set({ conn: 'waiting', blocked: null })
    connect()
  }
}

function receive(msg: BridgeMessage) {
  switch (msg.type) {
    case 'welcome':
      attempt = 0
      failingSince = 0
      set({ conn: 'connected', blocked: null, prompt: false, client: msg.client ?? null, session: nanoid(10), bridge: msg.bridge ?? null, calls: 0 })
      lastStatus = JSON.stringify({ type: 'status', workspace: workspaceMsg(), mode: get().mode })
      // the workspace may have changed between hello and welcome
      sendStatus()
      return
    case 'client':
      set({ client: msg.client ?? null })
      return
    case 'peers':
      set({
        peers: (Array.isArray(msg.workspaces) ? msg.workspaces : [])
          .filter((p) => p && typeof p.name === 'string')
          .slice(0, 20)
          .map((p) => ({ name: p.name.slice(0, 120), kind: p.kind === 'team' ? 'team' : 'local' })),
      })
      return
    case 'call':
      void handleCall(String(msg.id), msg.tool, msg.args && typeof msg.args === 'object' ? msg.args : {}, typeof msg.workspace === 'string' ? msg.workspace : undefined)
      return
    case 'cancel':
      settle(String(msg.id), 'cancel')
      return
  }
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

const LOG_MAX = 100

function logStart(id: string, tool: McpToolName, write: boolean, target: string): string {
  const key = `${id}:${Date.now().toString(36)}`
  const entry: McpActivity = { id: key, at: Date.now(), session: get().session, tool, write, target, state: 'run' }
  set((s) => ({ activity: [entry, ...s.activity].slice(0, LOG_MAX) }))
  return key
}

function logPatch(key: string, patch: Partial<McpActivity>) {
  set((s) => ({ activity: s.activity.map((a) => (a.id === key ? { ...a, ...patch } : a)) }))
}

export function clearMcpActivity() {
  set({ activity: [] })
}

/** An MCP client's name as a run note carries it (store/writer.ts RunMeta.client: an identifier, never content). */
const clientName = (name: string): string => name.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 40)

/** Undo an applied write from the log. */
export function undoMcpActivity(key: string) {
  const a = get().activity.find((x) => x.id === key)
  if (!a?.undo || a.state !== 'ok') return
  // the person's Undo of the call (store/writer.ts)
  const clean = withWriter({ kind: 'you', via: 'undo', ref: key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) }, () => a.undo!())
  logPatch(key, { state: 'undone', undo: undefined })
  useUI.getState().toast(clean ? t('features.mcp.toast.undone') : t('features.mcp.toast.undoneKept'))
}

/* ------------------------------------------------------------------ */
/* the flight recorder's eject (features/recorder eject/sources.ts)     */
/* ------------------------------------------------------------------ */

/** The states an eject's settle replaced, by activity key (its Undo puts them back). */
const settledStates = new Map<string, ActivityState>()

const callActivities = (session: string, call: string) => get().activity.filter((a) => a.id.startsWith(`${call}:`) && (a.session ?? '-') === session)

/** May an eject settle this session's calls now? Not while one of its calls runs or waits for approval. */
export const mcpBusy = (session: string): boolean => get().activity.some((a) => (a.session ?? '-') === session && (a.state === 'run' || a.state === 'wait'))

/**
 * An eject took back what a call wrote (`session`, `call`: its run key mcp:<session>:<call>): its activity reads 'undone'
 * and its Undo closure goes (it would write the old values over the ejected state). Returns whether it found one.
 */
export function settleMcpCall(session: string, call: string, _ejectId: string): boolean {
  const list = callActivities(session, call)
  for (const a of list) {
    if (!settledStates.has(a.id)) settledStates.set(a.id, a.state)
    logPatch(a.id, { state: 'undone', undo: undefined })
  }
  return list.length > 0
}

/** The eject's Undo: the call's activity reads as it did (its Undo closure stays gone — the call can no longer be undone from the log). */
export function unsettleMcpCall(session: string, call: string, _ejectId: string): void {
  for (const a of callActivities(session, call)) {
    const was = settledStates.get(a.id)
    if (was === undefined) continue
    settledStates.delete(a.id)
    logPatch(a.id, { state: was })
  }
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

const verdicts = new Map<string, (v: Verdict) => void>()

function settle(id: string, v: Verdict) {
  const done = verdicts.get(id)
  if (!done) return
  verdicts.delete(id)
  set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }))
  done(v)
}

export const approveMcp = (id: string) => settle(id, 'approve')
export const rejectMcp = (id: string) => settle(id, 'reject')

function askApproval(id: string, plan: WritePlan, ws: McpIdentity): Promise<Verdict> {
  return new Promise((resolve) => {
    const at = Date.now()
    const timer = window.setTimeout(() => settle(id, 'timeout'), MCP_APPROVAL_MS)
    verdicts.set(id, (v) => {
      window.clearTimeout(timer)
      resolve(v)
    })
    set((s) => ({ approvals: [...s.approvals, { id, plan, workspace: { id: ws.id, name: ws.name }, at, expiresAt: at + MCP_APPROVAL_MS }] }))
  })
}

/** The tab's workspace changed (or it is between workspaces): changes meant for another one are cancelled. */
function onWorkspaceChange() {
  const now = currentWorkspace()
  for (const a of get().approvals) if (a.workspace.id !== now?.id) settle(a.id, 'workspace')
  sendStatus()
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

const VERDICT_STATE: Record<Exclude<Verdict, 'approve'>, ActivityState> = { reject: 'rejected', timeout: 'timeout', cancel: 'cancelled', mode: 'rejected', gone: 'cancelled', workspace: 'cancelled' }

/**
 * The workspace this call may run in — null (and refused) when it is not the one the call names.
 * A v1 bridge names none: the call runs in the workspace the tab shows, as before.
 */
function boundWorkspace(expected: string | undefined): { ok: true; ws: McpIdentity } | { ok: false; error: string } {
  const now = currentWorkspace()
  if (bound && (!expected || !MCP_WORKSPACE_ID.test(expected))) return { ok: false, error: mismatch(undefined, now) }
  if (!now) return { ok: false, error: bound ? mismatch(expected, null) : 'The One tab is between workspaces right now (loading, signed out or removed from it). Nothing was done.' }
  if (bound && now.id !== expected) return { ok: false, error: mismatch(expected, now) }
  return { ok: true, ws: now }
}

async function handleCall(id: string, tool: McpToolName, args: Record<string, unknown>, expected?: string) {
  const def = MCP_TOOLS.find((x) => x.name === tool)
  const started = performance.now()
  set((s) => ({ calls: s.calls + 1, busy: s.busy + 1 }))
  let target = ''
  try {
    target = def && !def.write ? readTarget(tool, args) : ''
  } catch {
    target = ''
  }
  const key = logStart(id, tool, !!def?.write, target)
  const ms = () => Math.round(performance.now() - started)
  const fail = (message: string, state: ActivityState = 'err') => {
    send({ type: 'error', id, error: message })
    logPatch(key, { state, ms: ms(), note: message })
  }
  try {
    if (!def) return fail(`Unknown tool ${JSON.stringify(tool)}.`)
    if (useCloud.getState().status === 'signed-out') return fail(ERR.signedOut)
    // the boundary: only the workspace the call is meant for, only while this tab shows it
    const at = boundWorkspace(expected)
    if (!at.ok) return fail(at.error, 'rejected')
    if (!def.write) {
      if (tool === 'one_list_work_items') await warmMembers()
      const result = await READ_TOOLS[tool]!(args, get().mode)
      send({ type: 'result', id, result: stamped(result, at.ws) })
      logPatch(key, { state: 'ok', ms: ms() })
      return
    }
    if (get().mode === 'read') return fail(ERR.readOnly, 'rejected')
    if (useCloud.getState().readOnly) return fail(ERR.viewer, 'rejected')
    // team: the member list (owners by email) before the planner runs — staging never waits for it
    await warmMembers()
    const plan = tool === 'one_run_script' ? await planRunScript(args) : planWrite(tool, args)
    logPatch(key, { target: plan.target })
    if (plan.noop) {
      send({ type: 'result', id, result: stamped(plan.noop, at.ws) })
      logPatch(key, { state: 'same', ms: ms() })
      return
    }
    // a script is always asked (it may send mail, call Claude, trash pages), also in "Apply directly"
    const ask = get().mode === 'ask' || !!plan.alwaysAsk
    if (ask) {
      send({ type: 'pending', id, timeoutMs: MCP_APPROVAL_MS })
      logPatch(key, { state: 'wait' })
      const verdict = await askApproval(id, plan, at.ws)
      if (verdict !== 'approve') return fail(ERR[verdict], VERDICT_STATE[verdict])
      // switched to read only (or lost the right to write) in the meantime
      if (get().mode === 'read') return fail(ERR.readOnly, 'rejected')
      if (useCloud.getState().readOnly) return fail(ERR.viewer, 'rejected')
    }
    // still the same workspace right before anything is written
    const still = boundWorkspace(expected)
    if (!still.ok || still.ws.id !== at.ws.id) return fail(still.ok ? mismatch(at.ws.id, still.ws) : still.error, 'rejected')
    // the call writes as itself (store/writer.ts): mcp:<session>:<call>:<tool>; the recorder learns its client first
    const writer: Writer = { kind: 'mcp', session: get().session ?? '-', call: id, tool }
    noteRun(writer, { tool, ...(get().client?.name ? { client: clientName(get().client!.name) } : {}) })
    let applied: Awaited<ReturnType<WritePlan['apply']>>
    try {
      applied = await plan.apply(writer)
    } finally {
      endRun(writer)
    }
    send({ type: 'result', id, result: stamped(applied.result, at.ws) })
    logPatch(key, { state: 'ok', ms: ms(), undo: applied.undo })
    // approved by hand: confirm with an undo (Apply directly stays quiet — the log has it)
    if (ask && applied.undo)
      useUI.getState().toast({
        message: t('features.mcp.toast.applied', { what: plan.summary }),
        kind: 'success',
        action: { label: t('common.undo'), run: () => undoMcpActivity(key) },
        timeout: 8000,
      })
  } catch (e) {
    if (e instanceof McpToolError) return fail(e.message)
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[one] MCP tool failed', tool, e)
    fail(`The tool failed in One: ${mcpMessage(msg)}`)
  } finally {
    set((s) => ({ busy: Math.max(0, s.busy - 1) }))
  }
}

/* ------------------------------------------------------------------ */
/* Overlay (approval cards) — its own small React root                  */
/* ------------------------------------------------------------------ */

let overlay: Root | null = null

function mountOverlay() {
  if (overlay || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.id = 'one-mcp-overlay'
  document.body.append(el)
  overlay = createRoot(el)
  void import('./ApprovalCard').then(({ ApprovalHost }) => overlay?.render(createElement(ApprovalHost)))
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

let started = false

/** Background service (main.tsx, after the workspace loaded). Does nothing until enabled. */
export function startMcp() {
  if (started || typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  started = true
  if (get().enabled) {
    mountOverlay()
    connect()
  }
  // the workspace (its name, a team role) changed: approvals for another workspace go, the bridge hears it
  useWorkspace.subscribe((s, prev) => {
    if (s.settings.workspaceName !== prev.settings.workspaceName || s.epoch !== prev.epoch || s.ready !== prev.ready) onWorkspaceChange()
  })
  useCloud.subscribe((s, prev) => {
    if (s.active !== prev.active || s.status !== prev.status || s.readOnly !== prev.readOnly || s.workspaces !== prev.workspaces) onWorkspaceChange()
  })
  // settings changed in another tab: mode and port follow; switching off disconnects everywhere,
  // but switching on there does not make this tab take the bridge over
  window.addEventListener('storage', (e) => {
    if (e.key !== MCP_STORAGE_KEY) return
    const next = e.newValue ? loadSettings() : { ...DEFAULT_SETTINGS }
    const cur = get()
    if (next.mode !== cur.mode) setMcpMode(next.mode)
    if (!next.enabled && cur.enabled) {
      set({ enabled: false })
      disconnect()
    }
    if (next.port !== cur.port) set({ port: next.port })
  })
  const onWake = () => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)
  window.addEventListener('online', onWake)
  window.addEventListener('pagehide', () => {
    // a page may only close with 1000 or 3000–4999 (1001 throws)
    if (socket) socket.close(1000, 'tab closed')
  })
}

/* ------------------------------------------------------------------ */
/* Test hook (dev, or ?e2e)                                            */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneMcp?: unknown }).__oneMcp = {
    state: () => {
      const s = get()
      return { conn: s.conn, session: s.session, client: s.client?.name ?? null }
    },
    activity: () => get().activity.map(({ undo, ...a }) => ({ ...a, undoable: !!undo })),
    /** the flight recorder's eject: an activity as a call leaves it (its Undo counts its presses in `undos`) */
    seedActivity: (a: Omit<McpActivity, 'undo'>, undoable: boolean) => {
      const w = window as unknown as { __oneMcpUndos?: number }
      set((s) => ({ activity: [{ ...a, ...(undoable ? { undo: () => ((w.__oneMcpUndos = (w.__oneMcpUndos ?? 0) + 1), true) } : {}) }, ...s.activity] }))
    },
    undos: () => (window as unknown as { __oneMcpUndos?: number }).__oneMcpUndos ?? 0,
    /** MCP · Connections' bridge row in a given state (never connects, never sends — the state only) */
    seed: (patch: Record<string, unknown>) => {
      const keys = ['enabled', 'conn', 'blocked', 'prompt', 'client', 'peers', 'legacy', 'calls', 'bridge', 'session'] as const
      const out: Record<string, unknown> = {}
      for (const k of keys) if (k in patch) out[k] = patch[k]
      set(out as Partial<ReturnType<typeof get>>)
    },
    busy: mcpBusy,
    settle: settleMcpCall,
    unsettle: unsettleMcpCall,
  }
}
