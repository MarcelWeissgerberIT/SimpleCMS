/**
 * "Belegt?" for the answer surfaces (the help's Ask, "Ask the workspace"): whether it is on (this device's switch —
 * absent = off), the check itself (lazy: the decide core loads only when it runs) and the route "Ask more thoroughly"
 * takes (the deep role of the provider that answered — the person's press, the gate checks the rules again).
 */
import type { Route } from '@/shared/ai/types'
import { useWorkspace } from '../../../store/store'
import { routeFor } from '../core/gate'
import type { PurposeId } from '../core/purposes'
import { roleRoute, rolesOf } from '../setup/facts'
import type { VerifyInput, VerifyResult } from './verify'

/** Is "Check answers against their sources with Jev" on for this device? (absent = off) */
export const verifyOn = (): boolean => useWorkspace.getState().settings.ai?.jev?.verify === true
/** The same, as a hook. */
export const useVerifyOn = (): boolean => useWorkspace((s) => s.settings.ai?.jev?.verify === true)

/** One "Belegt?" check (never throws). */
export const runVerify = (i: VerifyInput): Promise<VerifyResult> => import('./verify').then((m) => m.verifyAnswer(i))

/** The deeper route for a purpose: the deep role of the provider its rules pick now (null: none deeper known). */
export function deeperRoute(purpose: PurposeId, chip?: Route | null): Route | null {
  const now = routeFor(purpose, { route: chip ?? null }).route
  const deep = rolesOf(now.p).deep
  if (!deep || deep === now.m) return null
  return roleRoute(now.p, 'deep', deep)
}
