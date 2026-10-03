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
  /** Comment threads (margin notes), anchored by `comment` marks (attrs: id) in `content`. */
  comments?: PageComment[]
  /**
   * Team workspaces: account ids (= person ids of members) of who created / last changed the page,
   * from the meta document (`api:<id>` / `hook:<id>` for the public API). Absent in the local workspace.
   */
  createdBy?: string | null
  updatedBy?: string | null
  /**
   * Team workspaces: the page lives in this member's PRIVATE meta document (sidebar "Private": only
   * they can see it — subpages, databases and rows below it too). A local marker set by the cloud
   * binding from where the page is stored; never a synced field. Absent = the workspace's (shared)
   * pages, and always in the local workspace. Move pages between the two with the cloud area's
   * `movePagePrivacy()` (docs/CLOUD.md § Private pages), never by setting this.
   */
  private?: true
  /**
   * Templates (features/templates): this page is the ROOT of a template, kept in the hidden
   * Templates area (root pages with `hidden: true`). Its subpages, databases and rows are ordinary
   * pages below it — editing a template is editing those pages. The whole subtree stays out of
   * normal use (sidebar, search, graph, agenda, reminders, backlinks, recent, folder sync, agent,
   * exports): ask `inTemplate()` / `templateRootOf()` in store/selectors.ts. "Use" deep-copies the
   * subtree with fresh ids. Absent on every other page. Synced in team workspaces like any field.
   */
  template?: PageTemplate
}

export type TemplateCategory = 'work' | 'product' | 'personal' | 'knowledge'

/** Gallery metadata of a template root page (Page.template). */
export interface PageTemplate {
  /** Name in the gallery (the root page's title is what copies are called). */
  name: string
  description?: string
  category?: TemplateCategory | null
  /** Gallery art (absent = the root page's icon). */
  icon?: PageIcon | null
  /** A customised built-in: the id of the catalog template it was made from (features/templates/catalog.ts). */
  from?: string
}

/* ------------------------------------------------------------------ */
/* Comments (margin notes)                                             */
/* ------------------------------------------------------------------ */

export interface PageCommentReply {
  id: ID
  /** settings.userName at the time of writing ('' = the local user without a name). */
  author: string
  body: string
  createdAt: number
  updatedAt: number
}

/**
 * A comment thread on a page. Its anchor is a `comment` mark with the same id in the page
 * content; when that text is deleted the thread stays as "detached" and shows its `quote`.
 * Comments never leave the device: share links, exports and AI context strip the mark and the
 * data (only the JSON backup keeps them).
 */
export interface PageComment {
  id: ID
  /** The anchored text when the thread was started. */
  quote: string
  body: string
  author: string
  createdAt: number
  updatedAt: number
  resolved: boolean
  replies: PageCommentReply[]
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
  /** Who created / last edited the row: Page.createdBy / updatedBy (team), the local user (local). */
  | 'created_by'
  | 'last_edited_by'

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
  /** AI autofill (text, number, select, multi_select, checkbox, url). Absent = off. Managed by database/autofill. */
  autofill?: AutofillConfig
}

/** What Claude fills a property with. */
export type AutofillPreset = 'summary' | 'extract' | 'translate' | 'categorize' | 'custom'

export interface AutofillConfig {
  preset: AutofillPreset
  /** extract: what to pull out · custom: the instruction */
  prompt?: string
  /** translate: target language (English name, e.g. "German") */
  language?: string
  /** translate: what to translate — a property id (title included) or 'content'. Default: the title. */
  source?: ID | 'content'
  /** categorize: Claude may propose option names that don't exist yet */
  allowNewOptions?: boolean
  /** Re-fill a row (debounced, only while the app is open) when its title, content or other properties change. */
  auto?: boolean
  /** Write results directly instead of collecting them for review. */
  skipReview?: boolean
  /** Per row: when it was last filled and a fingerprint of the context that was sent (auto update skips unchanged rows). */
  fills?: Record<ID, { at: number; hash: string }>
}

