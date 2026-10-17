/**
 * Work orders — the person's keys on a running chain (spec §1.7, §1.9, §2.10; B7). Lazy (the plate, the seam, the
 * board's head load it). Every key that lets the worker start something is VON HAND on its surface (a fresh press, never
 * in a bulk apply or a swipe); here each checks again what it may do before it writes.
 *
 *  - `advanceChain(row, step, passes)` — ↵ Weiter on a card: the chain goes on, passing exactly the reasons the card
 *    showed (an accepted pipeline change / page revision is pinned again). Never past a Confirm wait.
 *  - `confirmAndGo(row, step, hash, passes)` — the 'confirm' card's ↵: the step's version exactly as the card rendered it
 *    (taskVersionView) is confirmed on this device, then the chain goes on ('changed': shown again).
 *  - `haltChain(row)` — H "Nach diesem Schritt anhalten": the Status → Angehalten as the person (works on every device —
 *    the worker device's engine reads it); this device's record halts at once. The running step finishes.
 *  - `haltAll()` — "Alle Ketten anhalten": H for every request whose Status is Läuft.
 *  - `stopNow(row)` — ⌘. "Sofort stoppen": only where the worker link is — stopTask on the running step, then the halt.
 *  - `resumeChain(row)` — ↵ Fortsetzen: only on the advancing device (a team: the worker link; an outdated or unsafe
 *    worker refuses); refused while the chain's spend is at or above its budget. Record → running (`resumedAt`),
 *    Status → Läuft (`#s`), then the engine — which may raise a card or halt again with the same reason.
 *  - `skipStep(row, n)` — S: a failed, stopped, trashed or ejected step leaves the chain; the next one starts without a
 *    Grundlage from it. A halt about that step is lifted.
 *  - `setChainBudget(row, usd)` — the chain's budget on this device (counted from TaskLocal.spentUsd, never the Cost
 *    fields; a halt for it is lifted only by ↵ Fortsetzen once the spend is below it).
 *  - `replanFrom(row, n)` — R "Ab hier neu planen" on the analysis card: the planner reads the done steps' results; its
 *    steps replace the parked ones once ↵ Kette starten confirms them.
 */
import type { ID } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import { workerOnline, workerVerdict } from '../link'
import { codingReadOnly, inTeam } from '../schema'
import { useCoding } from '../state'
import { confirmTaskVersion } from '../tasks'
import { stopTask } from '../service'
import { canSkip, mayResume, withHalt, withResume, withSkip, type ChainMove, type ChainPassable } from '../chain'
import { chainWorld, followRecord, orderWriter, runChain } from './chainRun'
import { orderRowIds, orderStatusKey, writeOrderStatus } from './db'
import { loadOrderRecord, patchOrderRecord } from './records'
import { planOrder } from './plan'
import { BUDGET_RANGE } from './config'
import type { PlanOutcome } from './planner'
import type { OrderRecord } from './types'

const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)
const YOU: Writer = { kind: 'you', via: 'ui' }

/** Why a key did nothing (the plate words each). */
export type ChainKeyRefusal =
  /** you can only view this workspace */
  | 'readOnly'
  /** no chain in that state here (it moved on, was taken back …) */
  | 'state'
  /** a team: the worker is attached to another device — press it there */
  | 'elsewhere'
  /** the connected worker is too old / has the security gap (Settings › Coding worker) */
  | 'outdated'
  | 'unsafe'
  /** the chain's spend is at or above its budget */
  | 'budget'
  /** this step cannot be skipped (it runs, is done, or is fine) */
  | 'skip'
  /** no step of the chain runs on this device's worker */
  | 'notRunning'
  /** the version the card showed is not the task's any more: shown again */
  | 'changed'
  /** the planner could not plan again (its outcome says why) */
  | 'plan'

export type ChainKeyOutcome = { ok: true; move?: ChainMove | null; plan?: PlanOutcome } | { ok: false; why: ChainKeyRefusal; plan?: PlanOutcome }

const no = (why: ChainKeyRefusal): ChainKeyOutcome => ({ ok: false, why })

