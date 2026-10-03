/**
 * Chart block: `chart` (atom; attrs: spec = ChartSpec JSON, see features/charts/types.ts).
 * The renderer, the sources and the builder live in features/charts; this file is the schema:
 *  - HTML: <figure data-type="chart" data-spec="…"> + the static SVG (design-token colours, so
 *    exported pages follow the reader's theme) and the title as <figcaption>
 *  - Markdown: the title (bold) + the chart's data as a table · plain text: the title
 *  - a chart inserted from the slash menu opens the builder (consumeFreshChart)
 */
import { Node, mergeAttributes, type Editor, type Range } from '@tiptap/core'
import { t } from '../../i18n'
import { chartDomSpec, chartMarkdown, normalizeSpec, resolveChartDataSync, type ChartSpec } from '../../features/charts'
import { insertBlock } from '../lib/blocks'

export const CHART = 'chart'

export function chartSpecOf(attrs: Record<string, unknown> | null | undefined): ChartSpec | null {
  return normalizeSpec(attrs?.spec)
}

/* ---------------- fresh charts (slash menu → builder) ---------------- */

let fresh: { editor: Editor; until: number } | null = null

/** True once, for the first unconfigured chart mounted in that editor right after the insert. */
export function consumeFreshChart(editor: Editor): boolean {
  if (!fresh || fresh.editor !== editor || Date.now() > fresh.until) return false
  fresh = null
  return true
}

export function insertChart(editor: Editor, range?: Range | null): void {
  fresh = { editor, until: Date.now() + 1500 }
  insertBlock(editor, { type: CHART, attrs: { spec: null } }, range)
}

/* ---------------- node ---------------- */

export const ChartNode = Node.create({
  name: CHART,
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      spec: {
        default: null,
        parseHTML: (el: HTMLElement) => normalizeSpec(el.getAttribute('data-spec')),
        renderHTML: (a: Record<string, unknown>) => {
          const spec = normalizeSpec(a.spec)
          return spec ? { 'data-spec': JSON.stringify(spec) } : {}
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="chart"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const spec = chartSpecOf(node.attrs)
    const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'chart', class: 'chart-figure' })
    if (!spec) return ['figure', attrs, ['figcaption', { class: 'chart-figure__title' }, t('charts.block.label')]]
    let svg: unknown
    try {
      svg = chartDomSpec(spec, resolveChartDataSync(spec.source, spec))
    } catch (err) {
      console.warn('[editor] chart render failed', err)
      svg = ['p', {}, t('charts.err.notAvailable')]
    }
    const out: unknown[] = ['figure', attrs]
    if (spec.title) out.push(['figcaption', { class: 'chart-figure__title' }, spec.title])
    out.push(svg)
    return out as never
  },
  renderText({ node }) {
    return chartSpecOf(node.attrs)?.title || t('charts.block.label')
  },
  renderMarkdown(node) {
    const spec = chartSpecOf(node.attrs)
    return chartMarkdown(spec, spec ? resolveChartDataSync(spec.source, spec) : null)
  },
})
