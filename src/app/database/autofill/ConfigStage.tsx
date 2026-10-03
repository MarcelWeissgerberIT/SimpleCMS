/**
 * AI autofill panel — configuration: preset keys, preset fields, update switches, cost estimate
 * and the run buttons.
 */
import { useMemo, useRef, type KeyboardEvent, type ReactElement } from 'react'
import type { AutofillConfig, AutofillPreset, Database, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { Select } from '../parts'
import { OptionTag } from '../cells/display'
import { rowsOf } from '../model/actions'
import { LANGUAGES, autofillOf, configIssue, presetsFor, translateTarget } from './config'
import { CONTENT_MAX, contextChars } from './context'
import { isEmptyCell, openAISettings, useFeatures } from './store'

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const isOptionProp = (p: PropertyDef) => p.type === 'select' || p.type === 'multi_select'

export function ConfigStage({
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
        <button key={p} type="button" role="radio" aria-checked={p === value} tabIndex={p === value ? 0 : -1} data-autofocus={p === value ? '' : undefined} className="af-preset" onClick={() => onChange(p)}>
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
