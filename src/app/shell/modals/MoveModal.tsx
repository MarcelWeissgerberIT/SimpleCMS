import { useMemo, useState } from 'react'
import { CornerDownLeft, Lock, Search } from 'lucide-react'
import { useWorkspace, descendantIds } from '../../store/store'
import { useUI } from '../../store/ui'
import { isEffectivelyTrashed, selectBreadcrumbs, templateRootOf } from '../../store/selectors'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { logoMarkSvg } from '@/shared/logo'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { usePrivateMode } from '../../cloud'
import { requestPrivacyMove } from '../sidebar/private'

/** "Move to" target: a page, the workspace's top level (null) or — team workspaces — my Private section. */
const PRIVATE_ROOT = 'private:root'

export function MoveModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const wsName = useWorkspace((s) => s.settings.workspaceName)
  const page = pages[pageId]
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const privateMode = usePrivateMode()

  const targets = useMemo(() => {
    if (!page) return []
    const banned = new Set([pageId, ...descendantIds(pages, pageId)])
    // template pages (features/templates) are targets only within the same template (its hidden root too)
    const ownTpl = templateRootOf(pages, pageId)
    const list = Object.values(pages)
      // live pages only: a page moved under a trashed subtree would vanish with "Empty trash"
      .filter((p) => !p.trashed && !p.databaseId && p.kind === 'page' && (!p.hidden || p.id === ownTpl) && !banned.has(p.id) && !isEffectivelyTrashed(pages, p.id) && templateRootOf(pages, p.id) === ownTpl)
      .map((p) => ({ page: p, path: selectBreadcrumbs(pages, p.id).slice(0, -1).map((x) => x.title.trim() || t('common.untitled')).join(' / ') }))
    const needle = q.trim().toLowerCase()
    const filtered = needle ? list.filter((x) => (x.page.title || '').toLowerCase().includes(needle) || x.path.toLowerCase().includes(needle)) : list
    return filtered.sort((a, b) => b.page.updatedAt - a.page.updatedAt).slice(0, 60)
  }, [pages, pageId, page, q, t])

  if (!page) return null
  const showRoot = !q.trim() && (page.parentId !== null || !!page.private)
  // team workspaces: the top level of my Private section (pages only I can see)
  const showPrivate = !q.trim() && privateMode === 'write' && (page.parentId !== null || !page.private)
  const items: Array<{ id: ID | null }> = [...(showRoot ? [{ id: null }] : []), ...(showPrivate ? [{ id: PRIVATE_ROOT }] : []), ...targets.map((x) => ({ id: x.page.id }))]

  const move = (to: ID | null) => {
    onClose()
    const toPrivate = to === PRIVATE_ROOT || (!!to && !!pages[to]?.private)
    const parentId = to === PRIVATE_ROOT ? null : to
    // between Private and the workspace the page changes documents (going public asks first)
    if (toPrivate !== !!page.private) {
      void requestPrivacyMove(pageId, toPrivate, { parentId })
      return
    }
    useWorkspace.getState().movePage(pageId, parentId)
    const dest = parentId ? pages[parentId]?.title.trim() || t('common.untitled') : toPrivate ? t('shell.private.title') : wsName || 'One'
    useUI.getState().toast({ message: t('shell.move.done', { dest }), kind: 'success' })
  }

  return (
    <Modal open onClose={onClose} width={520} label={t('shell.move.label')} title={t('shell.move.title', { title: page.title.trim() || t('common.untitled') })}>
      <div className="move">
        <div className="move__search">
          <Search size={15} className="faint" />
          <input
            className="input input--bare"
            placeholder={t('shell.move.search')}
            value={q}
            data-autofocus=""
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(items.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && items[active]) {
                e.preventDefault()
                move(items[active].id)
              }
            }}
          />
        </div>
        <div className="move__list" role="listbox">
          {items.length === 0 && <div className="move__empty faint">{t('shell.move.none')}</div>}
          {items.map((it, i) => {
            const x = it.id && it.id !== PRIVATE_ROOT ? targets.find((tg) => tg.page.id === it.id) : null
            return (
              <button
                key={it.id ?? 'root'}
                type="button"
                role="option"
                aria-selected={i === active}
                className="move__item"
                onMouseEnter={() => setActive(i)}
                onClick={() => move(it.id)}
              >
                {it.id === null ? (
                  <>
                    <span className="move__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(16) }} />
                    <span className="move__title">{t('shell.move.root', { name: wsName || 'One' })}</span>
                  </>
                ) : it.id === PRIVATE_ROOT ? (
                  <>
                    <span className="move__mark">
                      <Lock size={14} strokeWidth={1.75} />
                    </span>
                    <span className="move__title">{t('shell.private.title')}</span>
                    <span className="move__path">{t('shell.private.hint')}</span>
                  </>
                ) : (
                  <>
                    <PageIcon icon={x!.page.icon} kind={x!.page.kind} size={16} />
                    <span className="move__title">{x!.page.title.trim() || t('common.untitled')}</span>
                    {x!.page.private && (
                      <span className="move__private label" title={t('shell.private.lock')}>
                        <Lock size={10} strokeWidth={2} />
                        {t('shell.private.badge')}
                      </span>
                    )}
                    {x!.path && <span className="move__path">{x!.path}</span>}
                  </>
                )}
                {i === active && <CornerDownLeft size={13} className="move__enter" />}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
