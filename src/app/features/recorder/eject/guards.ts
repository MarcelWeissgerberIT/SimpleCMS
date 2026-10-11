/**
 * May the eject settle a window's sources now (design §6.4 guards; checked before planning and again inside the locks
 * before the sync section)? Not while one of W's agents runs (any tab), its run is running or a change of it applies;
 * not while the terminal applies.
 * The sources are imported lazily (the recorder's chunk never loads the agents page for nothing).
 */
import type { ID } from '../../../store/types'
import type { WindowData } from '../window/load'
import type { EjectRefusal } from './plan'

/** The agent runs of a window, by agent: their AgentRun ids. */
export function agentRunsOf(data: Pick<WindowData, 'runs'>): Map<ID, Set<string>> {
  const out = new Map<ID, Set<string>>()
  for (const r of Object.values(data.runs)) {
    if (r.kind !== 'agent') continue
    const agentId = r.key.split(':')[1]
    if (agentId) (out.get(agentId) ?? out.set(agentId, new Set()).get(agentId)!).add(r.ref)
  }
  return out
}

/** Why the window's sources cannot be settled now (null: they can). */
export async function busyRefusal(data: Pick<WindowData, 'runs'>): Promise<EjectRefusal | null> {
  const agents = agentRunsOf(data)
  if (agents.size) {
    const { loadAgentRuns, ejectBusy } = await import('../../agents')
    for (const [agentId, refs] of agents)
      for (const run of await loadAgentRuns(agentId)) if (refs.has(run.id) && (await ejectBusy(run))) return { key: 'agentBusy' }
  }
  // the terminal: not while it applies (its batches live in this tab's session)
  if (Object.values(data.runs).some((r) => r.kind === 'terminal')) {
    const { terminalBusy } = await import('../../ai/agent/session')
    if (terminalBusy()) return { key: 'terminalBusy' }
  }
  return null
}
