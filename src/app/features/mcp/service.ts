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
import { MCP_APPROVAL_MS, MCP_CLOSE_REPLACED, MCP_CONTRACT_REV, MCP_ERR, MCP_SUBPROTOCOL, MCP_SUBPROTOCOLS, MCP_TOOLS, MCP_WORKSPACE_ID, bridgeOutdated, mcpToolArgs, type AppMessage, type BridgeMessage, type McpAgentMode, type McpToolName } from './contract'
import { mcpError, withCode, withRemedy } from '../../../shared/mcp/errors'
import { undeclaredIn, undeclaredText } from '../../../shared/mcp/args'
import { createsSomething, duplicateAnswer, duplicateKey, DUPLICATE_MS, remembersResult } from '../../../shared/mcp/duplicates'
import { MCP_LIMITS } from '../../../shared/mcp/tables'
import { currentWorkspace, workspaceInfo, type McpIdentity } from './identity'
import { READ_TOOLS, readTarget } from './read'
import { getPage } from './pageRead'
import { McpToolError } from './values'
import { mcpMessage, planWrite, type WritePlan } from './write'
import { planRunScript } from './script'
import { warmMembers } from '../workitems'
import { DEFAULT_SETTINGS, loadSettings, MCP_STORAGE_KEY, saveSettings, useMcp, validPort, type ActivityState, type McpActivity, type McpSettings, type Verdict } from './state'
import { endRun, noteRun, withWriter, type Writer } from '../../store/writer'
import { runUndo, tapeCall } from './undo'
import { localNetworkPermission } from '../../lib/localNetwork'
import { loadFileStamps } from '../../lib/files'
import { fileRefsIn } from '../ai/claudeFiles'

const set = useMcp.setState
const get = useMcp.getState

/* ------------------------------------------------------------------ */
/* Messages the agent gets (model-facing, English)                     */
/* ------------------------------------------------------------------ */

