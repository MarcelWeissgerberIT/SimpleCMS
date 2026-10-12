/**
 * Custom agents — the Undo of what an 'apply' run wrote (this tab, this session). exec.ts remembers the batch when the
 * run applies it, RunHistory asks whether there is one (canUndoRun), and the review reverts it and settles the run's
 * proposals with it (review.ts undoRunAll). Its own module so exec.ts and review.ts do not import each other.
 */
import type { ApplyResult } from '../ai/agent/apply'
import { withWriter } from '../../store/writer'

const undos = new Map<string, ApplyResult>()

export const canUndoRun = (runId: string) => undos.has(runId)

export function rememberUndo(runId: string, res: ApplyResult): void {
  undos.set(runId, res)
}

/** The flight recorder ejected (part of) the run: its run-level Undo goes (its writes are not the run's to revert any more). */
export function forgetRunUndo(runId: string): void {
  undos.delete(runId)
}

/**
 * Revert what an 'apply' run wrote: the ids of its changes kept because they were edited since, and the batch it
 * reverted (null: nothing to undo in this tab). The review settles the run's proposals with it (review.ts undoRunAll).
 */
export function undoRunResult(runId: string): { kept: string[]; batch: ApplyResult } | null {
  const batch = undos.get(runId)
  if (!batch) return null
  undos.delete(runId)
  // the person's Undo of the run (store/writer.ts)
  return { kept: withWriter({ kind: 'you', via: 'undo', ref: runId }, () => batch.undo()).kept, batch }
}
