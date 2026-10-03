/**
 * Template editor section "Repeat": off | daily | weekdays | weekly (days) | monthly (day) |
 * every N days, a time, a start day and an optional end day, the title of new rows (variables)
 * and the date property preset to each occurrence. The scheduler lives in features/templates.
 */
import { useId, useRef } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import type { Database, ID, TemplateRepeat } from '../../store/types'
import { Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import {
  DEFAULT_REPEAT_TITLE,
  MAX_CATCH_UP,
  REPEAT_FREQS,
  REPEAT_VARIABLES,
  clampDayOfMonth,
  clampEvery,
  defaultRepeat,
  fillRepeatVars,
  nextRun,
  weekdayKeys,
  weeklyDays,
  type RepeatFreq,
} from '../../features'
import { Segmented, Select } from '../parts'
import { NextRun } from './NextRun'
import './repeat.css'

const NONE = '__none'

export function RepeatSettings({ db, name, value, onChange }: { db: Database; name: string; value: TemplateRepeat | null; onChange: (r: TemplateRepeat | null) => void }) {
  const t = useT()
  const id = useId()
  const dateProps = db.properties.filter((p) => p.type === 'date')
  return (
    <section className="rpt" aria-labelledby={`${id}-h`} data-on={!!value}>
      <div className="rpt__head">
        <span id={`${id}-h`} className="label">
          {t('database.repeat.title')}
        </span>
        <span className="rpt__head-state label">{!value && t('database.repeat.off')}</span>
        <Switch checked={!!value} label={t('database.repeat.toggle')} onChange={(on) => onChange(on ? defaultRepeat(new Date(), dateProps[0]?.id ?? null) : null)} />
      </div>
      {value && <RepeatFields value={value} onChange={onChange} name={name} dateProps={dateProps} />}
    </section>
  )
}

function RepeatFields({ value, onChange, name, dateProps }: { value: TemplateRepeat; onChange: (r: TemplateRepeat) => void; name: string; dateProps: Database['properties'] }) {
  const t = useT()
  const lang = useLang()
  const titleRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<TemplateRepeat>) => onChange({ ...value, ...patch })
  const days = weeklyDays(value)

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    if (next.length) set({ days: next.sort() })
  }

  const insertVar = (v: string) => {
    const el = titleRef.current
    const cur = value.title ?? ''
    const a = el?.selectionStart ?? cur.length
    const b = el?.selectionEnd ?? cur.length
    set({ title: cur.slice(0, a) + v + cur.slice(b) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(a + v.length, a + v.length)
    })
  }

  const next = nextRun(value)
  const titlePreview = next ? fillRepeatVars(value.title?.trim() || DEFAULT_REPEAT_TITLE, new Date(next.at), { name: name.trim() || t('common.untitled'), lang }) : ''
  const freqItems = REPEAT_FREQS.map((f) => ({ value: f, label: t(`database.repeat.freq.${f}`) }))

  return (
    <div className="rpt__body">
      <div className="rpt__grid">
        <Field label={t('database.repeat.freq')}>
          <Select<RepeatFreq> className="rpt__freq" value={value.freq} items={freqItems} onChange={(freq) => set({ freq })} ariaLabel={t('database.repeat.freq')} width={220} />
        </Field>

        {value.freq === 'interval' && (
          <Field label={t('database.repeat.every')}>
            <input
              type="number"
              className="input rpt__num"
              min={1}
              max={365}
              value={clampEvery(value.every)}
              aria-label={t('database.repeat.freq.interval')}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!Number.isNaN(n)) set({ every: clampEvery(n) })
              }}
            />
            <span className="rpt__unit">{t('database.repeat.everyUnit')}</span>
          </Field>
        )}

        {value.freq === 'weekly' && (
          <Field label={t('database.repeat.on')}>
            <div className="rpt__days" role="group" aria-label={t('database.repeat.on')}>
              {weekdayKeys(lang).map((k) => (
                <button key={k.day} type="button" className="rpt__day" aria-pressed={days.includes(k.day)} aria-label={k.long} title={k.long} onClick={() => toggleDay(k.day)}>
                  {k.short}
                </button>
              ))}
            </div>
          </Field>
        )}

        {value.freq === 'monthly' && (
          <Field label={t('database.repeat.dayOfMonth')}>
            <input
              type="number"
              className="input rpt__num"
              min={1}
              max={31}
              value={clampDayOfMonth(value.dayOfMonth, parseISO(value.start).getDate() || 1)}
              aria-label={t('database.repeat.dayOfMonth')}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!Number.isNaN(n)) set({ dayOfMonth: clampDayOfMonth(n) })
              }}
            />
            <span className="rpt__unit">{t('database.repeat.ofMonth')}</span>
          </Field>
        )}

        <Field label={t('database.repeat.at')}>
          <input type="time" className="input rpt__time" value={value.time} aria-label={t('database.repeat.at')} onChange={(e) => e.target.value && set({ time: e.target.value })} />
        </Field>

        <Field label={t('database.repeat.starts')}>
          <input type="date" className="input rpt__date" value={value.start} aria-label={t('database.repeat.starts')} onChange={(e) => e.target.value && set({ start: e.target.value })} />
        </Field>

        <Field label={t('database.repeat.ends')}>
          <Segmented
            value={value.end ? 'date' : 'never'}
            ariaLabel={t('database.repeat.ends')}
            items={[
              { value: 'never', label: t('database.repeat.never') },
              { value: 'date', label: t('database.repeat.onDate') },
            ]}
            onChange={(v) => set({ end: v === 'date' ? (value.end ?? format(addMonths(parseISO(value.start), 3), 'yyyy-MM-dd')) : null })}
          />
          {value.end && (
            <input type="date" className="input rpt__date" min={value.start} value={value.end} aria-label={t('database.repeat.endDate')} onChange={(e) => e.target.value && set({ end: e.target.value })} />
          )}
        </Field>

        <Field label={t('database.repeat.rowTitle')} top>
          <div className="rpt__title">
            <input ref={titleRef} className="input" value={value.title ?? ''} placeholder={DEFAULT_REPEAT_TITLE} aria-label={t('database.repeat.rowTitle')} onChange={(e) => set({ title: e.target.value })} />
            <div className="rpt__vars">
              {REPEAT_VARIABLES.map((v) => (
                <button key={v} type="button" className="rpt__var" title={t('database.repeat.insertVar', { v })} aria-label={t('database.repeat.insertVar', { v })} onClick={() => insertVar(v)}>
                  {v}
                </button>
              ))}
            </div>
            {titlePreview && (
              <div className="rpt__preview" data-testid="repeat-title-preview">
                → {titlePreview}
              </div>
            )}
          </div>
        </Field>

        {dateProps.length > 0 && (
          <Field label={t('database.repeat.dateProp')}>
            <Select<ID>
              value={value.dateProperty && dateProps.some((p) => p.id === value.dateProperty) ? value.dateProperty : NONE}
              items={[{ value: NONE, label: t('database.repeat.noDateProp') }, ...dateProps.map((p) => ({ value: p.id, label: p.name || t('common.untitled') }))]}
              onChange={(v) => set({ dateProperty: v === NONE ? null : v })}
              ariaLabel={t('database.repeat.dateProp')}
            />
          </Field>
        )}
      </div>
      <div className="rpt__foot">
        <NextRun repeat={value} then={2} />
        <span className="rpt__note">{t('database.repeat.note', { max: MAX_CATCH_UP })}</span>
      </div>
    </div>
  )
}

function Field({ label, top, children }: { label: string; top?: boolean; children: React.ReactNode }) {
  return (
    <>
      <span className="rpt__k label" data-top={top || undefined}>
        {label}
      </span>
      <div className="rpt__v">{children}</div>
    </>
  )
}
