/**
 * Live chart: the shared scene (scene.ts) as React SVG plus hover / focus readouts.
 * Keyboard: the plot is one tab stop; ← → (↑ ↓) step through the points, Home / End jump,
 * Escape clears. Every readout is also announced. "Data table" shows the numbers as a table.
 */
import { createElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useT, useLang } from '../../../i18n'
import type { ChartData, ChartSpec } from '../types'
import { chartHeight } from '../spec'
import { buildScene, type Scene, type SceneTarget, type SceneText } from './scene'
import { reactProps, toReact } from './vnode'
import { formatValue } from './scale'
import './chart.css'
import { useLookFamily } from '../../../lib/look'
import type { SignalFamily } from './palette'

export interface ChartRendererProps {
  spec: ChartSpec
  data: ChartData
  /** plot height in px (default: spec.height or the kind's default) */
  height?: number
  /** hover / keyboard readouts and the data-table toggle (default true) */
  interactive?: boolean
  className?: string
  /** show the "Data table" toggle under the chart (default: when interactive) */
  tableToggle?: boolean
  /** extra class on bar marks (host views' hooks) */
  markClass?: string
  /** controlled readout: the active point index (null = none) and its changes (e.g. a table beside it) */
  active?: number | null
  onActiveChange?: (i: number | null) => void
}

/** Localised strings the scene draws. */
export function useSceneText(): SceneText {
  const t = useT()
  return useMemo(() => ({ other: t('charts.other'), total: t('charts.total'), versus: (label: string) => t('charts.versus', { label }), noData: t('charts.state.noData') }), [t])
}

/** Content width of an element, kept current with a ResizeObserver (0 until it is laid out). */
export function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Unique targets in reading order (a donut slice and its legend row share an index). */
function order(scene: Scene): SceneTarget[] {
  const seen = new Set<number>()
  return scene.targets.filter((t) => (seen.has(t.i) ? false : (seen.add(t.i), true)))
}

