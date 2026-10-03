/**
 * Charts leaving the workspace (share links, exports, the website, AI input): a live source
 * (database / spreadsheet / workspace metric — ids into this workspace) is replaced by the
 * numbers it shows right now (a manual table), so the chart renders anywhere and nothing
 * points back into the workspace.
 */
import type { JSONContent } from '@tiptap/core'
import { normalizeSpec } from './spec'
import { chartDataToRows } from './table'
import { resolveChartDataSync } from './data/resolve'
import type { ChartSpec } from './types'

export const CHART_NODE = 'chart'

/** A spec whose data travels with it. */
export function frozenSpec(spec: ChartSpec): ChartSpec {
  if (spec.source.kind === 'manual') return spec
  const data = resolveChartDataSync(spec.source, spec)
  const rows = data.error ? [] : chartDataToRows(data)
  const colors = spec.colors ?? (data.series.length && data.series.every((s) => s.color) ? data.series.map((s) => s.color!) : undefined)
  const out: ChartSpec = { ...spec, source: { kind: 'manual', rows }, labels: 'firstColumn', seriesIn: 'columns' }
  if (colors) out.colors = colors
  if (!spec.unit && data.unit) out.unit = data.unit
  return out
}

export function freezeCharts(doc: JSONContent): JSONContent {
  let changed = false
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === CHART_NODE) {
      const spec = normalizeSpec(n.attrs?.spec)
      if (!spec || spec.source.kind === 'manual') return n
      changed = true
      return { ...n, attrs: { ...n.attrs, spec: frozenSpec(spec) } }
    }
    if (!n.content) return n
    const kids = n.content.map(walk)
    return kids.some((k, i) => k !== n.content![i]) ? { ...n, content: kids } : n
  }
  const out = walk(doc)
  return changed ? out : doc
}
