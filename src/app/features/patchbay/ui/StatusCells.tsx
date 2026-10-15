/**
 * The status bar's Patchbay cells (§1.8): "PATCHBAY · 1 FUSE" / "SCHALTPLAN · 1 SICHERUNG" while at least one fuse is
 * open (the number in signal ink — neutral ink for viewers and read-only members, as the sidebar's LED); a press opens
 * the Patchbay at the first open fuse. It sheds first (`data-shed-1`, ui/nav.css): the way to the Patchbay is the
 * sidebar row, the thread back to a setup is the topbar's return chip (§6 U2). The setup cell "SETUP · 04 NEXT" joins
 * in B12. The numbers are the LED's (counts.ts).
 */
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { usePatchbayCounts } from '../counts'
import { openPatchbay } from '../open'
import './nav.css'

const P = 'features.patchbay'

export function PatchbayStatusCells() {
  const t = useT()
  const c = usePatchbayCounts()
  const viewer = useCloud((s) => s.readOnly || s.role === 'viewer')
  if (!c.ready || c.open < 1) return null
  return (
    <button
      type="button"
      className="status__cell status__btn pb-status"
      data-viewer={viewer || undefined}
      data-testid="patchbay-status"
      title={t(`${P}.status.title`)}
      onClick={() => openPatchbay(c.first ? { f: c.first } : {})}
    >
      {t(`${P}.title`)} · <b className="pb-status__n">{t(c.open === 1 ? `${P}.status.fuses.one` : `${P}.status.fuses`, { n: c.open })}</b>
    </button>
  )
}
