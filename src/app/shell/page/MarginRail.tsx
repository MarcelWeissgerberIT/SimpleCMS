/**
 * The margin rail: on wide page columns, a sticky column right of the text with the page's
 * outline (scroll-spy), its upcoming reminders, its spec readings and the pages linking here.
 * PageView decides when it shows (main column only, wide enough, no focus mode, no comment rail —
 * see page.css).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { BellRing, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, useBacklinks } from '../../store/selectors'
import { collectReminders, type ReminderEntry } from '../../features'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { useLang, useT } from '../../i18n'
import type { Page } from '../../store/types'
import { goToPage } from '../lib/actions'
import { useKbdHint, useNow } from '../lib/hooks'
import { Stamp, shortId, usePageReadings } from './SpecPlate'
import { jumpToDate, jumpToHeading, scrollToBlock, useOutline, type OutlineItem } from './outline'
import { RAIL_SHORTCUT, toggleMarginRail, useMarginRailOpen } from './railPref'

export function MarginRail({ page, editor }: { page: Page; editor: Editor | null }) {
  const t = useT()
  const open = useMarginRailOpen()
  const kbd = useKbdHint()
  const bodyId = useId()
  const outline = useOutline(editor, open)
  const links = useBacklinks(page.id)
  const due = useUpcomingReminders(page, open)
  const showOutline = outline.items.length >= 2
  const ref = useRef<HTMLElement>(null)
  useBesideProperties(ref, !!page.databaseId)
  let n = 0
  const no = () => String(++n).padStart(2, '0')

  return (
    <aside ref={ref} className="mrail" data-open={open || undefined} aria-label={t('shell.rail.label')}>
      <div className="mrail__inner">
        <Tooltip label={t(open ? 'shell.rail.hide' : 'shell.rail.show')} shortcut={kbd(RAIL_SHORTCUT)} placement="left">
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
            {due.length > 0 && (
              <RailSection n={no()} label={t('shell.rail.reminders')} count={due.length}>
                <Reminders list={due} editor={editor} />
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
  const list = useRef<HTMLOListElement>(null)
  // a long outline scrolls inside the rail: keep the section being read in view
  useEffect(() => {
    const el = list.current?.children[active] as HTMLElement | undefined
    const box = list.current?.closest<HTMLElement>('.mrail__body')
    if (!el || !box || box.scrollHeight <= box.clientHeight) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 8
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8
  }, [active])
  return (
    <nav aria-label={t('shell.rail.outline')}>
      <ol ref={list} className="mrail-toc">
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

/* ---------------- reminders ---------------- */

const UPCOMING_MAX = 4

/** The reminders of this page that are still to come, soonest first (none in templates or the trash). */
function useUpcomingReminders(page: Page, enabled: boolean): ReminderEntry[] {
  const db = useWorkspace((s) => (page.databaseId ? s.databases[page.databaseId] : undefined))
  // template dates are placeholders, trashed pages remind nobody (as in the inbox)
  const silent = useWorkspace((s) => inTemplate(s.pages, page.id) || isEffectivelyTrashed(s.pages, page.id))
  const now = useNow(60_000)
  const all = useMemo(
    () => (enabled && !silent ? collectReminders({ [page.id]: page }, db ? { [db.id]: db } : {}) : []),
    [enabled, silent, page, db],
  )
  return useMemo(() => all.filter((r) => r.dueAt > now).slice(0, UPCOMING_MAX), [all, now])
}

function Reminders({ list, editor }: { list: ReminderEntry[]; editor: Editor | null }) {
  const t = useT()
  const lang = useLang()
  const jump = (r: ReminderEntry, from: HTMLElement) => {
    if (r.source === 'mention') return jumpToDate(editor, r.iso, r.code)
    // a date property: the entry's property list
    const props = from.closest('.pv')?.querySelector<HTMLElement>(':scope > .pv-head .pv-props')
    if (props) scrollToBlock(props)
  }
  return (
    <ul className="mrail-due">
      {list.map((r) => {
        const locale = lang === 'de' ? de : enUS
        const when = format(r.dueAt, lang === 'de' ? 'EEE dd. MMM · HH:mm' : 'EEE dd MMM · HH:mm', { locale }).toUpperCase()
        return (
          <li key={r.key}>
            <button type="button" className="mrail-due__a" aria-label={t('shell.rail.reminderAt', { when, what: r.excerpt })} onClick={(e) => jump(r, e.currentTarget)}>
              <span className="mrail-due__when">
                <BellRing size={12} strokeWidth={1.75} aria-hidden />
                {when}
              </span>
              <span className="mrail-due__in">{formatDistanceToNowStrict(r.dueAt, { addSuffix: true, locale }).toUpperCase()}</span>
              <span className="mrail-due__what">{r.excerpt || '—'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------- placement ---------------- */

/**
 * A database entry: the rail starts beside its property list (the entry's spec sheet), not below
 * it — a long property list would push the rail out of sight. The offset follows the header's size.
 */
function useBesideProperties(ref: RefObject<HTMLElement | null>, isRow: boolean) {
  useLayoutEffect(() => {
    const rail = ref.current
    const body = rail?.parentElement
    const head = rail?.closest('.pv')?.querySelector<HTMLElement>(':scope > .pv-head')
    const props = head?.querySelector<HTMLElement>('.pv-props')
    if (!rail || !body || !head || !props || !isRow) return
    const place = () => {
      const top = props.getBoundingClientRect().top - body.getBoundingClientRect().top
      rail.style.top = `${Math.round(top) + 4}px`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(head)
    return () => {
      ro.disconnect()
      rail.style.top = ''
    }
  }, [ref, isRow])
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