/** A key that lets the chain start something: a viewer never, a team only on the worker device, never an outdated / unsafe worker. */
function mayStart(): ChainKeyRefusal | null {
  if (codingReadOnly()) return 'readOnly'
  if (inTeam() && !workerOnline()) return 'elsewhere'
  const v = workerVerdict()
  if (v === 'outdated' || v === 'unsafe') return v
  return null
}

/** What a card rendered of the pages and the Grundlage that go along (fingerprints) — only that is passed. */
export interface ChainSeen {
  refs?: Record<ID, string>
  basis?: string
}

/** ↵ Weiter on a card for step `step`: passes the reasons the card showed — a page / Grundlage only as it rendered it. */
export async function advanceChain(rowId: ID, step: number, passes: readonly ChainPassable[], seen: ChainSeen = {}): Promise<ChainKeyOutcome> {
  const why = mayStart()
  if (why) return no(why)
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  if (rec?.state !== 'running' || !rec.chain) return no('state')
  return { ok: true, move: await runChain(rowId, { step, passes, ...seen }) }
}

/** The Confirm card's ↵: exactly the version it rendered (its hash) is confirmed here, then the chain goes on. */
export async function confirmAndGo(rowId: ID, step: number, hash: string, passes: readonly ChainPassable[] = [], seen: ChainSeen = {}): Promise<ChainKeyOutcome> {
  const why = mayStart()
  if (why) return no(why)
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const s = rec?.chain?.steps.find((x) => x.n === step)
  if (rec?.state !== 'running' || !s) return no('state')
  const res = await confirmTaskVersion(s.id, hash)
  if (res !== 'ok') return no(res === 'changed' ? 'changed' : 'state')
  return { ok: true, move: await runChain(rowId, { step, passes, ...seen }) }
}

/**
 * H: the Status → Angehalten as the person; this device's record halts at once (sticky) — also a chain still being
 * created (it halts instead of running once its steps are made: confirm.ts toRunning).
 */
export async function haltChain(rowId: ID): Promise<ChainKeyOutcome> {
  if (codingReadOnly()) return no('readOnly')
  const status = orderStatusKey(rowId)
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const runs = !!rec?.chain && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')
  if (status !== 'running' && !runs) return no('state')
  if (runs)
    await patchOrderRecord(rowId, (r) => {
      if (!r?.chain) return r
      if (r.state === 'running') return { ...r, state: 'halted', chain: withHalt(r.chain, { why: 'status', by: 'you~ui' }, Date.now()) }
      if (r.state === 'creating' || r.state === 'interrupted') return { ...r, chain: withHalt(r.chain, { why: 'status', by: 'you~ui' }, Date.now()) }
      return r
    })
  if (status !== 'halted') writeOrderStatus(rowId, 'halted', YOU)
  return { ok: true }
}

/** "Alle Ketten anhalten": H for every request whose Status is Läuft (or whose chain runs here). Resolves how many. */
export async function haltAll(): Promise<number> {
  if (codingReadOnly()) return 0
  let n = 0
  for (const rowId of orderRowIds()) {
    if (orderStatusKey(rowId) !== 'running') {
      const rec = asRecord(await loadOrderRecord(rowId))
      if (rec?.state !== 'running') continue
    }
    if ((await haltChain(rowId)).ok) n++
  }
  return n
}

/** ⌘.: stop the step that runs on this device's worker, then halt the chain ('stopped'). */
export async function stopNow(rowId: ID): Promise<ChainKeyOutcome> {
  if (codingReadOnly()) return no('readOnly')
  if (!workerOnline()) return no('elsewhere')
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const chain = rec?.chain
  if (rec?.state !== 'running' || !chain) return no('state')
  const busy = new Set(useCoding.getState().busy.map((b) => b.taskId))
  const step = chain.steps.find((s) => busy.has(s.id))
  if (!step) return no('notRunning')
  await stopTask(step.id).catch(() => undefined)
  await patchOrderRecord(rowId, (r) => (r?.chain?.run === chain.run && (r.state === 'running' || r.state === 'halted') ? { ...r, state: 'halted', chain: withHalt(r.chain, { why: 'stopped', by: 'you~ui', step: step.n }, Date.now()) } : r))
  if (orderStatusKey(rowId) !== 'halted') writeOrderStatus(rowId, 'halted', YOU)
  return { ok: true }
}

