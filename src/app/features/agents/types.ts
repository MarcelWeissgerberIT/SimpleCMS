/**
 * Custom agents — run records (shared contract with the server runner: the browser keeps them per
 * device in IndexedDB "one-agents", the server in its table `agent_runs`; same JSON shape).
 */
import type { MediaItem } from '../ai/media/types'
import type { AgentTrigger, CustomAgent, ID } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import type { AgentState } from './runs'
import type { ModelLine } from '../ai/core/meter'
import type { Band, RefuseDetail } from '../governor'

export type { AgentTrigger, CustomAgent }

/**
 * 'budget' = the agent's own maxRunUsd was passed (a failure, red lamp) · 'held' = the Regler held the run at a red line
 * (features/governor: not started, or stopped between two steps — never a failure, no red lamp; older builds read it as
 * an unknown status that did not fail)
 */
export type AgentRunStatus = 'running' | 'ok' | 'staged' | 'error' | 'budget' | 'skipped' | 'held'

/** Why the Regler held a run: the line that bound (day · month · device-day · device-month · run), no price, no account yet. */
export type HeldBinding = RefuseDetail

/**
 * status 'held' (Regler § 5.8): 'notStarted' = one record per agent and local day (id `held-<yyyy-MM-dd>`, held.ts) that
 * counts the starts held that day; 'stopped' = a run stopped between two steps, its proposals kept for review and the
 * agent's old state kept (its notes dropped, no report).
 */
export interface AgentRunHeld {
  kind: 'stopped' | 'notStarted'
  binding: HeldBinding
  /** the binding line's spend and limit then ("6,00 $ von 6,00 $"; absent: no line — no price, no account) */
  spent?: number
  limit?: number
  /** notStarted: how many starts were held that day */
  count?: number
  /** notStarted: when (the newest HELD_TIMES kept) */
  times?: number[]
}

/** A run the Regler stopped mid-run: the brake's numbers at the stop (the run row's Regler line). */
export interface AgentRunBrake {
  binding: HeldBinding
  /** the lowest rest then (the run's own reservation excluded) */
  rest: number
  /** the next step's band (null: no price) */
  next: Band | null
}

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
  /** status 'held': what held it (features/governor) */
  held?: AgentRunHeld
  /** status 'held' kind 'stopped': the brake's numbers at the stop */
  brake?: AgentRunBrake
  /** proposals of older runs dropped over the keep limit (runs.ts pruning) — said on this run, never silently */
  pruned?: number
  /** a Regler line was set when the run ended: the line nearest its limit then (the run row's "Governor today …") */
  regler?: AgentRunRegler
}

/** The Regler's line at a run's end: spent of the limit (today's, or this month's when that one was nearer). */
export interface AgentRunRegler {
  binding: 'day' | 'month' | 'device-day' | 'device-month'
  spent: number
  limit: number
}
