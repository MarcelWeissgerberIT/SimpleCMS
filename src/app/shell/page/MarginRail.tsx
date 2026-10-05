/**
 * The margin rail: on wide page columns, a sticky column right of the text for finding your way
 * through the page — its outline (scroll-spy, from two headings) and its upcoming reminders. The
 * page's readings and the pages linking here live in the footer (SpecPlate, Backlinks). PageView
 * decides when it shows (main column only, wide enough, no focus mode, no comment rail — see
 * page.css); while it has nothing to show, the page lays out as if it were closed (onFill).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { BellRing, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { collectReminders, type ReminderEntry } from '../../features'
import { Tooltip } from '../../ui/Tooltip'
import { useLang, useT } from '../../i18n'
import type { Database, ID, Page } from '../../store/types'
import { useKbdHint, useNow } from '../lib/hooks'
import { jumpToDate, jumpToHeading, outlineOf, scrollToBlock, useOutline, type OutlineItem } from './outline'
import { RAIL_SHORTCUT, toggleMarginRail, useMarginRailOpen } from './railPref'

/** From how many headings the rail shows an outline. */
const OUTLINE_MIN = 2

export function MarginRail({ page, editor, onFill }: { page: Page; editor: Editor | null; onFill: (filled: boolean) => void }) {
  const t = useT()
  const open = useMarginRailOpen()
  const kbd = useKbdHint()
  const bodyId = useId()
  const spy = useOutline(editor, open)
  const items = useShownOutline(page, editor)
  const due = useUpcomingReminders(page)
  const showOutline = items.length >= OUTLINE_MIN
  // nothing to show: PageView lays the page out without the rail (before paint)
  const filled = showOutline || due.length > 0
  useLayoutEffect(() => onFill(filled), [onFill, filled])
  const shown = open && filled
  const ref = useRef<HTMLElement>(null)
  useBesideProperties(ref, !!page.databaseId)
  let n = 0
  const no = () => String(++n).padStart(2, '0')

  return (
    <aside ref={ref} className="mrail" data-open={open || undefined} data-empty={!filled || undefined} aria-label={t('shell.rail.label')}>
      <div className="mrail__inner">
        <Tooltip label={t(open ? 'shell.rail.hide' : 'shell.rail.show')} shortcut={kbd(RAIL_SHORTCUT)} placement="left">
          <button type="button" className="mrail__key" aria-expanded={open} aria-controls={shown ? bodyId : undefined} onClick={toggleMarginRail}>
            {open ? <PanelRightClose size={15} strokeWidth={1.7} /> : <PanelRightOpen size={15} strokeWidth={1.7} />}
          </button>
        </Tooltip>
        {shown && (
          <div id={bodyId} className="mrail__body">
            {showOutline && (
              <RailSection n={no()} label={t('shell.rail.outline')} count={items.length}>
                <Outline
                  items={items}
                  active={spy.active}
                  onJump={(i) => {
                    if (jumpToHeading(editor, i)) spy.pin(i)
                  }}
                />
              </RailSection>
            )}
            {due.length > 0 && (
              <RailSection n={no()} label={t('shell.rail.reminders')} count={due.length}>
                <Reminders list={due} editor={editor} />
              </RailSection>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Before paint, without subscriptions: does the rail have anything to show for this page — an
 * outline in its stored content or an upcoming reminder? (PageView's first layout; MarginRail
 * follows the live document from then on.)
 */
export function railHasContent(page: Page): boolean {
  if (storedOutline(page.content).length >= OUTLINE_MIN) return true
  const s = useWorkspace.getState()
  if (isSilent(s.pages, page.id)) return false
  const now = Date.now()
  return remindersOf(page, page.databaseId ? s.databases[page.databaseId] : undefined).some((r) => r.dueAt > now)
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

/**
 * The outline the rail shows: the editor's document (useOutline re-renders the rail whenever its
 * outline changes) — until the editor is ready, the stored content's, so the rail never opens empty.
 */
function useShownOutline(page: Page, editor: Editor | null): OutlineItem[] {
  const live = editor && !editor.isDestroyed ? editor : null
  const stored = useMemo(() => (live ? null : storedOutline(page.content)), [live, page.content])
  return live ? outlineOf(live.state.doc) : (stored ?? [])
}

/** Non-empty headings of stored page content (TipTap JSON), by the editor's rules (outline.ts). */
function storedOutline(content: JSONContent | null | undefined): OutlineItem[] {
  const out: OutlineItem[] = []
  const text = (n: JSONContent | undefined): string => (n?.text ?? '') + (n?.content ?? []).map(text).join('')
  const levelOf = (n: JSONContent): number => {
    if (n.type === 'heading') return Number(n.attrs?.level) || 0
    const h = n.type === 'details' ? Number(n.attrs?.heading) : 0
    return h >= 1 && h <= 3 ? h : 0
  }
  const walk = (nodes: JSONContent[] | undefined) => {
    for (const n of nodes ?? []) {
      const level = levelOf(n)
      const title = level ? text(n.type === 'details' ? n.content?.[0] : n).trim() : ''
      if (title) out.push({ level, text: title, id: (n.attrs?.id as string | null | undefined) ?? null })
      if (n.type !== 'heading') walk(n.content)
    }
  }
  walk(content?.content)
  return out
}

/* ---------------- reminders ---------------- */

const UPCOMING_MAX = 4

/** Template dates are placeholders, trashed pages remind nobody (as in the inbox). */
const isSilent = (pages: Record<ID, Page>, id: ID) => inTemplate(pages, id) || isEffectivelyTrashed(pages, id)

const remindersOf = (page: Page, db: Database | undefined) => collectReminders({ [page.id]: page }, db ? { [db.id]: db } : {})

/** The reminders of this page that are still to come, soonest first. */
function useUpcomingReminders(page: Page): ReminderEntry[] {
  const db = useWorkspace((s) => (page.databaseId ? s.databases[page.databaseId] : undefined))
  const silent = useWorkspace((s) => isSilent(s.pages, page.id))
  const now = useNow(60_000)
  const all = useMemo(() => (silent ? [] : remindersOf(page, db)), [silent, page, db])
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
