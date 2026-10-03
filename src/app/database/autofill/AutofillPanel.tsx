/**
 * AI autofill panel for one property: configure (preset, options, updates) → run (meter, cancel)
 * → review (current → proposed, accept / reject per row) → done. One instance at a time, rendered by
 * the first mounted <AutofillHost/> (database views and row pages mount one).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Check, X } from 'lucide-react'
import type { AutofillConfig, AutofillPreset, Database, PropertyDef, PropertyValue } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { Switch } from '../../ui/controls'
import { Select } from '../parts'
import { Checkbox, OptionTag } from '../cells/display'
import { formatNumber } from '../model/format'
import { rowsOf } from '../model/actions'
import { LANGUAGES, autofillOf, canAutofill, configIssue, defaultConfig, presetsFor, translateTarget } from './config'
import { CONTENT_MAX, contextChars } from './context'
import {
  acceptAll,
  acceptProposal,
  cancelFill,
  closeAutofillPanel,
  discardAll,
  hasKey,
  isEmptyCell,
  jobKey,
  openAISettings,
  rejectProposal,
  retryFailed,
  saveAutofillConfig,
  startFill,
  useAutofill,
  useAutofillHost,
  useFeatures,
  type Job,
  type Proposal,
} from './store'
import { startAutofillWatch } from './watch'
import './autofill.css'

/** Mount point for the panel (and the auto-update watcher). Safe to render more than once. */
export function AutofillHost() {
  const primary = useAutofillHost()
  const panel = useAutofill((s) => s.panel)
  useEffect(() => startAutofillWatch(), [])
  if (!primary || !panel) return null
  return <AutofillPanel key={jobKey(panel.dbId, panel.propId)} dbId={panel.dbId} propId={panel.propId} />
}

function AutofillPanel({ dbId, propId }: { dbId: string; propId: string }) {
  const db = useWorkspace((s) => s.databases[dbId])
  const prop = db?.properties.find((p) => p.id === propId)
  const ok = !!db && !!prop && canAutofill(prop)
  useEffect(() => {
    if (!ok) closeAutofillPanel()
  }, [ok])
  if (!ok) return null
  return <PanelBody db={db} prop={prop} />
}

