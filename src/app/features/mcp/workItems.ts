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
import { ToolInputError, withReadLimit } from '../ai/agent/tools'
import { stageTargets } from './gate'
import { mcpReadLimit } from './limits'
import { getItemIndex, isBlocked, isOverdue, peopleResolver, settleWorld, type ItemEntry, type SettleWorld } from '../workitems'
import { applyStaged, callStage, itemPlan, mcpMessage, stageWith } from './stage'
import { McpToolError, pageUrl, pathOf, ws } from './values'
import type { WritePlan } from './plan'
import { sideEffects, sideHold, type SideEffects } from './rows'

const STATUS: Record<string, string> = { todo: 'todo', in_progress: 'in progress', done: 'done' }

/**
 * A task as JSON (the list's answer, the update's answer). `inScope`: what the person lets MCP read (context marks) — a
 * linked task outside it is named by id only (no title, no status).
 */
function taskJson(e: ItemEntry, world: SettleWorld, name: (id: string) => string | null, now: number, inScope: (e: { itemId: string; pageId: ID }) => boolean): Record<string, unknown> {
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
      return b && inScope(b) ? { id, title: b.title, status: STATUS[b.attrs.status] ?? b.attrs.status } : { id, title: null, status: null }
    }),
    related: a.related.map((id) => {
      const r = world.entry(id)
      return { id, title: r && inScope(r) ? r.title : null }
    }),
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

/**
 * one_list_work_items — under the person's context marks (limits.ts mcpReadLimit, as the terminal's read limit): a task
 * in a block they excluded is not listed, and a listed task's link to one is named by id only.
 */
export function listWorkItemsMcp(args: Record<string, unknown>) {
  return withReadLimit(mcpReadLimit, () => {
    const world = settleWorld()
    const inScope = itemScope(world)
    const res = asMcp(() => listItems(args, callStage(), world, inScope))
    const name = peopleResolver(world, true).name
    return {
      count: res.total,
      items: res.items.map((e) => taskJson(e, world, name, res.now, inScope)),
      ...(res.items.length < res.total ? { truncated: true } : {}),
      ...(res.loading ? { loading: `${res.index.unloaded} pages are still loading — the list may be incomplete.` } : {}),
    }
  })
}

/** The tasks after a change, by id (gone ones and ones the context marks exclude left out). */
function tasksNow(ids: readonly string[]): Array<Record<string, unknown>> {
  return withReadLimit(mcpReadLimit, () => {
    const world = settleWorld()
    const inScope = itemScope(world)
    const name = peopleResolver(world, true).name
    const now = Date.now()
    const index = getItemIndex()
    return ids.flatMap((id) => {
      const e = index.byId.get(id)
      return e && inScope(e) ? [taskJson(e, world, name, now, inScope)] : []
    })
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
  // a task lives in a page's text: a task in a ROW changes that row's text, and what fills again on it is named (as
  // one_update_page on a row); from MCP_LIMITS.rowsAsk such rows the call is always asked (sideHold), task holds as they are
  const rowsByDb = new Map<ID, Set<ID>>()
  for (const c of stage.changes) {
    const dbId = ws().pages[c.pageId]?.databaseId
    if (dbId) rowsByDb.set(dbId, (rowsByDb.get(dbId) ?? new Set()).add(c.pageId))
  }
  const sides: SideEffects[] = []
  for (const [dbId, rows] of rowsByDb) {
    const db = ws().databases[dbId]
    if (db) sides.push(sideEffects(db, rows.size, { text: true, props: new Set() }))
  }
  const hold = sideHold(sides)
  const lines = [...items.lines, ...sides.flatMap((x) => x.lines), ...hold.lines]
  const first = changes[0]
  return {
    tool: 'one_update_work_item',
    verb: t('features.mcp.verb.updateTasks'),
    summary: changes.length === 1 ? t('features.mcp.sum.updateTasksOne', { title: first?.title ?? '' }) : t('features.mcp.sum.updateTasks', { n: changes.length }),
    target: changes.length === 1 ? (first?.title ?? '') : t('features.mcp.sum.updateTasks', { n: changes.length }),
    lines,
    ...(items.holds.length || hold.alwaysAsk ? { alwaysAsk: true } : {}),
    // the pages holding the tasks (their text)
    targets: stageTargets(stage.changes),
    noop: changes.length ? undefined : { tasks: tasksNow(asked), note: 'No change: the tasks already have these values.' },
    async apply(writer) {
      await applyStaged(stage.changes, writer)
      return { result: { tasks: tasksNow(ids) } }
    },
  }
}
