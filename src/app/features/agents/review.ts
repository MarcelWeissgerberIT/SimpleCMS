/**
 * Custom agents — reviewing what a run staged: apply (all or one, through the workspace agent's
 * apply.ts, stamped `agent:<id>`), discard (with the proposals that build on it), undo an applied
 * batch. Browser runs are stored on this device; server runs are applied here and then marked on
 * the server (POST …/agent-runs/:runId/resolve).
 */
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { applyChanges, type ApplyResult } from '../ai/agent/apply'
import type { StagedChange } from '../ai/agent/types'
import { asAgent, stampLocal } from './attribution'
import { touchedBy } from './exec'
import { withoutWebImages } from './images'
import { getAgentState, putAgentState, putRun } from './runs'
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

/** Apply the given proposals of a run (default: every pending one). One Undo toast reverts them. */
export async function applyRun(run: AgentRun, ids?: string[]): Promise<void> {
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
  await save(next, res.applied, [])
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

async function undoApply(run: AgentRun, res: ApplyResult) {
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
  useUI.getState().toast(kept.length ? tn('features.agent.toast.undoneKept', kept.length) : t('features.agent.toast.undone'))
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

/**
 * Every proposal of a browser run discarded, none applied: the agent state the run saved (its comment counts, cursors …
 * stand for work that was never written) goes back to the one it replaced — only while the saved state is still this
 * run's (no later run, no Clear since). A run partly applied keeps its state. The run's steps say so.
 */
async function stateBack(run: AgentRun): Promise<AgentRun> {
  const staged = run.staged ?? []
  if (run.runner !== 'browser' || run.stateBefore === undefined || !staged.length || staged.some((c) => c.status !== 'discarded')) return run
  const cur = await getAgentState(run.agentId)
  if (cur?.runId !== run.id) return run
  await putAgentState(run.agentId, run.stateBefore)
  return { ...run, steps: [...run.steps, { kind: 'note', label: t('features.agents.state.restored'), state: 'ok' }] }
}
