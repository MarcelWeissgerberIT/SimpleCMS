/**
 * The active sheet's charts, as cards under its grid (2-up on wide blocks): live with the cells.
 * Card menu: edit, duplicate, delete, place as a `chart` block below the spreadsheet (source: this
 * block's cells, by page + block id).
 */
import { useMemo } from 'react'
import { Ellipsis } from 'lucide-react'
import { ChartRenderer } from '../../charts'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { chartSpec, sheetChartData } from '../charts'
import type { SheetChart, SpreadsheetAttrs } from '../model'

export interface ChartsProps {
  attrs: SpreadsheetAttrs
  sheetId: string
  /** bumps when values changed */
  version: number
  editable: boolean
  lang: 'en' | 'de'
  t: (key: string, vars?: Record<string, string | number>) => string
  onEdit: (chart: SheetChart) => void
  onDuplicate: (chart: SheetChart) => void
  onDelete: (chart: SheetChart) => void
  onPlace: (chart: SheetChart) => void
}

function Card({ chart, p }: { chart: SheetChart; p: ChartsProps }) {
  const menu = useMenu()
  const spec = chartSpec(chart)
  const data = useMemo(() => sheetChartData(p.attrs, chart, p.lang), [p.attrs, chart, p.lang, p.version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!spec) return null
  const entries: MenuEntry[] = [
    { label: p.t('features.sheets.chart.edit'), disabled: !p.editable, onSelect: () => p.onEdit(chart) },
    { label: p.t('features.sheets.chart.duplicate'), disabled: !p.editable, onSelect: () => p.onDuplicate(chart) },
    { label: p.t('features.sheets.chart.place'), disabled: !p.editable, onSelect: () => p.onPlace(chart) },
    { kind: 'separator' },
    { label: p.t('features.sheets.chart.delete'), danger: true, disabled: !p.editable, onSelect: () => p.onDelete(chart) },
  ]
  return (
    <figure className="sh-chart" data-chart={chart.id}>
      <figcaption className="sh-chart__head">
        <span className="sh-chart__title">{spec.title || p.t('features.sheets.chart')}</span>
        <span className="sh-chart__ref label">{spec.source.kind === 'inline' ? spec.source.ref : ''}</span>
        <button type="button" className="sh-chart__menu" aria-label={p.t('features.sheets.chart.menu')} title={p.t('features.sheets.chart.menu')} onClick={menu.toggle}>
          <Ellipsis size={14} strokeWidth={1.75} />
        </button>
      </figcaption>
      <ChartRenderer spec={spec} data={data} />
      <Menu {...menu.props} placement="bottom-end" entries={entries} />
    </figure>
  )
}

export function Charts(p: ChartsProps) {
  const list = p.attrs.charts.filter((c) => c.sheet === p.sheetId)
  if (!list.length) return null
  return (
    <section className="sh-charts" aria-label={p.t('features.sheets.charts', { n: list.length })}>
      <div className="sh-charts__label label">{p.t('features.sheets.charts', { n: String(list.length).padStart(2, '0') })}</div>
      <div className="sh-charts__grid">
        {list.map((c) => (
          <Card key={c.id} chart={c} p={p} />
        ))}
      </div>
    </section>
  )
}
