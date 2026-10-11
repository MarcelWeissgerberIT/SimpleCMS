/**
 * Custom agents — reviewing what a run staged: apply (all or one, through the workspace agent's
 * apply.ts, stamped `agent:<id>`), discard (with the proposals that build on it), undo an applied
 * batch. Browser runs are stored on this device; server runs are applied here and then marked on
 * the server (POST …/agent-runs/:runId/resolve). "Apply all" says so in a toast with Undo; ONE proposal applied
 * shows its result in its own row, with an Undo there (canUndoChange / undoChange) — no toast that could cover the
 * next key. The run-level Undo of an 'apply' run (undoRunAll) settles its changes the same way: what went back is a
 * proposal again, what was kept (edited since) stays applied. Every proposal of a run discarded (none applied) puts back
 * the agent state the run replaced (stateBack).
 *
 * Every review of a browser run happens under the agent's run lock (runs.ts withRunLock: one at a time, across the
 * tabs of this browser): it reads the stored run again, acts only on proposals that are still open (pending | failed)
 * and writes back only what it changed (patchRun) — a proposal applied, discarded or superseded in another tab
 * meanwhile is never applied twice, and no status another tab wrote is put back. Server runs: under the same lock, read
 * again from the server (freshServerRun — the tab that applied first has marked them there before it lets go), the same
 * status filter; a server that cannot be asked → the review does nothing (it throws). The results say what really
 * happened (applyRun → ApplyResult | null, discardRun → the ids it dropped and, on request, its Undo).
 *
 * Per-field trust (trust/): a review of ONE proposal the person saw in full (`judged`: a row of the run review,
 * Preflight's single A / D / 1–4 on a card shown at its revision) writes a verdict per trust key of that change into
 * this device's book — `accept` (then watched 10 minutes for the person's own edits), `discard` with the reason, or a
 * reasonless one (`single`). Apply all / Discard all never pass `judged`. Undoing that decision takes its verdicts back.
 * Book writes happen inside the review's lock callback; the book never takes the run lock.
 */
import type { ID } from '../../store/types'
import type { TrustKey } from '../../store/autonomy'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { applyChanges, type ApplyResult } from '../ai/agent/apply'
import { depsOf, type DiscardReason, type StagedChange } from '../ai/agent/types'
import { asAgent, stampLocal, touchedBy } from './attribution'
import { withoutWebImages } from './images'
import { undoRunResult } from './undos'
import { getAgentState, loadRuns, patchRun, putAgentState, withRunLock, type AgentState } from './runs'
import { freshServerRun, patchServerRun, resolveServerRun, serverErrorText, serverRunCopy } from './server'
import { isLeader } from './runner'
import { setSupersedeGuard, supersedeGuard, supersedePlan } from './supersede'
import { setProposalsShown } from './hold'
import type { AgentRun, AgentRunStep } from './types'
import type { ChangeRef } from '../ai/agent/types'
import { endRun, noteRun, withWriter, type Writer } from '../../store/writer'
import { noteVerdicts, voidVerdicts } from './trust/book'
import { keysOfChange } from './trust/keys'
import { parseTrustKey } from '../../store/autonomy'
import { unwatch, watchAccepted, type WatchItem } from './trust/watch'