function PanelBody({ db, prop }: { db: Database; prop: PropertyDef }) {
  const t = useT()
  const key = jobKey(db.id, prop.id)
  const job = useAutofill((s) => s.jobs[key])
  const live = autofillOf(prop)
  const [draft, setDraft] = useState<AutofillConfig>(() => live ?? defaultConfig(prop))
  const dirty = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const commit = useCallback(() => {
    if (!dirty.current) return
    dirty.current = false
    saveAutofillConfig(db.id, prop.id, draftRef.current)
  }, [db.id, prop.id])

  const update = (patch: Partial<AutofillConfig>) => {
    dirty.current = true
    setDraft((d) => ({ ...d, ...patch }))
  }

  const close = () => {
    commit()
    closeAutofillPanel()
  }

  const run = (mode: 'all' | 'empty') => {
    dirty.current = true
    commit()
    void startFill(db.id, prop.id, mode)
  }

  const turnOff = () => {
    dirty.current = false
    saveAutofillConfig(db.id, prop.id, null)
    closeAutofillPanel()
  }

  const turnOn = () => {
    dirty.current = true
    close()
  }

  const cancel = () => {
    dirty.current = false
    closeAutofillPanel()
  }

  const stage = !job ? 'config' : job.phase === 'running' ? 'run' : job.phase === 'review' ? 'review' : 'done'
  const status = !live ? t('database.autofill.status.off') : live.auto ? t('database.autofill.status.auto') : t('database.autofill.status.on')

  return (
    <Modal open onClose={close} bare width={680} className="af" ariaLabel={t('database.autofill.title', { name: prop.name })}>
      <header className="af-head">
        <div className="af-head__bar label">
          <span className={`led${live ? ' led--on' : ''}${stage === 'run' ? ' af-blink' : ''}`} aria-hidden />
          <span>{t('database.autofill.label')}</span>
          <span className="af-head__dim">· {t(`database.type.${prop.type}`)}</span>
          <span className="af-spacer" />
          <span className="af-head__status">{status}</span>
          <button type="button" className="icon-btn af-head__close" onClick={close} aria-label={t('database.autofill.close')}>
            <X size={16} />
          </button>
        </div>
        <h2 className="af-head__title" data-modal-title>
          {prop.name}
        </h2>
      </header>
      {stage === 'config' && <ConfigStage db={db} prop={prop} draft={draft} update={update} onRun={run} on={!!live} onTurnOff={turnOff} onTurnOn={turnOn} onCancel={cancel} onDone={close} />}
      {stage === 'run' && job && <RunStage job={job} prop={prop} />}
      {stage === 'review' && job && <ReviewStage job={job} prop={prop} />}
      {stage === 'done' && job && <DoneStage job={job} prop={prop} onDone={close} />}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const isOptionProp = (p: PropertyDef) => p.type === 'select' || p.type === 'multi_select'

function ConfigStage({
  db,
  prop,
  draft,
  update,
  onRun,
  on,
  onTurnOff,
  onTurnOn,
  onCancel,
  onDone,
}: {
  db: Database
  prop: PropertyDef
  draft: AutofillConfig
  update: (patch: Partial<AutofillConfig>) => void
  onRun: (mode: 'all' | 'empty') => void
  /** autofill is currently on for this property */
  on: boolean
  onTurnOff: () => void
  onTurnOn: () => void
  onCancel: () => void
  onDone: () => void
}) {
  const t = useT()
  const keyOk = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const presets = presetsFor(prop.type)
  const issue = configIssue(prop, draft)
  const canRun = keyOk && !issue

  return (
    <>
      <div className="af-body">
        {!keyOk && (
          <div className="af-nokey" role="note">
            <span className="led" aria-hidden />
            <div className="af-nokey__text">
              <strong>{t('database.autofill.nokey.title')}</strong>
              <span>{t('database.autofill.nokey.body')}</span>
            </div>
            <button type="button" className="btn btn--sm btn--ink" onClick={openAISettings}>
              {t('database.autofill.nokey.open')}
            </button>
          </div>
        )}

        <section className="af-sec">
          <h3 className="af-sec__label label">{t('database.autofill.sec.task')}</h3>
          <PresetPicker presets={presets} value={draft.preset} onChange={(preset) => update({ preset })} />
          <PresetFields db={db} prop={prop} draft={draft} update={update} />
          <p className="af-note">{draft.preset === 'translate' ? t('database.autofill.contextTranslate') : t('database.autofill.context', { chars: CONTENT_MAX.toLocaleString() })}</p>
        </section>

        <section className="af-sec">
          <h3 className="af-sec__label label">{t('database.autofill.sec.updates')}</h3>
          <SwitchRow label={t('database.autofill.auto')} note={t('database.autofill.autoNote')} checked={!!draft.auto} onChange={(auto) => update({ auto })} />
          <SwitchRow label={t('database.autofill.skipReview')} note={t('database.autofill.skipReviewNote')} checked={!!draft.skipReview} onChange={(skipReview) => update({ skipReview })} />
        </section>

        <section className="af-sec">
          <h3 className="af-sec__label label">{t('database.autofill.sec.run')}</h3>
          <RunControls db={db} prop={prop} draft={draft} canRun={canRun} issue={keyOk ? issue : null} onRun={onRun} />
        </section>
      </div>
      <footer className="af-foot">
        {on ? (
          <>
            <button type="button" className="btn btn--ghost btn--sm af-foot__off" onClick={onTurnOff}>
              {t('database.autofill.turnOff')}
            </button>
            <span className="af-spacer" />
            <button type="button" className="btn btn--sm btn--ink" onClick={onDone}>
              {t('database.autofill.done')}
            </button>
          </>
        ) : (
          <>
            <span className="af-spacer" />
            <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--sm btn--ink" disabled={!!issue} onClick={onTurnOn}>
              {t('database.autofill.turnOn')}
            </button>
          </>
        )}
      </footer>
    </>
  )
}

function PresetPicker({ presets, value, onChange }: { presets: AutofillPreset[]; value: AutofillPreset; onChange: (p: AutofillPreset) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = (presets.indexOf(value) + step + presets.length) % presets.length
    onChange(presets[i])
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div className="af-presets" role="radiogroup" aria-label={t('database.autofill.presets')} ref={ref} onKeyDown={onKey} data-count={presets.length}>
      {presets.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={p === value} tabIndex={p === value ? 0 : -1} className="af-preset" onClick={() => onChange(p)}>
          <span className="af-preset__code" aria-hidden>
            {t(`database.autofill.code.${p}`)}
          </span>
          <span className="af-preset__name">{t(`database.autofill.preset.${p}`)}</span>
          <span className="af-preset__desc">{t(`database.autofill.desc.${p}`)}</span>
        </button>
      ))}
    </div>
  )
}

