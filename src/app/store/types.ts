/**
 * Workspace data model. This file is the CONTRACT between all app areas
 * (shell, editor, database, features). Extend carefully and keep it backwards
 * compatible — persisted workspaces must keep loading (see migrate() in persistence.ts).
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import type { DeviceAI, RouteRule, WorkspaceAI } from '@/shared/ai/types'
import type { AgentReview, AgentReviewV2, SaverRule, Unreadable } from '@/shared/ai/route'
import type { WorkspaceGovernor } from '@/shared/ai/governor'

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
   * A database row's record type (Workspace.kit.recordTypes, features/kit): the row shows that type's
   * properties (PropertyDef.fromType) plus the database's own ones. Absent / null = none. Write only with
   * setRecordType.
   */
  recordType?: ID | null
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
   * exports; pickers offer it only on its own pages): ask `inTemplate()` / `templateRootOf()` /
   * `templateScope()` in store/selectors.ts. "Use" deep-copies the
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
  /**
   * An own property type (Workspace.kit.propTypes, features/kit): `type` is that type's base (base 'free'
   * → 'text'); display, check, options and computed value come from the own type. Unknown id = plain base.
   */
  custom?: ID
  /** select / multi_select: a shared list (Workspace.kit.lists) — `options` is its copy, kept in step by upsertList. */
  listId?: ID
  /** Comes from a record type (Workspace.kit.recordTypes): kept in step by upsertRecordType (never deleted by it). */
  fromType?: { id: ID; prop: ID }
  /**
   * "Key" (store/keys.ts): this property identifies a row — text, number or url only, at most one per database; its
   * values are unique per database (empty allowed). Agents' upsert_rows find rows by it; every writer refuses a value
   * another row holds already (agent tools, MCP, the team server, a person's cell). Absent = no key.
   */
  key?: true
  /**
   * "Only by hand": agents never write this property (custom agents, the server runner, the AI terminal, MCP writes are
   * refused naming it); people edit it as usual. Absent = agents may write it.
   */
  agentReadOnly?: true
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

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'chart' | 'form' | 'feed'

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
  /** bar / line / donut · stacked / area / kpi (drawn by features/charts, additive) */
  kind: 'bar' | 'line' | 'donut' | 'stacked' | 'area' | 'kpi'
  /** property to group by on the x axis / slices */
  xPropertyId: ID | null
  aggregate: 'count' | 'sum' | 'average'
  /** numeric property for sum/average */
  yPropertyId?: ID | null
  /** split into series by this property (stacked / grouped bars, several lines); absent = one series */
  seriesPropertyId?: ID | null
  /** date x axis: bucket size (absent = month) */
  dateBucket?: 'day' | 'week' | 'month' | 'quarter' | 'year'
}

/**
 * Feed view (database/views/FeedView): the rows as a stream of entries with their page content.
 * Without sorts of its own a feed shows the newest entries first. All fields optional (absent = default).
 */
export interface FeedConfig {
  /** The date it orders and stamps entries by: a date / created time / last edited property (absent / null = created time). */
  dateProperty?: ID | null
  /** newest first (default) or oldest first — only while the view has no sorts */
  order?: 'newest' | 'oldest'
  /** Show each page's content under its entry (default true). */
  content?: boolean
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
  /** feed view settings (optional) */
  feed?: FeedConfig
  openIn?: 'peek' | 'center' | 'full'
  /** With sub-items on: nested (table/list, default) · flattened · parents only (hides sub-items). */
  subItems?: SubItemsDisplay
  /** Conditional colours, evaluated top to bottom; the first matching rule wins. */
  colorRules?: ColorRule[]
  /**
   * board: a FREE board (features/kit) — lanes are the options of the `groupBy` select created with the board
   * (adding a lane adds an option), cards carry any record type and show that type's fields, "+" offers the
   * record types. Absent = an ordinary board.
   */
  free?: boolean
  /**
   * free board: the fields a card shows per record type (key: the type id, `__plain__` = cards without a
   * type), in order. Absent for a type = the first 3 non-empty of its fields (database/views/free).
   */
  typeFields?: Record<ID, ID[]>
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
  /**
   * A database One looks for by itself (features/ai/memory): 'memory' = the One memory ("One memory" /
   * "One-Gedächtnis") · 'memory-log' = its usage log ("Memory log" / "Gedächtnis-Verlauf", two-way
   * relations to the memory). Only a marker: the database stays an ordinary database the person edits.
   * Several (a duplicate, a restored backup): the oldest live one counts; in a team workspace only a
   * private one; a deleted one is simply created again on next use.
   * 'mail-contacts' / 'mail-companies' / 'mail-conversations' = the directories the Gmail sync fills
   * (features/mail/people.ts) — same rules.
   * 'coding' = the coding pipeline's tasks (features/coding: rows = tasks for one-worker) — same rules.
   * 'mails' = a database the Gmail sync made (or wrote into): its rows are mail wherever it is — the AI data class
   *   `mail` — also once this device's sync points elsewhere (settings.mail.databaseId). Only that marker: the sync
   *   still writes only into settings.mail.databaseId, and every list that hides system databases keeps it.
   * 'workorders' = the work orders ("Prüfaufträge", features/coding/orders): one row per request a chain of pipeline tasks
   *   (Business analysis → Coding → QA) is planned from — its config in `orders`. Team: a private one only.
   */
  system?: 'memory' | 'memory-log' | 'mail-contacts' | 'mail-companies' | 'mail-conversations' | 'mails' | 'coding' | 'spec' | 'qa' | 'testcases' | 'workorders'
  /**
   * The coding pipeline (features/coding, only on the 'coding' database): one entry per option of its
   * Stage select, in the options' order. Absent = every stage is a plain queue. Write only with
   * savePipeline (features/coding); every reader sanitizes (readPipeline). `locked` blocks changing it.
   */
  pipeline?: PipelineStage[]
  /**
   * Database commands (features/commands): the order of the menu (sidebar key, toolbar, ⌘K), defaults
   * switched off, and own commands. Absent = the defaults in their order. Write only with
   * saveDbCommands (features/commands); every reader sanitizes (readDbCommands). `locked` blocks
   * changing them (running stays allowed).
   */
  commands?: DbCommand[]
  /**
   * Record types this database holds (Workspace.kit.recordTypes, features/kit): their properties are in
   * `properties` with `fromType`. Write only with attachRecordType / setRecordType / upsertRecordType.
   */
  recordTypes?: ID[]
  /**
   * The work orders' config (features/coding/orders), only on a `system: 'workorders'` database — a plain value (the
   * cloud binding copies it, an older build keeps it). Write only with saveOrderConfig (refused on a `locked` database);
   * every reader sanitizes (readOrderConfig: unknown keys kept; a `v` above 1 is unreadable — no auto mode, the
   * checkpoint on, never overwritten). Full backups carry it; this device's auto consent and chain records never live
   * here (localStorage / IndexedDB one-coding).
   */
  orders?: OrderConfig
}

