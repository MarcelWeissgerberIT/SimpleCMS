import { useMemo, useState } from 'react'
import type { Placement } from '@floating-ui/react'
import { RotateCcw, Trash2, Search } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useTrash, selectBreadcrumbs } from '../../store/selectors'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { fmtRelative } from '../lib/format'
import { goToPage } from '../lib/actions'

export function TrashPopover({ anchor, onClose, placement }: { anchor: HTMLElement | null; onClose: () => void; placement: Placement }) {
  const t = useT()
  const lang = useLang()
  const trash = useTrash()
  const pages = useWorkspace((s) => s.pages)
  const [q, setQ] = useState('')
  const [armed, setArmed] = useState<string | null>(null)

  // only show top-level trashed items (children of a trashed page travel with it)
  const items = useMemo(() => {
    const top = trash.filter((p) => !(p.parentId && pages[p.parentId]?.trashed))
    const needle = q.trim().toLowerCase()
    return needle ? top.filter((p) => (p.title || '').toLowerCase().includes(needle)) : top
  }, [trash, pages, q])

  const restore = (id: string) => {
    useWorkspace.getState().restorePage(id)
    useUI.getState().toast({ message: t('shell.trash.restored'), kind: 'success' })
  }

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement={placement} offset={8} className="trash-pop" aria-label={t('shell.sidebar.trash')} role="dialog">
      <div className="trash-pop__head">
        <span className="label">{t('shell.sidebar.trash')}</span>
        <span className="label">{String(items.length).padStart(2, '0')}</span>
      </div>
      <div className="trash-pop__search">
        <Search size={14} className="faint" />
        <input className="input input--bare" value={q} placeholder={t('shell.trash.search')} onChange={(e) => setQ(e.target.value)} data-autofocus="" />
      </div>
      <div className="trash-pop__list">
        {items.length === 0 && (
          <div className="trash-pop__empty">
            <Trash2 size={18} strokeWidth={1.5} />
            <span>{q ? t('shell.trash.noMatch') : t('shell.trash.empty')}</span>
          </div>
        )}
        {items.map((p) => {
          const parent = p.parentId ? selectBreadcrumbs(pages, p.parentId).map((x) => x.title.trim() || t('common.untitled')).join(' / ') : ''
          return (
            <div key={p.id} className="trash-item">
              <button
                type="button"
                className="trash-item__main"
                onClick={() => {
                  onClose()
                  goToPage(p.id)
                }}
              >
                <PageIcon icon={p.icon} kind={p.kind} size={16} />
                <span className="trash-item__text">
                  <span className="trash-item__title">{p.title.trim() || t('common.untitled')}</span>
                  <span className="trash-item__meta">
                    {parent ? `${parent} · ` : ''}
                    {p.trashedAt ? fmtRelative(p.trashedAt, lang, t('shell.time.justNow')) : ''}
                  </span>
                </span>
              </button>
              <button type="button" className="icon-btn icon-btn--sm" title={t('shell.trash.restore')} aria-label={t('shell.trash.restore')} onClick={() => restore(p.id)}>
                <RotateCcw size={14} />
              </button>
              {armed === p.id ? (
                <button
                  type="button"
                  className="trash-item__confirm"
                  onClick={() => {
                    setArmed(null)
                    useWorkspace.getState().deletePagePermanently(p.id)
                  }}
                  onBlur={() => setArmed(null)}
                  autoFocus
                >
                  {t('shell.trash.confirmDelete')}
                </button>
              ) : (
                <button type="button" className="icon-btn icon-btn--sm" title={t('shell.trash.deleteForever')} aria-label={t('shell.trash.deleteForever')} onClick={() => setArmed(p.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="trash-pop__foot">
        <span className="label">{t('shell.trash.hint')}</span>
        <button
          type="button"
          className="btn btn--sm btn--ghost btn--danger"
          disabled={trash.length === 0}
          onClick={() => {
            onClose()
            useUI.getState().openModal({
              type: 'confirm',
              title: t('shell.trash.emptyTitle'),
              body: t('shell.trash.emptyBody', { count: trash.length }),
              danger: true,
              confirmLabel: t('shell.trash.emptyConfirm'),
              onConfirm: () => useWorkspace.getState().emptyTrash(),
            })
          }}
        >
          {t('shell.trash.emptyAction')}
        </button>
      </div>
    </Popover>
  )
}
