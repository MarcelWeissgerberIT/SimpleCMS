/**
 * Agent health for the Preflight lamps "Mirror stale" and "Agent missed" — synchronous reads over the agents, the
 * runs this tab has loaded (`useAgentRuns`, every agent's runs are loaded at boot) and the slot cache (`cachedSlot`,
 * filled by `primeSlots`). No request, no Claude call, no page-map walk.
 *
 * Whose agents count: a browser agent only where it runs (`runsHere`: enabled, and in a team only in its creator's
 * browser while its last change is theirs); a server agent only for its creator (`createdBy === me`), from the open
 * runs' heads (`useServerAgents.openLatest`, agent-runs/open) or the runs AgentsView loaded. Nothing counts for a
 * teammate's agent.
 */
import { useWorkspace } from '../../store/store'
import type { CustomAgent, ID } from '../../store/types'
import { useCloud } from '../../cloud'
import { awaitsConfirm } from './confirm'
import { runsHere } from './runner'
import { cachedSlot, lastSuccess, useAgentRuns } from './runs'
import { newestReal } from './held'
import { latestSlot } from './schedule'
import { useServerAgents, type ServerRunHead } from './server'
import type { AgentRun } from './types'
import type { JevWhy } from '@/shared/ai/decide'
import { decisionChecks } from '@/shared/ai/route'
import { sameJevSnapshot } from '@/shared/ai/jev'

export interface HealthItem {
  /** stale: a mirror's last successful run is over a working day old · slot: a schedule slot went by without a run ·
   *  fail: the agent's newest run failed (error / budget) · cfm: a team browser agent waits for its creator's Confirm ·
   *  jevfail: its Vorprüfung has failed three runs in a row (or Jev cools down) · jevnew: another Jev snapshot answered
   *  than the one confirmed (slice SJ) */
  kind: 'stale' | 'slot' | 'fail' | 'cfm' | 'jevfail' | 'jevnew'
  agentId: ID
  /** the lamp id (stable while the cause is the same): stale:<agent>@<run> · slot:<agent>@<slot> · fail:<agent>@<run> · cfm:<agent>@<updatedAt> */
  id: string
  /** when the cause began */
  at: number
  runId?: string
  level?: 'red'
  /** jevfail: why the newest failed · jevnew: the snapshot that answered */
  jev?: { why?: JevWhy; model?: string }
}

/** A schedule slot counts as missed this long after it was due (the runner checks every 30 s). */
export const MISSED_AFTER_MS = 10 * 60_000
/** A mirror is stale after one working day (Monday–Friday time) without a successful run. */
export const STALE_WORKING_MS = 24 * 3_600_000


/** Milliseconds of Monday–Friday time (local) between two instants (0 when `to <= from`; at most 40 days looked at). */
export function workingMsBetween(from: number, to: number): number {
  if (!(to > from)) return 0
  let total = 0
  let t = from
  for (let i = 0; i < 41 && t < to; i++) {
    const d = new Date(t)
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    const end = Math.min(next, to)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) total += end - t
    t = end
  }
  // past the window: every further day counts as a working day (stale long since)
  if (t < to) total += to - t
  return total
}

const agentsNow = (): CustomAgent[] => Object.values(useWorkspace.getState().agents ?? {})

const ownServer = (a: CustomAgent, me: string | null) => a.runner === 'server' && !!me && a.createdBy === me && useCloud.getState().active.kind === 'cloud'

/** Did a run start (or a start the Regler held happen) at or after `at`? */
const startedSince = (runs: readonly AgentRun[], at: number): boolean => runs.some((r) => r.startedAt >= at || (r.held?.times ?? []).some((x) => x >= at))

/** A server agent's newest run head: from agent-runs/open, else from the runs AgentsView loaded. */
function serverHead(agentId: ID): ServerRunHead | null {
  const s = useServerAgents.getState()
  const fromOpen = s.openLatest?.find((h) => h.agentId === agentId)
  if (fromOpen) return fromOpen
  const r = newestReal(s.runs[agentId] ?? [])
  return r ? { id: r.id, agentId: r.agentId, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt ?? null } : null
}

/** Mirror agents (`mirrorOf`) running here whose last successful run ended more than a working day ago. */
export function staleMirrors(now = Date.now()): HealthItem[] {
  const out: HealthItem[] = []
  const byAgent = useAgentRuns.getState().byAgent
  for (const a of agentsNow()) {
    if (!a.mirrorOf || !runsHere(a)) continue
    const runs = byAgent[a.id]
    // runs not loaded in this tab yet: unknown, never stale
    if (!runs) continue
    if (runs.some((r) => r.status === 'running')) continue
    const ok = lastSuccess(runs)
    const since = ok ? (ok.endedAt ?? ok.startedAt) : a.createdAt
    if (workingMsBetween(since, now) <= STALE_WORKING_MS) continue
    out.push({ kind: 'stale', agentId: a.id, id: `stale:${a.id}@${ok?.id ?? 'none'}`, at: since, ...(ok ? { runId: ok.id } : {}) })
  }
  return out
}