export interface DateValue {
  /** ISO date "2026-10-02" or datetime "2026-10-02T14:30" (local time, no TZ). */
  start: string
  end?: string | null
  includeTime?: boolean
  /**
   * Reminder relative to `start` (absent / null = none): 'at' · '-5m' … '-2h' · '-1d' · '-2d' · '-1w'
   * (all-day dates count from 09:00). Codes: features/inbox/reminders.ts. Fires per device (inbox).
   */
  reminder?: string | null
}

/**
 * Stored values by type:
 * text/url/email/phone → string
 * number/rating/unique_id → number | null
 * select/status → option id | null
 * multi_select/person/relation/files → string[] (option ids / person ids / page ids / file urls)
 * date → DateValue | null
 * checkbox → boolean
 * formula/rollup/created_time/last_edited_time/created_by/last_edited_by → computed, never stored
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

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'chart' | 'form'

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

/** Form view: one question per property. Which and in what order = title + view.visibleProperties. */
export interface FormQuestion {
  required?: boolean
  /** Help text shown under the question. */
  help?: string
  /** date questions: also ask for a time */
  includeTime?: boolean
  /** title question only (it is not part of visibleProperties): leave it out of the form */
  hidden?: boolean
  /** Placeholder inside the answer field (text, number, dropdown questions). */
  placeholder?: string
  /**
   * How the question is shown (absent = the kind's default):
   * select/status 'chips' | 'list' | 'dropdown' · multi-select 'chips' | 'list' ·
   * rating / number 'scale' (numbered keys) · text 'long' | 'short'.
   */
  display?: FormDisplay
  /** number questions shown as a scale: 1–5 (default) or 1–10 */
  scale?: 5 | 10
  /** Show this question only if … (absent / no conditions = always shown). See database/form/logic.ts. */
  showIf?: FormLogic
}

export type FormDisplay = 'chips' | 'list' | 'dropdown' | 'scale' | 'short' | 'long'

/** A condition on the answer to an EARLIER question of the same form. */
export interface FormCondition {
  /** property id of the question it looks at */
  q: ID
  op: FormConditionOp
  /** select / multi-select: option id · number: a number · text: the text to find · date: "YYYY-MM-DD" */
  value?: string | number | null
}

export type FormConditionOp = 'is' | 'is_not' | 'contains' | 'not_contains' | 'empty' | 'not_empty' | 'checked' | 'unchecked' | 'eq' | 'gt' | 'lt' | 'before' | 'after'

export interface FormLogic {
  /** and: every condition holds · or: any one does */
  op: 'and' | 'or'
  conditions: FormCondition[]
}

/** A page break: a new page (section) of the form starts at the question `before` (a property id). */
export interface FormPageBreak {
  id: ID
  before: ID
  title?: string
  description?: string
}

export interface FormConfig {
  /** Heading (default: the database name). */
  title?: string
  description?: string
  submitLabel?: string
  /** Per-question settings keyed by PropertyDef.id. */
  questions?: Record<ID, FormQuestion>
  /** Responses from a shared form link are POSTed here (n8n / Make / Zapier …). */
  webhookUrl?: string
  /** Page breaks (multi-page form); the first page always starts with the first question. */
  pages?: FormPageBreak[]
  /** Closing screen after a response: heading + message (defaults: "Response recorded" …). */
  doneTitle?: string
  doneMessage?: string
  /** Shared links: after submitting, respondents continue to this http(s) address. */
  redirectUrl?: string
  /** Offer "Submit another response" after submitting (absent = true). */
  allowAnother?: boolean
  /** Responses made in the workspace get this option of a select property, so they can be told apart and counted. */
  marker?: { propertyId: ID; optionId: ID }
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
  /** form view settings (optional; older workspaces have none) */
  form?: FormConfig
  openIn?: 'peek' | 'center' | 'full'
  /** With sub-items on: nested (table/list, default) · flattened · parents only (hides sub-items). */
  subItems?: SubItemsDisplay
  /** Conditional colours, evaluated top to bottom; the first matching rule wins. */
  colorRules?: ColorRule[]
}

