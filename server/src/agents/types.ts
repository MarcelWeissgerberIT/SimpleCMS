/**
 * Custom agents — the shared contract (docs/CLOUD.md § Agents). Definitions live in the workspace meta
 * document's `agents` map (JSON values, written by the app); runs are the server's own (`agent_runs`).
 * The JSON shapes here are the app's: a run the server stores reads exactly like one the browser runner
 * stores, and staged changes are the app's `StagedChange` (src/app/features/ai/agent/types.ts).
 */

export type AgentTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; every: ScheduleEvery; at: string; weekday?: number; day?: number; tz: string }
  | { type: 'row_created'; databaseId: string }
  | { type: 'row_changed'; databaseId: string; propertyId: string | null }
  | { type: 'webhook' }

export type ScheduleEvery = 'hour' | 'day' | 'weekday' | 'week' | 'month'
export type ScheduleTrigger = Extract<AgentTrigger, { type: 'schedule' }>
export type TriggerType = AgentTrigger['type']
export type WriteMode = 'none' | 'stage' | 'apply'
export type Effort = 'low' | 'medium' | 'high'

export interface AgentScope {
  everything: boolean
  pages: string[]
  databases: string[]
}

export interface CustomAgent {
  id: string
  name: string
  instructions: string
  trigger: AgentTrigger
  scope: AgentScope
  write: WriteMode
  output: { pageId: string; mode: 'append' | 'replace' } | null
  mcpServers: string[]
  /** per attached MCP server: the only tools the agent may use (absent / no entry = all, [] = none: left out) */
  mcpTools?: Record<string, string[]>
  runner: 'browser' | 'server'
  model: string | null
  effort: Effort | null
  maxRunUsd: number
  enabled: boolean
  createdBy: string | null
  /** who saved it last (account id, written by the app; the browser runner's confirmation — kept, not used here) */
  updatedBy?: string | null
  createdAt: number
  updatedAt: number
}

export type RunStatus = 'running' | 'ok' | 'staged' | 'error' | 'budget' | 'skipped'

export interface RunStep {
  kind: 'tool' | 'mcp' | 'note'
  label: string
  state: 'ok' | 'err'
}

export interface RunUsage {
  input: number
  output: number
  cacheRead: number
  usd: number
}

/** A property value as staged: resolved to ids only when the change is applied (the app's PropIntent). */
export type PropIntent = { kind: 'value'; value: unknown } | { kind: 'options'; names: string[] }

export interface PropChange {
  propId: string
  name: string
  type: string
  /** display text of the stored value when the change was staged ('' = empty) */
  before: string
  /** display text of the proposed value */
  after: string
  intent: PropIntent
  /** option names that do not exist yet (created on apply) */
  newOptions?: string[]
}

export type ChangeKind = 'create_page' | 'append' | 'create_row' | 'update_row' | 'rename'
export type ChangeStatus = 'pending' | 'applied' | 'discarded' | 'failed'

export interface StagedChange {
  id: string
  /** position in the review list (#1, #2 …) */
  n: number
  kind: ChangeKind
  status: ChangeStatus
  /** the page the change is about: an existing page, or the id a new page / row gets */
  pageId: string
  parentId?: string | null
  databaseId?: string
  title?: string
  beforeTitle?: string
  markdown?: string
  props?: PropChange[]
  /** id of the staged change that creates this change's parent page */
  dependsOn?: string
  error?: string
}

export interface AgentRun {
  id: string
  agentId: string
  runner: 'browser' | 'server'
  trigger: { type: TriggerType; detail?: string }
  startedAt: number
  endedAt?: number
  status: RunStatus
  summary: string
  steps: RunStep[]
  staged?: StagedChange[]
  applied?: number
  usage?: RunUsage
  error?: string | null
}

/** An agent's own small state between runs (agent_state_set; sealed at rest, saved only when a run ends ok). */
export interface AgentStateRow {
  json: string
  at: number
  runId: string
}

/** What a workspace's server runtime holds (sealed at rest; secrets never leave the server). */
export interface Runtime {
  claudeKey: string | null
  mcpServers: Array<{ name: string; url: string; token: string | null }>
}

/** The author prefix of everything an agent writes (`createdBy` / `updatedBy`). */
export const AGENT_ACTOR = 'agent:'
export const agentActor = (agentId: string) => `${AGENT_ACTOR}${agentId}`
