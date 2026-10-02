import { useMemo, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { useWorkspace, descendantIds } from '../../store/store'
import { useUI } from '../../store/ui'
import { selectBreadcrumbs } from '../../store/selectors'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { logoMarkSvg } from '@/shared/logo'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'

export function MoveModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const wsName = useWorkspace((s) => s.settings.workspaceName)
  const page = pages[pageId]
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  const targets = useMemo(() => {
    if (!page) return []
    const banned = new Set([pageId, ...descendantIds(pages, pageId)])
    const list = Object.values(pages)
      .filter((p) => !p.trashed && !p.databaseId && p.kind === 'page' && !p.hidden && !banned.has(p.id))
      .map((p) => ({ page: p, path: selectBreadcrumbs(pages, p.id).slice(0, -1).map((x) => x.title.trim() || t('common.untitled')).join(' / ') }))
    const needle = q.trim().toLowerCase()
    const filtered = needle ? list.filter((x) => (x.page.title || '').toLowerCase().includes(needle) || x.path.toLowerCase().includes(needle)) : list
    return filtered.sort((a, b) => b.page.updatedAt - a.page.updatedAt).slice(0, 60)
  }, [pages, pageId, page, q, t])

  if (!page) return null
  const showRoot = !q.trim() && page.parentId !== null
  const items: Array<{ id: ID | null }> = [...(showRoot ? [{ id: null }] : []), ...targets.map((x) => ({ id: x.page.id }))]

  const move = (to: ID | null) => {
    useWorkspace.getState().movePage(pageId, to)
    onClose()
    const dest = to ? pages[to]?.title.trim() || t('common.untitled') : wsName || 'One'
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
            const x = it.id ? targets.find((tg) => tg.page.id === it.id) : null
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
                ) : (
                  <>
                    <PageIcon icon={x!.page.icon} kind={x!.page.kind} size={16} />
                    <span className="move__title">{x!.page.title.trim() || t('common.untitled')}</span>
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