function PresetFields({ db, prop, draft, update }: { db: Database; prop: PropertyDef; draft: AutofillConfig; update: (patch: Partial<AutofillConfig>) => void }) {
  const t = useT()
  const fields: ReactElement[] = []
  if (draft.preset === 'extract')
    fields.push(
      <label key="extract" className="af-field">
        <span className="label">{t('database.autofill.extract.label')}</span>
        <input className="input" value={draft.prompt ?? ''} placeholder={t('database.autofill.extract.placeholder')} onChange={(e) => update({ prompt: e.target.value })} />
      </label>,
    )
  if (draft.preset === 'custom')
    fields.push(
      <label key="custom" className="af-field">
        <span className="label">{t('database.autofill.custom.label')}</span>
        <textarea className="input af-field__area" rows={3} value={draft.prompt ?? ''} placeholder={t(`database.autofill.custom.placeholder.${prop.type}`)} onChange={(e) => update({ prompt: e.target.value })} />
      </label>,
    )
  if (draft.preset === 'translate') {
    const title = db.properties.find((p) => p.type === 'title')
    const sources = db.properties.filter((p) => p.id !== prop.id && (p.type === 'title' || p.type === 'text'))
    const items = [...sources.map((p) => ({ value: p.id, label: p.name })), { value: 'content', label: t('database.autofill.translate.content') }]
    fields.push(
      <div key="translate" className="af-fieldrow">
        <div className="af-field">
          <span className="label">{t('database.autofill.translate.source')}</span>
          <Select value={draft.source ?? title?.id ?? 'content'} items={items} onChange={(source) => update({ source })} ariaLabel={t('database.autofill.translate.source')} />
        </div>
        <span className="af-fieldrow__arrow" aria-hidden>
          →
        </span>
        <div className="af-field">
          <span className="label">{t('database.autofill.translate.into')}</span>
          <Select
            value={translateTarget(draft)}
            items={LANGUAGES.map((l) => ({ value: l.name, label: l.native }))}
            searchable
            onChange={(language) => update({ language })}
            ariaLabel={t('database.autofill.translate.into')}
          />
        </div>
      </div>,
    )
  }
  if (isOptionProp(prop) && (draft.preset === 'categorize' || draft.preset === 'custom'))
    fields.push(
      <div key="options" className="af-field">
        <span className="label">{t('database.autofill.cat.options')}</span>
        <div className="af-options">
          {(prop.options ?? []).length ? (prop.options ?? []).map((o) => <OptionTag key={o.id} option={o} />) : <span className="af-note">{t('database.autofill.cat.none')}</span>}
        </div>
        <SwitchRow label={t('database.autofill.cat.allowNew')} note={t('database.autofill.cat.allowNewNote')} checked={!!draft.allowNewOptions} onChange={(allowNewOptions) => update({ allowNewOptions })} />
      </div>,
    )
  return fields.length ? <div className="af-fields">{fields}</div> : null
}

