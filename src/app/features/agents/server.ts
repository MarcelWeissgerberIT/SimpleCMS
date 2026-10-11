/**
 * Custom agents — the team server's runner (docs/API.md § Agents): its runtime (the server's Claude
 * key and MCP servers — secrets are never returned, only set / last 4), its runs, "run now" and the
 * review of staged server runs (the client applies with apply.ts, then marks the run resolved). An
 * older server without these endpoints answers 404: everything reports 'unsupported' then.
 */
import { create } from 'zustand'
import { CloudError, cloudRequest, useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import { t } from '../../i18n'
import type { AgentRun, AgentRunStatus, AgentRunStep } from './types'

export interface SecretState {
  set: boolean
  last4?: string
}

export interface AgentRuntime {
  claudeKey: SecretState
  mcpServers: Array<{ name: string; url: string; token: SecretState }>
  enabled: boolean
  /** false: the server runs with AGENTS=off (no server agent can run there) */
  available: boolean
}

export interface RuntimePatch {
  claudeKey?: string | null
  mcpServers?: Array<{ name: string; url: string; token?: string | null }>
  enabled?: boolean
}

/** 'forbidden': viewers may not read the runtime (MCP URLs can hold secrets) */
export type ServerState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'forbidden' | 'error'

/** A server run's head (plain columns only: what the Preflight "missed" lamp needs of an agent's newest run). */
export interface ServerRunHead {
  id: string
  agentId: ID
  status: AgentRunStatus
  startedAt: number
  endedAt: number | null
}

interface ServerAgentsState {
  /** the workspace the state belongs to */
  ws: string | null
  state: ServerState
  runtime: AgentRuntime | null
  error: string | null
  /** server runs per agent, newest first */
  runs: Record<ID, AgentRun[]>
  runsState: Record<ID, ServerState>
  /**
   * The staged runs of this member's OWN server agents (agent-runs/open, newest first, without summary / steps) — the
   * Preflight proposals lamp's slice, apart from `runs` (AgentsView's). null: not loaded (local workspace, no own
   * server agent, or not asked yet).
   */
  open: AgentRun[] | null
  /** each own server agent's newest run (its head) — null: not loaded */
  openLatest: ServerRunHead[] | null
  /** 'lean': the agent-runs/open endpoint · 'fallback': an older server — the last 50 runs per own agent, every 5 min */
  openMode: 'lean' | 'fallback'
  /** the workspace `open` belongs to */
  openWs: string | null
}

export const useServerAgents = create<ServerAgentsState>()(() => ({ ws: null, state: 'idle', runtime: null, error: null, runs: {}, runsState: {}, open: null, openLatest: null, openMode: 'lean', openWs: null }))

/** The open team workspace's id (null: the local workspace). */
export function teamId(): string | null {
  const a = useCloud.getState().active
  return a.kind === 'cloud' ? a.id : null
}

const path = (wsId: string, rest: string) => `api/workspaces/${encodeURIComponent(wsId)}/${rest}`
/** An older server without the agent endpoints (a specific 404 code — agent_not_found … — is not that). */
export const unsupported = (e: unknown) => e instanceof CloudError && (e.code === 'not_found' || e.code === 'unavailable' || e.code === 'invalid_response' || e.status === 405)

const CODES = ['runtime_not_ready', 'agent_not_server', 'agent_unavailable', 'queue_full', 'run_running', 'run_busy', 'agent_not_found', 'run_not_found', 'hook_not_found', 'agents_off', 'forbidden']

/** A friendly sentence for a failed agent request (the server's code, else its message). */
export function serverErrorText(e: unknown): string {
  if (unsupported(e)) return t('features.agents.server.unsupported')
  if (e instanceof CloudError && CODES.includes(e.code)) return t(`features.agents.server.err.${e.code}`)
  return t('features.agents.server.err.other', { msg: e instanceof Error ? e.message : String(e) })
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

function secret(v: unknown): SecretState {
  if (!isObj(v)) return { set: false }
  const last4 = typeof v.last4 === 'string' && /^[\w-]{1,8}$/.test(v.last4) ? v.last4 : undefined
  return { set: v.set === true, ...(last4 ? { last4 } : {}) }
}

/** The runtime as the server answered it, checked (a secret never comes back, only its state). */
export function readRuntime(v: unknown): AgentRuntime {
  const o = isObj(v) ? v : {}
  const list = Array.isArray(o.mcpServers) ? o.mcpServers : []
  return {
    claudeKey: secret(o.claudeKey),
    enabled: o.enabled === true,
    available: o.available !== false,
    mcpServers: list.filter(isObj).slice(0, 24).map((s) => ({ name: str(s.name, 32), url: str(s.url, 500), token: secret(s.token) })).filter((s) => s.name),
  }
}

const STATUSES: AgentRunStatus[] = ['running', 'ok', 'staged', 'error', 'budget', 'skipped']
// what a server run may propose — 'coding' (a pipeline task) must never join: applyChanges refuses it outside the AI terminal
const KINDS: StagedChange['kind'][] = ['create_page', 'append', 'create_row', 'update_row', 'rename']
const CHANGE_STATUS: StagedChange['status'][] = ['pending', 'applied', 'discarded', 'failed']

function readChange(v: unknown): StagedChange | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.pageId !== 'string' || !KINDS.includes(v.kind as StagedChange['kind'])) return null
  const c = { ...(v as unknown as StagedChange) }
  c.status = CHANGE_STATUS.includes(c.status) ? c.status : 'pending'
  c.n = typeof c.n === 'number' ? c.n : 0
  if (c.props !== undefined && !Array.isArray(c.props)) delete c.props
  if (c.markdown !== undefined && typeof c.markdown !== 'string') delete c.markdown
  return c
}

