/**
 * Filtering, sorting, searching and grouping of rows (pure functions over a Resolver).
 */
import { addDays, addMonths, differenceInCalendarDays, format, isSameMonth, startOfDay } from 'date-fns'
import type { ColorName, Database, DateValue, Filter, FilterGroup, FilterOperator, ID, Page, Person, PropertyDef, PropertyValue, SelectOption, Sort, View } from '../../store/types'
import { FormulaError, isDate, toText, type FValue } from '../formula'
import { isDateValue, parseLocal, dfLocale } from './format'
import { isEmptyValue, type Resolved, type Resolver } from './resolve'
import { valueKind, type ValueKind } from './schema'

export const isGroup = (x: Filter | FilterGroup): x is FilterGroup => 'items' in x

/** Effective kind for a property, inferring formula/rollup kinds from a value. */
export function effectiveKind(prop: PropertyDef, v?: Resolved): ValueKind | 'boolean' {
  const k = valueKind(prop.type)
  if (k !== 'computed') return k
  if (prop.type === 'created_time' || prop.type === 'last_edited_time') return 'date'
  if (prop.type === 'unique_id') return 'number'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (isDate(v)) return 'date'
  return 'text'
}

/** Infer a formula/rollup result kind from the first non-empty value of some rows. */
export function inferKind(r: Resolver, db: Database, prop: PropertyDef, rows: Page[]): ValueKind | 'boolean' {
  const k = valueKind(prop.type)
  if (k !== 'computed') return k
  if (prop.type === 'rollup' && prop.rollup) {
    const fn = prop.rollup.fn
    if (fn === 'show_original') return 'text'
    if (fn === 'earliest_date' || fn === 'latest_date') return 'date'
    return 'number'
  }
  for (const row of rows.slice(0, 50)) {
    const v = r.value(db, prop, row)
    if (v !== null && v !== undefined && v !== '' && !(v instanceof FormulaError)) return effectiveKind(prop, v)
  }
  return effectiveKind(prop)
}

/** Resolve relative date tokens used in filter values. */
export function resolveFilterDate(start: string): Date | null {
  const today = startOfDay(new Date())
  switch (start) {
    case 'today':
      return today
    case 'tomorrow':
      return addDays(today, 1)
    case 'yesterday':
      return addDays(today, -1)
    case 'one_week_ago':
      return addDays(today, -7)
    case 'one_week_from_now':
      return addDays(today, 7)
    case 'one_month_ago':
      return addMonths(today, -1)
    case 'one_month_from_now':
      return addMonths(today, 1)
    default:
      return parseLocal(start)
  }
}

function timeOf(v: Resolved): Date | null {
  if (isDate(v)) return v
  if (isDateValue(v)) return parseLocal(v.start)
  return null
}

function textOfResolved(r: Resolver, db: Database, prop: PropertyDef, v: Resolved): string {
  if (typeof v === 'string') return v
  return r.textOf(db, prop, v)
}

