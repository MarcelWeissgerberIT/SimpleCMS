/**
 * Custom agents — run records (shared contract with the server runner: the browser keeps them per
 * device in IndexedDB "one-agents", the server in its table `agent_runs`; same JSON shape).
 */
import type { MediaItem } from '../ai/media/types'
import type { AgentTrigger, CustomAgent, ID } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import type { AgentState } from './runs'
import type { ModelLine } from '../ai/core/meter'
import type { DataClass } from '@/shared/ai/types'

export type { AgentTrigger, CustomAgent }

export type AgentRunStatus = 'running' | 'ok' | 'staged' | 'error' | 'budget' | 'skipped'

export interface AgentRunStep {
  kind: 'tool' | 'mcp' | 'note'
  label: string
  state: 'ok' | 'err'
}

export interface AgentRunUsage {
  input: number
  output: number
  cacheRead: number
  usd: number
  /** browser runs: a line per provider × model that answered (the run's ledger entries summed) — the run's receipt */
  byModel?: ModelLine[]
}

export interface AgentRun {
  id: string
  agentId: ID
  runner: 'browser' | 'server'
  /** browser runs: the run's number for this agent on this device (1, 2, 3 …; runs.ts nextSeq) — server runs have none */
  seq?: number
  /** e.g. a row id / "schedule 08:00" */
  trigger: { type: AgentTrigger['type']; detail?: string }
  startedAt: number
  endedAt?: number
  status: AgentRunStatus
  /** Markdown report of what it did / found */
  summary: string
  steps: AgentRunStep[]
  /** write 'stage': the proposals (features/ai/agent/types.ts StagedChange) · write 'apply': what was applied */
  staged?: StagedChange[]
  /** write 'apply': number of changes written */
  applied?: number
  usage?: AgentRunUsage
  /** never a key or a token */
  error?: string | null
  /** browser runs (local only): staged row id → the id the row got when it was applied */
  rowIds?: Record<string, ID>
  /**
   * browser runs (local only) whose proposals wait for review and that saved an agent state: the state it replaced
   * (null: none was saved). Every proposal discarded, none applied → it goes back (review.ts), while the saved state
   * is still this run's.
   */
  stateBefore?: AgentState | null
  /** media the agent's MCP servers returned (features/ai/media): cards in the run, saved only on a click */
  media?: MediaItem[]
  /**
   * browser runs with a Vorprüfer (slice SJ): the data classes of what the run's tools returned to Claude (the pages they
   * named, MCP results, the memory) — a pre-check of its proposals declares them too
   */
  touched?: DataClass[]
}
