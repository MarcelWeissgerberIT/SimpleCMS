/**
 * Coding pipeline + work orders — what only One's own flows write (Prüfaufträge spec § 3.8 / § 2.10, B2 hardening):
 *
 *  - A pipeline task's fields other than its title and priority (FREE_ROLES) decide where and what the worker runs:
 *    Stage, Repo, Branch, Then, Git, PR, Cost, Worker, Claimed, Work order, Step. The person sets them in One (New task,
 *    the panel, the board), task actions and the worker write them — never a custom agent, the MCP bridge or the folder
 *    / GitHub pick-up (`lockedPipelineRole`). Automations, scripts and imports keep their rights (spec § 8 A5).
 *  - A work order's Status plans and halts a chain: never an agent, the bridge or the pick-up (orders/status.ts).
 *  - `pickupKeeps(dbId, propId)`: a field the pick-up leaves as One has it (the file is written again).
 *  - A branch two live tasks share (QA works on the Coding step's branch): One sends no discard / clean-up verb for it
 *    while another live task — not done, not in the trash — holds it (`branchHolders`; same repo by name, same branch).
 */
import { useWorkspace, type WorkspaceState } from '../../store/store'
import type { ID } from '../../store/types'
import { rowIdsOf } from '../../store/rowIndex'
import { codingProps, kindOfDb, optionName, pipelineDbIds, readPipeline, stageOfRow } from './schema'
import { isOrderStatusProp } from './orders/status'

/** The fields of a pipeline task anyone with write access may change. */
export const FREE_ROLES: ReadonlySet<string> = new Set(['priority', 'title'])

/** The role of a pipeline task's field that only One's own flows write (null: none — a free field or no pipeline). */
export function lockedPipelineRole(dbId: ID | null | undefined, propId: ID, s: Pick<WorkspaceState, 'databases'> = useWorkspace.getState()): string | null {
  if (!dbId || !kindOfDb(dbId)) return null
  const db = s.databases[dbId]
  if (!db) return null
  for (const [role, id] of Object.entries(codingProps(db))) if (id === propId) return FREE_ROLES.has(role) ? null : role
  return null
}

/** A field the folder / GitHub pick-up never writes: a locked pipeline role, a work order's Status. */
export function pickupKeeps(dbId: ID, propId: ID): boolean {
  return !!lockedPipelineRole(dbId, propId) || isOrderStatusProp(useWorkspace.getState().databases[dbId], propId)
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export interface BranchHolder {
  id: ID
  title: string
}

/**
 * The other live tasks that hold this task's branch: the same repo (by name), the same branch, not done, not in the
 * trash. [] for a task without a repo or branch of its own.
 */
export function branchHolders(taskId: ID, s: Pick<WorkspaceState, 'pages' | 'databases'> = useWorkspace.getState()): BranchHolder[] {
  const row = s.pages[taskId]
  const dbId = row?.databaseId
  const db = dbId ? s.databases[dbId] : undefined
  if (!row || !db || !kindOfDb(dbId)) return []
  const props = codingProps(db)
  const repo = optionName(db, props.repo, props.repo ? row.properties[props.repo] : null)
  const branch = text(props.branch ? row.properties[props.branch] : null)
  if (!repo || !branch) return []
  const out: BranchHolder[] = []
  for (const otherDb of pipelineDbIds()) {
    const d = s.databases[otherDb]
    if (!d) continue
    const p = codingProps(d)
    if (!p.branch || !p.repo) continue
    let pipeline: ReturnType<typeof readPipeline> | null = null
    for (const id of rowIdsOf(otherDb)) {
      if (id === taskId) continue
      const other = s.pages[id]
      if (!other || other.trashed || text(other.properties[p.branch]) !== branch || optionName(d, p.repo, other.properties[p.repo]) !== repo) continue
      pipeline ??= readPipeline(d)
      if (stageOfRow(pipeline, p, other)?.kind === 'done') continue
      out.push({ id, title: other.title.trim() })
    }
  }
  return out
}
