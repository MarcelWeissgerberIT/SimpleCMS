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
 * Preflight's single A / D / 1–4 on a card shown at its revision; a body the preview cuts only once shown whole —
 * `whole`) writes a verdict per trust key of that change into this device's book — `accept` (then watched 10 minutes
 * for the person's own edits), `discard` with the reason, or a reasonless one (`single`) — and only once the decision
 * holds (a server that refused it: none). Apply all / Discard all never pass `judged`. Undoing that decision takes its
 * verdicts back (an Undo that keeps an edited field: the verdicts of the fields it put back). Book writes happen inside
 * the review's lock callback; the book never takes the run lock.
 */
import type { ID } from '../../store/types'
import type { TrustKey } from '../../store/autonomy'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { applyChanges, type ApplyResult } from '../ai/agent/apply'
import { depsOf, onEjected, type DiscardReason, type StagedChange } from '../ai/agent/types'
import { asAgent, stampLocal, touchedBy } from './attribution'
import { scopeFilter } from './scope'
import { withoutWebImages } from './images'
import { forgetRunUndo, undoRunResult } from './undos'
import { getAgentState, loadRuns, patchRun, putAgentState, putRun, withRunLock, type AgentState } from './runs'
import { freshServerRun, patchServerRun, resolveServerRun, serverErrorText, serverRunCopy } from './server'
import { isRunningAnywhere } from './locks'
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
import { previewCut } from '../ai/agent/previewCut'
import { onSettled } from '../recorder/settled'

