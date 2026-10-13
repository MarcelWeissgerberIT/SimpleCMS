/**
 * Custom agents — a newer proposal replaces an older one (pure; review.ts supersedeOlder writes the plan). A mirror agent
 * proposes the same row's fields run after run; the older proposals would only pile up. The rule:
 *  - only update_row proposals of browser runs that wait for review (run status 'staged'), both still open
 *    (pending | failed), of the same agent, for the same row (`rowOf`: a staged row id resolved through the run's rowIds);
 *  - the older one's fields ⊆ the newer one's (a field only the older one has keeps it: nothing is swallowed);
 *  - the older one has no open proposal building on it, and nobody opened it (`opened`: Preflight's opened cards);
 *  - the newest proposal wins: A ⊂ B ⊂ C marks A and B as replaced by C. Proposals of one run never replace each other;
 *  - a held proposal (not open) and one Jev marked or kept cautious (slice SJ: `jev.mark` / `jev.sticky`) neither
 *    replace nor are replaced, and neither do the proposals of a run Jev made wait (`jev.waited`: without Jev they would
 *    have been written, not staged) — a decision model never supersedes.
 * A replaced proposal gets status 'superseded' (never 'discarded': the agent-state walk back stops at its run).
 */
import { depsOf, type ChangeRef, type StagedChange } from '../ai/agent/types'
import type { ID } from '../../store/types'
import type { AgentRun } from './types'

export interface SupersedeStep {
  /** the older proposal (its run, its id, when its run started) */
  runId: string
  changeId: string
  at: number
  /** the newer proposal that replaces it */
  by: ChangeRef
}

const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'
const propsOf = (c: StagedChange) => new Set((c.props ?? []).map((p) => p.propId))

/** Which open proposals newer ones replace (oldest runs last in the list it walks; newest first in `runs` or not). */
export function supersedePlan(runs: AgentRun[], rowOf: (run: AgentRun, pageId: ID) => ID, opened: (runId: string, changeId: string) => boolean): SupersedeStep[] {
  // a run Jev made wait is staged only because of Jev: it replaces nothing and nothing replaces it
  const staged = runs.filter((r) => r.runner === 'browser' && r.status === 'staged' && r.staged?.length && !r.jev?.waited).sort((a, b) => b.startedAt - a.startedAt)
  const out: SupersedeStep[] = []
  /** proposals of newer runs that stay (not replaced themselves), newest first */
  const newer: Array<{ run: AgentRun; change: StagedChange; row: ID; props: Set<ID> }> = []
  for (const run of staged) {
    const list = run.staged ?? []
    const mine: Array<{ change: StagedChange; row: ID; props: Set<ID> }> = []
    for (const c of list) {
      // a proposal Jev marked (or that an earlier one here keeps cautious) neither replaces nor is replaced: it stays a card
      if (c.kind !== 'update_row' || !isOpen(c) || !c.props?.length || c.jev?.mark || c.jev?.sticky) continue
      const row = rowOf(run, c.pageId)
      const props = propsOf(c)
      const builtOn = list.some((x) => x.id !== c.id && x.status !== 'discarded' && depsOf(x).includes(c.id))
      const by = builtOn || opened(run.id, c.id) ? undefined : newer.find((n) => n.run.agentId === run.agentId && n.row === row && [...props].every((p) => n.props.has(p)))
      if (by) out.push({ runId: run.id, changeId: c.id, at: run.startedAt, by: { runId: by.run.id, changeId: by.change.id, at: by.run.startedAt } })
      else mine.push({ change: c, row, props })
    }
    // this run's proposals join the newer ones only after the run: proposals of one run never replace each other
    for (const m of mine) newer.push({ run, ...m })
  }
  return out
}

/**
 * Preflight's guard: was this proposal opened (shown as a card)? null = not known yet (its record is not loaded): then
 * nothing is superseded in this pass. No guard set (Preflight off): nothing counts as opened.
 */
export type SupersedeGuard = (runId: string, changeId: string) => boolean | null

let guard: SupersedeGuard | null = null

export function setSupersedeGuard(fn: SupersedeGuard | null): void {
  guard = fn
}

export const supersedeGuard = (): SupersedeGuard | null => guard
