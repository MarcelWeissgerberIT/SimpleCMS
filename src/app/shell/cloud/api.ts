/**
 * The cloud calls the team UI makes, gathered in one object. In production this is exactly the
 * cloud area's public API (src/app/cloud/index.ts). Dev builds and `?e2e` pages may swap single
 * calls for screenshots and UI tests without a server: window.__oneCloud.mock({ listMembers: … }).
 */
import {
  CloudError,
  acceptInvite,
  createInvite,
  createWorkspace,
  deleteWorkspace,
  listInvites,
  listMembers,
  previewInvite,
  removeDeviceCopy,
  removeMember,
  renameWorkspace,
  requestSignIn,
  revokeInvite,
  setMemberRole,
  signOut,
  switchWorkspace,
  updateProfile,
  uploadLocalWorkspace,
  useCloud,
} from '../../cloud'

export const cloudApi = {
  requestSignIn,
  signOut,
  updateProfile,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  listMembers,
  setMemberRole,
  removeMember,
  createInvite,
  listInvites,
  revokeInvite,
  previewInvite,
  acceptInvite,
  uploadLocalWorkspace,
  switchWorkspace,
  removeDeviceCopy,
}

export type CloudApi = typeof cloudApi

/** Dev / ?e2e only: render any cloud state by hand (see the file header). */
export function installCloudDevHook(): void {
  if (typeof window === 'undefined') return
  const on = import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  if (!on) return
  ;(window as unknown as { __oneCloud?: unknown }).__oneCloud = {
    state: useCloud,
    CloudError,
    set: (patch: Partial<ReturnType<typeof useCloud.getState>>) => useCloud.setState(patch),
    mock: (over: Partial<CloudApi>) => Object.assign(cloudApi, over),
  }
}
