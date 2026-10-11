/**
 * Workspace agent — shared types. The agent reads the workspace with tools and stages every
 * write as a StagedChange; nothing reaches the store until the user applies it (apply.ts).
 */
import type { ID, PropertyType, PropertyValue } from '../../../store/types'
import type { AIErrorCode } from '../client'
import type { MemoryProposal, MemoryUse } from '../memory/types'
import type { BlockEdit } from './edit'
import type { NewTaskPlan, PipelineKind, RefPage, TaskActionPlan, TaskOp } from '../../coding'
import type { ItemPatch } from '../../../editor/workitem/patch'
import type { ItemFact } from '../../workitems/facts'
import type { HoldReason } from '../../workitems/holds'
import type { ItemPin, SettleWarning } from '../../workitems/settle'

export type ToolName =
  | 'search_pages'
  | 'read_page'
  | 'list_databases'
  | 'query_database'
  | 'get_current_page'
  | 'create_page'
  /** several pages in one call (one page per item): one staged change per page, the ids back in order */
  | 'create_pages'
  | 'append_to_page'
  /** changes existing content, block by block (staged one change per edit, kind 'edit') */
  | 'edit_page'
  | 'create_row'
  | 'update_row'
  /** rows found by their key (store/keys.ts): one staged create_row / update_row (rename, append) per row, in one call */
  | 'upsert_rows'
  | 'set_page_title'
  | 'create_database'
  | 'add_property'
  /** One memory (features/ai/memory): search it · stage a memory to save (only while the memory is in use) */
  | 'recall'
  | 'remember'
  /** One Script (features/script): a read-only query (terminal and custom agents) · a script drafted for review (terminal) */
  | 'run_query'
  | 'write_script'
  /** the coding pipelines (features/coding, the terminal only): read directly · create / act on tasks (staged, kind 'coding') */
  | 'list_pipelines'
  | 'list_tasks'
  | 'read_task'
  | 'create_task'
  | 'task_action'
  /** custom agents (features/agents/runTools.ts): their own state between runs · a note for the person's inbox */
  | 'agent_state_get'
  | 'agent_state_set'
  | 'notify_me'
  /** task blocks (features/workitems): find them across the workspace (read) · change their fields (staged, kind 'workItem') */
  | 'list_work_items'
  | 'update_work_item'

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

/**
 * 'send': a slip in the Outbox (features/outbox) — never applied here, not even in write mode "apply": the Outbox sends
 * after a person's press · 'workItem': a task block's fields (update_work_item, or a `Blocks:` of a text write)
 */
export type ChangeKind = 'create_page' | 'append' | 'edit' | 'create_row' | 'update_row' | 'rename' | 'create_database' | 'add_property' | 'memory' | 'script' | 'media' | 'coding' | 'send' | 'workItem'

/**
 * What the settle gate made of a text change's Markdown at staging (create_page / append / create_row / edit): the ids
 * its new tasks got (reused 1:1 at apply — never re-minted), the handles it declared or used, the facts the review shows
 * (= what apply writes), the warnings and the holds. Absent: the text holds no task, no person mention, nothing left
 * out — and a change without it (an older proposal, a server run) creates no task at apply.
 */
export interface StagedItems {
  ids: string[]
  handles: Record<string, string>
  /** created + kept + removed, as staged */
  facts: ItemFact[]
  warnings: SettleWarning[]
  holds: HoldReason[]
  /** per new task (↔ ids): the people and links staging resolved — apply writes these ids (an older change: none) */
  pins?: ItemPin[]
  /** the changes whose new tasks this text links (part of StagedChange.needs — a text written again replaces them) */
  needs?: string[]
}

/** A task's fields changed (ChangeKind 'workItem'; StagedChange.pageId = the task's page, .title = its title). */
export interface StagedItemEdit {
  itemId: string
  /** ids resolved (editor/workitem/patch.ts) */
  patch: ItemPatch
  /** JSON of the touched fields at staging (itemAttrs subset); null: a task staged in this conversation (dependsOn) */
  before: string | null
  /** tag 'changed', before → after */
  facts: ItemFact
  holds: HoldReason[]
  /** the text change whose `Blocks:` produced it (also its dependsOn) */
  from?: string
}

/**
 * Media saved from an MCP result (features/ai/media: the person clicked "Save to One" on a card — the file is in
 * One already): applying puts its block at the end of the page (kind 'media', staged by the terminal itself).
 */
export interface StagedMedia {
  /** "onefile:<id>" */
  src: string
  kind: 'image' | 'video' | 'audio' | 'file'
  name: string
  size: number
  caption: string
  alt: string
}

/** A One Script Claude drafted (write_script): saved when applied, never run by applying. */
export interface StagedScript {
  /** the saved script it changes, or the id the new one gets */
  id: ID
  name: string
  kind: 'script' | 'query'
  code: string
  description?: string
  /** a change: the script as it was when staged (null: a new script) */
  before: { name: string; kind: 'script' | 'query'; code: string } | null
}
/**
 * A task of a coding pipeline (create_task / task_action — the AI terminal only, coding/terminal.ts): applied after
 * everything else, never part of a bulk apply when it starts the worker, never granting trust.
 */
