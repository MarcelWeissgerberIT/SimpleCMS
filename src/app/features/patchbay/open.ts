/**
 * The one way to open the Patchbay (⌘K, Workspace › Automation's links, Preflight's lamp, hint lines, the return chip):
 * a dialog, the palette and the phone drawer close first, then #/patchbay with what it should show. Tiny and eager.
 */
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'

export interface OpenPatchbayOptions {
  /** focus this module (ref.ts moduleKey) */
  m?: string
  /** select this fuse (its path key) */
  f?: string
  /** open this integration profile's setup */
  setup?: string
}

export function openPatchbay(opts: OpenPatchbayOptions = {}): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'patchbay', ...(opts.m ? { m: opts.m } : {}), ...(opts.f ? { f: opts.f } : {}), ...(opts.setup ? { setup: opts.setup } : {}) })
}
