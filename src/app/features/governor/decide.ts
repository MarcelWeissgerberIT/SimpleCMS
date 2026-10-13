/**
 * The decide reservation (Regler § 5.6 / G-D6 with slice SJ): an agent run whose proposals Jev pre-checks holds the band of
 * those checks from its start — DECIDE_CHECKS × one check's band at the price this tab knows for its Vorprüfer — so its own
 * steps stop short of the red line and the checks still fit after them. Every check carries the reservation's id
 * (`run.decide`, features/ai/decide/checkRun.ts); the money phase (install.ts `decision`) takes its band out of it: the
 * day / month line the reservation was counted against is not asked again, the 'noprice' / 'scope' refusals stand, and
 * what it no longer covers is judged like any request — refused, the check is not sent ('budget') and an apply-mode run
 * waits as a whole (agents/direct.ts 'line'). No line set, or no price known here: nothing is reserved (every byte as
 * before; the checks are judged like any request). The run settles it once its checks are done or will not come.
 */
import type { Caps, PriceRow, Route } from '@/shared/ai/types'
import { useWorkspace } from '../../store/store'
import { estimate, type Band } from './estimate'
import { adjust, openReservation, reserve } from './ledger'
import { hasLimit, limitsOf } from './limits'
import { deviceLimitOf } from './device'

/** How many checks the reservation holds at the start (an agent stages ≤ 50 rows in one upsert_rows call). */
export const DECIDE_CHECKS = 50
/** One check's state as the start counts it (characters: the instructions, the change, its target, the questions). */
export const DECIDE_STATE_CHARS = 6_000

/** One check's band at the start (null: no price known here). */
export const decideBand = (route: Route, price: PriceRow | null, caps: Caps | null, now = Date.now()): Band | null =>
  price ? estimate(route, { promptChars: DECIDE_STATE_CHARS, maxTokens: 0 }, now, price, caps) : null

/**
 * Take a run's decide reservation (null: none — no line set, no price known for the Vorprüfer here, a band of nothing).
 * `source`: the run's ledger source ('agent:<id>:<run>').
 */
export function reserveDecide(o: { route: Route; price: PriceRow | null; caps: Caps | null; source: string }): string | null {
  const usd = decideUsd(o)
  return usd > 0 ? reserve(usd, o.source).id : null
}

/**
 * What a decide reservation takes now (USD; 0: none — no line set, no price known here, a band of nothing). The start
 * check counts it into a run's first step (exec.ts startFor): the reservation is taken right after the start.
 */
export function decideUsd(o: { route: Route; price: PriceRow | null; caps: Caps | null }): number {
  if (!hasLimit(limitsOf(useWorkspace.getState().governor, deviceLimitOf()))) return 0
  const band = decideBand(o.route, o.price, o.caps)
  return band && band.high > 0 ? band.high * DECIDE_CHECKS : 0
}

/**
 * A check's band out of its run's decide reservation: true = covered (the reservation shrinks by the band's upper end,
 * the check reserves it itself). false: settled, not this tab's, or less left than the band — judge it like any request.
 */
export function takeDecide(id: string | null | undefined, band: Band): boolean {
  const r = openReservation(id)
  if (!r || band.high > r.usd) return false
  return adjust(r.id, r.usd - band.high)
}

/** What is left of a decide reservation (0: none). */
export const decideLeft = (id: string | null | undefined): number => openReservation(id)?.usd ?? 0
