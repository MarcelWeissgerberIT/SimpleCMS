/** Custom agents — the sidebar badge: proposals waiting for review (LED + mono count). */
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useAgentRuns } from './runs'
import { useServerAgents } from './server'
import type { AgentRun } from './types'

const open = (runs: AgentRun[] | undefined) =>
  (runs ?? []).reduce((sum, r) => (r.status === 'running' ? sum : sum + (r.staged ?? []).filter((c) => c.status === 'pending' || c.status === 'failed').length), 0)

/** Proposals of agent runs that wait for review (this device's runs + loaded server runs). */
export function useAgentsAttention(): number {
  const agents = useWorkspace((s) => s.agents)
  const local = useAgentRuns((s) => s.byAgent)
  const server = useServerAgents((s) => s.runs)
  let n = 0
  for (const a of Object.values(agents ?? {})) n += open(a.runner === 'server' ? server[a.id] : local[a.id])
  return n
}

export function AgentsNavBadge() {
  const t = useT()
  const n = useAgentsAttention()
  if (!n) return null
  return (
    <span className="sb-navrow__badge" data-testid="agents-review" title={t('features.agents.navReview', { n })}>
      <span className="led led--on" aria-hidden />
      {n > 99 ? '99+' : String(n).padStart(2, '0')}
      <span className="visually-hidden"> {t('features.agents.navReview', { n })}</span>
    </span>
  )
}
