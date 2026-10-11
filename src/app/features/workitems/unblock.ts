/**
 * "Unblocked: …" — finishing a task tells you who can start now. `unblockedBy` is pure: the live dependents of a task
 * (not done) whose open blockers, counting that task as done, are none. Called right after a PERSON finished a task
 * (key, caret, confirm, Mod+Enter, menu, the card, writeItems by: 'person') — never for remote changes, undo / redo,
 * history, sync or templates. Reopening the blocker blocks them again (computed live; no toast).
 * Pure (Node-testable); the toast lives in unblockToast.ts.
 */
import { edgeKey } from './graph'
import type { ItemEntry, ItemIndex } from './itemIndex'

/** Is `blocker` an open blocker of `from` (live, not done, not a loop edge)? */
function isOpenBlocker(index: ItemIndex, from: string, blocker: string): boolean {
  const e = index.byId.get(blocker)
  return !!e && e.attrs.status !== 'done' && !index.loopEdges.has(edgeKey(from, blocker))
}

/** The tasks that `finished` (just done) frees: dependents with no other open blocker. */
export function unblockedBy(index: ItemIndex, finished: readonly string[] | string): ItemEntry[] {
  const done = new Set(typeof finished === 'string' ? [finished] : finished)
  const out: ItemEntry[] = []
  const seen = new Set<string>()
  for (const id of done) {
    for (const d of index.dependents.get(id) ?? []) {
      if (seen.has(d) || done.has(d)) continue
      seen.add(d)
      const e = index.byId.get(d)
      if (!e || e.attrs.status === 'done') continue
      // the finished task held it back (an edge inside a loop never blocked)
      if (index.loopEdges.has(edgeKey(d, id))) continue
      if (e.attrs.blockedBy.some((b) => !done.has(b) && isOpenBlocker(index, d, b))) continue
      out.push(e)
    }
  }
  return out
}
