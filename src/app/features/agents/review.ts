/**
 * Custom agents — reviewing what a run staged: apply (all or one, through the workspace agent's
 * apply.ts, stamped `agent:<id>`), discard (with the proposals that build on it), undo an applied
 * batch. Browser runs are stored on this device; server runs are applied here and then marked on
 * the server (POST …/agent-runs/:runId/resolve). "Apply all" says so in a toast with Undo; ONE proposal applied
 * shows its result in its own row, with an Undo there (canUndoChange / undoChange) — no toast that could cover the
 * next key. Every proposal of a run discarded (none applied) puts back the agent state the run replaced (stateBack).
 *
 * Every review of a browser run happens under the agent's run lock (runs.ts withRunLock: one at a time, across the
 * tabs of this browser): it reads the stored run again, acts only on proposals that are still open (pending | failed)
 * and writes back only what it changed (patchRun) — a proposal applied, discarded or superseded in another tab
 * meanwhile is never applied twice, and no status another tab wrote is put back. Server runs: the newest copy this tab
 * holds, the same status filter. The results say what really happened (applyRun → ApplyResult | null, discardRun →
 * the ids it dropped and, on request, its Undo).
 */
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { applyChanges, type ApplyResult } from '../ai/agent/apply'
import { depsOf, type StagedChange } from '../ai/agent/types'
import { asAgent, stampLocal, touchedBy } from './attribution'
import { withoutWebImages } from './images'
import { getAgentState, loadRuns, patchRun, putAgentState, withRunLock, type AgentState } from './runs'
import { patchServerRun, resolveServerRun, serverErrorText, serverRunCopy } from './server'
import type { AgentRun, AgentRunStep } from './types'