export interface StagedCoding {
  op: 'create' | TaskOp
  kind: PipelineKind
  projectId: ID | null
  /** the project's title for the review ("Coding", or the kind's name + "new project") */
  project: string
  /** applying starts the coding worker (as staged; the review and the apply re-check it live): never part of a bulk apply */
  starts: boolean
  /** op 'create': the task exactly as it will be written (the review shows all of it) */
  task?: NewTaskPlan
  /** the other ops: the action and what the task looked like when it was staged */
  action?: TaskActionPlan
}

/**
 * 'applying': being written right now (Apply waits for it — a second key press never applies it twice) ·
 * 'superseded': a custom agent's older update_row proposal that a newer run's proposal for the same row (with at least
 * its fields) replaces (features/agents/supersede.ts) — never counted, never applied; NOT discarded, so a run holding
 * one stops the agent-state walk back (agents/review.ts stateBack). The AI terminal's own changes are never superseded.
 */
export type ChangeStatus = 'pending' | 'applying' | 'applied' | 'discarded' | 'failed' | 'superseded'

/**
 * Why the person discarded a custom agent's proposal (features/agents/trust): only 'wrong' counts against the agent's
 * per-field trust; 'notNow' / 'duplicate' / 'done' (handled already) leave it as it is.
 */
export type DiscardReason = 'wrong' | 'notNow' | 'duplicate' | 'done'

/** One proposal of another run of the same agent (supersede): the run, the change, that run's start. */
export interface ChangeRef {
  runId: string
  changeId: string
  at: number
}

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
  /** create_page / create_row: content · append: what gets added · edit: the new blocks (none for a delete) */
  markdown?: string
  /** edit (edit_page): which blocks, as they were when staged; one change per edit, each applied or discarded on its own */
  edit?: BlockEdit
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
  /** script: the script to save (pageId = its id) */
  script?: StagedScript
  /** media: the saved files whose blocks go into the page (pageId) */
  media?: StagedMedia[]
  /** coding: a pipeline task to create, or an action on one (pageId = the task, or the id a new one gets) */
  coding?: StagedCoding
  /** send: the Outbox slip it stands for (pageId = the row it answers); discarding the change withdraws an unsent slip */
  send?: { slipId: string }
  /** create_page / append / create_row / edit whose Markdown holds tasks (or names people): what settling it made */
  items?: StagedItems
  /** workItem: the task and its field change */
  workItem?: StagedItemEdit
  /** applied: what applying it left out or changed (the settle gate's apply-time warnings, in the UI's language) */
  notes?: string[]
  /**
   * append / edit of a pipeline task's page (the terminal): the pages its text links — they go along to the worker as
   * read-only text (`staged`: proposed here, created on apply). Listed on the card; applying refuses a page not listed.
   */
  refs?: RefPage[]
  error?: string
  /** status 'superseded': the newer run's proposal that replaces this one (`at`: when that run started) */
  supersededBy?: ChangeRef
  /** the older proposals this one replaces (`at`: when each of their runs started), oldest last */
  supersedes?: ChangeRef[]
  /**
   * the reason the person gave when discarding this proposal (agents/review.ts discardRun; cleared by its Undo) — the
   * run's quiet "Wrong × 3" row reads it. Only on the change(s) the person named, never on cascaded dependants.
   */
  reason?: DiscardReason
}

/** Every staged change `c` needs applied first. */
export const depsOf = (c: Pick<StagedChange, 'dependsOn' | 'needs'>): string[] => [...(c.dependsOn ? [c.dependsOn] : []), ...(c.needs ?? [])]

/**
 * Whether applying `c` can make task blocks — the rule of apply's settle gate (workItems.ts itemCtx): only the tasks its
 * staging minted, never from a server run (`server`). A review draws `[!TODO]` quotes as tasks only then: an older
 * proposal, a server run's or a text whose staging made none writes them as plain quotes.
 */
export const makesTasks = (c: Pick<StagedChange, 'items'>, server = false): boolean => !server && !!c.items?.ids.length

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
  /** "Continue" (/continue): this task picks up task n where it stopped at the tool-call limit (task = that task's text) */
  continues?: number
  /** server: the MCP server that rejected its token (mcp_auth) — the terminal offers to sign in to it */
  error?: { code: AIErrorCode | 'max_tokens'; message: string; server?: string }
  /** MCP servers this task left out because they rejected their token here (the terminal offers a sign-in) */
  signIn?: string[]
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
  /** a file block (Claude for files): the file goes along as a document; bytes = its size (null: not known) */
  file?: { src: string; name: string; bytes: number | null }
}

/** A page or database pointed at with @ in the prompt. */
export interface TermMention {
  id: ID
  title: string
  kind: 'page' | 'database'
}

export const EMPTY_USAGE: AgentUsage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }
