/**
 * One MCP — task blocks (the local bridge only, until the team server learns them):
 *  - one_list_work_items: the task index as JSON (every live page of this workspace, templates never), with the
 *    workspace agent's filters (list_work_items — one implementation).
 *  - one_update_work_item: the workspace agent's update_work_item on the call's own stage (one implementation of the
 *    checks: people only existing ones, links in scope, no loops, a reminder needs a due date). One approval-card line
 *    per task (before → after); a change that assigns someone, sets a reminder, changes an assigned task or adds a
 *    blocker is always asked — also in "Apply directly". The answer: the tasks after the change.
 */
import { t } from '../../i18n'
import type { ID } from '../../store/types'
import { itemScope, listItems } from '../ai/agent/workItems'
import { ToolInputError } from '../ai/agent/tools'
import { getItemIndex, isBlocked, isOverdue, peopleResolver, settleWorld, type ItemEntry, type SettleWorld } from '../workitems'
import { applyStaged, callStage, itemPlan, mcpMessage, stageWith } from './stage'
import { McpToolError, pageUrl, pathOf, ws } from './values'
import type { WritePlan } from './plan'

const STATUS: Record<string, string> = { todo: 'todo', in_progress: 'in progress', done: 'done' }

/** A task as JSON (the list's answer, the update's answer). */
function taskJson(e: ItemEntry, world: SettleWorld, name: (id: string) => string | null, now: number): Record<string, unknown> {
  const index = getItemIndex()
  const a = e.attrs
  const page = ws().pages[e.pageId]
  return {
    id: e.itemId,
    title: e.title,
    status: STATUS[a.status] ?? a.status,
    due: a.due,
    reminder: a.reminder,
    people: a.people.map((id) => ({ id, name: name(id) ?? id })),
    blocked: isBlocked(index, e),
    overdue: isOverdue(e, now),
    blockedBy: a.blockedBy.map((id) => {
      const b = index.byId.get(id)
      return b ? { id, title: b.title, status: STATUS[b.attrs.status] ?? b.attrs.status } : { id, title: null, status: null }
    }),
    related: a.related.map((id) => ({ id, title: world.entry(id)?.title ?? null })),
    page: { id: e.pageId, title: page?.title.trim() || 'Untitled', path: pathOf(e.pageId) },
    url: `${pageUrl(e.pageId)}${e.blockId ? `?b=${e.blockId}` : ''}`,
  }
}

const asMcp = <T>(fn: () => T): T => {
  try {
    return fn()
  } catch (e) {
    if (e instanceof ToolInputError) throw new McpToolError(mcpMessage(e.message))
    throw e
  }
}

/** one_list_work_items */
export function listWorkItemsMcp(args: Record<string, unknown>) {
  const world = settleWorld()
  const inScope = itemScope(world)
  const res = asMcp(() => listItems(args, callStage(), world, inScope))
  const name = peopleResolver(world, true).name
  return {
    count: res.total,
    items: res.items.map((e) => taskJson(e, world, name, res.now)),
    ...(res.items.length < res.total ? { truncated: true } : {}),
    ...(res.loading ? { loading: `${res.index.unloaded} pages are still loading — the list may be incomplete.` } : {}),
  }
}

/** The tasks after a change, by id (gone ones left out). */
function tasksNow(ids: readonly string[]): Array<Record<string, unknown>> {
  const world = settleWorld()
  const name = peopleResolver(world, true).name
  const now = Date.now()
  const index = getItemIndex()
  return ids.flatMap((id) => {
    const e = index.byId.get(id)
    return e ? [taskJson(e, world, name, now)] : []
  })
}

/** one_update_work_item */
export function planUpdateWorkItems(args: Record<string, unknown>): WritePlan {
  const stage = callStage()
  stageWith(stage, 'update_work_item', { updates: args.updates })
  const changes = stage.changes.filter((c) => c.kind === 'workItem' && c.workItem)
  const ids: ID[] = changes.map((c) => c.workItem!.itemId)
  const asked = Array.isArray(args.updates) ? (args.updates as Array<Record<string, unknown>>).map((u) => (typeof u?.item === 'string' ? u.item.trim() : '')).filter(Boolean) : []
  const items = itemPlan(stage.changes)
  const first = changes[0]
  return {
    tool: 'one_update_work_item',
    verb: t('features.mcp.verb.updateTasks'),
    summary: changes.length === 1 ? t('features.mcp.sum.updateTasksOne', { title: first?.title ?? '' }) : t('features.mcp.sum.updateTasks', { n: changes.length }),
    target: changes.length === 1 ? (first?.title ?? '') : t('features.mcp.sum.updateTasks', { n: changes.length }),
    lines: items.lines,
    ...(items.holds.length ? { alwaysAsk: true } : {}),
    noop: changes.length ? undefined : { tasks: tasksNow(asked), note: 'No change: the tasks already have these values.' },
    async apply(writer) {
      const { undo } = await applyStaged(stage.changes, writer)
      return { result: { tasks: tasksNow(ids) }, undo }
    },
  }
}
