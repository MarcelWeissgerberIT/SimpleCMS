import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { AgendaItem } from './model'
import { fmtDayStamp } from './format'
import { ListRow, useAgenda } from './parts'
import { plural } from '../lib/format'

/** Overdue rows shown before "Show all" (the most recent ones). */
const OVERDUE_SHOWN = 12

/** Upcoming items, one group per day (sticky mono day heads), overdue rows first. */
export function ListView({ from, to, items, overdue }: { from: number; to: number; items: AgendaItem[]; overdue: AgendaItem[] }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const [allOverdue, setAllOverdue] = useState(false)
  const days = useMemo(() => {
    const m = new Map<number, AgendaItem[]>()
    for (const it of items) {
      // a range shows on its first day; one that started earlier shows on the first day of the window
      const d = Math.max(it.start, from)
      if (d > to) continue
      const list = m.get(d)
      if (list) list.push(it)
      else m.set(d, [it])
    }
    // today always gets a head (even with nothing on it) while it is in view
    if (ctx.today >= from && ctx.today <= to && !m.has(ctx.today)) m.set(ctx.today, [])
    return [...m].sort((a, b) => a[0] - b[0])
  }, [items, from, to, ctx.today])

  return (
    <div className="ag-list">
      {overdue.length > 0 && (
        <section className="ag-group" data-overdue aria-label={t('shell.agenda.overdue')}>
          <h3 className="ag-group__head">
            <span className="led led--on" aria-hidden />
            <span className="ag-group__stamp">{t('shell.agenda.overdue')}</span>
            <span className="ag-group__rule" />
            <span className="ag-group__n">{String(overdue.length).padStart(2, '0')}</span>
          </h3>
          {(allOverdue ? overdue : overdue.slice(-OVERDUE_SHOWN)).map((it) => (
            <ListRow key={it.key} it={it} day={it.start} overdue />
          ))}
          {!allOverdue && overdue.length > OVERDUE_SHOWN && (
            <button type="button" className="ag-showall" onClick={() => setAllOverdue(true)}>
              {t('shell.agenda.showAll', { n: overdue.length })}
            </button>
          )}
        </section>
      )}
      {days.map(([d, list]) => (
        <DayGroup key={d} day={d} items={list} />
      ))}
      {days.length === 0 && overdue.length === 0 && (
        <p className="ag-empty">{t('shell.agenda.empty', { from: fmtDayStamp(from, lang), to: fmtDayStamp(to, lang) })}</p>
      )}
    </div>
  )
}

export function DayGroup({ day, items, alwaysShow }: { day: number; items: AgendaItem[]; alwaysShow?: boolean }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  if (!items.length && !alwaysShow && day !== ctx.today) return null
  const stamp = fmtDayStamp(day, lang)
  const rel = day === ctx.today ? t('shell.agenda.today') : day === ctx.today + 1 ? t('shell.agenda.tomorrow') : null
  return (
    <section className="ag-group" data-day={day} data-today={day === ctx.today || undefined} aria-label={stamp}>
      <h3 className="ag-group__head">
        <span className="ag-group__stamp">{stamp}</span>
        {rel && <span className="ag-group__rel">{rel}</span>}
        <span className="ag-group__rule" />
        <span className="ag-group__n" title={t(plural('shell.agenda.items', items.length), { n: items.length })}>
          {String(items.length).padStart(2, '0')}
        </span>
        <button type="button" className="icon-btn icon-btn--sm ag-group__add" aria-label={t('shell.agenda.add', { date: stamp })} onClick={(e) => ctx.openAdd(day, e.currentTarget)}>
          <Plus size={14} />
        </button>
      </h3>
      {items.length ? items.map((it) => <ListRow key={it.key} it={it} day={day} />) : <p className="ag-group__empty">{t('shell.agenda.emptyDay')}</p>}
    </section>
  )
}
