/**
 * Lamps "Mirror stale" and "Agent missed" — synchronous reads over the agents, the runs this tab loaded and the slot
 * cache (features/agents/health.ts). Ids: stale:<agent>@<run> · slot:<agent>@<slot> · fail:<agent>@<run> ·
 * cfm:<agent>@<updatedAt>. The slots are primed (one IndexedDB read each) at start and when the agents change.
 */
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { creatorConfirms, healthFitted, missedAgents, onRunsChanged, primeSlots, scheduledHere, staleMirrors, useAgentRuns, useServerAgents, type HealthItem } from '../../agents'
import { runsHere } from '../../agents/runner'
import type { LampReading, LampSourceDef } from '../registry'
import { fmtWhen } from '../format'
import { all, tn, watch } from './util'

const me = () => useCloud.getState().user?.id ?? null

function subscribe(changed: () => void): () => void {
  let primed = ''
  const prime = () => {
    const ids = scheduledHere()
    const key = ids.join(',')
    if (key === primed) return
    primed = key
    void primeSlots(ids).then(changed, () => {})
  }
  prime()
  return all(
    watch(useWorkspace, (s) => [s.agents], () => {
      prime()
      changed()
    }),
    watch(useAgentRuns, (s) => [s.byAgent], changed),
    onRunsChanged(() => changed()),
    watch(useServerAgents, (s) => [s.openLatest, s.runs], changed),
    watch(useCloud, (s) => [s.user, s.readOnly, s.active], changed),
  )
}

const agentsOf = (items: readonly HealthItem[]) => [...new Set(items.map((i) => i.agentId))]

/** When the newest successful run of a mirror running here ended (the dark cap's second line). */
function newestMirrorRun(): number | null {
  const byAgent = useAgentRuns.getState().byAgent
  let at: number | null = null
  for (const a of Object.values(useWorkspace.getState().agents ?? {})) {
    if (!a.mirrorOf || !runsHere(a)) continue
    const ok = (byAgent[a.id] ?? []).find((r) => r.status === 'ok' || r.status === 'staged')
    const end = ok ? (ok.endedAt ?? ok.startedAt) : null
    if (end && (!at || end > at)) at = end
  }
  return at
}

let staleFirst: string | null = null
let missedFirst: string | null = null

export const mirrorLamp: LampSourceDef = {
  id: 'mirror',
  order: 100,
  legend: () => t('features.preflight.lamp.mirror.legend'),
  short: () => t('features.preflight.lamp.mirror.short'),
  rule: () => t('features.preflight.lamp.mirror.rule'),
  thresholds: { amber: 1, red: null },
  tick: true,
  fitted: () => healthFitted(me()).mirror,
  subscribe,
  read({ now }): LampReading {
    const items = staleMirrors(now)
    staleFirst = items[0]?.agentId ?? null
    const at = items.length ? Math.min(...items.map((i) => i.at)) : newestMirrorRun()
    return { state: 'ok', count: items.length, ids: items.map((i) => i.id), second: at ? t('features.preflight.lamp.mirror.second', { time: fmtWhen(at, now) }) : '' }
  },
  open: () => navigate(staleFirst ? { name: 'agents', id: staleFirst } : { name: 'agents' }),
}

/** Agents this member runs (the dark cap's second line: what the lamp watches). */
function watched(): number {
  const id = me()
  const team = useCloud.getState().active.kind === 'cloud'
  return Object.values(useWorkspace.getState().agents ?? {}).filter((a) => runsHere(a) || (team && a.runner === 'server' && !!id && a.createdBy === id)).length
}

export const missedLamp: LampSourceDef = {
  id: 'missed',
  order: 110,
  legend: () => t('features.preflight.lamp.missed.legend'),
  short: () => t('features.preflight.lamp.missed.short'),
  rule: () => t('features.preflight.lamp.missed.rule'),
  thresholds: { amber: 1, red: null },
  tick: true,
  fitted: () => healthFitted(me()).missed,
  subscribe,
  read({ now }): LampReading {
    const items = [...missedAgents(now, me()), ...creatorConfirms(me())]
    missedFirst = items[0]?.agentId ?? null
    const n = items.length ? agentsOf(items).length : watched()
    return {
      state: 'ok',
      count: items.length,
      ids: items.map((i) => i.id),
      ...(items.some((i) => i.level === 'red') ? { level: 'red' as const } : {}),
      second: n ? tn('features.preflight.lamp.missed.second', n) : '',
    }
  },
  open: () => navigate(missedFirst ? { name: 'agents', id: missedFirst } : { name: 'agents' }),
}
