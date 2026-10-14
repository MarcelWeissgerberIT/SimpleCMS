/**
 * Open Workspace → Integrations (#/workspace/integrations) from the features area (closes a dialog and the palette
 * first). `profileId`: that profile focused there — taken from B11 on (the Patchbay's setup lamp 03); until then the
 * section opens as before.
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'

export function openIntegrations(profileId?: string): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: 'integrations' })
}