/** A run the server answered, checked like any copy from outside. */
export function readRun(v: unknown): AgentRun | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.agentId !== 'string') return null
  const trig = isObj(v.trigger) ? v.trigger : {}
  const steps: AgentRunStep[] = (Array.isArray(v.steps) ? v.steps : [])
    .filter(isObj)
    .slice(0, 200)
    .map((s) => ({ kind: s.kind === 'mcp' || s.kind === 'note' ? s.kind : 'tool', label: str(s.label, 200), state: s.state === 'err' ? 'err' : 'ok' }))
  const staged = Array.isArray(v.staged) ? v.staged.map(readChange).filter((c): c is StagedChange => !!c) : undefined
  const u = isObj(v.usage) ? v.usage : null
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    id: v.id,
    agentId: v.agentId,
    runner: 'server',
    trigger: { type: (['manual', 'schedule', 'row_created', 'row_changed', 'webhook'].includes(trig.type as string) ? trig.type : 'manual') as AgentRun['trigger']['type'], ...(typeof trig.detail === 'string' ? { detail: trig.detail.slice(0, 300) } : {}) },
    startedAt: n(v.startedAt),
    ...(typeof v.endedAt === 'number' ? { endedAt: v.endedAt } : {}),
    status: STATUSES.includes(v.status as AgentRunStatus) ? (v.status as AgentRunStatus) : 'error',
    summary: str(v.summary, 40_000),
    steps,
    ...(staged ? { staged } : {}),
    ...(typeof v.applied === 'number' ? { applied: v.applied } : {}),
    ...(u ? { usage: { input: n(u.input), output: n(u.output), cacheRead: n(u.cacheRead), usd: n(u.usd) } } : {}),
    error: typeof v.error === 'string' ? v.error.slice(0, 500) : null,
  }
}

