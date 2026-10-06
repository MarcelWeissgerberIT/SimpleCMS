/**
 * Chart block menu entries — shared by the block handle menu and the chart's own "⋯" key:
 * open large (the diagram viewer), edit, change type, download PNG / SVG, copy the data as TSV,
 * open the source.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ChartColumn, ClipboardCopy, Download, ExternalLink, Maximize2, Settings2 } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { MenuEntry } from '../../ui/Menu'
import { toast } from '../../store/ui'
import { openPage } from '../../lib/router'
import { CHART_KINDS, copyChartTsv, currentTheme, downloadChartPng, downloadChartSvg, openChartBuilder, openChartViewer, resolveChartData, type ChartSpec, type BuilderStep } from '../../features/charts'
import { CHART, chartSpecOf } from '../schema/chart'

/** Write a new spec into the chart at `pos` (the node there must still be a chart). */
export function setChartSpec(editor: Editor, pos: number, spec: ChartSpec): void {
  if (editor.isDestroyed) return
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== CHART) return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, spec }))
}

/** Open the builder on a chart block (the chart is found again by position on save). */
export function editChart(editor: Editor, getPos: () => number | undefined, step?: BuilderStep, onCancel?: () => void): void {
  const pos = getPos()
  const node = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
  const pageId = editor.view.dom.getAttribute('data-page-id')
  openChartBuilder({
    initial: node ? chartSpecOf(node.attrs) : null,
    step,
    pageId,
    onSave: (spec) => {
      const at = getPos()
      if (typeof at === 'number') setChartSpec(editor, at, spec)
    },
    onCancel,
  })
}

async function download(spec: ChartSpec, kind: 'png' | 'svg', t: Translate, width?: number) {
  try {
    const data = await resolveChartData(spec.source, spec)
    const opts = { width: width && width > 300 ? width : 880, theme: currentTheme() }
    if (kind === 'png') await downloadChartPng(spec, data, opts)
    else downloadChartSvg(spec, data, opts)
  } catch (err) {
    console.warn('[editor] chart download failed', err)
    toast({ message: t('charts.block.downloadFailed'), kind: 'error' })
  }
}

export function chartMenuEntries(editor: Editor, ref: { pos: number; node: PMNode }, t: Translate, opts: { width?: number } = {}): MenuEntry[] {
  if (ref.node.type.name !== CHART) return []
  const spec = chartSpecOf(ref.node.attrs)
  const editable = editor.isEditable
  const getPos = () => {
    const n = editor.state.doc.nodeAt(ref.pos)
    return n && n.type.name === CHART ? ref.pos : undefined
  }
  const out: MenuEntry[] = []
  if (spec)
    out.push({
      id: 'chart-open-large',
      label: t('ui.viewer.open'),
      icon: <Maximize2 size={15} />,
      keywords: 'zoom viewer minimap groß vergrößern',
      // after the menu closed and handed focus back: the viewer returns it there
      onSelect: () => requestAnimationFrame(() => openChartViewer(spec)),
    })
  if (editable) out.push({ label: t('charts.block.editChart'), icon: <Settings2 size={15} />, onSelect: () => editChart(editor, getPos) })
  if (!spec) return out
  if (editable)
    out.push({
      label: t('charts.block.type'),
      icon: <ChartColumn size={15} />,
      submenu: CHART_KINDS.map((k) => ({ label: t(`charts.kind.${k}`), checked: spec.kind === k, onSelect: () => setChartSpec(editor, ref.pos, { ...spec, kind: k }) })),
    })
  out.push(
    { label: t('charts.block.png'), icon: <Download size={15} />, onSelect: () => void download(spec, 'png', t, opts.width) },
    { label: t('charts.block.svg'), icon: <Download size={15} />, onSelect: () => void download(spec, 'svg', t, opts.width) },
    {
      label: t('charts.block.tsv'),
      icon: <ClipboardCopy size={15} />,
      onSelect: async () => {
        const ok = await copyChartTsv(await resolveChartData(spec.source, spec))
        toast({ message: t(ok ? 'charts.block.copied' : 'charts.block.copyFailed'), kind: ok ? 'success' : 'error' })
      },
    },
  )
  const src = spec.source
  if (src.kind === 'database' || src.kind === 'sheet')
    out.push({
      label: t('charts.block.openSource'),
      icon: <ExternalLink size={15} />,
      onSelect: () => {
        if (src.kind === 'database') openPage(src.databaseId)
        else openPage(src.pageId, src.sheetBlockId)
      },
    })
  return out
}
