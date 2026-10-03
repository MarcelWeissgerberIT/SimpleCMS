/** Inbox view model: the items worth showing (page alive), counts, groups by day. */
import { useMemo } from 'react'
import { startOfDay } from 'date-fns'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { useInbox, type InboxItem, type InboxKind } from '../../features'

export type InboxFilter = 'all' | InboxKind | 'archived'
export const INBOX_FILTERS: InboxFilter[] = ['all', 'reminder', 'mention', 'comment', 'assigned', 'archived']

/** Items whose page still exists outside the trash, newest first. */
export function visibleItems(items: InboxItem[], pages: Record<ID, Page>): InboxItem[] {
  return items.filter((i) => !!pages[i.pageId] && !isEffectivelyTrashed(pages, i.pageId)).sort((a, b) => b.at - a.at)
}

export function useInboxItems(): InboxItem[] {
  const items = useInbox((s) => s.data.items)
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => visibleItems(items, pages), [items, pages])
}

export const isUnread = (i: InboxItem) => !i.read && !i.archived

/** Unread items (sidebar badge, header). */
export function useInboxUnread(): number {
  const items = useInboxItems()
  return useMemo(() => items.filter(isUnread).length, [items])
}

export function matches(item: InboxItem, filter: InboxFilter): boolean {
  if (filter === 'archived') return !!item.archived
  if (item.archived) return false
  return filter === 'all' || item.kind === filter
}

export type GroupKey = 'today' | 'week' | 'earlier'

export function groupItems(items: InboxItem[], now: number): Array<{ key: GroupKey; items: InboxItem[] }> {
  const today = startOfDay(now).getTime()
  const week = today - 6 * 86_400_000
  const groups: Record<GroupKey, InboxItem[]> = { today: [], week: [], earlier: [] }
  for (const it of items) groups[it.at >= today ? 'today' : it.at >= week ? 'week' : 'earlier'].push(it)
  return (['today', 'week', 'earlier'] as GroupKey[]).filter((k) => groups[k].length).map((key) => ({ key, items: groups[key] }))
}
