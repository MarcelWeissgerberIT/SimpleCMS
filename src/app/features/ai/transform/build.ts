/**
 * "Transform into …" — a result as TipTap JSON, built by code (never HTML from Claude):
 *  - diagram → one `mermaid` block (the direction applied)
 *  - chart → one `chart` block with a manual-source ChartSpec (labels × series, unit), checked by normalizeSpec
 *  - columns → `columns` of `column`s (an H3 + the lines) · tabs → `tabs` of `tab`s · toggles → `details`
 *    blocks · cards → `callout`s in rows of `columns` (2–3 per row)
 * Lines are inline Markdown (bold, italic, code, links) read by the editor's own converter.
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../../editor'
import { normalizeSpec, type ChartSpec } from '../../charts'
import { withDirection } from './mermaid'
import type { BlockResult, ChartPlan, Section, SectionItem, TransformChartKind, TransformOpts } from './types'

const text = (s: string): JSONContent => ({ type: 'text', text: s })
/** inline nodes a line may keep (a stray image or embed of the converter is left out) */
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])

/** A line of inline Markdown as inline nodes (the first text block the converter makes of it). */
export function inline(md: string): JSONContent[] {
  const src = md.replace(/\s*\n\s*/g, ' ').trim()
  if (!src) return []
  try {
    const walk = (n: JSONContent): JSONContent[] | null => {
      if ((n.type === 'paragraph' || n.type === 'heading') && n.content?.length) return n.content.filter((c) => INLINE.has(c.type ?? ''))
      for (const c of n.content ?? []) {
        const hit = walk(c)
        if (hit) return hit
      }
      return null
    }
    const found = walk(markdownToDoc(src))
    if (found?.length) return found
  } catch {
    /* plain text below */
  }
  return [text(src)]
}

export const paragraph = (md: string): JSONContent => {
  const content = inline(md)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** The lines as blocks: runs of bullets / numbers / to-dos become one list each, sentences paragraphs. */
export function itemBlocks(items: SectionItem[]): JSONContent[] {
  const out: JSONContent[] = []
  let list: JSONContent | null = null
  let style: SectionItem['style'] | null = null
  for (const it of items) {
    if (it.style === 'text') {
      list = null
      style = null
      out.push(paragraph(it.text))
      continue
    }
    if (!list || style !== it.style) {
      list = it.style === 'bullet' ? { type: 'bulletList', content: [] } : it.style === 'number' ? { type: 'orderedList', attrs: { start: 1 }, content: [] } : { type: 'taskList', content: [] }
      style = it.style
      out.push(list)
    }
    list.content!.push(it.style === 'task' ? { type: 'taskItem', attrs: { checked: it.done }, content: [paragraph(it.text)] } : { type: 'listItem', content: [paragraph(it.text)] })
  }
  return out
}

const orEmpty = (blocks: JSONContent[]): JSONContent[] => (blocks.length ? blocks : [{ type: 'paragraph' }])

/** Card rows: up to 3 per row, balanced (4 → 2 + 2, 5 → 3 + 2, 7 → 3 + 2 + 2). */
export function cardRows(n: number): number[] {
  if (n <= 3) return [n]
  const per = n === 4 ? 2 : 3
  const rows = Math.ceil(n / per)
  return Array.from({ length: rows }, (_, i) => Math.floor(n / rows) + (i < n % rows ? 1 : 0))
}

const DEFAULT_CARD_ICON = '📌'

function sectionsJSON(of: Extract<BlockResult, { type: 'sections' }>['of'], sections: Section[]): JSONContent[] {
  switch (of) {
    case 'columns':
      return [
        {
          type: 'columns',
          content: sections.map((s) => ({ type: 'column', content: orEmpty([...(s.title ? [{ type: 'heading', attrs: { level: 3 }, content: inline(s.title) }] : []), ...itemBlocks(s.items)]) })),
        },
      ]
    case 'tabs':
      return [{ type: 'tabs', content: sections.map((s) => ({ type: 'tab', attrs: { title: s.title }, content: orEmpty(itemBlocks(s.items)) })) }]
    case 'toggles':
      return sections.map((s) => ({
        type: 'details',
        content: [
          { type: 'detailsSummary', content: inline(s.title) },
          { type: 'detailsContent', content: orEmpty(itemBlocks(s.items)) },
        ],
      }))
    case 'cards': {
      const card = (s: Section): JSONContent => ({
        type: 'callout',
        attrs: { icon: s.icon ?? DEFAULT_CARD_ICON, color: 'gray' },
        content: [...(s.title ? [{ type: 'paragraph', content: inline(s.title).map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []).filter((m) => m.type !== 'bold'), { type: 'bold' }] } : n)) }] : []), ...itemBlocks(s.items)].filter(Boolean),
      })
      const out: JSONContent[] = []
      let i = 0
      for (const size of cardRows(sections.length)) {
        const row = sections.slice(i, i + size)
        i += size
        out.push(size === 1 ? card(row[0]) : { type: 'columns', content: row.map((s) => ({ type: 'column', content: [card(s)] })) })
      }
      return out
    }
  }
}

/** The ChartSpec of a chart plan (manual data: a header row, then one row per label). */
export function chartSpecOf(plan: ChartPlan, kind: TransformChartKind = plan.kind): ChartSpec | null {
  const rows: (string | number | null)[][] = [[plan.category || '', ...plan.series.map((s) => s.name)], ...plan.labels.map((label, i) => [label, ...plan.series.map((s) => s.values[i] ?? null)])]
  return normalizeSpec({
    kind,
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.unit ? { unit: plan.unit } : {}),
    source: { kind: 'manual', rows },
    labels: 'firstColumn',
    seriesIn: 'columns',
  })
}

/** The new block(s) of a result, with the local options (direction, chart kind) applied. */
export function resultBlocks(res: BlockResult, opts: Pick<TransformOpts, 'direction' | 'chart'>): JSONContent[] {
  if (res.type === 'diagram') return [{ type: 'mermaid', attrs: { code: withDirection(res.code, opts.direction) } }]
  if (res.type === 'chart') {
    const spec = chartSpecOf(res.chart, opts.chart ?? res.chart.kind)
    return spec ? [{ type: 'chart', attrs: { spec } }] : []
  }
  return sectionsJSON(res.of, res.sections)
}

/** The lines that stay as text under the new block. */
export const leftBlocks = (res: BlockResult): JSONContent[] => res.left.map(paragraph)
