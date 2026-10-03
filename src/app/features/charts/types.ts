/**
 * Charts — shared contract (charts ⇄ spreadsheet ⇄ editor). See index.ts for the public API.
 * Everything here is plain JSON: a ChartSpec lives in the `chart` block's `spec` attr and in a
 * spreadsheet's `charts` attr; ChartData is what a source resolves to.
 */
import type { ColorName, ID } from '../../store/types'

export type ChartKind = 'bar' | 'barH' | 'stacked' | 'line' | 'area' | 'donut' | 'scatter' | 'kpi' | 'sparkline'

export const CHART_KINDS: ChartKind[] = ['bar', 'barH', 'stacked', 'line', 'area', 'donut', 'scatter', 'kpi', 'sparkline']

/** A computed spreadsheet cell (or a manual-grid cell). */
export type CellValue = number | string | boolean | null

export interface ChartSeries {
  name: string
  values: (number | null)[]
  color?: ColorName
}

export interface ChartData {
  /** categories / x values */
  labels: string[]
  series: ChartSeries[]
  unit?: string
  /** plain-language reason the data is not there (rendered in the frame) */
  error?: string
  /** optional per-label colours (select options, people …): donut slices, single-series bars */
  labelColors?: (ColorName | null)[]
  /** 'time': the labels are consecutive time buckets (line / area suggested, KPI compares the last two) */
  axis?: 'time' | 'category'
}

export type ChartAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'
export const CHART_AGGREGATES: ChartAggregate[] = ['count', 'sum', 'avg', 'min', 'max']

export type DateBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export const DATE_BUCKETS: DateBucket[] = ['day', 'week', 'month', 'quarter', 'year']

export type SystemRange = '7d' | '30d' | '90d' | '12m' | 'all'
export const SYSTEM_RANGES: SystemRange[] = ['7d', '30d', '90d', '12m', 'all']

export type SystemBucket = 'day' | 'week' | 'month'
export const SYSTEM_BUCKETS: SystemBucket[] = ['day', 'week', 'month']

export type ChartSource =
  /** a spreadsheet block anywhere: 'A1:C10', "'Q1'!A1:C10", 'DS(Revenue)', 'DS(A1:A5; C1:C5)' ('' = the active sheet's used range) */
  | { kind: 'sheet'; pageId: ID; sheetBlockId: string; ref: string }
  /** inside a spreadsheet's own `charts` attr (the spreadsheet passes the data in) */
  | { kind: 'inline'; ref: string }
  | {
      kind: 'database'
      databaseId: ID
      viewId?: ID
      /** group by (x axis / slices) */
      x: ID
      /** numeric property for sum / avg / min / max */
      y?: ID
      aggregate: ChartAggregate
      /** split into series by this property (stacked / grouped) */
      series?: ID
      /** date x axis: bucket size (default month) */
      dateBucket?: DateBucket
    }
  | { kind: 'system'; metric: string; range: SystemRange; bucket?: SystemBucket }
  /** first row = headers */
  | { kind: 'manual'; rows: (string | number | null)[][] }

export type ChartSourceKind = ChartSource['kind']

export interface ChartSpec {
  kind: ChartKind
  title?: string
  source: ChartSource
  /** table-like sources (sheet, inline, manual): where the categories are */
  labels?: 'firstColumn' | 'firstRow' | 'none'
  seriesIn?: 'columns' | 'rows'
  colors?: ColorName[]
  /** undefined = selective labels (peak / last value), true = every value that fits, false = none */
  showValues?: boolean
  showLegend?: boolean
  showGrid?: boolean
  yMin?: number
  yMax?: number
  unit?: string
  decimals?: number
  /** 160–640 px */
  height?: number
}

export const MIN_HEIGHT = 160
export const MAX_HEIGHT = 640