const tn = (key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

/** A proposal nobody has decided on yet (the only ones a review acts on). */
const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'

/**
 * The run as it is now: browser runs read again from this device's store; server runs — before a review acts on them
 * (`fresh`) — read again from the server (another tab may have applied them a moment ago; this tab's copy would not know),
 * otherwise the newest copy here.
 */
async function current(run: AgentRun, fresh = false): Promise<AgentRun | null> {
  if (run.runner === 'server') return fresh ? freshServerRun(run.agentId, run.id) : (serverRunCopy(run.agentId, run.id) ?? run)
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

/** ONE proposal discarded from its row (or Preflight): its Undo (this tab, this session) — the rows of one cascade share it. */
const discardUndos = new Map<string, () => Promise<boolean>>()
export const canUndoDiscard = (runId: string, changeId: string) => discardUndos.has(rowKey(runId, changeId))

/** The Undo of a discard kept in its row: the discarded proposals are open again (every row of the cascade loses it). */
export function undoDiscard(runId: string, changeId: string): Promise<boolean> {
  const undo = discardUndos.get(rowKey(runId, changeId))
  return undo ? undo() : Promise.resolve(false)
}

/** Verdicts this tab wrote for a judged decision, by run and change: what an Undo of that decision takes back. */
const judged = new Map<string, { keys: TrustKey[]; ids: string[] }>()

/** The keys a change of the run writes (staged rows resolved through `rowIds`). */
function trustKeysOf(c: StagedChange, rowIds: Record<string, ID>): TrustKey[] {
  return keysOfChange(c, (id) => rowIds[id] ?? id, useWorkspace.getState().pages)
}

/**
 * The person applied ONE proposal: an `accept` per key, then the fields / the new row are watched for their own edits
 * (values as stored right after the write: option ids, dates with their reminders — never the intent).
 */
async function noteAccept(cur: AgentRun, c: StagedChange, rowIds: Record<string, ID>): Promise<void> {
  const keys = trustKeysOf(c, rowIds)
  if (!keys.length) return
  const pages = useWorkspace.getState().pages
  const real = rowIds[c.pageId] ?? c.pageId
  const row = pages[real] ? real : undefined
  const made = await noteVerdicts(cur.agentId, keys.map((key) => ({ key, v: 'accept' as const, run: cur.id, change: c.id, ...(row ? { row } : {}) })))
  if (!made.length) return
  judged.set(rowKey(cur.id, c.id), { keys, ids: made.map((v) => v.id) })
  if (!row) return
  const now = useWorkspace.getState().pages[row]
  if (!now) return
  const items: WatchItem[] = []
  for (const v of made) {
    const k = parseTrustKey(v.key)
    if (k?.kind === 'prop') items.push({ verdict: v.id, key: v.key, row, prop: k.prop, value: now.properties[k.prop] ?? null })
    else if (k?.kind === 'row') items.push({ verdict: v.id, key: v.key, row, title: now.title })
  }
  if (items.length) watchAccepted(cur.agentId, items)
}

/** The person discarded ONE proposal: a `discard` per key — with the reason, or `single` without one. */
async function noteDiscard(cur: AgentRun, c: StagedChange, rowIds: Record<string, ID>, reason: DiscardReason | undefined): Promise<void> {
  const keys = trustKeysOf(c, rowIds)
  if (!keys.length) return
  const pages = useWorkspace.getState().pages
  const real = rowIds[c.pageId] ?? c.pageId
  const row = pages[real] ? real : undefined
  const made = await noteVerdicts(cur.agentId, keys.map((key) => ({ key, v: 'discard' as const, run: cur.id, change: c.id, ...(reason ? { reason } : { single: true as const }), ...(row ? { row } : {}) })))
  if (made.length) judged.set(rowKey(cur.id, c.id), { keys, ids: made.map((v) => v.id) })
}

/** An Undo took these decisions back: their verdicts go (and their watches end). */
async function voidJudged(agentId: ID, runId: string, changeIds: string[], kind: 'accept' | 'discard'): Promise<void> {
  const keys = new Set<TrustKey>()
  const changes: string[] = []
  for (const id of changeIds) {
    const j = judged.get(rowKey(runId, id))
    if (!j) continue
    judged.delete(rowKey(runId, id))
    j.keys.forEach((k) => keys.add(k))
    changes.push(id)
    unwatch(j.ids)
  }
  if (changes.length) await voidVerdicts(agentId, runId, changes, kind === 'accept' ? ['accept', 'edited'] : ['discard'], [...keys])
}

/**
 * Apply the given proposals of a run (default: every open one) — only those still open when the run is read again
 * under its lock. Several: one Undo toast reverts them. `row`: from a proposal's own row (or Preflight) — its result
 * shows there (applied, or why not) with an Undo key (undoChange), no toast. Resolves with what applyChanges did, or
 * null when nothing was left to apply (applied / discarded / superseded elsewhere, the run gone or running).
 */
export async function applyRun(run: AgentRun, ids?: string[], opts: { row?: boolean; judged?: boolean } = {}): Promise<ApplyResult | null> {
  const out = await withRunLock(run.agentId, async () => {
    const cur = await current(run, true)
    if (!cur || cur.status === 'running') return null
    const all = cur.staged ?? []
    const targets = all.filter((c) => isOpen(c) && (!ids || ids.includes(c.id)))
    if (!targets.length) return null
    const rowIds: Record<string, ID> = { ...(cur.rowIds ?? {}) }
    // proposals from a server run (or stored before images.ts) load no web image either
    const safe = (c: StagedChange): StagedChange => (typeof c.markdown === 'string' ? { ...c, markdown: withoutWebImages(c.markdown) } : c)
    // the run's proposals, applied by the person's review, are still the agent run's writes (store/writer.ts)
    const writer: Writer = { kind: 'agent', id: cur.agentId, run: cur.id }
    // the run goes on (it had ended): its writes from here are one stretch, ended again below
    noteRun(writer)
    let res: ApplyResult
    try {
      res = await asAgent(cur.agentId, () => applyChanges(targets.map(safe), all.map(safe), (id) => rowIds[id] ?? id, { writer }))
    } finally {
      endRun(writer)
    }
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
    // the person's decision on ONE proposal they saw in full: a verdict per trust key (never for Apply all)
    if (opts.judged && ids?.length === 1 && res.applied.includes(ids[0])) {
      const c = all.find((x) => x.id === ids[0])
      if (c) await noteAccept(cur, c, rowIds).catch((e) => console.warn('[one] agents: could not note a verdict', e))
    }
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
  const out = await undoChangeEach(run, changeId)
  return out ? Object.values(out).filter((r) => r === 'kept').length : null
}

/**
 * The same Undo, with what it did to each change of the batch (by change id): 'undone' (pending again) · 'kept' (edited
 * since: it stays applied — fields nobody touched went back) · 'final' (cannot be undone). null: nothing to undo here.
 */
export async function undoChangeEach(run: AgentRun, changeId: string): Promise<Record<string, 'undone' | 'kept' | 'final'> | null> {
  const res = rowUndos.get(rowKey(run.id, changeId))
  if (!res) return null
  // every row of the same batch loses its Undo with it (one batch, one revert)
  for (const [key, r] of rowUndos) if (r === res) rowUndos.delete(key)
  // the decisions that went back take their accept verdicts along (inside the run's lock)
  const { kept } = await undoApply(run, res, true, (undone) => voidJudged(run.agentId, run.id, undone, 'accept'))
  const out: Record<string, 'undone' | 'kept' | 'final'> = {}
  for (const id of res.applied) out[id] = res.final.includes(id) ? 'final' : kept.includes(id) ? 'kept' : 'undone'
  return out
}

/**
 * The Undo of an 'apply' run as a whole (its key in the run's review; this tab, this session): its writes go back, those
 * changes are proposals again; a change edited since stays applied. Returns how many were kept (null: nothing to undo).
 */
export async function undoRunAll(run: AgentRun): Promise<number | null> {
  const out = await settleUndo(run, () => undoRunResult(run.id))
  return out ? out.kept.length : null
}

async function undoApply(run: AgentRun, res: ApplyResult, row = false, onUndone?: (undone: string[]) => Promise<void>): Promise<{ kept: string[] }> {
  // the person's Undo (store/writer.ts)
  const out = await settleUndo(run, () => ({ batch: res, kept: withWriter({ kind: 'you', via: 'undo', ref: run.id }, () => res.undo()).kept }), row, onUndone)
  return { kept: out?.kept ?? [] }
}

/**
 * Under the run's lock: `undo` reverts a batch (null: nothing to undo) and says which changes it kept (edited since);
 * then the run's changes as the review shows them — what went back is a proposal again (an 'apply' run then has
 * proposals to review), what was kept or cannot be undone stays applied, with its row id.
 */
async function settleUndo(run: AgentRun, undo: () => { batch: ApplyResult; kept: string[] } | null, row = false, onUndone?: (undone: string[]) => Promise<void>): Promise<{ kept: string[] } | null> {
  const kept = await withRunLock(run.agentId, async () => {
    const done = undo()
    if (!done) return null
    const { batch: res, kept } = done
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
        // an 'apply' run whose writes went back has proposals to review again — a browser run only: the server settled
        // its run to 'ok' and applies none of it again (freshServerRun), so a server run keeps its status here
        const status = back && r.status === 'ok' && r.runner === 'browser' ? 'staged' : r.status
        return { ...r, status, staged, rowIds, applied: Math.max(0, (r.applied ?? 0) - back) }
      }
      // a server run stays resolved on the server: only this device's copy goes back to pending
      if (cur.runner === 'server') patchServerRun(patch(cur))
      else await patchRun(cur.agentId, cur.id, patch)
    }
    if (onUndone && undone.length) await onUndone(undone).catch((e) => console.warn('[one] agents: could not take a verdict back', e))
    return kept
  })
  if (kept === null) return null
  if (!row) useUI.getState().toast(kept.length ? tn('features.agent.toast.undoneKept', kept.length) : t('features.agent.toast.undone'))
  return { kept }
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
 * still open when the run is read again under its lock. `undo`: hand back an Undo (browser runs) — kept for the rows
 * too (canUndoDiscard / undoDiscard). `reason`: why (on the named proposals only, never their dependants). `judged`:
 * ONE proposal the person saw in full → a `discard` verdict per trust key (with the reason, else `single`).
 */
export async function discardRun(run: AgentRun, ids: string | string[] | null, opts: { undo?: boolean; reason?: DiscardReason; judged?: boolean } = {}): Promise<Discarded> {
  const out = await withRunLock(run.agentId, async () => {
    const cur = await current(run, true)
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
    // the reason goes on the proposals the person named, never on the ones that built on them
    const reasonOn = new Set(opts.reason && ids !== null ? named.filter((id) => drop.has(id)) : [])
    const before = new Map(all.filter((c) => drop.has(c.id)).map((c) => [c.id, c.status]))
    const mark = (list: StagedChange[]) =>
      list.map((c) => (drop.has(c.id) && isOpen(c) ? { ...c, status: 'discarded' as const, ...(reasonOn.has(c.id) ? { reason: opts.reason } : {}) } : c))
    const back = await stateBack({ ...cur, staged: mark(all) })
    await save(cur, (r) => ({ ...r, staged: mark(r.staged ?? []), ...(back ? { steps: [...r.steps, back.note] } : {}) }), [], [...drop])
    // the person's decision on ONE proposal they saw in full: a verdict per trust key (never for Discard all)
    const one = named.length === 1 && drop.has(named[0]) ? all.find((c) => c.id === named[0]) : undefined
    if (opts.judged && ids !== null && one) await noteDiscard(cur, one, cur.rowIds ?? {}, opts.reason).catch((e) => console.warn('[one] agents: could not note a verdict', e))
    return { dropped: [...drop], before, back, cur, one: opts.judged && ids !== null ? one?.id : undefined }
  })
  if (!out) return { dropped: [], undo: null }
  const { dropped, before, back, cur, one } = out
  if (!opts.undo || cur.runner !== 'browser') return { dropped, undo: null }
  const inner = () =>
    withRunLock(cur.agentId, async () => {
      const now = await current(cur)
      const again = new Set((now?.staged ?? []).filter((c) => before.has(c.id) && c.status === 'discarded').map((c) => c.id))
      if (!now || !again.size) return false
      // the agent state goes back only while it is still the one discarding put back (no run, no Clear since)
      const restore = back && sameState(await getAgentState(cur.agentId), back.wrote)
      await patchRun(cur.agentId, cur.id, (r) => ({
        ...r,
        staged: (r.staged ?? []).map((c) => (again.has(c.id) && c.status === 'discarded' ? { ...c, status: before.get(c.id) ?? 'pending', reason: undefined } : c)),
        ...(restore && back ? { steps: withoutLast(r.steps, back.note) } : {}),
      }))
      if (restore && back) await putAgentState(cur.agentId, back.replaced)
      // the decision is taken back: its discard verdicts go too
      if (one && again.has(one)) await voidJudged(cur.agentId, cur.id, [one], 'discard').catch((e) => console.warn('[one] agents: could not take a verdict back', e))
      return true
    })
  // ONE Undo for the whole cascade: kept in its rows (this tab), gone from all of them once used — here or by the caller
  const keys = dropped.map((id) => rowKey(cur.id, id))
  const undo = () => {
    for (const k of keys) if (discardUndos.get(k) === undo) discardUndos.delete(k)
    return inner()
  }
  for (const k of keys) discardUndos.set(k, undo)
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

/**
 * A newer proposal replaces older ones (supersede.ts): the leader tab only, under the agent's run lock, on the stored
 * runs; ONE patch per run touched — the older proposals become 'superseded' (with the one that replaces them), the newer
 * ones list what they replace (with what those replaced before), and each newer run says so in one step. A proposal
 * Preflight showed as a card is never replaced; while Preflight cannot tell yet (its record not loaded), nothing is.
 * Resolves with how many proposals were replaced.
 */
export async function supersedeOlder(agentId: ID): Promise<number> {
  if (!isLeader()) return 0
  return withRunLock(agentId, async () => {
    const runs = await loadRuns(agentId)
    const guard = supersedeGuard()
    let unknown = false
    const opened = (runId: string, changeId: string) => {
      const v = guard ? guard(runId, changeId) : false
      if (v === null) unknown = true
      return v === true
    }
    const plan = supersedePlan(runs, (run, pageId) => run.rowIds?.[pageId] ?? pageId, opened)
    if (unknown || !plan.length) return 0
    const byId = new Map(runs.map((r) => [r.id, r]))
    const older = new Map<string, Map<string, ChangeRef>>()
    const newer = new Map<string, Map<string, ChangeRef[]>>()
    for (const st of plan) {
      const run = older.get(st.runId) ?? new Map<string, ChangeRef>()
      older.set(st.runId, run.set(st.changeId, st.by))
      // what the replaced proposal replaced before goes along: the newest one lists every proposal it stands for
      const before = byId.get(st.runId)?.staged?.find((c) => c.id === st.changeId)?.supersedes ?? []
      const refs = newer.get(st.by.runId) ?? new Map<string, ChangeRef[]>()
      newer.set(st.by.runId, refs.set(st.by.changeId, [...(refs.get(st.by.changeId) ?? []), { runId: st.runId, changeId: st.changeId, at: st.at }, ...before]))
    }
    let n = 0
    for (const runId of new Set([...older.keys(), ...newer.keys()])) {
      const drop = older.get(runId)
      const gain = newer.get(runId)
      // the step counts what this pass replaced (not what the replaced ones had replaced before)
      const gained = plan.filter((st) => st.by.runId === runId).length
      const written = await patchRun(agentId, runId, (r) => {
        const staged = (r.staged ?? []).map((c): StagedChange => {
          const by = drop?.get(c.id)
          if (by && isOpen(c)) return { ...c, status: 'superseded', supersededBy: by }
          const refs = gain?.get(c.id)
          if (!refs) return c
          const have = new Set((c.supersedes ?? []).map((x) => `${x.runId}#${x.changeId}`))
          const add = refs.filter((x) => !have.has(`${x.runId}#${x.changeId}`))
          return add.length ? { ...c, supersedes: [...(c.supersedes ?? []), ...add] } : c
        })
        const step: AgentRunStep[] = gained ? [{ kind: 'note', label: tn('features.agents.supersede.step', gained), state: 'ok' }] : []
        return { ...r, staged, steps: [...r.steps, ...step] }
      })
      if (written && drop) n += written.staged?.filter((c) => c.status === 'superseded' && drop.has(c.id)).length ?? 0
    }
    return n
  })
}

// e2e seam (dev, or ?e2e): the review entry points as the agents page and Preflight call them
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneAgents?: unknown }).__oneAgents = { applyRun, discardRun, undoChange, canUndoChange, canUndoDiscard, undoDiscard, supersedeOlder, loadRuns, isLeader, setSupersedeGuard, setProposalsShown }
}
