/**
 * Work orders — what Claude Code cost so far, for the line above ↵ Kette starten (spec §1.5 / §3.6): per project, the
 * average of the Cost field of its last 10 done tasks (newest first, a cost above 0 only). A display only — never a
 * guard (the chain's budget counts this device's worker reports, TaskLocal.spentUsd); "der Regler begrenzt das nicht".
 * Read from the row index (store/rowIndex.ts) — no page-map walk.
 */
import { useWorkspace } from '../../../store/store'
import { rowIdsOf } from '../../../store/rowIndex'
import type { ID } from '../../../store/types'
import { codingProps, readPipeline, stageOfRow } from '../schema'

/** How many done tasks the average reads. */
export const COST_SAMPLE = 10

/** The average Claude Code cost of a project's last done tasks (null: no figures yet). */
export function projectAvgCost(dbId: ID | null): { avg: number; n: number } | null {
  if (!dbId) return null
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db) return null
  const props = codingProps(db)
  if (!props.cost) return null
  const pipeline = readPipeline(db)
  const done: Array<{ at: number; usd: number }> = []
  for (const id of rowIdsOf(dbId)) {
    const row = s.pages[id]
    if (!row || row.trashed) continue
    const usd = row.properties[props.cost]
    if (typeof usd !== 'number' || !(usd > 0) || !Number.isFinite(usd)) continue
    if (stageOfRow(pipeline, props, row)?.kind !== 'done') continue
    done.push({ at: row.updatedAt ?? row.createdAt, usd })
  }
  if (!done.length) return null
  const last = done.sort((a, b) => b.at - a.at).slice(0, COST_SAMPLE)
  return { avg: last.reduce((n, x) => n + x.usd, 0) / last.length, n: last.length }
}
