/**
 * MCP · Connections (#/mcp) — the opener. Tiny and eager (the page itself is a lazy chunk, route.tsx): Settings' links,
 * ⌘K, the Preflight Token lamp and What's new call it.
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'

/** Open MCP · Connections; a dialog, the palette and the phone drawer close first. */
export function openMcpConnections(): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'mcp' })
}
