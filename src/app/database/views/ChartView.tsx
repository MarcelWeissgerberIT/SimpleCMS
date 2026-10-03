/**
 * Chart view: grouped by a property, count / sum / average, drawn by the shared chart renderer
 * (features/charts — the same picture as a `chart` block): bar, line, area, donut, stacked
 * (split by a second property), KPI. Instrument styling: mono axis labels, hairline grid, hover
 * and keyboard readouts, and a data table under the plot (legend + accessible values).
 */
import { useMemo, useState } from 'react'
import { ChartArea, ChartColumn, ChartColumnStacked, ChartLine, ChartPie, Gauge } from 'lucide-react'
import type { ChartConfig, PropertyDef, PropertyType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { ChartRenderer, formatChartValue, type ChartData, type ChartSpec } from '../../features'
import { useModel } from '../hooks'
import { Segmented, Select, TypeIcon } from '../parts'
import { formatCount, formatNumber } from '../model/format'
import { isNumberType } from '../model/schema'
import { databaseChartData, chartGroupable, type DatabaseChartBucket } from '../model/chartData'
import { usePropertyCreate } from '../create/entry'
import './chart.css'

/** Types a new property for an axis may have: anything to group by (x) · numbers (y). */
const CHART_X_TYPES: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'rating', 'url', 'email', 'phone', 'relation', 'formula', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id']
const CHART_Y_TYPES: PropertyType[] = ['number', 'rating', 'formula']
const DATE_TYPES = new Set(['date', 'created_time', 'last_edited_time'])
const BUCKETS: DatabaseChartBucket[] = ['day', 'week', 'month', 'quarter', 'year']
const KINDS: ChartConfig['kind'][] = ['bar', 'stacked', 'line', 'area', 'donut', 'kpi']

export default function ChartView() {
  const t = useT()
  const m = useModel()
  const lang = m.resolver.ctx.lang
  const cfg: ChartConfig = m.view.chart ?? { kind: 'bar', xPropertyId: null, aggregate: 'count' }
  const upd = (patch: Partial<ChartConfig>) => {
    if (!m.fixed) useWorkspace.getState().updateView(m.db.id, m.view.id, { chart: { ...cfg, ...patch } })
  }
  const xProp = cfg.xPropertyId ? m.propMap.get(cfg.xPropertyId) : undefined
  const yProp = cfg.yPropertyId ? m.propMap.get(cfg.yPropertyId) : undefined
  const sProp = cfg.seriesPropertyId ? m.propMap.get(cfg.seriesPropertyId) : undefined
  const numericProps = m.db.properties.filter((p) => isNumberType(p.type) || p.type === 'formula' || p.type === 'rollup')
  const groupable = m.db.properties.filter(chartGroupable)
  // axes can ask for a property that isn't there yet
  const createX = usePropertyCreate(m.db, { types: CHART_X_TYPES })
  const createY = usePropertyCreate(m.db, { types: CHART_Y_TYPES })
  const [hover, setHover] = useState<number | null>(null)

  const measure = cfg.aggregate !== 'count' && yProp
  // the rows this view shows (its filters + the search), grouped by x, optionally split
  const data: ChartData = useMemo(() => {
    if (!xProp) return { labels: [], series: [] }
    const r = databaseChartData(
      {
        databaseId: m.db.id,
        x: xProp.id,
        y: yProp?.id,
        aggregate: measure ? (cfg.aggregate === 'average' ? 'avg' : 'sum') : 'count',
        series: sProp && cfg.kind !== 'donut' && cfg.kind !== 'kpi' ? sProp.id : undefined,
        dateBucket: cfg.dateBucket,
      },
      m.rows,
    )
    const name = measure ? `${t(`database.chart.agg.${cfg.aggregate}`)} · ${yProp!.name}` : t('database.chart.records')
    return { labels: r.labels, series: r.series.map((s) => ({ ...s, name: s.name || name })), axis: r.axis, ...(r.labelColors ? { labelColors: r.labelColors } : {}), ...(r.unit ? { unit: r.unit } : {}) }
  }, [xProp, yProp, sProp, measure, cfg.aggregate, cfg.kind, cfg.dateBucket, m.rows, m.db.id, t])
  const spec: ChartSpec = useMemo(() => ({ kind: cfg.kind, source: { kind: 'manual', rows: [] }, height: 300 }), [cfg.kind])

  /** Over all shown records (not over groups: multi-value groupings count a row more than once). */
  const overall = useMemo(() => {
    if (!measure) return m.rows.length
    const nums = m.rows.map((r) => m.resolver.value(m.db, yProp!, r)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!nums.length) return 0
    const sum = nums.reduce((acc, x) => acc + x, 0)
    return cfg.aggregate === 'sum' ? sum : sum / nums.length
  }, [measure, cfg.aggregate, yProp, m])
  const share = cfg.aggregate !== 'average'
  const fmt = (v: number | null) => (v === null ? '—' : measure && yProp?.type === 'number' ? formatNumber(Math.round(v * 100) / 100, yProp.numberFormat, lang) : formatCount(v, lang, 2))
  const single = data.series.length <= 1
  const values = data.series[0]?.values ?? []
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0)
  // the table mirrors the picture's points (a donut only has its slices — it lists them itself)
  const tableRows = cfg.kind !== 'donut' && cfg.kind !== 'kpi' && single

  const controls = (
    <div className="dbch-controls">
      <Segmented
        value={cfg.kind}
        ariaLabel={t('database.chart.kind')}
        items={KINDS.map((k) => ({
          value: k,
          label: k === 'bar' || k === 'line' || k === 'donut' ? t(`database.chart.${k}`) : t(`charts.kind.${k}`),
          icon: { bar: <ChartColumn size={13} />, stacked: <ChartColumnStacked size={13} />, line: <ChartLine size={13} />, area: <ChartArea size={13} />, donut: <ChartPie size={13} />, kpi: <Gauge size={13} /> }[k],
        }))}
        onChange={(kind) => upd({ kind })}
        disabled={m.fixed}
      />
      <span className="dbch-field">
        <span className="label">{t('database.chart.x')}</span>
        <Select
          value={cfg.xPropertyId ?? null}
          placeholder={t('database.rollup.pick')}
          searchable
          items={groupable.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
          onChange={(v) => upd({ xPropertyId: v, seriesPropertyId: cfg.seriesPropertyId === v ? null : cfg.seriesPropertyId })}
          create={m.fixed ? undefined : (q) => createX(q, (p) => upd({ xPropertyId: p.id }))}
          disabled={m.fixed}
        />
      </span>
      <span className="dbch-field">
        <span className="label">{t('database.chart.y')}</span>
        <Segmented
          value={cfg.aggregate}
          items={(['count', 'sum', 'average'] as const).map((a) => ({ value: a, label: t(`database.chart.agg.${a}`) }))}
          onChange={(aggregate) => upd({ aggregate, yPropertyId: aggregate !== 'count' ? cfg.yPropertyId ?? numericProps[0]?.id ?? null : cfg.yPropertyId })}
          disabled={m.fixed}
        />
        {cfg.aggregate !== 'count' && (
          <Select
            value={cfg.yPropertyId ?? null}
            placeholder={t('database.rollup.pick')}
            items={numericProps.map((p: PropertyDef) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
            onChange={(v) => upd({ yPropertyId: v })}
            create={m.fixed ? undefined : (q) => createY(q, (p) => upd({ yPropertyId: p.id }))}
            disabled={m.fixed}
          />
        )}
      </span>
      {cfg.kind !== 'donut' && cfg.kind !== 'kpi' && (
        <span className="dbch-field">
          <span className="label">{t('charts.db.series')}</span>
          <Select
            value={cfg.seriesPropertyId ?? '__none'}
            items={[{ value: '__none', label: t('charts.db.noSplit') }, ...groupable.filter((p) => p.id !== cfg.xPropertyId).map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))]}
            onChange={(v) => upd({ seriesPropertyId: v === '__none' ? null : v })}
            disabled={m.fixed}
          />
        </span>
      )}
      {xProp && DATE_TYPES.has(xProp.type) && (
        <span className="dbch-field">
          <span className="label">{t('charts.db.bucket')}</span>
          <Select value={cfg.dateBucket ?? 'month'} items={BUCKETS.map((b) => ({ value: b, label: t(`charts.bucket.${b}`) }))} onChange={(v) => upd({ dateBucket: v })} disabled={m.fixed} />
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span className="dbch-total">
        <span className="label">{cfg.aggregate === 'count' ? t('database.chart.records') : t(`database.chart.agg.${cfg.aggregate}`)}</span>
        <span className="dbch-total__num">{fmt(overall)}</span>
      </span>
    </div>
  )

  if (!xProp)
    return (
      <div className="dbch">
        {controls}
        <div className="db-empty">
          <span className="db-empty__line" />
          <span className="label">{t('database.chart.pickX')}</span>
          <span className="db-empty__line" />
        </div>
      </div>
    )

  const empty = !data.labels.length || data.series.every((s) => s.values.every((v) => !v))
  return (
    <div className="dbch">
      {controls}
      <div className="dbch-plot">
        {empty ? (
          <div className="db-empty">
            <span className="db-empty__line" />
            <span className="label">{t('database.chart.noData')}</span>
            <span className="db-empty__line" />
          </div>
        ) : (
          <ChartRenderer spec={spec} data={data} className="dbch-chart" markClass="dbch-bar" tableToggle={!tableRows} active={tableRows ? hover : undefined} onActiveChange={tableRows ? setHover : undefined} />
        )}
      </div>
      {tableRows && !empty && (
        <table className="dbch-table">
          <thead>
            <tr>
              <th>{xProp.name}</th>
              <th className="num">{cfg.aggregate === 'count' ? t('database.chart.records') : `${t(`database.chart.agg.${cfg.aggregate}`)} · ${yProp?.name ?? ''}`}</th>
              {share && <th className="num">%</th>}
            </tr>
          </thead>
          <tbody>
            {data.labels.map((label, i) => (
              <tr key={i} data-hover={hover === i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <td>{label}</td>
                <td className="num">{formatChartValue(values[i] ?? null, { lang, unit: data.unit })}</td>
                {share && <td className="num">{total ? `${formatCount(((values[i] ?? 0) / total) * 100, lang, 1)}%` : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
