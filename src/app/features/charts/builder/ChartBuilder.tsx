/**
 * The chart builder: 01 DATA → 02 TYPE → 03 OPTIONS, with the live chart beside it.
 * Default path = 3 clicks: pick a source (sensible defaults are pre-picked) → Next → the
 * suggested type is already chosen → Insert. Every step can save once a source exists.
 */
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { Modal } from '../../../ui/Modal'
import type { ChartData, ChartKind, ChartSource, ChartSourceKind, ChartSpec } from '../types'
import { normalizeSpec, suggestKind } from '../spec'
import { tableToChartData } from '../table'
import { useChartData } from '../data/resolve'
import { metricDef } from '../data/system'
import { ChartRenderer } from '../render/ChartRenderer'
import type { BuilderStep, ChartBuilderOptions } from './host'
import { SourceStep, autoTitle, initialDraft, sourceOf, type SourceDraft } from './SourceStep'
import { TypeStep } from './TypeStep'
import { OptionsStep } from './OptionsStep'
import './builder.css'

const STEPS: BuilderStep[] = ['source', 'type', 'options']
const ALL: ChartSourceKind[] = ['sheet', 'database', 'system', 'manual']

export type Draft = Omit<ChartSpec, 'source' | 'kind'> & { kind: ChartKind }

const NARROW = '(max-width: 760px)'
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

