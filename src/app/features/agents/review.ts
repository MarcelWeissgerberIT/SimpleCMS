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
import { putRun } from './runs'
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
  const res = await asAgent(run.agentId, () => applyChanges(targets, all, (id) => rowIds[id] ?? id))
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
  const kept = res.undo()
  const rowIds = { ...(run.rowIds ?? {}) }
  for (const staged of Object.keys(res.rowIds)) delete rowIds[staged]
  const staged = (run.staged ?? []).map((c) => (res.applied.includes(c.id) ? { ...c, status: 'pending' as const } : c))
  // a server run stays resolved on the server: only this device's copy goes back to pending
  if (run.runner === 'server') patchServerRun({ ...run, staged, rowIds })
  else await putRun({ ...run, staged, rowIds, applied: Math.max(0, (run.applied ?? 0) - res.applied.length) })
  useUI.getState().toast(kept ? tn('features.agent.toast.undoneKept', kept) : t('features.agent.toast.undone'))
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
  await save({ ...run, staged }, [], ids)
}
