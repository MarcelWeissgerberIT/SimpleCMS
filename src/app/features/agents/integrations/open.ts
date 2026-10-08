/** Open Workspace → Integrations (#/workspace/integrations) from the features area (closes a dialog and the palette first). */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'

export function openIntegrations(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: 'integrations' })
}