export type SubItemsDisplay = 'nested' | 'flattened' | 'parents'

/** A conditional colour of a view: rows matching `filter` get `color` on `target`. */
export interface ColorRule {
  id: ID
  filter: FilterGroup
  color: ColorName
  /** background: row / card tint · accent: left bar · text: coloured text */
  target: 'background' | 'accent' | 'text'
}

/**
 * Sub-items: a two-way self-relation pair (parent → `<parent id>.2way` children). Switching the
 * feature off keeps the config with enabled=false when the properties stay, so it can be reused.
 */
export interface SubItemsConfig {
  enabled: boolean
  parentPropertyId: ID
  childPropertyId: ID
}

/** Dependencies (timeline): a two-way self-relation pair "Blocked by" ↔ "Blocking". */
export interface DependenciesConfig {
  enabled: boolean
  blockedByPropertyId: ID
  blockingPropertyId: ID
  /** Moving a blocker past its dependents: shift them later (default) or only flag the conflict. */
  onConflict?: 'shift' | 'warn'
}

/**
 * Recurring row template (absent / null = off). Times are local wall-clock time, so every device
 * means "08:00 where I am". Rows get deterministic ids per occurrence (features/templates/recurring).
 */
export interface TemplateRepeat {
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval'
  /** weekly: days of the week, 0 = Sunday … 6 = Saturday */
  days?: number[]
  /** monthly: day of the month 1–31 (short months use their last day) */
  dayOfMonth?: number
  /** interval: every N days, counted from `start` */
  every?: number
  /** "HH:MM" (default "08:00") */
  time: string
  /** first day, "YYYY-MM-DD" */
  start: string
  /** last day (inclusive), "YYYY-MM-DD" */
  end?: string | null
  /** Title of new rows; variables {{name}} {{date}} {{weekday}} {{week}} {{time}} … */
  title?: string
  /** Date property preset to the occurrence's day (null = none). */
  dateProperty?: ID | null
  /** Occurrences up to this moment (ms) are handled: created, skipped, or before the repeat was set. */
  lastRunAt?: number
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
  /** Row templates: page content + preset properties (+ an optional repeat schedule). */
  templates?: Array<{ id: ID; name: string; icon?: PageIcon | null; content: JSONContent | null; properties: Record<ID, PropertyValue>; repeat?: TemplateRepeat | null }>
  /** Automations (webhooks etc.), managed by features/automations. */
  automations?: Automation[]
  /** Sub-items (absent = never enabled). Managed by database/model/hierarchy. */
  subItems?: SubItemsConfig | null
  /** Dependencies between rows (absent = never enabled). Managed by database/model/hierarchy. */
  dependencies?: DependenciesConfig | null
  /**
   * Locked (Notion's "Lock database"): properties and views can't be added, changed, deleted or
   * reordered; rows stay editable. Anyone who can edit unlocks it. See database/model/lock.ts.
   */
  locked?: boolean
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
  /**
   * BYOK Claude API key — as a vault MARKER ("vault:<seal id>:<last 4>", '' = no key), never the key
   * itself: updateSettings({ aiApiKey: <key> }) seals the key into this browser's vault (lib/vault.ts)
   * and stores the marker; '' removes it. `!!aiApiKey` = "a key is set"; only the AI client reads the
   * key (store/secrets.ts getAIKey()). Never exported, synced or shared.
   */
  aiApiKey: string
  aiModel: string
  /** Snapshot interval for version history in minutes */
  historyIntervalMin: number
}

export interface Workspace {
  version: number
  /**
   * Identity of this workspace's lifetime: a fresh id when a workspace is created (first run,
   * after an erase). Unsaved edits stashed on unload are only restored into the same epoch.
   */
  epoch?: string
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  settings: Settings
  /** Recently visited page ids, newest first (max 20). */
  recent: ID[]
}
