/**
 * Workspace agent — session state (this tab only, never persisted). Kept light: the panel
 * body, the loop and the tools load lazily when the panel opens (AgentPanel.tsx).
 */
import { create } from 'zustand'
import { EMPTY_USAGE, type AgentStatus, type AgentStep, type AgentTurn, type AgentUsage, type StagedChange } from './types'

export interface AgentState {
  open: boolean
  /** text in the task field */
  draft: string
  /** run the draft as soon as the panel is ready (opened with a task from the AI menu) */
  autorun: boolean
  status: AgentStatus
  turns: AgentTurn[]
  steps: AgentStep[]
  changes: StagedChange[]
  usage: AgentUsage
  /** text of the response streaming right now */
  live: string
  /** tool calls in the running task */
  calls: number
}

export const initialAgentState = (): Omit<AgentState, 'open' | 'draft' | 'autorun'> => ({
  status: 'idle',
  turns: [],
  steps: [],
  changes: [],
  usage: { ...EMPTY_USAGE },
  live: '',
  calls: 0,
})

export const useAgent = create<AgentState>()(() => ({ open: false, draft: '', autorun: false, ...initialAgentState() }))

/** Set by the session while a task runs (closing the panel stops it). */
let stopRunning: (() => void) | null = null
export function setStopHandler(fn: (() => void) | null) {
  stopRunning = fn
}

/** Open the agent panel, optionally with a task (run: start it right away). */
export function openAgent(opts: { task?: string; run?: boolean } = {}) {
  const task = opts.task?.trim()
  useAgent.setState((s) => ({
    open: true,
    draft: task && s.status !== 'running' ? task : s.draft,
    autorun: !!task && !!opts.run && s.status !== 'running',
  }))
}

/** Close the panel. A running task is stopped (it spends tokens); the session stays until "New task". */
export function closeAgent() {
  stopRunning?.()
  useAgent.setState({ open: false, autorun: false })
}

export function toggleAgent() {
  if (useAgent.getState().open) closeAgent()
  else openAgent()
}
