/**
 * CHARTS — public API (re-exported from features/index.ts). Pure SVG, Instrument look, no chart library.
 *
 *  Contract (types.ts): ChartKind 'bar' | 'barH' | 'stacked' | 'line' | 'area' | 'donut' | 'scatter' | 'kpi' |
 *  'sparkline' · ChartData { labels, series[{ name, values, color? }], unit?, error?, labelColors?, axis? } ·
 *  ChartSource sheet | inline | database | system | manual · ChartSpec (kind, title, source, labels, seriesIn,
 *  colors, showValues / showLegend / showGrid, yMin / yMax, unit, decimals, height 160–640).
 *
 *  - ChartRenderer { spec, data, height?, interactive? }: the live chart — hover / keyboard readouts
 *    (← → Home End Esc on the focused plot), "Data table" toggle, empty / error states, responsive.
 *  - useChartData(source, spec?) → { data, loading }: live (sheet, database, system, manual; 'inline' is
 *    passed in by its spreadsheet). resolveChartDataSync / resolveChartData: the same outside React.
 *  - tableToChartData(values: CellValue[][], spec?, { lang, seriesName }?): header row / label column detection.
 *  - openChartBuilder({ initial?, source?, allowedSources?, onSave(spec), onCancel?, step?, pageId?,
 *    inline?(ref) → { values, error? } }): the 3-step builder (data → type → options). For a spreadsheet's
 *    own charts: source { kind: 'inline', ref }, allowedSources ['inline'], inline = its readSheetData.
 *  - chartToSvg(spec, data, { width, height?, theme: 'light' | 'dark' | 'css', title?, background? }) → string.
 *    'css' keeps var(--…) tokens (pages that carry tokens.css); light / dark write one theme in (files).
 *  - chartDomSpec(spec, data): the static SVG as a ProseMirror DOMOutputSpec (the `chart` node's HTML).
 *  - freezeCharts(doc): live sources → the numbers they show (share links, exports — editor stripPrivate()).
 *  - chartMarkdown(spec, data): title + data table · downloadChartPng / downloadChartSvg · copyChartTsv.
 *  - demoCharts(): sample chart specs (manual data) for seed content.
 */
// window.__oneCharts (dev / ?e2e only): pure helpers for unit-level checks
import './testHook'

export * from './types'
export { ChartRenderer, DataTable, type ChartRendererProps } from './render/ChartRenderer'
export { chartToSvg, chartDomSpec, type StaticOptions } from './render/static'
export { formatValue, niceTicks, type Ticks } from './render/scale'
export { themeTokens, resolveVars, currentTheme, type ChartTheme } from './render/palette'
export { normalizeSpec, normalizeSource, suggestKind, kindFits, chartHeight, defaultHeight, looksLikeTime } from './spec'
export { tableToChartData, chartDataToRows, chartDataToTsv, rowsFromText, parseNumber, type TableOptions } from './table'
export { useChartData, resolveChartData, resolveChartDataSync, type ChartDataState } from './data/resolve'
export { openChartBuilder, closeChartBuilder, isChartBuilderOpen, type ChartBuilderOptions, type BuilderStep } from './builder/host'
export { freezeCharts, frozenSpec, CHART_NODE } from './freeze'
export { chartMarkdown, downloadChartPng, downloadChartSvg, copyChartTsv, chartSvgFile, chartPngBlob, chartFileName } from './export'
export { demoCharts } from './demo'