export function ChartRenderer({ spec, data, height, interactive = true, className, tableToggle, markClass, active: activeProp, onActiveChange }: ChartRendererProps) {
  const t = useT()
  const lang = useLang()
  const text = useSceneText()
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [own, setOwn] = useState<number | null>(null)
  const controlled = activeProp !== undefined
  const active = controlled ? activeProp : own
  const setActive = (i: number | null) => {
    if (!controlled) setOwn(i)
    onActiveChange?.(i)
  }
  const [table, setTable] = useState(false)
  const tableId = useId()
  const plotH = height ?? chartHeight(spec)
  // a workspace look's signal: its hue family goes last in the series order (lib/look)
  const signalFamily = (useLookFamily() ?? undefined) as SignalFamily
  const scene = useMemo(() => (width > 0 ? buildScene(spec, data, { width, height: plotH, lang, text, signalFamily }) : null), [spec, data, width, plotH, lang, text, signalFamily])
  const targets = useMemo(() => (scene ? order(scene) : []), [scene])
  useEffect(() => {
    if (!controlled && own !== null && !targets.some((x) => x.i === own)) setOwn(null)
  }, [targets, own, controlled])
  const tip = active !== null ? (scene?.targets.find((x) => x.i === active) ?? null) : null
  const empty = !scene || !scene.targets.length

  const onKey = (e: KeyboardEvent) => {
    if (!targets.length) return
    const at = targets.findIndex((x) => x.i === active)
    let next = at
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(targets.length - 1, at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at < 0 ? targets.length - 1 : Math.max(0, at - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = targets.length - 1
    else if (e.key === 'Escape' && active !== null) {
      e.preventDefault()
      e.stopPropagation()
      setActive(null)
      return
    } else return
    e.preventDefault()
    e.stopPropagation()
    setActive(targets[next].i)
  }

  const announce = tip ? `${tip.label}: ${tip.rows.map((r) => (tip.rows.length > 1 ? `${r.name} ${r.value}` : r.value)).join(', ')}` : ''
  const kindName = t(`charts.kind.${spec.kind}`)
  const tipLeft = tip && scene ? Math.max(64, Math.min(scene.width - 64, tip.x)) : 0

  let svg: React.ReactNode = null
  if (scene) {
    const root = scene.svg
    const overlay: React.ReactNode[] = []
    if (tip && scene.crosshair) overlay.push(<line key="x" x1={tip.x} x2={tip.x} y1={scene.crosshair.top} y2={scene.crosshair.bottom} className="ch-cross" />)
    if (tip && scene.marker) overlay.push(<rect key="m" x={tip.x - 4.5} y={tip.y - 4.5} width={9} height={9} className="ch-mark" />)
    if (interactive)
      scene.targets.forEach((x, k) => {
        const on = { onMouseEnter: () => setActive(x.i), onClick: () => setActive(x.i) }
        const hit = x.hit
        overlay.push(
          hit.kind === 'rect' ? (
            <rect key={`h${k}`} x={hit.x} y={hit.y} width={hit.w} height={hit.h} className="ch-hit" {...on} />
          ) : hit.kind === 'circle' ? (
            <circle key={`h${k}`} cx={hit.cx} cy={hit.cy} r={hit.r} className="ch-hit" {...on} />
          ) : (
            <path key={`h${k}`} d={hit.d} className="ch-hit" {...on} />
          ),
        )
      })
    svg = createElement('svg', { ...reactProps(root.attrs), 'aria-hidden': true, focusable: 'false' }, ...root.children.map((c, i) => (typeof c === 'string' ? c : toReact(c, { active: interactive ? active : null, markClass }, i))), ...overlay)
  }

  return (
    <div className={`ch ch--${spec.kind}${className ? ` ${className}` : ''}`}>
      <div
        ref={box}
        className="ch__plot"
        role={interactive && !empty ? 'group' : 'img'}
        aria-roledescription={interactive && !empty ? t('charts.a11y.chart') : undefined}
        aria-label={`${kindName}${spec.title ? ` · ${spec.title}` : ''}${empty ? '' : ` · ${t('charts.a11y.summary', { n: data.labels.length, s: data.series.length })}`}`}
        tabIndex={interactive && !empty ? 0 : undefined}
        onKeyDown={interactive ? onKey : undefined}
        onFocus={() => interactive && active === null && targets.length && setActive(targets[0].i)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null)
        }}
        onMouseLeave={() => setActive(null)}
        style={scene ? { minHeight: scene.height } : { minHeight: plotH }}
      >
        {svg}
        {interactive && tip && (
          <div className={`ch-tip${tip.y < 56 ? ' is-below' : ''}`} style={{ left: tipLeft, top: tip.y }} aria-hidden>
            <span className="ch-tip__label">{tip.label}</span>
            {tip.rows.map((r, k) => (
              <span className="ch-tip__row" key={k}>
                {tip.rows.length > 1 && <i className="ch-tip__key" style={{ background: r.color }} />}
                {tip.rows.length > 1 && <span className="ch-tip__name">{r.name}</span>}
                <span className="ch-tip__val">{r.value}</span>
              </span>
            ))}
          </div>
        )}
        {interactive && (
          <span className="visually-hidden" aria-live="polite">
            {announce}
          </span>
        )}
      </div>
      {(tableToggle ?? interactive) && !empty && (
        <div className="ch__foot">
          <button type="button" className="ch-tabletoggle" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((v) => !v)}>
            {t(table ? 'charts.table.hide' : 'charts.table.show')}
          </button>
          {table && <DataTable id={tableId} data={data} spec={spec} lang={lang} />}
        </div>
      )}
    </div>
  )
}

export function DataTable({ id, data, spec, lang }: { id?: string; data: ChartData; spec: ChartSpec; lang: 'en' | 'de' }) {
  const t = useT()
  const fmt = { lang, unit: spec.unit || data.unit, decimals: spec.decimals }
  return (
    <div className="ch-tablewrap" id={id}>
      <table className="ch-table">
        <thead>
          <tr>
            <th scope="col">{t('charts.table.label')}</th>
            {data.series.map((s, k) => (
              <th scope="col" className="num" key={k}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              {data.series.map((s, k) => (
                <td className="num" key={k}>
                  {formatValue(s.values[i], fmt)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
