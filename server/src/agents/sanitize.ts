/**
 * The server's own reader of agent definitions (the meta document's `agents` map, written by the app):
 * unknown fields are dropped, strings clamped, ids validated, enums defaulted. An entry that cannot be
 * made into an agent (not an object, no valid id, a row trigger without a database) is ignored —
 * whatever a client wrote there never crashes the scheduler.
 */
import * as Y from 'yjs'
import { isTimeZone, parseAt } from './schedule.ts'
import type { AgentScope, AgentTrigger, CustomAgent, Effort, ScheduleEvery, WriteMode } from './types.ts'

export const MAX_INSTRUCTIONS = 8000
export const MAX_NAME = 200
const MAX_SCOPE_IDS = 500
const MAX_MCP = 12
/** Budget per run: at least a cent, at most this many dollars (a typo must not cost a fortune). */
export const MAX_RUN_USD = 50
export const DEFAULT_RUN_USD = 1

const ID = /^[A-Za-z0-9_-]{1,64}$/
/** An MCP server name as the app writes it (an `mcp_server_name`). */
export const MCP_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MODEL = /^claude-[a-z0-9][a-z0-9.-]{0,62}$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d)
const clamp = (v: unknown, max: number, d = ''): string => (typeof v === 'string' ? v.slice(0, max) : d)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d)

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter(isId))].slice(0, MAX_SCOPE_IDS)
}

/** A trigger, or null when it cannot work (a row trigger without a valid database id). */
export function sanitizeTrigger(v: unknown): AgentTrigger | null {
  const t = isObj(v) ? v : {}
  switch (t.type) {
    case 'schedule': {
      const every = oneOf<ScheduleEvery>(t.every, ['hour', 'day', 'weekday', 'week', 'month'], 'day')
      const at = parseAt(t.at)
      const tz = isTimeZone(t.tz) ? t.tz : 'UTC'
      return {
        type: 'schedule',
        every,
        at: at ? `${String(at[0]).padStart(2, '0')}:${String(at[1]).padStart(2, '0')}` : '09:00',
        ...(every === 'week' ? { weekday: int(t.weekday, 0, 6, 1) } : {}),
        ...(every === 'month' ? { day: int(t.day, 1, 31, 1) } : {}),
        tz,
      }
    }
    case 'row_created':
      return isId(t.databaseId) ? { type: 'row_created', databaseId: t.databaseId } : null
    case 'row_changed':
      return isId(t.databaseId) ? { type: 'row_changed', databaseId: t.databaseId, propertyId: isId(t.propertyId) ? t.propertyId : null } : null
    case 'webhook':
      return { type: 'webhook' }
    default:
      return { type: 'manual' }
  }
}

function sanitizeScope(v: unknown): AgentScope {
  const s = isObj(v) ? v : {}
  return { everything: s.everything === true, pages: ids(s.pages), databases: ids(s.databases) }
}

/**
 * One agent (`key`: its id in the `agents` map), or null when it cannot be one. Agents are JSON objects;
 * a Y type or binary value there is not one (the app ignores it too, and the server stamps who changed
 * JSON entries only — collab/agent-authors.ts).
 */
export function sanitizeAgent(key: string, v: unknown): CustomAgent | null {
  if (!isObj(v) || v instanceof Y.AbstractType || v instanceof Y.Doc || ArrayBuffer.isView(v) || !isId(key)) return null
  if (v.id !== undefined && v.id !== key) return null
  const trigger = sanitizeTrigger(v.trigger)
  if (!trigger) return null
  const out = isObj(v.output) && isId(v.output.pageId) ? { pageId: v.output.pageId, mode: oneOf(v.output.mode, ['append', 'replace'] as const, 'append') } : null
  const mcp = Array.isArray(v.mcpServers) ? [...new Set(v.mcpServers.filter((n): n is string => typeof n === 'string' && MCP_NAME.test(n)))].slice(0, MAX_MCP) : []
  const createdAt = num(v.createdAt, 0)
  return {
    id: key,
    name: clamp(v.name, MAX_NAME).trim() || 'Agent',
    instructions: clamp(v.instructions, MAX_INSTRUCTIONS),
    trigger,
    scope: sanitizeScope(v.scope),
    write: oneOf<WriteMode>(v.write, ['none', 'stage', 'apply'], 'stage'),
    output: out,
    mcpServers: mcp,
    runner: oneOf(v.runner, ['browser', 'server'] as const, 'browser'),
    model: typeof v.model === 'string' && MODEL.test(v.model) ? v.model : null,
    effort: v.effort === 'low' || v.effort === 'medium' || v.effort === 'high' ? (v.effort as Effort) : null,
    maxRunUsd: Math.min(MAX_RUN_USD, Math.max(0.01, num(v.maxRunUsd, DEFAULT_RUN_USD))),
    enabled: v.enabled === true,
    createdBy: typeof v.createdBy === 'string' ? v.createdBy.slice(0, 128) : null,
    updatedBy: typeof v.updatedBy === 'string' && v.updatedBy ? v.updatedBy.slice(0, 128) : null,
    createdAt,
    updatedAt: num(v.updatedAt, createdAt),
  }
}

/** Every valid agent in a meta document (`agents` map). */
export function readAgents(doc: Y.Doc): CustomAgent[] {
  const out: CustomAgent[] = []
  for (const [key, raw] of doc.getMap<unknown>('agents').entries()) {
    try {
      const a = sanitizeAgent(key, raw)
      if (a) out.push(a)
    } catch {
      /* a broken entry is ignored */
    }
  }
  return out
}

/** The agents the server runs: runner 'server' and switched on. */
export const serverAgents = (agents: CustomAgent[]) => agents.filter((a) => a.runner === 'server' && a.enabled)
