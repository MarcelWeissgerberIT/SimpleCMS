/** Home panel: the next 7 days from the agenda (3–6 items) + a way into the full agenda. */
import { useMemo, type CSSProperties } from 'react'
import { ArrowRight, AtSign } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { navigate } from '../../lib/router'
import { safeLocalSet } from '@/shared/brand'
import { useLocalPref, useNow } from '../lib/hooks'
import { dateToDay, overdueItems, useAgendaIndex, type AgendaItem } from './model'
import { fmtDayStamp, fmtTime } from './format'
import { openItem } from './actions'
import { sourceLabel } from './parts'
import './agenda.css'

const MAX = 6

export function openAgenda(view?: 'month' | 'week' | 'list') {
  if (view) safeLocalSet('one.agenda.view', JSON.stringify(view))
  navigate({ name: 'agenda' })
}

/** "Open agenda" + overdue counter, for the section label row. */
export function NextDaysActions() {
  const t = useT()
  const index = useAgendaIndex()
  const [hiddenList] = useLocalPref<string[]>('one.agenda.hidden', [])
  const now = useNow(60_000)
  const overdue = useMemo(
    () => overdueItems(index.items, dateToDay(new Date(now)), new Set(Array.isArray(hiddenList) ? hiddenList : [])).length,
    [index, hiddenList, now],
  )
  return (
    <span className="nx-actions">
      {overdue > 0 && (
        <button type="button" className="nx-overdue" onClick={() => openAgenda('list')}>
          <span className="led led--on" aria-hidden />
          {t('shell.agenda.overdueN', { n: overdue })}
        </button>
      )}
      <button type="button" className="nx-open" onClick={() => openAgenda()}>
        {t('shell.agenda.open')}
        <ArrowRight size={13} />
      </button>
    </span>
  )
}

export function NextDays() {
  const t = useT()
  const lang = useLang()
  const index = useAgendaIndex()
  const [hiddenList] = useLocalPref<string[]>('one.agenda.hidden', [])
  const now = useNow(60_000)
  const today = dateToDay(new Date(now))
  // starting in the next 7 days, or (not done yet) ending in them
  const items = useMemo(() => {
    const hidden = new Set(Array.isArray(hiddenList) ? hiddenList : [])
    const out: Array<{ it: AgendaItem; day: number; ends: boolean }> = []
    for (const it of index.items) {
      if (it.start > today + 6) break
      if (hidden.has(it.source) || it.done === true) continue
      if (it.start >= today) out.push({ it, day: it.start, ends: false })
      else if (it.end >= today && it.end <= today + 6 && it.done === false) out.push({ it, day: it.end, ends: true })
    }
    out.sort((a, b) => a.day - b.day || Number(a.ends) - Number(b.ends) || (a.it.time ?? '').localeCompare(b.it.time ?? ''))
    return out.slice(0, MAX)
  }, [index, hiddenList, today])
  const sources = useMemo(() => new Map(index.sources.map((s) => [s.id, s])), [index.sources])

  if (!items.length)
    return (
      <div className="nx-empty">
        <p>{t('shell.agenda.nothingSoon')}</p>
        <button type="button" className="btn btn--sm" onClick={() => openAgenda()}>
          {t('shell.agenda.open')}
          <ArrowRight size={13} />
        </button>
      </div>
    )

  return (
    <ol className="nx">
      {items.map(({ it, day, ends }) => {
        const src = sources.get(it.source)
        const color = it.color ?? src?.color ?? 'gray'
        return (
          <li key={it.key}>
            <button type="button" className="nx-row" style={{ '--ag-accent': `var(--c-${color}-text)` } as CSSProperties} onClick={() => openItem(it)}>
              <span className="nx-row__when">
                <span className="nx-row__day" data-today={day === today || undefined}>
                  {day === today ? t('shell.agenda.today') : fmtDayStamp(day, lang)}
                </span>
                <span className="nx-row__time" data-ends={ends || undefined}>
                  {ends ? t('shell.agenda.ends') : it.time ? fmtTime(it.time, lang) : t('shell.agenda.allDay')}
                </span>
              </span>
              <span className="nx-row__main">
                {it.kind === 'mention' ? <AtSign size={14} className="nx-row__at" /> : <PageIcon icon={it.icon} kind={it.pageKind} size={16} />}
                <span className="nx-row__title" data-untitled={!it.title.trim() || undefined}>
                  {it.title.trim() || t('common.untitled')}
                </span>
              </span>
              <span className="ag-srctag nx-row__src">
                <span className="led" style={{ background: `var(--c-${src?.color ?? 'gray'}-text)` }} aria-hidden />
                <span className="ag-srctag__name">{sourceLabel(src, t)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
