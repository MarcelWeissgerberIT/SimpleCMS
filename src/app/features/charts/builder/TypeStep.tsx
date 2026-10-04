/**
 * Step 02 — every chart type drawn live from the actual data; the suggestion is pre-selected.
 * Without anything to draw yet (no numbers, an error) the cards show a faint sample, marked
 * SAMPLE, and one hint above the grid leads back to step 01.
 */
import { createElement, useMemo, useRef, type KeyboardEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import { useLang, useT } from '../../../i18n'
import { CHART_KINDS, type ChartData, type ChartKind, type ChartSpec } from '../types'
import { kindFits } from '../spec'
import { useSceneText, useWidth } from '../render/ChartRenderer'
import { buildScene } from '../render/scene'
import { reactProps, toReact } from '../render/vnode'

/** Fixed demo values (the "Enter data" sample table): two series, five positive points — every type fits. */
export function sampleData(t: Translate): ChartData {
  const labels = t('charts.manual.sample.rows')
    .split(',')
    .slice(0, 5)
    .map((s) => s.trim())
  return {
    labels,
    series: [
      { name: t('charts.manual.sample.series'), values: [12, 18, 15, 24, 21] },
      { name: t('charts.manual.sample.series2'), values: [9, 16, 17, 20, 23] },
    ],
    axis: 'category',
  }
}

/** Something to draw: at least one value other than 0. */
export function drawable(data: ChartData): boolean {
  return !data.error && data.labels.length > 0 && data.series.some((s) => s.values.some((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0))
}

/** A card's picture: the scene at the card's width, scaled to fit the thumb (nothing is cut off). */
function Thumb({ spec, data, height }: { spec: ChartSpec; data: ChartData; height: number }) {
  const lang = useLang()
  const text = useSceneText()
  const ref = useRef<HTMLSpanElement>(null)
  const width = useWidth(ref)
  const scene = useMemo(() => (width > 0 ? buildScene(spec, data, { width, height, lang, text, compact: true }) : null), [spec, data, width, height, lang, text])
  return (
    <span ref={ref} className="chb-type__thumb" aria-hidden>
      {scene && createElement('svg', { ...reactProps(scene.svg.attrs), focusable: 'false' }, ...scene.svg.children.map((c, i) => (typeof c === 'string' ? c : toReact(c, {}, i))))}
    </span>
  )
}

export function TypeStep({ data, spec, kind, suggestion, manual, onPick, onBack }: { data: ChartData; spec: ChartSpec; kind: ChartKind; suggestion: ChartKind; manual: boolean; onPick: (k: ChartKind) => void; onBack: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const real = drawable(data)
  const sample = useMemo(() => sampleData(t), [t])
  const shown = real ? data : sample
  const hint = real ? null : data.error || t(manual ? 'charts.type.empty.manual' : 'charts.type.empty.live')
  const onKey = (e: KeyboardEvent) => {
    if (!(e.target as HTMLElement).closest('.chb-type')) return
    const cols = Math.max(1, getComputedStyle(ref.current!).gridTemplateColumns.split(' ').length)
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0
    if (!dir) return
    e.preventDefault()
    const at = CHART_KINDS.indexOf(kind)
    const next = CHART_KINDS[Math.max(0, Math.min(CHART_KINDS.length - 1, at + dir))]
    onPick(next)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus())
  }
  return (
    <div className="chb-typestep">
      {hint && (
        <div className="chb-typehint" role="status">
          <p className="chb-typehint__text">
            <span className="chb-typehint__main">{hint}</span>
            <span className="chb-typehint__note">{t('charts.type.sampleNote')}</span>
          </p>
          <button type="button" className="btn btn--sm chb-typehint__key" onClick={onBack} aria-label={t('charts.type.empty.back')} data-testid="chart-type-back">
            <ArrowLeft size={13} strokeWidth={1.75} aria-hidden />
            <span className="chb-typehint__no">01</span>
            {t('charts.builder.step.source')}
          </button>
        </div>
      )}
      <div ref={ref} className={`chb-types${real ? '' : ' is-sample'}`} role="radiogroup" aria-label={t('charts.block.type')} onKeyDown={onKey}>
        {CHART_KINDS.map((k) => {
          const fits = !real || kindFits(k, data)
          const on = k === kind
          const suggested = real && k === suggestion
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-kind={k}
              data-autofocus={on || undefined}
              className={`chb-type${fits ? '' : ' is-misfit'}${suggested ? ' is-suggested' : ''}${real ? '' : ' is-sample'}`}
              title={fits ? undefined : t('charts.type.misfit')}
              onClick={() => onPick(k)}
            >
              <Thumb spec={{ ...spec, kind: k, title: undefined, showGrid: false, showValues: false, showLegend: false, ...(real ? {} : { unit: undefined, colors: undefined }) }} data={shown} height={k === 'kpi' || k === 'sparkline' ? 92 : 96} />
              <span className="chb-type__name">
                <span className={`led${on ? ' led--on' : ''}`} aria-hidden />
                <span className="chb-type__kind">{t(`charts.kind.${k}`)}</span>
                {suggested && <span className="chb-type__tag">{t('charts.type.suggested')}</span>}
              </span>
              {!real && (
                <span className="chb-type__sample" aria-hidden>
                  {t('charts.type.sample')}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
