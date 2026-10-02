/**
 * Aggregations shared by footer calculations (CalcFn) and rollups (RollupFn).
 */
import type { Lang } from '@/shared/i18n'
import type { CalcFn, PropertyDef } from '../../store/types'
import { FormulaError, isDate, type FValue } from '../formula'
import { formatCount, formatNumber, formatDay } from './format'
import type { Resolved } from './resolve'
import { isDateValue, parseLocal } from './format'

export type AggFn = Exclude<CalcFn, 'none'>

function isEmpty(prop: PropertyDef, v: Resolved): boolean {
  if (v === null || v === undefined || v === '') return true
  if (v instanceof FormulaError) return true
  if (Array.isArray(v)) return v.length === 0
  if (prop.type === 'checkbox') return v !== true
  return false
}

function toNum(v: Resolved): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function toTime(v: Resolved): number | null {
  if (isDate(v)) return v.getTime()
  if (isDateValue(v)) return parseLocal(v.start)?.getTime() ?? null
  return null
}

function keyOf(v: Resolved): string[] {
  if (Array.isArray(v)) return v.map((x) => (isDate(x) ? String(x.getTime()) : JSON.stringify(x)))
  if (isDate(v)) return [String(v.getTime())]
  if (isDateValue(v)) return [v.start + (v.end ?? '')]
  return [JSON.stringify(v)]
}

/** value: number / Date / null; unit tells how to render. */
export interface AggResult {
  value: FValue
  unit: 'count' | 'percent' | 'number' | 'date' | 'days'
}

export function aggregate(fn: AggFn, prop: PropertyDef, values: Resolved[], _lang?: Lang): AggResult {
  const total = values.length
  const filled = values.filter((v) => !isEmpty(prop, v))
  switch (fn) {
    case 'count':
      return { value: total, unit: 'count' }
    case 'count_values':
      return { value: filled.reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : 1), 0), unit: 'count' }
    case 'count_unique': {
      const set = new Set<string>()
      for (const v of filled) keyOf(v).forEach((k) => set.add(k))
      return { value: set.size, unit: 'count' }
    }
    case 'count_empty':
      return { value: total - filled.length, unit: 'count' }
    case 'count_not_empty':
      return { value: filled.length, unit: 'count' }
    case 'percent_empty':
      return { value: total ? (total - filled.length) / total : 0, unit: 'percent' }
    case 'percent_not_empty':
      return { value: total ? filled.length / total : 0, unit: 'percent' }
    case 'percent_checked':
      return { value: total ? values.filter((v) => v === true).length / total : 0, unit: 'percent' }
    case 'earliest_date':
    case 'latest_date': {
      const times = values.map(toTime).filter((x): x is number => x !== null)
      if (!times.length) return { value: null, unit: 'date' }
      return { value: new Date(fn === 'earliest_date' ? Math.min(...times) : Math.max(...times)), unit: 'date' }
    }
    case 'range': {
      const times = values.map(toTime).filter((x): x is number => x !== null)
      if (times.length) return { value: Math.round((Math.max(...times) - Math.min(...times)) / 86400000), unit: 'days' }
      const nums = values.map(toNum).filter((x): x is number => x !== null)
      if (!nums.length) return { value: null, unit: 'number' }
      return { value: Math.max(...nums) - Math.min(...nums), unit: 'number' }
    }
    default: {
      const nums = values.map(toNum).filter((x): x is number => x !== null)
      if (!nums.length) return { value: null, unit: 'number' }
      if (fn === 'sum') return { value: nums.reduce((s, x) => s + x, 0), unit: 'number' }
      if (fn === 'average') return { value: nums.reduce((s, x) => s + x, 0) / nums.length, unit: 'number' }
      if (fn === 'min') return { value: Math.min(...nums), unit: 'number' }
      if (fn === 'max') return { value: Math.max(...nums), unit: 'number' }
      if (fn === 'median') {
        const s = [...nums].sort((a, b) => a - b)
        const m = Math.floor(s.length / 2)
        return { value: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, unit: 'number' }
      }
      return { value: null, unit: 'number' }
    }
  }
}

export function formatAgg(r: AggResult, prop: PropertyDef, lang: Lang, labels: { today: string; tomorrow: string; yesterday: string; days: string }): string {
  if (r.value === null || r.value === undefined) return '—'
  if (r.unit === 'count') return formatCount(r.value as number, lang, 0)
  if (r.unit === 'percent') return `${formatCount((r.value as number) * 100, lang, 1)}%`
  if (r.unit === 'days') return `${formatCount(r.value as number, lang, 0)} ${labels.days}`
  if (r.unit === 'date') return isDate(r.value) ? formatDay(r.value, lang, labels, false) : '—'
  const n = r.value as number
  if (prop.type === 'number') return formatNumber(n, prop.numberFormat, lang)
  return formatCount(n, lang, 2)
}
