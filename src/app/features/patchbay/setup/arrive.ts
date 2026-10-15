/**
 * Back on the patchbay after a step that left it (plan §1.11, §3.9): the way back is cleared, the lamp that is next
 * now takes the keyboard and a polite live region says what happened — "02 done · 03 next" (the lamp left to work on
 * is green now), "02 next" (it is not yet), "Setup done" (every lamp green). Lazy: the return chip loads it.
 */
import { t } from '../../../i18n'
import { focusLost, focusMainRegion } from '../../../ui/focus'
import type { ReturnRecord } from './return'
import { clearReturn, sayArrival } from './return'
import { lampsNow } from './facts'
import { setOf } from './lamps'
import { focusLampKey } from './focus'
import { lampNo } from './keys'

/** Arrive: clear the way back, say where the setup stands, focus the next lamp's key (once the band shows it). */
export async function arrive(ret: ReturnRecord): Promise<void> {
  clearReturn()
  const now = lampsNow(ret.profileId)
  const set = now ? setOf(now.sets, ret.recipeId) : null
  if (!set) return
  const left = set.lamps.find((l) => l.id === ret.next)
  const next = set.next
  if (!next) sayArrival(t('features.patchbay.setup.arrivedAll'))
  else if (left && left.state === 'ok' && left.n !== next.n) sayArrival(t('features.patchbay.setup.arrived', { done: lampNo(left.n), next: lampNo(next.n) }))
  else sayArrival(t('features.patchbay.setup.arrivedNext', { next: lampNo(next.n) }))
  const took = next ? await focusLampKey(next, { profile: ret.profileId }) : false
  // no lamp key shown (the band not drawn, every lamp green): the main region, never the body
  if (!took && focusLost()) focusMainRegion()
}
