import { ArrowUpRight } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useBacklinks, selectBreadcrumbs } from '../../store/selectors'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { goToPage } from '../lib/actions'

export function Backlinks({ pageId }: { pageId: ID }) {
  const t = useT()
  const links = useBacklinks(pageId)
  const pages = useWorkspace((s) => s.pages)
  if (links.length === 0) return null
  return (
    <section className="pv-links" aria-label={t('shell.page.linkedFrom')}>
      <div className="pv-rulelabel">
        <span>{t('shell.page.linkedFrom')}</span>
        <span className="pv-rulelabel__n">· {String(links.length).padStart(2, '0')}</span>
        <span className="pv-rulelabel__rule" />
      </div>
      <ul className="pv-links__list">
        {links.map((p) => {
          const path = selectBreadcrumbs(pages, p.id)
            .slice(0, -1)
            .map((x) => x.title.trim() || t('common.untitled'))
            .join(' / ')
          return (
            <li key={p.id}>
              <a
                href={`#/p/${p.id}`}
                className="pv-link"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                  e.preventDefault()
                  goToPage(p.id)
                }}
              >
                <PageIcon icon={p.icon} kind={p.kind} size={16} />
                <span className="pv-link__title">{p.title.trim() || t('common.untitled')}</span>
                {path && <span className="pv-link__path">{path}</span>}
                <ArrowUpRight size={14} className="pv-link__arrow" />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
