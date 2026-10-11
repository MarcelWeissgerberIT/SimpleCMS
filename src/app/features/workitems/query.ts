/**
 * The list tools' query (list_work_items, one_list_work_items) over the task index — pure: the index and the scope
 * come in. Winners only (live, never a template's or the trash's), filtered, sorted: overdue first, then by due date
 * (none last), then in page order (the index's winner order: the page created first, then document order).
 * No RegExp from input — `query` is a folded substring of the title.
 */
import type { ID } from '../../store/types'
import { isLate } from '../../editor/workitem/format'
import type { ItemEntry, ItemIndex } from './itemIndex'
import { edgeKey } from './graph'

export type ItemStatusFilter = 'open' | 'todo' | 'in_progress' | 'done' | 'any'

export interface ItemQuery {
  /** default 'open' = todo + in progress */
  status?: ItemStatusFilter
  /** a person's id; 'none' = tasks without people */
  person?: { id: string } | 'none' | null
  /** these pages only (the caller expands "that page and below") */
  pages?: ReadonlySet<ID> | null
  /** only tasks waiting for an open task (true) / only tasks that do not (false) */
  blocked?: boolean | null
  /** only tasks past due (true) / only tasks that are not (false) */
  overdue?: boolean | null
  /** 'YYYY-MM-DD': a due date before that day */
  dueBefore?: string | null
  /** a folded substring of the title */
  query?: string | null
  /** 1–100, default 50 */
  limit?: number
  now: number
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** Waits for an open task (a live winner that is not done, the edge not inside a loop). */
export function isBlocked(index: Pick<ItemIndex, 'byId' | 'loopEdges'>, e: ItemEntry): boolean {
  if (e.attrs.status === 'done') return false
  return e.attrs.blockedBy.some((to) => {
    const b = index.byId.get(to)
    return !!b && b.attrs.status !== 'done' && !index.loopEdges.has(edgeKey(e.itemId, to))
  })
}

export const isOverdue = (e: ItemEntry, now: number): boolean => e.attrs.status !== 'done' && !!e.attrs.due && isLate(e.attrs.due, now)

/**
 * The matching tasks (sorted, at most `limit`), how many matched in all, and whether pages are still loading (team:
 * the list may be incomplete). `scope`: may the caller see this task (agent scope, context marks, privacy).
 */
export function queryItems(index: Pick<ItemIndex, 'byId' | 'loopEdges' | 'unloaded'>, filter: ItemQuery, scope: (e: ItemEntry) => boolean): { items: ItemEntry[]; total: number; loading: boolean } {
  const status = filter.status ?? 'open'
  const q = filter.query ? fold(filter.query) : ''
  const limit = Math.max(1, Math.min(100, Math.floor(filter.limit ?? 50)))
  const hits: Array<{ e: ItemEntry; late: boolean }> = []
  for (const e of index.byId.values()) {
    const s = e.attrs.status
    if (status === 'open' ? s === 'done' : status !== 'any' && s !== status) continue
    if (filter.person === 'none' ? e.attrs.people.length > 0 : filter.person && !e.attrs.people.includes(filter.person.id)) continue
    if (filter.pages && !filter.pages.has(e.pageId)) continue
    if (filter.dueBefore && !(e.attrs.due && e.attrs.due.slice(0, 10) < filter.dueBefore)) continue
    if (q && !fold(e.title).includes(q)) continue
    const late = isOverdue(e, filter.now)
    if (filter.overdue != null && late !== filter.overdue) continue
    if (filter.blocked != null && isBlocked(index, e) !== filter.blocked) continue
    if (!scope(e)) continue
    hits.push({ e, late })
  }
  hits.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1
    const da = a.e.attrs.due
    const db = b.e.attrs.due
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return da < db ? -1 : 1
    }
    if (a.e.pageCreatedAt !== b.e.pageCreatedAt) return a.e.pageCreatedAt - b.e.pageCreatedAt
    if (a.e.pageId !== b.e.pageId) return a.e.pageId < b.e.pageId ? -1 : 1
    return a.e.order - b.e.order
  })
  return { items: hits.slice(0, limit).map((h) => h.e), total: hits.length, loading: index.unloaded > 0 }
}
