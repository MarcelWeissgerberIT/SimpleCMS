/**
 * Calendar popover: single date or range, optional time, typed input, keyboard grid,
 * locale-aware week start (de: Monday), a reminder (features/inbox), "Today" + "Clear".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { DateValue } from '../../store/types'
import { useLang, useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { ReminderSelect, normalizeReminder } from '../../features'
import { dfLocale, isoWithTime, parseLocal, parseTypedDate, weekStartsOn } from '../model/format'

/** `reminders`: offer the "Remind" select (default: like `allowRange` — on for cells, off for filter values). */
export function DatePicker({
  value,
  onChange,
  allowRange = true,
  reminders = allowRange,
}: {
  value: DateValue | null
  onChange: (v: DateValue | null) => void
  allowRange?: boolean
  reminders?: boolean
}) {
  const t = useT()
  const lang = useLang()
  const locale = dfLocale(lang)
  const ws = weekStartsOn(lang)
  const start = parseLocal(value?.start)
  const end = parseLocal(value?.end ?? null)
  const hasEnd = !!value?.end
  const withTime = !!value?.includeTime
  // the reminder (features/inbox) rides along every change of the date; "Clear" drops it
  const reminder = reminders ? normalizeReminder(value?.reminder) : null
  const [month, setMonth] = useState(() => startOfMonth(start ?? new Date()))
  const [focus, setFocus] = useState<Date>(() => start ?? new Date())
  const [editing, setEditing] = useState<'start' | 'end'>('start')
  const [hover, setHover] = useState<Date | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: ws }), end: endOfWeek(endOfMonth(month), { weekStartsOn: ws }) }), [month, ws])
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => format(addDays(startOfWeek(new Date(), { weekStartsOn: ws }), i), 'EEEEEE', { locale })), [ws, locale])

  const withClock = (d: Date, from: Date | null) => {
    if (!withTime) return d
    const c = new Date(d)
    c.setHours(from?.getHours() ?? 9, from?.getMinutes() ?? 0)
    return c
  }

  const emit = (s: Date | null, e: Date | null, time = withTime, range = hasEnd) => {
    if (!s) return onChange(null)
    let a = s
    let b = e
    if (b && isBefore(b, a)) [a, b] = [b, a]
    onChange({ start: isoWithTime(a, time), end: range && b ? isoWithTime(b, time) : null, includeTime: time || undefined, ...(reminder ? { reminder } : {}) })
  }

  const pickDay = (d: Date) => {
    setFocus(d)
    if (!hasEnd) return emit(withClock(d, start), null)
    if (editing === 'start') {
      emit(withClock(d, start), end && !isBefore(end, d) ? end : withClock(d, end ?? start))
      setEditing('end')
    } else {
      emit(start ?? d, withClock(d, end ?? start))
      setEditing('start')
    }
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in step) {
      e.preventDefault()
      const n = addDays(focus, step[e.key])
      setFocus(n)
      if (!isSameMonth(n, month)) setMonth(startOfMonth(n))
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[data-focus="true"]')?.focus())
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pickDay(focus)
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const n = addMonths(focus, e.key === 'PageUp' ? -1 : 1)
      setFocus(n)
      setMonth(startOfMonth(n))
    }
  }

  const inRange = (d: Date) => {
    if (!hasEnd || !start) return false
    const e = editing === 'end' && hover ? hover : end
    if (!e) return false
    const [a, b] = isBefore(e, start) ? [e, start] : [start, e]
    return !isBefore(d, a) && !isAfter(d, b)
  }

  return (
    <div className="db-date-pop">
      <div className="db-date-pop__inputs">
        <DateField
          label={hasEnd ? t('database.date.start') : t('database.date.date')}
          date={start}
          withTime={withTime}
          active={hasEnd && editing === 'start'}
          onFocus={() => setEditing('start')}
          onDate={(d) => {
            emit(d, end)
            if (d) {
              setMonth(startOfMonth(d))
              setFocus(d)
            }
          }}
        />
        {hasEnd && (
          <DateField
            label={t('database.date.end')}
            date={end}
            withTime={withTime}
            active={editing === 'end'}
            onFocus={() => setEditing('end')}
            onDate={(d) => {
              emit(start ?? d, d)
              if (d) setMonth(startOfMonth(d))
            }}
          />
        )}
      </div>
      <div className="db-date-pop__head">
        <span className="db-date-pop__month">{format(month, 'LLLL yyyy', { locale })}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setMonth(startOfMonth(new Date())), setFocus(new Date()))}>
          {t('database.date.today')}
        </button>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.date.prev')} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.date.next')} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="db-date-pop__grid" role="grid" ref={gridRef} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
        {weekdays.map((w, i) => (
          <span key={i} className="db-date-pop__wd" role="columnheader">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const sel = (start && isSameDay(d, start)) || (hasEnd && end && isSameDay(d, end))
          const isFocus = isSameDay(d, focus)
          return (
            <button
              key={d.toISOString()}
              type="button"
              role="gridcell"
              tabIndex={isFocus ? 0 : -1}
              data-focus={isFocus}
              data-out={!isSameMonth(d, month)}
              data-today={isToday(d)}
              data-selected={!!sel}
              data-range={inRange(d) && !sel}
              data-weekend={d.getDay() === 0 || d.getDay() === 6}
              className="db-date-pop__day"
              onMouseEnter={() => setHover(d)}
              onClick={() => pickDay(d)}
              aria-label={format(d, 'PPPP', { locale })}
            >
              {format(d, 'd')}
            </button>
          )
        })}
      </div>
      <div className="db-date-pop__opts">
        {allowRange && (
          <label className="db-date-pop__opt">
            <span>{t('database.date.endDate')}</span>
            <Switch
              size="sm"
              seed="endDate"
              checked={hasEnd}
              label={t('database.date.endDate')}
              onChange={(on) => {
                if (!start) return
                emit(start, on ? addDays(start, 1) : null, withTime, on)
                setEditing(on ? 'end' : 'start')
              }}
            />
          </label>
        )}
        <label className="db-date-pop__opt">
          <span>{t('database.date.includeTime')}</span>
          <Switch
            size="sm"
            seed="includeTime"
            checked={withTime}
            label={t('database.date.includeTime')}
            onChange={(on) => {
              const s = start ?? new Date()
              const sc = new Date(s)
              if (on) sc.setHours(9, 0)
              const ec = end ? new Date(end) : null
              if (on && ec) ec.setHours(10, 0)
              emit(sc, ec, on)
            }}
          />
        </label>
      </div>
      {reminders && (
        <div className="db-date-pop__opts db-date-pop__remind">
          <ReminderSelect iso={value?.start ?? null} value={reminder} onChange={(code) => value && onChange({ ...value, reminder: code })} />
        </div>
      )}
      <div className="db-date-pop__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => emit(withClock(new Date(), start), hasEnd ? withClock(new Date(), end) : null)}>
          {t('database.date.setToday')}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)} disabled={!value}>
          {t('database.date.clear')}
        </button>
      </div>
    </div>
  )
}