/** Load the runtime of the open team workspace (members read, admins write). */
export async function loadRuntime(): Promise<void> {
  const wsId = teamId()
  if (!wsId) return
  const cur = useServerAgents.getState()
  if (cur.ws !== wsId) useServerAgents.setState({ ws: wsId, runs: {}, runsState: {}, runtime: null })
  useServerAgents.setState({ state: 'loading', error: null })
  try {
    const rt = readRuntime(await cloudRequest<unknown>('GET', path(wsId, 'agent-runtime')))
    if (teamId() === wsId) useServerAgents.setState({ state: 'ready', runtime: rt })
  } catch (e) {
    if (teamId() !== wsId) return
    if (unsupported(e)) useServerAgents.setState({ state: 'unsupported', runtime: null })
    else if (e instanceof CloudError && e.status === 403) useServerAgents.setState({ state: 'forbidden', runtime: null })
    else useServerAgents.setState({ state: 'error', error: serverErrorText(e) })
  }
}

/** Admins: change the runtime (secrets go to the server only, encrypted there). */
export async function saveRuntime(patch: RuntimePatch): Promise<AgentRuntime> {
  const wsId = teamId()
  if (!wsId) throw new CloudError('unavailable', 'Not a team workspace.')
  const rt = readRuntime(await cloudRequest<unknown>('PUT', path(wsId, 'agent-runtime'), patch))
  useServerAgents.setState({ state: 'ready', runtime: rt, error: null })
  return rt
}

/** The server runs of an agent (newest first) into useServerAgents. */
export async function loadServerRuns(agentId: ID, limit = 50): Promise<void> {
  const wsId = teamId()
  if (!wsId) return
  useServerAgents.setState((s) => ({ runsState: { ...s.runsState, [agentId]: s.runs[agentId] ? s.runsState[agentId] : 'loading' } }))
  try {
    const raw = await cloudRequest<unknown>('GET', path(wsId, `agent-runs?agentId=${encodeURIComponent(agentId)}&limit=${limit}`))
    const list = (Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.runs) ? raw.runs : []).map(readRun).filter((r): r is AgentRun => !!r && r.agentId === agentId)
    list.sort((a, b) => b.startedAt - a.startedAt)
    useServerAgents.setState((s) => ({ runs: { ...s.runs, [agentId]: list }, runsState: { ...s.runsState, [agentId]: 'ready' } }))
  } catch (e) {
    useServerAgents.setState((s) => ({ runsState: { ...s.runsState, [agentId]: unsupported(e) ? 'unsupported' : 'error' } }))
  }
}

/** Start a server run now. */
export async function runOnServer(agentId: ID): Promise<string> {
  const wsId = teamId()
  if (!wsId) throw new CloudError('unavailable', 'Not a team workspace.')
  const res = await cloudRequest<{ runId?: string }>('POST', path(wsId, `agents/${encodeURIComponent(agentId)}/run`))
  return typeof res?.runId === 'string' ? res.runId : ''
}

/** Mark a server run's staged changes as applied (here, with apply.ts) / discarded. */
export async function resolveServerRun(runId: string, applied: string[], discarded: string[]): Promise<void> {
  const wsId = teamId()
  if (!wsId) return
  await cloudRequest('POST', path(wsId, `agent-runs/${encodeURIComponent(runId)}/resolve`), { applied, discarded })
}

/**
 * Update one server run in the cache (after a review here) — also its lean copy among the open runs (agent-runs/open:
 * only its proposals change there, it keeps no summary / steps), so what was reviewed stops counting at once.
 */
export function patchServerRun(run: AgentRun): void {
  useServerAgents.setState((s) => ({
    runs: s.runs[run.agentId] ? { ...s.runs, [run.agentId]: s.runs[run.agentId].map((r) => (r.id === run.id ? run : r)) } : s.runs,
    open: s.open?.some((r) => r.id === run.id) ? s.open.map((r) => (r.id === run.id ? { ...r, staged: run.staged, rowIds: run.rowIds, applied: run.applied } : r)) : s.open,
  }))
}

/** The newest copy of a server run this tab holds (AgentsView's list, else the open runs), or null. */
export function serverRunCopy(agentId: ID, runId: string): AgentRun | null {
  const s = useServerAgents.getState()
  return s.runs[agentId]?.find((r) => r.id === runId) ?? s.open?.find((r) => r.id === runId) ?? null
}

