/**
 * Lamp "Inbox": unread, not archived items of this device's inbox whose page is alive (an agent's note always). Ids =
 * the inbox item ids. The second line names the largest kind ("12 reminders").
 */
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { onRowsChanged } from '../../../store/rowIndex'
import { navigate } from '../../../lib/router'
import { t } from '../../../i18n'
import { onInboxMessage, useInbox, type InboxKind } from '../../inbox/state'
import type { LampReading, LampSourceDef } from '../registry'
import { all, watch } from './util'

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
    const pages = useWorkspace.getState().pages
    const items = [...useInbox.getState().data.items].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS)
    const ids: string[] = []
    const kinds: Partial<Record<InboxKind, number>> = {}
    for (const it of items) {
      if (it.read || it.archived) continue
      if (it.kind !== 'agent' && (!pages[it.pageId] || isEffectivelyTrashed(pages, it.pageId))) continue
      ids.push(it.id)
      kinds[it.kind] = (kinds[it.kind] ?? 0) + 1
    }
    let top: InboxKind | null = null
    for (const [k, n] of Object.entries(kinds) as Array<[InboxKind, number]>) if (!top || n > (kinds[top] ?? 0)) top = k
    const second = top ? t(`features.preflight.lamp.inbox.second.${top}`, { n: kinds[top] ?? 0 }) : t('features.preflight.lamp.inbox.second')
    return { state: 'ok', count: ids.length, ids, second }
  },
  open: () => navigate({ name: 'inbox' }),
}
