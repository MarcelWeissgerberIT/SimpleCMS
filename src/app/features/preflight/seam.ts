/**
 * window.__onePreflight — the test and screenshot seam (DEV, or ?e2e like the app's own __one). Reads, flushes and
 * the stores the fixture seeds through; never a key that acts for the person beyond what the store seam allows.
 */
import { useCloud, useCloudSync } from '../../cloud'
import { useAutofill } from '../../database'
import { putRun, useAgentRuns } from '../agents/runs'
import { useServerAgents } from '../agents/server'
import type { AgentRun } from '../agents/types'
import { useAgent } from '../ai/agent/state'
import { useAIRuns } from '../ai/runs'
import { useCoding } from '../coding'
import { useInbox } from '../inbox/state'
import { useMail } from '../mail'
import { useSync } from '../sync'
import { lampSources, registerLampSource, type LampReading } from './registry'
import { ackLamps, acksNow, flush, readings, renderCounts, stats } from './engine'
import { planMode } from './lamps'
import { todayKey } from './prefs'
import { usePreflight } from './state'
import { resetQueue, useQueue } from './queue/state'
import { noBlink } from './blink'

const fakes: Array<() => void> = []

export function installSeam(): void {
  if (!(import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) return
  ;(window as unknown as { __onePreflight?: unknown }).__onePreflight = {
    state: () => {
      const s = usePreflight.getState()
      return JSON.parse(JSON.stringify(s))
    },
    mode: () => {
      const s = usePreflight.getState()
      const q = useQueue.getState()
      return planMode({ on: s.on, ready: s.ready, lit: s.lit, newIds: s.newIds, queueOpen: q.lamp !== null, unfolded: q.unfolded, today: s.today, last: s.last }).mode
    },
    readings: () => JSON.parse(JSON.stringify(readings())),
    flush: (lampId?: string) => flush(lampId),
    stats,
    acks: () => JSON.parse(JSON.stringify(acksNow())),
    ack: (lampId: string) => ackLamps([lampId]),
    lamps: () => lampSources().map((s) => s.id),
    renders: () => ({ ...renderCounts }),
    noBlink,
    resetDay: () => {
      const scope = usePreflight.getState().scope
      if (scope) localStorage.removeItem(todayKey(scope))
      usePreflight.setState({ today: { day: usePreflight.getState().today.day, base: [] } })
      resetQueue()
    },
    seedRuns: async (runs: AgentRun[]) => {
      for (const r of runs) await putRun(r)
    },
    terminal: (patch: Record<string, unknown>) => useAgent.setState(patch),
    /** n inert lamps (the 16-lamp layout): amber with `count`, legends from the caller (test data) */
    fakeLamps: (list: Array<{ id: string; legend: string; second?: string; count?: number; order?: number; red?: boolean }>) => {
      for (const off of fakes.splice(0)) off()
      for (const [i, l] of list.entries()) {
        const reading: LampReading = { state: 'ok', count: l.count ?? 0, ids: Array.from({ length: l.count ?? 0 }, (_, k) => `${l.id}:${k}`), second: l.second ?? '' }
        fakes.push(
          registerLampSource({
            id: l.id,
            order: l.order ?? 200 + i,
            legend: () => l.legend,
            short: () => l.legend.split('\n')[0],
            rule: () => l.legend.replace('\n', ' '),
            thresholds: { amber: 1, red: l.red ? 1 : null },
            subscribe: () => () => {},
            read: () => reading,
          }),
        )
      }
    },
    stores: {
      preflight: usePreflight,
      queue: useQueue,
      mail: useMail,
      sync: useSync,
      coding: useCoding,
      cloud: useCloud,
      cloudSync: useCloudSync,
      inbox: useInbox,
      agent: useAgent,
      aiRuns: useAIRuns,
      agentRuns: useAgentRuns,
      serverAgents: useServerAgents,
      autofill: useAutofill,
    },
  }
}
