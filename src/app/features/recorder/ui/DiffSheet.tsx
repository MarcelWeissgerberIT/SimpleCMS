/**
 * The phone's second sheet: one place of the read window over the plan sheet — a back key "‹ Plan" and ✕, the
 * place's diff with its properties stacked per property. No action key: what to do stays on the plan sheet.
 */
import { ChevronLeft, X } from 'lucide-react'
import { useT } from '../../../i18n'
import { Modal } from '../../../ui/Modal'
import type { PlaceKey } from '../model/types'
import type { ReadModel } from '../window/read'
import { PlacePreview } from './PlacePreview'

export function DiffSheet({ model, p, onClose }: { model: ReadModel; p: PlaceKey; onClose: () => void }) {
  const t = useT()
  return (
    <Modal open onClose={onClose} bare className="rec-read rec-sheet2" ariaLabel={t('features.recorder.win.read')}>
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
        <PlacePreview model={model} p={p} stacked />
      </div>
    </Modal>
  )
}
