/**
 * Workspace data model. This file is the CONTRACT between all app areas
 * (shell, editor, database, features). Extend carefully and keep it backwards
 * compatible — persisted workspaces must keep loading (see migrate() in persistence.ts).
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'

export type ID = string

/** Notion-style colour names. CSS: var(--c-<name>-text) / var(--c-<name>-bg). */
export type ColorName =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'

export const COLOR_NAMES: ColorName[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]

/**
 * Page icon.
 * - emoji: a unicode emoji
 * - asset: name of a generated icon in public/assets/icons/<value>.webp (see manifest.json)
 * - lucide: a lucide-react icon name (PascalCase, e.g. "Rocket"), optionally tinted
 */
export type PageIcon =
  | { type: 'emoji'; value: string }
  | { type: 'asset'; value: string }
  | { type: 'lucide'; value: string; color?: ColorName }

/**
 * Page cover.
 * - image: URL (https://…, a public asset path like "assets/covers/dunes.webp",
 *   or an internal file ref "onefile:<id>" — resolve with useFileUrl())
 * - gradient: a CSS background value
 * - color: a solid content colour
 * positionY: 0–100, object-position for repositioning.
 */
export type PageCover =
  | { type: 'image'; value: string; positionY: number }
  | { type: 'gradient'; value: string; positionY: number }
  | { type: 'color'; value: ColorName; positionY: number }

export type PageFont = 'sans' | 'serif' | 'mono'

export interface PageSettings {
  fullWidth: boolean
  smallText: boolean
  font: PageFont
  locked: boolean
}

export interface Page {
  id: ID
  kind: 'page' | 'database'
  title: string
  icon: PageIcon | null
  cover: PageCover | null
  /** Parent page id, or null for workspace root. Database rows: the database page id. */
  parentId: ID | null
  /** If this page is a row of a database: that database's id (== database page id). */
  databaseId: ID | null
  /** Row property values keyed by PropertyDef.id (title lives in page.title). */
  properties: Record<ID, PropertyValue>
  /** TipTap document JSON ({ type: 'doc', content: [...] }) or null for empty. */
  content: JSONContent | null
  /** Incremented on every content change. */
  contentRev: number
  /** Who wrote the latest content: an editor instance id, 'history', 'ai', 'sync', 'import'… */
  contentOrigin: string | null
  favorite: boolean
  trashed: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
  /** Sort order among siblings (ascending; fractional values allowed). */
  order: number
  settings: PageSettings
  /** Hidden from the sidebar tree (e.g. database rows are never shown there anyway). */
  hidden?: boolean
  /** Optional plain-text excerpt cache (search/graph); maintained by setContent(). */
  plain?: string
}

/* ------------------------------------------------------------------ */
/* Databases                                                           */
/* ------------------------------------------------------------------ */

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'files'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'created_time'
  | 'last_edited_time'
  | 'unique_id'
  | 'rating'

export type StatusGroup = 'todo' | 'in_progress' | 'done'

export interface SelectOption {
  id: ID
  name: string
  color: ColorName
  /** Only for status properties. */
  group?: StatusGroup
}

export type NumberFormat = 'number' | 'comma' | 'percent' | 'euro' | 'dollar' | 'pound'
export type NumberDisplay = 'number' | 'bar' | 'ring'

export type RollupFn =
  | 'show_original'
  | 'count'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'percent_checked'
  | 'earliest_date'
  | 'latest_date'

export interface PropertyDef {
  id: ID
  name: string
  type: PropertyType
  /** select / multi_select / status */
  options?: SelectOption[]
  numberFormat?: NumberFormat
  numberDisplay?: NumberDisplay
  /** relation: target database id */
  relationDatabaseId?: ID
  /** rollup: relation property (in THIS db) + property in the related db + aggregation */
  rollup?: { relationPropertyId: ID; targetPropertyId: ID; fn: RollupFn }
  /** formula expression (see database/formula) */
  formula?: string
  /** unique_id prefix, e.g. "TASK" → TASK-12 */
  idPrefix?: string
  /** rating: max stars (default 5) */
  ratingMax?: number
  /** Optional description shown as tooltip. */
  description?: string
}

