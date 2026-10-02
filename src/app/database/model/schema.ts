/**
 * Property-type metadata: icons, which operators / calculations apply, defaults.
 */
import {
  Calendar,
  CircleChevronDown,
  CircleDot,
  Clock,
  ClockArrowUp,
  Hash,
  Link,
  List,
  Paperclip,
  Phone,
  ScanBarcode,
  Sigma,
  SquareCheck,
  SquareFunction,
  Star,
  TextAlignStart,
  Type,
  User,
  AtSign,
  ArrowUpRight,
  Table,
  SquareKanban,
  Rows3,
  LayoutGrid,
  CalendarDays,
  ChartGantt,
  ChartColumn,
  type LucideIcon,
} from 'lucide-react'
import type { CalcFn, FilterOperator, PropertyDef, PropertyType, RollupFn, ViewType } from '../../store/types'

export const TYPE_ICON: Record<PropertyType, LucideIcon> = {
  title: Type,
  text: TextAlignStart,
  number: Hash,
  select: CircleChevronDown,
  multi_select: List,
  status: CircleDot,
  date: Calendar,
  person: User,
  checkbox: SquareCheck,
  url: Link,
  email: AtSign,
  phone: Phone,
  files: Paperclip,
  relation: ArrowUpRight,
  rollup: Sigma,
  formula: SquareFunction,
  created_time: Clock,
  last_edited_time: ClockArrowUp,
  unique_id: ScanBarcode,
  rating: Star,
}

export const VIEW_ICON: Record<ViewType, LucideIcon> = {
  table: Table,
  board: SquareKanban,
  list: Rows3,
  gallery: LayoutGrid,
  calendar: CalendarDays,
  timeline: ChartGantt,
  chart: ChartColumn,
}

export const VIEW_TYPES: ViewType[] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart']

/** Types offered in "add property" / "change type" pickers, grouped. */
export const CREATABLE_TYPES: PropertyType[][] = [
  ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'rating'],
  ['url', 'email', 'phone', 'files'],
  ['relation', 'rollup', 'formula'],
  ['created_time', 'last_edited_time', 'unique_id'],
]

export const COMPUTED_TYPES: PropertyType[] = ['formula', 'rollup', 'created_time', 'last_edited_time', 'unique_id']
export const isComputed = (p: PropertyDef) => COMPUTED_TYPES.includes(p.type)
/** Values the user can't type into. */
export const isReadOnly = (p: PropertyDef) => isComputed(p)

export const isOptionType = (t: PropertyType) => t === 'select' || t === 'multi_select' || t === 'status'
export const isTextType = (t: PropertyType) => t === 'title' || t === 'text' || t === 'url' || t === 'email' || t === 'phone'
export const isNumberType = (t: PropertyType) => t === 'number' || t === 'rating' || t === 'unique_id'
export const isDateType = (t: PropertyType) => t === 'date' || t === 'created_time' || t === 'last_edited_time'

/** Abstract value kind used by filters / calculations / grouping. */
export type ValueKind = 'text' | 'number' | 'select' | 'multi' | 'person' | 'relation' | 'date' | 'checkbox' | 'files' | 'computed'

export function valueKind(t: PropertyType): ValueKind {
  switch (t) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return 'text'
    case 'number':
    case 'rating':
    case 'unique_id':
      return 'number'
    case 'select':
    case 'status':
      return 'select'
    case 'multi_select':
      return 'multi'
    case 'person':
      return 'person'
    case 'relation':
      return 'relation'
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'files':
      return 'files'
    default:
      return 'computed'
  }
}

const TEXT_OPS: FilterOperator[] = ['contains', 'not_contains', 'is', 'is_not', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']
const NUMBER_OPS: FilterOperator[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty']
const SELECT_OPS: FilterOperator[] = ['is', 'is_not', 'is_empty', 'is_not_empty']
const MULTI_OPS: FilterOperator[] = ['contains', 'not_contains', 'is_empty', 'is_not_empty']
const DATE_OPS: FilterOperator[] = ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within_past_week', 'within_next_week', 'this_month', 'is_empty', 'is_not_empty']
const CHECK_OPS: FilterOperator[] = ['is_checked', 'is_not_checked']

/** Operators for a value kind ('computed' kinds are resolved from sample values first). */
export function operatorsFor(kind: ValueKind | 'boolean'): FilterOperator[] {
  switch (kind) {
    case 'text':
    case 'relation':
    case 'computed':
      return TEXT_OPS
    case 'number':
      return NUMBER_OPS
    case 'select':
      return SELECT_OPS
    case 'multi':
    case 'person':
      return MULTI_OPS
    case 'date':
      return DATE_OPS
    case 'checkbox':
    case 'boolean':
      return CHECK_OPS
    case 'files':
      return ['is_empty', 'is_not_empty']
  }
}

/** Operators that don't need a value. */
export const VALUELESS_OPS: FilterOperator[] = ['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked', 'within_past_week', 'within_next_week', 'this_month']

const BASE_CALCS: CalcFn[] = ['count', 'count_values', 'count_unique', 'count_empty', 'count_not_empty', 'percent_empty', 'percent_not_empty']
const NUM_CALCS: CalcFn[] = ['sum', 'average', 'median', 'min', 'max', 'range']
const DATE_CALCS: CalcFn[] = ['earliest_date', 'latest_date', 'range']

export function calcsFor(kind: ValueKind | 'boolean'): CalcFn[] {
  if (kind === 'number') return ['none', ...BASE_CALCS, ...NUM_CALCS]
  if (kind === 'date') return ['none', ...BASE_CALCS, ...DATE_CALCS]
  if (kind === 'checkbox' || kind === 'boolean') return ['none', 'count', 'count_not_empty', 'count_empty', 'percent_checked']
  return ['none', ...BASE_CALCS]
}

export const ROLLUP_FNS: RollupFn[] = [
  'show_original',
  'count',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'percent_checked',
  'earliest_date',
  'latest_date',
]

/** Can the board/group-by use this property? */
export const BOARD_GROUP_TYPES: PropertyType[] = ['status', 'select', 'multi_select', 'person', 'checkbox']
export const TABLE_GROUP_TYPES: PropertyType[] = [
  'status',
  'select',
  'multi_select',
  'person',
  'checkbox',
  'relation',
  'text',
  'url',
  'email',
  'phone',
  'number',
  'rating',
  'date',
  'created_time',
  'last_edited_time',
  'formula',
]
