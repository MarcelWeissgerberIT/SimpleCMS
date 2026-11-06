/** Open Settings on the Coding worker tab (SettingsModal asks once when it opens). */
import { useUI } from '../../store/ui'

let requested = false

export function openCodingSettings() {
  requested = true
  useUI.getState().openModal({ type: 'settings', tab: 'coding' })
}

export function consumeCodingSettingsRequest(): boolean {
  const r = requested
  requested = false
  return r
}