/* ------------------------------------------------------------------ the member's own open server runs (Preflight) */

/** This member's own server agents in the open team workspace (enabled or not — their proposals still wait). */
export function ownServerAgentIds(): ID[] {
  const me = useCloud.getState().user?.id
  if (!teamId() || !me) return []
  return Object.values(useWorkspace.getState().agents ?? {})
    .filter((a) => a.runner === 'server' && a.createdBy === me)
    .map((a) => a.id)
    .sort()
    .slice(0, 50)
}

const STATUS_SET = new Set<string>(STATUSES)

function readHead(v: unknown): ServerRunHead | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.agentId !== 'string' || !STATUS_SET.has(v.status as string)) return null
  return { id: v.id, agentId: v.agentId, status: v.status as AgentRunStatus, startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0, endedAt: typeof v.endedAt === 'number' ? v.endedAt : null }
}

const headOf = (r: AgentRun): ServerRunHead => ({ id: r.id, agentId: r.agentId, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt ?? null })

let openBusy: Promise<void> | null = null
/** asked again while a request was out (an own agent added meanwhile): one more request right after it */
let openAgain = false

/**
 * Load the staged runs of this member's own server agents into `useServerAgents.open` (and each agent's newest run into
 * `openLatest`): ONE `GET agent-runs/open?agentIds=…` (staged only, without summaries / steps). An older server
 * without it (404): the last 50 runs of each own agent (`openMode: 'fallback'`). Local workspace / no own server
 * agent: nothing is asked, `open` is [] in a team, null locally.
 */
export function loadOpenServerRuns(): Promise<void> {
  if (openBusy) {
    openAgain = true
    return openBusy
  }
  openBusy = (async () => {
    try {
      do {
        openAgain = false
        await loadOpen()
      } while (openAgain)
    } finally {
      openBusy = null
    }
  })()
  return openBusy
}

async function loadOpen(): Promise<void> {
  const wsId = teamId()
  if (!wsId) {
    if (useServerAgents.getState().open !== null) useServerAgents.setState({ open: null, openLatest: null, openWs: null })
    return
  }
  const ids = ownServerAgentIds()
  if (!ids.length) {
    useServerAgents.setState({ open: [], openLatest: [], openWs: wsId })
    return
  }
  if (useServerAgents.getState().openWs !== wsId) useServerAgents.setState({ open: null, openLatest: null, openMode: 'lean', openWs: wsId })
  if (useServerAgents.getState().openMode === 'lean') {
    try {
      const raw = await cloudRequest<unknown>('GET', path(wsId, `agent-runs/open?agentIds=${ids.map(encodeURIComponent).join(',')}`))
      if (teamId() !== wsId) return
      const own = new Set(ids)
      const list = (Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.runs) ? raw.runs : []).map(readRun).filter((r): r is AgentRun => !!r && own.has(r.agentId) && r.status === 'staged')
      list.sort((a, b) => b.startedAt - a.startedAt)
      const heads = (isObj(raw) && Array.isArray(raw.latest) ? raw.latest : []).map(readHead).filter((h): h is ServerRunHead => !!h && own.has(h.agentId))
      useServerAgents.setState({ open: list, openLatest: heads, openMode: 'lean', openWs: wsId })
      return
    } catch (e) {
      if (teamId() !== wsId) return
      if (!unsupported(e)) return
      useServerAgents.setState({ openMode: 'fallback' })
    }
  }
  // an older server: the last 50 runs of each own agent (AgentsView's own request)
  await Promise.all(ids.map((id) => loadServerRuns(id, 50)))
  if (teamId() !== wsId) return
  const runs = useServerAgents.getState().runs
  const open = ids.flatMap((id) => (runs[id] ?? []).filter((r) => r.status === 'staged')).sort((a, b) => b.startedAt - a.startedAt)
  const heads = ids.map((id) => runs[id]?.[0]).filter((r): r is AgentRun => !!r).map(headOf)
  useServerAgents.setState({ open, openLatest: heads, openWs: wsId })
}

