/**
 * CLOUD AREA — public API (contract). Shell, editor and features import ONLY from this file.
 * Architecture and server protocol: docs/CLOUD.md.
 *
 * Without a server (the GitHub Pages build, or a server that is not reachable) everything reports
 * local mode: `available: false`, `acquireContentDoc()` returns null, REST helpers throw CloudError
 * with code 'unavailable'. The implementation lives in this folder; keep these names and shapes stable.
 *
 * Implementation map: boot.ts (server / session / choice) · workspace.ts (an open cloud workspace:
 * meta document, status, presence, close reasons) · binding.ts + schema.ts (store ⇄ meta document)
 * · content.ts (page documents, store refresh, bridge, background sync) · files.ts (uploads,
 * downloads) · upload.ts (local → team) · account.ts + api.ts (REST) · socket.ts (the one WebSocket).
 */
import {
  acceptInviteImpl,
  createInviteImpl,
  createWorkspaceImpl,
  deleteWorkspaceImpl,
  listInvitesImpl,
  listMembersImpl,
  previewInviteImpl,
  removeMemberImpl,
  renameWorkspaceImpl,
  requestSignInImpl,
  revokeInviteImpl,
  setMemberRoleImpl,
  signOutImpl,
  updateProfile as updateProfileImpl,
} from './account'
import { bootCloud as bootCloudImpl, refreshMe, switchWorkspaceImpl } from './boot'
import { isApplyingCloud } from './binding'
import { acquire, release } from './content'
import { uploadLocalWorkspaceImpl } from './upload'
import { setPresencePageImpl } from './workspace'
import { useCloud, type ContentDocHandle, type Invite, type InvitePreview, type Member, type Role, type CloudWorkspace, type WorkspaceRef } from './state'

export {
  CloudError,
  useCloud,
  useCloudSync,
  type Role,
  type CloudUser,
  type CloudWorkspace,
  type WorkspaceRef,
  type CloudStatus,
  type Peer,
  type CloudState,
  type CloudSyncState,
  type Member,
  type Invite,
  type InvitePreview,
  type ContentDocHandle,
} from './state'

/* ------------------------------------------------------------------ boot & selection */

/**
 * Called by main.tsx before the workspace is loaded. Detects the server, restores the active
 * workspace choice and the session. 'cloud' = the store has been filled from the cloud workspace's
 * local copy and syncs in the background (the caller must not seed or start local persistence);
 * 'signed-out' = the store holds an empty, unsaved workspace — show the sign-in screen;
 * 'local' = load as before.
 */
export async function bootCloud(): Promise<'local' | 'cloud' | 'signed-out'> {
  return bootCloudImpl()
}

export function activeWorkspace(): WorkspaceRef {
  return useCloud.getState().active
}

/** Remember the choice for this browser and reload the app into that workspace (drops `?w=` and the route). */
export function switchWorkspace(ref: WorkspaceRef): void {
  switchWorkspaceImpl(ref)
}

/** Ask the server again who is signed in (user + workspaces in useCloud). Null when signed out. */
export function refreshAccount(): Promise<unknown> {
  return refreshMe()
}

/* ------------------------------------------------------------------ account */

/**
 * Send a magic link. The link brings the person back to the current view (an invite link keeps
 * its #/invite/<token>). Errors: CloudError 'rate_limited' (retryAfter seconds) · 'network' · …
 */
export async function requestSignIn(email: string, opts?: { invite?: string; lang?: string }): Promise<void> {
  return requestSignInImpl(email, opts)
}

/** End the session. In a cloud workspace the tab switches back to the local workspace (reload). */
export async function signOut(): Promise<void> {
  return signOutImpl()
}

export async function updateProfile(name: string): Promise<void> {
  await updateProfileImpl(name)
}

/* ------------------------------------------------------------------ workspaces, members, invites */

export async function createWorkspace(name: string): Promise<CloudWorkspace> {
  return createWorkspaceImpl(name)
}
/** Renames on the server and (for the open workspace) in the meta document. */
export async function renameWorkspace(id: string, name: string): Promise<void> {
  return renameWorkspaceImpl(id, name)
}
/** Owner only. Deleting the open workspace switches this tab to the local workspace. */
export async function deleteWorkspace(id: string): Promise<void> {
  return deleteWorkspaceImpl(id)
}
export async function listMembers(wsId: string): Promise<Member[]> {
  return listMembersImpl(wsId)
}
export async function setMemberRole(wsId: string, userId: string, role: Role): Promise<void> {
  return setMemberRoleImpl(wsId, userId, role)
}
/** Removing yourself = leaving; leaving the open workspace switches this tab to the local one. */
export async function removeMember(wsId: string, userId: string): Promise<void> {
  return removeMemberImpl(wsId, userId)
}
export async function createInvite(wsId: string, role: Role, email?: string): Promise<Invite> {
  return createInviteImpl(wsId, role, email)
}
export async function listInvites(wsId: string): Promise<Invite[]> {
  return listInvitesImpl(wsId)
}
export async function revokeInvite(wsId: string, inviteId: string): Promise<void> {
  return revokeInviteImpl(wsId, inviteId)
}
/** `inviter` is a display name (or address); also `email` (email-bound invites) and `expires_at`. */
export async function previewInvite(token: string): Promise<InvitePreview> {
  return previewInviteImpl(token)
}
/** Also refreshes useCloud().workspaces. Then call switchWorkspace({ kind: 'cloud', id: workspaceId }). */
export async function acceptInvite(token: string): Promise<{ workspaceId: string; role?: Role }> {
  return acceptInviteImpl(token)
}

/**
 * Copy the browser's local workspace into a (new, empty) team workspace: pages, databases, rows,
 * content, comments and files. Progress 0–1. The local workspace stays untouched.
 * Errors: CloudError 'workspace_not_empty' (409) · 'forbidden' (viewer) · 'network' · …
 */
export async function uploadLocalWorkspace(wsId: string, onProgress?: (p: number) => void): Promise<void> {
  return uploadLocalWorkspaceImpl(wsId, onProgress)
}

/* ------------------------------------------------------------------ live collaboration (editor) */

/** The content document of a page in the active cloud workspace (ref-counted); null in local mode. */
export function acquireContentDoc(pageId: string): ContentDocHandle | null {
  return acquire(pageId)
}

export function releaseContentDoc(pageId: string): void {
  release(pageId)
}

/**
 * Tell the others which page this tab is looking at (presence). The cloud area already follows
 * the route (#/p/<id>); call this only to override it.
 */
export function setPresencePage(pageId: string | null): void {
  setPresencePageImpl(pageId)
}

/** True while the store is being updated from the cloud (remote changes must not trigger automations). */
export function isApplyingCloudChange(): boolean {
  return isApplyingCloud()
}
