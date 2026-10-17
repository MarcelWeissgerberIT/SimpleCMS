/**
 * Work orders — the planner's runs in this tab (memory only; spec §1.4): what the plate shows while One plans and right
 * after — the phase, what was read ("Auftrag gelesen · 1.240 Zeichen · 1 verlinkte Seite"), the server's part (its tools,
 * the ones left out, every call made, "Server lieferte nichts"), the notes ("ohne Server: <Grund>", a repo the worker does
 * not serve, a key scrubbed …), the receipt, and how the run ended (planner.ts PlanOutcome — a brake note for a manual
 * run at the Regler's line, "Regler hält" for a deferred one). One run per request at a time; ⌘. stops it (stopPlanning).
 */
import { create } from 'zustand'
import type { ID } from '../../../store/types'
import type { Receipt } from '../../ai/core/meter'
import type { OrderCall, OrderServerSkip, OrderToolLeft, PlanNote } from './types'
import type { PlanOutcome } from './planner'

export type PlannerPhase = 'checking' | 'reading' | 'asking' | 'repair' | 'writing' | 'done'

export interface PlannerRun {
  run: string
  mode: 'manual' | 'trigger'
  phase: PlannerPhase
  at: number
  /** what was read: the request's characters, the linked pages that went along, the request was cut */
  read: { chars: number; pages: number; cut: boolean } | null
  /** the server that takes part (the person's name for it), null: none */
  server: string | null
  /** the picked server that does not take part, and why (null: none was picked, or it takes part) */
  skip: { server: string; why: OrderServerSkip } | null
  /** its tools the planner may call, and the ones left out */
  tools: string[]
  left: Array<{ tool: string; why: OrderToolLeft }>
  calls: OrderCall[]
  receipt: Receipt | null
  /** what reading the answer changed (plan.ts PlanNote) */
  notes: PlanNote[]
  /** how it ended (absent while it runs) */
  outcome?: PlanOutcome
}

interface RunsState {
  /** `<rowId>` → the newest run in this tab */
  runs: Record<ID, PlannerRun>
}

export const useOrderPlanner = create<RunsState>()(() => ({ runs: {} }))

/** The newest planner run of a request in this tab (React). */
export const usePlannerRun = (rowId: ID | null): PlannerRun | undefined => useOrderPlanner((s) => (rowId ? s.runs[rowId] : undefined))

/** The newest planner run of a request in this tab, now. */
export const plannerRun = (rowId: ID): PlannerRun | undefined => useOrderPlanner.getState().runs[rowId]

export function startRun(rowId: ID, run: string, mode: PlannerRun['mode']): void {
  useOrderPlanner.setState((s) => ({ runs: { ...s.runs, [rowId]: { run, mode, phase: 'checking', at: Date.now(), read: null, server: null, skip: null, tools: [], left: [], calls: [], receipt: null, notes: [] } } }))
}

/** Patch the run `run` of a request (a newer run of it is never touched). */
export function patchRun(rowId: ID, run: string, patch: Partial<PlannerRun>): void {
  useOrderPlanner.setState((s) => {
    const cur = s.runs[rowId]
    if (!cur || cur.run !== run) return s
    return { runs: { ...s.runs, [rowId]: { ...cur, ...patch } } }
  })
}

/* ------------------------------------------------------------------ stopping (⌘.) */

const controllers = new Map<ID, { run: string; ctl: AbortController }>()

/** The abort signal of a request's run (planner.ts). */
export function runSignal(rowId: ID, run: string): AbortSignal {
  const ctl = new AbortController()
  controllers.set(rowId, { run, ctl })
  return ctl.signal
}

export function endSignal(rowId: ID, run: string): void {
  if (controllers.get(rowId)?.run === run) controllers.delete(rowId)
}

/** ⌘. on the plate: stop the request's planner run (nothing is created). false: none runs in this tab. */
export function stopPlanning(rowId: ID): boolean {
  const c = controllers.get(rowId)
  if (!c) return false
  c.ctl.abort()
  return true
}

/** Requests planning in this tab now. */
export const planningNow = (): number => controllers.size