const tn = (key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

/** A proposal nobody has decided on yet (the only ones a review acts on). */
const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'

/** The run as it is now: browser runs read again from this device's store, server runs the newest copy here. */
async function current(run: AgentRun): Promise<AgentRun | null> {
  if (run.runner === 'server') return serverRunCopy(run.agentId, run.id) ?? run
  const runs = await loadRuns(run.agentId)
  return runs.find((r) => r.id === run.id) ?? null
}

/**
 * Write a review's outcome: `patch` maps the run as it is stored to its next value (browser: patchRun — only what the
 * review changed). Server runs: this tab's copy, then the server is told which proposals were applied / discarded.
 */
async function save(cur: AgentRun, patch: (r: AgentRun) => AgentRun, applied: string[], discarded: string[]): Promise<AgentRun> {
  if (cur.runner === 'server') {
    const next = patch(cur)
    patchServerRun(next)
    try {
      await resolveServerRun(cur.id, applied, discarded)
    } catch (e) {
      console.warn('[one] agents: could not mark the server run', e)
      useUI.getState().toast({ message: `${t('features.agents.review.serverFailed')} ${serverErrorText(e)}`, kind: 'error' })
    }
    return next
  }
  return (await patchRun(cur.agentId, cur.id, patch)) ?? patch(cur)
}

/** ONE proposal applied from its row: its Undo (this tab, this session), by run and change. */
const rowUndos = new Map<string, ApplyResult>()
const rowKey = (runId: string, changeId: string) => `${runId}:${changeId}`
export const canUndoChange = (runId: string, changeId: string) => rowUndos.has(rowKey(runId, changeId))

/**
 * Apply the given proposals of a run (default: every open one) — only those still open when the run is read again
 * under its lock. Several: one Undo toast reverts them. `row`: from a proposal's own row (or Preflight) — its result
 * shows there (applied, or why not) with an Undo key (undoChange), no toast. Resolves with what applyChanges did, or
 * null when nothing was left to apply (applied / discarded / superseded elsewhere, the run gone or running).
 */
export async function applyRun(run: AgentRun, ids?: string[], opts: { row?: boolean } = {}): Promise<ApplyResult | null> {
  const out = await withRunLock(run.agentId, async () => {
    const cur = await current(run)
    if (!cur || cur.status === 'running') return null
    const all = cur.staged ?? []
    const targets = all.filter((c) => isOpen(c) && (!ids || ids.includes(c.id)))
    if (!targets.length) return null
    const rowIds: Record<string, ID> = { ...(cur.rowIds ?? {}) }
    // proposals from a server run (or stored before images.ts) load no web image either
    const safe = (c: StagedChange): StagedChange => (typeof c.markdown === 'string' ? { ...c, markdown: withoutWebImages(c.markdown) } : c)
    const res = await asAgent(cur.agentId, () => applyChanges(targets.map(safe), all.map(safe), (id) => rowIds[id] ?? id))
    Object.assign(rowIds, res.rowIds)
    const mark = (list: StagedChange[]) =>
      list.map((c): StagedChange => {
        if (res.applied.includes(c.id)) return { ...c, status: 'applied', error: undefined }
        const f = res.failed.find((x) => x.id === c.id)
        return f ? { ...c, status: 'failed', error: f.error } : c
      })
    const [changed, created] = touchedBy(mark(all), res.applied, rowIds)
    stampLocal(cur.agentId, changed, created)
    // the row's Undo before the run is stored: the row draws it as soon as it shows the change applied
    if (opts.row) for (const id of res.applied) rowUndos.set(rowKey(cur.id, id), res)
    const next = await save(cur, (r) => ({ ...r, staged: mark(r.staged ?? []), rowIds: { ...(r.rowIds ?? {}), ...res.rowIds }, applied: (r.applied ?? 0) + res.applied.length }), res.applied, [])
    return { res, next }
  })
  if (!out) return null
  const { res, next } = out
  if (opts.row) return res
  const ui = useUI.getState()
  if (res.applied.length)
    ui.toast({
      message: tn('features.agent.toast.applied', res.applied.length),
      kind: 'success',
      action: { label: t('common.undo'), run: () => void undoApply(next, res) },
      timeout: 10_000,
    })
  if (res.failed.length) ui.toast({ message: tn('features.agent.toast.failed', res.failed.length), kind: 'error' })
  return res
}

/**
 * The Undo in the row of a proposal applied on its own: reverts it — and the rest of the batch it was applied with —
 * (`run`: the run; it is read again). Returns how many of its changes were kept because they were edited since (null:
 * nothing to undo here).
 */
export async function undoChange(run: AgentRun, changeId: string): Promise<number | null> {
  const res = rowUndos.get(rowKey(run.id, changeId))
  if (!res) return null
  // every row of the same batch loses its Undo with it (one batch, one revert)
  for (const [key, r] of rowUndos) if (r === res) rowUndos.delete(key)
  return undoApply(run, res, true)
}

async function undoApply(run: AgentRun, res: ApplyResult, row = false): Promise<number> {
  const kept = await withRunLock(run.agentId, async () => {
    const { kept } = res.undo()
    // what was kept (edited since) or cannot be undone stays applied, with its row id
    const stays = new Set([...kept, ...res.final])
    const undone = res.applied.filter((id) => !stays.has(id))
    const cur = await current(run)
    if (cur) {
      const keptPages = new Set((cur.staged ?? []).filter((c) => stays.has(c.id)).map((c) => c.pageId))
      const patch = (r: AgentRun): AgentRun => {
        const rowIds = { ...(r.rowIds ?? {}) }
        for (const staged of Object.keys(res.rowIds)) if (!keptPages.has(staged)) delete rowIds[staged]
        const back = (r.staged ?? []).filter((c) => undone.includes(c.id) && c.status === 'applied').length
        const staged = (r.staged ?? []).map((c) => (undone.includes(c.id) && c.status === 'applied' ? { ...c, status: 'pending' as const } : c))
        return { ...r, staged, rowIds, applied: Math.max(0, (r.applied ?? 0) - back) }
      }
      // a server run stays resolved on the server: only this device's copy goes back to pending
      if (cur.runner === 'server') patchServerRun(patch(cur))
      else await patchRun(cur.agentId, cur.id, patch)
    }
    return kept
  })
  if (!row) useUI.getState().toast(kept.length ? tn('features.agent.toast.undoneKept', kept.length) : t('features.agent.toast.undone'))
  return kept.length
}

/** What discarding put back of the agent's state (stateBack): the state it wrote, the one it replaced, its note. */
interface StateBack {
  wrote: AgentState | null
  replaced: AgentState
  note: AgentRunStep
}

export interface Discarded {
  /** the proposals discarded: the ones named and the open ones that build on them */
  dropped: string[]
  /** browser runs, when asked for: puts exactly those back (and the agent state, while it is still the one put back) */
  undo: (() => Promise<boolean>) | null
}

/**
 * Discard proposals of a run (`ids`; null = every open one) and the open proposals that build on them — only those
 * still open when the run is read again under its lock. `undo`: hand back an Undo (browser runs).
 */
export async function discardRun(run: AgentRun, ids: string | string[] | null, opts: { undo?: boolean } = {}): Promise<Discarded> {
  const out = await withRunLock(run.agentId, async () => {
    const cur = await current(run)
    if (!cur || cur.status === 'running') return null
    const all = cur.staged ?? []
    const named = ids === null ? all.filter(isOpen).map((c) => c.id) : Array.isArray(ids) ? ids : [ids]
    const drop = new Set(named.filter((id) => all.some((c) => c.id === id && isOpen(c))))
    let grew = true
    while (grew) {
      grew = false
      for (const c of all) {
        if (drop.has(c.id) || !isOpen(c) || !depsOf(c).some((d) => drop.has(d))) continue
        drop.add(c.id)
        grew = true
      }
    }
    if (!drop.size) return null
    const before = new Map(all.filter((c) => drop.has(c.id)).map((c) => [c.id, c.status]))
    const mark = (list: StagedChange[]) => list.map((c) => (drop.has(c.id) && isOpen(c) ? { ...c, status: 'discarded' as const } : c))
    const back = await stateBack({ ...cur, staged: mark(all) })
    await save(cur, (r) => ({ ...r, staged: mark(r.staged ?? []), ...(back ? { steps: [...r.steps, back.note] } : {}) }), [], [...drop])
    return { dropped: [...drop], before, back, cur }
  })
  if (!out) return { dropped: [], undo: null }
  const { dropped, before, back, cur } = out
  if (!opts.undo || cur.runner !== 'browser') return { dropped, undo: null }
  const undo = () =>
    withRunLock(cur.agentId, async () => {
      const now = await current(cur)
      const again = new Set((now?.staged ?? []).filter((c) => before.has(c.id) && c.status === 'discarded').map((c) => c.id))
      if (!now || !again.size) return false
      // the agent state goes back only while it is still the one discarding put back (no run, no Clear since)
      const restore = back && sameState(await getAgentState(cur.agentId), back.wrote)
      await patchRun(cur.agentId, cur.id, (r) => ({
        ...r,
        staged: (r.staged ?? []).map((c) => (again.has(c.id) && c.status === 'discarded' ? { ...c, status: before.get(c.id) ?? 'pending' } : c)),
        ...(restore && back ? { steps: withoutLast(r.steps, back.note) } : {}),
      }))
      if (restore && back) await putAgentState(cur.agentId, back.replaced)
      return true
    })
  return { dropped, undo }
}

const sameState = (a: AgentState | null, b: AgentState | null) => (a === null || b === null ? a === b : a.runId === b.runId && a.at === b.at && a.json === b.json)

/** The steps without the last one that is `step` (the note an Undo takes back). */
function withoutLast(steps: AgentRunStep[], step: AgentRunStep): AgentRunStep[] {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind === step.kind && steps[i].label === step.label) return [...steps.slice(0, i), ...steps.slice(i + 1)]
  return steps
}

