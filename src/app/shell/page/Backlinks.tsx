import { useDeferredValue, useId, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronRight, Link2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useBacklinks, selectBreadcrumbs, isEffectivelyTrashed } from '../../store/selectors'
import { toast } from '../../store/ui'
import { pageHref } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import type { ID, Page } from '../../store/types'
import { goToPage } from '../lib/actions'
import { linkMentions, selectUnlinked, unlinkMentions, UNLINKED_CAP, type UnlinkedHit } from '../capture/unlinked'

export function Backlinks({ pageId }: { pageId: ID }) {
  const t = useT()
  const links = useBacklinks(pageId)
  const pages = useWorkspace((s) => s.pages)
  return (
    <>
      {links.length > 0 && (
        <section className="pv-links" aria-label={t('shell.page.linkedFrom')}>
          <div className="pv-rulelabel">
            <span>{t('shell.page.linkedFrom')}</span>
            <span className="pv-rulelabel__n">· {String(links.length).padStart(2, '0')}</span>
            <span className="pv-rulelabel__rule" />
          </div>
          <ul className="pv-links__list">
            {links.map((p) => (
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
                  <PagePath pages={pages} id={p.id} />
                  <ArrowUpRight size={14} className="pv-link__arrow" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <UnlinkedMentions pageId={pageId} linked={links} />
    </>
  )
}

function PagePath({ pages, id }: { pages: Record<ID, Page>; id: ID }) {
  const t = useT()
  const path = selectBreadcrumbs(pages, id)
    .slice(0, -1)
    .map((x) => x.title.trim() || t('common.untitled'))
    .join(' / ')
  return path ? <span className="pv-link__path">{path}</span> : null
}

/**
 * "Unlinked mentions · N": pages that name this page in their text without linking it.
 * Collapsed by default (the count is cheap, see capture/unlinked); "Link" turns the first
 * occurrence into a page mention and the entry moves up into "Linked from".
 */
function UnlinkedMentions({ pageId, linked }: { pageId: ID; linked: Page[] }) {
  const t = useT()
  const listId = useId()
  const [open, setOpen] = useState(false)
  // typing elsewhere must never wait for this footer
  const pages = useDeferredValue(useWorkspace((s) => s.pages))
  const linkedIds = useMemo(() => new Set(linked.map((p) => p.id)), [linked])
  const hits = useMemo(() => (isEffectivelyTrashed(pages, pageId) ? [] : selectUnlinked(pages, pageId, linkedIds)), [pages, pageId, linkedIds])
  if (hits.length === 0) return null
  const shown = hits.slice(0, UNLINKED_CAP)
  const count = hits.length > UNLINKED_CAP ? `${UNLINKED_CAP}+` : String(hits.length).padStart(2, '0')
  const linkable = shown.filter((h) => !h.page.settings.locked)

  const link = (ids: ID[], one?: Page) => {
    const done = linkMentions(pageId, ids)
    if (done.length === 0) {
      toast({ message: t('shell.unlinked.failed'), kind: 'error' })
      return
    }
    toast({
      message: one ? t('shell.unlinked.linkedOne', { title: one.title.trim() || t('common.untitled') }) : t('shell.unlinked.linkedMany', { n: done.length }),
      kind: 'success',
      action: { label: t('common.undo'), run: () => unlinkMentions(pageId, done) },
    })
  }

  return (
    <section className="pv-links pv-um" aria-label={t('shell.unlinked.title')} data-open={open || undefined}>
      <div className="pv-rulelabel">
        <button type="button" className="pv-um__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          <ChevronRight size={13} strokeWidth={2} className="pv-um__chev" aria-hidden />
          <span className="pv-um__name">{t('shell.unlinked.title')}</span>
          <span className="pv-rulelabel__n">· {count}</span>
        </button>
        <span className="pv-rulelabel__rule" />
        {open && linkable.length > 1 && (
          <button type="button" className="pv-um__all" onClick={() => link(linkable.map((h) => h.page.id))}>
            <Link2 size={12} strokeWidth={1.8} aria-hidden />
            {t('shell.unlinked.linkAll')}
          </button>
        )}
      </div>
      {open && (
        <ul className="pv-links__list pv-um__list" id={listId}>
          {shown.map((h) => (
            <UnlinkedRow key={h.page.id} hit={h} pages={pages} onLink={() => link([h.page.id], h.page)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UnlinkedRow({ hit, pages, onLink }: { hit: UnlinkedHit; pages: Record<ID, Page>; onLink: () => void }) {
  const t = useT()
  const { page, occ } = hit
  const title = page.title.trim() || t('common.untitled')
  const block = occ.blockId ?? undefined
  const locked = page.settings.locked
  return (
    <li className="pv-um__item">
      <a
        href={pageHref(page.id, block)}
        className="pv-link pv-um__main"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          goToPage(page.id, block)
        }}
      >
        <span className="pv-um__line">
          <PageIcon icon={page.icon} kind={page.kind} size={16} />
          <span className="pv-link__title">{title}</span>
          <PagePath pages={pages} id={page.id} />
        </span>
        <span className="pv-um__snip">
          {occ.before}
          <mark>{occ.match}</mark>
          {occ.after}
        </span>
      </a>
      <button
        type="button"
        className="btn btn--sm pv-um__btn"
        onClick={onLink}
        disabled={locked}
        title={locked ? t('shell.unlinked.locked') : undefined}
        aria-label={t('shell.unlinked.linkIn', { title })}
      >
        <Link2 size={13} strokeWidth={1.8} aria-hidden />
        {t('shell.unlinked.link')}
      </button>
    </li>
  )
}
