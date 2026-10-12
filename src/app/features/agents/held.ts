/**
 * Custom agents — runs the Regler held, and which runs a device keeps (pure: no storage, no store; runs.ts drives it, a
 * Node spec too).
 *  - Not started at the red line (a scheduled / triggered start the brake held, features/governor brake.ts
 *    `{ start: false, hold }`): ONE record per agent and local day, id `held-<yyyy-MM-dd>` — each further start held that
 *    day adds to its count and times (the newest HELD_TIMES); `startedAt` stays the first time. Nothing else is written.
 *  - Stopped between two steps (`{ stop: 'budget' }` of the brake's round): the run keeps its proposals (`staged`) for
 *    review, status 'held', `held.kind` 'stopped' and the brake's numbers (`brake`).
 *  - Keeping: the newest MAX_RUNS of an agent, plus any older run that still holds an open proposal (pending · failed ·
 *    applying) — at most PRUNE_EXTRA more. Past that the oldest go and the newest run says how many proposals went
 *    (`pruned`) — never silently.
 */
import type { AgentRun, AgentRunBrake, AgentRunHeld, HeldBinding } from './types'

/** times kept on a not-started record (two a hour for a day) */
export const HELD_TIMES = 48
/** older runs kept beyond the limit for their open proposals */
export const PRUNE_EXTRA = 50

export const HELD_PREFIX = 'held-'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The id of an agent's not-started record of a local day. */
export const heldId = (day: string): string => `${HELD_PREFIX}${day}`

/** The local day of a not-started record (null: not one). */
export const heldDay = (r: Pick<AgentRun, 'id' | 'held'>): string | null => {
  if (r.held?.kind !== 'notStarted' || !r.id.startsWith(HELD_PREFIX)) return null
  const day = r.id.slice(HELD_PREFIX.length)
  return DAY_RE.test(day) ? day : null
}

export const isHeld = (r: Pick<AgentRun, 'status'>): boolean => r.status === 'held'

/**
 * The newest finished-or-running run that is neither a skip nor a Regler hold (health.ts): a skip says nothing about the
 * agent's health, and a hold at the red line is no failure — it lights no `fail:` lamp and an earlier failure stays lit
 * (the Regler's VERBRAUCH lamp counts holds).
 */
export const newestReal = <R extends Pick<AgentRun, 'status'>>(runs: readonly R[]): R | undefined => runs.find((r) => r.status !== 'skipped' && r.status !== 'held')

/** A change the person has not decided yet. */
const openChange = (status: string) => status === 'pending' || status === 'failed' || status === 'applying'

/** Proposals of a run that still wait for the person. */
export const openProposals = (r: Pick<AgentRun, 'staged'>): number => (r.staged ?? []).reduce((n, c) => n + (openChange(c.status) ? 1 : 0), 0)

const line = (l?: { spent: number; limit: number } | null): Pick<AgentRunHeld, 'spent' | 'limit'> =>
  l && Number.isFinite(l.limit) && Number.isFinite(l.spent) ? { spent: Math.max(0, l.spent), limit: Math.max(0, l.limit) } : {}

export interface HeldStart {
  agentId: string
  /** the local day of `at` (features/governor dayOf) */
  day: string
  at: number
  binding: HeldBinding
  /** the binding line's spend and limit (limits.ts lineOf) */
  line?: { spent: number; limit: number } | null
  trigger: AgentRun['trigger']
}

/** The day's not-started record after one more start was held (`prev`: the record so far, if any). */
export function heldNotStarted(prev: AgentRun | null | undefined, s: HeldStart): AgentRun {
  const same = prev && prev.id === heldId(s.day) && prev.held?.kind === 'notStarted' ? prev : null
  const times = [...(same?.held?.times ?? []), s.at].filter((x) => Number.isFinite(x)).sort((a, b) => a - b).slice(-HELD_TIMES)
  const count = (same?.held?.count ?? 0) + 1
  return {
    id: heldId(s.day),
    agentId: s.agentId,
    runner: 'browser',
    trigger: same?.trigger ?? s.trigger,
    startedAt: same ? Math.min(same.startedAt, s.at) : s.at,
    endedAt: same ? Math.max(same.endedAt ?? same.startedAt, s.at) : s.at,
    status: 'held',
    summary: '',
    steps: [],
    held: { kind: 'notStarted', binding: s.binding, ...line(s.line), count, times },
    ...(same?.pruned ? { pruned: same.pruned } : {}),
  }
}

export interface HeldStop {
  binding: HeldBinding
  line?: { spent: number; limit: number } | null
  /** the lowest rest at the stop */
  rest: number
  next: AgentRunBrake['next']
  at: number
}

/** A run the brake stopped between two steps: held, its proposals kept as they are. */
export function heldStopped(run: AgentRun, s: HeldStop): AgentRun {
  return {
    ...run,
    status: 'held',
    endedAt: run.endedAt ?? s.at,
    held: { kind: 'stopped', binding: s.binding, ...line(s.line) },
    brake: { binding: s.binding, rest: Number.isFinite(s.rest) ? s.rest : 0, next: s.next },
  }
}

const newestFirst = (a: AgentRun, b: AgentRun) => b.startedAt - a.startedAt

/**
 * The runs a device keeps (newest first): the newest `max`, plus older ones holding open proposals (≤ PRUNE_EXTRA).
 * `note`: the proposals that went over that are added to the newest run's `pruned` (a load leaves it to the write).
 */
export function pruneRuns(list: readonly AgentRun[], max: number, opts: { note?: boolean } = {}): AgentRun[] {
  const sorted = [...list].sort(newestFirst)
  if (sorted.length <= max) return sorted
  const head = sorted.slice(0, max)
  const older = sorted.slice(max).filter((r) => openProposals(r) > 0)
  const kept = older.slice(0, PRUNE_EXTRA)
  const gone = older.slice(PRUNE_EXTRA).reduce((n, r) => n + openProposals(r), 0)
  if (gone > 0 && opts.note !== false && head.length) head[0] = { ...head[0], pruned: (head[0].pruned ?? 0) + gone }
  return [...head, ...kept]
}

/**
 * Insert or replace a run (by id) and keep what a device keeps. A replaced run keeps the `pruned` count its stored copy
 * had (the caller's copy of a run going on does not know it).
 */
export function mergeRun(list: readonly AgentRun[], run: AgentRun, max: number): AgentRun[] {
  const at = list.findIndex((r) => r.id === run.id)
  const old = at >= 0 ? list[at] : null
  const next = old?.pruned && !run.pruned ? { ...run, pruned: old.pruned } : run
  const rest = at >= 0 ? [...list.slice(0, at), next, ...list.slice(at + 1)] : [next, ...list]
  return pruneRuns(rest, max)
}
