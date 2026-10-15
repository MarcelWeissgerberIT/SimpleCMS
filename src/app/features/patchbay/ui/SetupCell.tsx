/**
 * The status bar's setup cell, its body (lazy — it reads the lamps, setup/facts.ts): "SETUP · 04 NEXT" /
 * "EINRICHTUNG · 04 ALS NÄCHSTES" while a setup is open on this device (§1.8); a press opens that setup's band. It sheds
 * first (`data-shed-1`); the thread back from a step that left the page is the topbar's return chip (§6 U2).
 */
import { useT } from '../../../i18n'
import { useSetupLamps } from '../setup/facts'
import { setOf } from '../setup/lamps'
import { lampNo } from '../setup/keys'
import { openPatchbay } from '../open'

const P = 'features.patchbay'

export default function SetupCell({ profileId, recipeId }: { profileId: string; recipeId?: string }) {
  const t = useT()
  const lamps = useSetupLamps(profileId)
  const set = lamps ? setOf(lamps.sets, recipeId ?? null) : null
  if (!set) return null
  const next = set.next
  return (
    <button type="button" className="status__cell status__btn pb-status pb-status--setup" title={t(`${P}.status.setupTitle`)} onClick={() => openPatchbay({ setup: profileId, band: true })} data-testid="patchbay-status-setup">
      {next ? (
        <>
          {t(`${P}.ro.setup`)} · <b className="pb-status__step">{t(`${P}.setup.arrivedNext`, { next: lampNo(next.n) })}</b>
        </>
      ) : (
        t(`${P}.status.setupDone`)
      )}
    </button>
  )
}
