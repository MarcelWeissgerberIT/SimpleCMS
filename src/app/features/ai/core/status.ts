/**
 * aiStatus(purpose): can a request of this purpose go out on this device now, and where to? The same checks as the
 * gate (generation, AUS, route) without sending or reserving anything — for buttons and hints.
 */
import { policyKnown } from '@/shared/ai/policy'
import { legacyRule } from '@/shared/ai/route'
import type { AIErrorCode } from '@/shared/ai/errors'
import type { Route } from '@/shared/ai/types'
import { modelRow } from '@/shared/ai/models'
import { useWorkspace } from '../../../store/store'
import { isAIDemo } from './demoMode'
import type { PurposeId } from './purposes'

export interface AIStatus {
  /** a request would go out (or get a demo answer) */
  ready: boolean
  /** the route it would take (null: none — see `reason`, or demo) */
  route: Route | null
  demo: boolean
  /** why it would not: 'reload' (newer rules) · 'no_key' */
  reason: Extract<AIErrorCode, 'reload' | 'no_key' | 'off'> | null
}

export function aiStatus(_purpose: PurposeId): AIStatus {
  const s = useWorkspace.getState()
  if (!policyKnown(s.ai, s.settings.ai)) return { ready: false, route: null, demo: false, reason: 'reload' }
  const [route] = legacyRule(s.settings.aiModel, !!s.settings.aiApiKey.trim())
  if (route) return { ready: true, route, demo: false, reason: null }
  if (isAIDemo()) return { ready: true, route: null, demo: true, reason: null }
  return { ready: false, route: null, demo: false, reason: 'no_key' }
}

/**
 * The route this device's requests take when a key is there (the legacy level: Claude with the chosen model) — for
 * estimates and limits shown before a request (a PDF's pages, a cost band), whether a key is set or not.
 */
export function chosenRoute(): Route {
  const [route] = legacyRule(useWorkspace.getState().settings.aiModel, true)
  return route
}

/** The short label of a route's model ("OPUS 5.5"), else its id. */
export const shortOf = (route: Route): string => modelRow(route)?.short ?? route.m
