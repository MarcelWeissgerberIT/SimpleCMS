/**
 * Chart series of a database (features/charts → a `chart` block with a database source; the
 * chart view uses the same maths). Rows pass the view's filters; x groups like the board
 * (select / status options in their order and colour, people, checkboxes …) or buckets dates
 * (day … year, gaps filled); y counts rows or aggregates a number; an optional split property
 * turns one series into several (stacked / grouped). Pure: reads the store, writes nothing.
 */
import { addDays, addMonths, addQuarters, addWeeks, addYears, format, startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear } from 'date-fns'
import type { ColorName, Database, ID, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { isDate } from '../formula'
import { Resolver } from './resolve'
import { NONE_KEY, groupKeys, groupRows } from './query'
import { dfLocale, isDateValue, parseLocal } from './format'
import { filteredRows } from './ics'
import { workspaceCtx } from './ctx'

export type DatabaseChartAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type DatabaseChartBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface DatabaseChartInput {
  databaseId: ID
  viewId?: ID | null
  x: ID
  y?: ID | null
  aggregate: DatabaseChartAggregate
  series?: ID | null
  dateBucket?: DatabaseChartBucket
}

export interface DatabaseChartResult {
  labels: string[]
  series: Array<{ name: string; values: (number | null)[]; color?: ColorName }>
  labelColors?: (ColorName | null)[]
  unit?: string
  axis: 'time' | 'category'
  /** the x property's name and the measured property's name (absent when counting) */
  xName: string
  yName?: string
  /** 'database': gone (or not visible here) · 'property': x / y / split property gone */
  error?: 'database' | 'property'
  /** rows the chart counts (after the view's filters) */
  rowCount: number
}

const DATE_TYPES = new Set(['date', 'created_time', 'last_edited_time'])
const MAX_BUCKETS = 400

/** Properties a chart can group by / split by / measure. */
export function chartGroupable(p: PropertyDef): boolean {
  return p.type !== 'title' && p.type !== 'files' && p.type !== 'rollup'
}
export function chartMeasurable(p: PropertyDef): boolean {
  return p.type === 'number' || p.type === 'rating' || p.type === 'formula' || p.type === 'rollup'
}

function dateOf(r: Resolver, db: Database, prop: PropertyDef, row: Page): Date | null {
  const v = r.value(db, prop, row)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (isDateValue(v)) return parseLocal(v.start)
  if (isDate(v)) return v as Date
  return null
}

const START: Record<DatabaseChartBucket, (d: Date) => Date> = {
  day: startOfDay,
  week: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  month: startOfMonth,
  quarter: startOfQuarter,
  year: startOfYear,
}
const NEXT: Record<DatabaseChartBucket, (d: Date) => Date> = {
  day: (d) => addDays(d, 1),
  week: (d) => addWeeks(d, 1),
  month: (d) => addMonths(d, 1),
  quarter: (d) => addQuarters(d, 1),
  year: (d) => addYears(d, 1),
}

export function bucketLabel(d: Date, bucket: DatabaseChartBucket, lang: 'en' | 'de'): string {
  const locale = dfLocale(lang)
  switch (bucket) {
    case 'day':
      return format(d, lang === 'de' ? 'd. MMM' : 'd MMM', { locale })
    case 'week':
      return `${lang === 'de' ? 'KW' : 'W'}${format(d, 'I', { locale })} ${format(d, 'yy')}`
    case 'month':
      return format(d, 'MMM yy', { locale })
    case 'quarter':
      return `Q${format(d, 'Q')} ${format(d, 'yyyy')}`
    case 'year':
      return format(d, 'yyyy')
  }
}

const UNIT: Record<string, string> = { euro: '€', dollar: '$', pound: '£', percent: '%' }

function aggregate(values: number[], fn: DatabaseChartAggregate, count: number): number | null {
  if (fn === 'count') return count
  if (!values.length) return fn === 'sum' ? 0 : null
  switch (fn) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
  }
}

