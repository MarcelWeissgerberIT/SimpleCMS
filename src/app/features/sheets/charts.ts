/**
 * The spreadsheet's own charts (attr `charts`): their data comes from the block's cells, live.
 * Pure parts of the charts module only (spec sanitizer, table → chart data, static SVG): this file
 * is reached from the editor schema (exports) and must stay free of UI.
 */
import { normalizeSpec } from '../charts/spec'
import { tableToChartData } from '../charts/table'
import type { ChartData, ChartSpec } from '../charts/types'
import { rewriteRefs } from './engine'
import { readSheetData } from './compute'
import type { SheetChart, SpreadsheetAttrs } from './model'

/** The chart's spec, sanitized (null when it isn't a chart). */
export const chartSpec = (c: SheetChart): ChartSpec | null => normalizeSpec(c.spec)

/** The chart's data from the block's cells (its unqualified refs read the chart's sheet). */
export function sheetChartData(attrs: SpreadsheetAttrs, chart: SheetChart, lang: 'en' | 'de'): ChartData {
  const spec = chartSpec(chart)
  const ref = spec && spec.source.kind === 'inline' ? spec.source.ref : ''
  const res = readSheetData(attrs, ref, { lang, sheetId: chart.sheet })
  if (res.error) return { labels: [], series: [], error: res.error }
  return tableToChartData(res.values, spec ?? {}, { lang })
}

/** A chart ref with every unqualified reference qualified by its sheet ('A1:B4' → "'Q1'!A1:B4"). */
export function qualifiedRef(attrs: SpreadsheetAttrs, chart: SheetChart, ref: string): string {
  const name = attrs.sheets.find((s) => s.id === chart.sheet)?.name
  if (!name) return ref
  return rewriteRefs(ref, (t) => (t.sheet === null ? { ...t, sheet: name } : undefined))
}