/**
 * Agents this member runs that need a look: (a) a scheduled browser agent running here whose newest slot went by
 * (≥ 10 min ago, after the agent's last change and the newest slot this device handled) with no run started since;
 * (b) a browser agent running here, or an own server agent, whose newest run failed (error · budget — a run blocked
 * by trashed pages too) → red. A run the Regler held is neither a failure nor a missed slot.
 */
export function missedAgents(now = Date.now(), me: string | null = useCloud.getState().user?.id ?? null): HealthItem[] {
  const out: HealthItem[] = []
  const byAgent = useAgentRuns.getState().byAgent
  for (const a of agentsNow()) {
    const here = runsHere(a)
    if (here) {
      const runs = byAgent[a.id]
      if (!runs) continue
      if (a.trigger.type === 'schedule') {
        const slot = latestSlot(a.trigger, now)
        const handled = cachedSlot(a.id)
        if (slot !== null && handled !== undefined && slot > Math.max(handled ?? 0, a.updatedAt) && now - slot >= MISSED_AFTER_MS && !startedSince(runs, slot)) {
          out.push({ kind: 'slot', agentId: a.id, id: `slot:${a.id}@${slot}`, at: slot })
        }
      }
      const last = newestReal(runs)
      if (last && (last.status === 'error' || last.status === 'budget')) out.push({ kind: 'fail', agentId: a.id, id: `fail:${a.id}@${last.id}`, at: last.endedAt ?? last.startedAt, runId: last.id, level: 'red' })
      continue
    }
    if (a.enabled && ownServer(a, me)) {
      const head = serverHead(a.id)
      if (head && (head.status === 'error' || head.status === 'budget')) out.push({ kind: 'fail', agentId: a.id, id: `fail:${a.id}@${head.id}`, at: head.endedAt ?? head.startedAt, runId: head.id, level: 'red' })
    }
  }
  return out
}

/** Team: this member's browser agents that someone else changed — they wait for the creator's Confirm. */
export function creatorConfirms(me: string | null = useCloud.getState().user?.id ?? null): HealthItem[] {
  const c = useCloud.getState()
  if (!me || c.readOnly) return []
  return agentsNow()
    .filter((a) => a.createdBy === me && awaitsConfirm(a))
    .map((a) => ({ kind: 'cfm' as const, agentId: a.id, id: `cfm:${a.id}@${a.updatedAt}`, at: a.updatedAt }))
}

/** Which health lamps have something to watch on this device: mirror agents running here · agents this member runs. */
export function healthFitted(me: string | null = useCloud.getState().user?.id ?? null): { mirror: boolean; missed: boolean } {
  let mirror = false
  let missed = false
  for (const a of agentsNow()) {
    const here = runsHere(a)
    if (here && a.mirrorOf) mirror = true
    if (here || ownServer(a, me) || (!!me && a.createdBy === me && awaitsConfirm(a))) missed = true
    if (mirror && missed) break
  }
  return { mirror, missed }
}

/** Agents whose slots `missedAgents` reads (prime them with primeSlots at start and when the agents change). */
export function scheduledHere(): ID[] {
  return agentsNow()
    .filter((a) => a.trigger.type === 'schedule' && runsHere(a))
    .map((a) => a.id)
}

/** Runs in a row without one usable check before the Vorprüfung counts as failing (§ 2.2). */
export const JEV_FAIL_RUNS = 3

/** The same Jev snapshot ('openrouter:' in front or not; exactly — an undated confirmed version waits for its first dated one). */
const sameSnapshot = sameJevSnapshot

/**
 * Vorprüfer health (slice SJ) of the browser agents running here — synchronous, over the runs this tab loaded:
 *  - jevfail:<agent>@<run>: its newest JEV_FAIL_RUNS runs with proposals to check had no usable check — or the newest
 *    met the tab's cooldown — since the oldest of that streak;
 *  - jevnew:<agent>@<snapshot>: its newest checked run was answered (or resolved) by another Jev snapshot than the one
 *    the person confirmed (DJ19) — until they confirm it (section 06).
 */
export function jevHealth(): HealthItem[] {
  const out: HealthItem[] = []
  const byAgent = useAgentRuns.getState().byAgent
  for (const a of agentsNow()) {
    if (!runsHere(a)) continue
    const checks = decisionChecks(a)
    if (!checks || checks === 'unreadable') continue
    const runs = (byAgent[a.id] ?? []).filter((r) => r.status !== 'running' && (r.jev?.n ?? 0) > 0)
    const newest = runs[0]
    if (!newest?.jev) continue
    const changedTo = newest.jev.changedTo
    if (changedTo && !sameSnapshot(checks.on, changedTo)) out.push({ kind: 'jevnew', agentId: a.id, id: `jevnew:${a.id}@${changedTo}`, at: newest.endedAt ?? newest.startedAt, runId: newest.id, jev: { model: changedTo } })
    let streak = 0
    while (streak < runs.length && runs[streak]!.jev!.checked === 0) streak++
    if (streak >= JEV_FAIL_RUNS || newest.jev.failed === 'cooldown') {
      const since = runs[Math.max(0, streak - 1)]!
      out.push({ kind: 'jevfail', agentId: a.id, id: `jevfail:${a.id}@${newest.id}`, at: since.endedAt ?? since.startedAt, runId: newest.id, jev: { ...(newest.jev.failed ? { why: newest.jev.failed } : {}) } })
    }
  }
  return out
}
