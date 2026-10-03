/**
 * #/agenda — one calendar for the whole workspace: dated database rows, journal entries and
 * date mentions, in a month grid, a week time grid or an upcoming list.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { addMonths } from 'date-fns'
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { Menu, type MenuEntry } from '../../ui/Menu'
import { Popover, type PopoverAnchor } from '../../ui/Popover'
import { Tooltip } from '../../ui/Tooltip'
import { useIsMobile, useIsTouch, useLocalPref, useNow } from '../lib/hooks'
import { plural } from '../lib/format'
import { SOURCE_ACTIVITY, dateToDay, dayToDate, itemsBetween, overdueItems, useAgendaIndex, type AgendaSource } from './model'
import { fmtDayStamp, fmtMonth, fmtShortDay, fmtTime, fmtYear, isoWeekOf, weekStart } from './format'
import { AgendaProvider, ItemChip, itemKeyDown, itemLabel, sourceLabel, type AgendaCtx } from './parts'
import { createRowOn, openItem, openJournalFor } from './actions'
import { MonthView, monthWeeks } from './MonthView'
import { WeekView, weekDays } from './WeekView'
import { ListView } from './ListView'
import './agenda.css'

export type AgendaViewName = 'month' | 'week' | 'list'
const VIEWS: AgendaViewName[] = ['month', 'week', 'list']
const LIST_DAYS = 28

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export function Agenda() {
  const t = useT()
  const lang = useLang()
  const mobile = useIsMobile()
  const touch = useIsTouch()
  const index = useAgendaIndex()
  const [stored, setView] = useLocalPref<string>('one.agenda.view', mobile ? 'list' : 'month')
  const view: AgendaViewName = VIEWS.includes(stored as AgendaViewName) ? (stored as AgendaViewName) : 'month'
  const [hiddenList, setHiddenList] = useLocalPref<string[]>('one.agenda.hidden', [])
  const hidden = useMemo(() => new Set(Array.isArray(hiddenList) ? hiddenList : []), [hiddenList])
  const now = useNow(60_000)
  const todayN = dateToDay(new Date(now))
  const [cursor, setCursor] = useState(todayN)
  const ws = weekStart(lang)
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const narrow = width > 0 && width < 640

  const range = useMemo(() => {
    if (view === 'month') {
      const w = monthWeeks(cursor, ws)
      return { from: w[0][0], to: w[w.length - 1][6] }
    }
    if (view === 'week') {
      const d = weekDays(cursor, ws)
      return { from: d[0], to: d[6] }
    }
    return { from: cursor, to: cursor + LIST_DAYS - 1 }
  }, [view, cursor, ws])
  const visible = useMemo(() => itemsBetween(index.items, range.from, range.to, hidden), [index.items, range, hidden])
  const overdue = useMemo(
    () => (view === 'list' && todayN >= range.from && todayN <= range.to ? overdueItems(index.items, todayN, hidden).filter((it) => it.end < range.from) : []),
    [view, index.items, todayN, range, hidden],
  )

  const step = (dir: 1 | -1) =>
    setCursor((c) => (view === 'month' ? dateToDay(addMonths(dayToDate(c), dir)) : view === 'week' ? c + 7 * dir : c + LIST_DAYS * dir))
  const goToday = () => setCursor(dateToDay(new Date()))

  // ← / → move, T today, M / W / L switch views (not while typing, in a menu, the peek or a dialog)
  const keys = useRef({ step, goToday, setView })
  keys.current = { step, goToday, setView }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="dialog"], [role="menu"], [data-popover], .sb')) return
      if (document.querySelector('[data-popover], .modal-scrim, .pal-scrim')) return
      const ui = useUI.getState()
      if (ui.peekPageId || ui.paletteOpen || ui.modal) return
      const k = keys.current
      const c = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (c === 'ArrowLeft') k.step(-1)
      else if (c === 'ArrowRight') k.step(1)
      else if (c === 't') k.goToday()
      else if (c === 'm') k.setView('month')
      else if (c === 'w') k.setView('week')
      else if (c === 'l') k.setView('list')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // quick-create menu (click on an empty day) and the "+N more" popover
  const [add, setAdd] = useState<{ day: number; anchor: PopoverAnchor; hour?: number } | null>(null)
  const [more, setMore] = useState<{ day: number; anchor: Element } | null>(null)
  const sourceMap = useMemo(() => new Map(index.sources.map((s) => [s.id, s])), [index.sources])
  const ctx: AgendaCtx = {
    t,
    lang,
    today: todayN,
    sources: sourceMap,
    activity: hidden.has(SOURCE_ACTIVITY) ? null : index.activity,
    openAdd: (day, anchor, hour) => setAdd({ day, anchor, hour }),
    openMore: (day, anchor) => setMore({ day, anchor }),
  }

  const toggleSource = (id: string) => setHiddenList(hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id])

  const title =
    view === 'month' ? (
      <>
        <span className="ag-title__main">{fmtMonth(cursor, lang)}</span>
        <span className="ag-title__year">{fmtYear(cursor)}</span>
      </>
    ) : view === 'week' ? (
      <>
        <span className="ag-title__main">
          {fmtShortDay(range.from, lang)} – {fmtShortDay(range.to, lang)}
        </span>
        <span className="ag-title__year">{fmtYear(range.to)}</span>
      </>
    ) : (
      <>
        <span className="ag-title__main">{cursor === todayN ? t('shell.agenda.upcoming') : `${fmtShortDay(range.from, lang)} – ${fmtShortDay(range.to, lang)}`}</span>
        <span className="ag-title__year">{fmtYear(range.to)}</span>
      </>
    )

  const count = visible.length + overdue.length

  return (
    <AgendaProvider value={ctx}>
      <div ref={rootRef} className="ag" data-view={view} data-narrow={narrow || undefined}>
        <header className="ag-head">
          <div className="ag-head__meta label">
            <span className="ag-head__sec">§ — {t('shell.nav.agenda')}</span>
            <span className="ag-head__rule" />
            <span>
              {t('shell.agenda.week', { n: isoWeekOf(view === 'list' ? cursor : range.from + (view === 'month' ? 7 : 0)) })} · {t(plural('shell.agenda.items', count), { n: count })}
            </span>
          </div>
          <div className="ag-head__row">
            <h1 className="ag-title display" aria-live="polite">
              {title}
            </h1>
            <div className="ag-ctrl">
              <button type="button" className="btn btn--sm ag-today" onClick={goToday} data-on={cursor === todayN || undefined}>
                {t('shell.agenda.today')}
                {!touch && <span className="kbd">T</span>}
              </button>
              <Tooltip label={t('shell.agenda.prev')} shortcut={touch ? undefined : '←'}>
                <button type="button" className="icon-btn" aria-label={t('shell.agenda.prev')} onClick={() => step(-1)}>
                  <ChevronLeft size={17} />
                </button>
              </Tooltip>
              <Tooltip label={t('shell.agenda.next')} shortcut={touch ? undefined : '→'}>
                <button type="button" className="icon-btn" aria-label={t('shell.agenda.next')} onClick={() => step(1)}>
                  <ChevronRight size={17} />
                </button>
              </Tooltip>
              <div className="ag-seg" role="group" aria-label={t('shell.agenda.views')}>
                {VIEWS.map((v) => (
                  <button key={v} type="button" className="ag-seg__btn" aria-pressed={view === v} onClick={() => setView(v)}>
                    <span>{t(`shell.agenda.view.${v}`)}</span>
                    {!touch && <span className="ag-seg__key">{v[0].toUpperCase()}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SourceChips sources={index.sources} hidden={hidden} onToggle={toggleSource} />
        </header>

        <div className="ag-body">
          {view === 'month' && <MonthView cursor={cursor} items={visible} weekStartsOn={ws} narrow={narrow} onPick={setCursor} />}
          {view === 'week' && <WeekView cursor={cursor} items={visible} weekStartsOn={ws} narrow={narrow} />}
          {view === 'list' && <ListView from={range.from} to={range.to} items={visible} overdue={overdue} />}
        </div>


        <Menu open={!!add} anchor={add?.anchor ?? null} onClose={() => setAdd(null)} entries={add ? addEntries(add, index.sources, ctx) : []} width={268} />
        {more && (
          <Popover open anchor={more.anchor} onClose={() => setMore(null)} className="ag-more" placement="bottom-start">
            <div className="label ag-more__head">{fmtDayStamp(more.day, lang)}</div>
            {visible
              .filter((it) => it.start <= more.day && it.end >= more.day)
              .map((it) => (
                <div
                  key={it.key}
                  role="button"
                  tabIndex={0}
                  className="ag-more__item"
                  aria-label={itemLabel(it, ctx)}
                  onClick={() => {
                    setMore(null)
                    openItem(it)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setMore(null)
                    itemKeyDown(it)(e)
                  }}
                >
                  <ItemChip it={it} />
                </div>
              ))}
          </Popover>
        )}
      </div>
    </AgendaProvider>
  )
}

function addEntries(add: { day: number; hour?: number }, sources: AgendaSource[], ctx: AgendaCtx): MenuEntry[] {
  const { t, lang } = ctx
  const when = fmtDayStamp(add.day, lang) + (add.hour !== undefined ? ` · ${fmtTime(`${String(add.hour).padStart(2, '0')}:00`, lang)}` : '')
  const dbs = sources.filter((s) => s.kind === 'database')
  const entries: MenuEntry[] = [
    { kind: 'section', label: when },
    { id: 'journal', label: t('shell.agenda.create.journal'), icon: <NotebookPen size={15} />, onSelect: () => openJournalFor(add.day) },
  ]
  if (dbs.length) {
    entries.push({ kind: 'section', label: t('shell.agenda.create.inDb') })
    for (const s of dbs)
      for (const p of s.dateProps)
        entries.push({
          id: `${s.id}:${p.id}`,
          label: (s.label || t('common.untitled')) + (s.dateProps.length > 1 ? ` · ${p.name}` : ''),
          icon: <PageIcon icon={s.icon} kind="database" size={15} />,
          onSelect: () => createRowOn(s.id, p, add.day, add.hour),
        })
  }
  return entries
}

function SourceChips({ sources, hidden, onToggle }: { sources: AgendaSource[]; hidden: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const t = useT()
  return (
    <div className="ag-sources" role="group" aria-label={t('shell.agenda.sources')}>
      <span className="ag-sources__label label">{t('shell.agenda.sources')}</span>
      {sources.map((s) => {
        const on = !hidden.has(s.id)
        const label = sourceLabel(s, t)
        return (
          <button
            key={s.id}
            type="button"
            className="ag-src"
            data-kind={s.kind}
            aria-pressed={on}
            onClick={() => onToggle(s.id)}
            style={{ '--ag-led': `var(--c-${s.color}-text)` } as CSSProperties}
          >
            <span className="led ag-src__led" aria-hidden />
            {s.kind === 'database' && <PageIcon icon={s.icon} kind="database" size={13} />}
            <span className="ag-src__name">{label}</span>
            {s.kind !== 'activity' && <span className="ag-src__n">{s.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
