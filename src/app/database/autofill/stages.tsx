/**
 * AI autofill panel — the run (meter, live log, cancel), the review (current → proposed, accept /
 * reject per row; a list on phones) and the summary.
 */
import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import type { PropertyDef, PropertyValue } from '../../store/types'
import { useLang, useT } from '../../i18n'
import { Checkbox, OptionTag } from '../cells/display'
import { formatNumber } from '../model/format'
import { isOptionProp } from './ConfigStage'
import { acceptAll, acceptProposal, cancelFill, closeAutofillPanel, discardAll, hasKey, openAISettings, rejectProposal, retryFailed, undoApplied, type Job, type Proposal } from './store'

/** Move focus into a stage when it appears (the previous stage's buttons are gone). */
function useStageFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const raf = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const pad = (n: number, w: number) => String(n).padStart(w, '0')

function counts(job: Job) {
  const r = Object.values(job.results)
  const by = (s: Proposal['status']) => r.filter((p) => p.status === s).length
  return { pending: by('pending'), same: by('same'), applied: by('applied'), rejected: by('rejected'), failed: by('error') }
}

function Meter({ total, done, failed }: { total: number; done: number; failed: number }) {
  const t = useT()
  const segs = Math.min(total, 48)
  const on = Math.round((done / Math.max(1, total)) * segs)
  const bad = Math.min(on, Math.round((failed / Math.max(1, total)) * segs))
  return (
    <div className="af-meter" role="progressbar" aria-label={t('database.autofill.run.meter')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} / ${total}`}>
      {Array.from({ length: segs }, (_, i) => (
        <i key={i} data-on={i < on || undefined} data-err={i >= on - bad && i < on && bad > 0 ? '' : undefined} data-head={i === on && done < total ? '' : undefined} />
      ))}
    </div>
  )
}

export function RunStage({ job, prop }: { job: Job; prop: PropertyDef }) {
  const t = useT()
  const focusRef = useStageFocus<HTMLButtonElement>()
  const total = job.rows.length
  const c = counts(job)
  const okCount = c.pending + c.same + c.applied
  const w = String(total).length < 2 ? 2 : String(total).length
  return (
    <>
      <div className="af-body">
        <div className="af-run" aria-live="polite">
          <div className="af-run__head">
            <span className="led led--on af-blink" aria-hidden />
            <span className="label">{job.cancelled ? t('database.autofill.run.stopping') : t('database.autofill.run.filling', { name: prop.name })}</span>
            <span className="af-spacer" />
            <span className="af-run__count">
              {pad(job.done, w)} / {pad(total, w)}
            </span>
          </div>
          <Meter total={total} done={job.done} failed={c.failed} />
          <div className="af-run__stats label">
            <span>
              {t('database.autofill.run.ok')} <b>{okCount}</b>
            </span>
            <span data-err={c.failed > 0 || undefined}>
              {t('database.autofill.run.err')} <b>{c.failed}</b>
            </span>
            <span>
              {t('database.autofill.run.left')} <b>{total - job.done}</b>
            </span>
          </div>
          <ol className="af-log">
            {job.recent.length === 0 && <li className="af-log__wait">{t('database.autofill.run.waiting')}</li>}
            {job.recent.map((id) => {
              const p = job.results[id]
              if (!p) return null
              return (
                <li key={id} data-status={p.status}>
                  <span className="af-log__led" aria-hidden />
                  <span className="af-log__title">{p.title || t('common.untitled')}</span>
                  <span className="af-log__val">{p.status === 'error' ? p.error : <Val prop={prop} p={p} compact />}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      <footer className="af-foot">
        <button type="button" className="btn btn--sm btn--ghost" onClick={closeAutofillPanel}>
          {t('database.autofill.run.background')}
        </button>
        <span className="af-spacer" />
        <button ref={focusRef} type="button" className="btn btn--sm" disabled={job.cancelled} onClick={() => cancelFill(job.key)}>
          {t('database.autofill.run.cancel')}
        </button>
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

function Val({ prop, p, current, compact }: { prop: PropertyDef; p?: Proposal; current?: PropertyValue; compact?: boolean }) {
  const t = useT()
  const lang = useLang()
  const empty = <span className="af-val__empty">{t('database.autofill.review.empty')}</span>
  if (isOptionProp(prop)) {
    const names = p
      ? (p.names ?? [])
      : (Array.isArray(current) ? current : current ? [current] : []).map((id) => prop.options?.find((o) => o.id === id)?.name).filter((x): x is string => !!x)
    if (!names.length) return empty
    return (
      <span className="af-val__tags">
        {names.map((n) => {
          const o = prop.options?.find((x) => x.name.toLowerCase() === n.toLowerCase())
          return o ? (
            <OptionTag key={n} option={o} />
          ) : (
            <span key={n} className="tag af-newtag">
              {n} <span className="af-newtag__mark">{t('database.autofill.review.new')}</span>
            </span>
          )
        })}
      </span>
    )
  }
  const v = p ? p.value : current
  if (prop.type === 'checkbox')
    return (
      <span className="af-val__check">
        <Checkbox checked={v === true} readOnly /> {v === true ? t('database.yes') : t('database.no')}
      </span>
    )
  if (v === null || v === undefined || v === '') return empty
  if (prop.type === 'number' && typeof v === 'number') return <span className="af-val__num">{formatNumber(v, prop.numberFormat, lang)}</span>
  return <span className={`af-val__text${compact ? ' af-val__text--one' : ''}`}>{String(v)}</span>
}

export function ReviewStage({ job, prop }: { job: Job; prop: PropertyDef }) {
  const t = useT()
  const focusRef = useStageFocus<HTMLButtonElement>()
  const c = counts(job)
  const list = job.rows.map((id) => job.results[id]).filter((p): p is Proposal => !!p && (p.status === 'pending' || p.status === 'applied' || p.status === 'rejected'))
  const errors = job.rows.map((id) => job.results[id]).filter((p): p is Proposal => p?.status === 'error')
  return (
    <>
      <div className="af-body">
        <div className="af-sum label">
          <span>{t('database.autofill.review.title')}</span>
          <span className="af-sum__item" data-kind="pending">
            {t('database.autofill.review.pending')} <b>{c.pending}</b>
          </span>
          <span className="af-sum__item">
            {t('database.autofill.review.same')} <b>{c.same}</b>
          </span>
          <span className="af-sum__item" data-kind={c.failed ? 'err' : undefined}>
            {t('database.autofill.review.failed')} <b>{c.failed}</b>
          </span>
        </div>
        {job.fatal && (
          <p className="af-issue" role="alert">
            {job.fatal}
          </p>
        )}
        <div className="af-table" role="table" aria-label={t('database.autofill.review.table')}>
          <div className="af-table__head" role="row">
            <span role="columnheader">{t('database.autofill.review.row')}</span>
            <span role="columnheader">{t('database.autofill.review.current')}</span>
            <span aria-hidden />
            <span role="columnheader">{t('database.autofill.review.proposed')}</span>
            <span role="columnheader" className="visually-hidden">
              {t('database.autofill.review.decision')}
            </span>
          </div>
          {list.map((p, i) => {
            const title = p.title || t('common.untitled')
            const first = list.findIndex((x) => x.status === 'pending') === i
            return (
              <div key={p.rowId} className="af-prop" role="row" data-status={p.status}>
                <span role="cell" className="af-prop__row">
                  {title}
                </span>
                <span role="cell" className="af-prop__cur">
                  <Val prop={prop} current={p.current} />
                </span>
                <span className="af-prop__arrow" aria-hidden>
                  →
                </span>
                <span role="cell" className="af-prop__new">
                  <Val prop={prop} p={p} />
                </span>
                <span role="cell" className="af-prop__act">
                  {p.status === 'pending' ? (
                    <>
                      <button ref={first ? focusRef : undefined} type="button" className="af-decide af-decide--ok" aria-label={t('database.autofill.review.acceptFor', { row: title })} title={t('database.autofill.review.acceptFor', { row: title })} onClick={() => acceptProposal(job.key, p.rowId)}>
                        <Check size={14} strokeWidth={2} />
                      </button>
                      <button type="button" className="af-decide" aria-label={t('database.autofill.review.rejectFor', { row: title })} title={t('database.autofill.review.rejectFor', { row: title })} onClick={() => rejectProposal(job.key, p.rowId)}>
                        <X size={14} strokeWidth={2} />
                      </button>
                    </>
                  ) : (
                    <span className="af-prop__state label">{p.status === 'applied' ? t('database.autofill.review.applied') : t('database.autofill.review.rejected')}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        {c.same > 0 && <p className="af-note">{t(`database.autofill.review.sameNote.${c.same === 1 ? 'one' : 'other'}`, { count: c.same })}</p>}
        <ErrorList errors={errors} />
      </div>
      <footer className="af-foot">
        {errors.length > 0 && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => retryFailed(job.key)}>
            {t('database.autofill.review.retry')} <span className="af-count">{errors.length}</span>
          </button>
        )}
        <span className="af-spacer" />
        <button type="button" className="btn btn--sm" onClick={() => discardAll(job.key)}>
          {t('database.autofill.review.discard')}
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => acceptAll(job.key)}>
          {t('database.autofill.review.acceptAll')} <span className="af-count">{c.pending}</span>
        </button>
      </footer>
    </>
  )
}

function ErrorList({ errors }: { errors: Proposal[] }) {
  const t = useT()
  if (!errors.length) return null
  return (
    <section className="af-errors" aria-label={t('database.autofill.review.errors')}>
      <h3 className="label">
        {t('database.autofill.review.errors')} · {errors.length}
      </h3>
      <ul>
        {errors.map((p) => (
          <li key={p.rowId}>
            <span className="af-errors__led" aria-hidden />
            <span className="af-errors__row">{p.title || t('common.untitled')}</span>
            <span className="af-errors__msg">{p.error}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Done                                                                */
/* ------------------------------------------------------------------ */

export function DoneStage({ job, onDone }: { job: Job; onDone: () => void }) {
  const t = useT()
  const focusRef = useStageFocus<HTMLButtonElement>()
  const c = counts(job)
  const errors = job.rows.map((id) => job.results[id]).filter((p): p is Proposal => p?.status === 'error')
  return (
    <>
      <div className="af-body">
        <div className="af-done">
          <h3 className="af-done__title">{t('database.autofill.done.title')}</h3>
          {job.cancelled && <p className="af-note">{t('database.autofill.done.cancelled', { done: job.done, total: job.rows.length })}</p>}
          {job.undone && (
            <p className="af-note" role="status">
              {t('database.autofill.done.undone')}
            </p>
          )}
          {job.fatal && (
            <p className="af-issue" role="alert">
              {job.fatal}
            </p>
          )}
          <dl className="af-readout">
            <div>
              <dt className="label">{t('database.autofill.done.applied')}</dt>
              <dd>{c.applied}</dd>
            </div>
            <div>
              <dt className="label">{t('database.autofill.done.rejected')}</dt>
              <dd>{c.rejected}</dd>
            </div>
            <div>
              <dt className="label">{t('database.autofill.review.same')}</dt>
              <dd>{c.same}</dd>
            </div>
            <div data-err={c.failed > 0 || undefined}>
              <dt className="label">{t('database.autofill.review.failed')}</dt>
              <dd>{c.failed}</dd>
            </div>
          </dl>
          <ErrorList errors={errors} />
        </div>
      </div>
      <footer className="af-foot">
        {errors.length > 0 && !job.fatal && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => retryFailed(job.key)}>
            {t('database.autofill.review.retry')} <span className="af-count">{errors.length}</span>
          </button>
        )}
        {job.fatal && !hasKey() && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={openAISettings}>
            {t('database.autofill.nokey.open')}
          </button>
        )}
        <span className="af-spacer" />
        {c.applied > 0 && !job.undone && (
          <button type="button" className="btn btn--sm" onClick={() => undoApplied(job.key)}>
            {t('database.autofill.done.undo')} <span className="af-count">{c.applied}</span>
          </button>
        )}
        <button ref={focusRef} type="button" className="btn btn--sm btn--primary" onClick={onDone}>
          {t('database.autofill.done')}
        </button>
      </footer>
    </>
  )
}
