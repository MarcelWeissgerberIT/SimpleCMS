/** Step 03 — title, categories, colours, legend, value labels, grid, unit / decimals, axis range, height. */
import { useT } from '../../../i18n'
import { COLOR_NAMES, type ColorName } from '../../../store/types'
import type { ChartData, ChartSpec } from '../types'
import { chartHeight, clampHeight } from '../spec'
import { colorVar, seriesColor } from '../render/palette'
import { Field, Seg, Select } from './controls'
import type { Draft } from './ChartBuilder'

type Tri = 'auto' | 'on' | 'off'
const tri = (v: boolean | undefined): Tri => (v === undefined ? 'auto' : v ? 'on' : 'off')
const fromTri = (v: Tri): boolean | undefined => (v === 'auto' ? undefined : v === 'on')

function numOrUndef(s: string): number | undefined {
  const v = Number(s.replace(',', '.'))
  return s.trim() && Number.isFinite(v) ? v : undefined
}

export function OptionsStep({ spec, data, table, onChange }: { spec: Draft; data: ChartData; table: boolean; onChange: (patch: Partial<ChartSpec>) => void }) {
  const t = useT()
  const donut = spec.kind === 'donut'
  const xy = !['donut', 'kpi', 'sparkline'].includes(spec.kind)
  // donuts colour categories, everything else colours series
  const keys = donut ? data.labels.slice(0, 6) : data.series.map((s) => s.name).slice(0, 8)
  // spec.colors is positional; 'default' = automatic (the series order)
  const setColor = (i: number, c: ColorName | null) => {
    const colors: ColorName[] = [...(spec.colors ?? [])]
    while (colors.length <= i) colors.push('default')
    colors[i] = c ?? 'default'
    while (colors.length && colors[colors.length - 1] === 'default') colors.pop()
    onChange({ colors: colors.length ? colors : undefined })
  }
  const explicit = (i: number): ColorName | null => (spec.colors?.[i] && spec.colors[i] !== 'default' ? spec.colors[i] : null)
  return (
    <div className="chb-options">
      <Field label={t('charts.opt.title')} wide>
        {(id) => <input id={id} className="input" value={spec.title ?? ''} placeholder={t('charts.opt.titlePlaceholder')} maxLength={160} onChange={(e) => onChange({ title: e.target.value })} data-autofocus />}
      </Field>
      {table && (
        <Field label={t('charts.opt.labels')} wide>
          {() => (
            <Seg
              label={t('charts.opt.labels')}
              size="sm"
              value={spec.labels ?? 'auto'}
              items={(['auto', 'firstColumn', 'firstRow', 'none'] as const).map((v) => ({ value: v, label: t(`charts.opt.labels.${v}`) }))}
              onChange={(v) => onChange(v === 'auto' ? { labels: undefined, seriesIn: undefined } : { labels: v, seriesIn: v === 'firstRow' ? 'rows' : 'columns' })}
            />
          )}
        </Field>
      )}
      {keys.length > 0 && spec.kind !== 'kpi' && (
        <Field label={t('charts.opt.colors')} wide>
          {() => (
            <div className="chb-colors">
              {keys.map((name, i) => (
                <div className="chb-colors__row" key={i}>
                  <span className="chb-colors__name">{name}</span>
                  <span className="chb-swatches" role="group" aria-label={name}>
                    <button type="button" className="chb-swatch chb-swatch--auto" aria-pressed={!explicit(i)} aria-label={t('charts.opt.color.pick', { series: name, color: t('charts.opt.color.auto') })} onClick={() => setColor(i, null)}>
                      <i style={{ background: donut ? undefined : seriesColor(i) }} />
                    </button>
                    {COLOR_NAMES.filter((c) => c !== 'orange' && c !== 'default').map((c) => (
                      <button key={c} type="button" className="chb-swatch" aria-pressed={explicit(i) === c} aria-label={t('charts.opt.color.pick', { series: name, color: t(`color.${c}`) })} onClick={() => setColor(i, c)}>
                        <i style={{ background: colorVar(c) }} />
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Field>
      )}
      <div className="chb-grid3">
        {xy && (
          <Field label={t('charts.opt.legend')}>
            {() => <Seg label={t('charts.opt.legend')} size="sm" value={tri(spec.showLegend)} items={(['auto', 'on', 'off'] as const).map((v) => ({ value: v, label: t(`charts.opt.${v}`) }))} onChange={(v) => onChange({ showLegend: fromTri(v) })} />}
          </Field>
        )}
        {xy && (
          <Field label={t('charts.opt.values')}>
            {() => (
              <Seg
                label={t('charts.opt.values')}
                size="sm"
                value={tri(spec.showValues)}
                items={[
                  { value: 'auto' as const, label: t('charts.opt.values.key') },
                  { value: 'on' as const, label: t('charts.opt.values.all') },
                  { value: 'off' as const, label: t('charts.opt.values.none') },
                ]}
                onChange={(v) => onChange({ showValues: fromTri(v) })}
              />
            )}
          </Field>
        )}
        {xy && (
          <Field label={t('charts.opt.grid')}>
            {() => <Seg label={t('charts.opt.grid')} size="sm" value={spec.showGrid === false ? 'off' : 'on'} items={(['on', 'off'] as const).map((v) => ({ value: v, label: t(`charts.opt.${v}`) }))} onChange={(v) => onChange({ showGrid: v === 'off' ? false : undefined })} />}
          </Field>
        )}
        <Field label={t('charts.opt.unit')}>
          {(id) => <input id={id} className="input" value={spec.unit ?? ''} placeholder={data.unit || t('charts.opt.unitPlaceholder')} maxLength={12} onChange={(e) => onChange({ unit: e.target.value || undefined })} />}
        </Field>
        <Field label={t('charts.opt.decimals')}>
          {(id) => (
            <Select
              id={id}
              value={spec.decimals === undefined ? '' : String(spec.decimals)}
              onChange={(v) => onChange({ decimals: v === '' ? undefined : Number(v) })}
              options={[{ value: '', label: t('charts.opt.auto') }, ...[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))]}
            />
          )}
        </Field>
        {xy && spec.kind !== 'scatter' && (
          <Field label={t('charts.opt.yMin')}>
            {(id) => <input id={id} className="input chb-mono" inputMode="decimal" defaultValue={spec.yMin ?? ''} placeholder={t('charts.opt.auto')} onChange={(e) => onChange({ yMin: numOrUndef(e.target.value) })} />}
          </Field>
        )}
        {xy && spec.kind !== 'scatter' && (
          <Field label={t('charts.opt.yMax')}>
            {(id) => <input id={id} className="input chb-mono" inputMode="decimal" defaultValue={spec.yMax ?? ''} placeholder={t('charts.opt.auto')} onChange={(e) => onChange({ yMax: numOrUndef(e.target.value) })} />}
          </Field>
        )}
      </div>
      <Field label={`${t('charts.opt.height')} · ${chartHeight(spec)} px`} wide>
        {(id) => (
          <input
            id={id}
            className="chb-range"
            type="range"
            min={160}
            max={640}
            step={20}
            value={chartHeight(spec)}
            onChange={(e) => onChange({ height: clampHeight(Number(e.target.value)) })}
          />
        )}
      </Field>
    </div>
  )
}