/** The pipelines a work order plans steps for (features/coding/schema.ts PipelineKind): BA · Coding · QA. */
export type OrderKind = 'spec' | 'coding' | 'qa'

/** The states of a work order, each one option of its Status select (by id — never matched by its name). */
export type OrderStatusKey = 'draft' | 'plan' | 'ready' | 'running' | 'halted' | 'done'

/**
 * A work-orders database's config (Database.orders, features/coding/orders): which Status option is which state, the
 * optional context server (the person's own pick, by the name they gave it — read tools only; null = without a
 * server), the pipelines a chain may use and the project pinned per kind (absent: as #/coding shows it; a row's own
 * Repo / Pipelines fields come first), "Stop after the analysis", the budget per chain (USD, this device's worker cost
 * reports — TaskLocal.spentUsd).
 */
export interface OrderConfig {
  agent?: 'claude' | 'codex' | 'local' | 'minimax' | 'ollama'
  agents?: Partial<Record<OrderKind, 'claude' | 'codex' | 'local' | 'minimax' | 'ollama'>>
  v: 1
  status: Record<OrderStatusKey, ID>
  server: { name: string } | null
  kinds: OrderKind[]
  projects?: Partial<Record<OrderKind, ID>>
  checkpoint: boolean
  /** Explicit opt-in, pinned at chain confirmation. */
  qaRepairs?: 1 | 2
  budgetUsd?: number
}

/**
 * A stage of the coding pipeline (Database.pipeline, features/coding). `id` = the id of its option in the
 * Stage select. queue: tasks wait (auto: the worker takes them on to the next stage) · plan: Claude Code in
 * plan mode writes the plan into the task page · gate: waits for the person (Approve / Rework) · implement:
 * Claude Code edits the worktree · test: the repo's test command (worker.json) · git: commit / push / pull
 * request / update from base · done · import: the task's code arrives (a ZIP or clone address in the task panel → a
 * new repo, then the task moves on) · doc: Claude Code only reads and writes a document into the page.
 */
export interface PipelineStage {
  id: ID
  kind: 'queue' | 'import' | 'analyze' | 'plan' | 'doc' | 'gate' | 'implement' | 'test' | 'git' | 'done'
  /** what Claude Code is told in this stage (absent / '' = the default of its kind) */
  instructions?: string
  /** the worker takes tasks in this stage by itself (otherwise: "Run now" in the task) */
  auto: boolean
  /** the stage after this one (absent / null = the next option) */
  next?: ID | null
  /** Claude Code's permission mode (plan stages always run in plan mode) */
  permissionMode?: 'plan' | 'acceptEdits' | 'default'
  /** 1–200 (the worker's config may lower it) */
  maxTurns?: number
  /** git stages */
  gitAction?: 'commit' | 'push' | 'pr' | 'update-base' | 'comment' | 'merge'
  /**
   * document stages: 'testcases' = the document's test cases also become rows of the Test cases database ·
   * 'pages' = every `##` section becomes a page under one documentation page (a page tree, updated on a re-run) ·
   * 'review' = the document is the task's review (a git 'comment' stage posts it; "Post review" in the task) ·
   * 'stories' = the document's stories become tasks of a NEW coding project (its own database)
   */
  output?: 'testcases' | 'pages' | 'review' | 'stories'
  /**
   * stages that run Claude Code (plan · implement · doc): the model it runs with — an alias Claude Code accepts
   * ('opus' · 'sonnet' · 'haiku'), a full model id or an own name (features/coding/protocol.ts MODEL_NAME). Absent /
   * null = the worker's default (the repo's `claude.model` in worker.json, else Claude Code's own). A task may pick
   * its own on a device (TaskLocal.model). Sanitized in readPipeline, written with savePipeline.
   */
  model?: string | null
  /**
   * gates only: "Always stop here" — Approvals never skip this gate ("None — just do it" waits here too). Absent = no.
   * Part of a task's version only when set (features/coding/trust.ts). Sanitized in readPipeline, written with savePipeline.
   */
  hold?: boolean
}

/**
 * One entry of a database's command menu (features/commands). Defaults (New entry, Export CSV, Sync now,
 * Run "<agent>" now …) are computed — an entry with kind 'default' only stores the place and `hidden`
 * of the default whose key is `id`. Every other kind is an own command with `label`, `icon` and
 * `config` (JSON, each kind sanitizes its own): 'actions' { actions: ButtonAction[] (editor/schema/button.ts) }
 * · 'agent' { agentId } · 'view' { viewId } · a kind added with registerCommandKind (e.g. 'script').
 */
export interface DbCommand {
  /** a default's key ('new-entry', 'mail-sync', 'agent:<agentId>' …) or the own command's id */
  id: string
  /** 'default' · 'actions' · 'agent' · 'view' · a registered kind ([a-z][a-z0-9-]{1,23}) */
  kind: string
  /** not in the menus (defaults and own commands) */
  hidden?: boolean
  /** own commands: 1–60 characters */
  label?: string
  icon?: PageIcon | null
  config?: Record<string, unknown>
}

