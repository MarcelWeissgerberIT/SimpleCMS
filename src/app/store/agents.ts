/**
 * Custom agents (Workspace.agents): the shape rules, and the sanitizer every copy from outside this
 * tab goes through — stored records, backups, the team meta document, the store's own writes. Unknown
 * fields are dropped, strings clamped, ids checked, enums defaulted; a value that is not an agent at
 * all is left out (never "fixed" into something else). Fresh objects only: nothing of the input's
 * prototype chain survives.
 */
import { COLOR_NAMES, type AgentTrigger, type AgentWriteMode, type ColorName, type CustomAgent, type ID, type PageIcon } from './types'

export const AGENT_LIMITS = {
  name: 80,
  instructions: 8000,
  /** pages + databases in a scope */
  scope: 200,
  mcpServers: 12,
  /** allowed tools per MCP server (mcpTools) */
  mcpTools: 200,
  /** agents per workspace */
  agents: 100,
  minRunUsd: 0.01,
  maxRunUsd: 50,
} as const

export const DEFAULT_RUN_USD = 0.5
export const AGENT_WRITE_MODES: AgentWriteMode[] = ['none', 'stage', 'apply']
export const SCHEDULE_EVERY = ['hour', 'day', 'weekday', 'week', 'month'] as const
export const AGENT_EFFORTS = ['low', 'medium', 'high'] as const

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
/** an MCP server name (features/ai/mcp-servers/config.ts) */
const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
/** an MCP tool name (mcpTools) */
const MCP_TOOL_RE = /^[A-Za-z0-9_.-]{1,128}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d)

export const isSafeAgentId = (id: unknown): id is ID => typeof id === 'string' && SAFE_ID.test(id) && !RESERVED_KEYS.has(id)

/** An account id as stored in createdBy / updatedBy (null when it is not one). */
const actorId = (v: unknown): string | null => (typeof v === 'string' && v && v.length <= 128 ? v : null)

let editor: () => string | null = () => null
/**
 * Who saves agents in this tab — upsertAgent stamps it as `updatedBy`: the signed-in account in a team
 * workspace, null in the local one. features/agents registers it (the store knows no accounts).
 */
export function setAgentEditor(fn: () => string | null): void {
  editor = fn
}
export const agentEditor = (): string | null => editor()

const zones = new Map<string, boolean>()
/** An IANA time zone this browser knows ("Europe/Berlin", "UTC"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  let ok = zones.get(tz)
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      ok = true
    } catch {
      ok = false
    }
    zones.set(tz, ok)
  }
  return ok
}

/** The browser's own time zone (UTC when it can't tell). */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isTimeZone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

function sanitizeIcon(v: unknown): PageIcon | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  const value = own(v, 'value')
  if (typeof value !== 'string' || !value || value.length > 64) return null
  if (type === 'emoji' || type === 'asset') return { type, value }
  if (type === 'lucide') {
    const color = own(v, 'color')
    return COLOR_NAMES.includes(color as ColorName) ? { type, value, color: color as ColorName } : { type, value }
  }
  return null
}

/** A clean trigger; anything unusable becomes a manual trigger. */
export function sanitizeTrigger(v: unknown): AgentTrigger {
  if (!isObj(v)) return { type: 'manual' }
  const type = own(v, 'type')
  if (type === 'schedule') {
    const every = SCHEDULE_EVERY.includes(own(v, 'every') as (typeof SCHEDULE_EVERY)[number]) ? (own(v, 'every') as (typeof SCHEDULE_EVERY)[number]) : 'day'
    const at = own(v, 'at')
    const tz = own(v, 'tz')
    const out: AgentTrigger = { type: 'schedule', every, at: typeof at === 'string' && TIME_RE.test(at) ? at : '08:00', tz: isTimeZone(tz) ? tz : 'UTC' }
    if (every === 'week') out.weekday = int(own(v, 'weekday'), 0, 6, 1)
    if (every === 'month') out.day = int(own(v, 'day'), 1, 31, 1)
    return out
  }
  if (type === 'row_created' || type === 'row_changed') {
    const db = own(v, 'databaseId')
    if (!isSafeAgentId(db)) return { type: 'manual' }
    if (type === 'row_created') return { type, databaseId: db }
    const prop = own(v, 'propertyId')
    return { type, databaseId: db, propertyId: isSafeAgentId(prop) ? prop : null }
  }
  if (type === 'webhook') return { type: 'webhook' }
  return { type: 'manual' }
}

/**
 * The tool allow-list of an agent (mcpTools): entries only for its servers, in their order; tool names checked,
 * de-duplicated, ≤ AGENT_LIMITS.mcpTools each. Undefined when no server has a list (= all tools everywhere).
 */
