import { useState, type MouseEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useShallow } from 'zustand/react/shallow'
import { format } from 'date-fns'
import { ArrowUpRight, BellRing, CalendarDays, Lock } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { Popover } from '../../ui/Popover'
import { DateReminderEditor, normalizeReminder, reminderLabel, type DateReminderValue } from '../../features'
import { useCloud } from '../../cloud'
import { mentionDateLabel, mentionHasTime, relativeDateLabel } from '../lib/dates'
import './dateMention.css'

function usePageInfo(id: string | null) {
  return useWorkspace(
    useShallow((s) => {
      const p = id ? s.pages[id] : undefined
      // "in trash" also when an ancestor is trashed — the page goes with it on "Empty trash"
      return { exists: !!p, title: p?.title ?? '', icon: p?.icon ?? null, kind: p?.kind ?? 'page', trashed: !!(id && p && isEffectivelyTrashed(s.pages, id)) }
    }),
  )
}

/**
 * Team workspaces: a page that isn't here is someone else's private page (or deleted) — a neutral
 * "No access", never the title a mention carried when it was written (docs/CLOUD.md § Private pages).
 */
const useTeam = () => useCloud((s) => s.active.kind === 'cloud')

function go(e: MouseEvent, id: string) {
  e.preventDefault()
  e.stopPropagation()
  if (e.altKey || e.metaKey || e.ctrlKey) useUI.getState().openPane(id)
  else openPage(id)
}

export function PageLinkView({ node, selected }: ReactNodeViewProps) {
  const t = useT()
  const id = node.attrs.pageId as string | null
  const info = usePageInfo(id)
  const noAccess = useTeam() && !info.exists
  return (
    <NodeViewWrapper className={`page-link${selected ? ' is-selected' : ''}${!info.exists || info.trashed ? ' is-missing' : ''}`} data-type="page-link" data-no-access={noAccess || undefined} contentEditable={false}>
      <a href={id ? `#/p/${id}` : undefined} onClick={(e) => id && info.exists && go(e, id)} draggable={false}>
        <span className="page-link__icon">{noAccess ? <Lock size={15} strokeWidth={1.75} /> : <PageIcon icon={info.icon} kind={info.kind} size={19} />}</span>
        <span className="page-link__title">{info.exists ? info.title.trim() || t('common.untitled') : noAccess ? t('editor.pageLink.noAccess') : t('editor.pageLink.missing')}</span>
        {info.trashed && <span className="page-link__badge label">{t('editor.pageLink.trashed')}</span>}
        <ArrowUpRight className="page-link__arrow" size={14} strokeWidth={1.75} />
      </a>
    </NodeViewWrapper>
  )
}

/**
 * A date mention: the date (relative when near) and a bell when it has a reminder. In an editable
 * doc a click opens the date + time + reminder popover; read-only renders (share, history) only show it.
 */
function DateMention({ node, editor, getPos, updateAttributes }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos' | 'updateAttributes'>) {
  const t = useT()
  const lang = useLang()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const id = node.attrs.id as string | null
  const label = (node.attrs.label as string | null) ?? ''
  const reminder = normalizeReminder(node.attrs.reminder)
  const text = id ? relativeDateLabel(id, lang, { today: t('editor.date.today'), tomorrow: t('editor.date.tomorrow'), yesterday: t('editor.date.yesterday') }) : label
  const bell = reminder && id ? t('inbox.remind.set', { label: reminderLabel(reminder, mentionHasTime(id), t) }) : null
  const body = (
    <>
      <CalendarDays size={13} strokeWidth={1.75} />
      {text}
      {bell && <BellRing className="mention__bell" size={11} strokeWidth={2} aria-label={bell} />}
    </>
  )
  if (!editor.isEditable)
    return (
      <span className="mention__date" title={[id, bell].filter(Boolean).join(' · ') || undefined}>
        {body}
      </span>
    )
  const change = (v: DateReminderValue) => updateAttributes({ id: v.iso, label: mentionDateLabel(v.iso, lang), reminder: v.reminder })
  const close = () => {
    setAnchor(null)
    // back to writing, right after the mention
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos === 'number' && editor.isEditable) editor.chain().focus().setTextSelection(pos + node.nodeSize).run()
  }
  return (
    <>
      <button
        type="button"
        className="mention__date"
        data-reminder={reminder ? '' : undefined}
        data-open={anchor ? '' : undefined}
        title={[id, bell].filter(Boolean).join(' · ') || undefined}
        aria-label={`${text}${bell ? ` · ${bell}` : ''} — ${t('inbox.date.edit')}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {body}
      </button>
      <Popover open={!!anchor} anchor={anchor} onClose={close} placement="bottom-start" offset={6} className="dme-pop" role="dialog" aria-label={t('inbox.date.edit')}>
        <DateReminderEditor value={{ iso: id ?? format(new Date(), 'yyyy-MM-dd'), reminder }} onChange={change} onDone={close} />
      </Popover>
    </>
  )
}

export function MentionView({ node, selected, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const t = useT()
  const kind = (node.attrs.kind as string) ?? 'page'
  const id = node.attrs.id as string | null
  const label = (node.attrs.label as string | null) ?? ''
  const info = usePageInfo(kind === 'page' ? id : null)
  const person = useWorkspace((s) => (kind === 'person' && id ? s.people.find((p) => p.id === id) : undefined))
  const noAccess = useTeam() && kind === 'page' && !info.exists

  let body
  if (kind === 'page') {
    body = (
      <a href={id ? `#/p/${id}` : undefined} className="mention__page" data-no-access={noAccess || undefined} onClick={(e) => id && info.exists && go(e, id)} draggable={false}>
        {noAccess ? <Lock size={12} strokeWidth={2} /> : <PageIcon icon={info.icon} kind={info.kind} size={15} />}
        <span className="mention__title">{info.exists ? info.title.trim() || label || t('common.untitled') : noAccess ? t('editor.pageLink.noAccess') : label || t('editor.pageLink.missing')}</span>
      </a>
    )
  } else if (kind === 'date') {
    body = <DateMention node={node} editor={editor} getPos={getPos} updateAttributes={updateAttributes} />
  } else {
    body = (
      <span className="mention__person" style={{ color: `var(--c-${person?.color ?? 'gray'}-text)` }}>
        @{person?.name ?? label}
      </span>
    )
  }
  return (
    <NodeViewWrapper as="span" className={`mention mention--${kind}${selected ? ' is-selected' : ''}`} data-type="mention" contentEditable={false}>
      {body}
    </NodeViewWrapper>
  )
}
