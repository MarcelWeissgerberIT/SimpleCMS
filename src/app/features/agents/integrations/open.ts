/**
 * Open Workspace → Integrations (#/workspace/integrations) from the features area (closes a dialog and the palette
 * first). `profileId`: that profile's row is brought into view and takes the keyboard (its first key — Edit / View);
 * the Patchbay's setup lamp 03 uses it.
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'
import { focusIsNowhere, focusNear } from '../../../ui/focus'

/** How long the opener waits for the section to show the row. */
const WAIT_MS = 2500

export function openIntegrations(profileId?: string): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  const from = document.activeElement
  navigate({ name: 'workspace', section: 'integrations' })
  if (profileId) focusProfile(profileId, from)
}

/** The profile's row, once the section shows it — only while nobody else took the keyboard meanwhile. */
function focusProfile(id: string, from: Element | null): void {
  const until = performance.now() + WAIT_MS
  const tick = () => {
    const row = document.querySelector<HTMLElement>(`.int-row[data-id="${CSS.escape(id)}"]`)
    if (!row) {
      if (performance.now() < until) requestAnimationFrame(tick)
      return
    }
    const a = document.activeElement
    if (!focusIsNowhere(a) && a !== from) return
    row.scrollIntoView({ block: 'center' })
    focusNear(row)
  }
  requestAnimationFrame(tick)
}
