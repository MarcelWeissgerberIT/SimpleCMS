/**
 * Timeline (gantt): bars from date ranges, drag to move, drag ends to resize (day snap),
 * zoom week / month / quarter, today line, click empty lane to schedule undated rows.
 * With dependencies on: arrows blocker → dependent, drag a bar's end dot onto another bar to link
 * them, select an arrow + Delete to unlink, and moving a blocker shifts (or flags) its dependents.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDays, differenceInCalendarDays, eachDayOfInterval, format, getISOWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { Crosshair } from 'lucide-react'
import type { DateValue, ID, Page } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { pointAnchor } from '../../ui/Popover'
import { useModel, useLocalState } from '../hooks'
import { useViewActions, EmptyState } from './shared'
import { eventsOf, PickDateProp } from './CalendarView'
import { dfLocale, isDateValue, isoWithTime, parseLocal, toISODate, weekStartsOn } from '../model/format'
import { writeValue } from '../model/actions'
import { Segmented, plural } from '../parts'
import { uniformOffsets, useWindow } from './virtual'
import { dependenciesOf, linkedIds } from '../model/hierarchy'
import { shiftDependents } from '../model/dependencies'
import { DepArrows, type BarGeom, type DepEdge } from './timeline/DepArrows'
import '../structure.css'
import './timeline.css'

type Zoom = 'week' | 'month' | 'quarter'
const DAY_W: Record<Zoom, number> = { week: 46, month: 20, quarter: 7 }
const ROW_H = 38
/** vertical centre of a bar inside its row (bar: top 7, height 24) */
const BAR_MID = 19

interface Drag {
  row: ID
  mode: 'move' | 'start' | 'end'
  dx: number
  moved: boolean
}

interface LinkDraft {
  from: ID
  /** pointer in lane coordinates */
  x: number
  y: number
  target: ID | null
}

