/**
 * Chart view: SVG bar / line / donut grouped by a property, count / sum / average.
 * Instrument styling: mono axis labels, one orange series, hairline grid, hover readouts,
 * and a data table under the plot (legend + accessible values).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartColumn, ChartLine, ChartPie } from 'lucide-react'
import type { ChartConfig, ColorName, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { useModel, useLabels } from '../hooks'
import { Segmented, Select, TypeIcon } from '../parts'
import { NONE_KEY, groupRows } from '../model/query'
import { axisFormatter, formatCount, formatNumber } from '../model/format'
import { isNumberType } from '../model/schema'
import './chart.css'

interface Datum {
  key: string
  label: string
  value: number
  color: ColorName | null
}

const FALLBACK: string[] = ['var(--ink)', 'var(--signal)', 'var(--c-blue-text)', 'var(--c-green-text)', 'var(--c-yellow-text)', 'var(--c-purple-text)', 'var(--c-pink-text)', 'var(--c-brown-text)']
/** Hues that read as the same colour — never place both on one donut. */
const SAME_HUE: Record<string, string> = { 'var(--signal)': 'var(--c-orange-text)', 'var(--c-orange-text)': 'var(--signal)', 'var(--c-red-text)': 'var(--signal)' }
const MAX_SLICES = 6

/** Axis maximum + tick step; integer data (counts) never gets fractional ticks. */
function niceMax(v: number, integer = false): { max: number; step: number } {
  if (v <= 0) return integer ? { max: 1, step: 1 } : { max: 1, step: 0.25 }
  const raw = v / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  if (integer) step = step < 1 ? 1 : step === 2.5 ? 2 : Math.round(step)
  return { max: Math.ceil(v / step) * step, step }
}