export function databaseChartData(input: DatabaseChartInput, rowsIn?: Page[]): DatabaseChartResult {
  const st = useWorkspace.getState()
  const lang = st.settings.language === 'de' ? 'de' : 'en'
  const empty = (error: DatabaseChartResult['error'], xName = ''): DatabaseChartResult => ({ labels: [], series: [], axis: 'category', xName, error, rowCount: 0 })
  const db = st.databases[input.databaseId]
  const dbPage = st.pages[input.databaseId]
  if (!db || !dbPage || dbPage.trashed) return empty('database')
  const props = new Map(db.properties.map((p) => [p.id, p]))
  const xProp = props.get(input.x)
  const yProp = input.y ? props.get(input.y) : undefined
  const sProp = input.series ? props.get(input.series) : undefined
  const fn = input.aggregate
  if (!xProp || (fn !== 'count' && !yProp) || (input.series && !sProp)) return empty('property', xProp?.name ?? '')

  const r = new Resolver(workspaceCtx())
  const view = input.viewId ? (db.views.find((v) => v.id === input.viewId) ?? null) : null
  let rows = rowsIn ?? Object.values(st.pages).filter((p) => p.databaseId === db.id && !p.trashed)
  if (view) rows = filteredRows(r, db, view, rows, props)
  const labels = { none: t('database.group.none'), checked: t('database.group.checked'), unchecked: t('database.group.unchecked'), untitled: t('common.untitled') }

  // x buckets: keys in display order + which bucket(s) a row falls into
  let keys: string[] = []
  let names: string[] = []
  let colors: (ColorName | null)[] = []
  let axis: 'time' | 'category' = 'category'
  let keyOf: (row: Page) => string[]
  if (DATE_TYPES.has(xProp.type) || (xProp.type === 'formula' && rows.some((row) => dateOf(r, db, xProp, row)))) {
    axis = 'time'
    const bucket = input.dateBucket ?? 'month'
    const startOf = START[bucket]
    const dates = new Map<ID, Date>()
    for (const row of rows) {
      const d = dateOf(r, db, xProp, row)
      if (d) dates.set(row.id, startOf(d))
    }
    const times = [...dates.values()].map((d) => d.getTime())
    if (times.length) {
      let cur = new Date(Math.min(...times))
      const last = Math.max(...times)
      while (cur.getTime() <= last && keys.length < MAX_BUCKETS) {
        keys.push(String(cur.getTime()))
        names.push(bucketLabel(cur, bucket, lang))
        cur = NEXT[bucket](cur)
      }
    }
    colors = keys.map(() => null)
    keyOf = (row) => {
      const d = dates.get(row.id)
      return d ? [String(d.getTime())] : []
    }
  } else {
    const groups = groupRows(r, db, xProp, rows, labels).filter((g) => g.rows.length > 0 || (g.key !== NONE_KEY && g.option))
    keys = groups.map((g) => g.key)
    names = groups.map((g) => g.label)
    colors = groups.map((g) => g.color ?? null)
    keyOf = (row) => groupKeys(r, db, xProp, row)
  }

  // series split (one unsplit series: its name is left to the caller — '' here)
  let seriesKeys: Array<{ key: string | null; name: string; color?: ColorName }> = [{ key: null, name: '' }]
  let seriesOf: (row: Page) => Array<string | null> = () => [null]
  if (sProp) {
    const groups = groupRows(r, db, sProp, rows, labels).filter((g) => g.rows.length > 0)
    seriesKeys = groups.map((g) => ({ key: g.key, name: g.label, color: g.color && g.color !== 'default' ? g.color : undefined }))
    seriesOf = (row) => groupKeys(r, db, sProp, row)
  }

  const scale = yProp?.numberFormat === 'percent' && fn !== 'count' ? 100 : 1
  const cells = new Map<string, { n: number; vals: number[] }>()
  for (const row of rows) {
    const xs = keyOf(row)
    if (!xs.length) continue
    let num: number | null = null
    if (yProp && fn !== 'count') {
      const v = r.value(db, yProp, row)
      num = typeof v === 'number' && Number.isFinite(v) ? v * scale : null
    }
    for (const xk of xs)
      for (const sk of seriesOf(row)) {
        const id = `${xk}\u0000${sk ?? ''}`
        let c = cells.get(id)
        if (!c) cells.set(id, (c = { n: 0, vals: [] }))
        c.n++
        if (num !== null) c.vals.push(num)
      }
  }
  const series = seriesKeys.map((s) => ({
    name: s.name,
    ...(s.color ? { color: s.color } : {}),
    values: keys.map((xk) => {
      const c = cells.get(`${xk}\u0000${s.key ?? ''}`)
      return c ? aggregate(c.vals, fn, c.n) : fn === 'count' || fn === 'sum' ? 0 : null
    }),
  }))
  const unit = fn !== 'count' && yProp?.numberFormat ? UNIT[yProp.numberFormat] : undefined
  return {
    labels: names,
    series,
    ...(colors.some(Boolean) ? { labelColors: colors } : {}),
    ...(unit ? { unit } : {}),
    axis,
    xName: xProp.name,
    ...(yProp && fn !== 'count' ? { yName: yProp.name } : {}),
    rowCount: rows.length,
  }
}
