/**
 * Custom agents over HTTP (docs/API.md § Custom agents, docs/CLOUD.md § Agents).
 *
 * Cookie session, under /api/workspaces/:id:
 *   GET  agent-runtime                      members+: Claude key and MCP tokens as { set, last4 } only
 *   PUT  agent-runtime                      admins: key, MCP servers, on/off (secrets sealed, never returned)
 *   GET  agent-runs?agentId=&limit=         every member (viewers too): AgentRun[], newest first
 *   POST agents/:agentId/run                members+: start a run now → 202 { runId }
 *   POST agent-runs/:runId/apply            members+: apply staged changes on the server
 *   POST agent-runs/:runId/resolve          members+: the app applied / discarded them itself
 *   GET|POST|DELETE agents/:agentId/hook    the agent's webhook URL (secret shown once; admins create)
 *
 * Public (no cookie, the secret is the credential):
 *   POST /api/v1/agents/:agentId/hook/:secret   body ≤ 16 KB, passed to the agent as DATA → 202 { runId }
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { WorkspaceModel } from '../api/model.ts'
import { failedAttempt } from '../api/auth.ts'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, conflict, notFound, rateLimited } from '../errors.ts'
import { body, idSchema } from '../http/util.ts'
import { McpWrites } from '../mcp/writes.ts'
import { access } from '../routes/access.ts'
import { MINUTE, iso, isTokenShape } from '../tokens.ts'
import { MCP_NAME } from './sanitize.ts'
import { type AgentService, QueueFullError } from './service.ts'
import { applyStaged } from './stage.ts'
import { EMPTY_RUNTIME, type RuntimeRow } from './store.ts'
import { type AgentRun, type Runtime, agentActor } from './types.ts'

/** Webhook body limit (the body is passed to Claude). */
export const HOOK_BODY_LIMIT = 16 * 1024
/** Webhook deliveries per agent per minute (every delivery is a Claude run). */
export const HOOK_PER_MIN = 10
export const MAX_MCP_SERVERS = 12

const agentsOff = () => new ApiError(503, 'agents_off', 'Custom agents are switched off on this server (AGENTS=off)')

/** A secret as the API shows it: set or not, and its last four characters when it is long enough. */
const secretState = (v: string | null | undefined) => (v ? { set: true, ...(v.length >= 16 ? { last4: v.slice(-4) } : {}) } : { set: false })

/** Why Anthropic could not reach an MCP server URL ('' = fine): https, a public host, no credentials. */
export function mcpUrlProblem(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return 'is not a valid URL'
  }
  if (u.protocol !== 'https:') return 'must start with https:// (Anthropic connects to it over the internet)'
  if (u.username || u.password) return 'must not contain a user name or password (use the token)'
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]' || !host.includes('.')) {
    return 'must be a public address (Anthropic connects to it, not this server)'
  }
  return ''
}

const runtimeSchema = z.object({
  claudeKey: z.string().trim().min(20).max(400).regex(/^\S+$/, 'no spaces').nullable().optional(),
  mcpServers: z
    .array(
      z.object({
        name: z.string().regex(MCP_NAME, 'lower-case letters, digits, "-" and "_" (at most 32)'),
        url: z.string().trim().min(1).max(2000),
        token: z.string().trim().max(4000).nullable().optional(),
      }),
    )
    .max(MAX_MCP_SERVERS)
    .optional(),
  enabled: z.boolean().optional(),
})

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

