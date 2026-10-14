/**
 * MCP · Connections (#/mcp) — the opener. Tiny and eager (the page itself is a lazy chunk, route.tsx): Settings' links,
 * ⌘K, the Preflight Token lamp, What's new and the Patchbay's setup lamp 02 call it.
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'

export interface McpConnectionsOptions {
  /** that server's row (One's Claude's servers, by id) */
  server?: string
  /** the key to focus in that row: 'test' = its Test key (the Patchbay's lamp 02 — the lamp never runs a test itself) */
  focus?: 'test'
}

/**
 * Open MCP · Connections; a dialog, the palette and the phone drawer close first. `opts` (a server's row, its Test key
 * focused) is taken from B11 on (Patchbay setup lamps); until then the page opens as before.
 */
export function openMcpConnections(opts: McpConnectionsOptions = {}): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'mcp' })
}
