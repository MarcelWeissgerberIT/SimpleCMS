/**
 * The workspace page (#/workspace, #/workspace/<section>): one place for what belongs to the workspace —
 * its name and numbers, people and members, building blocks, automation, data, the danger zone. Settings
 * (the modal) is this device and your account.
 */
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'

export const WORKSPACE_SECTIONS = ['overview', 'people', 'blocks', 'automation', 'data', 'danger'] as const
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]

export const isWorkspaceSection = (v: unknown): v is WorkspaceSection => typeof v === 'string' && (WORKSPACE_SECTIONS as readonly string[]).includes(v)

/** Open the workspace page on a section (closes a dialog, the palette and the phone drawer first). */
export function openWorkspaceSettings(section: WorkspaceSection = 'overview'): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: section === 'overview' ? undefined : section })
}
