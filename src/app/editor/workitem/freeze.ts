/**
 * Task blocks in documents that leave the workspace (share links, the published site, HTML exports —
 * stripPrivate): the names and the status are frozen in, every id is removed (the task's own itemId,
 * person ids, linked itemIds, the block id), and the reminder (a per-person setting) goes too. The
 * receiving side has no workspace to resolve anything in — the placard reads `frozen` instead.
 */
import type { JSONContent } from '@tiptap/core'
import { itemAttrs, storedItemAttrs, WORK_ITEM } from './attrs'

/** Freeze one task's attrs: `personName` resolves an id (null: unknown — left out, as the placard hides it). */
export function frozenItemAttrs(attrs: unknown, personName: (id: string) => string | null): Record<string, unknown> {
  const a = itemAttrs(attrs as Record<string, unknown>)
  const names = a.people.map(personName).filter((n): n is string => !!n)
  const frozen = {
    people: a.people.length ? names : (a.frozen?.people ?? []),
    blockedBy: a.blockedBy.length || a.frozen?.blockedBy || 0,
    related: a.related.length || a.frozen?.related || 0,
  }
  return storedItemAttrs({ ...a, id: null, itemId: null, reminder: null, people: [], blockedBy: [], related: [], frozen: itemAttrs({ frozen }).frozen })
}

/** The doc with every task frozen (same object when it holds none). */
export function freezeWorkItems(doc: JSONContent, personName: (id: string) => string | null): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    if (n.content) {
      const kids = n.content.map(walk)
      if (kids.some((k, i) => k !== n.content![i])) out = { ...n, content: kids }
    }
    if (n.type === WORK_ITEM) out = { ...out, attrs: frozenItemAttrs(n.attrs ?? {}, personName) }
    return out
  }
  return walk(doc)
}

/** Does a doc hold a task block anywhere? */
export function hasWorkItems(doc: JSONContent | null | undefined): boolean {
  if (!doc) return false
  if (doc.type === WORK_ITEM) return true
  return !!doc.content?.some(hasWorkItems)
}