function DateField({ label, date, withTime, active, onFocus, onDate }: { label: string; date: Date | null; withTime: boolean; active: boolean; onFocus: () => void; onDate: (d: Date | null) => void }) {
  const t = useT()
  const lang = useLang()
  const locale = dfLocale(lang)
  const shown = date ? format(date, lang === 'de' ? 'd. MMM yyyy' : 'MMM d, yyyy', { locale }) : ''
  const [draft, setDraft] = useState<string | null>(null)
  // the typed text also lives in a ref: a click away or Esc unmounts the popover before blur fires,
  // so the unmount cleanup saves whatever is still pending
  const pending = useRef<string | null>(null)
  const latest = useRef({ date, withTime, onDate, lang })
  latest.current = { date, withTime, onDate, lang }
  const commit = () => {
    const text = pending.current
    if (text === null) return
    pending.current = null
    const { date: cur, withTime: wt, onDate: emitDate, lang: l } = latest.current
    const d = parseTypedDate(text, l)
    if (d) {
      if (cur && wt) d.setHours(cur.getHours(), cur.getMinutes())
      emitDate(d)
    } else if (!text.trim()) emitDate(null)
    setDraft(null)
  }
  useEffect(() => commit, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="db-datefield" data-active={active}>
      <span className="label">{label}</span>
      <div className="db-datefield__row" data-time={withTime}>
        <input
          className="db-datefield__input"
          aria-label={label}
          value={draft ?? shown}
          placeholder={lang === 'de' ? 'TT.MM.JJJJ' : 'MM/DD/YYYY'}
          onFocus={onFocus}
          onChange={(e) => {
            pending.current = e.target.value
            setDraft(e.target.value)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        {withTime && (
          <input
            className="db-datefield__time"
            type="time"
            aria-label={`${label} · ${t('database.date.time')}`}
            value={date ? format(date, 'HH:mm') : ''}
            onFocus={onFocus}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (!date || Number.isNaN(h)) return
              const d = new Date(date)
              d.setHours(h, m || 0)
              onDate(d)
            }}
          />
        )}
      </div>
    </div>
  )
}
