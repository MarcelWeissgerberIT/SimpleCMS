/**
 * CLOUD AREA — public API (contract). Shell, editor and features import ONLY from this file.
 * Architecture and server protocol: docs/CLOUD.md.
 *
 * Without a server (the GitHub Pages build, or a server that is not reachable) everything reports
 * local mode: `available: false`, `acquireContentDoc()` returns null, REST helpers throw CloudError
 * with code 'unavailable'. The implementation lives in this folder; keep these names and shapes stable.
 *
 * Implementation map: boot.ts (server / session / choice) · workspace.ts (an open cloud workspace:
 * meta document, status, presence, close reasons) · binding.ts + schema.ts (store ⇄ meta document,
 * structural and unique_id repairs) · content.ts (page documents, store refresh, bridge, background
 * sync) · purge.ts (server documents of pages deleted for good) · files.ts (uploads, downloads) ·
 * upload.ts (local → team) · device.ts (this browser's copies: removing them) · account.ts + api.ts
 * (REST) · socket.ts (the one WebSocket) · private.ts + privacy.ts (Private pages).
 */
import {
  acceptInviteImpl,
  createInviteImpl,
  createSignupLinkImpl,
  createWorkspaceImpl,
  deleteWorkspaceImpl,
  listInvitesImpl,
  listMembersImpl,
  listSignupLinksImpl,
  previewInviteImpl,
  previewSignupLinkImpl,
  removeMemberImpl,
  renameWorkspaceImpl,
  removeDeviceCopyImpl,
  requestSignInImpl,
  revokeInviteImpl,
  revokeSignupLinkImpl,
  sendInvitesImpl,
  setMemberRoleImpl,
  signOutImpl,
  updateProfile as updateProfileImpl,
} from './account'
import { request } from './api'
import { bootCloud as bootCloudImpl, refreshMe, switchWorkspaceImpl } from './boot'
import { isApplyingCloud, withWriteActor } from './binding'
import { acquire, flushRefresh, release } from './content'
import { uploadLocalWorkspaceImpl } from './upload'
import { setPresencePageImpl } from './workspace'
import { createPrivateDatabaseImpl, createPrivatePageImpl, isPrivate, movePagePrivacyImpl, usePrivateModeImpl } from './private'
import type { NewDatabaseInput, NewPageInput } from '../store/store'
import type { ID } from '../store/types'
import { useUI } from '../store/ui'
import { navigate } from '../lib/router'
import {
  useCloud,
  type ContentDocHandle,
  type EmailInviteResult,
  type Invite,
  type InviteOptions,
  type InvitePreview,
  type Member,
  type Role,
  type CloudWorkspace,
  type SignupLink,
  type SignupPreview,
  type WorkspaceRef,
} from './state'

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
  type InviteOptions,
  type EmailInviteResult,
  type InvitePreview,
  type SignupLink,
  type SignupPreview,
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
 * its #/invite/<token>, a registration link its #/signup/<token>). `invite` / `signup`: the token the
 * person holds — lets a new address through an invite-only server. Errors: CloudError 'rate_limited'
 * (retryAfter seconds) · 'network' · …
 */
export async function requestSignIn(email: string, opts?: { invite?: string; signup?: string; lang?: string }): Promise<void> {
  return requestSignInImpl(email, opts)
}

/**
 * End the session. In a cloud workspace the tab switches back to the local workspace (reload).
 * `forgetDevice`: also remove every team workspace copy from this browser (shared computers) —
 * documents, cached files, history, this device's settings for them; the server keeps everything.
 */
export async function signOut(opts?: { forgetDevice?: boolean }): Promise<void> {
  return signOutImpl(opts)
}

/**
 * Remove this browser's copy of a team workspace: its documents, cached files (unless the local
 * workspace uses them), page history and this device's settings for it (incl. the AI key). The
 * team workspace on the server is untouched — opening it again downloads it afresh. Removing the
 * open workspace's copy switches this tab to the local workspace (reload); changes not yet on the
 * server are lost (see useCloudSync().unsynced / pendingUploads).
 */
export async function removeDeviceCopy(wsId: string): Promise<void> {
  return removeDeviceCopyImpl(wsId)
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
/**
 * An invite link (admins). With `email`: single use, for that address, and mailed. Without: a link —
 * `opts` makes it reusable (`maxUses` 1–100, member / viewer only), sets its validity (`days` 1–30,
 * default 7) and limits it to addresses at `domains`. The answer carries `link` (shown once).
 */
export async function createInvite(wsId: string, role: Role, email?: string, opts?: InviteOptions): Promise<Invite> {
  return createInviteImpl(wsId, role, email, opts)
}
/**
 * Invite several addresses at once (≤ 20): one single-use invite + mail each, in the app's language.
 * Per address: 'sent' · 'failed' (mail not sent; `link` to pass on by hand) · 'already_member' · 'invalid'.
 */
export async function sendInvites(wsId: string, emails: string[], role: Role, opts?: { days?: number }): Promise<EmailInviteResult[]> {
  return sendInvitesImpl(wsId, emails, role, opts)
}
export async function listInvites(wsId: string): Promise<Invite[]> {
  return listInvitesImpl(wsId)
}
export async function revokeInvite(wsId: string, inviteId: string): Promise<void> {
  return revokeInviteImpl(wsId, inviteId)
}
/**
 * `inviter` is a display name (or address); also `email` (email-bound invites), `expires_at`, `domains`
 * and — for the workspace's admins only — `places_left`. A dead link (unknown, expired, used up,
 * revoked) is CloudError 'invite_not_found' (admins: 'invite_used' / 'invite_expired').
 */
export async function previewInvite(token: string): Promise<InvitePreview> {
  return previewInviteImpl(token)
}
/** Also refreshes useCloud().workspaces. Then call switchWorkspace({ kind: 'cloud', id: workspaceId }). */
export async function acceptInvite(token: string): Promise<{ workspaceId: string; role?: Role }> {
  return acceptInviteImpl(token)
}

/**
 * Open the workspace page's People section (#/workspace/people, shell/workspace) at the invite form (the
 * Share dialog, the workspace menu). Admins of a team workspace only — elsewhere it just opens People.
 */
export function openInviteSettings(): void {
  wantInviteForm = true
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: 'people' })
}
let wantInviteForm = false
/** The invites block asks when it opens (holds for this tick: StrictMode runs effects twice). */
export function consumeInviteSettingsRequest(): boolean {
  if (!wantInviteForm) return false
  window.setTimeout(() => (wantInviteForm = false), 0)
  return true
}