export type AutomationTrigger =
  | { type: 'row_created' }
  | { type: 'row_deleted' }
  | { type: 'property_changed'; propertyId: ID | null /* null = any */ ; toValue?: PropertyValue }

export type AutomationAction =
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT'; headers?: Record<string, string> }
  | { type: 'set_property'; propertyId: ID; value: PropertyValue }
  | { type: 'notify'; message: string }
  /** a saved One Script (features/script) for the row (page.current); null = not picked yet */
  | { type: 'run_script'; scriptId: ID | null }

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
  /** Display only. Ledgers, provider prices and budget limits remain USD. */
  costDisplay?: { currency: 'USD' | 'EUR'; eurPerUsd?: number; date?: string; source?: 'ecb' | 'manual' }
  /**
   * Keys of the other AI providers — vault MARKERS like aiApiKey ("vault:<seal id>:<last 4>"), never a key; nothing
   * writes them before multi-provider slice 2, but every reader keeps them (only `vault:` markers). Never exported,
   * backed up, synced or shared (a restore keeps this device's).
   */
  aiKeys?: Partial<Record<'openai' | 'openrouter', string>>
  /**
   * The AI rules of this device (src/shared/ai/types.ts DeviceAI: routes per class, device default, member-data allows,
   * narrowing, restrictions, the OpenRouter shortlist). Never in defaultSettings() (a restore keeps this device's),
   * never synced; every reader sanitizes (store/ai.ts readDeviceAI). Written by nobody in slice 1.
   */
  ai?: DeviceAI
  /** Snapshot interval for version history in minutes */
  historyIntervalMin: number
  /**
   * Remote MCP servers Claude may use (Messages API MCP connector, features/ai/mcp-servers): per
   * device like every setting — never synced. Absent = none. Write the list only through
   * updateSettings({ mcpServers }): a plaintext `token` in it is sealed into the vault there.
   */
  mcpServers?: McpServerConfig[]
  /** The MCP instructions template added to Claude's system prompt; absent / '' = the built-in default (UI language). */
  mcpInstructions?: string
  /**
   * Gmail → a "Mails" database (features/mail): per device like every setting, never synced. Holds no
   * secret — the OAuth client ID is public, access tokens live in the tab's memory only. Absent = never
   * set up. Write it only through the mail area (features/mail/settings.ts), which normalizes it.
   */
  mail?: MailSettings
  /**
   * One memory (features/ai/memory): per device like every setting, never synced. Absent = the defaults
   * (memory on; proposals after AI-terminal tasks once a memory database exists).
   */
  memory?: MemorySettings
}

/** Settings → AI → One memory (features/ai/memory/settings.ts reads it with its defaults). */
export interface MemorySettings {
  /** false: no memory goes along with any request, no memory tools, no proposals (absent = on) */
  enabled?: boolean
  /** Claude proposes memories after AI-terminal tasks (absent = on once a memory database exists) */
  proposals?: boolean
  /** a row in the memory log per request that took memories along (absent = on); off = no new rows */
  log?: boolean
}

/** What a property of the Mails database is for (features/mail/schema.ts). */
export type MailPropRole =
  | 'messageId'
  | 'from'
  | 'to'
  | 'date'
  | 'labels'
  | 'thread'
  | 'link'
  | 'attachments'
  | 'unread'
  | 'images'
  /** hidden text: the attachment a "Load" key asked for (features/mail/attachments.ts), cleared once loaded */
  | 'load'
  | 'category'
  | 'priority'
  | 'needsReply'
  | 'summary'
  | 'project'
  /** relations to the three directories the sync fills (features/mail/people.ts): sender · its company · thread */
  | 'contact'
  | 'company'
  | 'conversation'

/** Settings → Mail (features/mail). */
export interface MailSettings {
  /** Google OAuth client ID ("…apps.googleusercontent.com") — public, never a client secret */
  clientId: string
  /** first day to sync, "YYYY-MM-DD" */
  from: string
  /** Gmail label ids to sync (default ['INBOX']) */
  labels: string[]
  excludeSpamTrash: boolean
  /** new mails fetched per run (the rest waits for the next run) */
  maxPerRun: number
  /** 'open' = when One opens · 'interval' = every `everyMin` minutes while open · 'manual' */
  auto: 'open' | 'interval' | 'manual'
  everyMin: number
  /** where a new Mails database goes (a page id; null = top level — the Private section in a team workspace) */
  parentId: ID | null
  /** the Mails database (null = created on the first sync) */
  databaseId: ID | null
  /** property ids of the Mails database by role */
  props?: Partial<Record<MailPropRole, ID>>
  organise: MailOrganise
  /** "Contacts & companies": link each mail to Contacts / Companies / Conversations (on by default) */
  people: MailPeople
  /** "Load attachments automatically" on sync: 'off' (default) · 'media' = PDFs + images ≤ 10 MB · 'all' ≤ 25 MB */
  attachments: 'off' | 'media' | 'all'
}

/** Contacts, companies, conversations (features/mail/people.ts). */
export interface MailPeople {
  enabled: boolean
  /** domains that never become a company (freemail / personal); "yahoo.*" = any ending */
  freemail: string[]
}

/** "Organise with Claude" (off by default; needs the Claude key — mail content then goes to Anthropic). */
export interface MailOrganise {
  enabled: boolean
  categories: string[]
  priority: boolean
  needsReply: boolean
  summary: boolean
  /** a database to relate each mail to (a "Projects" database …); null = none */
  relationDatabaseId: ID | null
}

