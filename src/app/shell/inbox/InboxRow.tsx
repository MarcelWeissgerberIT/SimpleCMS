/** One inbox item: LED · kind · page (an agent's note without a page: the agent) · context line · time · read / archive. */
import type { KeyboardEvent } from 'react'
import { Archive, ArchiveRestore, Circle, CircleCheck } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { useLang, useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { agentLabel, archiveItems, eventLabel, hasTime, markRead, openInboxItem, reminderLabel, type InboxItem } from '../../features'
import { fmtRelative } from '../lib/format'
import { isUnread } from './model'

function useDetail(item: InboxItem): { line: string; meta: string } {
  const t = useT()
  const lang = useLang()
  const propName = useWorkspace((s) => {
    const page = s.pages[item.pageId]
    const db = page?.databaseId ? s.databases[page.databaseId] : undefined
    return item.propId ? (db?.properties.find((p) => p.id === item.propId)?.name ?? item.excerpt ?? '') : ''
  })
  switch (item.kind) {
    case 'reminder': {
      const when = eventLabel(item.iso, lang)
      const code = item.code ? reminderLabel(item.code, !!item.iso && hasTime(item.iso), t) : ''
      return { line: item.propId ? `${propName} · ${when}` : item.excerpt || when, meta: [when, code].filter(Boolean).join(' · ') }
    }
    case 'mention':
      return { line: item.excerpt ?? '', meta: t('shell.inbox.mentioned') }
    case 'comment':
      return { line: item.excerpt ?? '', meta: t('shell.inbox.replied', { name: item.actor || t('shell.inbox.someone') }) }
    case 'assigned':
      return { line: t('shell.inbox.addedTo', { prop: propName }), meta: '' }
    case 'agent':
      return { line: item.excerpt ?? '', meta: item.agentId ? (agentLabel(`agent:${item.agentId}`) ?? '') : '' }
  }
}

/** Arrow keys move between rows, E archives, U toggles read. */
function onRowKey(e: KeyboardEvent<HTMLLIElement>, item: InboxItem) {
  if (e.altKey || e.metaKey || e.ctrlKey) return
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const rows = [...(e.currentTarget.closest('.ibx-list')?.querySelectorAll<HTMLElement>('.ibx-item__open') ?? [])]
    const i = rows.indexOf(e.currentTarget.querySelector<HTMLElement>('.ibx-item__open')!)
    rows[i + (key === 'ArrowDown' ? 1 : -1)]?.focus()
  } else if (key === 'e') void archiveItems([item.id], !item.archived)
  else if (key === 'u') void markRead([item.id], !item.read)
  else return
  e.preventDefault()
}

export function InboxRow({ item, now }: { item: InboxItem; now: number }) {
  const t = useT()
  const lang = useLang()
  // an agent's note shows its page while that is alive, else the agent
  const page = useWorkspace((s) => {
    const p = item.pageId ? s.pages[item.pageId] : undefined
    return p && (item.kind !== 'agent' || (!p.trashed && !isEffectivelyTrashed(s.pages, p.id))) ? p : undefined
  })
  const agentIcon = useWorkspace((s) => (item.agentId ? s.agents?.[item.agentId]?.icon : undefined))
  const detail = useDetail(item)
  const unread = isUnread(item)
  if (!page && item.kind !== 'agent') return null
  const title = page ? page.title.trim() || t('common.untitled') : detail.meta || t('inbox.kind.agent')
  // without a page the agent is the title already
  const { line } = detail
  const meta = page ? detail.meta : ''
  const time = fmtRelative(Math.min(item.at, now), lang, t('shell.inbox.justNow'))
  return (
    <li className="ibx-item" data-unread={unread || undefined} data-kind={item.kind} onKeyDown={(e) => onRowKey(e, item)}>
      <button type="button" className="ibx-item__open" onClick={() => openInboxItem(item)} aria-label={`${t(`inbox.kind.${item.kind}`)} · ${title}${line ? ` · ${line}` : ''}${unread ? ` · ${t('shell.inbox.unreadDot')}` : ''}`}>
        <span className={`led${unread ? ' led--on' : ''} ibx-item__led`} aria-hidden />
        <span className="ibx-item__kind label">{t(`inbox.kind.${item.kind}`)}</span>
        <span className="ibx-item__body">
          <span className="ibx-item__title">
            {page ? <PageIcon icon={page.icon} kind={page.kind} size={16} /> : <PageIcon icon={agentIcon ?? { type: 'lucide', value: 'Cpu' }} size={16} />}
            <span className="ibx-item__name">{title}</span>
          </span>
          {line && <span className="ibx-item__line">{line}</span>}
          {meta && <span className="ibx-item__meta label">{meta}</span>}
        </span>
        <time className="ibx-item__time label" dateTime={new Date(item.at).toISOString()}>
          {time}
        </time>
      </button>
      <span className="ibx-item__acts">
        <Tooltip label={item.read ? t('shell.inbox.markUnread') : t('shell.inbox.markRead')} shortcut="U">
          <button type="button" className="icon-btn icon-btn--sm" aria-label={item.read ? t('shell.inbox.markUnread') : t('shell.inbox.markRead')} onClick={() => void markRead([item.id], !item.read)}>
            {item.read ? <Circle size={14} strokeWidth={1.75} /> : <CircleCheck size={14} strokeWidth={1.75} />}
          </button>
        </Tooltip>
        <Tooltip label={item.archived ? t('shell.inbox.unarchive') : t('shell.inbox.archive')} shortcut="E">
          <button type="button" className="icon-btn icon-btn--sm" aria-label={item.archived ? t('shell.inbox.unarchive') : t('shell.inbox.archive')} onClick={() => void archiveItems([item.id], !item.archived)}>
            {item.archived ? <ArchiveRestore size={14} strokeWidth={1.75} /> : <Archive size={14} strokeWidth={1.75} />}
          </button>
        </Tooltip>
      </span>
    </li>
  )
}