/* ------------------------------------------------------------------ registration links (server admins) */

/*
 * A registration link lets someone create an account on a server that only admits invited addresses
 * (SIGNUP=invite / domains:…) — they get their own space, no membership. Server admins
 * (`useCloud().serverAdmin`, ADMIN_EMAILS on the server) create, list and revoke them; anyone else gets
 * CloudError 'server_admin_only'. On a SIGNUP=open server creating one is 'signup_open' (no link needed).
 */

/** Open links (places left, not expired), newest first. */
export async function listSignupLinks(): Promise<SignupLink[]> {
  return listSignupLinksImpl()
}
/** A new link (`maxUses` 1–100, `days` 1–30, optional `domains`, `label`); `link` is in the answer only. */
export async function createSignupLink(opts: InviteOptions & { label?: string }): Promise<SignupLink> {
  return createSignupLinkImpl(opts)
}
export async function revokeSignupLink(id: string): Promise<void> {
  return revokeSignupLinkImpl(id)
}
/**
 * What #/signup/<token> shows. A dead link is CloudError 'signup_link_not_found' (server admins:
 * 'signup_link_used' / 'signup_link_expired'). Then `requestSignIn(email, { signup: token })`.
 */
export async function previewSignupLink(token: string): Promise<SignupPreview> {
  return previewSignupLinkImpl(token)
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
 * The page's content as its open document holds it, in the store right away (team: the store otherwise catches up a
 * moment after an editor change). For a writer that changed the page's open editor and reads the store next; a no-op
 * in local mode or with nothing pending.
 */
export function flushPageContent(pageId: string): void {
  flushRefresh(pageId)
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

/* ------------------------------------------------------------------ private pages */

/*
 * Team workspaces have a "Private" section next to the workspace's pages: pages only this member can
 * see (docs/CLOUD.md § Private pages — the server enforces it). Subpages, databases and rows below a
 * private page are private too; such pages carry `page.private` in the store. Search, graph, agent,
 * inbox and exports only ever see what the store holds, so everyone else never gets them at all.
 */

/** Which private-pages UI fits: 'none' (local workspace, signed out), 'read' (viewers), 'write'. */
export function usePrivateMode(): 'none' | 'read' | 'write' {
  return usePrivateModeImpl()
}

/** Is this page in my Private section? */
export function isPrivatePage(pageId: ID | null | undefined): boolean {
  return isPrivate(pageId)
}

/** A new page in my Private section (`parentId` only when it is a private page). CloudError 'forbidden' for viewers / local. */
export function createPrivatePage(input?: NewPageInput): ID {
  return createPrivatePageImpl(input)
}

/** A new database in my Private section. */
export function createPrivateDatabase(input?: NewDatabaseInput): ID {
  return createPrivateDatabaseImpl(input)
}

/**
 * Move a page — with its subpages, databases and rows — into my Private section (`toPrivate`) or
 * into the workspace (everyone sees it then: ask first), under `target.parentId` (a page of that
 * scope; null = the section's root) at `target.index`. Ids stay, so links keep working. Needs a
 * connection. CloudError: 'offline' · 'timeout' · 'busy' · 'forbidden' · 'not_found' · 'invalid_request'.
 */
export async function movePagePrivacy(pageId: ID, toPrivate: boolean, target?: { parentId?: ID | null; index?: number }): Promise<void> {
  return movePagePrivacyImpl(pageId, toPrivate, target)
}

/* ------------------------------------------------------------------ REST (team settings extras) */

/**
 * A JSON request to the team server for the active session (`path` relative to the app base, e.g.
 * 'api/workspaces/<id>/tokens'): same origin, session cookie, the CSRF content type. Failures are
 * CloudError with the server's code (docs/CLOUD.md), like every call above.
 */
export function cloudRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body)
}

/**
 * Custom agents (features/agents): the page writes made while `fn` runs are stamped `agent:<agentId>`
 * (createdBy / updatedBy in the meta document) instead of the member's account id. Only `agent:` ids.
 */
export function writeAsAgent<T>(actor: string, fn: () => Promise<T> | T): Promise<T> {
  return withWriteActor(actor, fn)
}