export function agentRoutes(s: Services, model: WorkspaceModel, agents: AgentService) {
  const app = new Hono<AppEnv>()
  const writes = new McpWrites(s, model)
  /** Runs whose staged changes are being applied right now (one apply per run at a time). */
  const applying = new Set<string>()

  const runtimeJson = (row: RuntimeRow | null) => {
    const rt = row?.runtime ?? EMPTY_RUNTIME
    return {
      claudeKey: secretState(rt.claudeKey),
      mcpServers: rt.mcpServers.map((m) => ({ name: m.name, url: m.url, token: secretState(m.token) })),
      enabled: !!row?.enabled,
      available: agents.enabled,
      updated_at: iso(row?.updatedAt ?? null),
    }
  }

  // ── runtime ──────────────────────────────────────────────────────────

  app.get('/:id/agent-runtime', (c) => {
    const { workspace } = access(s, c, 'member')
    return c.json(runtimeJson(agents.store.runtime(workspace.id)))
  })

  app.put('/:id/agent-runtime', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(c, runtimeSchema)
    const cur = agents.store.runtime(workspace.id)
    const prev = cur?.runtime ?? EMPTY_RUNTIME
    let mcpServers = prev.mcpServers
    if (input.mcpServers) {
      const names = new Set<string>()
      mcpServers = input.mcpServers.map((m) => {
        if (names.has(m.name)) throw new ApiError(400, 'invalid_request', `mcpServers: the name "${m.name}" is used twice`)
        names.add(m.name)
        const problem = mcpUrlProblem(m.url)
        if (problem) throw new ApiError(400, 'invalid_request', `mcpServers: the URL of "${m.name}" ${problem}`)
        // a kept token only ever goes to the server it was given for: a new origin needs it again
        const old = prev.mcpServers.find((x) => x.name === m.name)
        const kept = old && sameOrigin(old.url, m.url) ? old.token : null
        return { name: m.name, url: m.url.trim(), token: m.token === undefined ? kept : m.token || null }
      })
    }
    const runtime: Runtime = { claudeKey: input.claudeKey === undefined ? prev.claudeKey : input.claudeKey || null, mcpServers }
    const enabled = input.enabled ?? cur?.enabled ?? false
    agents.store.saveRuntime(workspace.id, runtime, enabled, auth.user.id)
    s.log.info('agent runtime updated', {
      workspace: workspace.id,
      user: auth.user.id,
      key: input.claudeKey === undefined ? undefined : input.claudeKey ? 'set' : 'removed',
      mcp: input.mcpServers ? mcpServers.length : undefined,
      enabled,
    })
    return c.json(runtimeJson(agents.store.runtime(workspace.id)))
  })

  // ── runs ─────────────────────────────────────────────────────────────

  app.get('/:id/agent-runs', (c) => {
    const { workspace } = access(s, c, 'viewer')
    const agentId = c.req.query('agentId') || null
    if (agentId !== null && !idSchema.safeParse(agentId).success) throw new ApiError(400, 'invalid_request', 'agentId is not an id')
    const limit = c.req.query('limit') === undefined ? 50 : Number(c.req.query('limit'))
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ApiError(400, 'invalid_request', 'limit is a whole number from 1 to 200')
    return c.json(agents.store.runs(workspace.id, { agentId, limit }))
  })

  app.post('/:id/agents/:agentId/run', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    if (!agents.enabled) throw agentsOff()
    const agentId = c.req.param('agentId')
    const agent = idSchema.safeParse(agentId).success ? await agents.agent(workspace.id, agentId) : undefined
    if (!agent) throw notFound('agent_not_found', 'No such agent in this workspace')
    if (agent.runner !== 'server') throw conflict('agent_not_server', 'This agent runs in the browser, not on the server')
    const rt = agents.store.runtime(workspace.id)
    if (!rt?.enabled || !rt.runtime.claudeKey) throw conflict('runtime_not_ready', 'The server runtime is not set up: an admin adds a Claude key and switches it on')
    let run: AgentRun
    try {
      run = agents.enqueue({ wsId: workspace.id, agentId, trigger: { type: 'manual', detail: auth.user.name || auth.user.email.split('@')[0] }, by: auth.user.name || auth.user.email.split('@')[0] })
    } catch (err) {
      if (err instanceof QueueFullError) throw conflict('queue_full', 'Too many runs of this agent are waiting already')
      throw err
    }
    s.log.info('agent run requested', { workspace: workspace.id, agent: agentId, run: run.id, user: auth.user.id })
    return c.json({ runId: run.id }, 202)
  })

  /** A run with staged changes, for the member resolving them (one at a time per run). */
  const stagedRun = (wsId: string, runId: string): AgentRun => {
    const run = idSchema.safeParse(runId).success ? agents.store.run(wsId, runId) : undefined
    if (!run) throw notFound('run_not_found', 'No such agent run')
    if (run.status === 'running') throw conflict('run_running', 'The run has not finished yet')
    return run
  }

  const settle = (run: AgentRun): AgentRun => {
    const pending = (run.staged ?? []).some((x) => x.status === 'pending')
    return { ...run, status: run.status === 'staged' && !pending ? 'ok' : run.status }
  }

  app.post('/:id/agent-runs/:runId/apply', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const input = await body(c, z.object({ changeIds: z.array(z.string().max(64)).max(500).optional() }))
    const runId = c.req.param('runId')
    if (applying.has(runId)) throw conflict('run_busy', 'These changes are being applied already')
    applying.add(runId)
    try {
      const run = stagedRun(workspace.id, runId)
      const staged = (run.staged ?? []).map((x) => ({ ...x }))
      const applied = await applyStaged(model, writes, workspace.id, staged, agentActor(run.agentId), input.changeIds ? new Set(input.changeIds) : null)
      const next = settle({ ...run, staged, applied: (run.applied ?? 0) + applied })
      agents.store.updateRun(workspace.id, next)
      s.log.info('agent changes applied', { workspace: workspace.id, agent: run.agentId, run: run.id, applied, failed: staged.filter((x) => x.status === 'failed').length || undefined, user: auth.user.id })
      return c.json(next)
    } finally {
      applying.delete(runId)
    }
  })

  app.post('/:id/agent-runs/:runId/resolve', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const input = await body(c, z.object({ applied: z.array(z.string().max(64)).max(500).default([]), discarded: z.array(z.string().max(64)).max(500).default([]) }))
    const runId = c.req.param('runId')
    if (applying.has(runId)) throw conflict('run_busy', 'These changes are being applied right now')
    const run = stagedRun(workspace.id, runId)
    const done = new Set(input.applied)
    const dropped = new Set(input.discarded)
    let applied = 0
    const staged = (run.staged ?? []).map((x) => {
      if (x.status !== 'pending' && x.status !== 'failed') return x
      if (done.has(x.id)) {
        applied++
        const { error: _e, ...rest } = x
        return { ...rest, status: 'applied' as const }
      }
      return dropped.has(x.id) ? { ...x, status: 'discarded' as const } : x
    })
    const next = settle({ ...run, staged, applied: (run.applied ?? 0) + applied })
    agents.store.updateRun(workspace.id, next)
    s.log.info('agent changes resolved', { workspace: workspace.id, agent: run.agentId, run: run.id, applied, discarded: dropped.size || undefined, user: auth.user.id })
    return c.json(next)
  })

  // ── webhook URLs ─────────────────────────────────────────────────────

  const hookUrl = (agentId: string, secret: string) => `${s.config.publicUrl}/api/v1/agents/${agentId}/hook/${secret}`
  const agentParam = (raw: string | undefined) => {
    if (!raw || !idSchema.safeParse(raw).success) throw notFound('agent_not_found', 'No such agent in this workspace')
    return raw
  }

  app.get('/:id/agents/:agentId/hook', async (c) => {
    const { workspace } = access(s, c, 'member')
    const agentId = agentParam(c.req.param('agentId'))
    if (!(await agents.agent(workspace.id, agentId))) throw notFound('agent_not_found', 'No such agent in this workspace')
    const hook = agents.store.hook(workspace.id, agentId)
    return c.json({ set: !!hook, created_at: iso(hook?.created_at), last_delivery_at: iso(hook?.last_delivery_at), deliveries: hook?.deliveries ?? 0 })
  })

  app.post('/:id/agents/:agentId/hook', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const agentId = agentParam(c.req.param('agentId'))
    const agent = await agents.agent(workspace.id, agentId)
    if (!agent) throw notFound('agent_not_found', 'No such agent in this workspace')
    const secret = agents.store.setHook(workspace.id, agentId, auth.user.id)
    s.log.info('agent webhook created', { workspace: workspace.id, agent: agentId, user: auth.user.id })
    return c.json({ url: hookUrl(agentId, secret), created_at: iso(Date.now()) }, 201)
  })

  app.delete('/:id/agents/:agentId/hook', (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const agentId = agentParam(c.req.param('agentId'))
    if (!agents.store.deleteHook(workspace.id, agentId)) throw notFound('hook_not_found', 'This agent has no webhook URL')
    s.log.info('agent webhook deleted', { workspace: workspace.id, agent: agentId, user: auth.user.id })
    return c.body(null, 204)
  })

  return app
}