export interface DateValue {
  /** ISO date "2026-10-02" or datetime "2026-10-02T14:30" (local time, no TZ). */
  start: string
  end?: string | null
  includeTime?: boolean
}

/**
 * Stored values by type:
 * text/url/email/phone → string
 * number/rating/unique_id → number | null
 * select/status → option id | null
 * multi_select/person/relation/files → string[] (option ids / person ids / page ids / file urls)
 * date → DateValue | null
 * checkbox → boolean
 * formula/rollup/created_time/last_edited_time → computed, never stored
 */
export type PropertyValue = string | number | boolean | null | string[] | DateValue

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'within_past_week'
  | 'within_next_week'
  | 'this_month'
  | 'is_checked'
  | 'is_not_checked'

export interface Filter {
  id: ID
  propertyId: ID
  operator: FilterOperator
  value?: PropertyValue
}

export interface FilterGroup {
  id: ID
  op: 'and' | 'or'
  items: Array<Filter | FilterGroup>
}

export interface Sort {
  propertyId: ID
  direction: 'asc' | 'desc'
}

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'chart'

export type CalcFn =
  | 'none'
  | 'count'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'percent_checked'
  | 'earliest_date'
  | 'latest_date'

export interface ChartConfig {
  kind: 'bar' | 'line' | 'donut'
  /** property to group by on the x axis / slices */
  xPropertyId: ID | null
  aggregate: 'count' | 'sum' | 'average'
  /** numeric property for sum/average */
  yPropertyId?: ID | null
}

export interface View {
  id: ID
  name: string
  type: ViewType
  filter: FilterGroup | null
  sorts: Sort[]
  /** Visible property ids in display order (title is always shown). */
  visibleProperties: ID[]
  propertyWidths?: Record<ID, number>
  /** board: select/status/person/checkbox property; table/list: optional grouping */
  groupBy?: ID | null
  /** Hidden group keys (board columns) */
  hiddenGroups?: string[]
  /** calendar/timeline: date property */
  dateProperty?: ID | null
  /** gallery/board card preview */
  cardPreview?: 'none' | 'cover' | 'content' | ID
  cardSize?: 'small' | 'medium' | 'large'
  calculations?: Record<ID, CalcFn>
  wrapCells?: boolean
  chart?: ChartConfig
  openIn?: 'peek' | 'center' | 'full'
}

export interface Database {
  /** Same id as the database's Page. */
  id: ID
  properties: PropertyDef[]
  views: View[]
  /** Next value for unique_id properties. */
  nextUniqueId: number
  /** Show as inline block (true) vs. full page database. */
  inline?: boolean
  /** Row templates: page content + preset properties. */
  templates?: Array<{ id: ID; name: string; icon?: PageIcon | null; content: JSONContent | null; properties: Record<ID, PropertyValue> }>
  /** Automations (webhooks etc.), managed by features/automations. */
  automations?: Automation[]
}

export type AutomationTrigger =
  | { type: 'row_created' }
  | { type: 'row_deleted' }
  | { type: 'property_changed'; propertyId: ID | null /* null = any */ ; toValue?: PropertyValue }

export type AutomationAction =
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT'; headers?: Record<string, string> }
  | { type: 'set_property'; propertyId: ID; value: PropertyValue }
  | { type: 'notify'; message: string }

export interface Automation {
  id: ID
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
  lastRunAt?: number | null
  lastStatus?: 'ok' | 'error' | null
  lastMessage?: string | null
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export interface Person {
  id: ID
  name: string
  color: ColorName
}

export type ThemePref = 'light' | 'dark' | 'system'

export interface Settings {
  language: Lang
  theme: ThemePref
  /** Workspace display name */
  workspaceName: string
  userName: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Page opened on start; null = last visited */
  startPageId: ID | null
  lastPageId: ID | null
  /** Spell check in editor */
  spellcheck: boolean
  /** BYOK Claude API key (stored locally only). */
  aiApiKey: string
  aiModel: string
  /** Snapshot interval for version history in minutes */
  historyIntervalMin: number
}

export interface Workspace {
  version: number
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  settings: Settings
  /** Recently visited page ids, newest first (max 20). */
  recent: ID[]
}
