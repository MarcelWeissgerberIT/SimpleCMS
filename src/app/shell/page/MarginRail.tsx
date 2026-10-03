/**
 * The margin rail: on wide page columns, a sticky column right of the text with the page's
 * outline (scroll-spy), its spec readings and the pages linking here. PageView decides when it
 * shows (main column only, wide enough, no focus mode, no comment rail — see page.css).
 */
import { useId, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useBacklinks } from '../../store/selectors'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import type { Page } from '../../store/types'
import { goToPage } from '../lib/actions'
import { Stamp, shortId, usePageReadings } from './SpecPlate'
import { jumpToHeading, useOutline, type OutlineItem } from './outline'
import { RAIL_SHORTCUT, toggleMarginRail, useMarginRailOpen } from './railPref'

export function MarginRail({ page, editor }: { page: Page; editor: Editor | null }) {
  const t = useT()
  const open = useMarginRailOpen()
  const bodyId = useId()
  const outline = useOutline(editor, open)
  const links = useBacklinks(page.id)
  const showOutline = outline.items.length >= 2
  let n = 0
  const no = () => String(++n).padStart(2, '0')

  return (
    <aside className="mrail" data-open={open || undefined} aria-label={t('shell.rail.label')}>
      <div className="mrail__inner">
        <Tooltip label={t(open ? 'shell.rail.hide' : 'shell.rail.show')} shortcut={RAIL_SHORTCUT} placement="left">
          <button type="button" className="mrail__key" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={toggleMarginRail}>
            {open ? <PanelRightClose size={15} strokeWidth={1.7} /> : <PanelRightOpen size={15} strokeWidth={1.7} />}
          </button>
        </Tooltip>
        {open && (
          <div id={bodyId} className="mrail__body">
            {showOutline && (
              <RailSection n={no()} label={t('shell.rail.outline')} count={outline.items.length}>
                <Outline
                  items={outline.items}
                  active={outline.active}
                  onJump={(i) => {
                    if (jumpToHeading(editor, i)) outline.pin(i)
                  }}
                />
              </RailSection>
            )}
            <RailSection n={no()} label={t(page.databaseId ? 'shell.rail.entry' : 'shell.rail.page')}>
              <Readings page={page} />
            </RailSection>
            {links.length > 0 && (
              <RailSection n={no()} label={t('shell.page.linkedFrom')} count={links.length}>
                <ul className="mrail-links">
                  {links.map((p) => (
                    <li key={p.id}>
                      <a
                        href={`#/p/${p.id}`}
                        className="mrail-links__a"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                          e.preventDefault()
                          goToPage(p.id)
                        }}
                      >
                        <PageIcon icon={p.icon} kind={p.kind} size={16} />
                        <span className="mrail-links__title">{p.title.trim() || t('common.untitled')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </RailSection>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function RailSection({ n, label, count, children }: { n: string; label: string; count?: number; children: ReactNode }) {
  const id = useId()
  return (
    <section className="mrail__sec" aria-labelledby={id}>
      <div className="mrail__head">
        <span className="mrail__n" aria-hidden>
          {n}
        </span>
        <span id={id} className="mrail__label">
          {label}
        </span>
        <span className="mrail__leader" aria-hidden />
        {count !== undefined && <span className="mrail__count">{String(count).padStart(2, '0')}</span>}
      </div>
      {children}
    </section>
  )
}

function Outline({ items, active, onJump }: { items: OutlineItem[]; active: number; onJump: (i: number) => void }) {
  const t = useT()
  const min = Math.min(...items.map((h) => h.level))
  return (
    <nav aria-label={t('shell.rail.outline')}>
      <ol className="mrail-toc">
        {items.map((h, i) => (
          <li key={`${h.id ?? 'h'}-${i}`} data-depth={Math.min(2, h.level - min)}>
            <button type="button" className="mrail-toc__a" aria-current={i === active ? 'location' : undefined} onClick={() => onJump(i)} title={h.text}>
              {h.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The spec plate's readings, as a compact list. */
function Readings({ page }: { page: Page }) {
  const t = useT()
  const r = usePageReadings(page)
  const by = useLastEditor(page)
  const rows: Array<[string, ReactNode]> = [
    [t('shell.spec.words'), r.words],
    [t('shell.spec.read'), r.read],
    [t('shell.spec.created'), <Stamp ts={page.createdAt} />],
    [t('shell.spec.edited'), r.edited],
    ...(by ? [[t('shell.rail.by'), by] as [string, ReactNode]] : []),
    ['ID', shortId(page.id)],
    ['REV', String(page.contentRev).padStart(2, '0')],
  ]
  return (
    <dl className="mrail-spec">
      {rows.map(([k, v]) => (
        <div key={k} className="mrail-spec__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Team workspaces: who changed the page last (a member, the public API or a webhook). */
function useLastEditor(page: Page): string | null {
  const t = useT()
  const person = useWorkspace((s) => (page.updatedBy ? s.people.find((p) => p.id === page.updatedBy)?.name : undefined))
  const id = page.updatedBy
  if (!id) return null
  if (id.startsWith('api:')) return t('shell.rail.byApi')
  if (id.startsWith('hook:')) return t('shell.rail.byWebhook')
  return person?.trim() || null
}