/** POST /api/v1/agents/:agentId/hook/:secret — a webhook delivery starts the agent (the body is data). */
export function agentHookRoutes(s: Services, agents: AgentService) {
  const app = new Hono<AppEnv>()
  const limit = bodyLimit({
    maxSize: HOOK_BODY_LIMIT,
    onError: () => {
      throw new ApiError(413, 'payload_too_large', `The body is larger than ${HOOK_BODY_LIMIT / 1024} KB`)
    },
  })

  app.post('/:agentId/hook/:secret', limit, async (c) => {
    const secret = c.req.param('secret')
    const hook = isTokenShape(secret) ? agents.store.hookBySecret(secret) : undefined
    if (!hook || hook.agent_id !== c.req.param('agentId')) throw failedAttempt(s, c, notFound('hook_not_found', 'This webhook URL does not exist (deleted or regenerated)'))
    const wait = s.limiter.hit(`agent:hook:${hook.workspace_id}:${hook.agent_id}`, HOOK_PER_MIN, MINUTE)
    if (wait) throw rateLimited(wait)
    if (!agents.enabled) throw agentsOff()
    const text = await c.req.text()
    if (Buffer.byteLength(text) > HOOK_BODY_LIMIT) throw new ApiError(413, 'payload_too_large', `The body is larger than ${HOOK_BODY_LIMIT / 1024} KB`)
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    let data = text
    if (type.includes('json') && text.trim()) {
      try {
        data = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON')
      }
    }
    const rt = agents.store.runtime(hook.workspace_id)
    if (!rt?.enabled || !rt.runtime.claudeKey) throw conflict('runtime_not_ready', 'The server runtime of this workspace is not set up')
    const agent = await agents.agent(hook.workspace_id, hook.agent_id)
    if (!agent || agent.runner !== 'server' || !agent.enabled || agent.trigger.type !== 'webhook') throw conflict('agent_unavailable', 'This agent is switched off or is not started by a webhook')
    let run: AgentRun
    try {
      run = agents.enqueue({ wsId: hook.workspace_id, agentId: hook.agent_id, trigger: { type: 'webhook', detail: data.slice(0, HOOK_BODY_LIMIT) }, webhook: { body: data, contentType: type || 'text/plain' } })
    } catch (err) {
      if (err instanceof QueueFullError) throw new ApiError(429, 'queue_full', 'Too many runs of this agent are waiting already', { headers: { 'Retry-After': '60' } })
      throw err
    }
    agents.store.recordDelivery(hook.workspace_id, hook.agent_id)
    return c.json({ runId: run.id }, 202)
  })

  return app
}
