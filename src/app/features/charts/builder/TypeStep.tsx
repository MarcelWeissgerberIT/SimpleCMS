/** Step 02 — every chart type drawn live from the actual data; the suggestion is pre-selected. */
import { useRef, type KeyboardEvent } from 'react'
import { useT } from '../../../i18n'
import { CHART_KINDS, type ChartData, type ChartKind, type ChartSpec } from '../types'
import { kindFits } from '../spec'
import { ChartRenderer } from '../render/ChartRenderer'

export function TypeStep({ data, spec, kind, suggestion, onPick }: { data: ChartData; spec: ChartSpec; kind: ChartKind; suggestion: ChartKind; onPick: (k: ChartKind) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    const cols = Math.max(1, Math.round((ref.current?.clientWidth ?? 600) / 200))
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0
    if (!dir) return
    e.preventDefault()
    const at = CHART_KINDS.indexOf(kind)
    const next = CHART_KINDS[Math.max(0, Math.min(CHART_KINDS.length - 1, at + dir))]
    onPick(next)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus())
  }
  return (
    <div ref={ref} className="chb-types" role="radiogroup" aria-label={t('charts.block.type')} onKeyDown={onKey}>
      {CHART_KINDS.map((k) => {
        const fits = kindFits(k, data)
        const on = k === kind
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-kind={k}
            className={`chb-type${fits ? '' : ' is-misfit'}${k === suggestion ? ' is-suggested' : ''}`}
            title={fits ? undefined : t('charts.type.misfit')}
            onClick={() => onPick(k)}
          >
            <span className="chb-type__thumb" aria-hidden>
              <ChartRenderer spec={{ ...spec, kind: k, title: undefined, showGrid: false, showValues: false, showLegend: false }} data={data} height={k === 'kpi' || k === 'sparkline' ? 92 : 96} interactive={false} />
            </span>
            <span className="chb-type__name">
              <span className={`led${on ? ' led--on' : ''}`} aria-hidden />
              {t(`charts.kind.${k}`)}
              {k === suggestion && <span className="chb-type__tag">{t('charts.type.suggested')}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
