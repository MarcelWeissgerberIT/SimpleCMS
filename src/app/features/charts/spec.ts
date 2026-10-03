/**
 * ChartSpec hygiene: a stored / pasted / shared spec is untrusted JSON. normalizeSpec() keeps
 * only known fields with sane values (lengths, ranges, enums), so the renderer never sees junk.
 */
import { COLOR_NAMES, type ColorName } from '../../store/types'
import {
  CHART_AGGREGATES,
  CHART_KINDS,
  DATE_BUCKETS,
  MAX_HEIGHT,
  MIN_HEIGHT,
  SYSTEM_BUCKETS,
  SYSTEM_RANGES,
  type ChartData,
  type ChartKind,
  type ChartSource,
  type ChartSpec,
} from './types'

/** Manual grids: enough for any hand-typed or pasted table, small enough for a block attr. */
export const MANUAL_MAX_ROWS = 400
export const MANUAL_MAX_COLS = 24
const CELL_MAX = 120
const TITLE_MAX = 160
const REF_MAX = 400

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const id = (v: unknown): string => (typeof v === 'string' ? v.replace(/[^\w:.-]/g, '').slice(0, 80) : '')
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined)
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

export function isColorName(v: unknown): v is ColorName {
  return COLOR_NAMES.includes(v as ColorName)
}

function manualRows(raw: unknown): (string | number | null)[][] {
  if (!Array.isArray(raw)) return []
  const rows: (string | number | null)[][] = []
  for (const r of raw.slice(0, MANUAL_MAX_ROWS)) {
    if (!Array.isArray(r)) continue
    rows.push(r.slice(0, MANUAL_MAX_COLS).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : typeof c === 'string' ? c.slice(0, CELL_MAX) : null)))
  }
  return rows
}

export function normalizeSource(raw: unknown): ChartSource | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  switch (s.kind) {
    case 'sheet': {
      const pageId = id(s.pageId)
      const sheetBlockId = id(s.sheetBlockId)
      return pageId && sheetBlockId ? { kind: 'sheet', pageId, sheetBlockId, ref: str(s.ref, REF_MAX) } : null
    }
    case 'inline':
      return { kind: 'inline', ref: str(s.ref, REF_MAX) }
    case 'database': {
      const databaseId = id(s.databaseId)
      const x = id(s.x)
      if (!databaseId) return null
      const out: ChartSource = { kind: 'database', databaseId, x, aggregate: oneOf(s.aggregate, CHART_AGGREGATES) ?? 'count' }
      if (id(s.viewId)) out.viewId = id(s.viewId)
      if (id(s.y)) out.y = id(s.y)
      if (id(s.series)) out.series = id(s.series)
      const bucket = oneOf(s.dateBucket, DATE_BUCKETS)
      if (bucket) out.dateBucket = bucket
      return out
    }
    case 'system': {
      const metric = str(s.metric, 40).replace(/[^\w.-]/g, '')
      if (!metric) return null
      const out: ChartSource = { kind: 'system', metric, range: oneOf(s.range, SYSTEM_RANGES) ?? '30d' }
      const bucket = oneOf(s.bucket, SYSTEM_BUCKETS)
      if (bucket) out.bucket = bucket
      return out
    }
    case 'manual':
      return { kind: 'manual', rows: manualRows(s.rows) }
    default:
      return null
  }
}

