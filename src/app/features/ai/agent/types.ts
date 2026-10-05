/**
 * Workspace agent — shared types. The agent reads the workspace with tools and stages every
 * write as a StagedChange; nothing reaches the store until the user applies it (apply.ts).
 */
import type { ID, PropertyType, PropertyValue } from '../../../store/types'
import type { AIErrorCode } from '../client'
import type { MemoryProposal, MemoryUse } from '../memory/types'

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
  | 'create_database'
  | 'add_property'
  /** One memory (features/ai/memory): search it · stage a memory to save (only while the memory is in use) */
  | 'recall'
  | 'remember'

export type StepState = 'run' | 'ok' | 'err' | 'staged'

/** One line of the step log. */
export interface AgentStep {
  id: string
  /** task number (1-based) the step belongs to */
  turn: number
  /** 'mcp': a tool of an external MCP server, run by Anthropic inside the response */
  kind: 'tool' | 'note' | 'mcp'
  tool?: ToolName
  /** kind 'mcp': the call (server, tool name, the error text of a failed call) */
  mcp?: { id: string; server: string; tool: string; error?: string }
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

/** Column types the agent may create (create_database / add_property). */
export type ColumnType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'url' | 'checkbox'

/** A property the agent proposes: its id is assigned when staged, so staged rows can use it. */
export interface ColumnSpec {
  id: ID
  name: string
  type: ColumnType
  /** select / multi_select: option names */
  options?: string[]
}

export type ChangeKind = 'create_page' | 'append' | 'create_row' | 'update_row' | 'rename' | 'create_database' | 'add_property' | 'memory'
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
  /** id of the staged change that creates this change's parent page (or its database) */
  dependsOn?: string
  /** further staged changes this one needs first (add_property changes whose properties a row uses) */
  needs?: string[]
  /** create_database: the columns besides the title column, its title property id, the first view */
  columns?: ColumnSpec[]
  titlePropId?: ID
  view?: 'table' | 'board'
  /** create_database: column id the view groups by */
  groupBy?: ID | null
  /** add_property: the new property (databaseId / pageId = the database) */
  prop?: ColumnSpec
  /** memory: the memory to save (`updates`: the near-identical memory it replaces); pageId = the row once saved */
  memory?: MemoryProposal & { updates?: ID | null }
  error?: string
}

/** Every staged change `c` needs applied first. */
export const depsOf = (c: Pick<StagedChange, 'dependsOn' | 'needs'>): string[] => [...(c.dependsOn ? [c.dependsOn] : []), ...(c.needs ?? [])]

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
  /** what went along as context (page, references, mentions) — for the log line */
  context?: TurnContext
  /** the One memory that went along (absent: memory not in use) */
  memory?: MemoryUse
  error?: { code: AIErrorCode | 'max_tokens'; message: string }
}

export interface TurnContext {
  page?: string
  refs: number
  mentions: string[]
}

/** A selection sent along as context ("Add to terminal" / Mod+Shift+J). */
export interface TermRef {
  id: string
  pageId: ID
  /** page title when it was added */
  title: string
  markdown: string
  /** lines of the selection */
  lines: number
  /** clipped to REF_CHARS */
  clipped?: boolean
  /** an image block (Claude for images): the picture goes along as an image; bytes = its file size (null: not known) */
  image?: { src: string; bytes: number | null }
}

/** A page or database pointed at with @ in the prompt. */
export interface TermMention {
  id: ID
  title: string
  kind: 'page' | 'database'
}

export const EMPTY_USAGE: AgentUsage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }
