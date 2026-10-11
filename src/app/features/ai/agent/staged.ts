/**
 * The AI terminal's staged page ids and its "applied alone" rules, without the session (so Preflight's card reads the
 * same answers as the terminal's review): what a staged page id became once applied (filled by the session's applies,
 * cleared by /new and by an Undo) and the predicates that read it.
 */
import type { ID } from '../../../store/types'
import { isPipelineTask, startsNow } from '../../coding'
import type { StagedChange } from './types'

/** staged row / page id → the real id it got when applied */
const rowIds: Record<string, ID> = {}

/** A staged id as it is now: the real id once applied, else itself. */
export const resolveStaged = (id: ID): ID => rowIds[id] ?? id

/** Ids an apply created (staged → real). */
export function noteStagedIds(map: Record<string, ID>): void {
  Object.assign(rowIds, map)
}

/** Forget these staged ids (an Undo took their pages back) — or all of them (a new task). */
export function forgetStagedIds(ids?: string[]): void {
  for (const k of ids ?? Object.keys(rowIds)) delete rowIds[k]
}

/** A proposal that starts the coding worker when applied (checked live): never part of a bulk apply. */
export const startsWorker = (c: StagedChange): boolean => c.kind === 'coding' && (!c.coding || startsNow(c.coding))

/**
 * Text added to a pipeline task's page (append_to_page) — the task as it is now, also one this terminal created in the
 * same batch (its staged id resolved): Claude Code reads it at the task's next stage — shown in full, never part of a
 * bulk apply. (An edit_page shows every changed block in full: it stays in the bulk apply.)
 */
export const goesToWorker = (c: StagedChange): boolean => c.kind === 'append' && isPipelineTask(resolveStaged(c.pageId))

/**
 * A proposal "apply all" leaves for its own ↵: it starts the coding worker, or its text goes to Claude Code — or it is
 * a send (only the Outbox sends it; applyChanges never does).
 */
export const appliesAlone = (c: StagedChange): boolean => c.kind === 'send' || startsWorker(c) || goesToWorker(c)
