/**
 * The consent card's band for a run that will make `n` requests of one purpose (a script's claude() calls — the dry
 * run's count; Regler § 5.7): n × the per-call band (precheck's peek, the request's own answer budget) against the
 * lowest rest. Null without a budget — the card stays exactly as it was. E on the card allows +1 $ for that run, today
 * (allowTask on the run's source); a run past the line still stops at the call that would cross it.
 */
import type { MoneyHint } from '../ai/core/gate'
import { ALLOW_USD } from './brake'
import { restMin } from './limits'
import type { Band } from './estimate'

export interface PlanBand {
  n: number
  band: Band
  rest: number
  fits: boolean
  /** what E allows (null: +1 $ would not make it fit) */
  allow: number | null
  need: number
}

export function planBand(hint: MoneyHint | null | undefined, n: number): PlanBand | null {
  if (!hint || !hint.band || n <= 0) return null
  const band = { low: hint.band.low * n, high: hint.band.high * n }
  const rest = Math.max(0, restMin(hint.rest))
  const fits = band.high <= rest
  return { n, band, rest, fits, allow: !fits && band.high <= rest + ALLOW_USD ? ALLOW_USD : null, need: Math.max(0, band.high - rest) }
}
