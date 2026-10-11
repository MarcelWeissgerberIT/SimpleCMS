/**
 * Lamp "Inbox": unread, not archived items of this device's inbox whose page is alive (an agent's note always). Ids =
 * the inbox item ids. The second line names the largest kind ("12 reminders").
 */
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { onRowsChanged } from '../../../store/rowIndex'
import { navigate } from '../../../lib/router'
import { t } from '../../../i18n'
import { onInboxMessage, useInbox, type InboxItem, type InboxKind } from '../../inbox/state'
import type { CardAction, LampReading, LampSourceDef, QueueItem } from '../registry'
import { archiveInbox, openInboxEntry, readInbox } from '../queue/calls'
import { all, watch } from './util'
import { titleOf } from './proposals/common'

/** items looked at per read (newest first) */
const MAX_ITEMS = 400

export const inboxLamp: LampSourceDef = {
  id: 'inbox',
  order: 80,
  legend: () => t('features.preflight.lamp.inbox.legend'),
  short: () => t('features.preflight.lamp.inbox.short'),
  rule: () => t('features.preflight.lamp.inbox.rule'),
  thresholds: { amber: 1, red: 10 },
  subscribe: (changed) =>
    all(
      watch(useInbox, (s) => [s.data.items, s.ws], changed),
      onInboxMessage(() => changed()),
      onRowsChanged((c) => {
        if (c.structure || c.reset) changed()
      }),
    ),
  read(): LampReading {
    const list = unread()
    const ids: string[] = []
    const kinds: Partial<Record<InboxKind, number>> = {}
    for (const it of list) {
      ids.push(it.id)
      kinds[it.kind] = (kinds[it.kind] ?? 0) + 1
    }
    let top: InboxKind | null = null
    for (const [k, n] of Object.entries(kinds) as Array<[InboxKind, number]>) if (!top || n > (kinds[top] ?? 0)) top = k
    const second = top ? t(`features.preflight.lamp.inbox.second.${top}`, { n: kinds[top] ?? 0 }) : t('features.preflight.lamp.inbox.second')
    return { state: 'ok', count: ids.length, ids, second }
  },
  open: () => navigate({ name: 'inbox' }),
  queue: {
    items: () => unread().map(cardOf),
    actions: inboxActions,
  },
}

/** Unread, not archived, its page alive (an agent's note always) — newest 400 looked at. */
function unread(): InboxItem[] {
  const pages = useWorkspace.getState().pages
  const items = [...useInbox.getState().data.items].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS)
  return items.filter((it) => !it.read && !it.archived && (it.kind === 'agent' || (!!pages[it.pageId] && !isEffectivelyTrashed(pages, it.pageId))))
}

export const inboxItemOf = (id: string): InboxItem | null => useInbox.getState().data.items.find((i) => i.id === id) ?? null

function cardOf(it: InboxItem): QueueItem {
  return {
    id: it.id,
    lamp: 'inbox',
    kind: 'inbox',
    tag: t(`inbox.kind.${it.kind}`),
    refs: { inboxId: it.id, ...(it.pageId ? { pageId: it.pageId } : {}), ...(it.agentId ? { agentId: it.agentId } : {}) },
    at: it.at,
    hand: [],
    bulk: true,
    title: titleOf(it.pageId) || (it.kind === 'agent' ? t('inbox.kind.agent') : t('common.untitled')),
    detail: (it.excerpt ?? '').slice(0, 140),
  }
}

/** Gelesen / Archivieren / Öffnen — Undo puts back exactly the flags the key changed (an archived item unread again). */
function inboxActions(item: QueueItem): CardAction[] {
  const it = inboxItemOf(item.id)
  if (!it) return []
  const wasUnread = !it.read
  return [
    {
      key: 'a',
      label: t('features.preflight.card.read'),
      outcome: 'read',
      undoable: true,
      run: async () => {
        await readInbox([it.id])
        return { ok: true, undo: async () => (await readInbox([it.id], false), 'undone') }
      },
    },
    {
      key: 'd',
      label: t('features.preflight.card.archive'),
      outcome: 'discarded',
      undoable: true,
      run: async () => {
        await archiveInbox([it.id])
        return {
          ok: true,
          undo: async () => {
            await archiveInbox([it.id], false)
            if (wasUnread) await readInbox([it.id], false)
            return 'undone'
          },
        }
      },
    },
    { key: 'o', label: t('features.preflight.card.open'), outcome: 'read', run: () => (openInboxEntry(it), { ok: true, resolve: 'reading' }) },
  ]
}
