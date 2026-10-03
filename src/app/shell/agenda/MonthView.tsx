import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { PenLine, Plus } from 'lucide-react'
import { dayToDate, dayToIso, type AgendaItem } from './model'
import { fmtDayStamp, fmtShortDay, fmtWeekday } from './format'
import { DraggableItem, ItemChip, ListRow, useAgenda, useAgendaDnd, useDroppableDay } from './parts'
import { plural } from '../lib/format'

interface Seg {
  it: AgendaItem
  col: number
  span: number
  lane: number
  contL: boolean
  contR: boolean
}

const HEAD = 30
const LANE = 23
const MORE = 20

/** Weeks (arrays of 7 day numbers) covering the month of `cursor`. */
export function monthWeeks(cursor: number, weekStartsOn: 0 | 1): number[][] {
  const d = dayToDate(cursor)
  const first = cursor - (d.getDate() - 1)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const wd = (dayToDate(first).getDay() - weekStartsOn + 7) % 7
  const start = first - wd
  const n = Math.ceil((wd + daysInMonth) / 7)
  return Array.from({ length: n }, (_, w) => Array.from({ length: 7 }, (_, i) => start + w * 7 + i))
}

function layoutWeek(week: number[], items: AgendaItem[]): Seg[] {
  const ws = week[0]
  const we = week[6]
  const segs: Seg[] = []
  const lanes: Array<Array<[number, number]>> = []
  for (const it of items) {
    if (it.end < ws || it.start > we) continue
    const col = Math.max(0, it.start - ws)
    const last = Math.min(6, it.end - ws)
    let lane = 0
    while ((lanes[lane] ?? []).some(([a, b]) => a <= last && b >= col)) lane++
    ;(lanes[lane] ??= []).push([col, last])
    segs.push({ it, col, span: last - col + 1, lane, contL: it.start < ws, contR: it.end > we })
  }
  return segs
}

