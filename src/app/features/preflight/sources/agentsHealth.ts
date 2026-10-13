/**
 * Lamps "Mirror stale" and "Agent missed" — synchronous reads over the agents, the runs this tab loaded and the slot
 * cache (features/agents/health.ts). Ids: stale:<agent>@<run> · slot:<agent>@<slot> · fail:<agent>@<run> ·
 * cfm:<agent>@<updatedAt> · jevfail:<agent>@<run> · jevnew:<agent>@<snapshot> (slice SJ: the Vorprüfung failing, another Jev
 * snapshot answered — its key opens the agent's editor at section 06, where the new version is confirmed). The slots are primed (one IndexedDB read each) at start and when the agents change.
 */
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { creatorConfirms, healthFitted, jevHealth, missedAgents, onRunsChanged, primeSlots, scheduledHere, staleMirrors, useAgentRuns, useServerAgents, type HealthItem } from '../../agents'
import { jevName, whyText } from '../../ai/decide/text'
import { runsHere } from '../../agents/runner'
import type { CardAction, LampReading, LampSourceDef, QueueItem } from '../registry'
import { fmtWhen } from '../format'
import { all, tn, watch } from './util'
import { fixItems, openKey } from './fix'
import { openAgentChecks, runAgent } from '../queue/calls'

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
  queue: {
    items: ({ now }) => {
      const items = staleMirrors(now)
      return fixItems('mirror', items.map((i) => i.id), (id) => {
        const it = items.find((x) => x.id === id)!
        return { tag: t('features.preflight.lamp.mirror.short'), title: agentName(it.agentId), detail: t('features.preflight.fix.mirror.since', { time: fmtWhen(it.at, now) }), refs: { agentId: it.agentId }, at: it.at }
      })
    },
    actions: (item) => [openKey(t('features.preflight.card.openAgent'), () => navigate({ name: 'agents', id: item.refs.agentId! }))],
  },
}

const agentName = (id: string) => useWorkspace.getState().agents?.[id]?.name ?? '—'

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
    const items = [...missedAgents(now, me()), ...creatorConfirms(me()), ...jevHealth()]
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
  queue: {
    items: ({ now }) => {
      const items = [...missedAgents(now, me()), ...creatorConfirms(me()), ...jevHealth()]
      return fixItems('missed', items.map((i) => i.id), (id) => {
        const it = items.find((x) => x.id === id)!
        const kind = id.startsWith('slot:') ? 'slot' : id.startsWith('cfm:') ? 'confirm' : 'failed'
        const detail =
          it.kind === 'jevfail'
            ? t('features.ai.jev.lamp.fail', { when: fmtWhen(it.at, now), why: whyText(t, it.jev?.why) })
            : it.kind === 'jevnew'
              ? t('features.ai.jev.lamp.new', { model: jevName(it.jev?.model ?? '') })
              : t(`features.preflight.fix.missed.${kind}`, { time: fmtWhen(it.at, now) })
        return { tag: t('features.preflight.lamp.missed.short'), title: agentName(it.agentId), detail, refs: { agentId: it.agentId }, at: it.at, hand: kind === 'slot' ? ['tokens'] : kind === 'confirm' ? ['confirm'] : [] }
      })
    },
    actions: (item: QueueItem): CardAction[] => {
      const agentId = item.refs.agentId!
      // a Vorprüfer lamp: the editor at section 06 — where "new version" is confirmed and the pre-check's state shows
      if (item.id.startsWith('jevnew:') || item.id.startsWith('jevfail:')) return [openKey(t(item.id.startsWith('jevnew:') ? 'features.ai.jev.lamp.openNew' : 'features.ai.jev.lamp.openCheck'), () => openAgentChecks(agentId))]
      const open = openKey(t('features.preflight.card.openAgent'), () => navigate({ name: 'agents', id: agentId }))
      const agent = useWorkspace.getState().agents?.[agentId]
      if (!item.id.startsWith('slot:') || !agent) return [open]
      return [{ key: 'a', label: t('features.preflight.fix.missed.run'), outcome: 'hand', hand: ['tokens'], run: async () => (await runAgent(agent), { ok: true, resolve: 'reading' }) }, open]
    },
  },
}
