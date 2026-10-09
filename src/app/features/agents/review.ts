/**
 * Custom agents — reviewing what a run staged: apply (all or one, through the workspace agent's
 * apply.ts, stamped `agent:<id>`), discard (with the proposals that build on it), undo an applied
 * batch. Browser runs are stored on this device; server runs are applied here and then marked on
 * the server (POST …/agent-runs/:runId/resolve). "Apply all" says so in a toast with Undo; ONE proposal applied
 * shows its result in its own row, with an Undo there (canUndoChange / undoChange) — no toast that could cover the
 * next key. Every proposal of a run discarded (none applied) puts back the agent state the run replaced (stateBack).
 */
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { applyChanges, type ApplyResult } from '../ai/agent/apply'
import type { StagedChange } from '../ai/agent/types'
import { asAgent, stampLocal } from './attribution'
import { touchedBy } from './exec'
import { withoutWebImages } from './images'
import { getAgentState, loadRuns, putAgentState, putRun, type AgentState } from './runs'
import { patchServerRun, resolveServerRun, serverErrorText } from './server'
import type { AgentRun } from './types'

const tn = (key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

async function save(run: AgentRun, applied: string[], discarded: string[]): Promise<void> {
  if (run.runner === 'server') {
    patchServerRun(run)
    try {
      await resolveServerRun(run.id, applied, discarded)
    } catch (e) {
      console.warn('[one] agents: could not mark the server run', e)
      useUI.getState().toast({ message: `${t('features.agents.review.serverFailed')} ${serverErrorText(e)}`, kind: 'error' })
    }
  } else await putRun(run)
}

/** ONE proposal applied from its row: its Undo (this tab, this session), by run and change. */
const rowUndos = new Map<string, ApplyResult>()
const rowKey = (runId: string, changeId: string) => `${runId}:${changeId}`
export const canUndoChange = (runId: string, changeId: string) => rowUndos.has(rowKey(runId, changeId))

/**
 * Apply the given proposals of a run (default: every pending one). Several: one Undo toast reverts them. `row`: ONE
 * proposal from its own row — its result shows there (applied, or why not) with an Undo key (undoChange), no toast.
 */
export async function applyRun(run: AgentRun, ids?: string[], opts: { row?: boolean } = {}): Promise<void> {
  const all = run.staged ?? []
  const targets = ids ? all.filter((c) => ids.includes(c.id)) : all.filter((c) => c.status === 'pending' || c.status === 'failed')
  if (!targets.length) return
  const rowIds: Record<string, ID> = { ...(run.rowIds ?? {}) }
  // proposals from a server run (or stored before images.ts) load no web image either
  const safe = (c: StagedChange): StagedChange => (typeof c.markdown === 'string' ? { ...c, markdown: withoutWebImages(c.markdown) } : c)
  const res = await asAgent(run.agentId, () => applyChanges(targets.map(safe), all.map(safe), (id) => rowIds[id] ?? id))
  Object.assign(rowIds, res.rowIds)
  const staged = all.map((c): StagedChange => {
    if (res.applied.includes(c.id)) return { ...c, status: 'applied', error: undefined }
    const f = res.failed.find((x) => x.id === c.id)
    return f ? { ...c, status: 'failed', error: f.error } : c
  })
  const [changed, created] = touchedBy(staged, res.applied, rowIds)
  stampLocal(run.agentId, changed, created)
  const next: AgentRun = { ...run, staged, rowIds, applied: (run.applied ?? 0) + res.applied.length }
  // the row's Undo before the run is stored: the row draws it as soon as it shows the change applied
  if (opts.row) for (const id of res.applied) rowUndos.set(rowKey(run.id, id), res)
  await save(next, res.applied, [])
  if (opts.row) return
  const ui = useUI.getState()
  if (res.applied.length)
    ui.toast({
      message: tn('features.agent.toast.applied', res.applied.length),
      kind: 'success',
      action: { label: t('common.undo'), run: () => void undoApply(next, res) },
      timeout: 10_000,
    })
  if (res.failed.length) ui.toast({ message: tn('features.agent.toast.failed', res.failed.length), kind: 'error' })
}

/**
 * The Undo in the row of a proposal applied on its own: reverts it (`run`: the run as it is now). Returns how many of
 * its changes were kept because they were edited since (null: nothing to undo here).
 */
export async function undoChange(run: AgentRun, changeId: string): Promise<number | null> {
  const key = rowKey(run.id, changeId)
  const res = rowUndos.get(key)
  if (!res) return null
  rowUndos.delete(key)
  return undoApply(run, res, true)
}

async function undoApply(run: AgentRun, res: ApplyResult, row = false): Promise<number> {
  const { kept } = res.undo()
  // what was kept (edited since) or cannot be undone stays applied, with its row id
  const stays = new Set([...kept, ...res.final])
  const rowIds = { ...(run.rowIds ?? {}) }
  const keptPages = new Set((run.staged ?? []).filter((c) => stays.has(c.id)).map((c) => c.pageId))
  for (const staged of Object.keys(res.rowIds)) if (!keptPages.has(staged)) delete rowIds[staged]
  const undone = res.applied.filter((id) => !stays.has(id))
  const staged = (run.staged ?? []).map((c) => (undone.includes(c.id) ? { ...c, status: 'pending' as const } : c))
  // a server run stays resolved on the server: only this device's copy goes back to pending
  if (run.runner === 'server') patchServerRun({ ...run, staged, rowIds })
  else await putRun({ ...run, staged, rowIds, applied: Math.max(0, (run.applied ?? 0) - undone.length) })
  if (!row) useUI.getState().toast(kept.length ? tn('features.agent.toast.undoneKept', kept.length) : t('features.agent.toast.undone'))
  return kept.length
}

/** Discard a proposal of a run (and the proposals that build on it); null = every open one. */
export async function discardRun(run: AgentRun, id: string | null): Promise<void> {
  const all = run.staged ?? []
  const drop = new Set<string>(id ? [id] : all.filter((c) => c.status === 'pending' || c.status === 'failed').map((c) => c.id))
  let grew = true
  while (grew) {
    grew = false
    for (const c of all) {
      if (!c.dependsOn || !drop.has(c.dependsOn) || drop.has(c.id) || c.status === 'applied') continue
      drop.add(c.id)
      grew = true
    }
  }
  const ids = all.filter((c) => drop.has(c.id) && c.status !== 'applied').map((c) => c.id)
  if (!ids.length) return
  const staged = all.map((c) => (ids.includes(c.id) ? { ...c, status: 'discarded' as const } : c))
  await save(await stateBack({ ...run, staged }), [], ids)
}

/** Every change of the run discarded, none applied (an 'apply' run's changes undone first): its work was never written. */
const allDiscarded = (r: AgentRun) => !!r.staged?.length && r.staged.every((c) => c.status === 'discarded')

/**
 * Every proposal of a browser run discarded, none applied: the agent state the run saved (its comment counts, cursors …
 * stand for work that was never written) goes back to the one it replaced — only while the saved state is still this
 * run's (no later run, no Clear since). Runs discarded in any order end alike: the state it replaced was saved by
 * another run whose every change is discarded too → on to the state THAT run replaced, and so on — the state of the
 * newest run that still has applied (or open) work, or the one from before them all. A run partly applied keeps its
 * state. The run's steps say so.
 */
async function stateBack(run: AgentRun): Promise<AgentRun> {
  if (run.runner !== 'browser' || run.stateBefore === undefined || !allDiscarded(run)) return run
  const cur = await getAgentState(run.agentId)
  if (cur?.runId !== run.id) return run
  let back: AgentState | null = run.stateBefore
  const runs = await loadRuns(run.agentId).catch(() => [] as AgentRun[])
  const seen = new Set<string>([run.id])
  for (let r = back ? runs.find((x) => x.id === back!.runId) : undefined; back && r && !seen.has(r.id) && allDiscarded(r) && r.stateBefore !== undefined; r = back ? runs.find((x) => x.id === back!.runId) : undefined) {
    seen.add(r.id)
    back = r.stateBefore
  }
  await putAgentState(run.agentId, back)
  return { ...run, steps: [...run.steps, { kind: 'note', label: t('features.agents.state.restored'), state: 'ok' }] }
}