const tn = (key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

/** A proposal nobody has decided on yet (the only ones a review acts on in bulk). */
const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'
/**
 * A proposal its Vorprüfer holds back (slice SJ): open, but never part of a bulk apply — applied only as ONE change
 * (`single`); discarded like any open one.
 */
const isHeld = (c: StagedChange) => c.status === 'held'

/** What Jev said about a change, for a verdict's meta (Verdict.jev; never part of the verdict itself). */
const jevOf = (c: StagedChange): 'held' | 'marked' | 'clear' | undefined => (c.jev?.held ? 'held' : c.jev?.mark ? 'marked' : c.jev?.state === 'ok' ? 'clear' : undefined)

/** applyRun's result: what applyChanges did, and how many held proposals an apply of every open one left out. */
export type RunApplyResult = ApplyResult & { heldLeft?: number }

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

/** A review's outcome as written: the run here now; `refused`: the server did not take it (why, in words). */
interface Saved {
  run: AgentRun
  refused?: string
}

/**
 * Write a review's outcome: `patch` maps the run as it is stored to its next value (browser: patchRun — only what the
 * review changed). Server runs: this tab's copy, then the server is told which proposals were applied / discarded. A
 * server that refuses (a viewer, the run busy, no connection) still holds them as open: a discard did not happen
 * (this tab's copy goes back); an apply was written here, so its copy stays applied (said in a toast). Either way the
 * caller writes no verdict.
 */
async function save(cur: AgentRun, patch: (r: AgentRun) => AgentRun, applied: string[], discarded: string[]): Promise<Saved> {
  if (cur.runner === 'server') {
    const next = patch(cur)
    patchServerRun(next)
    try {
      await resolveServerRun(cur.id, applied, discarded)
    } catch (e) {
      console.warn('[one] agents: could not mark the server run', e)
      if (!applied.length) {
        patchServerRun(cur)
        return { run: cur, refused: `${t('features.agents.review.discardRefused')} ${serverErrorText(e)}` }
      }
      const refused = `${t('features.agents.review.serverFailed')} ${serverErrorText(e)}`
      useUI.getState().toast({ message: refused, kind: 'error' })
      return { run: next, refused }
    }
    return { run: next }
  }
  return { run: (await patchRun(cur.agentId, cur.id, patch)) ?? patch(cur) }
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
const judged = new Map<string, Array<{ id: string; key: TrustKey }>>()

/** The keys a change of the run writes (staged rows resolved through `rowIds`). */
function trustKeysOf(c: StagedChange, rowIds: Record<string, ID>): TrustKey[] {
  return keysOfChange(c, (id) => rowIds[id] ?? id, useWorkspace.getState().pages)
}

/** The change's body is cut in its review ("+ n more lines", ReviewParts Preview): not seen in full unless shown whole. */
const bodyCut = (c: StagedChange) => c.kind !== 'rename' && c.kind !== 'edit' && !!c.markdown?.trim() && previewCut(c.markdown).rest > 0

/** A decision counts as a verdict: the person judged ONE proposal and saw all of it. */
const counts = (c: StagedChange, opts: { judged?: boolean; whole?: boolean }) => !!opts.judged && (!bodyCut(c) || !!opts.whole)

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
  const jev = jevOf(c)
  const made = await noteVerdicts(cur.agentId, keys.map((key) => ({ key, v: 'accept' as const, run: cur.id, change: c.id, ...(row ? { row } : {}), ...(jev ? { jev } : {}) })))
  if (!made.length) return
  judged.set(rowKey(cur.id, c.id), made.map((v) => ({ id: v.id, key: v.key })))
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
  const jev = jevOf(c)
  const made = await noteVerdicts(cur.agentId, keys.map((key) => ({ key, v: 'discard' as const, run: cur.id, change: c.id, ...(reason ? { reason } : { single: true as const }), ...(row ? { row } : {}), ...(jev ? { jev } : {}) })))
  if (made.length) judged.set(rowKey(cur.id, c.id), made.map((v) => ({ id: v.id, key: v.key })))
}

/**
 * An Undo took these decisions back: their verdicts go (and their watches end). `reverted`: an apply the Undo kept
 * (a field edited since) but whose other fields it put back — the verdicts of those fields go, the rest stay.
 */
async function voidJudged(agentId: ID, runId: string, changeIds: string[], kind: 'accept' | 'discard', reverted: Record<string, ID[]> = {}): Promise<void> {
  const v = kind === 'accept' ? (['accept', 'edited'] as const) : (['discard'] as const)
  const keys = new Set<TrustKey>()
  const changes: string[] = []
  for (const id of changeIds) {
    const j = judged.get(rowKey(runId, id))
    if (!j) continue
    judged.delete(rowKey(runId, id))
    j.forEach((x) => keys.add(x.key))
    changes.push(id)
    unwatch(j.map((x) => x.id))
  }
  if (changes.length) await voidVerdicts(agentId, runId, changes, [...v], [...keys])
  if (kind !== 'accept') return
  for (const [id, props] of Object.entries(reverted)) {
    const j = judged.get(rowKey(runId, id))
    if (!j || changeIds.includes(id)) continue
    const back = new Set(props)
    const gone = j.filter((x) => {
      const k = parseTrustKey(x.key)
      return k?.kind === 'prop' && back.has(k.prop)
    })
    if (!gone.length) continue
    const left = j.filter((x) => !gone.includes(x))
    if (left.length) judged.set(rowKey(runId, id), left)
    else judged.delete(rowKey(runId, id))
    unwatch(gone.map((x) => x.id))
    await voidVerdicts(agentId, runId, [id], [...v], gone.map((x) => x.key))
  }
}

/**
 * Apply the given proposals of a run (default: every open one) — only those still open when the run is read again
 * under its lock. Several: one Undo toast reverts them. `row`: from a proposal's own row (or Preflight) — its result
 * shows there (applied, or why not) with an Undo key (undoChange), no toast. Resolves with what applyChanges did, or
 * null when nothing was left to apply (applied / discarded / superseded elsewhere, the run gone or running).
 * A held proposal (slice SJ) is applied only as ONE change — exactly one id and `single` (its own key); every other apply
 * leaves it out (`heldLeft`: how many an apply of every open one left), and one that fails stays held.
 */
export async function applyRun(run: AgentRun, ids?: string[], opts: { row?: boolean; judged?: boolean; whole?: boolean; single?: boolean } = {}): Promise<RunApplyResult | null> {
  const out = await withRunLock(run.agentId, async () => {
    const cur = await current(run, true)
    if (!cur || cur.status === 'running') return null
    const all = cur.staged ?? []
    const single = !!opts.single && ids?.length === 1
    const targets = all.filter((c) => (isOpen(c) || (single && isHeld(c))) && (!ids || ids.includes(c.id)))
    const heldLeft = ids ? 0 : all.filter(isHeld).length
    if (!targets.length) return null
    const rowIds: Record<string, ID> = { ...(cur.rowIds ?? {}) }
    // proposals from a server run (or stored before images.ts) load no web image either; a server run's create no task
    // (nobody saw them settled here — its 'workItem' changes fail at apply)
    const server = cur.runner === 'server'
    const safe = (c: StagedChange): StagedChange => {
      const md = typeof c.markdown === 'string' ? { ...c, markdown: withoutWebImages(c.markdown) } : c
      if (!server || !md.items) return md
      const { items: _items, ...rest } = md
      return rest
    }
    const agent = useWorkspace.getState().agents?.[cur.agentId]
    // the run's proposals, applied by the person's review, are still the agent run's writes (store/writer.ts)
    const writer: Writer = { kind: 'agent', id: cur.agentId, run: cur.id }
    // the run goes on (it had ended): its writes from here are one stretch, ended again below
    noteRun(writer)
    let res: RunApplyResult
    try {
      // the held proposal applied on its own goes in as an open one (apply.ts writes open changes only — never a held one)
      res = await asAgent(cur.agentId, () =>
        applyChanges(
          targets.map(safe).map((c) => (isHeld(c) ? { ...c, status: 'pending' as const } : c)),
          all.map(safe),
          (id) => rowIds[id] ?? id,
          { writer, items: server ? { creates: false } : { visible: agent ? scopeFilter(agent) : null } },
        ),
      )
    } finally {
      endRun(writer)
    }
    if (heldLeft) res.heldLeft = heldLeft
    Object.assign(rowIds, res.rowIds)
    const mark = (list: StagedChange[]) =>
      list.map((c): StagedChange => {
        if (res.applied.includes(c.id)) return { ...c, status: 'applied', error: undefined }
        const f = res.failed.find((x) => x.id === c.id)
        // a held proposal that failed stays held (never a "failed" one a bulk apply would take)
        return f ? { ...c, status: isHeld(c) ? 'held' : 'failed', error: f.error } : c
      })
    const [changed, created] = touchedBy(mark(all), res.applied, rowIds, res.pages)
    stampLocal(cur.agentId, changed, created)
    // the row's Undo before the run is stored: the row draws it as soon as it shows the change applied
    if (opts.row) for (const id of res.applied) rowUndos.set(rowKey(cur.id, id), res)
    const saved = await save(cur, (r) => ({ ...r, staged: mark(r.staged ?? []), rowIds: { ...(r.rowIds ?? {}), ...res.rowIds }, applied: (r.applied ?? 0) + res.applied.length }), res.applied, [])
    // the person's decision on ONE proposal they saw in full: a verdict per trust key (never for Apply all; never when
    // the server did not take it — it still shows the proposal as open)
    if (ids?.length === 1 && res.applied.includes(ids[0]) && !saved.refused) {
      const c = all.find((x) => x.id === ids[0])
      if (c && counts(c, opts)) await noteAccept(cur, c, rowIds).catch((e) => console.warn('[one] agents: could not note a verdict', e))
    }
    return { res, next: saved.run }
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
  // the decisions that went back take their accept verdicts along (inside the run's lock); one kept because a field was
  // edited since loses the verdicts of the fields that did go back
  const { kept } = await undoApply(run, res, true, (undone, reverted) => voidJudged(run.agentId, run.id, undone, 'accept', reverted))
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

type OnUndone = (undone: string[], reverted: Record<string, ID[]>) => Promise<void>

async function undoApply(run: AgentRun, res: ApplyResult, row = false, onUndone?: OnUndone): Promise<{ kept: string[] }> {
  // the person's Undo (store/writer.ts)
  const out = await settleUndo(run, () => ({ batch: res, ...withWriter({ kind: 'you', via: 'undo', ref: run.id }, () => res.undo()) }), row, onUndone)
  return { kept: out?.kept ?? [] }
}

/**
 * Under the run's lock: `undo` reverts a batch (null: nothing to undo) and says which changes it kept (edited since);
 * then the run's changes as the review shows them — what went back is a proposal again (an 'apply' run then has
 * proposals to review), what was kept or cannot be undone stays applied, with its row id.
 */
async function settleUndo(run: AgentRun, undo: () => { batch: ApplyResult; kept: string[]; reverted?: Record<string, ID[]> } | null, row = false, onUndone?: OnUndone): Promise<{ kept: string[] } | null> {
  const kept = await withRunLock(run.agentId, async () => {
    const done = undo()
    if (!done) return null
    const { batch: res, kept, reverted = {} } = done
    const stays = new Set([...kept, ...res.final])
    const undone = res.applied.filter((id) => !stays.has(id))
    const cur = await current(run)
    if (cur) {
      const keptPages = new Set((cur.staged ?? []).filter((c) => stays.has(c.id)).map((c) => c.pageId))
      const patch = (r: AgentRun): AgentRun => {
        const rowIds = { ...(r.rowIds ?? {}) }
        for (const staged of Object.keys(res.rowIds)) if (!keptPages.has(staged)) delete rowIds[staged]
        const back = (r.staged ?? []).filter((c) => undone.includes(c.id) && c.status === 'applied').length
        // a proposal its Vorprüfer held (applied on its own) goes back to held, never to an open one a bulk apply takes
        const staged = (r.staged ?? []).map((c) => (undone.includes(c.id) && c.status === 'applied' ? { ...c, status: c.jev?.held ? ('held' as const) : ('pending' as const) } : c))
        // an 'apply' run whose writes went back has proposals to review again — a browser run only: the server settled
        // its run to 'ok' and applies none of it again (freshServerRun), so a server run keeps its status here
        const status = back && r.status === 'ok' && r.runner === 'browser' ? 'staged' : r.status
        return { ...r, status, staged, rowIds, applied: Math.max(0, (r.applied ?? 0) - back) }
      }
      // a server run stays resolved on the server: only this device's copy goes back to pending
      if (cur.runner === 'server') patchServerRun(patch(cur))
      else await patchRun(cur.agentId, cur.id, patch)
    }
    if (onUndone && (undone.length || Object.keys(reverted).length)) await onUndone(undone, reverted).catch((e) => console.warn('[one] agents: could not take a verdict back', e))
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
  /** a server run's server did not take it (why, in words): nothing was discarded */
  refused?: string
}

/**
 * Discard proposals of a run (`ids`; null = every open one) and the open proposals that build on them — only those
 * still open when the run is read again under its lock. `undo`: hand back an Undo (browser runs); `row`: ONE proposal
 * discarded from its row (or a Preflight card) — its Undo is kept for the rows of its cascade too (canUndoDiscard /
 * undoDiscard); a bulk discard keeps it only with the caller. `reason`: why (on the named proposals only, never their
 * dependants). `judged` (+ `whole`): ONE proposal the person saw in full → a `discard` verdict per trust key (with the
 * reason, else `single`) — once the discard holds.
 */
export async function discardRun(
  run: AgentRun,
  ids: string | string[] | null,
  opts: { undo?: boolean; row?: boolean; reason?: DiscardReason; judged?: boolean; whole?: boolean } = {},
): Promise<Discarded> {
  const out = await withRunLock(run.agentId, async (): Promise<Discarded | null> => {
    const cur = await current(run, true)
    if (!cur || cur.status === 'running') return null
    const all = cur.staged ?? []
    // a held proposal is discarded like any open one (discarding never writes)
    const open = (c: StagedChange) => isOpen(c) || isHeld(c)
    const named = ids === null ? all.filter(open).map((c) => c.id) : Array.isArray(ids) ? ids : [ids]
    const drop = new Set(named.filter((id) => all.some((c) => c.id === id && open(c))))
    let grew = true
    while (grew) {
      grew = false
      for (const c of all) {
        if (drop.has(c.id) || !open(c) || !depsOf(c).some((d) => drop.has(d))) continue
        drop.add(c.id)
        grew = true
      }
    }
    if (!drop.size) return null
    // the reason goes on the proposals the person named, never on the ones that built on them
    const reasonOn = new Set(opts.reason && ids !== null ? named.filter((id) => drop.has(id)) : [])
    const before = new Map(all.filter((c) => drop.has(c.id)).map((c) => [c.id, c.status]))
    const mark = (list: StagedChange[]) =>
      list.map((c) => (drop.has(c.id) && open(c) ? { ...c, status: 'discarded' as const, ...(reasonOn.has(c.id) ? { reason: opts.reason } : {}) } : c))
    const back = await stateBack({ ...cur, staged: mark(all) })
    // ONE proposal the person named (its row, a card): the decision a verdict and a row's Undo are about
    const one = ids !== null && named.length === 1 && drop.has(named[0]) ? all.find((c) => c.id === named[0]) : undefined
    // the Undo before the run is stored: the row draws it as soon as it shows the change discarded
    const undo = opts.undo && cur.runner === 'browser' ? discardUndo(cur.agentId, cur.id, [...drop], before, back, one?.id ?? null, !!opts.row && !!one) : null
    const saved = await save(cur, (r) => ({ ...r, staged: mark(r.staged ?? []), ...(back ? { steps: [...r.steps, back.note] } : {}) }), [], [...drop])
    if (saved.refused) return { dropped: [], undo: null, refused: saved.refused }
    // the person's decision on ONE proposal they saw in full: a verdict per trust key (never for Discard all)
    if (one && counts(one, opts)) await noteDiscard(cur, one, cur.rowIds ?? {}, opts.reason).catch((e) => console.warn('[one] agents: could not note a verdict', e))
    return { dropped: [...drop], undo }
  })
  return out ?? { dropped: [], undo: null }
}

/**
 * The Undo of a discard: the proposals it dropped are open again (with their status before), the agent state it put
 * back goes back too while it still is the one put back, the decision's verdicts go. Built from ids only (the run is read
 * again under its lock): an Undo kept for the session never holds a copy of the run. `rows`: kept in the rows of the
 * cascade (canUndoDiscard) — used here or by the caller, it is gone from all of them.
 */
function discardUndo(agentId: ID, runId: string, dropped: string[], before: Map<string, StagedChange['status']>, back: StateBack | null, one: string | null, rows: boolean): () => Promise<boolean> {
  const keys = rows ? dropped.map((id) => rowKey(runId, id)) : []
  const undo = (): Promise<boolean> => {
    for (const k of keys) if (discardUndos.get(k) === undo) discardUndos.delete(k)
    return withRunLock(agentId, async () => {
      const now = (await loadRuns(agentId)).find((r) => r.id === runId)
      // an ejected change never comes back as a proposal, nor one that builds on it (it could never apply): the eject's
      // own Undo gives them back
      const out = onEjected(now?.staged ?? [])
      const again = new Set((now?.staged ?? []).filter((c) => before.has(c.id) && c.status === 'discarded' && !out.has(c.id)).map((c) => c.id))
      if (!now || !again.size) return false
      // the agent state goes back only while it is still the one discarding put back (no run, no Clear since)
      const restore = back && sameState(await getAgentState(agentId), back.wrote)
      await patchRun(agentId, runId, (r) => ({
        ...r,
        staged: (r.staged ?? []).map((c) => (again.has(c.id) && c.status === 'discarded' ? { ...c, status: before.get(c.id) ?? 'pending', reason: undefined } : c)),
        ...(restore && back ? { steps: withoutLast(r.steps, back.note) } : {}),
      }))
      if (restore && back) await putAgentState(agentId, back.replaced)
      // the decision is taken back: its discard verdicts go too
      if (one && again.has(one)) await voidJudged(agentId, runId, [one], 'discard').catch((e) => console.warn('[one] agents: could not take a verdict back', e))
      return true
    })
  }
  for (const k of keys) discardUndos.set(k, undo)
  return undo
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

/* ------------------------------------------------------------------ */
/* the flight recorder's eject (features/recorder eject/sources.ts)     */
/* ------------------------------------------------------------------ */

/** The agent state an eject put back (stateBack): what it wrote, what it replaced — its Undo puts it forward. */
export interface EjectState {
  wrote: AgentState | null
  replaced: AgentState
}

/** May an eject settle this agent's run now? Not while the agent runs (any tab), the run is running, or a change applies. */
export async function ejectBusy(run: AgentRun): Promise<boolean> {
  return run.status === 'running' || (run.staged ?? []).some((c) => c.status === 'applying') || (await isRunningAnywhere(run.agentId))
}

/** A batch's row Undo of these changes goes (an eject settled them: "nothing to undo here any more"). */
export function forgetUndos(runId: string, changeIds: readonly string[]): void {
  for (const id of changeIds) rowUndos.delete(rowKey(runId, id))
}

/**
 * Per-field trust and an eject: the `accept` verdicts of the changes it took back stay as the person gave them (an eject
 * is no decision on ONE proposal — it writes, voids and re-grants nothing), but their "edited" watches end: the value
 * they watch is no longer the agent's, so the person's next edit there says nothing about the proposal.
 */
function endWatches(runId: string, changeIds: readonly string[]): void {
  const ids = changeIds.flatMap((id) => judged.get(rowKey(runId, id))?.map((v) => v.id) ?? [])
  if (ids.length) unwatch(ids)
}

// the eject's mark comes first (and reaches every tab): the tab that applied a proposal may not be the one ejecting it
onSettled((n) => {
  if (!n.on || !n.runKey.startsWith('agent:')) return
  const runId = n.runKey.split(':').slice(2).join(':').replace(/@r$/, '')
  if (!runId) return
  const ids = n.ids.length ? n.ids : [...judged.keys()].filter((k) => k.startsWith(`${runId}:`)).map((k) => k.slice(runId.length + 1))
  endWatches(runId, ids)
})

/**
 * An eject settles the run's review (call ONLY inside withRunLock(run.agentId), never nested; `cur` read in it):
 * `ejected` applied changes → discarded + `ejected` (never pending: Apply must not offer them again); `held` ones stay
 * applied + `held`; open proposals that build on an ejected one → discarded; with `discardPending` the run's other
 * open proposals too — except those Preflight's supersede guard calls opened (true) or cannot tell yet (null): they
 * stay. A proposal its Vorprüfer held back (ChangeStatus 'held', slice SJ) is open here like a pending one (discarding
 * never writes); the eject's Undo makes it held again, never pending. Superseded proposals are never touched.
 * `applied` counts down; row ids stay. Their Undo closures go (forgetUndos, forgetRunUndo), their trust watches end
 * (endWatches — no verdict is written, voided or changed: nothing it discards is a decision of the person); a discard's
 * Undo leaves the rows of proposals that build on one (onEjected).
 * Then, every change discarded, the agent state goes back (stateBack).
 * Resolves with the run as stored, the ids it discarded (not the ejected ones), the slips of `send` proposals among
 * them, the state put back.
 */
export async function settleEjected(
  cur: AgentRun,
  o: { ejected: string[]; held: Array<{ id: string; by: string; at: number }>; ejectId: string; at: number; discardPending: boolean; opened: (runId: string, changeId: string) => boolean | null },
): Promise<{ run: AgentRun; discarded: string[]; slips: string[]; state: EjectState | null }> {
  if (cur.runner !== 'browser') return { run: cur, discarded: [], slips: [], state: null }
  const all = cur.staged ?? []
  const out = new Set(all.filter((c) => o.ejected.includes(c.id) && c.status === 'applied').map((c) => c.id))
  const held = new Map(o.held.map((h) => [h.id, h]))
  // open, or held back by its Vorprüfer: a proposal that still waits for the person
  const waits = (c: StagedChange) => isOpen(c) || isHeld(c)
  const drop = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const c of all) {
      if (drop.has(c.id) || !waits(c) || !depsOf(c).some((d) => out.has(d) || drop.has(d))) continue
      drop.add(c.id)
      grew = true
    }
  }
  if (o.discardPending) for (const c of all) if (waits(c) && !drop.has(c.id) && o.opened(cur.id, c.id) === false) drop.add(c.id)
  const mark = (list: StagedChange[]) =>
    list.map((c): StagedChange => {
      if (out.has(c.id) && c.status === 'applied') {
        const { held: _h, ...rest } = c
        return { ...rest, status: 'discarded', ejected: { id: o.ejectId, at: o.at } }
      }
      const h = held.get(c.id)
      if (h && c.status === 'applied') return { ...c, held: { id: o.ejectId, by: h.by, at: h.at } }
      if (drop.has(c.id) && waits(c)) return { ...c, status: 'discarded' }
      return c
    })
  const count = (list: StagedChange[]) => list.filter((c) => out.has(c.id) && c.status === 'applied').length
  const back = await stateBack({ ...cur, staged: mark(all) })
  const patch = (r: AgentRun): AgentRun => ({ ...r, staged: mark(r.staged ?? []), applied: Math.max(0, (r.applied ?? 0) - count(r.staged ?? [])), ...(back ? { steps: [...r.steps, back.note] } : {}) })
  const run = (await patchRun(cur.agentId, cur.id, patch)) ?? patch(cur)
  forgetUndos(cur.id, [...out])
  forgetRunUndo(cur.id)
  endWatches(cur.id, [...out])
  // a discard's Undo kept in the rows of proposals that build on an ejected change goes from those rows (its closure
  // leaves them alone too)
  const gone = onEjected(run.staged ?? [])
  for (const c of run.staged ?? []) if (c.status === 'discarded' && gone.has(c.id)) discardUndos.delete(rowKey(cur.id, c.id))
  const slips = all.filter((c) => drop.has(c.id) && c.send?.slipId).map((c) => c.send!.slipId)
  return { run, discarded: [...drop], slips, state: back ? { wrote: back.wrote, replaced: back.replaced } : null }
}

/**
 * The eject's Undo (inside withRunLock as above): the `back` changes this eject ejected are applied again (their marker
 * gone); the ones it discarded (`pending`) are open again unless something else decided them since; its held markers
 * go; the agent state goes forward only while it is still the one the eject put back.
 */
export async function unsettleEjected(cur: AgentRun, ejectId: string, back: string[], pending: string[], state?: EjectState | null): Promise<AgentRun> {
  if (cur.runner !== 'browser') return cur
  const restore = !!state && sameState(await getAgentState(cur.agentId), state.wrote)
  const note = { kind: 'note', label: t('features.agents.state.restored'), state: 'ok' } as AgentRunStep
  const patch = (r: AgentRun): AgentRun => {
    let n = 0
    const staged = (r.staged ?? []).map((c): StagedChange => {
      if (back.includes(c.id) && c.ejected?.id === ejectId && c.status === 'discarded') {
        n++
        const { ejected: _e, ...rest } = c
        return { ...rest, status: 'applied' }
      }
      // a proposal its Vorprüfer held back is held again (never an open one a bulk apply would take)
      if (pending.includes(c.id) && c.status === 'discarded' && !c.ejected) return { ...c, status: c.jev?.held ? 'held' : 'pending' }
      if (c.held?.id === ejectId) {
        const { held: _h, ...rest } = c
        return rest
      }
      return c
    })
    return { ...r, staged, applied: (r.applied ?? 0) + n, ...(restore ? { steps: withoutLast(r.steps, note) } : {}) }
  }
  const run = (await patchRun(cur.agentId, cur.id, patch)) ?? patch(cur)
  if (restore && state) await putAgentState(cur.agentId, state.replaced)
  return run
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
  // the eject's settle as the recorder calls it: under the run lock, on the run read again there
  const underLock =
    <A extends unknown[], R>(fn: (cur: AgentRun, ...a: A) => Promise<R>) =>
    (agentId: ID, runId: string, ...a: A) =>
      withRunLock(agentId, async () => {
        const cur = (await loadRuns(agentId)).find((r) => r.id === runId)
        return cur ? fn(cur, ...a) : null
      })
  const settle = underLock((cur, o: Parameters<typeof settleEjected>[1] & { openedIds?: string[] | null }) => settleEjected(cur, { ...o, opened: (_r, id) => (o.openedIds === null ? null : !!o.openedIds?.includes(id)) }))
  const unsettle = underLock((cur, ejectId: string, back: string[], pending: string[], state?: EjectState | null) => unsettleEjected(cur, ejectId, back, pending, state))
  // merged into the seam runner.ts sets too (`__oneAgents.run`, slice SJ)
  const w = window as unknown as { __oneAgents?: Record<string, unknown> }
  w.__oneAgents = { ...(w.__oneAgents ?? {}), applyRun, discardRun, undoChange, canUndoChange, canUndoDiscard, undoDiscard, supersedeOlder, loadRuns, putRun, isLeader, setSupersedeGuard, setProposalsShown, settleEjected: settle, unsettleEjected: unsettle, getAgentState, putAgentState }
}
