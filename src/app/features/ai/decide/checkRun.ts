/**
 * The Vorprüfung of one agent run (slice SJ): after the agent's tool loop, before the run's only write. ONE decision
 * request per staged change of a checked kind:
 *
 *  1. the gate first (`gate.precheck`): the change's target — its parent or database for a new one — and the trigger row
 *     it names; the run's touched classes carried; the agent's own Vorprüfer, else the class rule (no default, no legacy);
 *     the agent's instructions as typed text (a key in them refuses the check). The state is built for the route the
 *     gate resolved (state.ts). Only what the gate let through reads the price (the decisions catalogue — a refused run
 *     sends nothing at all) and is prepared again with its size;
 *  2. the band of every check reserved before the first goes out — the run's remaining budget smaller → none goes out
 *     ('budget'); the tab's cooldown → none ('cooldown'). With a Regler line each check's band comes out of the run's
 *     decide reservation (`run.decide`, taken at the run's start — features/governor decide.ts); one the line refuses
 *     anyway is not sent ('budget') and the result says so (`line`: an apply-mode run then waits as a whole);
 *  3. ≤ 3 in flight, 8 s per attempt (core/decide.ts), 20 s for the run from the first read on — not done by then (an
 *     answer after it included): 'late';
 *  4. every response is one ledger entry (role 'decide', the run as its group) and reaches the run's receipt through
 *     `onEntry` (its budget counts it).
 * A change Jev did not check says why (JevWhy). Nothing here writes the workspace or the run — the caller attaches the
 * checks; a decision model only ever adds caution.
 */
import type { DataClass, LedgerEntry, Route } from '@/shared/ai/types'
import { DATA_CLASSES } from '@/shared/ai/policy'
import type { JevCheck } from '@/shared/ai/decide'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import type { StagedChange } from '../agent/types'
import { AIError } from '../core/errors'
import { precheck, prepare, settle, type Applied, type Prepared } from '../core/gate'
import { purposeOf } from '../core/purposes'
import { appliedOf } from '../core/shape'
import { tapSignal } from '../core/meter'
import { isCheckedKind } from './kinds'
import { precheckQuestions } from './questions'
import { proposalSources, proposalState, type ProposalInput, type ProposalState } from './state'
import { stateWorld } from './world'
import { checkOf, uncheckedOf } from './verdict'

/** The run's deadline for all of its checks. */
export const RUN_DEADLINE_MS = 20_000
/** Checks in flight at once. */
export const IN_FLIGHT = 3

export interface CheckRunInput {
  agentId: ID
  runId: string
  instructions: string
  write: 'none' | 'stage' | 'apply'
  trigger: { type: string; rows?: readonly ID[] }
  changes: readonly StagedChange[]
  rowIds: Record<string, ID>
  review: { decider?: Route; on: string; pre: { markBelow: number; hold: boolean } }
  /** the agent's scope (null: everything) — a trigger row outside it is never named */
  scope: ((id: ID) => boolean) | null
  /** the classes of what the run's tools returned (AgentRun.touched) */
  touched: readonly DataClass[]
  /** what the run may still spend (USD) */
  budgetLeft: number
  /** every ledger entry of a check (the run's receipt and budget) */
  onEntry?: (e: LedgerEntry) => void
  deadlineMs?: number
  /** the run's mode (a pre-check takes it — features/governor modes.ts) and its decide reservation (null: none) */
  run?: { mode: 'manual' | 'scheduled' | 'trigger'; decide?: string | null }
}

export interface CheckRunResult {
  /** by change id: every checked-kind change has one */
  checks: Record<string, JevCheck>
  /** checked-kind changes */
  n: number
  /** what the checks cost (priced entries) */
  usd: number
  /** the snapshot that answered (the step's "Jev 1.13"; null: none answered) */
  model: string | null
  /** another snapshot than the confirmed one answered or was resolved (DJ19) */
  changedTo?: string
  /** the Regler's red line refused a check (not sent, 'budget') — an apply-mode run waits as a whole (agents/direct.ts) */
  line?: boolean
}

interface Job {
  c: StagedChange
  prepared: Prepared
  state: Record<string, unknown>
}

/** The class a 'policy' refusal names (the card says "Jev may not see …"). */
const refusedClass = (e: unknown): DataClass | undefined => {
  const d = e instanceof AIError ? e.detail : undefined
  return d && (DATA_CLASSES as readonly string[]).includes(d) ? (d as DataClass) : undefined
}

