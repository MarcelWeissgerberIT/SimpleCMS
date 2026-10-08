/**
 * Custom agents — the team server's runner (docs/API.md § Agents): its runtime (the server's Claude
 * key and MCP servers — secrets are never returned, only set / last 4), its runs, "run now" and the
 * review of staged server runs (the client applies with apply.ts, then marks the run resolved). An
 * older server without these endpoints answers 404: everything reports 'unsupported' then.
 */
import { create } from 'zustand'
import { CloudError, cloudRequest, useCloud } from '../../cloud'
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

interface ServerAgentsState {
  /** the workspace the state belongs to */
  ws: string | null
  state: ServerState
  runtime: AgentRuntime | null
  error: string | null
  /** server runs per agent, newest first */
  runs: Record<ID, AgentRun[]>
  runsState: Record<ID, ServerState>
}

export const useServerAgents = create<ServerAgentsState>()(() => ({ ws: null, state: 'idle', runtime: null, error: null, runs: {}, runsState: {} }))

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

/** Update one server run in the cache (after a review here). */
export function patchServerRun(run: AgentRun): void {
  useServerAgents.setState((s) => ({ runs: { ...s.runs, [run.agentId]: (s.runs[run.agentId] ?? []).map((r) => (r.id === run.id ? run : r)) } }))
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
