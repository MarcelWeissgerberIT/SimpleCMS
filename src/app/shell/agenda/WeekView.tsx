import { useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { PenLine, Plus } from 'lucide-react'
import { dateToDay, type AgendaItem } from './model'
import { fmtDayStamp, fmtHour, fmtTime, fmtWeekday } from './format'
import { DraggableItem, ItemChip, accentOf, useAgenda, useAgendaDnd, useDroppableDay } from './parts'
import { altLabel, isWeekend } from './MonthView'
import { DayGroup } from './ListView'
import { useNow } from '../lib/hooks'
import { plural } from '../lib/format'

const HOUR = 44
const LANE = 21

/** The 7 days of the week containing `cursor`. */
export function weekDays(cursor: number, weekStartsOn: 0 | 1): number[] {
  const wd = (new Date(cursor * 86_400_000).getUTCDay() - weekStartsOn + 7) % 7
  return Array.from({ length: 7 }, (_, i) => cursor - wd + i)
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

interface Placed {
  it: AgendaItem
  s: number
  e: number
  col: number
  cols: number
}

/** Side-by-side columns for overlapping timed items (one cluster at a time). */
function placeTimed(list: AgendaItem[]): Placed[] {
  const evs = list
    .map((it) => {
      const s = mins(it.time!)
      let e = it.endTime ? mins(it.endTime) : s + 60
      if (e <= s) e = s + 60
      return { it, s, e: Math.min(e, 24 * 60), col: 0, cols: 1 }
    })
    .sort((a, b) => a.s - b.s || b.e - a.e)
  const out: Placed[] = []
  let cluster: Placed[] = []
  let end = -1
  const flush = () => {
    const ends: number[] = []
    for (const ev of cluster) {
      let c = ends.findIndex((x) => x <= ev.s)
      if (c < 0) c = ends.length
      ends[c] = ev.e
      ev.col = c
    }
    for (const ev of cluster) ev.cols = ends.length
    out.push(...cluster)
    cluster = []
  }
  for (const ev of evs) {
    if (cluster.length && ev.s >= end) flush()
    cluster.push(ev)
    end = Math.max(end, ev.e)
  }
  if (cluster.length) flush()
  return out
}

export function WeekView({ cursor, items, weekStartsOn, narrow }: { cursor: number; items: AgendaItem[]; weekStartsOn: 0 | 1; narrow: boolean }) {
  const days = useMemo(() => weekDays(cursor, weekStartsOn), [cursor, weekStartsOn])
  if (narrow)
    return (
      <div className="ag-list ag-list--week">
        {days.map((d) => (
          <DayGroup key={d} day={d} items={items.filter((it) => it.start <= d && it.end >= d)} alwaysShow />
        ))}
      </div>
    )
  return <WeekGrid days={days} items={items} />
}

function WeekGrid({ days, items }: { days: number[]; items: AgendaItem[] }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const dnd = useAgendaDnd(items)
  const ws = days[0]
  const we = days[6]
  const now = useNow(60_000)
  const nowDay = dateToDay(new Date(now))
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes()

  // all-day lane: undated-time items and multi-day ranges, in lanes
  const { bars, lanes, timed } = useMemo(() => {
    const bars: Array<{ it: AgendaItem; col: number; span: number; lane: number; contL: boolean; contR: boolean }> = []
    const used: Array<Array<[number, number]>> = []
    const timed = new Map<number, AgendaItem[]>()
    for (const it of items) {
      if (it.end < ws || it.start > we) continue
      if (it.time && it.start === it.end) {
        const list = timed.get(it.start)
        if (list) list.push(it)
        else timed.set(it.start, [it])
        continue
      }
      const col = Math.max(0, it.start - ws)
      const last = Math.min(6, it.end - ws)
      let lane = 0
      while ((used[lane] ?? []).some(([a, b]) => a <= last && b >= col)) lane++
      ;(used[lane] ??= []).push([col, last])
      bars.push({ it, col, span: last - col + 1, lane, contL: it.start < ws, contR: it.end > we })
    }
    return { bars, lanes: used.length, timed }
  }, [items, ws, we])

  // open at the first timed item of the week (or 8:00)
  const scroller = useRef<HTMLDivElement>(null)
  const first = useMemo(() => {
    let m = 8 * 60
    for (const list of timed.values()) for (const it of list) m = Math.min(m, mins(it.time!))
    return m
  }, [timed])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = Math.max(0, (first / 60 - 0.5) * HOUR)
  }, [ws]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DndContext {...dnd.dndProps}>
      <div className="ag-wk">
        <div className="ag-wk__head">
          <span className="ag-wk__gut" />
          {days.map((d) => {
            const act = ctx.activity?.get(d) ?? 0
            return (
              <div key={d} className="ag-wk__dh" data-today={d === ctx.today || undefined} data-weekend={isWeekend(d) || undefined}>
                <button type="button" className="ag-wk__dbtn" aria-label={t('shell.agenda.add', { date: fmtDayStamp(d, lang) })} onClick={(e) => ctx.openAdd(d, e.currentTarget)}>
                  <span className="ag-wk__wd">{fmtWeekday(d, lang)}</span>
                  <span className="ag-wk__dn">{new Date(d * 86_400_000).getUTCDate()}</span>
                  <Plus size={11} strokeWidth={2.2} className="ag-day__plus" aria-hidden />
                </button>
                {act > 0 && (
                  <span className="ag-day__act" title={t(plural('shell.agenda.activity', act), { n: act })}>
                    <PenLine size={9} strokeWidth={2} aria-hidden />
                    {act}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="ag-wk__allday" style={{ height: `${Math.max(1, lanes) * LANE + 8}px` }}>
          <span className="ag-wk__gut label">{t('shell.agenda.allDay')}</span>
          <div className="ag-wk__cells">
            {days.map((d) => (
              <AllDayCell key={d} day={d} />
            ))}
            <div className="ag-wk__bars">
              {bars.map((b) => (
                <DraggableItem
                  key={`${b.it.key}|ad`}
                  id={`${b.it.key}|ad`}
                  it={b.it}
                  className="ag-bar"
                  data={{ 'data-contl': b.contL || undefined, 'data-contr': b.contR || undefined }}
                  style={{
                    ['--ag-accent' as string]: accentOf(b.it, ctx.sources.get(b.it.source)),
                    left: `calc(${(b.col / 7) * 100}% + 3px)`,
                    width: `calc(${(b.span / 7) * 100}% - 6px)`,
                    top: `${4 + b.lane * LANE}px`,
                  }}
                  onGrab={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    const off = Math.max(0, Math.min(b.span - 1, Math.floor(((e.clientX - r.left) / r.width) * b.span)))
                    dnd.setGrab(b.it.key, ws + b.col + off)
                  }}
                >
                  <ItemChip it={b.it} />
                </DraggableItem>
              ))}
            </div>
          </div>
        </div>
        <div ref={scroller} className="ag-wk__scroll">
          <div className="ag-wk__grid" style={{ height: `${24 * HOUR}px` }}>
            <div className="ag-wk__hours" aria-hidden>
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="ag-wk__hour" style={{ top: `${h * HOUR}px` }}>
                  {h > 0 ? fmtHour(h, lang) : ''}
                </span>
              ))}
            </div>
            <div className="ag-wk__cols">
              {days.map((d) => (
                <TimeColumn key={d} day={d} items={timed.get(d) ?? []} nowMin={d === nowDay ? nowMin : null} setGrab={dnd.setGrab} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{dnd.dragging ? <ItemChip it={dnd.dragging} overlay /> : null}</DragOverlay>
      <p className="ag-hint">{t('shell.agenda.dragHint', { alt: altLabel() })}</p>
    </DndContext>
  )
}

function AllDayCell({ day }: { day: number }) {
  const ctx = useAgenda()
  const { setNodeRef, isOver } = useDroppableDay(`ad:${day}`)
  return (
    <div
      ref={setNodeRef}
      className="ag-wk__cell"
      data-day={day}
      data-over={isOver || undefined}
      data-today={day === ctx.today || undefined}
      onClick={(e) => e.target === e.currentTarget && ctx.openAdd(day, e.currentTarget)}
    />
  )
}

function TimeColumn({ day, items, nowMin, setGrab }: { day: number; items: AgendaItem[]; nowMin: number | null; setGrab: (key: string, day: number) => void }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const { setNodeRef, isOver } = useDroppableDay(`tm:${day}`)
  const placed = useMemo(() => placeTimed(items), [items])
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const r = e.currentTarget.getBoundingClientRect()
    const hour = Math.max(0, Math.min(23, Math.floor((e.clientY - r.top) / HOUR)))
    const x = e.clientX
    const y = r.top + hour * HOUR
    ctx.openAdd(day, { getBoundingClientRect: () => new DOMRect(x, y, 1, HOUR) }, hour)
  }
  const stamp = fmtDayStamp(day, lang)
  return (
    <div ref={setNodeRef} className="ag-wk__col" data-day={day} data-today={day === ctx.today || undefined} data-weekend={isWeekend(day) || undefined} data-over={isOver || undefined} onClick={onClick} aria-label={stamp}>
      {placed.map((p) => {
        const src = ctx.sources.get(p.it.source)
        return (
          <DraggableItem
            key={p.it.key}
            id={`${p.it.key}|tm`}
            it={p.it}
            className="ag-ev"
            data={{ 'data-done': p.it.done || undefined }}
            style={{
              top: `${(p.s / 60) * HOUR + 1}px`,
              height: `${Math.max(22, ((p.e - p.s) / 60) * HOUR - 2)}px`,
              left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
              width: `calc(${100 / p.cols}% - 4px)`,
              ['--ag-accent' as string]: accentOf(p.it, src),
            }}
            onGrab={() => setGrab(p.it.key, day)}
          >
            <span className="ag-ev__time">
              {fmtTime(p.it.time!, lang)}
              {p.it.endTime && `–${fmtTime(p.it.endTime, lang)}`}
            </span>
            <span className="ag-ev__title">{p.it.title.trim() || t('common.untitled')}</span>
          </DraggableItem>
        )
      })}
      {nowMin !== null && <span className="ag-wk__now" style={{ top: `${(nowMin / 60) * HOUR}px` }} aria-hidden />}
    </div>
  )
}