export function testFilter(r: Resolver, db: Database, f: Filter, row: Page, props: Map<ID, PropertyDef>): boolean {
  const prop = props.get(f.propertyId)
  if (!prop) return true
  const v = r.value(db, prop, row)
  const op = f.operator
  if (op === 'is_empty') return isEmptyValue(prop, v)
  if (op === 'is_not_empty') return !isEmptyValue(prop, v)
  const kind = effectiveKind(prop, v)
  const fv = f.value
  switch (kind) {
    case 'checkbox':
    case 'boolean':
      return op === 'is_checked' ? v === true : op === 'is_not_checked' ? v !== true : true
    case 'number': {
      if (fv === null || fv === undefined || fv === '') return true
      const n = typeof v === 'number' ? v : null
      const target = Number(fv)
      if (n === null) return op === 'neq'
      switch (op) {
        case 'eq':
          return n === target
        case 'neq':
          return n !== target
        case 'gt':
          return n > target
        case 'gte':
          return n >= target
        case 'lt':
          return n < target
        case 'lte':
          return n <= target
      }
      return true
    }
    case 'select': {
      if (!fv) return true
      if (op === 'is') return v === fv
      if (op === 'is_not') return v !== fv
      return true
    }
    case 'multi':
    case 'person': {
      if (!fv) return true
      const arr = Array.isArray(v) ? (v as string[]) : []
      if (op === 'contains') return arr.includes(String(fv))
      if (op === 'not_contains') return !arr.includes(String(fv))
      return true
    }
    case 'date': {
      const d = timeOf(v)
      const today = startOfDay(new Date())
      if (op === 'within_past_week') return !!d && differenceInCalendarDays(today, d) >= 0 && differenceInCalendarDays(today, d) <= 7
      if (op === 'within_next_week') return !!d && differenceInCalendarDays(d, today) >= 0 && differenceInCalendarDays(d, today) <= 7
      if (op === 'this_month') return !!d && isSameMonth(d, today)
      const target = isDateValue(fv) ? resolveFilterDate(fv.start) : null
      if (!target) return true
      if (!d) return false
      const diff = differenceInCalendarDays(d, target)
      switch (op) {
        case 'is':
          return diff === 0
        case 'before':
          return diff < 0
        case 'after':
          return diff > 0
        case 'on_or_before':
          return diff <= 0
        case 'on_or_after':
          return diff >= 0
      }
      return true
    }
    default: {
      // text-like (text, url, relation titles, formula text, files names)
      const needle = String(fv ?? '').toLowerCase()
      if (!needle) return true
      const hay = textOfResolved(r, db, prop, v).toLowerCase()
      switch (op) {
        case 'is':
          return hay === needle
        case 'is_not':
          return hay !== needle
        case 'contains':
          return hay.includes(needle)
        case 'not_contains':
          return !hay.includes(needle)
        case 'starts_with':
          return hay.startsWith(needle)
        case 'ends_with':
          return hay.endsWith(needle)
      }
      return true
    }
  }
}

export function testGroup(r: Resolver, db: Database, g: FilterGroup, row: Page, props: Map<ID, PropertyDef>): boolean {
  if (!g.items.length) return true
  const test = (x: Filter | FilterGroup) => (isGroup(x) ? testGroup(r, db, x, row, props) : testFilter(r, db, x, row, props))
  return g.op === 'or' ? g.items.some(test) : g.items.every(test)
}

/** Number of filter rules; with `props`, rules on properties that no longer exist (inert) don't count. */
export function countFilters(g: FilterGroup | null | undefined, props?: { has: (id: ID) => boolean }): number {
  if (!g) return 0
  return g.items.reduce((n, x) => n + (isGroup(x) ? countFilters(x, props) : !props || props.has(x.propertyId) ? 1 : 0), 0)
}

/* ---------------- Sorting ---------------- */