const ERR = {
  readOnly: mcpError('rejected', '', 'One is set to "Agents can only read" (Settings → Agents · MCP)', 'Ask the person whether they want to allow changes; do not retry on your own.'),
  viewer: mcpError('rejected', '', 'You can only view this team workspace in One, so agents cannot change it either'),
  signedOut: mcpError('rejected', '', 'One is not signed in to this team workspace', 'Ask the person to sign in in the One tab first.'),
  reject: mcpError('rejected', '', 'The person rejected this change in One'),
  timeout: mcpError('approval_timeout', '', `The change was not approved within ${MCP_APPROVAL_MS / 60_000} minutes`),
  cancel: mcpError('rejected', '', 'The call was cancelled before it was approved'),
  mode: mcpError('rejected', '', 'Agent changes were switched to read-only in One while this change waited'),
  gone: mcpError('approval_timeout', '', 'One disconnected while this change waited for approval', 'Ask the person whether to try again once One is open; do not retry on your own.'),
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
  const next: McpSettings = { enabled: s.enabled, mode: s.mode, port: s.port, comments: s.comments, ...patch }
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

/** Comments over MCP on this device: off · read · read + write (Settings → Agents · MCP). */
export function setMcpComments(comments: McpSettings['comments']) {
  if (comments === get().comments) return
  patchSettings({ comments })
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

/** The tools this tab runs, with the arguments each takes (contract 2): a bridge refuses anything else before it gets here. */
const TOOL_ARGS = mcpToolArgs()

function hello(): AppMessage {
  return { type: 'hello', app: 'one', version: BRAND.version, workspace: workspaceMsg(), mode: get().mode, tools: TOOL_ARGS, contract: MCP_CONTRACT_REV }
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
      set({ conn: 'connected', blocked: null, prompt: false, client: msg.client ?? null, session: nanoid(10), bridge: typeof msg.bridge === 'string' ? msg.bridge.slice(0, 40) : null, calls: 0 })
      // a new MCP session: repeats are matched within one session only
      duplicates.clear()
      owners.clear()
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
  set({ activity: [entry, ...get().activity].slice(0, LOG_MAX) })
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

/** one_overview for a bridge older than one_list_pages: its cut tree points to one_search instead. */
function legacyOverview(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('tree' in result)) return result
  return { ...result, tree: { more: true, note: 'Not every page is listed here: one_search finds the others by title, one_get_page lists a page\'s sub-pages.' } }
}

/**
 * Undo an applied write from the log — all or nothing (undo.ts): changed since, it writes nothing, says what changed and
 * where to take it back by hand (the entry keeps no Undo key: it would only say the same again).
 */
export function undoMcpActivity(key: string) {
  const a = get().activity.find((x) => x.id === key)
  if (!a?.undo || a.state !== 'ok') return
  // the person's Undo of the call (store/writer.ts)
  const out = withWriter({ kind: 'you', via: 'undo', ref: key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) }, () => a.undo!())
  if (!out.ok) {
    logPatch(key, { undo: undefined, note: `${out.message} ${out.detail}` })
    useUI.getState().toast({ message: out.message, detail: out.detail, kind: 'error', timeout: 12_000 })
    return
  }
  logPatch(key, { state: 'undone', undo: undefined })
  // a repeat of the call makes the thing again (it is not answered with what went to the trash)
  forgetDuplicate((d) => d.activity === key)
  useUI.getState().toast(t('features.mcp.toast.undone'))
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
  // what the call made is ejected: its repeat is a new call (an eject's Undo does not bring the entry back)
  forgetDuplicate((d) => d.session === session && d.call === call)
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
  // the client gave up on this call, but a repeat of it joined the card: the card stays and answers the repeat
  if (v === 'cancel' && (owners.get(id)?.joined.length ?? 0) > 0) return
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
  if (!now) return { ok: false, error: bound ? mismatch(expected, null) : `${MCP_ERR.mismatch}: the One tab is between workspaces right now (loading, signed out or removed from it). Nothing was done. Ask the person which workspace to use.` }
  if (bound && now.id !== expected) return { ok: false, error: mismatch(expected, now) }
  return { ok: true, ws: now }
}

/* ------------------------------------------------------------------ */
/* Duplicate calls (spec § 2.0): one map per MCP session                */
/* ------------------------------------------------------------------ */

type CallOutcome = { ok: true; result: unknown } | { ok: false; error: string; state: ActivityState }

/** A creating call that waits (its repeats join it) or was applied in the window (its repeats get its result). */
type Duplicate =
  | { key: string; state: 'wait'; joined: Array<(out: CallOutcome) => void> }
  /** `activity`: the call's line in Agent activity (its Undo forgets the entry, as an eject of `session` · `call` does) */
  | { key: string; state: 'done'; at: number; result: unknown; session: string; call: string; activity: string }

/** key = session · workspace · tool + canonical arguments; insertion order = age (≤ MCP_LIMITS.duplicateEntries) */
const duplicates = new Map<string, Duplicate>()
/** call id → the waiting entry it opened (a cancel of that call leaves the card to the repeats that joined it) */
const owners = new Map<string, Extract<Duplicate, { state: 'wait' }>>()

function openDuplicate(key: string, call: string): Duplicate {
  const entry: Extract<Duplicate, { state: 'wait' }> = { key, state: 'wait', joined: [] }
  owners.set(call, entry)
  duplicates.delete(key)
  duplicates.set(key, entry)
  // bounded: the oldest finished entries go first, then the oldest of all
  while (duplicates.size > MCP_LIMITS.duplicateEntries) {
    const old = [...duplicates.values()].find((d) => d.state === 'done') ?? duplicates.values().next().value!
    duplicates.delete(old.key)
  }
  return entry
}

/**
 * The waiting call ended: its repeats get the same answer; applied → remembered (`remember`: its activity line and
 * session, so an Undo or an eject forgets it again), anything else forgotten.
 */
function closeDuplicate(entry: Duplicate, out: CallOutcome, call: string, remember: { session: string; activity: string } | null) {
  if (entry.state !== 'wait') return
  owners.delete(call)
  for (const join of entry.joined.splice(0)) join(out)
  if (duplicates.get(entry.key) !== entry) return
  if (out.ok && remember) duplicates.set(entry.key, { key: entry.key, state: 'done', at: Date.now(), result: out.result, call, ...remember })
  else duplicates.delete(entry.key)
}

/**
 * A call was taken back (its Undo in Agent activity, an eject): its repeat is a new call again — never answered with
 * the result of what is in the trash now (spec § 2.0: only APPLIED calls answer their repeats).
 */
function forgetDuplicate(match: (d: Extract<Duplicate, { state: 'done' }>) => boolean): void {
  for (const [key, d] of duplicates) if (d.state === 'done' && match(d)) duplicates.delete(key)
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
  /** the waiting entry this call opened: its repeats get its answer */
  let mine: Duplicate | null = null
  // every refusal starts with its code (spec § 2.0) — one this tab's code did not name gets the one it means (withCode)
  const fail = (message: string, state: ActivityState = 'err', partial = false) => {
    // a call that wrote part of it says itself what stays (never "Nothing was changed … call again" after it)
    const error = partial ? withCode(message) : withRemedy(withCode(message))
    send({ type: 'error', id, error })
    logPatch(key, { state, ms: ms(), note: error })
    if (mine) closeDuplicate(mine, { ok: false, error, state }, id, null)
  }
  try {
    if (!def) return fail(mcpError('bad_argument', '', `Unknown tool ${JSON.stringify(tool)}`, 'tools/list names the tools there are.'))
    // strict arguments (the tool's schema has additionalProperties: false): nothing undeclared is dropped silently
    const extra = Object.keys(args).find((k) => k !== 'workspace' && !Object.hasOwn(def.inputSchema.properties, k))
    if (extra) return fail(mcpError('bad_argument', extra, `${tool} takes no argument ${JSON.stringify(extra)}`), 'rejected')
    // … and at every depth: a key a closed object of the contract does not declare (rows[0].Status, pages[1].content)
    const { workspace: _workspace, ...declared } = args
    const nested = undeclaredIn(declared, def.inputSchema)
    if (nested) return fail(mcpError('bad_argument', nested.path, undeclaredText(tool, nested)), 'rejected')
    if (useCloud.getState().status === 'signed-out') return fail(ERR.signedOut)
    // the boundary: only the workspace the call is meant for, only while this tab shows it
    const at = boundWorkspace(expected)
    if (!at.ok) return fail(at.error, 'rejected')
    const answer = (result: unknown, state: ActivityState, patch: Partial<McpActivity> = {}) => {
      send({ type: 'result', id, result: stamped(result, at.ws) })
      logPatch(key, { state, ms: ms(), ...patch })
    }
    if (!def.write) {
      if (tool === 'one_list_work_items') await warmMembers()
      // a bridge older than parts (no cursor in its schema, no parts in its description): contract 1's whole-page answer
      const older = !get().bridge || bridgeOutdated(get().bridge)
      const legacyRead = tool === 'one_get_page' && older
      const result = legacyRead ? await getPage(args, { whole: true }) : await READ_TOOLS[tool]!(args, get().mode)
      // and it serves no one_list_pages: the overview never sends the client there
      return answer(older && tool === 'one_overview' ? legacyOverview(result) : result, 'ok')
    }
    if (get().mode === 'read') return fail(ERR.readOnly, 'rejected')
    if (useCloud.getState().readOnly) return fail(ERR.viewer, 'rejected')
    // a repeat of a creating call: joins the one still waiting, or gets the answer of the one applied just now
    if (createsSomething(tool)) {
      const dupKey = `${get().session ?? '-'}\n${at.ws.id}\n${duplicateKey(tool, args)}`
      const hit = duplicates.get(dupKey)
      // a keyed upsert only joins a waiting call (MCP_JOIN_ONLY_TOOLS): applied, its repeat runs again
      if (hit?.state === 'done' && remembersResult(tool) && Date.now() - hit.at <= DUPLICATE_MS) return answer(duplicateAnswer(hit.result, hit.at, Date.now()), 'same', { note: t('features.mcp.log.duplicate') })
      if (hit?.state === 'wait') {
        send({ type: 'pending', id, timeoutMs: MCP_APPROVAL_MS })
        logPatch(key, { state: 'wait' })
        const out = await new Promise<CallOutcome>((resolve) => hit.joined.push(resolve))
        if (!out.ok) return fail(out.error, out.state)
        return answer(out.result, 'same', { note: t('features.mcp.log.joined') })
      }
      mine = openDuplicate(dupKey, id)
    }
    // team: the member list (owners by email) before the planner runs — staging never waits for it
    await warmMembers()
    // the workspace stamps of the files the call names (lib/files.ts): claudeDoc's check runs inside the plan, sync
    await loadFileStamps(fileRefsIn(args))
    const plan = tool === 'one_run_script' ? await planRunScript(args) : planWrite(tool, args)
    logPatch(key, { target: plan.target })
    if (plan.noop) {
      answer(plan.noop, 'same', plan.noopNote ? { note: plan.noopNote } : {})
      if (mine) closeDuplicate(mine, { ok: true, result: plan.noop }, id, null)
      return
    }
    // asked also in "Apply directly" when the plan says so (rows that start paid or outward work, task holds)
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
    // what the call writes into pages and databases, under its own writer: its Undo (all or nothing, undo.ts)
    const tape = tapeCall(writer)
    let applied: Awaited<ReturnType<WritePlan['apply']>>
    try {
      applied = await plan.apply(writer)
    } catch (e) {
      // nothing to undo (a failed call's own rollback ran)
      tape.stop()
      throw e
    } finally {
      endRun(writer)
    }
    const taken = tape.finish()
    const undo = taken ? () => runUndo(taken) : undefined
    answer(applied.result, 'ok', undo ? { undo } : {})
    if (mine) closeDuplicate(mine, { ok: true, result: applied.result }, id, remembersResult(tool) ? { session: get().session ?? '-', activity: key } : null)
    // approved by hand: confirm with an undo (Apply directly stays quiet — the log has it)
    if (ask && undo)
      useUI.getState().toast({
        message: t('features.mcp.toast.applied', { what: plan.summary }),
        kind: 'success',
        action: { label: t('common.undo'), run: () => undoMcpActivity(key) },
        timeout: 8000,
      })
  } catch (e) {
    if (e instanceof McpToolError) return fail(e.message, 'err', e.partial)
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[one] MCP tool failed', tool, e)
    // a fault of One's own: whether a part was written is not known for sure — the agent reads before it calls again
    fail(`rejected: The tool failed in One: ${mcpMessage(msg)}. Nothing was confirmed — read what the call touches again before you call again, and tell the person if it fails again.`)
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
    if (next.comments !== cur.comments) set({ comments: next.comments })
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
      set((s) => ({ activity: [{ ...a, ...(undoable ? { undo: () => ((w.__oneMcpUndos = (w.__oneMcpUndos ?? 0) + 1), { ok: true as const }) } : {}) }, ...s.activity] }))
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
    /** what Claude may read of a page (editor/context): these top-level blocks only, [] = nothing, null = the whole page */
    context: async (pageId: string, ids: string[] | null) => {
      const editor = await import('../../editor')
      if (ids === null) editor.setContextMode(pageId, 'page')
      else if (ids.length) editor.setContextMarks(pageId, ids)
      else editor.setContextMode(pageId, 'none')
    },
  }
}