export default function ChartBuilder(props: ChartBuilderOptions & { onClose: () => void }) {
  const { initial, onSave, onCancel, onClose, inline, pageId } = props
  const t = useT()
  const lang = useLang()
  const narrow = useNarrow()
  const allowed = props.allowedSources?.length ? props.allowedSources : ALL
  const startSource = initial?.source ?? props.source ?? null
  const [step, setStep] = useState<BuilderStep>(props.step ?? (initial ? 'source' : startSource ? 'type' : 'source'))
  const [src, setSrc] = useState<SourceDraft>(() => initialDraft(startSource, allowed, pageId ?? null, t))
  const [spec, setSpec] = useState<Draft>(() => {
    if (!initial) return { kind: 'bar' }
    const { source: _s, ...rest } = initial
    return rest
  })
  const [kindTouched, setKindTouched] = useState(!!initial)
  const [titleTouched, setTitleTouched] = useState(!!initial)

  const source: ChartSource | null = useMemo(() => sourceOf(src), [src])
  const table = { labels: spec.labels, seriesIn: spec.seriesIn, unit: spec.unit }
  const live = useChartData(source && source.kind !== 'inline' ? source : null, table)
  const inlineData = useMemo<ChartData | null>(() => {
    if (source?.kind !== 'inline') return null
    if (!inline) return { labels: [], series: [], error: t('charts.err.inline') }
    try {
      const out = inline(source.ref)
      if (out.error) return { labels: [], series: [], error: t('charts.err.sheet', { error: out.error }) }
      return tableToChartData(out.values, table, { lang, seriesName: (n) => t('charts.seriesN', { n }) })
    } catch {
      return { labels: [], series: [], error: t('charts.err.notAvailable') }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, inline, spec.labels, spec.seriesIn, spec.unit, t, lang])
  const data: ChartData = inlineData ?? live.data
  // workspace metrics know their best form; everything else is read from the data
  const suggestion = useMemo(() => (source?.kind === 'system' && metricDef(source.metric) && !data.error ? metricDef(source.metric)!.kind : suggestKind(source ? data : null)), [data, source])
  const kind = kindTouched ? spec.kind : suggestion
  const title = titleTouched ? (spec.title ?? '') : autoTitle(src, t)

  const full: ChartSpec | null = source ? normalizeSpec({ ...spec, kind, title, source }) : null
  const preview: ChartSpec = full ?? { kind, source: { kind: 'manual', rows: [] } }

  const cancel = () => {
    onClose()
    onCancel?.()
  }
  const save = () => {
    if (!full) return
    onClose()
    onSave(full)
  }
  const at = STEPS.indexOf(step)
  const go = (s: BuilderStep) => setStep(s)
  const stepName = (s: BuilderStep) => t(`charts.builder.step.${s}`)

  return (
    <Modal open onClose={cancel} bare width={940} className="chb" ariaLabel={t(initial ? 'charts.builder.edit' : 'charts.builder.new')}>
      <header className="chb__head">
        <span className="label chb__kicker">§ {t('charts.builder.label')}</span>
        <h2 className="chb__title" data-modal-title>
          {t(initial ? 'charts.builder.edit' : 'charts.builder.new')}
        </h2>
        <button type="button" className="icon-btn chb__close" onClick={cancel} aria-label={t('common.close')}>
          <X size={16} />
        </button>
        <nav className="chb__steps" aria-label={t('charts.builder.steps')}>
          {STEPS.map((s, i) => (
            <button key={s} type="button" className="chb__step" aria-current={s === step ? 'step' : undefined} disabled={i > 0 && !source} onClick={() => go(s)}>
              <span className="chb__stepno">{String(i + 1).padStart(2, '0')}</span>
              {stepName(s)}
            </button>
          ))}
        </nav>
      </header>
      <div className={`chb__body chb__body--${step}${source ? '' : ' chb__body--single'}`}>
        <section className="chb__main" aria-label={stepName(step)}>
          {step === 'source' && <SourceStep draft={src} onChange={setSrc} allowed={allowed} pageId={pageId ?? null} />}
          {step === 'type' && (
            <TypeStep
              data={data}
              spec={preview}
              kind={kind}
              suggestion={suggestion}
              onPick={(k) => {
                setKindTouched(true)
                setSpec((s) => ({ ...s, kind: k }))
              }}
            />
          )}
          {step === 'options' && (
            <OptionsStep
              spec={{ ...spec, kind, title }}
              data={data}
              table={source?.kind === 'sheet' || source?.kind === 'manual' || source?.kind === 'inline'}
              onChange={(patch) => {
                if ('title' in patch) setTitleTouched(true)
                if ('kind' in patch) setKindTouched(true)
                setSpec((s) => ({ ...s, kind, ...patch }))
              }}
            />
          )}
        </section>
        {step !== 'type' && source && (
          <aside className="chb__preview" aria-label={t('charts.builder.preview')}>
            <div className="chb__previewhead">
              <span className="label">{t('charts.builder.preview')}</span>
              {!data.error && data.labels.length > 0 && <span className="label faint">{t('charts.builder.points', { n: data.labels.length, s: data.series.length })}</span>}
            </div>
            {title && <div className="chb__previewtitle">{title}</div>}
            <ChartRenderer spec={preview} data={source ? (live.loading && !inlineData && !live.data.labels.length ? { labels: [], series: [], error: t('charts.err.loading') } : data) : { labels: [], series: [] }} height={narrow ? 150 : Math.min(220, preview.height ?? 220)} interactive={false} />
          </aside>
        )}
      </div>
      <footer className="chb__foot">
        <button type="button" className="btn btn--ghost chb__cancel" onClick={cancel}>
          {t('common.cancel')}
        </button>
        <span className="chb__spacer" />
        {at > 0 && (
          <button type="button" className="btn" onClick={() => go(STEPS[at - 1])}>
            {t('common.back')}
          </button>
        )}
        {at < STEPS.length - 1 && (
          <button type="button" className={`btn${at === 0 && !initial && !props.source ? ' btn--primary' : ''}`} disabled={!source} onClick={() => go(STEPS[at + 1])}>
            {t('charts.builder.next')}
          </button>
        )}
        {(at > 0 || !!initial || !!props.source) && (
          <button type="button" className="btn btn--primary" disabled={!full} onClick={save} data-testid="chart-builder-save">
            {t(initial ? 'charts.builder.save' : 'charts.builder.insert')}
          </button>
        )}
      </footer>
    </Modal>
  )
}