/** A remote MCP server (Streamable HTTP / SSE over https) that Anthropic connects to on Claude's behalf. */
export interface McpServerConfig {
  id: ID
  /** the `mcp_server_name`: a–z, 0–9, "_" and "-", 1–32 characters, unique in the list */
  name: string
  /** https:// endpoint */
  url: string
  /**
   * Bearer token as a vault MARKER ("vault:<seal id>:<last 4>", '' = none), never the token: sealed in
   * this browser's vault as "mcp-token:<id>" (store/secrets.ts). The token itself is never stored in
   * the clear, exported, synced or shared; only the AI client opens it, per request, for `mcp_servers`.
   */
  token: string
  enabled: boolean
  /** usage guide for Claude, added to the system prompt ('' = none yet) */
  prompt: string
  /** 'auto' = generated and unchanged since · 'edited' = written or changed by the user */
  promptSource?: 'auto' | 'edited'
  /** tool names seen at the last check (display only) */
  tools?: string[]
  /** last successful check (ms since epoch) */
  checkedAt?: number
  /** why the last check failed (a friendly sentence, never a token; cleared by a successful check) */
  checkError?: string
  /**
   * Which requests use the server: absent / 'free' = the agent, own requests to Claude and ⌘K "?" ·
   * 'all' = every AI call (also the one-click actions, autofill, meeting summaries).
   */
  scope?: 'free' | 'all'
  /**
   * Codeword (features/ai/mcp-servers/codeword.ts): a free-form request that starts with "<codeword>:"
   * gets this server attached whatever its scope (unless it is switched off) and Claude is told to
   * answer with its tools first. 1–24 characters a–z, 0–9, "_" and "-", lower case, unique in the
   * list, never "one" (One's own MCP codeword). Absent = none. Not a secret: backups keep it.
   */
  codeword?: string
  /**
   * Link address for the server's records ("https://kb.example.com/"): relative links Claude copies
   * from its results ("/r/11900") open there (lib/foreignLinks.ts). Absent = the server URL's origin
   * when it is the only enabled server. Not a secret.
   */
  linkBase?: string
  /** the last check failed because the server turned the request down (401 / 403): it wants a token or a sign-in */
  checkAuth?: boolean
  /**
   * Signed in with OAuth (features/ai/mcp-servers/oauth.ts) instead of a pasted token: where the server's
   * sign-in lives and the client One registered there — never a token. The access token is `token` (a vault
   * marker as always), a refresh token is sealed as "mcp-refresh:<id>". Absent = a pasted token (or none).
   */
  oauth?: McpOAuthConfig
}

/** An MCP server's OAuth sign-in (authorization code + PKCE, MCP authorization spec). Not a secret. */
export interface McpOAuthConfig {
  /** the authorization server (issuer) */
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  /** the client One registered (dynamic client registration) and the redirect URI it was registered with */
  clientId: string
  redirectUri: string
  /** the protected resource (the MCP server's URL, RFC 8707 `resource`) */
  resource: string
  /** requested scope ('' = none) */
  scope?: string
  /** the access token expires (ms since epoch; absent = not said) — refreshed shortly before */
  expiresAt?: number
  /** a refresh token is sealed for this server (mcp-refresh:<id>) */
  refresh?: boolean
  /** a client secret came with the registration (sealed as mcp-client:<id>) */
  secret?: boolean
  /** when the person signed in (ms since epoch) */
  at?: number
  /** the authorization server's device authorization endpoint (RFC 8628) — "Sign in with a code" when the redirect can't come back */
  deviceEndpoint?: string
  /** the registration includes the device code grant */
  device?: boolean
  /** registered for the device code grant alone, without a redirect URI (a code sign-in registers again) */
  deviceOnly?: boolean
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
  /**
   * Custom functions (features/sheets/functions), built by clicking — no code. Usable in
   * spreadsheet cells (`=MARGIN(B2; C2)`) and database formulas (`MARGIN(prop("Price"), prop("Cost"))`).
   * Write only with upsertFunction / deleteFunction. Synced in team workspaces (meta map `functions`).
   */
  functions?: Record<ID, CustomFunction>
  /**
   * Custom agents (features/agents): saved AI helpers started by a schedule or a trigger. Write only
   * with upsertAgent / deleteAgent; every reader sanitizes (store/agents.ts). Synced in team
   * workspaces (meta map `agents`). Their runs are per device (IndexedDB `one-agents`), never here.
   */
  agents?: Record<ID, CustomAgent>
  /**
   * One Script (features/script): small scripts and queries in One's own script language. Write only
   * with upsertScript / deleteScript; every reader sanitizes (store/scripts.ts). Synced in team
   * workspaces (meta map `scripts`). Runs and trusted versions are per device (IndexedDB
   * `one-scripts`), never here.
   */
  scripts?: Record<ID, OneScript>
  /**
   * Building blocks (features/kit, route #/kit): shared lists, own property types, record types. Write only
   * with the kit actions (upsertList / upsertPropType / upsertRecordType …); every reader sanitizes
   * (store/kit.ts). Synced in team workspaces (meta maps `lists`, `propTypes`, `recordTypes`).
   */
  kit?: Kit
  /**
   * The workspace's look (lib/look, Workspace → Look): absent = One's standard look (tokens.css). Write only
   * with setLook; every reader sanitizes (store/look.ts). Team: meta map 'workspace' key 'look' (owners /
   * admins write it — the server puts other members' changes back). Per device (never here): the pre-paint
   * cache and "standard look on this device" in localStorage `one.look`.
   */
  look?: WorkspaceLook
  /**
   * Integration profiles (Workspace → Integrations, features/agents/integrations): which agent features an active MCP
   * server unlocks, and the recipes it brings. Write only with upsertIntegration / deleteIntegration (team: owners and
   * admins — the server puts other members' changes back); every reader sanitizes (store/integrations.ts). Team: meta
   * map `integrations`. Full backups carry them, page backups never.
   */
  integrations?: IntegrationProfile[]
  /**
   * The workspace's AI rules (src/shared/ai/types.ts WorkspaceAI: providers' data rules, restricted pages, routes per
   * class, soft limits, the policy generation `gen`). Every reader sanitizes (store/ai.ts readWorkspaceAI); written by
   * nobody in slice 1 (team: meta map 'workspace' key 'ai', owners / admins only — server guard). Assign `undefined`,
   * never `delete`. Full backups carry it (a restore keeps this workspace's), page backups never.
   */
  ai?: WorkspaceAI
  /**
   * The Regler (features/governor; src/shared/ai/governor.ts WorkspaceGovernor: lever, ceiling, day / month budget per
   * device, saving rules, worker). Write only with setGovernor; every reader sanitizes (sanitizeGovernor — unknown keys of
   * a later slice kept, a newer shape kept whole and never written over). Team: meta map 'workspace' key 'governor',
   * owners / admins only (server guard collab/workspace-governor.ts). Assign `undefined`, never `delete`. Full backups
   * carry it (a restore keeps this workspace's), page backups never.
   */
  governor?: WorkspaceGovernor | Unreadable
  /**
   * The Patchbay's allowed paths ("Allow this path" / "Weg zulassen", features/patchbay §1.10 / §2.8): path key (64 hex)
   * → FuseSignoff. Every reader sanitizes (store/fuseSignoffs.ts sanitizeFuseSignoffs). Written only with signOffFuse /
   * withdrawSignoff / restoreSignoff (B9; owners / admins; restoreSignoff = the Patchbay's Undo of key 3). Team: meta map `fuseSignoffs`, one entry per path key, guarded by the server
   * (it stamps `updatedBy`). No stampGen, no schema gate. Assign `undefined`, never `delete`. Full backups carry it (a
   * restore keeps this workspace's), page backups never. An older build may drop it: fuses come back open (fail-safe).
   */
  fuseSignoffs?: Record<string, FuseSignoff>
}