function sortKey(r: Resolver, db: Database, prop: PropertyDef, row: Page): string | number | null {
  const v = r.value(db, prop, row)
  if (isEmptyValue(prop, v) && prop.type !== 'checkbox') return null
  switch (prop.type) {
    case 'select':
    case 'status': {
      const i = prop.options?.findIndex((o) => o.id === v) ?? -1
      return i < 0 ? null : i
    }
    case 'multi_select': {
      const ids = v as string[]
      const idx = ids.map((id) => prop.options?.findIndex((o) => o.id === id) ?? -1).filter((i) => i >= 0)
      return idx.length ? Math.min(...idx) : null
    }
    case 'checkbox':
      return v === true ? 1 : 0
    case 'date': {
      const d = timeOf(v)
      return d ? d.getTime() : null
    }
    case 'number':
    case 'rating':
    case 'unique_id':
      return typeof v === 'number' ? v : null
    default: {
      if (typeof v === 'number') return v
      if (isDate(v)) return v.getTime()
      if (typeof v === 'boolean') return v ? 1 : 0
      if (v instanceof FormulaError) return null
      const s = textOfResolved(r, db, prop, v)
      return s ? s.toLowerCase() : null
    }
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortRows(r: Resolver, db: Database, rows: Page[], sorts: Sort[], props: Map<ID, PropertyDef>): Page[] {
  const active = sorts.map((s) => ({ s, p: props.get(s.propertyId) })).filter((x): x is { s: Sort; p: PropertyDef } => !!x.p)
  if (!active.length) return rows
  const keys = new Map<ID, Array<string | number | null>>()
  for (const row of rows) keys.set(row.id, active.map(({ p }) => sortKey(r, db, p, row)))
  return [...rows].sort((a, b) => {
    const ka = keys.get(a.id)!
    const kb = keys.get(b.id)!
    for (let i = 0; i < active.length; i++) {
      const x = ka[i]
      const y = kb[i]
      if (x === y) continue
      // empty values always last
      if (x === null) return 1
      if (y === null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
      if (c !== 0) return active[i].s.direction === 'asc' ? c : -c
    }
    return a.order - b.order || a.createdAt - b.createdAt
  })
}

/* ---------------- Search ---------------- */

export function searchRows(r: Resolver, db: Database, rows: Page[], query: string): Page[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  const props = db.properties.filter((p) => !['files', 'created_time', 'last_edited_time', 'checkbox', 'rollup'].includes(p.type))
  return rows.filter((row) => {
    if (row.title.toLowerCase().includes(q)) return true
    for (const p of props) {
      if (p.type === 'title') continue
      if (r.text(db, p, row).toLowerCase().includes(q)) return true
    }
    return false
  })
}

/* ---------------- Grouping ---------------- */

export interface RowGroup {
  key: string
  label: string
  color?: ColorName
  option?: SelectOption
  person?: Person
  rows: Page[]
  /** True for the "No value" bucket. */
  empty?: boolean
  /** Can rows be moved into this group by writing a value? */
  settable: boolean
}

export const NONE_KEY = '__none__'

/** Group keys a row belongs to for a property (multi values → several groups). */
export function groupKeys(r: Resolver, db: Database, prop: PropertyDef, row: Page): string[] {
  const v = r.value(db, prop, row)
  if (prop.type === 'checkbox') return [v === true ? 'true' : 'false']
  if (isEmptyValue(prop, v)) return [NONE_KEY]
  switch (prop.type) {
    case 'select':
    case 'status':
      return [String(v)]
    case 'multi_select':
    case 'person':
    case 'relation':
      return (v as string[]).length ? (v as string[]) : [NONE_KEY]
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = timeOf(v)
      return d ? [format(d, 'yyyy-MM')] : [NONE_KEY]
    }
    default: {
      if (isDate(v)) return [format(v, 'yyyy-MM')]
      const s = typeof v === 'number' ? String(v) : textOfResolved(r, db, prop, v)
      return s ? [s] : [NONE_KEY]
    }
  }
}

export function groupRows(
  r: Resolver,
  db: Database,
  prop: PropertyDef,
  rows: Page[],
  labels: { none: string; checked: string; unchecked: string; untitled: string },
): RowGroup[] {
  const buckets = new Map<string, Page[]>()
  for (const row of rows) {
    for (const k of groupKeys(r, db, prop, row)) {
      const arr = buckets.get(k)
      if (arr) arr.push(row)
      else buckets.set(k, [row])
    }
  }
  const out: RowGroup[] = []
  const none = (): RowGroup => ({ key: NONE_KEY, label: labels.none, rows: buckets.get(NONE_KEY) ?? [], empty: true, settable: prop.type !== 'formula' && prop.type !== 'created_time' && prop.type !== 'last_edited_time' })
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select': {
      out.push(none())
      for (const o of prop.options ?? []) out.push({ key: o.id, label: o.name, color: o.color, option: o, rows: buckets.get(o.id) ?? [], settable: true })
      break
    }
    case 'person': {
      out.push(none())
      for (const p of r.ctx.people) out.push({ key: p.id, label: p.name, color: p.color, person: p, rows: buckets.get(p.id) ?? [], settable: true })
      break
    }
    case 'checkbox':
      out.push({ key: 'false', label: labels.unchecked, rows: buckets.get('false') ?? [], settable: true })
      out.push({ key: 'true', label: labels.checked, rows: buckets.get('true') ?? [], settable: true })
      break
    case 'relation': {
      out.push(none())
      for (const [k, rs] of buckets) if (k !== NONE_KEY) out.push({ key: k, label: r.ctx.pages[k]?.title || labels.untitled, rows: rs, settable: true })
      break
    }
    default: {
      const keys = [...buckets.keys()].filter((k) => k !== NONE_KEY)
      const isDateLike = ['date', 'created_time', 'last_edited_time'].includes(prop.type) || keys.every((k) => /^\d{4}-\d{2}$/.test(k))
      const isNum = prop.type === 'number' || prop.type === 'rating'
      keys.sort((a, b) => (isNum ? Number(a) - Number(b) : collator.compare(a, b)))
      for (const k of keys) {
        let label = k
        if (isDateLike && /^\d{4}-\d{2}$/.test(k)) label = format(parseLocal(k + '-01')!, 'MMMM yyyy', { locale: dfLocale(r.ctx.lang) })
        else if (isNum && prop.type === 'number') label = r.textOf(db, prop, Number(k))
        out.push({ key: k, label, rows: buckets.get(k)!, settable: prop.type === 'text' || prop.type === 'url' || prop.type === 'email' || prop.type === 'phone' || isNum })
      }
      out.unshift(none())
    }
  }
  return out
}

