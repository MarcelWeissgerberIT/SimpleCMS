/**
 * Chart block: a spec plate ("§ CHART · BAR · DATABASE"), the title and the live chart from
 * features/charts. Editable pages get "Edit" and the chart menu; read-only renders (share,
 * history, presentation) show the chart with its readouts only. A chart inserted from the slash
 * menu opens the builder at once — cancelling it removes the still empty block.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { ChartColumn, MoreHorizontal, Settings2 } from 'lucide-react'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Menu, useMenu } from '../../ui/Menu'
import { ChartRenderer, chartHeight, useChartData } from '../../features/charts'
import { chartSpecOf, consumeFreshChart } from '../schema/chart'
import { chartMenuEntries, editChart } from '../menus/chartMenu'
import './chart.css'

export function ChartBlockView({ node, editor, getPos, selected }: ReactNodeViewProps) {
  const t = useT()
  const spec = useMemo(() => chartSpecOf(node.attrs), [node.attrs])
  const pageId = editor.view.dom.getAttribute('data-page-id')
  const locked = useWorkspace((s) => !!pageId && !!s.pages[pageId]?.settings.locked)
  const viewer = useCloud((s) => s.readOnly)
  // locking the page (or a viewer role) flips the editor's editable flag without a transaction
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = window.setTimeout(bump, 0)
    return () => window.clearTimeout(id)
  }, [locked, viewer])
  const editable = !editor.isDestroyed && editor.isEditable && !locked
  const { data, loading } = useChartData(spec?.source ?? null, spec ?? {})
  const menu = useMenu()
  const box = useRef<HTMLDivElement>(null)
  const pos = () => {
    const p = getPos()
    return typeof p === 'number' ? p : undefined
  }

  useEffect(() => {
    if (spec || !consumeFreshChart(editor)) return
    editChart(editor, pos, 'source', () => {
      // cancelled right after inserting: the empty block goes again
      const at = pos()
      const n = typeof at === 'number' ? editor.state.doc.nodeAt(at) : null
      if (n && n.type.name === 'chart' && !chartSpecOf(n.attrs) && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.delete(at!, at! + n.nodeSize))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const kindLabel = spec ? t(`charts.kind.${spec.kind}`) : ''
  const srcLabel = spec ? t(`charts.block.src.${spec.source.kind}`) : ''
  const shown = loading && !data.labels.length ? { labels: [], series: [], error: t('charts.err.loading') } : data
  const entries = menu.open ? chartMenuEntries(editor, { pos: pos() ?? -1, node }, t, { width: box.current?.clientWidth }) : []

  return (
    <NodeViewWrapper className={`chart-block${selected ? ' is-selected' : ''}${spec ? '' : ' is-empty'}`} data-type="chart" contentEditable={false}>
      <div className="chart-block__head">
        <span className="label chart-block__plate">
          § {t('charts.block.label')}
          {spec && (
            <>
              <span aria-hidden> · </span>
              {kindLabel}
              <span aria-hidden> · </span>
              {srcLabel}
            </>
          )}
        </span>
        {editable && (
          <span className="chart-block__tools">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => editChart(editor, pos)} aria-haspopup="dialog">
              <Settings2 size={13} strokeWidth={1.75} aria-hidden />
              {t('charts.block.edit')}
            </button>
            {spec && (
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('charts.block.more')} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
                <MoreHorizontal size={15} strokeWidth={1.75} />
              </button>
            )}
          </span>
        )}
      </div>
      {spec?.title && <div className="chart-block__title">{spec.title}</div>}
      <div className="chart-block__body" ref={box}>
        {spec ? (
          <ChartRenderer spec={spec} data={shown} height={chartHeight(spec)} />
        ) : (
          <div className="chart-block__empty">
            <ChartColumn size={18} strokeWidth={1.6} aria-hidden />
            <span className="label">{t('charts.block.empty')}</span>
            {editable && (
              <button type="button" className="btn btn--sm" onClick={() => editChart(editor, pos)}>
                {t('charts.block.setup')}
              </button>
            )}
          </div>
        )}
      </div>
      {menu.open && <Menu {...menu.props} entries={entries} placement="bottom-end" />}
    </NodeViewWrapper>
  )
}

/** The plot, its table and the tools belong to React (keys, hover, focus); the rest selects the block. */
export const chartViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('.chart-block__tools, .chart-block__body, .chart-block__empty'),
  ignoreMutation: () => true,
}
