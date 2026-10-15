/**
 * MCP · Connections (#/mcp) — the opener. Tiny and eager (the page itself is a lazy chunk, route.tsx): Settings' links,
 * ⌘K, the Preflight Token lamp, What's new and the Patchbay's setup lamp 02 call it.
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'
import { canFocus, focusIsNowhere, focusNear } from '../../../ui/focus'

export interface McpConnectionsOptions {
  /** that server's row (One's Claude's servers, by id) */
  server?: string
  /** the key to focus in that row: 'test' = its Test key (the Patchbay's lamp 02 — the lamp never runs a test itself) */
  focus?: 'test'
}

/** How long the opener waits for the page (a lazy chunk) to show the row. */
const WAIT_MS = 2500

/**
 * Open MCP · Connections; a dialog, the palette and the phone drawer close first. `server`: that server's row is brought
 * into view and takes the keyboard — its Test key with `focus: 'test'` (the key only; pressing it is the person's), else
 * the row's first key. Only while nobody else has taken the keyboard (the page's own title, the body, the key pressed to
 * get here): a click elsewhere in the meantime wins.
 */
export function openMcpConnections(opts: McpConnectionsOptions = {}): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  const from = document.activeElement
  navigate({ name: 'mcp' })
  if (opts.server) focusRow(opts.server, opts.focus, from)
}

function focusRow(id: string, focus: McpConnectionsOptions['focus'], from: Element | null): void {
  const until = performance.now() + WAIT_MS
  const free = () => {
    const a = document.activeElement
    return focusIsNowhere(a) || a === from || !!a?.matches('.mcpc__title')
  }
  const tick = () => {
    const row = document.querySelector<HTMLElement>(`.mcpc-row[data-row="one"][data-id="${CSS.escape(id)}"]`)
    if (!row) {
      if (performance.now() < until) requestAnimationFrame(tick)
      return
    }
    if (!free()) return
    row.scrollIntoView({ block: 'center' })
    const key = focus === 'test' ? row.querySelector<HTMLElement>('[data-testid="mcpc-test"]') : null
    if (key && canFocus(key)) key.focus({ preventScroll: true })
    else focusNear(row)
  }
  requestAnimationFrame(tick)
}
