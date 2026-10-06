/**
 * A chart in the diagram viewer (ui/viewer): drawn again for the viewer's canvas — wider and taller, the labels
 * keep their size, so they stay readable — with CSS-variable colours (it follows the theme by itself).
 * Download SVG writes the current theme in, at the size the viewer drew.
 */
import { t } from '../../i18n'
import { openDiagramViewer, type ViewerOptions } from '../../ui/viewer'
import type { ChartData, ChartSpec } from './types'
import { chartToSvg } from './render/static'
import { currentTheme } from './render/palette'
import { chartHeight } from './spec'
import { chartFileName } from './export'
import { resolveChartData } from './data/resolve'

/** the viewer's margin around a fitted drawing (ui/viewer/view.ts PAD) */
const PAD = 32

/** Width and plot height for a canvas of `stage` px. */
export function chartViewerSize(spec: ChartSpec, stage: { w: number; h: number }): { width: number; height: number } {
  const width = Math.round(Math.max(320, Math.min(1600, stage.w - 2 * PAD)))
  if (spec.kind === 'kpi' || spec.kind === 'sparkline') return { width, height: chartHeight(spec) }
  // room for the legend above the plot; a tall canvas (a phone) gets a square plot rather than a strip
  const room = stage.h - 2 * PAD - 64
  return { width, height: Math.round(Math.max(160, Math.min(room, 720, Math.max(width * 0.56, Math.min(width, room))))) }
}

/** Open a chart in the viewer. `data`: what the chart shows now (resolved from its source when absent). */
export function openChartViewer(spec: ChartSpec, data?: ChartData | null, opts: ViewerOptions = {}): void {
  let got: ChartData | null = data ?? null
  const dataOf = async () => (got ??= await resolveChartData(spec.source, spec))
  let size = { width: 880, height: chartHeight(spec) }
  openDiagramViewer(
    {
      kind: 'chart',
      type: t(`charts.kind.${spec.kind}`),
      title: spec.title?.trim() || undefined,
      fileName: chartFileName(spec, 'svg'),
      render: async (stage) => {
        const d = await dataOf()
        size = chartViewerSize(spec, stage)
        return chartToSvg(spec, d, { ...size, theme: 'css', title: false, background: false })
      },
      file: async () => chartToSvg(spec, await dataOf(), { ...size, theme: currentTheme() }),
    },
    opts,
  )
}
