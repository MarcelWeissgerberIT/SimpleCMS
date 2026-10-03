/**
 * `one_query_database`: simple filters (every condition must hold) and sorts over rows in their
 * friendly form (option names, ISO dates, people, related titles — the shapes the tools return), so
 * an agent filters on exactly what it reads.
 */
import { ApiError } from '../errors.ts'
import { parseDate } from '../api/values.ts'

export const FILTER_OPS = [
  // the shared set (local bridge and team server)
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  // also understood here
  'starts_with',
  'ends_with',
  'is_checked',
  'is_not_checked',
  'eq',
  'neq',
  'is',
  'is_not',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
] as const

export type FilterOp = (typeof FILTER_OPS)[number]

const CANONICAL: Partial<Record<FilterOp, FilterOp>> = { equals: 'eq', not_equals: 'neq', is: 'eq', is_not: 'neq', before: 'lt', after: 'gt', on_or_before: 'lte', on_or_after: 'gte' }

export interface Condition {
  property: string
  op: FilterOp
  value?: unknown
}

export interface SortKey {
  property: string
  direction?: 'asc' | 'desc'
}

/** A row as the tools return it. */
export interface FriendlyRow {
  id: string
  title: string
  createdAt: string | null
  updatedAt: string | null
  properties: Record<string, unknown>
}

/** What a filter / sort key reads: a property by name (or id), the title, or the row's timestamps. */
export interface Field {
  name: string
  type: string
  get(row: FriendlyRow): unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const lower = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').trim().toLowerCase()

/** The words a value can be matched by (option names, a person's name and email, a related row's id and title …). */
function words(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (Array.isArray(v)) return v.flatMap(words)
  if (isObj(v)) {
    if ('start' in v) return [lower(v.start)]
    return ['id', 'name', 'email', 'title'].flatMap((k) => (typeof v[k] === 'string' && v[k] ? [lower(v[k])] : []))
  }
  return [lower(v)]
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

const DATE_TYPES = new Set(['date', 'created_time', 'last_edited_time'])
const NUMBER_TYPES = new Set(['number', 'rating'])

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** A comparable date string: "YYYY-MM-DD", "YYYY-MM-DDTHH:MM" or a full ISO timestamp (created / edited times). */
function dateKey(v: unknown): string | null {
  const raw = isObj(v) ? v.start : v
  if (typeof raw !== 'string' || !raw) return null
  if (TIMESTAMP.test(raw)) return raw
  const p = parseDate(raw)
  return p ? p.value : null
}

/** unique_id "TASK-12" → 12 */
function numberOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(/^[A-Za-z]+-/, '').replace(/,(?=\d{1,2}$)/, '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

const truthy = (v: unknown) => v === true || ['true', 'yes', '1', 'checked', 'on', 'x'].includes(lower(v))

function compare(field: Field, a: unknown, b: unknown): number | null {
  if (DATE_TYPES.has(field.type)) {
    const x = dateKey(a)
    const y = dateKey(b)
    if (!x || !y) return null
    // the shorter form sets the precision: a date-only value compares by day, "THH:MM" by minute
    const len = Math.min(x.length, y.length)
    const xs = x.slice(0, len)
    const ys = y.slice(0, len)
    return xs < ys ? -1 : xs > ys ? 1 : 0
  }
  if (NUMBER_TYPES.has(field.type) || field.type === 'unique_id') {
    const x = numberOf(a)
    const y = numberOf(b)
    return x === null || y === null ? null : x - y
  }
  const x = words(a)[0]
  const y = lower(b)
  return x === undefined ? null : x.localeCompare(y)
}

/** Does `row` meet the condition? */
export function matches(field: Field, cond: Condition, row: FriendlyRow): boolean {
  const v = field.get(row)
  const op = CANONICAL[cond.op] ?? cond.op
  switch (op) {
    case 'is_empty':
      return field.type === 'checkbox' ? v !== true : isEmpty(v)
    case 'is_not_empty':
      return field.type === 'checkbox' ? v === true : !isEmpty(v)
    case 'is_checked':
      return v === true
    case 'is_not_checked':
      return v !== true
  }
  if (field.type === 'checkbox') {
    const want = truthy(cond.value)
    if (op === 'eq') return (v === true) === want
    if (op === 'neq') return (v === true) !== want
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte' || ((op === 'eq' || op === 'neq') && (DATE_TYPES.has(field.type) || NUMBER_TYPES.has(field.type)))) {
    const c = compare(field, v, cond.value)
    if (c === null) return op === 'neq'
    if (op === 'eq') return c === 0
    if (op === 'neq') return c !== 0
    return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0
  }
  const have = words(v)
  const want = lower(cond.value)
  switch (op) {
    case 'eq':
      return have.includes(want)
    case 'neq':
      return !have.includes(want)
    case 'contains':
      return have.some((w) => w.includes(want))
    case 'not_contains':
      return !have.some((w) => w.includes(want))
    case 'starts_with':
      return have.some((w) => w.startsWith(want))
    case 'ends_with':
      return have.some((w) => w.endsWith(want))
    default:
      return false
  }
}

/** Sort comparator: empty values last in either direction. */
export function sorter(keys: Array<{ field: Field; dir: 1 | -1 }>) {
  return (a: FriendlyRow, b: FriendlyRow): number => {
    for (const { field, dir } of keys) {
      const x = field.get(a)
      const y = field.get(b)
      const ex = isEmpty(x)
      const ey = isEmpty(y)
      if (ex || ey) {
        if (ex && ey) continue
        return ex ? 1 : -1
      }
      let c: number | null
      if (field.type === 'checkbox') c = Number(x === true) - Number(y === true)
      else if (DATE_TYPES.has(field.type) || NUMBER_TYPES.has(field.type) || field.type === 'unique_id') c = compare(field, x, y)
      else c = compare(field, x, words(y)[0] ?? '')
      if (c) return dir * c
    }
    return 0
  }
}

/**
 * The sort argument: "Due" / "-Due" (descending) / "order" (the table order, the default), or
 * { property, direction } (a list of them for ties).
 */
export function sortKeys(raw: string | SortKey | SortKey[] | undefined): SortKey[] {
  if (raw === undefined) return []
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s || s === 'order') return []
    return s.startsWith('-') ? [{ property: s.slice(1).trim(), direction: 'desc' }] : [{ property: s, direction: 'asc' }]
  }
  return (Array.isArray(raw) ? raw : [raw]).filter((k) => k.property.trim() !== 'order')
}

/* ------------------------------------------------------------------ cursors */

/** Offset cursors, bound to the query they came from. */
export function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify([offset, fingerprint])).toString('base64url')
}

export function decodeCursor(cursor: string, fingerprint: string): number {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (Array.isArray(v) && Number.isInteger(v[0]) && (v[0] as number) >= 0 && v[1] === fingerprint) return v[0] as number
  } catch {
    /* below */
  }
  throw new ApiError(400, 'invalid_cursor', 'The cursor is invalid or belongs to another query (same databaseId, filter and sort are needed)')
}
