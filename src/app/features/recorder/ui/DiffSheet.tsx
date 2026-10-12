/**
 * The phone's second sheet: one place of the read window over the plan sheet — a back key "‹ Plan" and ✕, the
 * place's diff with its properties stacked per property. No action key: what to do stays on the plan sheet. The sheet
 * is named after its place and what it belongs to ("NL-1408 · Auswerfen", "Bericht · Fenster lesen").
 */
import { ChevronLeft, X } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Modal } from '../../../ui/Modal'
import type { PlaceKey } from '../model/types'
import type { ReadModel } from '../window/read'
import { PlacePreview, type EjectView } from './PlacePreview'
import { placeTitle } from './PlanList'

export function DiffSheet({ model, p, onClose, eject }: { model: ReadModel; p: PlaceKey; onClose: () => void; eject?: EjectView }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const w = model.data.places.get(p)
  const { key, title } = placeTitle(t, pages, model, { p, pk: w?.pk ?? 'page', ...(w?.db ? { db: w.db } : {}), ...(w?.unavailable ? { unavailable: true } : {}) })
  const name = `${key ? `${key} · ` : ''}${title} · ${t(eject ? 'features.recorder.eject.label' : 'features.recorder.win.read')}`
  return (
    <Modal open onClose={onClose} bare className="rec-read rec-sheet2" ariaLabel={name}>
      <div className="rec-bar">
        <button type="button" className="btn btn--ghost rec-bar__back" onClick={onClose} data-autofocus>
          <ChevronLeft size={16} aria-hidden />
          <span>{t('features.recorder.eject.backToPlan')}</span>
        </button>
        <span className="rec-bar__sp" />
        <button type="button" className="icon-btn rec-bar__x" onClick={onClose} aria-label={t('features.recorder.read.close')} title={t('features.recorder.read.close')}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="rec-body rec-body--sheet2">
        <PlacePreview model={model} p={p} stacked {...(eject ? { variant: 'eject' as const, eject } : {})} />
      </div>
    </Modal>
  )
}
