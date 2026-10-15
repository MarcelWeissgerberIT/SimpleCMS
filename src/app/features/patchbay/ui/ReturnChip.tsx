/**
 * The topbar's return chip "Back to setup · 05 next ↵" (plan §1.11, §6 U2) — mounted once in the topbar, on every
 * route. While a setup step left the patchbay (setup/return.ts) and the route is not that profile's setup
 * (#/patchbay?setup=<its id>), the chip shows — never shed, also on the phone (there: the arrow and the lamp's number;
 * the words are its name); × clears the way back. Coming back to that setup (by the chip or any other way) is the
 * arrival (setup/arrive.ts): the next lamp's key of ITS band takes the keyboard and the polite live region here says
 * "04 done · 05 next". Another profile's setup, or the rack without one, is no arrival: the way back stays.
 *
 * Boot code: this wrapper reads only the return record; the chip's body (it reads the lamps) and the arrival load
 * lazily, and only while a way back is set. DEV / `?e2e`: the setup seam `window.__onePatchbaySetup` (lamps, a lamp's
 * key pressed, the way back, the openers) — everything behind it loads on its first call.
 */
import { lazy, Suspense, useEffect } from 'react'
import { useRoute } from '../../../lib/router'
import { clearReturn, markAway, readReturn, useArrivalText, useReturn, type ReturnRecord } from '../setup/return'
import { openMcpConnections } from '../../mcp'
import { keptDraftFor, openIntegrations } from '../../agents'

const Body = lazy(() => import('./ReturnChipBody'))

/** The arrival of one record runs once (the effect may run again before it cleared the record). */
let arriving = 0

export function PatchbayReturnChip() {
  const ret = useReturn()
  const route = useRoute()
  const said = useArrivalText()
  // fix (rest): only the setup the record belongs to is "back" — another profile's setup (or the rack without one) keeps
  // the way back and the chip; arriving there would speak of and focus the wrong band
  const here = route.name === 'patchbay' && !!ret && route.setup === ret.profileId
  useEffect(() => {
    if (ret && !here && !ret.away) markAway()
  }, [ret, here])
  useEffect(() => {
    if (!ret?.away || !here || arriving === ret.at) return
    arriving = ret.at
    void import('../setup/arrive').then((m) => m.arrive(ret))
  }, [ret, here])
  return (
    <>
      {ret && !here && (
        <Suspense fallback={null}>
          <Body ret={ret} />
        </Suspense>
      )}
      <span className="visually-hidden" role="status" aria-live="polite" data-testid="pb-return-live">
        {said}
      </span>
    </>
  )
}

/* ------------------------------------------------------------------ the seam (DEV / ?e2e) */

type SeamRecord = ReturnRecord | null

const seamOn = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

if (seamOn && typeof window !== 'undefined') {
  ;(window as unknown as { __onePatchbaySetup?: unknown }).__onePatchbaySetup = {
    /** the lamp sets of a profile now (plain data) */
    lamps: async (profileId: string) => (await import('../setup/facts')).lampsNow(profileId),
    /** press lamp `n` of a set (`from`: a selector of the element standing for its key) — true when it acted */
    act: async (profileId: string, recipeId: string | null, n: number, from?: string) => {
      const [{ lampsNow }, { runLamp }, { setOf }] = await Promise.all([import('../setup/facts'), import('../setup/act'), import('../setup/lamps')])
      const set = setOf(lampsNow(profileId)?.sets ?? [], recipeId)
      const lamp = set?.lamps.find((l) => l.n === n)
      if (!lamp) return false
      const el = from ? document.querySelector<HTMLElement>(from) : null
      return runLamp(lamp, { profileId, recipeId, from: el })
    },
    /** the way back (the record) · clear it */
    ret: (): SeamRecord => readReturn(),
    clearReturn,
    /** the kept mirror drafts of a profile's recipe (draft id, database id) */
    kept: (profileId: string, recipeId: string) => {
      const k = keptDraftFor(profileId, recipeId)
      return k ? { draftId: k.made.draft.id, dbId: k.made.dbId, reportId: k.made.reportId } : null
    },
    /** the openers the lamps use */
    openMcp: (opts: { server?: string; focus?: 'test' }) => openMcpConnections(opts),
    openIntegrations: (id?: string) => openIntegrations(id),
  }
}
