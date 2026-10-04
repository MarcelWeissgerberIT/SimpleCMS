/**
 * Breadcrumb block: the path of the page it sits on — workspace › parents › page — as links that
 * follow renames and moves. A frozen path (share links, exports: schema/breadcrumb.ts) shows as text.
 */
import type { KeyboardEvent as RKeyboardEvent, MouseEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { useShallow } from 'zustand/react/shallow'
import { Lock } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate, openPage, useRoute } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { frozenPathOf, trailOf } from '../lib/breadcrumbs'
import { BREADCRUMB_SEP } from '../schema/breadcrumb'
import './blocks.css'

/** The open workspace's name, live (team workspaces: the server's name). */
function useWorkspaceName(): string {
  const team = useCloud((s) => (s.active.kind === 'cloud' ? (s.workspaces.find((w) => w.id === (s.active as { id: string }).id)?.name ?? null) : null))
  const local = useWorkspace((s) => s.settings.workspaceName.trim())
  return team || local || 'One'
}

function follow(e: MouseEvent, id: string) {
  e.preventDefault()
  e.stopPropagation()
  if (e.altKey || e.metaKey || e.ctrlKey) useUI.getState().openPane(id)
  else openPage(id)
}

const Sep = () => (
  <span className="crumbs-view__sep" aria-hidden>
    {BREADCRUMB_SEP}
  </span>
)

export function BreadcrumbView({ node, editor, selected, getPos }: ReactNodeViewProps) {
  const t = useT()
  const route = useRoute()
  // the page this editor shows; read-only renders (history, slides) fall back to the open page
  const pageId = editor.view.dom.getAttribute('data-page-id') ?? (route.name === 'page' ? route.id : null)
  const frozen = frozenPathOf(node.attrs.path)
  const chain = useWorkspace(useShallow((s) => trailOf(s.pages, pageId).pages))
  const gap = useWorkspace((s) => trailOf(s.pages, pageId).gap)
  const workspace = useWorkspaceName()
  const untitled = t('common.untitled')

  // Escape inside the links: back to the block (like the media toolbars)
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key !== 'Escape' || !editor.isEditable) return
    const pos = getPos()
    if (typeof pos !== 'number') return
    e.preventDefault()
    e.stopPropagation()
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    editor.view.focus()
  }

  let body
  if (chain.length) {
    const priv = !!chain[0].private
    body = (
      <ol className="crumbs-view__list" data-block-tools="" onKeyDown={onKeyDown}>
        <li className="crumbs-view__li">
          <a
            href="#/"
            className="crumbs-view__item crumbs-view__root"
            draggable={false}
            onClick={(e) => {
              e.preventDefault()
              navigate({ name: 'home' })
            }}
          >
            <span className="crumbs-view__mark" aria-hidden>
              {[...workspace][0]?.toUpperCase()}
            </span>
            <span className="crumbs-view__title">{workspace}</span>
          </a>
        </li>
        {priv && (
          <li className="crumbs-view__li">
            <Sep />
            <span className="crumbs-view__item crumbs-view__static">
              <Lock size={12} strokeWidth={2} aria-hidden />
              <span className="crumbs-view__title">{t('editor.breadcrumb.private')}</span>
            </span>
          </li>
        )}
        {gap && (
          <li className="crumbs-view__li">
            <Sep />
            <span className="crumbs-view__item crumbs-view__static" title={t('editor.pageLink.noAccess')}>
              <Lock size={12} strokeWidth={2} aria-label={t('editor.pageLink.noAccess')} />…
            </span>
          </li>
        )}
        {chain.map((p, i) => {
          const last = i === chain.length - 1
          return (
            <li key={p.id} className="crumbs-view__li">
              <Sep />
              <a href={`#/p/${p.id}`} className="crumbs-view__item" aria-current={last ? 'page' : undefined} draggable={false} onClick={(e) => follow(e, p.id)}>
                <PageIcon icon={p.icon} kind={p.kind} size={15} />
                <span className="crumbs-view__title" data-untitled={!p.title.trim() || undefined}>
                  {p.title.trim() || untitled}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    )
  } else if (frozen) {
    body = (
      <ol className="crumbs-view__list">
        {frozen.map((label, i) => (
          <li key={i} className="crumbs-view__li">
            {i > 0 && <Sep />}
            <span className="crumbs-view__item crumbs-view__static" aria-current={i === frozen.length - 1 ? 'page' : undefined}>
              <span className="crumbs-view__title">{label || untitled}</span>
            </span>
          </li>
        ))}
      </ol>
    )
  } else {
    body = <span className="crumbs-view__empty label">{t('editor.breadcrumb.empty')}</span>
  }

  return (
    <NodeViewWrapper as="nav" className={`crumbs-view${selected ? ' is-selected' : ''}`} data-type="breadcrumb" contentEditable={false} aria-label={t('editor.block.breadcrumb')}>
      {body}
    </NodeViewWrapper>
  )
}
