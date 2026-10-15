/**
 * The status bar's Patchbay cells (§1.8): "PATCHBAY · 1 FUSE" / "SCHALTPLAN · 1 SICHERUNG" while at least one fuse is
 * open (the number in signal ink — neutral ink for viewers and read-only members, as the sidebar's LED); a press opens
 * the Patchbay at the first open fuse. It sheds first (`data-shed-1`, ui/nav.css): the way to the Patchbay is the
 * sidebar row, the thread back to a setup is the topbar's return chip (§6 U2). The numbers are the LED's (counts.ts).
 *
 * B12: the setup cell "SETUP · 04 NEXT" while a setup is open on this device (the record, setup/record.ts — read after
 * the first paint, in idle, and only once this device opened the Patchbay: no record exists before, and a device that
 * never did — or one just reset — gets no `one-patchbay` database for it) and its profile is there; its body reads the
 * lamps in a lazy chunk.
 */
import { lazy, Suspense, useEffect } from 'react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { usePatchbayCounts } from '../counts'
import { openPatchbay } from '../open'
import { loadSetupRecord, useSetupRecord } from '../setup/record'
import { useSeen } from './seen'
import './nav.css'

const P = 'features.patchbay'
const SetupCell = lazy(() => import('./SetupCell'))

const idle = (fn: () => void): (() => void) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }).requestIdleCallback
  if (ric) {
    const id = ric(fn, { timeout: 3000 })
    return () => (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id)
  }
  const id = setTimeout(fn, 400)
  return () => clearTimeout(id)
}

/** "SETUP · 04 NEXT": an open setup of this device whose profile is there (its lamps load lazily). */
function SetupStatus() {
  const { rec, visit } = useSetupRecord()
  const scope = useCloud((s) => (s.active.kind === 'cloud' ? `${s.active.id}:${s.user?.id ?? ''}` : 'local'))
  const seen = useSeen()
  // the record is read after the first paint, in idle — and again for another member scope; never before a first visit
  useEffect(() => (seen ? idle(() => void loadSetupRecord()) : undefined), [scope, seen])
  const id = visit?.profileId ?? (rec && !rec.closed ? rec.profileId : null)
  const there = useWorkspace((s) => !!id && (s.integrations ?? []).some((p) => p.id === id))
  if (!id || !there) return null
  return (
    <Suspense fallback={null}>
      <SetupCell profileId={id} recipeId={visit?.recipeId ?? rec?.recipeId} />
    </Suspense>
  )
}

export function PatchbayStatusCells() {
  return (
    <>
      <SetupStatus />
      <FuseStatus />
    </>
  )
}

function FuseStatus() {
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
