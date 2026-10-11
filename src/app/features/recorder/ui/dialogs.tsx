/**
 * The deck's dialogs, one lazy chunk (the deck imports it the first time one opens): "Fenster lesen" with its list,
 * its preview and the phone's second sheet. R3 adds the eject dialog here.
 */
import { useRecorderUI } from './state'
import { ReadWindow } from './ReadWindow'
import './dialogs.css'

export { ReadWindow } from './ReadWindow'
export { PlanList } from './PlanList'
export { PlacePreview } from './PlacePreview'
export { DiffSheet } from './DiffSheet'

/** Whatever dialog of the deck is open now. */
export default function RecorderDialogs() {
  const read = useRecorderUI((s) => !!s.read?.open)
  return read ? <ReadWindow /> : null
}
