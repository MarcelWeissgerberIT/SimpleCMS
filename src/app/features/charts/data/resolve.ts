/**
 * Sources → ChartData. resolveChartDataSync() is what static renders use (the node's HTML,
 * Markdown, frozen shares); resolveChartData() also reads IndexedDB (history, files);
 * useChartData() keeps a chart live: it recomputes when the store changes in a way that can
 * touch its source (debounced) and only re-renders when the numbers really changed.
 */
import { useEffect, useMemo, useState } from 'react'
import { pageChanges, useWorkspace } from '../../../store/store'
import { t } from '../../../i18n'
import { databaseChartData } from '../../../database'
import type { ChartData, ChartSource, ChartSpec } from '../types'
import { tableToChartData } from '../table'
import { findSpreadsheet, readSheet, usedRange } from './sheet'
import { metricDef, systemData, systemDataSync } from './system'

export type TableSpec = Partial<Pick<ChartSpec, 'labels' | 'seriesIn' | 'unit'>>

export interface ChartDataState {
  data: ChartData
  loading: boolean
}

const lang = (): 'en' | 'de' => (useWorkspace.getState().settings.language === 'de' ? 'de' : 'en')
const tableOpts = () => ({ lang: lang(), seriesName: (n: number) => t('charts.seriesN', { n }) })
const fail = (key: string, vars?: Record<string, string | number>): ChartData => ({ labels: [], series: [], error: t(key, vars) })

export function sourceKey(source: ChartSource): string {
  return JSON.stringify(source)
}

/** The last full answer per source (async metrics) — static renders reuse it. */
const lastFull = new Map<string, ChartData>()

function manualData(source: Extract<ChartSource, { kind: 'manual' }>, spec: TableSpec): ChartData {
  return tableToChartData(source.rows, spec, tableOpts())
}

function sheetData(source: Extract<ChartSource, { kind: 'sheet' }>, spec: TableSpec): ChartData {
  const pages = useWorkspace.getState().pages
  const page = pages[source.pageId]
  if (!page || page.trashed) return fail('charts.err.sourceMissing')
  const attrs = findSpreadsheet(source.pageId, source.sheetBlockId, pages)
  if (!attrs) return fail(page.content ? 'charts.err.sheetMissing' : 'charts.err.notAvailable')
  try {
    const out = readSheet(attrs, source.ref.trim() || usedRange(attrs))
    if (out.error) return fail('charts.err.sheet', { error: out.error })
    return tableToChartData(out.values, spec, tableOpts())
  } catch (err) {
    console.warn('[charts] sheet read failed', err)
    return fail('charts.err.notAvailable')
  }
}

function databaseData(source: Extract<ChartSource, { kind: 'database' }>): ChartData {
  if (!source.x) return fail('charts.err.pickX')
  const r = databaseChartData({ databaseId: source.databaseId, viewId: source.viewId, x: source.x, y: source.y, aggregate: source.aggregate, series: source.series, dateBucket: source.dateBucket })
  if (r.error === 'database') return fail('charts.err.sourceMissing')
  if (r.error === 'property') return fail('charts.err.propertyMissing')
  const measure = source.aggregate === 'count' ? t('charts.agg.count') : `${t(`charts.agg.${source.aggregate}`)} · ${r.yName ?? ''}`
  const data: ChartData = { labels: r.labels, series: r.series.map((s) => ({ ...s, name: s.name || measure })), axis: r.axis }
  if (r.labelColors) data.labelColors = r.labelColors
  if (r.unit) data.unit = r.unit
  return data
}

/** Data available right now (no IndexedDB): exports and the first paint. */
export function resolveChartDataSync(source: ChartSource, spec: TableSpec = {}): ChartData {
  try {
    switch (source.kind) {
      case 'manual':
        return manualData(source, spec)
      case 'sheet':
        return sheetData(source, spec)
      case 'database':
        return databaseData(source)
      case 'system': {
        const def = metricDef(source.metric)
        if (def?.async) return lastFull.get(sourceKey(source)) ?? systemDataSync(source.metric, source)
        return systemDataSync(source.metric, source)
      }
      case 'inline':
        return fail('charts.err.inline')
    }
  } catch (err) {
    console.warn('[charts] source failed', err)
    return fail('charts.err.notAvailable')
  }
}

/** Full data (IndexedDB metrics included). */
export async function resolveChartData(source: ChartSource, spec: TableSpec = {}): Promise<ChartData> {
  if (source.kind === 'system' && metricDef(source.metric)?.async) {
    const data = await systemData(source.metric, source)
    if (!data.error) lastFull.set(sourceKey(source), data)
    return data
  }
  return resolveChartDataSync(source, spec)
}

/* ------------------------------------------------------------------ */
/* Live hook                                                           */
/* ------------------------------------------------------------------ */

type WsState = ReturnType<typeof useWorkspace.getState>

/** Could this store change touch the source? (cheap: shared page diff, no scans of unrelated pages) */
function touches(source: ChartSource, s: WsState, prev: WsState): boolean {
  if (s.settings.language !== prev.settings.language) return true
  switch (source.kind) {
    case 'manual':
    case 'inline':
      return false
    case 'sheet':
      return s.pages[source.pageId] !== prev.pages[source.pageId]
    case 'database': {
      if (s.databases !== prev.databases || s.people !== prev.people) return true
      if (s.pages === prev.pages) return false
      const { changed, removed } = pageChanges(s.pages, prev.pages)
      const hit = (id: string) => {
        const p = s.pages[id] ?? prev.pages[id]
        return !!p && (p.id === source.databaseId || !!p.databaseId)
      }
      return changed.some(hit) || removed.some(hit)
    }
    case 'system':
      return s.pages !== prev.pages || s.databases !== prev.databases || s.people !== prev.people
  }
}

const same = (a: ChartData, b: ChartData) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Live data of a source. Table-like sources read `spec.labels` / `seriesIn` / `unit`.
 * `source: null` (an unconfigured chart) yields an empty state.
 */
export function useChartData(source: ChartSource | null, spec: TableSpec = {}): ChartDataState {
  const key = source ? sourceKey(source) : ''
  const tkey = `${spec.labels ?? ''}|${spec.seriesIn ?? ''}|${spec.unit ?? ''}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => source, [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tspec = useMemo(() => spec, [tkey])
  const lang = useWorkspace((s) => s.settings.language)
  const initial = useMemo<ChartDataState>(() => {
    if (!src) return { data: { labels: [], series: [] }, loading: false }
    const data = resolveChartDataSync(src, tspec)
    return { data, loading: src.kind === 'system' && !!metricDef(src.metric)?.async }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, tspec, lang])
  const [state, setState] = useState<ChartDataState>(initial)
  useEffect(() => setState((prev) => (same(prev.data, initial.data) && prev.loading === initial.loading ? prev : initial)), [initial])

  useEffect(() => {
    if (!src || src.kind === 'manual' || src.kind === 'inline') return
    let alive = true
    let timer = 0
    const run = async () => {
      const data = await resolveChartData(src, tspec)
      if (alive) setState((prev) => (same(prev.data, data) && !prev.loading ? prev : { data, loading: false }))
    }
    void run()
    const delay = src.kind === 'system' ? 700 : 120
    const unsub = useWorkspace.subscribe((s, prev) => {
      if (!touches(src, s, prev)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void run(), delay)
    })
    return () => {
      alive = false
      window.clearTimeout(timer)
      unsub()
    }
  }, [src, tspec, lang])

  return state
}