/**
 * Every change of the run discarded, none applied (an 'apply' run's changes undone first): its work was never written.
 * A superseded change is not discarded: a run holding one keeps its state, and the walk below stops at it.
 */
const allDiscarded = (r: AgentRun) => !!r.staged?.length && r.staged.every((c) => c.status === 'discarded')

/**
 * Every proposal of a browser run discarded, none applied: the agent state the run saved (its comment counts, cursors …
 * stand for work that was never written) goes back to the one it replaced — only while the saved state is still this
 * run's (no later run, no Clear since). Runs discarded in any order end alike: the state it replaced was saved by
 * another run whose every change is discarded too → on to the state THAT run replaced, and so on — the state of the
 * newest run that still has applied (or open, or superseded) work, or the one from before them all. A run partly
 * applied keeps its state. Returns what it put back (null: nothing), with the note for the run's steps.
 */
async function stateBack(run: AgentRun): Promise<StateBack | null> {
  if (run.runner !== 'browser' || run.stateBefore === undefined || !allDiscarded(run)) return null
  const cur = await getAgentState(run.agentId)
  if (!cur || cur.runId !== run.id) return null
  let back: AgentState | null = run.stateBefore
  const runs = await loadRuns(run.agentId).catch(() => [] as AgentRun[])
  const seen = new Set<string>([run.id])
  for (let r = back ? runs.find((x) => x.id === back!.runId) : undefined; back && r && !seen.has(r.id) && allDiscarded(r) && r.stateBefore !== undefined; r = back ? runs.find((x) => x.id === back!.runId) : undefined) {
    seen.add(r.id)
    back = r.stateBefore
  }
  await putAgentState(run.agentId, back)
  return { wrote: back, replaced: cur, note: { kind: 'note', label: t('features.agents.state.restored'), state: 'ok' } }
}

// e2e seam (dev, or ?e2e): the review entry points as the agents page and Preflight call them
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneAgents?: unknown }).__oneAgents = { applyRun, discardRun, undoChange, canUndoChange, loadRuns }
}
