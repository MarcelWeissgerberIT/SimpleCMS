/**
 * Responses tab: how many responses the form made, when the last one came in, and a summary
 * per question (hairline bars for options, averages for numbers). Counts only rows the form
 * marked (responses.ts) — and says so: shared-link answers live in the webhook.
 */
import { useId, useMemo } from 'react'
import { ArrowUpRight, Radio, Table2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { colorText } from '../../lib/colors'
import type { DbModel } from '../hooks'
import { openRow } from '../model/actions'
import { formatNumber, formatTimestamp } from '../model/format'
import { formConfig, isValidWebhookUrl, type Field } from './fields'
import { formTitle } from './ShareForm'
import { hostOf } from './webhook'
import { markerFilter, markerOf, responseRows, responsesViewOf, startTracking, stopTracking, summarize, type Marker, type Summary } from './responses'

const pad = (n: number) => String(n).padStart(2, '0')
const WEEK = 7 * 24 * 60 * 60 * 1000

function ago(ms: number, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang === 'de' ? 'de' : 'en', { numeric: 'auto' })
  const s = Math.round((ms - Date.now()) / 1000)
  if (Math.abs(s) < 60) return rtf.format(s, 'second')
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

export function Responses({ m, fields }: { m: DbModel; fields: Field[] }) {
  const t = useT()
  const lang = useLang()
  const uid = useId().replace(/:/g, '')
  const marker = useMemo(() => markerOf(m.db, m.view), [m.db, m.view])
  const rows = useMemo(() => (marker ? responseRows(m.allRows, marker) : []), [m.allRows, marker])
  const people = useWorkspace((s) => s.people)
  const title = formTitle(m, t('common.untitled'))
  const hook = (formConfig(m.view).webhookUrl ?? '').trim()

  return (
    <div className="fr" aria-labelledby={`${uid}-h`}>
      <h3 className="visually-hidden" id={`${uid}-h`}>
        {t('database.form.responsesTab')}
      </h3>
      {marker ? <Readouts rows={rows} lang={lang} /> : <NotTracking m={m} title={title} />}
      {marker && <TrackingBar m={m} marker={marker} title={title} />}
      <p className="fr-honest">
        <Radio size={13} aria-hidden />
        <span>
          {isValidWebhookUrl(hook)
            ? t('database.form.r.sharedHook', { host: hostOf(hook), prop: marker?.prop.name ?? t('database.form.r.propName'), option: marker?.option.name ?? title })
            : t('database.form.r.sharedNone')}
        </span>
      </p>

      {marker && rows.length > 0 && (
        <section className="fr-sec" aria-labelledby={`${uid}-q`}>
          <h4 className="label fr-sec__label" id={`${uid}-q`}>
            § {t('database.form.r.perQuestion')}
          </h4>
          <ol className="fr-qs">
            {fields.map((f, i) => (
              <QuestionSummary key={f.key} f={f} index={i} summary={summarize(f, rows, people)} total={rows.length} lang={lang} />
            ))}
          </ol>
        </section>
      )}

      {marker && rows.length > 0 && (
        <section className="fr-sec" aria-labelledby={`${uid}-l`}>
          <h4 className="label fr-sec__label" id={`${uid}-l`}>
            § {t('database.form.r.latest')}
          </h4>
          <ul className="fr-latest">
            {rows.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button type="button" className="fr-latest__row" onClick={() => openRow(r.id, m.view)}>
                  <span className="fr-latest__title">{r.title.trim() || t('common.untitled')}</span>
                  <span className="label fr-latest__time">{formatTimestamp(r.createdAt, lang)}</span>
                  <ArrowUpRight size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {marker && rows.length === 0 && <p className="fr-empty">{t('database.form.r.none')}</p>}
    </div>
  )
}

function Readouts({ rows, lang }: { rows: { createdAt: number }[]; lang: Lang }) {
  const t = useT()
  const last = rows[0]?.createdAt ?? null
  const week = rows.filter((r) => Date.now() - r.createdAt < WEEK).length
  return (
    <dl className="fr-readouts">
      <div className="fr-readout">
        <dt className="label">{t('database.form.r.total')}</dt>
        <dd className="fr-readout__value" data-testid="form-response-count">
          {pad(rows.length)}
        </dd>
      </div>
      <div className="fr-readout">
        <dt className="label">{t('database.form.r.last')}</dt>
        <dd className="fr-readout__value fr-readout__value--text">{last ? ago(last, lang) : '—'}</dd>
        {last && <dd className="label fr-readout__sub">{formatTimestamp(last, lang)}</dd>}
      </div>
      <div className="fr-readout">
        <dt className="label">{t('database.form.r.week')}</dt>
        <dd className="fr-readout__value">{pad(week)}</dd>
      </div>
    </dl>
  )
}

function NotTracking({ m, title }: { m: DbModel; title: string }) {
  const t = useT()
  return (
    <div className="fr-off">
      <div className="label fr-off__state">
        <span className="led" aria-hidden /> {t('database.form.r.offState')}
      </div>
      <p className="fr-off__text">{t('database.form.r.offText', { prop: t('database.form.r.propName'), option: title })}</p>
      {m.fixed ? (
        <p className="label">{t('database.form.r.offFixed')}</p>
      ) : (
        <button type="button" className="btn btn--primary" onClick={() => startTracking(m.db.id, m.view.id, t('database.form.r.propName'), title)}>
          {t('database.form.r.start')}
        </button>
      )}
    </div>
  )
}

function TrackingBar({ m, marker, title }: { m: DbModel; marker: Marker; title: string }) {
  const t = useT()
  const existing = responsesViewOf(m.db, marker)
  const openTable = (el: HTMLElement) => {
    const s = useWorkspace.getState()
    let id = existing?.id
    if (!id) {
      if (m.fixed) return
      const visibleProperties = [...m.view.visibleProperties.filter((p) => p !== marker.prop.id), marker.prop.id]
      id = s.addView(m.db.id, { type: 'table', name: `${title} · ${t('database.form.r.viewSuffix')}`, filter: markerFilter(marker), visibleProperties })
    }
    const name = useWorkspace.getState().databases[m.db.id]?.views.find((v) => v.id === id)?.name ?? ''
    selectViewTab(el, m, id, () => useUI.getState().toast({ message: t('database.form.r.viewAdded', { name }) }))
  }
  return (
    <div className="fr-track">
      <span className="label fr-track__state">
        <span className="led led--ok" aria-hidden /> {t('database.form.r.onState', { prop: marker.prop.name, option: marker.option.name })}
      </span>
      <span className="fr-track__spacer" />
      {(existing || !m.fixed) && (
        <button type="button" className="btn btn--sm" onClick={(e) => openTable(e.currentTarget)}>
          <Table2 size={13} /> {t('database.form.r.openTable')}
        </button>
      )}
      {!m.fixed && (
        <button type="button" className="btn btn--sm btn--ghost fr-track__stop" onClick={() => stopTracking(m.db.id, m.view.id)}>
          {t('database.form.r.stop')}
        </button>
      )}
    </div>
  )
}

/**
 * Switch the database to a view: the view tabs are the one place that selects views, so the
 * tab is pressed once it is on screen (a just-added view renders a frame later).
 */
function selectViewTab(from: HTMLElement, m: DbModel, viewId: string, onFail: () => void) {
  const section = from.closest('section.db')
  let tries = 0
  const press = () => {
    const index = useWorkspace.getState().databases[m.db.id]?.views.findIndex((v) => v.id === viewId) ?? -1
    const tabs = section?.querySelectorAll<HTMLElement>('.db-tabs [role="tab"]')
    if (index >= 0 && tabs && tabs.length > index) return tabs[index].click()
    if (++tries < 20) requestAnimationFrame(press)
    else onFail()
  }
  press()
}

function QuestionSummary({ f, index, summary, total, lang }: { f: Field; index: number; summary: Summary; total: number; lang: Lang }) {
  const t = useT()
  const nf = (n: number) => formatNumber(n, f.prop?.type === 'number' ? f.prop.numberFormat : undefined, lang)
  const avg = (n: number) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 }).format(n)
  const day = (iso: string) => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00`))
  return (
    <li className="fr-q" data-kind={f.kind}>
      <div className="fr-q__head">
        <span className="fr-q__num">Q{pad(index + 1)}</span>
        <span className="fr-q__name">{f.name.trim() || t('common.untitled')}</span>
        <span className="label fr-q__answered">{t('database.form.r.answered', { n: summary.answered, total })}</span>
      </div>
      {summary.type === 'bars' && <Bars summary={summary} lang={lang} labelOf={(id, label) => (f.kind === 'checkbox' ? t(id === 'yes' ? 'database.yes' : 'database.no') : label)} />}
      {summary.type === 'bars' && summary.average !== undefined && (
        <p className="label fr-q__stat">
          {t('database.form.r.avg')} {avg(summary.average)} / {summary.bars.length}
        </p>
      )}
      {summary.type === 'number' && (
        <p className="label fr-q__stat">
          {summary.average === null ? '—' : `${t('database.form.r.avg')} ${nf(summary.average)} · ${t('database.form.r.min')} ${nf(summary.min!)} · ${t('database.form.r.max')} ${nf(summary.max!)}`}
        </p>
      )}
      {summary.type === 'dates' && <p className="label fr-q__stat">{summary.first ? `${day(summary.first)} → ${day(summary.last!)}` : '—'}</p>}
      {summary.type === 'texts' && summary.latest.length > 0 && (
        <ul className="fr-q__texts">
          {summary.latest.map((x, i) => (
            <li key={i}>{x.length > 140 ? `${x.slice(0, 140)}…` : x}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Bars({ summary, lang, labelOf }: { summary: Extract<Summary, { type: 'bars' }>; lang: Lang; labelOf: (id: string, label: string) => string }) {
  const top = Math.max(1, ...summary.bars.map((b) => b.count))
  // the signal colour marks a clear leader only (a tie has none)
  const leader = summary.bars.filter((b) => b.count === top).length === 1
  // share of the responses that answered (a multi-select response can pick several)
  const sum = summary.answered
  const pct = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'percent', maximumFractionDigits: 0 })
  return (
    <ul className="fr-bars">
      {summary.bars.map((b) => (
        <li key={b.id} className="fr-bar" data-top={leader && b.count === top ? true : undefined}>
          <span className="fr-bar__label">
            {b.color && <span className="fr-bar__swatch" style={{ background: colorText(b.color === 'default' ? 'gray' : b.color) }} aria-hidden />}
            {labelOf(b.id, b.label)}
          </span>
          <span className="fr-bar__track" aria-hidden>
            <span className="fr-bar__fill" style={{ width: `${(b.count / top) * 100}%` }} />
          </span>
          <span className="fr-bar__count">
            {pad(b.count)} <span className="fr-bar__pct">{sum ? pct.format(b.count / sum) : '—'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
