/**
 * Holds — writes of Claude's that wait for a person's review even where nobody reviews otherwise (a custom agent in
 * apply mode, an MCP call allowed to "Apply directly"). Pure. Reasons:
 *
 *  - names     assigns a person to a task, or adds a person mention (a ping)
 *  - assigned  changes a task that has people — any field, or its title / notes in a text replace
 *  - blocker   adds a blocker to an EXISTING task
 *  - removes   a replace that removes tasks
 *  - reminder  sets a reminder (it rings for people)
 *
 * Reviewed paths (the terminal, agents in 'stage' mode, MCP "Ask first", the AI menu) show them as tags only.
 * heldClosure(): what an unattended apply leaves pending — held changes, edits and sends, and every change that
 * depends on one of them (`depsOf`: dependsOn + needs).
 */
import type { ItemPatch } from '../../editor/workitem/patch'
import { depsOf, type StagedChange } from '../ai/agent/types'
import type { SettleReport } from './settle'

type T = (key: string, vars?: Record<string, string | number>) => string

export type HoldReason = 'names' | 'assigned' | 'blocker' | 'removes' | 'reminder'

/** The order reasons are named in. */
export const HOLD_REASONS: readonly HoldReason[] = ['names', 'reminder', 'assigned', 'blocker', 'removes']

const ordered = (set: Set<HoldReason>): HoldReason[] => HOLD_REASONS.filter((r) => set.has(r))

/** The holds of a settled text write (staged create / append / row / edit, the MCP replace). */
export function holdsOfReport(report: Pick<SettleReport, 'created' | 'kept' | 'removed' | 'keptChanged' | 'blocks' | 'mentionsAdded'>): HoldReason[] {
  const out = new Set<HoldReason>()
  if (report.created.some((f) => f.people.length) || report.mentionsAdded > 0) out.add('names')
  if (report.created.some((f) => f.reminder)) out.add('reminder')
  if (report.removed.length) out.add('removes')
  if (report.blocks.length) out.add('blocker')
  if (report.keptChanged.length) {
    const changed = new Set(report.keptChanged)
    if (report.kept.some((f) => changed.has(f.itemId) && f.people.length)) out.add('assigned')
  }
  return ordered(out)
}

/**
 * The holds of a field change (update_work_item). `current`: the task's people now — null for a task staged in this
 * conversation (not in the workspace yet: nobody's work to change, no existing task to block).
 */
export function holdsOfEdit(patch: ItemPatch, current: { people: readonly string[] } | null): HoldReason[] {
  const out = new Set<HoldReason>()
  if (patch.people?.add?.length) out.add('names')
  if (typeof patch.reminder === 'string' && patch.reminder) out.add('reminder')
  if (current) {
    if (current.people.length) out.add('assigned')
    if (patch.blockedBy?.add?.length) out.add('blocker')
  }
  return ordered(out)
}

/**
 * The changes an unattended apply leaves pending: every change with a hold, every 'edit' and 'send', and — closed over
 * `depsOf` — every change that needs one of those first.
 */
export function heldClosure(changes: ReadonlyArray<Pick<StagedChange, 'id' | 'kind' | 'dependsOn' | 'needs'>>, holdsOf: (c: Pick<StagedChange, 'id' | 'kind' | 'dependsOn' | 'needs'>) => readonly HoldReason[]): Set<string> {
  const held = new Set<string>()
  const dependents = new Map<string, string[]>()
  for (const c of changes) {
    for (const d of depsOf(c)) {
      const list = dependents.get(d)
      if (list) list.push(c.id)
      else dependents.set(d, [c.id])
    }
  }
  const queue: string[] = []
  for (const c of changes) {
    if (c.kind === 'edit' || c.kind === 'send' || holdsOf(c).length) {
      held.add(c.id)
      queue.push(c.id)
    }
  }
  while (queue.length) {
    const id = queue.pop()!
    for (const next of dependents.get(id) ?? []) {
      if (held.has(next)) continue
      held.add(next)
      queue.push(next)
    }
  }
  return held
}

/** The reasons as words, joined ("Names a person · Sets a reminder") — '' for none. The caller adds "Waits for your review". */
export function holdText(holds: readonly HoldReason[], t: T): string {
  return holds.map((h) => t(`features.workItems.hold.${h}`)).join(' · ')
}