/** One allowed path (Workspace.fuseSignoffs): the path's signature and its parts' digests when it was allowed. */
export interface FuseSignoff {
  /** the path signature (64 hex) — a changed path no longer matches: the allowance lapses */
  sig: string
  /** part letter (+ index) → 16-hex digest of that part (what changed is named) */
  parts: Record<string, string>
  at: number
  /** who allowed it (account id; team: stamped by the server), null locally */
  updatedBy: string | null
}

/* ------------------------------------------------------------------ */
/* Workspace look (lib/look, shell/workspace/Look.tsx)                 */
/* ------------------------------------------------------------------ */

export type LookPresetId = 'paper' | 'blueprint' | 'ochre' | 'proof' | 'swiss'
export const LOOK_PRESET_IDS: LookPresetId[] = ['paper', 'blueprint', 'ochre', 'proof', 'swiss']
/** interface font: Archivo (bundled) · a Swiss grotesque stack · the device's system font (no download) */
export type LookUiFont = 'archivo' | 'swiss' | 'system'
export const LOOK_UI_FONTS: LookUiFont[] = ['archivo', 'swiss', 'system']
/** page text ("Default" in a page's font menu): the interface font · Newsreader · JetBrains Mono */
export type LookTextFont = 'ui' | 'serif' | 'mono'
export const LOOK_TEXT_FONTS: LookTextFont[] = ['ui', 'serif', 'mono']
/** content headings (page titles, H1–H3, toggle headings) and `.display` type */
export type LookHeadings = 'expanded' | 'normal' | 'condensed' | 'ui' | 'serif' | 'mono'
export const LOOK_HEADINGS: LookHeadings[] = ['expanded', 'normal', 'condensed', 'ui', 'serif', 'mono']
export type LookCorners = 'standard' | 'square'
export const LOOK_CORNERS: LookCorners[] = ['standard', 'square']
/** The three inputs of one theme: '#rrggbb', lower case. The derived tokens may differ (contrast). */
export interface LookColors {
  paper: string
  ink: string
  signal: string
}
export interface WorkspaceLook {
  /** the preset it started from (display: "BLUEPRINT · MODIFIED"); the fields below are the truth */
  preset: LookPresetId
  /** Paper (light theme) inputs */
  colors: LookColors
  /** Carbon (dark theme) inputs; absent = derived from `colors` (lib/look/derive.ts darkInputsFrom) */
  dark?: LookColors
  fonts: { ui: LookUiFont; text: LookTextFont; headings: LookHeadings }
  corners: LookCorners
  updatedAt: number
  /** account id of the last saver (team; the server stamps it) / null (local) */
  updatedBy?: string | null
}

/* ------------------------------------------------------------------ */
/* One Script (features/script)                                        */
/* ------------------------------------------------------------------ */

