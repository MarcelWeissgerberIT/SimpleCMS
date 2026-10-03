import type { MouseEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, CalendarDays } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { relativeDateLabel } from '../lib/dates'

function usePageInfo(id: string | null) {
  return useWorkspace(
    useShallow((s) => {
      const p = id ? s.pages[id] : undefined
      // "in trash" also when an ancestor is trashed — the page goes with it on "Empty trash"
      return { exists: !!p, title: p?.title ?? '', icon: p?.icon ?? null, kind: p?.kind ?? 'page', trashed: !!(id && p && isEffectivelyTrashed(s.pages, id)) }
    }),
  )
}

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
  return (
    <NodeViewWrapper className={`page-link${selected ? ' is-selected' : ''}${!info.exists || info.trashed ? ' is-missing' : ''}`} data-type="page-link" contentEditable={false}>
      <a href={id ? `#/p/${id}` : undefined} onClick={(e) => id && info.exists && go(e, id)} draggable={false}>
        <span className="page-link__icon">
          <PageIcon icon={info.icon} kind={info.kind} size={19} />
        </span>
        <span className="page-link__title">{info.exists ? info.title.trim() || t('common.untitled') : t('editor.pageLink.missing')}</span>
        {info.trashed && <span className="page-link__badge label">{t('editor.pageLink.trashed')}</span>}
        <ArrowUpRight className="page-link__arrow" size={14} strokeWidth={1.75} />
      </a>
    </NodeViewWrapper>
  )
}

export function MentionView({ node, selected }: ReactNodeViewProps) {
  const t = useT()
  const lang = useLang()
  const kind = (node.attrs.kind as string) ?? 'page'
  const id = node.attrs.id as string | null
  const label = (node.attrs.label as string | null) ?? ''
  const info = usePageInfo(kind === 'page' ? id : null)
  const person = useWorkspace((s) => (kind === 'person' && id ? s.people.find((p) => p.id === id) : undefined))

  let body
  if (kind === 'page') {
    body = (
      <a href={id ? `#/p/${id}` : undefined} className="mention__page" onClick={(e) => id && info.exists && go(e, id)} draggable={false}>
        <PageIcon icon={info.icon} kind={info.kind} size={15} />
        <span className="mention__title">{info.exists ? info.title.trim() || label || t('common.untitled') : label || t('editor.pageLink.missing')}</span>
      </a>
    )
  } else if (kind === 'date') {
    const text = id ? relativeDateLabel(id, lang, { today: t('editor.date.today'), tomorrow: t('editor.date.tomorrow'), yesterday: t('editor.date.yesterday') }) : label
    body = (
      <span className="mention__date" title={id ?? undefined}>
        <CalendarDays size={13} strokeWidth={1.75} />
        {text}
      </span>
    )
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