export function sanitizeMcpTools(v: unknown, servers: string[]): Record<string, string[]> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string[]> = {}
  for (const name of servers) {
    const list = own(v, name)
    if (!Array.isArray(list)) continue
    out[name] = [...new Set(list.filter((x): x is string => typeof x === 'string' && MCP_TOOL_RE.test(x)))].slice(0, AGENT_LIMITS.mcpTools)
  }
  return Object.keys(out).length ? out : undefined
}

function ids(v: unknown, max: number): ID[] {
  if (!Array.isArray(v)) return []
  const out: ID[] = []
  for (const x of v) {
    if (isSafeAgentId(x) && !out.includes(x)) out.push(x)
    if (out.length >= max) break
  }
  return out
}

/** A clean copy of an agent, or null when it is not one. `id`: the key it was stored under. */
export function sanitizeAgent(id: unknown, raw: unknown): CustomAgent | null {
  if (!isObj(raw) || !isSafeAgentId(id) || own(raw, 'id') !== id) return null
  const rawName = own(raw, 'name')
  const name = typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, AGENT_LIMITS.name) : ''
  if (!name) return null
  const instructions = own(raw, 'instructions')
  const scopeRaw = isObj(own(raw, 'scope')) ? (own(raw, 'scope') as Record<string, unknown>) : {}
  const pages = ids(own(scopeRaw, 'pages'), AGENT_LIMITS.scope)
  const databases = ids(own(scopeRaw, 'databases'), AGENT_LIMITS.scope - pages.length)
  const write = own(raw, 'write')
  const runner = own(raw, 'runner')
  const model = own(raw, 'model')
  const effort = own(raw, 'effort')
  const createdBy = own(raw, 'createdBy')
  const updatedBy = own(raw, 'updatedBy')
  const mcp = own(raw, 'mcpServers')
  const createdAt = num(own(raw, 'createdAt'), 0)
  const agent: CustomAgent = {
    id,
    name,
    icon: sanitizeIcon(own(raw, 'icon')),
    instructions: typeof instructions === 'string' ? instructions.slice(0, AGENT_LIMITS.instructions) : '',
    trigger: sanitizeTrigger(own(raw, 'trigger')),
    scope: { everything: own(scopeRaw, 'everything') === true, pages, databases },
    write: AGENT_WRITE_MODES.includes(write as AgentWriteMode) ? (write as AgentWriteMode) : 'stage',
    output: null,
    mcpServers: Array.isArray(mcp) ? [...new Set(mcp.filter((x): x is string => typeof x === 'string' && MCP_NAME_RE.test(x)))].slice(0, AGENT_LIMITS.mcpServers) : [],
    runner: runner === 'server' ? 'server' : 'browser',
    model: typeof model === 'string' && MODEL_RE.test(model) ? model : null,
    effort: AGENT_EFFORTS.includes(effort as (typeof AGENT_EFFORTS)[number]) ? (effort as (typeof AGENT_EFFORTS)[number]) : null,
    maxRunUsd: Math.min(AGENT_LIMITS.maxRunUsd, Math.max(AGENT_LIMITS.minRunUsd, Math.round(num(own(raw, 'maxRunUsd'), DEFAULT_RUN_USD) * 100) / 100)),
    enabled: own(raw, 'enabled') === true,
    createdBy: actorId(createdBy),
    updatedBy: actorId(updatedBy),
    createdAt,
    updatedAt: num(own(raw, 'updatedAt'), createdAt),
  }
  const mcpTools = sanitizeMcpTools(own(raw, 'mcpTools'), agent.mcpServers)
  if (mcpTools) agent.mcpTools = mcpTools
  // the mirror recipe's marker (features/agents/mirror.ts): a database id, nothing else
  const mirrorOf = own(raw, 'mirrorOf')
  if (isSafeAgentId(mirrorOf)) agent.mirrorOf = mirrorOf
  const output = own(raw, 'output')
  if (isObj(output)) {
    const pageId = own(output, 'pageId')
    agent.output = { pageId: isSafeAgentId(pageId) ? pageId : null, mode: own(output, 'mode') === 'replace' ? 'replace' : 'append' }
  }
  // the webhook trigger exists only on the server
  if (agent.trigger.type === 'webhook' && agent.runner !== 'server') agent.trigger = { type: 'manual' }
  return agent
}

/** Every valid agent of a stored / imported map (`dropped`: entries that were not valid). */
export function sanitizeAgents(raw: unknown): { agents: Record<ID, CustomAgent>; dropped: number } {
  const agents: Record<ID, CustomAgent> = {}
  let dropped = 0
  if (raw === undefined || raw === null) return { agents, dropped }
  if (!isObj(raw)) return { agents, dropped: 1 }
  for (const id of Object.keys(raw)) {
    const agent = Object.keys(agents).length < AGENT_LIMITS.agents ? sanitizeAgent(id, own(raw, id)) : null
    if (agent) agents[id] = agent
    else dropped++
  }
  return { agents, dropped }
}

/** Two agents hold the same definition (ignoring updatedAt). */
export function sameAgent(a: CustomAgent | undefined, b: CustomAgent | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}
