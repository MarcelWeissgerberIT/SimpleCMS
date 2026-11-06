/**
 * routeBlock(): an agent whose model route this version of One cannot run — its first pin has no browser engine, a pin names a
 * provider this build has no engine for, or a route / reviewer / saver rule it cannot read at all (a newer version
 * saved it). Such a run never starts: it ends as an error run with the reason, and no request goes out.
 */
import type { ProviderId } from '@/shared/ai/types'
import { agentAIReadable, readAgentRoute } from '@/shared/ai/route'
import type { CustomAgent } from '../../store/types'

/** Browser engines in this build. The team server enforces its own Claude-only guard. */
export const RUNNABLE_PROVIDERS: readonly ProviderId[] = ['anthropic', 'copilot', 'local']

export function routeBlock(agent: Pick<CustomAgent, 'route' | 'review' | 'saverRule' | 'applyOn'>): 'route' | null {
  const route = readAgentRoute(agent.route)
  if (route === 'unreadable' || !agentAIReadable(agent)) return 'route'
  if (!route?.length) return null
  if (!RUNNABLE_PROVIDERS.includes(route[0]!.p)) return 'route'
  return route.some((pin) => !RUNNABLE_PROVIDERS.includes(pin.p)) ? 'route' : null
}
