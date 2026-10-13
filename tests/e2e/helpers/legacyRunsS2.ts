/**
 * Frozen copies of how a slice-2 build (ee15ba2, before SJ) reads an agent run's proposals — what an older tab does with
 * a run an SJ tab stored. Never import app code here: these are the old readers, byte for byte in behaviour.
 *  - features/agents/review.ts: isOpen (what applyRun / discardRun act on), allDiscarded (the agent-state walk back)
 *  - features/agents/runs.ts: awaitsReview (the sidebar badge, the "needs review" state)
 *  - features/preflight/sources/proposals/common.ts: waits / openChangesOf (the Preflight cards)
 *  - features/ai/agent/apply.ts: the statuses applyChanges writes at all
 *  - features/agents/supersede.ts: isOpen (what a newer proposal may replace)
 */
type Status = string
interface Change {
  id: string
  status: Status
  kind: string
}
interface Run {
  status: string
  staged?: Change[]
}

export const isOpen = (c: Pick<Change, 'status'>) => c.status === 'pending' || c.status === 'failed'
export const allDiscarded = (r: Run) => !!r.staged?.length && r.staged.every((c) => c.status === 'discarded')
export const awaitsReview = (r: Run) => r.status === 'staged' && (r.staged ?? []).some((c) => c.status === 'pending' || c.status === 'failed')
export const waits = (status: string) => status === 'pending' || status === 'failed'
/** openChangesOf without the Outbox probe (the fixtures hold no send) */
export function openChangesOf(run: Run): Change[] {
  if (run.status === 'running') return []
  return (run.staged ?? []).filter((c) => waits(c.status))
}
export const applies = (c: Change) => (c.status === 'pending' || c.status === 'failed') && c.kind !== 'send'
export const supersedeOpen = (c: Pick<Change, 'status'>) => c.status === 'pending' || c.status === 'failed'
