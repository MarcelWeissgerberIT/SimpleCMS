/**
 * Task block — which fields changed between two versions of a task (history "Changes", edit reviews). Pure.
 * `itemId` and `doneAt` never count (they are volatile in the history diff: copies re-mint ids, a finish
 * time follows the status).
 */
import { itemAttrs, type WorkItemAttrs } from './attrs'

export type ItemField = 'status' | 'due' | 'reminder' | 'people' | 'blockedBy' | 'related'

export interface ItemChange {
  field: ItemField
  before: WorkItemAttrs
  after: WorkItemAttrs
  /** people / linked tasks: ids only in `after` / only in `before` */
  added: string[]
  removed: string[]
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function itemChanges(beforeAttrs: unknown, afterAttrs: unknown): ItemChange[] {
  const before = itemAttrs((beforeAttrs ?? {}) as Record<string, unknown>)
  const after = itemAttrs((afterAttrs ?? {}) as Record<string, unknown>)
  const out: ItemChange[] = []
  const push = (field: ItemField, added: string[] = [], removed: string[] = []) => out.push({ field, before, after, added, removed })
  if (before.status !== after.status) push('status')
  if (before.due !== after.due) push('due')
  if (before.reminder !== after.reminder && (before.due || after.due)) push('reminder')
  for (const field of ['people', 'blockedBy', 'related'] as const) {
    const a = before[field]
    const b = after[field]
    if (sameList(a, b)) continue
    push(
      field,
      b.filter((x) => !a.includes(x)),
      a.filter((x) => !b.includes(x)),
    )
  }
  // frozen copies (shared documents) carry names / counts instead of ids
  if (!before.people.length && !after.people.length && !sameList(before.frozen?.people ?? [], after.frozen?.people ?? [])) push('people')
  return out
}