/** A clean spec, or null when `raw` isn't one (an unconfigured chart block). */
export function normalizeSpec(raw: unknown): ChartSpec | null {
  let v = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  const source = normalizeSource(s.source)
  if (!source) return null
  const out: ChartSpec = { kind: oneOf(s.kind, CHART_KINDS) ?? 'bar', source }
  const title = str(s.title, TITLE_MAX).trim()
  if (title) out.title = title
  const labels = oneOf(s.labels, ['firstColumn', 'firstRow', 'none'] as const)
  if (labels) out.labels = labels
  const seriesIn = oneOf(s.seriesIn, ['columns', 'rows'] as const)
  if (seriesIn) out.seriesIn = seriesIn
  if (Array.isArray(s.colors)) {
    const colors = s.colors.slice(0, 12).filter(isColorName)
    if (colors.length) out.colors = colors
  }
  for (const k of ['showValues', 'showLegend', 'showGrid'] as const) {
    const b = bool(s[k])
    if (b !== undefined) out[k] = b
  }
  const yMin = finite(s.yMin)
  const yMax = finite(s.yMax)
  if (yMin !== undefined) out.yMin = yMin
  if (yMax !== undefined && (yMin === undefined || yMax > yMin)) out.yMax = yMax
  const unit = str(s.unit, 12).trim()
  if (unit) out.unit = unit
  const decimals = finite(s.decimals)
  if (decimals !== undefined) out.decimals = Math.max(0, Math.min(6, Math.round(decimals)))
  const height = finite(s.height)
  if (height !== undefined) out.height = clampHeight(height)
  return out
}

export function clampHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)))
}

/** Default plot height per kind (the block grows with its legend / donut list). */
export function defaultHeight(kind: ChartKind): number {
  if (kind === 'kpi') return 160
  if (kind === 'sparkline') return 160
  return 280
}

export function chartHeight(spec: Pick<ChartSpec, 'kind' | 'height'>): number {
  return spec.height ? clampHeight(spec.height) : defaultHeight(spec.kind)
}

/* ------------------------------------------------------------------ */
/* Suggestion                                                          */
/* ------------------------------------------------------------------ */

const DATEISH = /^(\d{4}([-/.]\d{1,2}([-/.]\d{1,2})?)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}|Q[1-4]\s?\d{2,4}|\d{4}\s?Q[1-4]|(jan|feb|m[aä]r|apr|ma[iy]|jun|jul|aug|sep|o[ck]t|nov|de[cz])[a-z]*\.?(\s+\d{2,4})?|(mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)[a-z]*\.?)$/i

export function looksLikeTime(data: ChartData): boolean {
  if (data.axis === 'time') return true
  if (data.axis === 'category') return false
  const labels = data.labels.filter(Boolean)
  return labels.length >= 3 && labels.every((l) => DATEISH.test(l.trim()))
}

/** Values present in the data (every series). */
export function valueCount(data: ChartData): number {
  let n = 0
  for (const s of data.series) for (const v of s.values) if (v !== null && Number.isFinite(v)) n++
  return n
}

/**
 * The kind that fits the data best: one value → KPI, time → line, few categories → bar,
 * long labels → horizontal bars, many points → line.
 */
export function suggestKind(data: ChartData | null): ChartKind {
  if (!data || data.error || !data.series.length) return 'bar'
  const n = data.labels.length
  const values = valueCount(data)
  if (values <= 1 || (n === 1 && data.series.length === 1)) return 'kpi'
  if (looksLikeTime(data)) return data.series.length > 3 ? 'line' : n > 12 ? 'line' : data.series.length > 1 ? 'line' : 'bar'
  if (n > 24) return 'line'
  const avgLabel = data.labels.reduce((s, l) => s + l.length, 0) / Math.max(1, n)
  if (data.series.length === 1 && avgLabel > 14) return 'barH'
  return 'bar'
}

/** Kinds that make sense for this data (others stay pickable, but greyed with a reason). */
export function kindFits(kind: ChartKind, data: ChartData | null): boolean {
  if (!data || data.error) return true
  const n = data.labels.length
  switch (kind) {
    case 'donut': {
      const s = data.series[0]
      return !!s && n >= 2 && s.values.every((v) => v === null || v >= 0) && s.values.some((v) => (v ?? 0) > 0)
    }
    case 'stacked':
      return data.series.length >= 2
    case 'scatter':
      return n >= 2
    case 'sparkline':
      return n >= 2
    default:
      return true
  }
}
