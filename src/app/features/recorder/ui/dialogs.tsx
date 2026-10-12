/**
 * The deck's dialogs, one lazy chunk (the deck imports it the first time one opens): "Fenster lesen" with its list,
 * its preview and the phone's second sheet; the eject dialog (R3).
 */
import { useRecorderUI } from './state'
import { ReadWindow } from './ReadWindow'
import { EjectDialog } from './EjectDialog'
import './dialogs.css'

export { ReadWindow } from './ReadWindow'
export { PlanList } from './PlanList'
export { PlacePreview } from './PlacePreview'
export { DiffSheet } from './DiffSheet'
export { EjectDialog } from './EjectDialog'

/** Whatever dialog of the deck is open now. */
export default function RecorderDialogs() {
  const read = useRecorderUI((s) => !!s.read?.open)
  const eject = useRecorderUI((s) => !!s.plan?.open)
  return eject ? <EjectDialog /> : read ? <ReadWindow /> : null
}
