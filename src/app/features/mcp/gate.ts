/**
 * One MCP — the bridge's write gate (Weg 4 D4; the rule: src/shared/mcp/targets.ts, the team server runs the same one).
 * Every planner names what its call touches (`WritePlan.targets`); service.ts runs `assertWritable` once when the call is
 * planned and again right before `plan.apply(writer)` — a page locked, trashed, made One's own or marked by the person while
 * the card waited is refused there, and nothing is written. The planners' own checks stay as a backstop.
 *
 *  - stageTargets(changes): what a stage of agent changes touches (create_page → its parent, rows → their database …)
 *  - assertWritable(targets, phase): the gate's refusal as an McpToolError
 *  - asksAlways(targets): ≥ MCP_LIMITS.rowsAsk rows in databases that start paid AI work or send something out of One
 */
import type { ID } from '../../store/types'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { autofillOf } from '../../database'
import { isContextLimited } from '../../editor'
import type { StagedChange } from '../ai/agent/types'
import { heavyRows, mergeTargets, noTargets, targetProblem, type GatePhase, type TargetWorld, type WriteTargets } from '../../../shared/mcp/targets'
import { MCP_LIMITS } from '../../../shared/mcp/tables'
import { systemBelow, systemOf, systemRefusal } from './system'
import { McpToolError, titleOf, ws } from './values'

export type { WriteTargets } from '../../../shared/mcp/targets'
export { mergeTargets, noTargets } from '../../../shared/mcp/targets'

/** The store as the gate reads it. */
function world(): TargetWorld {
  const { pages, databases } = ws()
  return {
    exists: (id) => !!pages[id],
    inTemplate: (id) => inTemplate(pages, id),
    inTrash: (id) => !!pages[id]?.trashed || isEffectivelyTrashed(pages, id),
    title: (id) => titleOf(pages[id]),
    system: (id, path, why) => {
      const hit = systemOf(id)
      return hit ? systemRefusal(hit, path, why) : null
    },
    systemBelow: (id, path) => {
      const hit = systemBelow(id)
      return hit ? systemRefusal(hit, path) : null
    },
    pageLocked: (id) => !!pages[id]?.settings?.locked,
    databaseLocked: (id) => !!databases[id]?.locked,
    isPrivate: (id) => !!pages[id]?.private,
    marked: (id) => isContextLimited(id),
  }
}

/** Refuse the call when One does not let an agent write what it touches (nothing is written). */
export function assertWritable(targets: WriteTargets | undefined, phase: GatePhase): void {
  if (!targets) return
  const why = targetProblem(targets, world(), phase)
  if (why) throw new McpToolError(why)
}

/** Only ids the store holds now (a page a stage makes has none yet). */
const known = (ids: ReadonlyArray<ID | null | undefined>): ID[] => ids.filter((id): id is ID => !!id && !!ws().pages[id])

/** What a stage of agent changes touches. */
export function stageTargets(changes: readonly StagedChange[]): WriteTargets {
  const { pages } = ws()
  const parts: Array<Partial<WriteTargets>> = []
  for (const c of changes) {
    const page = pages[c.pageId]
    switch (c.kind) {
      case 'create_page':
        parts.push({ places: known([c.parentId]) })
        break
      case 'create_row':
        if (c.databaseId && pages[c.databaseId]) parts.push({ rows: [{ db: c.databaseId, ids: [], made: 1 }] })
        break
      case 'update_row':
        if (page?.databaseId) parts.push({ rows: [{ db: page.databaseId, ids: [page.id] }] })
        break
      case 'rename':
        if (page?.databaseId) parts.push({ rows: [{ db: page.databaseId, ids: [page.id] }] })
        else parts.push({ places: known([c.pageId]) })
        break
      case 'append':
      case 'edit':
      case 'workItem':
        parts.push({ content: known([c.pageId]) })
        break
      default:
        parts.push({ places: known([c.pageId, c.parentId, c.databaseId]) })
    }
  }
  return mergeTargets(...parts)
}

/** Does a database start paid AI work or send something out of One when its rows change (any of them)? */
function startsWork(dbId: ID): boolean {
  const db = ws().databases[dbId]
  if (!db) return false
  if (db.properties.some((p) => autofillOf(p)?.auto)) return true
  if ((db.automations ?? []).some((a) => a.enabled && a.actions.some((x) => x.type === 'webhook' || x.type === 'run_script'))) return true
  return Object.values(ws().agents ?? {}).some((a) => a.enabled && (a.trigger.type === 'row_created' || a.trigger.type === 'row_changed') && a.trigger.databaseId === dbId)
}

/**
 * Asked even in "Apply directly": ≥ MCP_LIMITS.rowsAsk rows in databases that start paid or outward work — the number of
 * such rows (0: not asked for this reason).
 */
export function asksAlways(targets: WriteTargets | undefined): number {
  const n = targets ? heavyRows(targets, startsWork) : 0
  return n >= MCP_LIMITS.rowsAsk ? n : 0
}

