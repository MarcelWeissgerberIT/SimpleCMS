/**
 * aiStatus(purpose): can a request of this purpose go out on this device now, and where to? routeFor(purpose): the
 * route it would take — for estimates and limits shown before a request (D-S2-32). Both are the gate's resolution
 * (core/gate.ts) without sending or reserving anything.
 */
import type { DataClass, Route } from '@/shared/ai/types'
import { isJevRouter } from '@/shared/ai/jev'
import { allowedFor } from '@/shared/ai/policy'
import { providerInfo } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import type { PurposeId } from './purposes'
import { capsFor, labelFor, modelInfo, priceFor, shortFor } from './registry'
import { estimate, type Band, type EstimateRequest } from '../../governor'

import { routeFor } from './gate'

export { aiStatus, routeFor, type AIStatus } from './gate'

/** The short label of a route's model ("OPUS 5.5", "JEV ROUTER"), else its id's last part. */
export const shortOf = (route: Route, pool?: readonly string[]): string => shortFor(route, pool)

/** How an estimate names its route: Claude's short label as before ("OPUS 5.5"), another provider's with its name. */
export const estimateLabel = (route: Route, pool?: readonly string[]): string => (route.p === 'anthropic' ? shortFor(route, pool) : labelFor(route, pool))

/** A cost band on a route (its price: the table, the shortlist row, a dynamic route's bound — never 0). */
export const estimateOn = (r: { route: Route; pool?: readonly string[] }, req: EstimateRequest): Band | null => estimate(r.route, req, Date.now(), priceFor(r.route, r.pool), capsFor(r.route, r.pool), modelInfo(r.route, r.pool)?.hints)

/** May the route a request of this purpose takes receive this class? (before the request is built — the memory block) */
export function mayReceive(purpose: PurposeId, cls: DataClass): boolean {
  const { route } = routeFor(purpose)
  const s = useWorkspace.getState()
  return allowedFor(route.p, cls, s.ai, s.settings.ai)
}

/**
 * Who receives a request of this purpose on this device now: the company, its API host, the route's label and whether
 * the Jev Router chooses (it forwards — its privacy sentence goes with it). For the data-destination lines a person
 * reads before a request (they name the routed company — a Claude-only person still reads "Anthropic").
 */
export function destinationOf(purpose: PurposeId, o: { route?: Route | null } = {}): { company: string; host: string; label: string; router: boolean } {
  const r = routeFor(purpose, o)
  const info = providerInfo(r.route.p)
  return { company: info.company, host: info.host, label: r.label, router: isJevRouter(r.route.m) }
}
