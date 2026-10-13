/**
 * The brake note for a refused request (AIError 'budget', Regler § 5.5 / B8): BrakeNote's props from the error's brake
 * fix, and what its keys do — E: an allowance token for exactly this retry (+1 $ once), B: the same request with the
 * cheaper model of the same provider as the person's pick (core/gate.ts armRetry carries either into the retry the
 * caller starts with `onRetry`), Esc / Cancel: `onCancel`; owners and admins (locally: the person) get "Adjust the
 * budget ↗" when E would not do. Lazy (governor/index.ts BrakeSlot): loaded only when a note is shown.
 */
import { labelOf } from '@/shared/ai/models'
import { armRetry } from '../../ai/core/gate'
import { governorAllowed } from '../../../store/governor'
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'
import { allowOnce } from '../allow'
import { ALLOW_USD, type RefuseDetail } from '../brake'
import { brakeFixOf } from '../background'
import { BrakeNote } from './BrakeNote'

export interface BrakeForProps {
  /** the refused request's error (anything else renders nothing) */
  error: unknown
  /** start the same request again (it carries what E / B armed) */
  onRetry: () => void
  onCancel: () => void
  autoFocus?: boolean
}

/** The budget settings (Workspace › AI from B11): the dialog, the palette and the phone drawer close first. */
function openBudget(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace' })
}

export default function BrakeFor({ error, onRetry, onCancel, autoFocus }: BrakeForProps) {
  const r = brakeFixOf(error)
  if (!r) return null
  const { fix, detail, model } = r
  const purpose = fix?.purpose ?? null
  return (
    <BrakeNote
      detail={detail as RefuseDetail}
      model={model}
      band={fix?.band ?? null}
      rest={fix?.rest ?? 0}
      line={fix?.line ?? null}
      allow={fix?.allow ?? null}
      need={fix?.need ?? 0}
      cheaper={fix?.cheaper ? { label: labelOf(fix.cheaper), band: fix.cheaperBand ?? null } : null}
      owner={governorAllowed()}
      {...(autoFocus === false ? { autoFocus: false } : {})}
      onAllow={
        purpose && fix?.allow
          ? () => {
              armRetry(purpose, { allowance: allowOnce(fix.allow ?? ALLOW_USD).id })
              onRetry()
            }
          : undefined
      }
      onCheaper={
        purpose && fix?.cheaper
          ? () => {
              armRetry(purpose, { route: fix.cheaper })
              onRetry()
            }
          : undefined
      }
      onCancel={onCancel}
      onAdjust={openBudget}
    />
  )
}
