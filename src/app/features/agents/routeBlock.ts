/**
 * routeBlock(): an agent whose model route this version of One cannot run — its first pin is not Claude, or a pin names a
 * provider this build has no engine for (a newer version saved it). Such a run never starts: it ends as an error run
 * with the reason, and no request goes out.
 */
import type { ProviderId } from '@/shared/ai/types'
import type { CustomAgent } from '../../store/types'

/** The providers this build can run (slice 1: Claude only). */
export const RUNNABLE_PROVIDERS: readonly ProviderId[] = ['anthropic']

export function routeBlock(agent: Pick<CustomAgent, 'route'>): 'route' | null {
  const route = agent.route
  if (!route?.length) return null
  if (route[0]?.p !== 'anthropic') return 'route'
  return route.some((pin) => !RUNNABLE_PROVIDERS.includes(pin.p)) ? 'route' : null
}