/** How often the open runs are asked for while the tab is visible. */
export const OPEN_POLL_MS = 60_000
/** … from an older server (the last 50 runs per own agent). */
export const OPEN_FALLBACK_MS = 5 * 60_000

/**
 * Keep `useServerAgents.open` fresh while this tab is VISIBLE (hidden tabs never ask): at start, when the tab becomes
 * visible (at most once per interval), every 60 s (5 min from an older server), and when this member's own server
 * agents or the workspace change. Team workspaces with own server agents only. Returns a stop function.
 */
export function startOpenServerPoll(): () => void {
  if (typeof document === 'undefined') return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0
  let key = ''
  const every = () => (useServerAgents.getState().openMode === 'fallback' ? OPEN_FALLBACK_MS : OPEN_POLL_MS)
  const visible = () => document.visibilityState === 'visible'
  const arm = (ms: number) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(tick, ms)
  }
  const poll = () => {
    last = Date.now()
    void loadOpenServerRuns()
  }
  function tick() {
    timer = undefined
    if (!visible()) return
    if (ownServerAgentIds().length) poll()
    arm(every())
  }
  const onVisible = () => {
    if (!visible()) {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      return
    }
    const wait = last + every() - Date.now()
    if (wait <= 0) tick()
    else arm(wait)
  }
  // the member's own server agents (or the workspace / account) changed: ask at once
  const check = () => {
    const next = `${teamId() ?? ''}|${ownServerAgentIds().join(',')}`
    if (next === key) return
    key = next
    // nothing to ask (local workspace, no own server agent): `open` says so without a request
    if (!teamId() || !ownServerAgentIds().length) {
      void loadOpenServerRuns()
      return
    }
    if (visible()) tick()
  }
  const offWs = useWorkspace.subscribe((s, p) => {
    if (s.agents !== p.agents) check()
  })
  const offCloud = useCloud.subscribe((s, p) => {
    if (s.active !== p.active || s.user !== p.user) check()
  })
  document.addEventListener('visibilitychange', onVisible)
  check()
  return () => {
    offWs()
    offCloud()
    document.removeEventListener('visibilitychange', onVisible)
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
}

/* ------------------------------------------------------------------ webhook URLs */

export interface HookState {
  set: boolean
  createdAt: string | null
  lastDeliveryAt: string | null
  deliveries: number
}

/** Whether a server agent has a webhook URL (the secret itself is never shown again). */
export async function getHook(agentId: ID): Promise<HookState> {
  const wsId = teamId()
  if (!wsId) throw new CloudError('unavailable', 'Not a team workspace.')
  const r = await cloudRequest<Record<string, unknown>>('GET', path(wsId, `agents/${encodeURIComponent(agentId)}/hook`))
  return {
    set: r?.set === true,
    createdAt: typeof r?.created_at === 'string' ? r.created_at : null,
    lastDeliveryAt: typeof r?.last_delivery_at === 'string' ? r.last_delivery_at : null,
    deliveries: typeof r?.deliveries === 'number' ? r.deliveries : 0,
  }
}

/** Admins: create (or regenerate — the old URL stops working) the webhook URL. Shown once. */
export async function createHook(agentId: ID): Promise<string> {
  const wsId = teamId()
  if (!wsId) throw new CloudError('unavailable', 'Not a team workspace.')
  const r = await cloudRequest<{ url?: string }>('POST', path(wsId, `agents/${encodeURIComponent(agentId)}/hook`))
  return typeof r?.url === 'string' ? r.url : ''
}

/** Admins: remove the webhook URL. */
export async function deleteHook(agentId: ID): Promise<void> {
  const wsId = teamId()
  if (!wsId) return
  await cloudRequest('DELETE', path(wsId, `agents/${encodeURIComponent(agentId)}/hook`))
}
