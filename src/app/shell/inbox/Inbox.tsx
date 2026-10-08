/**
 * #/inbox — this device's inbox: reminders that came due, notes from custom agents, and in a team workspace @mentions,
 * assignments and replies (features/inbox makes the items). Filters, groups by day, read / archive.
 */
import { useMemo, useState } from 'react'
import { BellRing, CheckCheck, Settings2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import type { PopoverAnchor } from '../../ui/Popover'
import { collectReminders, formatDue, markRead, openInboxItem, useInbox, type InboxItem } from '../../features'
import { useCloud } from '../../cloud'
import { useLocalPref, useNow } from '../lib/hooks'
import { INBOX_FILTERS, groupItems, isUnread, matches, useInboxItems, type InboxFilter } from './model'
import { InboxRow } from './InboxRow'
import { InboxSettings } from './InboxSettings'
import './inbox.css'

export function Inbox() {
  const t = useT()
  const items = useInboxItems()
  const loaded = useInbox((s) => s.loaded)
  const now = useNow(30_000)
  const local = useCloud((s) => s.active.kind === 'local')
  const [stored, setFilter] = useLocalPref<string>('one.inbox.filter', 'all')
  const filter: InboxFilter = INBOX_FILTERS.includes(stored as InboxFilter) ? (stored as InboxFilter) : 'all'
  const [settings, setSettings] = useState<PopoverAnchor>(null)

  const unread = items.filter(isUnread)
  const shown = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter])
  const groups = useMemo(() => groupItems(shown, now), [shown, now])
  const count = (f: InboxFilter) => (f === 'archived' ? items.filter((i) => i.archived).length : items.filter((i) => isUnread(i) && matches(i, f)).length)

  return (
    <div className="ibx">
      <header className="ibx-head">
        <div className="ibx-head__meta label">
          <span className="ibx-head__sec">§ — {t('shell.nav.inbox')}</span>
          <span className="ibx-head__rule" />
          <span>
            {t('shell.inbox.unread', { n: String(unread.length).padStart(2, '0') })} · {t('shell.inbox.device')}
          </span>
        </div>
        <div className="ibx-head__row">
          <h1 className="ibx-title display">{t('shell.nav.inbox')}</h1>
          <div className="ibx-ctrl">
            <button type="button" className="btn btn--sm" disabled={!unread.length} onClick={() => void markRead(unread.map((i) => i.id))}>
              <CheckCheck size={14} strokeWidth={1.75} />
              {t('shell.inbox.markAllRead')}
            </button>
            <Tooltip label={t('shell.inbox.settings')}>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('shell.inbox.settings')}
                aria-haspopup="dialog"
                aria-expanded={!!settings}
                onClick={(e) => setSettings(settings ? null : e.currentTarget)}
              >
                <Settings2 size={17} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="ibx-tabs" role="tablist" aria-label={t('shell.inbox.filters')}>
          {INBOX_FILTERS.map((f) => {
            const n = count(f)
            return (
              <button key={f} type="button" role="tab" className="ibx-tab" aria-selected={filter === f} data-filter={f} onClick={() => setFilter(f)}>
                <span>{t(`shell.inbox.filter.${f}`)}</span>
                {n > 0 && <span className="ibx-tab__n">{String(n).padStart(2, '0')}</span>}
              </button>
            )
          })}
        </div>
      </header>

      {local && (
        <p className="ibx-note">
          <span className="led" aria-hidden />
          <span>{t('shell.inbox.local')}</span>
        </p>
      )}

      {(filter === 'all' || filter === 'reminder') && <Scheduled now={now} />}

      {loaded && groups.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <div className="ibx-list" role="tabpanel" aria-label={t(`shell.inbox.filter.${filter}`)}>
          {groups.map((g) => (
            <section key={g.key} className="ibx-group" aria-label={t(`shell.inbox.group.${g.key}`)}>
              <div className="ibx-group__head label">
                <span>{t(`shell.inbox.group.${g.key}`)}</span>
                <span className="ibx-group__rule" aria-hidden />
                <span className="ibx-group__n">{String(g.items.length).padStart(2, '0')}</span>
              </div>
              <ul className="ibx-items">
                {g.items.map((it) => (
                  <InboxRow key={it.id} item={it} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <InboxSettings anchor={settings} onClose={() => setSettings(null)} />
    </div>
  )
}

/** The next reminders that will fire on this device. */
function Scheduled({ now }: { now: number }) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)
  const rem = useInbox((s) => s.data.rem)
  const next = useMemo(() => collectReminders(pages, dbs).filter((r) => r.dueAt > now && !rem[r.key]?.fired), [pages, dbs, rem, now])
  if (!next.length) return null
  return (
    <section className="ibx-sched" aria-label={t('shell.inbox.scheduled')}>
      <div className="ibx-group__head label">
        <span>{t('shell.inbox.scheduled')}</span>
        <span className="ibx-group__rule" aria-hidden />
        <span className="ibx-group__n">{String(next.length).padStart(2, '0')}</span>
      </div>
      <ul className="ibx-sched__list">
        {next.slice(0, 3).map((r) => {
          const page = pages[r.pageId]
          const item: InboxItem = { id: `r:${r.key}`, kind: 'reminder', pageId: r.pageId, at: r.dueAt, blockId: r.blockId, propId: r.propId }
          return (
            <li key={r.key}>
              <button type="button" className="ibx-sched__row" onClick={() => openInboxItem(item)}>
                <BellRing size={13} strokeWidth={1.75} className="ibx-sched__bell" aria-hidden />
                <span className="ibx-sched__when label">{formatDue(r.dueAt, lang)}</span>
                <PageIcon icon={page?.icon ?? null} kind={page?.kind ?? 'page'} size={14} />
                <span className="ibx-sched__title">{page?.title.trim() || t('common.untitled')}</span>
                <span className="ibx-sched__line">{r.excerpt}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Empty({ filter }: { filter: InboxFilter }) {
  const t = useT()
  return (
    <div className="ibx-empty">
      <div className="ibx-empty__plate">
        <span className="led" aria-hidden />
        <span className="label">{t('shell.inbox.empty.signal')}</span>
      </div>
      <p className="ibx-empty__text">{t(`shell.inbox.empty.${filter}`)}</p>
      {(filter === 'all' || filter === 'reminder') && <p className="ibx-empty__how">{t('shell.inbox.howto')}</p>}
    </div>
  )
}
