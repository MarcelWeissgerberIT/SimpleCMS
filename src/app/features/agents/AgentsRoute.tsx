/** #/agents and #/agents/<id>: the agents area, loaded on first visit. */
import { lazy, Suspense } from 'react'

const AgentsView = lazy(() => import('./AgentsView'))

export function AgentsRoute({ agentId }: { agentId?: string }) {
  return (
    <Suspense fallback={null}>
      <AgentsView agentId={agentId} />
    </Suspense>
  )
}