export function MonthView({ cursor, items, weekStartsOn, narrow, onPick }: { cursor: number; items: AgendaItem[]; weekStartsOn: 0 | 1; narrow: boolean; onPick: (day: number) => void }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const weeks = useMemo(() => monthWeeks(cursor, weekStartsOn), [cursor, weekStartsOn])
  const month = dayToDate(cursor).getMonth()
  const layout = useMemo(() => weeks.map((w) => layoutWeek(w, items)), [weeks, items])
  const dnd = useAgendaDnd(items)

  // lanes that fit a week row (rows stretch with the window)
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(118)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const row = el.firstElementChild as HTMLElement | null
      if (row) setRowH(row.getBoundingClientRect().height)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [weeks.length, narrow])
  const maxLanes = Math.max(1, Math.floor((rowH - HEAD - MORE) / LANE))

  if (narrow) return <CompactMonth weeks={weeks} month={month} items={items} cursor={cursor} onPick={onPick} />

  return (
    <div className="ag-month">
      <div className="ag-wd" aria-hidden>
        {weeks[0].map((d) => (
          <span key={d} className="ag-wd__d" data-weekend={isWeekend(d) || undefined}>
            {fmtWeekday(d, lang)}
          </span>
        ))}
      </div>
      <DndContext {...dnd.dndProps}>
        <div ref={gridRef} className="ag-weeks" role="grid" aria-label={fmtDayStamp(cursor, lang)} style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(var(--ag-row-min), 1fr))` }}>
          {weeks.map((week, wi) => {
            const segs = layout[wi]
            const hidden = week.map((_, c) => segs.filter((s) => s.lane >= maxLanes && c >= s.col && c < s.col + s.span).length)
            return (
              <div key={week[0]} className="ag-week" role="row">
                {week.map((d, c) => (
                  <MonthDay key={d} day={d} out={dayToDate(d).getMonth() !== month} hidden={hidden[c]} />
                ))}
                <div className="ag-week__bars">
                  {segs
                    .filter((s) => s.lane < maxLanes)
                    .map((s) => (
                      <DraggableItem
                        key={`${s.it.key}|${wi}`}
                        id={`${s.it.key}|${wi}`}
                        it={s.it}
                        className="ag-bar"
                        data={{ 'data-contl': s.contL || undefined, 'data-contr': s.contR || undefined }}
                        style={{
                          left: `calc(${(s.col / 7) * 100}% + 3px)`,
                          width: `calc(${(s.span / 7) * 100}% - 6px)`,
                          top: `${HEAD + s.lane * LANE}px`,
                        }}
                        onGrab={(e) => {
                          const r = e.currentTarget.getBoundingClientRect()
                          const off = Math.max(0, Math.min(s.span - 1, Math.floor(((e.clientX - r.left) / r.width) * s.span)))
                          dnd.setGrab(s.it.key, week[0] + s.col + off)
                        }}
                      >
                        <ItemChip it={s.it} />
                      </DraggableItem>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>{dnd.dragging ? <ItemChip it={dnd.dragging} overlay /> : null}</DragOverlay>
      </DndContext>
      <p className="ag-hint label">{t('shell.agenda.dragHint', { alt: altLabel() })}</p>
    </div>
  )
}

export const isWeekend = (d: number) => {
  const w = dayToDate(d).getDay()
  return w === 0 || w === 6
}

export function altLabel(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌥' : 'Alt'
}

function MonthDay({ day, out, hidden }: { day: number; out: boolean; hidden: number }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const { setNodeRef, isOver } = useDroppableDay(`day:${day}`)
  const stamp = fmtDayStamp(day, lang)
  const first = dayToDate(day).getDate() === 1
  const act = ctx.activity?.get(day) ?? 0
  const onCell = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) ctx.openAdd(day, e.currentTarget)
  }
  return (
    <div
      ref={setNodeRef}
      className="ag-day"
      role="gridcell"
      data-day={day}
      data-iso={dayToIso(day)}
      data-out={out || undefined}
      data-today={day === ctx.today || undefined}
      data-weekend={isWeekend(day) || undefined}
      data-over={isOver || undefined}
      onClick={onCell}
    >
      <div className="ag-day__head" onClick={onCell}>
        <button type="button" className="ag-day__num" aria-label={t('shell.agenda.add', { date: stamp })} onClick={(e) => ctx.openAdd(day, e.currentTarget)}>
          <span>{first ? fmtShortDay(day, lang) : dayToDate(day).getDate()}</span>
          <Plus size={11} strokeWidth={2.2} className="ag-day__plus" aria-hidden />
        </button>
        {act > 0 && (
          <span className="ag-day__act" title={t(plural('shell.agenda.activity', act), { n: act })}>
            <PenLine size={9} strokeWidth={2} aria-hidden />
            {act}
          </span>
        )}
      </div>
      {hidden > 0 && (
        <button type="button" className="ag-day__more" aria-label={t('shell.agenda.moreLabel', { n: hidden, date: stamp })} onClick={(e) => ctx.openMore(day, e.currentTarget)}>
          {t('shell.agenda.more', { n: hidden })}
        </button>
      )}
    </div>
  )
}

/** Phones / narrow columns: a dot grid to pick a day, the picked day's items below. */
function CompactMonth({ weeks, month, items, cursor, onPick }: { weeks: number[][]; month: number; items: AgendaItem[]; cursor: number; onPick: (day: number) => void }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const perDay = useMemo(() => {
    const m = new Map<number, AgendaItem[]>()
    const from = weeks[0][0]
    const to = weeks[weeks.length - 1][6]
    for (const it of items) {
      for (let d = Math.max(from, it.start); d <= Math.min(to, it.end); d++) {
        const list = m.get(d)
        if (list) list.push(it)
        else m.set(d, [it])
      }
    }
    return m
  }, [weeks, items])
  const picked = perDay.get(cursor) ?? []
  const stamp = fmtDayStamp(cursor, lang)
  return (
    <div className="ag-cmonth">
      <div className="ag-wd" aria-hidden>
        {weeks[0].map((d) => (
          <span key={d} className="ag-wd__d" data-weekend={isWeekend(d) || undefined}>
            {fmtWeekday(d, lang, true)}
          </span>
        ))}
      </div>
      <div className="ag-cgrid" role="grid">
        {weeks.map((week) => (
          <div key={week[0]} className="ag-cweek" role="row">
            {week.map((d) => {
              const list = perDay.get(d) ?? []
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  className="ag-cday"
                  data-day={d}
                  data-out={dayToDate(d).getMonth() !== month || undefined}
                  data-today={d === ctx.today || undefined}
                  aria-selected={d === cursor}
                  aria-label={`${fmtDayStamp(d, lang)}, ${t(plural('shell.agenda.items', list.length), { n: list.length })}`}
                  onClick={() => onPick(d)}
                >
                  <span className="ag-cday__n">{dayToDate(d).getDate()}</span>
                  <span className="ag-cday__pips" aria-hidden>
                    {list.slice(0, 3).map((it) => (
                      <i key={it.key} style={{ background: `var(--c-${ctx.sources.get(it.source)?.color ?? 'gray'}-text)` } as CSSProperties} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <section className="ag-group" aria-label={stamp}>
        <h3 className="ag-group__head">
          <span className="ag-group__stamp">{stamp}</span>
          {cursor === ctx.today && <span className="ag-group__rel">{t('shell.agenda.today')}</span>}
          <span className="ag-group__rule" />
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('shell.agenda.add', { date: stamp })} onClick={(e) => ctx.openAdd(cursor, e.currentTarget)}>
            <Plus size={14} />
          </button>
        </h3>
        {picked.length ? picked.map((it) => <ListRow key={it.key} it={it} day={cursor} />) : <p className="ag-group__empty">{t('shell.agenda.emptyDay')}</p>}
      </section>
    </div>
  )
}