/** ↵ Fortsetzen (VON HAND, on the advancing device): see the head of this file. */
export async function resumeChain(rowId: ID): Promise<ChainKeyOutcome> {
  const why = mayStart()
  if (why) return no(why)
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const chain = rec?.chain
  // a follow-up plan standing over the halted chain counts as halted: resuming drops that plan
  const underDraft = (r: OrderRecord) => r.state === 'draft' && r.draft?.over === 'halted'
  if (!rec || !chain || (rec.state !== 'halted' && !(rec.state === 'running' && chain.halted) && !underDraft(rec))) return no('state')
  const world = await chainWorld(rowId, rec)
  if (mayResume(world) === 'budget') return no('budget')
  const out = await patchOrderRecord(rowId, (r) => {
    if (r?.chain?.run !== chain.run || !(r.state === 'halted' || r.state === 'running' || underDraft(r))) return r
    const { draft: _d, ...rest } = r
    return { ...(underDraft(r) ? rest : r), state: 'running', chain: withResume(r.chain, Date.now()) }
  })
  if (out.rec?.state !== 'running') return no('state')
  // Läuft again (the order writer): the engine never reads a halt from it now
  writeOrderStatus(rowId, 'running', orderWriter(rowId, chain.run, 's'))
  followRecord(rowId, out.rec)
  return { ok: true, move: await runChain(rowId) }
}

/** S (VON HAND): step `n` leaves the chain — the next one starts without a Grundlage from it. */
export async function skipStep(rowId: ID, n: number): Promise<ChainKeyOutcome> {
  const why = mayStart()
  if (why) return no(why)
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const chain = rec?.chain
  // a follow-up plan standing over the halted chain counts as halted (a lifted halt drops that plan)
  const underDraft = (r: OrderRecord) => r.state === 'draft' && r.draft?.over === 'halted'
  if (!rec || !chain || (rec.state !== 'running' && rec.state !== 'halted' && !underDraft(rec))) return no('state')
  if (!canSkip(await chainWorld(rowId, rec), n)) return no('skip')
  const out = await patchOrderRecord(rowId, (r) => {
    if (r?.chain?.run !== chain.run || (r.state !== 'running' && r.state !== 'halted' && !underDraft(r))) return r
    const next = withSkip(r.chain, n)
    // the halt was about this step: lifted with it — the chain runs again
    if (next.halted || r.state === 'running') return { ...r, chain: next }
    const { draft: _d, ...rest } = r
    return { ...(underDraft(r) ? rest : r), state: 'running', chain: next }
  })
  if (!out.ok || !out.rec?.chain?.skipped?.includes(n)) return no('state')
  if (out.rec.state === 'running' && rec.state !== 'running') writeOrderStatus(rowId, 'running', orderWriter(rowId, chain.run, 's'))
  followRecord(rowId, out.rec)
  return { ok: true, move: out.rec.state === 'running' ? await runChain(rowId) : null }
}

/**
 * The chain's budget on this device (the field beside ↵ Fortsetzen after a budget halt): an amount within the config's
 * range, or none (null). The person's write to this device's record; it lifts nothing by itself — ↵ Fortsetzen does.
 */
export async function setChainBudget(rowId: ID, usd: number | null): Promise<ChainKeyOutcome> {
  if (codingReadOnly()) return no('readOnly')
  const value = usd === null || !Number.isFinite(usd) ? null : Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], usd))
  const out = await patchOrderRecord(rowId, (r) => {
    if (!r?.chain || (r.state !== 'running' && r.state !== 'halted')) return r
    const { budgetUsd: _b, ...chain } = r.chain
    return { ...r, chain: value === null ? chain : { ...chain, budgetUsd: value } }
  })
  return out.ok && out.rec?.chain ? { ok: true } : no('state')
}

/** R "Ab hier neu planen" on the analysis card: plan again after step `n` (the done steps' results go along). */
export async function replanFrom(rowId: ID, n: number): Promise<ChainKeyOutcome> {
  if (codingReadOnly()) return no('readOnly')
  const plan = await planOrder(rowId, { mode: 'manual', from: n, replace: true })
  return plan.kind === 'ready' ? { ok: true, plan } : { ok: false, why: plan.kind === 'chain' ? 'state' : 'plan', plan }
}
