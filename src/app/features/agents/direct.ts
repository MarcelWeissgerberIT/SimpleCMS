/**
 * Custom agents — what an apply-mode run writes directly (slice SJ: the Schreibschranke). Pure.
 *
 *  - per change (as before Jev): a change that waits for a person's review — an edit, a send, a task hold — and every
 *    change that needs one of them (`perChange`, workitems heldClosure);
 *  - per run: any reason → NOTHING is written directly, every change becomes a proposal (DJ17 — the whole run waits):
 *      'changed' another Jev snapshot than the one confirmed (DJ19) and the agent holds or gates;
 *      'gate'    the Schreibschranke is on and a checked change is below `allowAt` — or was not checked;
 *      'hold'    "Zurückhalten" and a change is held (in apply mode a hold makes the run wait);
 *      'sticky'  an earlier change of this agent that Jev marked or held, or any change of a run Jev made wait, is still
 *                open (DJ20 — a later run cannot learn its way past it).
 * Without a Vorprüfer there is no run-level reason: the run writes exactly what it wrote before Jev. With one it writes the
 * same or nothing — a decision model only subtracts.
 */
import { gateAllows } from '@/shared/ai/decide'
import type { AgentReviewV2 } from '@/shared/ai/route'
import type { ID } from '../../store/types'
import type { StagedChange } from '../ai/agent/types'
import type { AgentRun, JevWait } from './types'

/** The order the run says why it waited (the first that applies). */
export const WAIT_ORDER: readonly JevWait[] = ['changed', 'gate', 'hold', 'sticky']

export interface Split {
  /** what the run writes directly */
  direct: StagedChange[]
  /** what stays a proposal */
  waits: Set<string>
  /** the run waited as a whole: why (null: it did not) */
  why: JevWait | null
}

export function directSplit(changes: readonly StagedChange[], o: { perChange: ReadonlySet<string>; runLevel: readonly JevWait[] }): Split {
  const why = WAIT_ORDER.find((w) => o.runLevel.includes(w)) ?? null
  if (why) return { direct: [], waits: new Set(changes.map((c) => c.id)), why }
  return { direct: changes.filter((c) => !o.perChange.has(c.id)), waits: new Set(o.perChange), why: null }
}

/** The run-level reasons of an apply-mode run with a Vorprüfer (none without one). */
export function runLevelWaits(o: { changes: readonly StagedChange[]; review: Omit<AgentReviewV2, 'v'> | null; sticky: boolean }): JevWait[] {
  const r = o.review
  if (!r) return []
  const checked = o.changes.filter((c) => !!c.jev)
  const out: JevWait[] = []
  if ((r.gate || r.pre.hold) && checked.some((c) => c.jev!.why === 'changed')) out.push('changed')
  if (r.gate && checked.some((c) => !gateAllows(c.jev, r.gate!.allowAt))) out.push('gate')
  if (r.pre.hold && o.changes.some((c) => c.status === 'held')) out.push('hold')
  if (o.sticky) out.push('sticky')
  return out
}

const open = (c: StagedChange) => c.status === 'pending' || c.status === 'failed' || c.status === 'held'

/**
 * DJ20: the open changes of this agent's earlier runs that keep later ones cautious — a change Jev marked or held (it
 * marked it, or could not check it), or any change of a run Jev made wait. Only Jev's own findings count: a change held,
 * or a run that waited, only because of an earlier one (sticky) passes nothing on — once the person decided the change
 * that started it, the next run is checked on its own again. `any`: one exists (an apply-mode run waits as a whole);
 * `targets`: the pages and rows they are about (a staged-mode change to one of them is held / marked).
 */
export function stickyOf(runs: readonly AgentRun[], exceptRun: string): { any: boolean; targets: Set<ID> } {
  const targets = new Set<ID>()
  for (const r of runs) {
    if (r.id === exceptRun || r.runner !== 'browser') continue
    const waited = !!r.jev?.waited && r.jev.waited !== 'sticky'
    for (const c of r.staged ?? []) {
      if (!open(c) || !(waited || !!c.jev?.mark || (c.status === 'held' && c.jev?.held !== 'sticky'))) continue
      targets.add(r.rowIds?.[c.pageId] ?? c.pageId)
    }
  }
  return { any: targets.size > 0, targets }
}