export interface OneScript {
  id: ID
  /** 1–80 characters */
  name: string
  icon?: PageIcon | null
  description?: string
  /** the source; @ references are stable tokens `@[Label](p:<id>)` (u: person, a: agent, s: script) */
  code: string
  /** 'query': read-only, its result shows as a live table under the editor */
  kind: 'script' | 'query'
  /** account id (team) / null (local) */
  createdBy?: string | null
  /** who saved it last: account id (team, stamped by upsertScript) / null (local) */
  updatedBy?: string | null
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* Building blocks (features/kit)                                      */
/* ------------------------------------------------------------------ */

export interface Kit {
  /** Shared option lists ("Lists" / "Listen") */
  lists: Record<ID, OptionList>
  /** Own property types ("Property types" / "Eigenschaftstypen") */
  propTypes: Record<ID, CustomPropType>
  /** Record types ("Record types" / "Datensatz-Typen") */
  recordTypes: Record<ID, RecordType>
}

/** What every building block has. `createdBy` / `updatedBy`: account id (team) / null (local). */
export interface KitEntry {
  id: ID
  /** 1–80 characters */
  name: string
  icon?: PageIcon | null
  description?: string
  createdBy?: string | null
  updatedBy?: string | null
  createdAt: number
  updatedAt: number
}

/**
 * A shared option list: select / multi_select properties bound to it (PropertyDef.listId) get its items as
 * their options. Item ids never change (stored values are item ids); ≤ 2000 items, no status groups.
 */
export interface OptionList extends KitEntry {
  items: SelectOption[]
}

/** The stored shape of an own property type's values: like this standard type ('free' = text). */
export type CustomPropBase = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'person' | 'rating' | 'free'

/**
 * An own property type: a base (fixed once created) + how values look + optional One Script bindings.
 * A property of this type is a PropertyDef with `custom` = this id and `type` = the base.
 */
export interface CustomPropType extends KitEntry {
  base: CustomPropBase
  /** select / multi_select: the options come from this shared list */
  listId?: ID | null
  /** copied into new properties of this type */
  numberFormat?: NumberFormat
  numberDisplay?: NumberDisplay
  ratingMax?: number
  /** how a value is shown */
  display?: CustomPropDisplay
  /** One Script code (≤ 20,000 characters each) — run only by features/kit, never by a reader */
  scripts?: CustomPropScripts
}

export interface CustomPropDisplay {
  prefix?: string
  suffix?: string
  color?: ColorName
  style?: 'plain' | 'badge' | 'led' | 'bar'
}

/**
 * Script bindings of an own property type (features/kit runs them; team workspaces: a version this device
 * did not save or confirm does not run until confirmed — like One Script's trust rule).
 */
export interface CustomPropScripts {
  /** computed value (query mode; `row`): written into the property when it differs (origin 'kit'); the cell is read-only */
  value?: string
  /** input check (query mode; `value`, `row`): true / null = fine, a text = refused with that message */
  validate?: string
  /** options (query mode; `row`): a list of texts or { name, color } — select / multi_select */
  options?: string
  /** the shown text (query mode; `value`, `row`) */
  format?: string
  /** after a change (run mode; `value`, `old`, `row`; effects asked once per run like any script) */
  onChange?: string
}

/** A record type ("Bug", "Lead", "Invoice"): a named set of properties a row can carry (Page.recordType). */
export interface RecordType extends KitEntry {
  color?: ColorName
  /** ≤ 50 */
  properties: RecordTypeProp[]
  /** content of a new record of this type (TipTap JSON) */
  content?: JSONContent | null
}

/** One property of a record type; becomes a PropertyDef with `fromType` in every database holding the type. */
export interface RecordTypeProp {
  /** stable within the record type */
  id: ID
  name: string
  /** a stored standard type (never title / formula / rollup / created_* / last_edited_* / unique_id); an own type: its base */
  type: PropertyType
  /** an own property type */
  custom?: ID | null
  /** select / multi_select: a shared list */
  listId?: ID | null
  options?: SelectOption[]
  numberFormat?: NumberFormat
  ratingMax?: number
  /** relation: the target database */
  relationDatabaseId?: ID
  description?: string
}

/* ------------------------------------------------------------------ */
/* Custom agents (shared contract with the server runner)              */
/* ------------------------------------------------------------------ */

/** What starts an agent. Times are wall-clock time in `tz` (IANA). */
export type AgentTrigger =
  | { type: 'manual' }
  | {
      type: 'schedule'
      every: 'hour' | 'day' | 'weekday' | 'week' | 'month'
      /** 'HH:mm' ('hour': only the minutes count) */
      at: string
      /** 'week': 0 = Sunday … 6 = Saturday */
      weekday?: number
      /** 'month': 1–31 (short months use their last day) */
      day?: number
      tz: string
    }
  /** a new row in the database (form answers and synced mails included) */
  | { type: 'row_created'; databaseId: ID }
  /** a row's property changed (null = any property) */
  | { type: 'row_changed'; databaseId: ID; propertyId: ID | null }
  /** server runner only: POST to a URL with a secret */
  | { type: 'webhook' }

export type AgentTriggerType = AgentTrigger['type']

/** read only (answer only) · propose changes for review · apply directly */
export type AgentWriteMode = 'none' | 'stage' | 'apply'
export type AgentCategory = 'planning' | 'coding' | 'knowledge' | 'communication' | 'integrations' | 'custom'

export interface CustomAgent {
  id: ID
  name: string
  /** Organization only; absent on older agents = general. Does not grant tools or select a model. */
  category?: AgentCategory
  icon?: PageIcon | null
  /** the job in plain language (≤ 8000 characters) */
  instructions: string
  trigger: AgentTrigger
  /** what it may read (and write, see `write`): everything, or these pages / databases and what is below them */
  scope: { everything: boolean; pages: ID[]; databases: ID[] }
  write: AgentWriteMode
  /** where the run's report goes (null = nowhere) */
  output?: { pageId: ID | null; mode: 'append' | 'replace' } | null
  /** MCP server NAMES (browser: settings.mcpServers · server: the server runtime's list) */
  mcpServers: string[]
  /**
   * Per attached MCP server (by name): the only tools the agent may use (the MCP connector's toolset with
   * every other tool switched off). Absent — or no entry for a server — = all its tools; [] = none (the
   * server is left out). Tool names `[A-Za-z0-9_.-]`, ≤ 200 per server; entries only for `mcpServers`.
   */
  mcpTools?: Record<string, string[]>
  /**
   * The database the mirror recipe set this agent up for (features/agents/mirror.ts mirrorDraft): while its scope still
   * names that database it is that database's mirror — whatever its switch, write mode or servers — so a setup never
   * makes a second one. Kept by sanitizeAgent (store, backups, the team meta map); the team server's own runner
   * sanitizer does not use it.
   */
  mirrorOf?: ID
  runner: 'browser' | 'server'
  /** null = the browser's agent rule / workspace defaults (server runner: its server default). */
  model?: string | null
  effort?: 'low' | 'medium' | 'high' | null
  /**
   * Multi-provider (src/shared/ai/route.ts AgentAIFields, kept by every reader from slice 1, used later): own pins
   * (null = the workspace / device rule for agents), the advisory reviewer, the governor's saver rule, the 'p:m' the
   * person confirmed apply-mode on, the inherited workspace rule's signature at the creator's last save. `model` /
   * `effort` stay and are kept in step while pin 1 is Claude. A browser run whose pin 1 is not Claude, or whose fields
   * this build cannot read (kept as they were, `Unreadable`), ends as an error run without a request
   * (features/agents/routeBlock.ts).
   */
  route?: RouteRule | null | Unreadable
  review?: AgentReview | AgentReviewV2 | null | Unreadable
  saverRule?: SaverRule | null | Unreadable
  applyOn?: string | Unreadable
  routeSig?: string
  /** estimated budget per run in USD: the run stops (status 'budget') when it is exceeded */
  maxRunUsd: number
  enabled: boolean
  /** account id (team) / null (local) */
  createdBy?: string | null
  /**
   * who saved it last: account id (team, set by upsertAgent) / null (local; absent on older data = the
   * creator). A team browser agent runs only while this is its creator (features/agents/confirm.ts).
   */
  updatedBy?: string | null
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* Integration profiles (store/integrations.ts, features/agents)       */
/* ------------------------------------------------------------------ */

/**
 * What an active integration profile switches on (on this device, or for the team server's agents):
 * keys = the property menu's "Key" switch · onlyByHand = its "Only by hand" switch · upsert = the agent tool
 * upsert_rows · toolAllowList = the MCP tool allow-list in the agent editor · agentState = agent_state_get / _set ·
 * notify = notify_me · sends = the profile's send routes are offered (the Outbox). Flags already on properties and
 * allow-lists already on agents keep working without it — and a profile's send tools stay switched off in every Claude
 * request whether or not it unlocks `sends` (store/integrations.ts outToolsOf).
 */
export type IntegrationFeature = 'keys' | 'onlyByHand' | 'upsert' | 'toolAllowList' | 'agentState' | 'notify' | 'sends'
export const INTEGRATION_FEATURES: IntegrationFeature[] = ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify', 'sends']

/** A text in one language, or per UI language ({ en, de } — the other one stands in for a missing one). */
export type LocalText = string | { en?: string; de?: string }

/**
 * When a profile is active: ONE enabled MCP server satisfies every given condition — `tools`: each listed tool is in
 * the server's tool list from its last connection test · `name`: a glob (`*`, `?`, case-insensitive) on its name ·
 * `host`: a glob on its URL's host. At least one condition. The team server checks `name` / `host` only.
 */
export interface IntegrationMatch {
  tools?: string[]
  name?: string
  host?: string
}

/** Property types a recipe's database may use. */
export type RecipePropType = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'person'

export interface RecipeOptionConfig {
  name: LocalText
  color?: ColorName
  /** status options: the group (default: todo, then in_progress, the last one done) */
  group?: StatusGroup
}

export interface RecipePropertyConfig {
  /** what the property is for (the default views and instructions find properties by it) */
  role?: string
  name: LocalText
  type: RecipePropType
  options?: RecipeOptionConfig[]
  /** the database's key (text / number / url; at most one) */
  key?: boolean
  /** "Only by hand": agents never write it */
  onlyByHand?: boolean
  /** the colour of options that name none */
  color?: ColorName
  description?: LocalText
}

/** A filter condition: `property` = a property's name (either language) or role; `value` per type (option name, date token …). */
export interface RecipeCondition {
  property: string
  op: FilterOperator
  value?: string | number | boolean
}
export type RecipeFilter = RecipeCondition | { and: RecipeFilter[] } | { or: RecipeFilter[] }

export type RecipeViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'feed'

export interface RecipeViewConfig {
  name: LocalText
  type: RecipeViewType
  /** visible properties in order (default: all but the title) */
  properties?: string[]
  /** board: select / status / checkbox / person; table / list: optional */
  groupBy?: string
  /** calendar / timeline / feed: the date property */
  date?: string
  filter?: RecipeFilter
  sort?: Array<{ property: string; direction?: 'asc' | 'desc' }>
  colorRules?: Array<{ when: RecipeFilter; color: ColorName; target?: 'accent' | 'background' | 'text' }>
  /** option names of groupBy whose groups start hidden */
  hiddenGroups?: string[]
  /** hide the group of rows without a value */
  hideEmpty?: boolean
}

export interface RecipeAgentConfig {
  /** `{db}` = the database's name */
  name?: LocalText
  schedule?: { every: 'hour' | 'day' | 'weekday' | 'week' | 'month'; at: string; weekday?: number; day?: number }
  write?: 'stage' | 'apply'
  /** USD per run */
  budget?: number
  model?: string | null
  effort?: 'low' | 'medium' | 'high' | null
  /** the matched server's tools the agent may use (default: its read tools) */
  tools?: string[]
  /** `{db}`, `{server}`, `{report}` are filled in; parts in [ALL CAPS] are for the person to replace */
  instructions?: LocalText
}

/** A recipe an active profile offers in the agent gallery. Absent fields take the built-in mirror's values. */
export interface RecipeConfig {
  kind: 'mirror'
  /** unique in its profile (default "mirror", "mirror-2" …) */
  id?: string
  name?: LocalText
  description?: LocalText
  /** a lucide icon name for the database and the agent, and its colour */
  icon?: string
  color?: ColorName
  database?: { name?: LocalText; properties?: RecipePropertyConfig[]; views?: RecipeViewConfig[] }
  agent?: RecipeAgentConfig
  /** the report page (`{db}` = the database's name) */
  report?: { name?: LocalText }
}

/**
 * A send route (the Outbox, features/outbox): ONE tool call that writes to the profile's server — a comment, a status,
 * a time booking. `tool` is OUT on every server the profile matches by name / host: switched off in every Claude
 * request One makes (outToolsOf), whatever the profile unlocks. Templates (`args`, `check.args`, `confirm.*`) are values
 * with placeholders: `{key}` (the row's key; also inside a string), `{key|number}`, `{sentAt}`, `{<param>}` (whole values
 * only) and, in `confirm` only, `{result.<path>}`. Paths follow ROUTE_PATH (store/integrations.ts).
 */
export interface SendRoute {
  /** unique in its profile (a recipe id's grammar) */
  id: string
  /** what the route is for ('reply', 'status', 'work' …) — features find routes by it */
  role?: string
  label: LocalText
  /** the tool that writes (OUT) */
  tool: string
  /** the tool's arguments as a template (≤ 4 KB as JSON, nested ≤ 4 levels) */
  args: Record<string, unknown>
  params?: RouteParam[]
  /** the pre-read before a send */
  check?: RouteCheck
  /** the read-back after a send */
  confirm?: RouteConfirm
  /** the tool's own idempotency argument (the slip id goes into it) */
  idem?: string
  /** a `check.fields` path the send overwrites (the slip shows before → after) */
  overwrites?: string
  /** the row patch after a send */
  after?: RouteAfter[]
  /** how it may be sent (absent: worker, then by hand); 'tab' / 'connector' only when named */
  via?: SendVia[]
}

export type SendVia = 'worker' | 'hand' | 'tab' | 'connector'

/** A value a send route takes: `draft` = the text Claude may write · `minutes` = a duration. */
export interface RouteParam {
  /** [a-z][a-z0-9_]{0,23} */
  name: string
  type: 'text' | 'number' | 'minutes' | 'option'
  label?: LocalText
  /** text: characters (default 4,000, ≤ 20,000) · number / minutes: the upper bound */
  max?: number
  /** option: the values to pick from (≤ 30) */
  values?: string[]
  /** text: a style hint for the draft ("short, friendly") */
  style?: LocalText
  /** minutes: the rounding step */
  round?: number
}

/** The pre-read: a reading tool, the fields compared between draft time and the press. */
export interface RouteCheck {
  tool: string
  args: Record<string, unknown>
  /** ≤ 12 paths */
  fields: string[]
  /** the newest foreign item to quote ("comments.-1") */
  latest?: string
  /** a path whose value must equal {key} */
  identity?: string
}

/** The read-back: a reading tool and how the sent item is found again. */
export interface RouteConfirm {
  tool: string
  args: Record<string, unknown>
  /** the array to search (absent: the result itself) */
  find?: string
  /** ≤ 6 conditions; values may use {draft}, {key}, {result.*} */
  match: Array<{ path: string; equals?: string; contains?: string }>
  /** name → path: ids kept on the receipt (≤ 4) */
  capture?: Record<string, string>
}

/** A row property written after a send (by role or name, either language). */
export interface RouteAfter {
  property: string
  value: boolean | number | string | null
}

/**
 * An integration profile (JSON schema "one.integration/1"): workspace data, written only with upsertIntegration /
 * deleteIntegration (team: owners and admins), every reader sanitizes (store/integrations.ts). Nothing names a
 * service in One itself: a profile that does is data the person added.
 */
export interface IntegrationProfile {
  schema: 'one.integration/1'
  id: string
  name: string
  description?: string
  match: IntegrationMatch
  unlocks: IntegrationFeature[]
  recipes?: RecipeConfig[]
  /** send routes (≤ 20; the profile then matches by name or host): their tools are OUT on every server it matches */
  sends?: SendRoute[]
  /** the profile's reading tools (≤ 50): when set, every check / confirm tool is one of them and no send tool is */
  reads?: string[]
  /**
   * More send tools to lock (≤ 20): the sanitizer keeps here the tool of a route it had to leave out (too big, a
   * label this version cannot read …) — the route is gone from this copy, its tool stays OUT, as on the team server
   */
  outTools?: string[]
  /**
   * Preflight lamps the profile brings (≤ 4; data only, never code): each counts the rows of a view of a recipe's
   * mirror database (or rows matching role conditions) on a device where the profile is active. Read release: kept
   * by every sanitizer, shown by Preflight from a later release (features/preflight sources/profile.ts).
   */
  lamps?: ProfileLamp[]
  /** stored only (never exported): the last save and its author (team: stamped by the server) */
  updatedAt?: number
  updatedBy?: string | null
}

/**
 * A lamp an integration profile brings (data only, never code; store/integrations.ts checkLamps). Exactly one of
 * `view` / `where` says what it counts. `read` ("Read") sets one role's property of the row — only the agent-marked
 * checkboxes `newComment` / `waiting` (to false) or the person's own `myStatus` (to one of its options): never a field
 * the mirror reads from the source (the Outbox's CHANGED baseline and the next mirror run read those).
 */
export interface ProfileLamp {
  /** [a-z][a-z0-9-]{0,23}, unique in the profile */
  id: string
  /** ≤ 16 characters per language (CSS uppercases) */
  label: LocalText
  /** the queue tab's name, ≤ 12 */
  short?: LocalText
  /** the cap's second line, ≤ 16 (absent: the profile's name) */
  second?: LocalText
  /** a recipe id of the profile (absent: its first recipe) */
  recipe?: string
  /** a view of that recipe's database, by name (either language) … */
  view?: LocalText
  /** … or role conditions (AND, 1–4): a checkbox role equals true / false, a select / status role equals an option name */
  where?: Array<{ role: string; equals: boolean | string }>
  /** whole numbers 1–9,999; red above amber; not both null (defaults: amber 1, red none) */
  amber?: number | null
  red?: number | null
  /** blink when new (default true) · counts for MASTER CAUTION (default true) */
  flash?: boolean
  master?: boolean
  read?: { role: 'newComment' | 'waiting'; value: false } | { role: 'myStatus'; value: string }
  /** the lamp it sits after (default 'proposals') */
  after?: string
}

/* ------------------------------------------------------------------ */
/* Custom functions (shared contract with features/sheets/engine)      */
/* ------------------------------------------------------------------ */

/**
 * A custom function's body: an expression tree, never source code. `call.fn` is a built-in
 * (SUM, IF, ROUND …), an operator ('+', '-', '*', '/', '^', '&', '=', '<>', '<', '<=', '>', '>=')
 * or another custom function's name.
 */
export type FnExpr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'param'; name: string }
  | { k: 'call'; fn: string; args: FnExpr[] }

export type FnParamType = 'number' | 'text' | 'date' | 'bool' | 'range' | 'any'

export interface FnParam {
  /** lower_snake, unique within the function */
  name: string
  type: FnParamType
  description?: string
}

export interface CustomFunction {
  id: ID
  /** UPPER_SNAKE, 2–32 chars, never a built-in's name, unique in the workspace */
  name: string
  description?: string
  params: FnParam[]
  body: FnExpr
  createdAt: number
  updatedAt: number
}
