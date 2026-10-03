/** Test hook (dev, or ?e2e): pure chart helpers for unit-level checks from Playwright (window.__oneCharts). */
import { niceTicks, formatValue } from './render/scale'
import { tableToChartData, parseNumber } from './table'
import { suggestKind, normalizeSpec } from './spec'
import { chartToSvg } from './render/static'
import { freezeCharts } from './freeze'
import { openChartBuilder } from './builder/host'

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneCharts?: unknown }).__oneCharts = { niceTicks, formatValue, tableToChartData, parseNumber, suggestKind, normalizeSpec, chartToSvg, freezeCharts, openChartBuilder }
}
