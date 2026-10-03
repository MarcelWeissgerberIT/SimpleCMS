/**
 * Sample charts for seed content (manual data, so they work on any workspace). The lead can drop
 * `{ type: 'chart', attrs: { spec } }` blocks built from these into seeded pages.
 */
import type { ChartSpec } from './types'

export function demoCharts(lang: 'en' | 'de' = 'en'): ChartSpec[] {
  const de = lang === 'de'
  const months = de ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  return [
    {
      kind: 'bar',
      title: de ? 'Umsatz und Kosten' : 'Revenue and costs',
      unit: '€',
      source: {
        kind: 'manual',
        rows: [
          [de ? 'Monat' : 'Month', de ? 'Umsatz' : 'Revenue', de ? 'Kosten' : 'Costs'],
          ...months.map((m, i) => [m, [12400, 15100, 14200, 18900, 21300, 24800][i], [9800, 10400, 11900, 12100, 12600, 13900][i]]),
        ],
      },
    },
    {
      kind: 'kpi',
      title: de ? 'Aktive Nutzer' : 'Active users',
      source: { kind: 'manual', rows: [[de ? 'Monat' : 'Month', de ? 'Nutzer' : 'Users'], ...months.map((m, i) => [m, [820, 910, 1040, 1180, 1215, 1392][i]])] },
    },
  ]
}
