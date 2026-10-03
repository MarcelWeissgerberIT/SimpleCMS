/**
 * Workspace agent — shared types. The agent reads the workspace with tools and stages every
 * write as a StagedChange; nothing reaches the store until the user applies it (apply.ts).
 */
import type { ID, PropertyType, PropertyValue } from '../../../store/types'
import type { AIErrorCode } from '../client'

export type ToolName =
  | 'search_pages'
  | 'read_page'
  | 'list_databases'
  | 'query_database'
  | 'get_current_page'
  | 'create_page'
  | 'append_to_page'
  | 'create_row'
  | 'update_row'
  | 'set_page_title'

export type StepState = 'run' | 'ok' | 'err' | 'staged'

/** One line of the step log. */
export interface AgentStep {
  id: string
  /** task number (1-based) the step belongs to */
  turn: number
  kind: 'tool' | 'note'
  tool?: ToolName
  /** what the tool was asked for (a query, a page title …) */
  arg?: string
  /** readout after the call: "4 results", "staged #2" */
  result?: string
  /** note text (progress update / text before a tool call) */
  text?: string
  state: StepState
  startedAt: number
  ms?: number
  /** the staged change this call produced or updated */
  changeId?: string
}

/** A property value as staged: resolved to ids only when the change is applied. */
export type PropIntent =
  | { kind: 'value'; value: PropertyValue }
  /** select / status / multi_select by option name (new names become new options on apply) */
  | { kind: 'options'; names: string[] }

export interface PropChange {
  propId: ID
  name: string
  type: PropertyType
  /** display text of the stored value when the change was staged ('' = empty) */
  before: string
  /** display text of the proposed value */
  after: string
  intent: PropIntent
  /** option names that do not exist yet (created on apply) */
  newOptions?: string[]
}

export type ChangeKind = 'create_page' | 'append' | 'create_row' | 'update_row' | 'rename'
export type ChangeStatus = 'pending' | 'applied' | 'discarded' | 'failed'

export interface StagedChange {
  id: string
  /** position in the review list (#1, #2 …) */
  n: number
  kind: ChangeKind
  status: ChangeStatus
  /** the page the change is about: an existing page, or the id a new page / row gets */
  pageId: ID
  /** create_page: parent page (null = top level); may be a page staged earlier */
  parentId?: ID | null
  /** create_row / update_row */
  databaseId?: ID
  /** create_*: title · rename: the new title */
  title?: string
  /** rename: the title when the change was staged */
  beforeTitle?: string
  /** create_page / create_row: content · append: what gets added */
  markdown?: string
  props?: PropChange[]
  /** id of the staged change that creates this change's parent page */
  dependsOn?: string
  error?: string
}

export interface AgentUsage {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
}

export type AgentStatus = 'idle' | 'running' | 'done' | 'stopped' | 'limit' | 'error'

export interface AgentTurn {
  n: number
  task: string
  startedAt: number
  endedAt?: number
  status: AgentStatus
  /** Claude's closing summary (Markdown) */
  answer: string
  error?: { code: AIErrorCode | 'max_tokens'; message: string }
}

export const EMPTY_USAGE: AgentUsage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }
