/**
 * One MCP — writing through the workspace agent's tools: a private stage per call (callStage), one agent tool run on it
 * (stageWith — its input errors become MCP errors, in MCP words: mcpMessage), the staged changes applied as the call
 * (applyStaged — one rollback when any fails), and what they do to task blocks as approval-card lines (itemPlan).
 * write.ts (pages, rows) and workItems.ts (one_update_work_item) build on these.
 */
import { t, currentLang } from '../../i18n'
import type { ID } from '../../store/types'
import { AGENT_TOOLS, ToolInputError, withReadLimit, withToolScope, type AgentTool, type StageApi } from '../ai/agent/tools'
import { mcpReadLimit } from './limits'
import { withFilesWritable } from '../ai/agent/props'
import { applyChanges } from '../ai/agent/apply'
import { guardPipelineRows } from '../ai/agent/coding'
import { inTemplate } from '../../store/selectors'
import { systemChange, systemGuard, systemRefusal } from './system'
import { newItemSession } from '../ai/agent/workItems'
import type { StagedChange, ToolName } from '../ai/agent/types'
import { factLine, holdText, type HoldReason, type ItemFact } from '../workitems'
import { HOLD_REASONS } from '../workitems/holds'
import { McpToolError, ws } from './values'
import type { PlanLine } from './plan'
import { withWriter, type Writer } from '../../store/writer'

const AGENT_NAMES: Record<string, string> = {
  search_pages: 'one_search',
  read_page: 'one_get_page',
  list_databases: 'one_get_database',
  query_database: 'one_query_database',
  get_current_page: 'one_overview',
  create_page: 'one_create_page',
  append_to_page: 'one_update_page',
  create_row: 'one_create_row',
  update_row: 'one_update_row',
  set_page_title: 'one_update_page (title)',
  update_work_item: 'one_update_work_item',
  list_work_items: 'one_list_work_items',
}

