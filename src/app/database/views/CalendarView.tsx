/**
 * Calendar view: month grid with locale-aware week start (de: Monday), multi-day bars in lanes,
 * drag events to another day (@dnd-kit), "+" on day hover, today / prev / next, "no date" tray.
 */
import { useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import type { ColorName, ColorRule, DateValue, ID, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { useModel, useLocalState, type DbModel } from '../hooks'
import { useViewActions } from './shared'
import { dfLocale, formatTime, isDateValue, parseLocal, shiftDateValue, toISODate, weekStartsOn } from '../model/format'
import { isDate } from '../formula'
import { writeValue } from '../model/actions'
import { Select, TypeIcon } from '../parts'
import { isDateType } from '../model/schema'
import { activeRules, ruleMatcher } from '../model/colors'
import { afterDateMove } from '../model/dependencies'
import './calendar.css'

interface Ev {
  row: Page
  start: Date
  end: Date
  time: string | null
  color: ColorName | null
  /** colour rule the row matches (overrides the status colour) */
  rc: ColorRule | null
}

interface Seg {
  ev: Ev
  col: number
  span: number
  lane: number
  contL: boolean
  contR: boolean
}

/** Colour accent for an event: first status/select option colour. */
function accentOf(m: DbModel, row: Page): ColorName | null {
  const p = m.db.properties.find((x) => x.type === 'status') ?? m.db.properties.find((x) => x.type === 'select')
  if (!p) return null
  const v = row.properties[p.id]
  return p.options?.find((o) => o.id === v)?.color ?? null
}

export function eventsOf(m: DbModel, prop: PropertyDef): { events: Ev[]; undated: Page[] } {
  const events: Ev[] = []
  const undated: Page[] = []
  const colorOf = ruleMatcher(m.resolver, m.db, activeRules(m.view, m.propMap), m.propMap)
  for (const row of m.rows) {
    const v = m.resolver.value(m.db, prop, row)
    let start: Date | null = null
    let end: Date | null = null
    let time: string | null = null
    if (isDateValue(v)) {
      start = parseLocal((v as DateValue).start)
      end = parseLocal((v as DateValue).end ?? null)
      if ((v as DateValue).includeTime && start) time = formatTime(start, m.resolver.ctx.lang)
    } else if (isDate(v)) start = v
    if (!start) {
      undated.push(row)
      continue
    }
    if (!end || end < start) end = start
    const rc = colorOf(row)
    events.push({ row, start, end, time, color: rc?.color ?? accentOf(m, row), rc })
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  return { events, undated }
}

export default function CalendarView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const lang = m.resolver.ctx.lang
  const locale = dfLocale(lang)
  const ws = weekStartsOn(lang)
  const [monthIso, setMonthIso] = useLocalState<string>(`one.db.cal.${m.view.id}`, toISODate(startOfMonth(new Date())))
  const month = startOfMonth(parseLocal(monthIso) ?? new Date())
  const setMonth = (d: Date) => setMonthIso(toISODate(startOfMonth(d)))
  const prop = m.view.dateProperty ? m.propMap.get(m.view.dateProperty) : undefined
  const editable = prop?.type === 'date'
  const [dragging, setDragging] = useState<Ev | null>(null)
  const grab = useRef<{ row: ID; day: Date } | null>(null)
  const [more, setMore] = useState<{ day: Date; el: HTMLElement } | null>(null)
  const [undatedAnchor, setUndatedAnchor] = useState<HTMLElement | null>(null)
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  const maxLanes = narrow ? 3 : 4

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }))

  const { events, undated } = useMemo(() => (prop ? eventsOf(m, prop) : { events: [], undated: [] }), [m, prop])
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: ws }), end: endOfWeek(endOfMonth(month), { weekStartsOn: ws }) }), [month, ws])
  const weeks = useMemo(() => {
    const out: Date[][] = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [days])

  const layout = useMemo(
    () =>
      weeks.map((week) => {
        const ws0 = week[0]
        const we = week[6]
        const segs: Seg[] = []
        const lanes: number[][] = []
        for (const ev of events) {
          if (ev.end < ws0 || ev.start > addDays(we, 1)) continue
          if (differenceInCalendarDays(ev.end, ws0) < 0 || differenceInCalendarDays(ev.start, we) > 0) continue
          const col = Math.max(0, differenceInCalendarDays(ev.start, ws0))
          const last = Math.min(6, differenceInCalendarDays(ev.end, ws0))
          const span = last - col + 1
          let lane = 0
          while ((lanes[lane] ?? []).some((c) => c >= col && c <= last)) lane++
          lanes[lane] = [...(lanes[lane] ?? []), ...Array.from({ length: span }, (_, i) => col + i)]
          segs.push({ ev, col, span, lane, contL: differenceInCalendarDays(ev.start, ws0) < 0, contR: differenceInCalendarDays(ev.end, we) > 0 })
        }
        return segs
      }),
    [weeks, events],
  )

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).split('|')[0]
    setDragging(events.find((x) => x.row.id === id) ?? null)
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const g = grab.current
    grab.current = null
    if (!e.over || !g || !prop || !editable) return
    const target = parseLocal(String(e.over.id))
    if (!target) return
    const delta = differenceInCalendarDays(target, g.day)
    if (!delta) return
    const row = useWorkspace.getState().pages[g.row]
    const v = row?.properties[prop.id]
    if (row && isDateValue(v)) {
      writeValue(m.db.id, prop, row.id, shiftDateValue(v as DateValue, delta))
      if (delta > 0) afterDateMove(m.db.id, prop, row.id)
    }
  }

  const createOn = (day: Date) => {
    if (!prop || !editable) return
    actions.newRow({ properties: { [prop.id]: { start: toISODate(day) } }, open: true })
  }

  if (!prop) return <PickDateProp m={m} />

  return (
    <div className="dbcal" data-narrow={narrow}>
      <div className="dbcal-head">
        <h3 className="dbcal-head__month">
          <span className="dbcal-head__m">{format(month, 'LLLL', { locale })}</span>
          <span className="dbcal-head__y">{format(month, 'yyyy')}</span>
        </h3>
        <span style={{ flex: 1 }} />
        {undated.length > 0 && (
          <button type="button" className="dbcal-undated" onClick={(e) => setUndatedAnchor(e.currentTarget)}>
            <span className="label">{t('database.calendar.noDate')}</span>
            <span className="dbb-count">{undated.length}</span>
          </button>
        )}
        <button type="button" className="btn btn--sm" onClick={() => setMonth(new Date())}>
          {t('database.date.today')}
        </button>
        <button type="button" className="icon-btn" aria-label={t('database.date.prev')} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('database.date.next')} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="dbcal-wd" role="row">
        {weeks[0].map((d) => (
          <span key={d.toISOString()} className="dbcal-wd__d" role="columnheader" data-weekend={d.getDay() === 0 || d.getDay() === 6}>
            {format(d, narrow ? 'EEEEE' : 'EEE', { locale })}
          </span>
        ))}
      </div>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="dbcal-grid" role="grid">
          {weeks.map((week, wi) => {
            const segs = layout[wi]
            const usedLanes = Math.min(maxLanes, Math.max(0, ...segs.map((s) => s.lane + 1)))
            const hiddenPerDay = week.map((_, c) => segs.filter((s) => s.lane >= maxLanes && c >= s.col && c < s.col + s.span).length)
            return (
              <div key={wi} className="dbcal-week" role="row" style={{ ['--lanes' as string]: usedLanes }}>
                {week.map((d, c) => (
                  <DayCell key={d.toISOString()} day={d} month={month} hidden={hiddenPerDay[c]} pips={narrow} canAdd={editable} onAdd={() => createOn(d)} onMore={(el) => setMore({ day: d, el })} />
                ))}
                <div className="dbcal-events">
                  {segs
                    .filter((s) => s.lane < maxLanes)
                    .map((s) => (
                      <EventBar
                        key={`${s.ev.row.id}|${wi}`}
                        id={`${s.ev.row.id}|${wi}`}
                        seg={s}
                        disabled={!editable}
                        onGrab={(day) => (grab.current = { row: s.ev.row.id, day })}
                        weekStart={week[0]}
                        onOpen={() => actions.open(s.ev.row)}
                      />
                    ))}
                </div>
              </div>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <EventChip ev={dragging} overlay /> : null}</DragOverlay>
      </DndContext>
      {more && (
        <Popover open anchor={more.el} onClose={() => setMore(null)} className="dbcal-more">
          <div className="label dbcal-more__head">{format(more.day, lang === 'de' ? 'EEEE, d. MMM' : 'EEEE, MMM d', { locale })}</div>
          {events
            .filter((ev) => differenceInCalendarDays(more.day, ev.start) >= 0 && differenceInCalendarDays(ev.end, more.day) >= 0)
            .map((ev) => (
              <button key={ev.row.id} type="button" className="dbcal-more__item" onClick={() => (setMore(null), actions.open(ev.row))}>
                <EventChip ev={ev} />
              </button>
            ))}
        </Popover>
      )}
      {undatedAnchor && (
        <Popover open anchor={undatedAnchor} onClose={() => setUndatedAnchor(null)} placement="bottom-end" className="dbcal-more">
          <div className="label dbcal-more__head">{t('database.calendar.noDate')}</div>
          {undated.map((row) => (
            <button key={row.id} type="button" className="dbcal-more__item" onClick={() => (setUndatedAnchor(null), actions.open(row))}>
              <PageIcon icon={row.icon} size={14} />
              <span>{row.title || t('common.untitled')}</span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}

function DayCell({ day, month, hidden, pips, canAdd, onAdd, onMore }: { day: Date; month: Date; hidden: number; pips: boolean; canAdd: boolean; onAdd: () => void; onMore: (el: HTMLElement) => void }) {
  const t = useT()
  const locale = dfLocale(useLang())
  const iso = toISODate(day)
  const { setNodeRef, isOver } = useDroppable({ id: iso })
  return (
    <div
      ref={setNodeRef}
      className="dbcal-day"
      role="gridcell"
      data-day={iso}
      data-out={!isSameMonth(day, month)}
      data-today={isToday(day)}
      data-weekend={day.getDay() === 0 || day.getDay() === 6}
      data-over={isOver}
      onDoubleClick={() => canAdd && onAdd()}
    >
      <span className="dbcal-day__num">{day.getDate() === 1 ? format(day, 'd MMM', { locale }) : day.getDate()}</span>
      {canAdd && (
        <button type="button" className="dbcal-day__add" aria-label={t('database.calendar.addOn', { date: iso })} onClick={onAdd}>
          <Plus size={13} />
        </button>
      )}
      {hidden > 0 && (
        <button type="button" className="dbcal-day__more" data-pips={pips} aria-label={t('database.calendar.more', { count: hidden })} onClick={(e) => onMore(e.currentTarget)}>
          {pips ? Array.from({ length: Math.min(hidden, 3) }, (_, i) => <i key={i} />) : `+${hidden}`}
        </button>
      )}
    </div>
  )
}

function EventChip({ ev, overlay }: { ev: Ev; overlay?: boolean }) {
  const t = useT()
  return (
    <span className="dbcal-chip" data-overlay={overlay} data-rc={ev.rc?.target} style={{ ['--ev-accent' as string]: ev.color ? `var(--c-${ev.color}-text)` : 'var(--ink-3)' }}>
      {ev.row.icon && <PageIcon icon={ev.row.icon} size={12} />}
      {ev.time && <span className="dbcal-chip__time">{ev.time}</span>}
      <span className="dbcal-chip__title">{ev.row.title || t('common.untitled')}</span>
    </span>
  )
}

function EventBar({ id, seg, disabled, onGrab, weekStart, onOpen }: { id: string; seg: Seg; disabled: boolean; onGrab: (day: Date) => void; weekStart: Date; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div
      ref={(el) => {
        ref.current = el
        setNodeRef(el)
      }}
      className={`dbcal-ev${seg.ev.rc ? ' db-rc' : ''}`}
      data-dragging={isDragging}
      data-rc={seg.ev.rc?.target}
      data-rc-color={seg.ev.rc?.color}
      data-contl={seg.contL}
      data-contr={seg.contR}
      style={{
        left: `calc(${(seg.col / 7) * 100}% + 3px)`,
        width: `calc(${(seg.span / 7) * 100}% - 6px)`,
        top: `calc(var(--cal-head) + ${seg.lane} * var(--cal-lane))`,
        ['--ev-accent' as string]: seg.ev.color ? `var(--c-${seg.ev.color}-text)` : 'var(--ink-3)',
        // an accent-bar rule recolours only the bar; the wash keeps reading as the event
        ['--ev-wash' as string]: seg.ev.rc?.target === 'accent' ? 'var(--surface-2)' : seg.ev.color ? `var(--c-${seg.ev.color}-bg)` : 'var(--surface-2)',
        ['--rc-text' as string]: seg.ev.rc ? `var(--c-${seg.ev.rc.color}-text)` : undefined,
      }}
      {...attributes}
      {...listeners}
      onPointerDownCapture={(e) => {
        const r = ref.current?.getBoundingClientRect()
        if (!r) return
        const dayW = r.width / seg.span
        const offset = Math.max(0, Math.min(seg.span - 1, Math.floor((e.clientX - r.left) / dayW)))
        onGrab(addDays(weekStart, seg.col + offset))
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <EventChip ev={seg.ev} />
    </div>
  )
}

export function PickDateProp({ m, label }: { m: DbModel; label?: string }) {
  const t = useT()
  const s = useWorkspace.getState()
  const candidates = m.db.properties.filter((p) => isDateType(p.type))
  return (
    <div className="db-empty">
      <span className="db-empty__line" aria-hidden />
      <span className="label">{label ?? t('database.calendar.pickDate')}</span>
      {candidates.length ? (
        <Select
          value={null}
          placeholder={t('database.layout.pickDate')}
          items={candidates.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
          onChange={(v) => s.updateView(m.db.id, m.view.id, { dateProperty: v })}
        />
      ) : (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            const id = s.addProperty(m.db.id, { type: 'date', name: t('database.type.date') })
            s.updateView(m.db.id, m.view.id, { dateProperty: id })
          }}
        >
          <Plus size={13} /> {t('database.calendar.addDateProp')}
        </button>
      )}
      <span className="db-empty__line" aria-hidden />
    </div>
  )
}
