/**
 * Reminder UI shared by the editor's date mentions and the database date editor:
 *  - ReminderSelect: "Remind" select (options depend on whether the date has a time) + a read-out
 *    of when it fires (LED on) or that the moment is past.
 *  - DateReminderEditor: date (+ optional time) and reminder of a date mention.
 */
import { useId } from 'react'
import { addDays, format } from 'date-fns'
import { BellRing } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { formatDue, hasTime, reminderDueAt, reminderLabel, reminderOptions } from './reminders'
import './inbox.css'

export function ReminderSelect({ iso, value, onChange }: { iso: string | null | undefined; value: string | null | undefined; onChange: (code: string | null) => void }) {
  const t = useT()
  const lang = useLang()
  const id = useId()
  const timed = !!iso && hasTime(iso)
  const due = iso && value ? reminderDueAt(iso, value) : null
  const past = due !== null && due < Date.now()
  return (
    <div className="rmd">
      <div className="rmd__row">
        <label className="rmd__label label" htmlFor={id}>
          <BellRing size={12} strokeWidth={1.75} aria-hidden />
          {t('inbox.remind.label')}
        </label>
        <select id={id} className="input rmd__select" value={value ?? ''} disabled={!iso} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t('inbox.remind.none')}</option>
          {reminderOptions(timed, value).map((c) => (
            <option key={c} value={c}>
              {reminderLabel(c, timed, t)}
            </option>
          ))}
        </select>
      </div>
      {due !== null && (
        <div className="rmd__due" data-past={past || undefined} role="status">
          <span className={`led${past ? '' : ' led--on'}`} aria-hidden />
          <span>{past ? t('inbox.remind.past') : t('inbox.remind.fires', { when: formatDue(due, lang) })}</span>
        </div>
      )}
    </div>
  )
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

export interface DateReminderValue {
  /** "2026-10-05" or "2026-10-05T14:30" */
  iso: string
  reminder: string | null
}

export function DateReminderEditor({ value, onChange, onDone }: { value: DateReminderValue; onChange: (v: DateReminderValue) => void; onDone: () => void }) {
  const t = useT()
  const ids = useId()
  const day = value.iso.slice(0, 10)
  const time = hasTime(value.iso) ? value.iso.slice(11, 16) : null
  const set = (d: string, tm: string | null) => onChange({ iso: tm ? `${d}T${tm}` : d, reminder: value.reminder })
  const quick = (offset: number) => set(format(addDays(new Date(), offset), 'yyyy-MM-dd'), time)

  return (
    <div className="dme" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.preventDefault(), onDone())}>
      <div className="dme__sect">
        <label className="label" htmlFor={`${ids}-d`}>
          {t('inbox.date.label')}
        </label>
        <div className="dme__fields" data-time={time !== null || undefined}>
          <input id={`${ids}-d`} className="input dme__date" type="date" value={day} data-autofocus onChange={(e) => DAY.test(e.target.value) && set(e.target.value, time)} />
          {time !== null && (
            <input className="input dme__time" type="time" aria-label={t('inbox.date.time')} value={time} onChange={(e) => TIME.test(e.target.value) && set(day, e.target.value)} />
          )}
        </div>
        <div className="dme__opt">
          <span>{t('inbox.date.includeTime')}</span>
          <Switch checked={time !== null} label={t('inbox.date.includeTime')} onChange={(on) => set(day, on ? '09:00' : null)} />
        </div>
      </div>
      <div className="dme__sect">
        <ReminderSelect iso={value.iso} value={value.reminder} onChange={(reminder) => onChange({ iso: value.iso, reminder })} />
      </div>
      <div className="dme__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => quick(0)}>
          {t('inbox.date.today')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => quick(1)}>
          {t('inbox.date.tomorrow')}
        </button>
        <span className="dme__spacer" />
        <button type="button" className="btn btn--ink btn--sm" onClick={onDone}>
          {t('inbox.date.done')}
        </button>
      </div>
    </div>
  )
}