export default function TimelineView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const lang = m.resolver.ctx.lang
  const locale = dfLocale(lang)
  const [zoom, setZoom] = useLocalState<Zoom>(`one.db.tl.${m.view.id}`, 'month')
  const dw = DAY_W[zoom]
  const prop = m.view.dateProperty ? m.propMap.get(m.view.dateProperty) : undefined
  const editable = prop?.type === 'date'
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [ghost, setGhost] = useState<{ row: ID; day: number } | null>(null)
  const [link, setLink] = useState<LinkDraft | null>(null)
  const [selectedDep, setSelectedDep] = useState<string | null>(null)
  const deps = useMemo(() => dependenciesOf(m.db), [m.db])
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  const leftW = narrow ? 132 : 240

  const { events } = useMemo(() => (prop ? eventsOf(m, prop) : { events: [], undated: [] }), [m, prop])
  const bodyRef = useRef<HTMLDivElement>(null)
  const offsets = useMemo(() => uniformOffsets(m.rows.length, ROW_H), [m.rows.length])
  const [start, end] = useWindow(bodyRef, offsets, m.rows.length > 80)
  const topPad = offsets[start]
  const bottomPad = offsets[m.rows.length] - offsets[end]
  const byRow = useMemo(() => new Map(events.map((e) => [e.row.id, e])), [events])

  const range = useMemo(() => {
    const today = startOfDay(new Date())
    let min = addDays(today, -21)
    let max = addDays(today, 60)
    for (const e of events) {
      if (e.start < min) min = e.start
      if (e.end > max) max = e.end
    }
    const ws = weekStartsOn(lang)
    const start = startOfWeek(startOfMonth(addDays(min, -7)), { weekStartsOn: ws })
    const end = addDays(max, zoom === 'quarter' ? 90 : 30)
    return { start, days: differenceInCalendarDays(end, start) + 1 }
  }, [events, zoom, lang])

  const days = useMemo(() => eachDayOfInterval({ start: range.start, end: addDays(range.start, range.days - 1) }), [range])
  const months = useMemo(() => {
    const out: { label: string; from: number; len: number }[] = []
    days.forEach((d, i) => {
      const label = format(d, zoom === 'quarter' ? 'MMM yyyy' : 'LLLL yyyy', { locale })
      const last = out[out.length - 1]
      if (last && last.label === label) last.len++
      else out.push({ label, from: i, len: 1 })
    })
    return out
  }, [days, zoom, locale])

  /** Bar position per row (day indices, with the live drag applied) and the dependency edges. */
  const { geom, edges } = useMemo(() => {
    const geom = new Map<ID, BarGeom>()
    if (!deps) return { geom, edges: [] as DepEdge[] }
    m.rows.forEach((row, i) => {
      const ev = byRow.get(row.id)
      if (!ev) return
      let s0 = differenceInCalendarDays(ev.start, range.start)
      let e0 = differenceInCalendarDays(ev.end, range.start)
      if (drag && drag.row === row.id) {
        if (drag.mode === 'move') {
          s0 += drag.dx
          e0 += drag.dx
        } else if (drag.mode === 'start') s0 = Math.min(e0, s0 + drag.dx)
        else e0 = Math.max(s0, e0 + drag.dx)
      }
      geom.set(row.id, { i, s: s0, e: e0, title: row.title || t('common.untitled') })
    })
    const pages = m.resolver.ctx.pages
    const edges: DepEdge[] = []
    for (const row of m.rows) {
      const b = geom.get(row.id)
      if (!b) continue
      for (const from of linkedIds(pages, row, deps.blockedBy.id)) {
        const a = geom.get(from)
        if (a) edges.push({ from, to: row.id, violated: b.s <= a.e })
      }
    }
    return { geom, edges }
  }, [deps, m.rows, m.resolver, byRow, range.start, drag, t])

  const removeDep = useCallback(
    (edge: DepEdge) => {
      if (!deps) return
      const cur = (useWorkspace.getState().pages[edge.to]?.properties[deps.blockedBy.id] as ID[] | undefined) ?? []
      writeValue(m.db.id, deps.blockedBy, edge.to, cur.filter((x) => x !== edge.from))
      setSelectedDep(null)
      useUI.getState().toast({
        message: t('database.dep.removed'),
        action: {
          label: t('common.undo'),
          run: () => {
            const now = (useWorkspace.getState().pages[edge.to]?.properties[deps.blockedBy.id] as ID[] | undefined) ?? []
            if (!now.includes(edge.from)) writeValue(m.db.id, deps.blockedBy, edge.to, [...now, edge.from])
          },
        },
      })
    },
    [deps, m.db.id, t],
  )

  /** Drag from a bar's end dot onto another row: that row becomes blocked by this one. */
  const startLink = (e: React.PointerEvent, row: Page) => {
    if (e.button !== 0 || !deps) return
    e.stopPropagation()
    e.preventDefault()
    const body = bodyRef.current
    if (!body) return
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = body.getBoundingClientRect()
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-tl-row]')
      const target = el?.dataset.tlRow ?? null
      return { x: ev.clientX - r.left - leftW, y: ev.clientY - r.top, target: target && target !== row.id ? target : null }
    }
    setLink({ from: row.id, ...at(e) })
    const onMove = (ev: PointerEvent) => setLink({ from: row.id, ...at(ev) })
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setLink(null)
      const { target } = at(ev)
      if (!target) return
      const cur = (useWorkspace.getState().pages[target]?.properties[deps.blockedBy.id] as ID[] | undefined) ?? []
      if (!cur.includes(row.id)) writeValue(m.db.id, deps.blockedBy, target, [...cur, row.id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const todayIdx = differenceInCalendarDays(startOfDay(new Date()), range.start)
  const scrollToToday = (smooth = true) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: Math.max(0, todayIdx * dw - (el.clientWidth - leftW) / 3), behavior: smooth ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => {
    scrollToToday(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, prop?.id])

  // pointer drag: move / resize bars
  const startDrag = (e: React.PointerEvent, row: Page, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    let state: Drag = { row: row.id, mode, dx: 0, moved: false }
    setDrag(state)
    const onMove = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - x0) / dw)
      if (Math.abs(ev.clientX - x0) > 3) state = { ...state, dx, moved: true }
      setDrag({ ...state })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      if (!state.moved) {
        actions.open(row)
        return
      }
      if (!editable || !prop || !state.dx) return
      const v = useWorkspace.getState().pages[row.id]?.properties[prop.id]
      if (!isDateValue(v)) return
      const dv = v as DateValue
      const s = parseLocal(dv.start)!
      const en = parseLocal(dv.end ?? null) ?? s
      let ns = s
      let ne = en
      if (state.mode === 'move') {
        ns = addDays(s, state.dx)
        ne = addDays(en, state.dx)
      } else if (state.mode === 'start') ns = addDays(s, Math.min(state.dx, differenceInCalendarDays(en, s)))
      else ne = addDays(en, Math.max(state.dx, -differenceInCalendarDays(en, s)))
      const withTime = !!dv.includeTime
      const hasRange = differenceInCalendarDays(ne, ns) > 0 || !!dv.end
      writeValue(m.db.id, prop, row.id, { ...dv, start: isoWithTime(ns, withTime), end: hasRange ? isoWithTime(ne, withTime) : null })
      // a blocker that now ends later pushes its dependents (setting: shift) — or just shows red arrows
      const dep = dependenciesOf(useWorkspace.getState().databases[m.db.id])
      if (dep?.onConflict === 'shift' && state.mode !== 'start') {
        const moved = shiftDependents(m.db.id, prop, dep, row.id)
        if (moved.length)
          useUI.getState().toast({
            message: plural(t, 'database.dep.shifted', moved.length),
            action: { label: t('common.undo'), run: () => moved.forEach((x) => writeValue(m.db.id, prop, x.id, x.before)) },
          })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!prop) return <PickDateProp m={m} label={t('database.timeline.pickDate')} />
  const width = range.days * dw
  const ws = weekStartsOn(lang)
  const weekend =
    ws === 1
      ? `linear-gradient(90deg, transparent ${5 * dw}px, var(--tl-weekend) ${5 * dw}px ${7 * dw}px)`
      : `linear-gradient(90deg, var(--tl-weekend) 0 ${dw}px, transparent ${dw}px ${6 * dw}px, var(--tl-weekend) ${6 * dw}px)`
  const lines = 'linear-gradient(90deg, var(--rule) 1px, transparent 1px)'
  const lineStep = zoom === 'week' ? dw : 7 * dw
  const gridStyle = zoom === 'quarter' ? { backgroundImage: lines, backgroundSize: `${lineStep}px 100%` } : { backgroundImage: `${lines}, ${weekend}`, backgroundSize: `${lineStep}px 100%, ${7 * dw}px 100%` }

  return (
    <div className="dbtl" data-zoom={zoom} data-deps={!!deps} data-linking={!!link} style={{ ['--dw' as string]: `${dw}px`, ['--tl-left' as string]: `${leftW}px` }}>
      <div className="dbtl-controls">
        <Segmented
          value={zoom}
          ariaLabel={t('database.timeline.zoom')}
          items={(['week', 'month', 'quarter'] as const).map((z) => ({ value: z, label: t(`database.timeline.${z}`) }))}
          onChange={setZoom}
        />
        <button type="button" className="btn btn--sm" onClick={() => scrollToToday()}>
          <Crosshair size={13} /> {t('database.date.today')}
        </button>
      </div>
      <div className="dbtl-scroll" ref={scrollRef}>
        <div className="dbtl-inner" style={{ width: leftW + width }}>
          <div className="dbtl-head">
            <div className="dbtl-corner label">{m.titleProp.name}</div>
            <div className="dbtl-scale" style={{ width }}>
              <div className="dbtl-months">
                {months.map((mo) => (
                  <span key={mo.from} className="dbtl-month" style={{ left: mo.from * dw, width: mo.len * dw }}>
                    <span>{mo.label}</span>
                  </span>
                ))}
              </div>
              <div className="dbtl-days">
                {days.map((d, i) => {
                  // the TODAY flag sits on the scale — keep labels from colliding with it
                  const nearToday = Math.abs(i - todayIdx) * dw < 34
                  if (zoom === 'quarter') {
                    if (d.getDay() !== ws || (todayIdx >= i && todayIdx < i + 7 && (todayIdx - i) * dw < 40)) return null
                    return (
                      <span key={i} className="dbtl-day dbtl-day--week" style={{ left: i * dw, width: 7 * dw }}>
                        W{getISOWeek(d)}
                      </span>
                    )
                  }
                  if (nearToday) return null
                  if (zoom === 'month' && d.getDay() !== ws && d.getDate() !== 1) return null
                  return (
                    <span key={i} className="dbtl-day" style={{ left: i * dw, width: zoom === 'month' ? undefined : dw }}>
                      {zoom === 'week' ? format(d, 'EEEEEE d', { locale }) : d.getDate()}
                    </span>
                  )
                })}
              </div>
              {todayIdx >= 0 && todayIdx < range.days && (
                <span className="dbtl-todayflag" style={{ left: todayIdx * dw + dw / 2 }}>
                  {t('database.date.today')}
                </span>
              )}
            </div>
          </div>
          <div className="dbtl-body" ref={bodyRef}>
            <div className="dbtl-grid" style={{ left: leftW, width, ...gridStyle }} aria-hidden />
            {todayIdx >= 0 && todayIdx < range.days && <div className="dbtl-today" style={{ left: leftW + todayIdx * dw + dw / 2 }} aria-hidden />}
            {deps && (
              <DepArrows
                edges={edges}
                geom={geom}
                dw={dw}
                rowH={ROW_H}
                barMid={BAR_MID}
                width={width}
                height={offsets[m.rows.length]}
                left={leftW}
                selected={selectedDep}
                onSelect={setSelectedDep}
                onRemove={removeDep}
                draft={link}
              />
            )}
            {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
            {m.rows.slice(start, end).map((row) => {
              const ev = byRow.get(row.id)
              let s = ev ? differenceInCalendarDays(ev.start, range.start) : 0
              let e = ev ? differenceInCalendarDays(ev.end, range.start) : 0
              if (drag && drag.row === row.id && ev) {
                if (drag.mode === 'move') {
                  s += drag.dx
                  e += drag.dx
                } else if (drag.mode === 'start') s = Math.min(e, s + drag.dx)
                else e = Math.max(s, e + drag.dx)
              }
              const barW = Math.max(dw, (e - s + 1) * dw) - 2
              const outside = barW < 96
              const rc = ev?.rc ?? null
              return (
                <div key={row.id} className="dbtl-row" style={{ height: ROW_H }} data-tl-row={row.id} data-link-target={link?.target === row.id || undefined}>
                  <button
                    type="button"
                    className="dbtl-title"
                    onClick={() => actions.open(row)}
                    onContextMenu={(e2) => {
                      e2.preventDefault()
                      actions.contextMenu(row, pointAnchor(e2.clientX, e2.clientY))
                    }}
                  >
                    {row.icon && <PageIcon icon={row.icon} size={14} />}
                    <span className={row.title ? '' : 'faint'}>{row.title || t('common.untitled')}</span>
                  </button>
                  <div
                    className="dbtl-lane"
                    style={{ width }}
                    onPointerMove={(e2) => {
                      if (ev || !editable) return
                      const r = e2.currentTarget.getBoundingClientRect()
                      setGhost({ row: row.id, day: Math.floor((e2.clientX - r.left) / dw) })
                    }}
                    onPointerLeave={() => setGhost((g) => (g?.row === row.id ? null : g))}
                    onClick={(e2) => {
                      if (ev || !editable || !prop) return
                      const r = e2.currentTarget.getBoundingClientRect()
                      const day = addDays(range.start, Math.floor((e2.clientX - r.left) / dw))
                      writeValue(m.db.id, prop, row.id, { start: toISODate(day), end: zoom === 'week' ? null : toISODate(addDays(day, zoom === 'month' ? 4 : 13)) })
                      setGhost(null)
                    }}
                  >
                    {ev ? (
                      <div
                        className={`dbtl-bar${rc ? ' db-rc' : ''}`}
                        data-dragging={drag?.row === row.id && drag.moved}
                        data-readonly={!editable}
                        data-rc={rc?.target}
                        data-rc-color={rc?.color}
                        style={{
                          left: s * dw + 1,
                          width: barW,
                          ['--ev-accent' as string]: ev.color ? `var(--c-${ev.color}-text)` : 'var(--signal)',
                          ...(rc ? { ['--rc-text' as string]: `var(--c-${rc.color}-text)`, ['--rc-bg' as string]: `var(--c-${rc.color}-bg)` } : null),
                        }}
                        onPointerDown={(e2) => (editable ? startDrag(e2, row, 'move') : undefined)}
                        onClick={(e2) => {
                          e2.stopPropagation()
                          if (!editable) actions.open(row)
                        }}
                        title={row.title}
                      >
                        {editable && <span className="dbtl-bar__h dbtl-bar__h--l" onPointerDown={(e2) => startDrag(e2, row, 'start')} />}
                        <span className={`dbtl-bar__label${outside ? ' is-outside' : ''}`}>{row.title || t('common.untitled')}</span>
                        {editable && <span className="dbtl-bar__h dbtl-bar__h--r" onPointerDown={(e2) => startDrag(e2, row, 'end')} />}
                        {deps && (
                          <span
                            className="dbtl-bar__dep"
                            role="presentation"
                            title={t('database.dep.connect')}
                            onPointerDown={(e2) => startLink(e2, row)}
                            onClick={(e2) => e2.stopPropagation()}
                          />
                        )}
                      </div>
                    ) : (
                      ghost?.row === row.id && (
                        <div className="dbtl-ghost" style={{ left: ghost.day * dw, width: (zoom === 'week' ? 1 : zoom === 'month' ? 5 : 14) * dw }}>
                          <span>+</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            })}
            {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
            {!m.rows.length && (
              <div className="dbtl-empty" style={{ width: `calc(100cqw)` }}>
                <EmptyState onAdd={() => actions.newRow({ open: true })} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
