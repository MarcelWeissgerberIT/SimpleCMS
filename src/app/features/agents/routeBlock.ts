/**
 * routeBlock(): an agent whose model route this version of One cannot run — its first pin is not Claude, a pin names a
 * provider this build has no engine for, or a route / reviewer / saver rule it cannot read at all (a newer version
 * saved it). Such a run never starts: it ends as an error run with the reason, and no request goes out.
 */
import type { ProviderId } from '@/shared/ai/types'
import { agentAIReadable, readAgentRoute } from '@/shared/ai/route'
import type { CustomAgent } from '../../store/types'

/** The providers this build can run (slice 1: Claude only). */
export const RUNNABLE_PROVIDERS: readonly ProviderId[] = ['anthropic']

export function routeBlock(agent: Pick<CustomAgent, 'route' | 'review' | 'saverRule' | 'applyOn'>): 'route' | null {
  const route = readAgentRoute(agent.route)
  if (route === 'unreadable' || !agentAIReadable(agent)) return 'route'
  if (!route?.length) return null
  if (route[0]?.p !== 'anthropic') return 'route'
  return route.some((pin) => !RUNNABLE_PROVIDERS.includes(pin.p)) ? 'route' : null
}