export default function ChartView() {
  const t = useT()
  const m = useModel()
  const labels = useLabels()
  const lang = m.resolver.ctx.lang
  const cfg: ChartConfig = m.view.chart ?? { kind: 'bar', xPropertyId: null, aggregate: 'count' }
  const upd = (patch: Partial<ChartConfig>) => {
    if (!m.readOnly) useWorkspace.getState().updateView(m.db.id, m.view.id, { chart: { ...cfg, ...patch } })
  }
  const xProp = cfg.xPropertyId ? m.propMap.get(cfg.xPropertyId) : undefined
  const yProp = cfg.yPropertyId ? m.propMap.get(cfg.yPropertyId) : undefined
  const numericProps = m.db.properties.filter((p) => isNumberType(p.type) || p.type === 'formula' || p.type === 'rollup')
  const groupable = m.db.properties.filter((p) => p.type !== 'title' && p.type !== 'files' && p.type !== 'rollup')

  const boxRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const [hover, setHover] = useState<string | null>(null)

  const data: Datum[] = useMemo(() => {
    if (!xProp) return []
    const groups = groupRows(m.resolver, m.db, xProp, m.rows, labels).filter((g) => g.rows.length > 0 || g.key !== NONE_KEY)
    const value = (rows: typeof m.rows) => {
      if (cfg.aggregate === 'count' || !yProp) return rows.length
      const nums = rows.map((r) => m.resolver.value(m.db, yProp, r)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      if (!nums.length) return 0
      const sum = nums.reduce((s, x) => s + x, 0)
      return cfg.aggregate === 'sum' ? sum : sum / nums.length
    }
    return groups.map((g) => ({ key: g.key, label: g.label, value: value(g.rows), color: g.color ?? null }))
  }, [xProp, yProp, cfg.aggregate, m, labels])

  /** Over all shown records (not over groups: multi-value groupings count a row more than once). */
  const overall = useMemo(() => {
    if (cfg.aggregate === 'count' || !yProp) return m.rows.length
    const nums = m.rows.map((r) => m.resolver.value(m.db, yProp, r)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!nums.length) return 0
    const sum = nums.reduce((acc, x) => acc + x, 0)
    return cfg.aggregate === 'sum' ? sum : sum / nums.length
  }, [cfg.aggregate, yProp, m])
  const share = cfg.aggregate !== 'average'

  const fmt = (v: number) => (cfg.aggregate !== 'count' && yProp?.type === 'number' ? formatNumber(Math.round(v * 100) / 100, yProp.numberFormat, lang) : formatCount(v, lang, 2))
  // axis ticks: one format per axis (unit + digits from the step), never per tick
  const tickFmt = (step: number) => axisFormatter(step, cfg.aggregate !== 'count' && yProp?.type === 'number' ? yProp.numberFormat : 'comma', lang)
  const total = data.reduce((s, d) => s + d.value, 0)
  const narrow = w < 520
  const H = narrow ? 240 : 320

  const controls = (
    <div className="dbch-controls">
      <Segmented
        value={cfg.kind}
        ariaLabel={t('database.chart.kind')}
        items={[
          { value: 'bar', label: t('database.chart.bar'), icon: <ChartColumn size={13} /> },
          { value: 'line', label: t('database.chart.line'), icon: <ChartLine size={13} /> },
          { value: 'donut', label: t('database.chart.donut'), icon: <ChartPie size={13} /> },
        ]}
        onChange={(kind) => upd({ kind })}
        disabled={m.readOnly}
      />
      <span className="dbch-field">
        <span className="label">{t('database.chart.x')}</span>
        <Select
          value={cfg.xPropertyId ?? null}
          placeholder={t('database.rollup.pick')}
          searchable
          items={groupable.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
          onChange={(v) => upd({ xPropertyId: v })}
          disabled={m.readOnly}
        />
      </span>
      <span className="dbch-field">
        <span className="label">{t('database.chart.y')}</span>
        <Segmented
          value={cfg.aggregate}
          items={(['count', 'sum', 'average'] as const).map((a) => ({ value: a, label: t(`database.chart.agg.${a}`) }))}
          onChange={(aggregate) => upd({ aggregate, yPropertyId: aggregate !== 'count' ? cfg.yPropertyId ?? numericProps[0]?.id ?? null : cfg.yPropertyId })}
          disabled={m.readOnly}
        />
        {cfg.aggregate !== 'count' && (
          <Select
            value={cfg.yPropertyId ?? null}
            placeholder={t('database.rollup.pick')}
            items={numericProps.map((p: PropertyDef) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
            onChange={(v) => upd({ yPropertyId: v })}
            disabled={m.readOnly}
          />
        )}
      </span>
      <span style={{ flex: 1 }} />
      <span className="dbch-total">
        <span className="label">{cfg.aggregate === 'count' ? t('database.chart.records') : t(`database.chart.agg.${cfg.aggregate}`)}</span>
        <span className="dbch-total__num">{fmt(overall)}</span>
      </span>
    </div>
  )

  if (!xProp)
    return (
      <div className="dbch">
        {controls}
        <div className="db-empty">
          <span className="db-empty__line" />
          <span className="label">{t('database.chart.pickX')}</span>
          <span className="db-empty__line" />
        </div>
      </div>
    )

  // ---- donut data: fold the tail into "Other"
  const slices: Array<Datum & { fill: string }> = (() => {
    const sorted = [...data].filter((d) => d.value > 0)
    // colour follows the entity (option colour); duplicates and colourless groups take the next free fallback
    const used = new Set<string>()
    const taken = (f: string) => used.has(f) || (SAME_HUE[f] !== undefined && used.has(SAME_HUE[f]))
    const nextFallback = () => FALLBACK.find((f) => !taken(f)) ?? 'var(--ink-3)'
    const colored = sorted.map((d) => {
      let fill = d.color && d.color !== 'default' ? `var(--c-${d.color}-text)` : ''
      if (!fill || taken(fill)) fill = nextFallback()
      used.add(fill)
      return { ...d, fill }
    })
    if (colored.length <= MAX_SLICES) return colored
    const head = [...colored].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1)
    const keys = new Set(head.map((h) => h.key))
    const rest = colored.filter((c) => !keys.has(c.key))
    return [...colored.filter((c) => keys.has(c.key)), { key: '__other', label: t('database.chart.other'), value: rest.reduce((s, x) => s + x.value, 0), color: null, fill: 'var(--ink-3)' }]
  })()

  return (
    <div className="dbch">
      {controls}
      <div className="dbch-plot" ref={boxRef} onMouseLeave={() => setHover(null)}>
        {!data.length || total === 0 ? (
          <div className="db-empty">
            <span className="db-empty__line" />
            <span className="label">{t('database.chart.noData')}</span>
            <span className="db-empty__line" />
          </div>
        ) : cfg.kind === 'donut' ? (
          <Donut slices={slices} total={overall} w={w} h={H} fmt={fmt} hover={hover} setHover={setHover} centerLabel={cfg.aggregate === 'count' ? t('database.chart.records') : t(`database.chart.agg.${cfg.aggregate}`)} />
        ) : (
          <XY kind={cfg.kind} data={data} w={w} h={H} fmt={fmt} tickFmt={tickFmt} hover={hover} setHover={setHover} integer={cfg.aggregate === 'count'} />
        )}
      </div>
      <table className="dbch-table">
        <thead>
          <tr>
            <th>{xProp.name}</th>
            <th className="num">{cfg.aggregate === 'count' ? t('database.chart.records') : `${t(`database.chart.agg.${cfg.aggregate}`)} · ${yProp?.name ?? ''}`}</th>
            {share && <th className="num">%</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => {
            const slice = slices.find((s) => s.key === d.key)
            return (
              <tr key={d.key} data-hover={hover === d.key} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
                <td>
                  {cfg.kind === 'donut' && <span className="dbch-swatch" style={{ background: slice?.fill ?? 'var(--ink-3)' }} />}
                  {d.label}
                </td>
                <td className="num">{fmt(d.value)}</td>
                {share && <td className="num">{total ? `${formatCount((d.value / total) * 100, lang, 1)}%` : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function XY({ kind, data, w, h, fmt, tickFmt, hover, setHover, integer }: { kind: 'bar' | 'line'; data: Datum[]; w: number; h: number; fmt: (v: number) => string; tickFmt: (step: number) => (v: number) => string; hover: string | null; setHover: (k: string | null) => void; integer?: boolean }) {
  const { max, step } = niceMax(Math.max(...data.map((d) => d.value)), integer)
  const ticks: number[] = []
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v)
  const tick = tickFmt(step)
  const tickText = ticks.map(tick)
  // left margin fits the widest tick label (mono 10px ≈ 6.4px per glyph) + the 8px gap to the plot
  const ml = Math.max(40, Math.ceil(Math.max(...tickText.map((s) => s.length)) * 6.4) + 14)
  const mr = 16
  const mt = 22
  const mb = 46
  const iw = Math.max(40, w - ml - mr)
  const ih = h - mt - mb
  const band = iw / data.length
  const bw = Math.max(4, Math.min(56, band * 0.62))
  const y = (v: number) => mt + ih - (v / max) * ih
  const maxIdx = data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0)
  // value labels: on every mark when they fit, else only on a unique peak (a tie has no "the" peak)
  // (mono 11px ≈ 6.8px per glyph — neighbouring labels must not collide, e.g. "13.000,00 €" on a 390px screen)
  const labelW = Math.max(...data.map((d) => fmt(d.value).length)) * 6.8
  const labelAll = band >= Math.max(34, labelW + 8) && data.length <= 24
  const uniquePeak = data.filter((d) => d.value === data[maxIdx]?.value).length === 1
  const chars = Math.max(3, Math.floor(band / 6.6))
  const short = (s: string) => (s.length > chars ? s.slice(0, chars - 1) + '…' : s)
  const pts = data.map((d, i) => [ml + band * i + band / 2, y(d.value)] as const)
  const hi = hover === null ? -1 : data.findIndex((d) => d.key === hover)
  const tip = hi >= 0 ? { x: pts[hi][0], y: pts[hi][1], d: data[hi] } : null
  // line charts: a readout goes under its point when the line climbs through the space above it
  // (e.g. a low first value next to a high second one) and the space below is free
  const below = (i: number) => {
    if (kind !== 'line') return false
    const py = pts[i][1]
    const hw = Math.min(fmt(data[i].value).length * 6.8, band - 8) / 2
    const edge = (j: number) => (j < 0 || j >= pts.length ? py : py + ((pts[j][1] - py) * hw) / band)
    const rise = Math.max(py - edge(i - 1), py - edge(i + 1))
    const fall = Math.max(edge(i - 1) - py, edge(i + 1) - py)
    return rise > 6 && fall <= 6 && py + 19 <= mt + ih - 2
  }
  return (
    <>
      <svg width={w} height={h} className="dbch-svg" role="img">
        {ticks.map((v, i) => (
          <g key={v}>
            <line x1={ml} x2={ml + iw} y1={y(v)} y2={y(v)} className={v === 0 ? 'dbch-base' : 'dbch-gridline'} />
            <text x={ml - 8} y={y(v)} dy="0.32em" textAnchor="end" className="dbch-tick">
              {tickText[i]}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.key} x={ml + band * i + band / 2} y={mt + ih + 18} textAnchor="middle" className="dbch-xlabel" data-hover={hover === d.key}>
            {short(d.label)}
          </text>
        ))}
        {kind === 'bar' &&
          data.map((d, i) => {
            const x = ml + band * i + (band - bw) / 2
            const top = y(d.value)
            const hgt = Math.max(d.value > 0 ? 1 : 0, mt + ih - top)
            return <path key={d.key} d={`M${x},${mt + ih} V${top + 2} q0,-2 2,-2 H${x + bw - 2} q2,0 2,2 V${mt + ih} Z`} className="dbch-bar" data-hover={hover === d.key} style={hgt < 3 ? { opacity: 0.6 } : undefined} />
          })}
        {kind === 'line' && (
          <>
            <polyline points={pts.map((p) => p.join(',')).join(' ')} className="dbch-line" />
            {pts.map((p, i) => (
              <rect key={i} x={p[0] - 4} y={p[1] - 4} width={8} height={8} className="dbch-marker" data-hover={hi === i} />
            ))}
            {tip && <line x1={tip.x} x2={tip.x} y1={mt} y2={mt + ih} className="dbch-cross" />}
          </>
        )}
        {data.map((d, i) =>
          (labelAll ? d.value !== 0 : uniquePeak && i === maxIdx) ? (
            <text key={d.key} x={pts[i][0]} y={below(i) ? pts[i][1] + 19 : pts[i][1] - 8} textAnchor="middle" className={`dbch-peak${i === maxIdx && uniquePeak ? '' : ' dbch-peak--minor'}`}>
              {fmt(d.value)}
            </text>
          ) : null,
        )}
        {/* hit targets bigger than the marks */}
        {data.map((d, i) => (
          <rect key={d.key} x={ml + band * i} y={mt} width={band} height={ih + mb - 10} fill="transparent" onMouseEnter={() => setHover(d.key)} onClick={() => setHover(d.key)} />
        ))}
      </svg>
      {tip && (
        <div className="dbch-tip" style={{ left: tip.x, top: Math.max(4, tip.y - 52) }}>
          <span className="dbch-tip__label">{tip.d.label}</span>
          <span className="dbch-tip__val">{fmt(tip.d.value)}</span>
        </div>
      )}
    </>
  )
}

function Donut({ slices, total, w, h, fmt, hover, setHover, centerLabel }: { slices: Array<Datum & { fill: string }>; total: number; w: number; h: number; fmt: (v: number) => string; hover: string | null; setHover: (k: string | null) => void; centerLabel: string }) {
  const sum = slices.reduce((s, d) => s + d.value, 0) || 1
  const r = Math.min(h, w) / 2 - 14
  const ri = r * 0.64
  const cx = w / 2
  const cy = h / 2
  let a0 = -Math.PI / 2
  const arc = (a: number, b: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a), cx + rr * Math.cos(b), cy + rr * Math.sin(b)]
  const hv = hover !== null ? slices.find((x) => x.key === hover) ?? null : null
  return (
    <svg width={w} height={h} className="dbch-svg" role="img">
      {slices.map((s) => {
        const a1 = a0 + (s.value / sum) * Math.PI * 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        const [x0, y0, x1, y1] = arc(a0, a1, r)
        const [x2, y2, x3, y3] = arc(a1, a0, ri)
        const full = slices.length === 1
        const d = full
          ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 M${cx - ri},${cy} a${ri},${ri} 0 1,1 ${2 * ri},0 a${ri},${ri} 0 1,1 ${-2 * ri},0`
          : `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 0 ${x3},${y3} Z`
        a0 = a1
        return <path key={s.key} d={d} fill={s.fill} fillRule="evenodd" className="dbch-slice" data-hover={hover === s.key} data-dim={!!hv && hover !== s.key} onMouseEnter={() => setHover(s.key)} onClick={() => setHover(s.key)} />
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="dbch-center" style={{ fontSize: Math.max(12, Math.min(28, (ri * 1.6) / Math.max(1, fmt(hv ? hv.value : total).length * 0.68))) }}>
        {fmt(hv ? hv.value : total)}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="dbch-centerlabel">
        {hv ? hv.label.toUpperCase() : centerLabel.toUpperCase()}
      </text>
    </svg>
  )
}
