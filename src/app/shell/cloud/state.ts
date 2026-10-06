/**
 * Shell-side state of the team cloud UI: which cloud dialog is open and small selectors over
 * useCloud() the shell shares. (Members, invites and the rest of "Team" are on the workspace page,
 * shell/workspace — openWorkspaceSettings('people').)
 */
import { create } from 'zustand'
import { useCloud, type Role } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { Translate } from '@/shared/i18n'

export type CloudDialog = 'new-workspace' | 'sign-in' | 'sign-out'

export const useCloudUI = create<{ dialog: CloudDialog | null }>(() => ({ dialog: null }))

export function openCloudDialog(dialog: CloudDialog): void {
  const ui = useUI.getState()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  if (ui.modal) ui.closeModal()
  useCloudUI.setState({ dialog })
}

export function closeCloudDialog(): void {
  useCloudUI.setState({ dialog: null })
}

/* ------------------------------------------------------------------ selectors */

/** Viewers (and a revoked membership) can't write: creation actions hide. */
export const useReadOnly = () => useCloud((s) => s.readOnly)
export const isReadOnly = () => useCloud.getState().readOnly

export const useInCloud = () => useCloud((s) => s.active.kind === 'cloud')

/** Name of the active workspace: the cloud workspace's, or the local setting. */
export function useWorkspaceTitle(): string {
  const cloudName = useCloud((s) => (s.active.kind === 'cloud' ? (s.workspaces.find((w) => w.id === s.active.id)?.name ?? null) : null))
  const localName = useWorkspace((s) => s.settings.workspaceName)
  return cloudName ?? (localName || 'One')
}

export function roleLabel(t: Translate, role: Role | null | undefined): string {
  return role ? t(`shell.cloud.role.${role}`) : ''
}

export const canAdmin = (role: Role | null | undefined) => role === 'owner' || role === 'admin'