function SwitchRow({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="af-switch">
      <div className="af-switch__text" onClick={() => onChange(!checked)}>
        <span className="af-switch__title">{label}</span>
        <span className="af-note">{note}</span>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function formatTokens(n: number, lang: string): string {
  if (n < 1000) return String(Math.max(1, Math.round(n)))
  return `${(n / 1000).toLocaleString(lang, { maximumFractionDigits: n < 10_000 ? 1 : 0 })}k`
}

function formatUSD(n: number, lang: string): string {
  const fmt = (v: number, digits: number) => v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (n < 0.01) return `< ${fmt(0.01, 2)}`
  return fmt(n, n < 1 ? 3 : 2)
}

function RunControls({ db, prop, draft, canRun, issue, onRun }: { db: Database; prop: PropertyDef; draft: AutofillConfig; canRun: boolean; issue: string | null; onRun: (mode: 'all' | 'empty') => void }) {
  const t = useT()
  const lang = useLang()
  const api = useFeatures()
  const pages = useWorkspace((s) => s.pages)
  const { all, empty, chars } = useMemo(() => {
    void pages
    const rows = rowsOf(db.id)
    const live = autofillOf(prop)
    return {
      all: rows.length,
      empty: rows.filter((r) => isEmptyCell(prop, r, live)).length,
      chars: rows.reduce((n, r) => n + contextChars(db, prop, r, draft), 0),
    }
  }, [pages, db, prop, draft])
  const est = api ? api.estimateAutofill({ rows: all, contextChars: chars, preset: draft.preset }) : null

  return (
    <div className="af-runbox">
      <dl className="af-readout" aria-label={t('database.autofill.est.label')}>
        <div>
          <dt className="label">{t('database.autofill.est.rows')}</dt>
          <dd>{all}</dd>
        </div>
        <div>
          <dt className="label">{t('database.autofill.est.in')}</dt>
          <dd>~{est ? formatTokens(est.inputTokens, lang) : '—'}</dd>
        </div>
        <div>
          <dt className="label">{t('database.autofill.est.out')}</dt>
          <dd>~{est ? formatTokens(est.outputTokens, lang) : '—'}</dd>
        </div>
        <div className="af-readout__cost">
          <dt className="label">{t('database.autofill.est.cost')}</dt>
          <dd>≈ {est ? formatUSD(est.usd, lang) : '—'}</dd>
        </div>
      </dl>
      <p className="af-note">{t('database.autofill.est.note', { model: est?.model ?? '—' })}</p>
      {issue && (
        <p className="af-issue" role="status">
          {t(issue)}
        </p>
      )}
      <div className="af-runbtns">
        <button type="button" className="btn" disabled={!canRun || !empty} onClick={() => onRun('empty')}>
          {t('database.autofill.fillEmpty')} <span className="af-count">{empty}</span>
        </button>
        <button type="button" className="btn btn--primary" disabled={!canRun || !all} onClick={() => onRun('all')}>
          {t('database.autofill.fillAll')} <span className="af-count">{all}</span>
        </button>
      </div>
    </div>
  )
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

function RunStage({ job, prop }: { job: Job; prop: PropertyDef }) {
  const t = useT()
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
        <button type="button" className="btn btn--sm" disabled={job.cancelled} onClick={() => cancelFill(job.key)} data-autofocus="">
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

function ReviewStage({ job, prop }: { job: Job; prop: PropertyDef }) {
  const t = useT()
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
          {list.map((p) => {
            const title = p.title || t('common.untitled')
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
                      <button type="button" className="af-decide af-decide--ok" aria-label={t('database.autofill.review.acceptFor', { row: title })} title={t('database.autofill.review.acceptFor', { row: title })} onClick={() => acceptProposal(job.key, p.rowId)}>
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

function DoneStage({ job, prop, onDone }: { job: Job; prop: PropertyDef; onDone: () => void }) {
  const t = useT()
  const c = counts(job)
  const errors = job.rows.map((id) => job.results[id]).filter((p): p is Proposal => p?.status === 'error')
  void prop
  return (
    <>
      <div className="af-body">
        <div className="af-done">
          <h3 className="af-done__title">{t('database.autofill.done.title')}</h3>
          {job.cancelled && <p className="af-note">{t('database.autofill.done.cancelled', { done: job.done, total: job.rows.length })}</p>}
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
        <button type="button" className="btn btn--sm btn--primary" onClick={onDone} data-autofocus="">
          {t('database.autofill.done')}
        </button>
      </footer>
    </>
  )
}
