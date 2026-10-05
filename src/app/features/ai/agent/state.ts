/**
 * AI terminal (the workspace agent) — session state (this tab only, never persisted). Kept light:
 * the terminal body, the loop and the tools load lazily when it opens (AgentPanel.tsx). A task
 * keeps running while the terminal is hidden; only Stop ends it.
 */
import { create } from 'zustand'
import { EMPTY_USAGE, type AgentStatus, type AgentStep, type AgentTurn, type AgentUsage, type StagedChange, type TermMention, type TermRef } from './types'
import type { MemoryProposal } from '../memory/types'
import type { ID } from '../../../store/types'

/** One memory: a proposal in the log ("MERKEN? · 2"), saved only on the person's OK. */
export interface MemItem {
  id: string
  p: MemoryProposal
  status: 'pending' | 'saved' | 'updated' | 'dismissed'
  /** a near-identical active memory: y updates it instead */
  dup: ID | null
  /** the memory row once saved / updated */
  rowId?: ID
}

/** A card of proposals after `after` tasks: after a task (Claude proposed) or from /remember. */
export interface MemCard {
  id: string
  after: number
  origin: 'task' | 'command'
  state: 'loading' | 'ready'
  items: MemItem[]
  /** the command that made it (/remember …), shown like command output */
  input?: string
}

/** Output of a local command (/help, /cost …), shown in the log after `after` tasks. */
export interface EchoEntry {
  id: string
  after: number
  input: string
  kind: 'help' | 'history' | 'mcp' | 'cost' | 'unknown' | 'info'
  /** kind 'info': message key + vars · 'history': the prompts · 'mcp': server names · 'cost': usage snapshot */
  data?: { key?: string; vars?: Record<string, string | number>; list?: string[]; usage?: AgentUsage; requests?: number }
}

export interface AgentState {
  open: boolean
  /** text in the prompt */
  draft: string
  /** run the draft as soon as the terminal is ready (opened with a task from the AI menu) */
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
  /** the MCP setup this conversation runs with (pinned at its first task; null = none yet) */
  mcp: { key: string; names: string[] } | null
  /** local command output */
  echo: EchoEntry[]
  /** selections sent along with the next task (chips) */
  refs: TermRef[]
  /** @ mentions in the prompt */
  mentions: TermMention[]
  /** the open page's chip was removed (for this page id) */
  pageOff: string | null
  /** a task ended while the terminal was hidden (the status bar shows it until it is opened) */
  unseen: 'done' | 'error' | null
  /** dock height as a share of the content area (per device) · maximised */
  height: number
  max: boolean
  /** bumped to move focus to the prompt (Mod+Shift+J while open) */
  focusTick: number
  /** One memory: proposal cards in the log */
  memCards: MemCard[]
  /** /no-memory: the next task goes without the One memory */
  memOffNext: boolean
}

export const initialAgentState = (): Pick<AgentState, 'status' | 'turns' | 'steps' | 'changes' | 'usage' | 'live' | 'calls' | 'mcp' | 'echo' | 'unseen' | 'memCards' | 'memOffNext'> => ({
  status: 'idle',
  turns: [],
  steps: [],
  changes: [],
  usage: { ...EMPTY_USAGE },
  live: '',
  calls: 0,
  mcp: null,
  echo: [],
  unseen: null,
  memCards: [],
  memOffNext: false,
})

/* ---------- dock height (a per-device convenience: localStorage, may be unavailable) ---------- */

const HEIGHT_KEY = 'one.term.height'
export const HEIGHT_MIN = 0.2
export const HEIGHT_MAX = 0.92
export const HEIGHT_DEFAULT = 0.4

export const clampHeight = (h: number) => Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, h))

function storedHeight(): number {
  try {
    const v = Number(window.localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(v) && v > 0 ? clampHeight(v) : HEIGHT_DEFAULT
  } catch {
    return HEIGHT_DEFAULT
  }
}

export function setTermHeight(h: number) {
  const height = clampHeight(h)
  useAgent.setState({ height, max: false })
  try {
    window.localStorage.setItem(HEIGHT_KEY, height.toFixed(3))
  } catch {
    /* private mode: this session only */
  }
}

export const useAgent = create<AgentState>()(() => ({
  open: false,
  draft: '',
  autorun: false,
  refs: [],
  mentions: [],
  pageOff: null,
  height: typeof window === 'undefined' ? HEIGHT_DEFAULT : storedHeight(),
  max: false,
  focusTick: 0,
  ...initialAgentState(),
}))

/** Set by the session while a task runs (Stop, ⌘. / Ctrl+. and /stop end it). */
let stopRunning: (() => void) | null = null
export function setStopHandler(fn: (() => void) | null) {
  stopRunning = fn
}

/** Stop the running task (if any). Hiding the terminal never does this. */
export function stopAgent(): boolean {
  if (!stopRunning) return false
  stopRunning()
  return true
}

/** Open the terminal, optionally with a task (run: start it right away). */
export function openAgent(opts: { task?: string; run?: boolean } = {}) {
  const task = opts.task?.trim()
  useAgent.setState((s) => ({
    open: true,
    unseen: null,
    draft: task && s.status !== 'running' ? task : s.draft,
    autorun: !!task && !!opts.run && s.status !== 'running',
    focusTick: s.focusTick + 1,
  }))
}

/** Hide the terminal. A running task goes on in the background (the status bar shows it). */
export function closeAgent() {
  useAgent.setState({ open: false, autorun: false })
}

export function toggleAgent() {
  if (useAgent.getState().open) closeAgent()
  else openAgent()
}

/* ---------- references ---------- */

/** References per task, at most. */
export const REF_MAX = 10

/** Add a reference chip (the same passage twice counts once). Returns false when the list is full. */
export function addRef(ref: TermRef): boolean {
  const refs = useAgent.getState().refs
  if (refs.some((r) => r.pageId === ref.pageId && r.markdown === ref.markdown)) return true
  if (refs.length >= REF_MAX) return false
  useAgent.setState({ refs: [...refs, ref] })
  return true
}

export function removeRef(id: string) {
  useAgent.setState((s) => ({ refs: s.refs.filter((r) => r.id !== id) }))
}