/** The agent's messages name its own tools and "staging": speak MCP instead. */
export function mcpMessage(msg: string): string {
  return msg
    .replace(/\b(search_pages|read_page|list_databases|query_database|get_current_page|create_page|append_to_page|create_row|update_row|set_page_title|update_work_item|list_work_items)\b/g, (m) => AGENT_NAMES[m] ?? m)
    .replace(/, or upsert_rows by "[^"]*"/g, '')
    .replace(/Nothing was staged\./g, 'Nothing was changed.')
    .replace(/Nothing more was staged\./g, 'Nothing was changed.')
    .replace(/staged change #\d+ \(([^)]*)\)/g, '$1')
    .replace(/Also staged #\d+: /g, 'Also changes: ')
}

/** A private stage per call: the agent's tools put their change here. */
export function callStage(): StageApi & { changes: StagedChange[] } {
  const changes: StagedChange[] = []
  return {
    changes,
    list: () => changes,
    add(change) {
      const c: StagedChange = { ...change, id: `m${changes.length + 1}`, n: changes.length + 1, status: 'pending' }
      changes.push(c)
      return c
    },
    update(id, patch) {
      const i = changes.findIndex((c) => c.id === id)
      if (i < 0) throw new Error(`no staged change ${id}`)
      changes[i] = { ...changes[i], ...patch }
      return changes[i]
    },
    resolve: (id) => id,
    // the call's task handles and staged task ids (the replace's new tasks, a folded Blocks: change)
    items: newItemSession('mcp'),
  }
}

/**
 * The agent tools as MCP runs them: One's own databases refused (system.ts systemGuard — read-only over MCP), the
 * pipelines' row guard behind it as a backstop (agent/coding.ts guardPipelineRows). Built once, on first use.
 */
let mcpTools: AgentTool[] | null = null
export function mcpStageTool(name: ToolName): AgentTool | undefined {
  mcpTools ??= AGENT_TOOLS.map((tool) => systemGuard(guardPipelineRows(tool)))
  return mcpTools.find((x) => x.name === name)
}

/** Templates are not found over MCP (spec § 3.3): the agent tools' lookups see every page outside them. */
export const outsideTemplates = (id: string) => !inTemplate(ws().pages, id)

/** Refuse a stage holding a change that writes into One's own databases (a folded change staged outside a tool). */
export function assertStageWritable(changes: readonly StagedChange[]): void {
  const hit = systemChange(changes)
  if (hit) throw new McpToolError(systemRefusal(hit))
}

/**
 * Run one agent tool on the stage; its input errors become MCP errors. It reads pages as the person's context marks
 * allow (limits.ts mcpReadLimit — as the terminal's tools do): a task in an excluded block is no link target, is not
 * resolved by update_work_item and is never named.
 */
export function stageWith(stage: StageApi, name: ToolName, input: Record<string, unknown>) {
  const tool = mcpStageTool(name)
  if (!tool) throw new Error(`agent tool ${name} missing`)
  try {
    // files properties take this workspace's files over MCP (checked by the planner first — rows.ts checkFiles)
    const out = withReadLimit(mcpReadLimit, () => withFilesWritable(() => withToolScope(outsideTemplates, () => tool.run(input, stage))))
    // the staging tools answer at once (only run_query / write_script load the script engine)
    if (out instanceof Promise) throw new Error(`agent tool ${name} is not a staging tool`)
    return out
  } catch (e) {
    // an input the agent tool refuses is the arguments' fault: bad_argument (McpToolError; the planner adds the entry's path — atPath)
    if (e instanceof ToolInputError) throw new McpToolError(mcpMessage(e.message))
    throw e
  }
}

export async function applyStaged(changes: StagedChange[], writer: Writer): Promise<{ rowIds: Record<string, ID>; undo: () => boolean }> {
  if (!changes.length) return { rowIds: {}, undo: () => true }
  // the plan was checked; a page that moved into one of One's databases while the card waited is refused all the same
  assertStageWritable(changes)
  // the Undo leaves what someone changed since alone and puts what the call made into the trash (spec § 3.2)
  const res = await applyChanges(changes, changes, (id) => id, { writer, undoCreated: 'trash' })
  if (res.failed.length) {
    // the call takes back what it wrote (its own rollback)
    withWriter(writer, () => res.undo())
    throw new McpToolError(`Nothing was changed: ${res.failed.map((f) => f.error).join('; ')}.`)
  }
  return { rowIds: res.rowIds, undo: () => res.undo().kept.length === 0 }
}

/* ------------------------------------------------------------------ */
/* Task blocks on the approval card                                    */
/* ------------------------------------------------------------------ */

/** A fact's line without its title (the card shows the title on its own). */
function factsText(f: ItemFact): string {
  const line = factLine(f, currentLang(), t)
  return line.startsWith(`${f.title} · `) ? line.slice(f.title.length + 3) : line === f.title ? '' : line
}

/** One approval-card line per task. */
export const itemLine = (f: ItemFact, warn?: string): PlanLine => ({ k: 'item', tag: f.tag, title: f.title || '—', facts: factsText(f), ...(warn ? { warn } : {}) })

/** The tasks a call's staged changes make, keep, remove or change — card lines, the holds, the task ids for the result. */
export function itemPlan(changes: readonly StagedChange[], extra: readonly HoldReason[] = []): { lines: PlanLine[]; holds: HoldReason[]; created: Array<{ id: string; title: string; handle?: string }> } {
  const lines: PlanLine[] = []
  const holds = new Set<HoldReason>(extra)
  const created: Array<{ id: string; title: string; handle?: string }> = []
  for (const c of changes) {
    for (const h of c.items?.holds ?? c.workItem?.holds ?? []) holds.add(h)
    if (c.workItem) lines.push(itemLine(c.workItem.facts))
    for (const f of c.items?.facts ?? []) {
      lines.push(itemLine(f))
      if (f.tag === 'new') created.push({ id: f.itemId, title: f.title, ...(f.handle ? { handle: f.handle } : {}) })
    }
    for (const w of c.items?.warnings ?? []) lines.push({ k: 'note', value: t(`features.workItems.settle.${w.code}`, { value: w.value ?? '', task: w.task }) })
  }
  const ordered = HOLD_REASONS.filter((h) => holds.has(h))
  if (ordered.length) lines.push({ k: 'note', value: t('features.mcp.plan.taskHold', { why: holdText(ordered, t) }) })
  return { lines, holds: ordered, created }
}