/** Pre-check the run's changes of a checked kind (status pending, or held as a placeholder). */
export async function checkChanges(i: CheckRunInput): Promise<CheckRunResult> {
  const at = Date.now()
  const checks: Record<string, JevCheck> = {}
  const todo = i.changes.filter((c) => isCheckedKind(c.kind) && (c.status === 'pending' || c.status === 'held'))
  const result: CheckRunResult = { checks, n: todo.length, usd: 0, model: null }
  if (!todo.length) return result
  const skipAll = (list: readonly StagedChange[], why: JevCheck['why'] & string) => {
    for (const c of list) checks[c.id] = uncheckedOf(why, { at, sent: false })
  }
  let core: typeof import('../core/decide')
  try {
    core = await import('../core/decide')
  } catch {
    skipAll(todo, 'error')
    return result
  }
  if (Date.now() < core.decideCooldown().until) {
    skipAll(todo, 'cooldown')
    return result
  }
  // the run's deadline from here on: the catalogue read, the gate and every check count into it
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), i.deadlineMs ?? RUN_DEADLINE_MS)
  const jobs: Job[] = []
  try {
    // 1 · the gate (without a reservation) and the state, per change — a refusal (no key, no Vorprüfer, AUS, newer rules,
    //     a data rule) sends nothing, not even the catalogue read
    const questions = precheckQuestions()
    const may = new Set<DataClass>(purposeOf('gate.precheck').may)
    const carries = i.touched.filter((c) => may.has(c))
    // the run's ledger source and mode, and its decide reservation: the brake takes a check's band out of it (§ 5.6)
    const run = { source: `agent:${i.agentId}:${i.runId}`, mode: i.run?.mode ?? ('manual' as const), ...(i.run?.decide ? { decide: i.run.decide } : {}) }
    const base = { purpose: 'gate.precheck' as const, carries, decider: i.review.decider ?? null, typed: i.instructions, run }
    const ready: Array<{ c: StagedChange; state: Record<string, unknown>; sources: ProposalState['sources']; chars: number; applied: Applied }> = []
    for (const c of todo) {
      const input: ProposalInput = { agent: { instructions: i.instructions, write: i.write }, trigger: i.trigger, change: c, changes: i.changes, rowIds: i.rowIds }
      try {
        const s = useWorkspace.getState()
        const pre = precheck({ ...base, sources: proposalSources(input, s) })
        const ps = proposalState(input, stateWorld(pre, i.scope), questions)
        if (!ps) continue
        if ('refused' in ps) {
          checks[c.id] = uncheckedOf('context', { at, sent: false })
          continue
        }
        ready.push({ c, state: ps.state, sources: ps.sources, chars: ps.chars, applied: appliedOf(pre) })
      } catch (e) {
        refuse(c, e)
      }
    }
    if (!ready.length) return result

    // 2 · the price (the device's catalogue row at any age, else one public GET) — the gate's reservation needs it
    try {
      await core.primeDecisions(deadline.signal)
    } catch {
      /* decide() asks once more, else refuses 'price' */
    }
    if (deadline.signal.aborted) {
      skipAll(
        ready.map((r) => r.c),
        'late',
      )
      return result
    }
    for (const r of ready) {
      try {
        jobs.push({ c: r.c, prepared: prepare({ ...base, sources: r.sources, applied: r.applied, size: { promptChars: r.chars, maxTokens: 0 } }), state: r.state })
      } catch (e) {
        refuse(r.c, e)
      }
    }
    if (!jobs.length) return result

    // 3 · the band of every check reserved first: more than the run may still spend → none goes out
    const reserved = jobs.reduce((n, j) => n + (j.prepared.reservation?.usd ?? 0), 0)
    if (reserved > Math.max(0, i.budgetLeft)) {
      skipAll(
        jobs.map((j) => j.c),
        'budget',
      )
      return result
    }

    // 4 · ≤ 3 in flight under the run's deadline
    const one = async (j: Job) => {
      if (deadline.signal.aborted) {
        checks[j.c.id] = uncheckedOf('late', { at, sent: false })
        return
      }
      const own = new AbortController()
      const stop = () => own.abort()
      deadline.signal.addEventListener('abort', stop, { once: true })
      // what this check cost: its entries (one per response); a response without a price → null
      const m: { sent: boolean; usd: number | null } = { sent: false, usd: 0 }
      const untap = tapSignal(own.signal, {
        onEntry: (e) => {
          m.sent = true
          m.usd = m.usd === null || e.usd === null ? null : m.usd + e.usd
          result.usd += e.usd ?? 0
          try {
            i.onEntry?.(e)
          } catch (err) {
            console.warn('[one] jev: a run receipt listener failed', err)
          }
        },
      })
      try {
        const turn = await core.decide(j.prepared, { state: j.state, questions }, { signal: own.signal, source: `agent:${i.agentId}:${i.runId}`, group: i.runId, on: i.review.on })
        // an answer after the run's deadline is not used (it went out and is metered): the run did not wait for it
        if (deadline.signal.aborted) checks[j.c.id] = uncheckedOf('late', { at, sent: true, model: turn.served.model, usd: m.usd })
        else {
          checks[j.c.id] = checkOf(turn, { at, usd: m.usd, markBelow: i.review.pre.markBelow }) ?? uncheckedOf('empty', { at, sent: true, model: turn.served.model, usd: m.usd })
          result.model ??= turn.served.model
        }
      } catch (e) {
        const why = core.whyOf(e)
        if (why === 'changed' && e instanceof AIError && e.detail?.startsWith('model:')) result.changedTo ??= e.detail.slice('model:'.length)
        checks[j.c.id] = uncheckedOf(why, { at, sent: m.sent, ...(m.sent ? { usd: m.usd } : {}) })
      } finally {
        untap()
        deadline.signal.removeEventListener('abort', stop)
        settle(j.prepared)
      }
    }
    let next = 0
    const worker = async () => {
      while (next < jobs.length) await one(jobs[next++]!)
    }
    await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, jobs.length) }, worker))
  } finally {
    clearTimeout(timer)
    for (const j of jobs) settle(j.prepared)
  }
  return result

  /** A change the gate refused: unchecked, with the reason (a data rule names its class; the red line says so). */
  function refuse(c: StagedChange, e: unknown): void {
    const why = core.whyOf(e)
    if (e instanceof AIError && e.code === 'budget') result.line = true
    const cls = why === 'policy' ? refusedClass(e) : undefined
    checks[c.id] = uncheckedOf(why, { at, sent: false, ...(cls ? { cls } : {}) })
  }
}