/** Value to write when moving a row from group `from` into group `to`. undefined = not possible. */
export function valueForGroupMove(prop: PropertyDef, current: PropertyValue | undefined, from: string | null, to: string): PropertyValue | undefined {
  if (from === to) return undefined
  switch (prop.type) {
    case 'select':
    case 'status':
      return to === NONE_KEY ? null : to
    case 'checkbox':
      return to === 'true'
    case 'multi_select':
    case 'person':
    case 'relation': {
      const arr = Array.isArray(current) ? [...(current as string[])] : []
      const without = from && from !== NONE_KEY ? arr.filter((x) => x !== from) : arr
      if (to === NONE_KEY) return []
      return without.includes(to) ? without : [...without, to]
    }
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return to === NONE_KEY ? '' : to
    case 'number':
    case 'rating':
      return to === NONE_KEY ? null : Number(to)
  }
  return undefined
}

/** Property presets for a new row so it matches the view's simple AND filters. */
export function defaultsFromFilter(view: View, props: Map<ID, PropertyDef>): Record<ID, PropertyValue> {
  const out: Record<ID, PropertyValue> = {}
  const g = view.filter
  if (!g || (g.op !== 'and' && g.items.length > 1)) return out
  for (const it of g.items) {
    if (isGroup(it)) continue
    const p = props.get(it.propertyId)
    if (!p) continue
    const op: FilterOperator = it.operator
    const v = it.value
    if ((p.type === 'select' || p.type === 'status') && op === 'is' && v) out[p.id] = v
    else if ((p.type === 'multi_select' || p.type === 'person') && op === 'contains' && v) out[p.id] = [String(v)]
    else if (p.type === 'checkbox' && op === 'is_checked') out[p.id] = true
    else if ((p.type === 'text' || p.type === 'url' || p.type === 'email' || p.type === 'phone') && op === 'is' && v) out[p.id] = String(v)
    else if (p.type === 'number' && op === 'eq' && v !== '' && v !== null && v !== undefined) out[p.id] = Number(v)
    else if (p.type === 'date' && op === 'is' && isDateValue(v)) {
      const d = resolveFilterDate((v as DateValue).start)
      if (d) out[p.id] = { start: format(d, 'yyyy-MM-dd') }
    }
  }
  return out
}

export const fvText = (v: FValue, lang: 'en' | 'de') => toText(v, lang)
