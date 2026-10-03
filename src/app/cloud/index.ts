/**
 * CLOUD AREA — public API (contract). Shell, editor and features import ONLY from this file.
 * Architecture and server protocol: docs/CLOUD.md.
 *
 * Without a server (the GitHub Pages build, or a server that is not reachable) everything reports
 * local mode: `available: false`, `acquireContentDoc()` returns null, REST helpers throw CloudError
 * with code 'unavailable'. The implementation lives in this folder; keep these names and shapes stable.
 */
import { create } from 'zustand'
import type * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

export interface CloudUser {
  id: string
  email: string
  name: string
}

export interface CloudWorkspace {
  id: string
  name: string
  icon: string | null
  role: Role
}

/** Which workspace this browser tab shows. 'local' = the browser-only workspace. */
export type WorkspaceRef = { kind: 'local'; id: 'local' } | { kind: 'cloud'; id: string }

export type CloudStatus =
  | 'local' // the local workspace is active (cloud may or may not be available)
  | 'checking' // boot: looking for a server / session
  | 'signed-out' // a cloud workspace is selected but there is no session
  | 'connecting' // loading / first sync of a cloud workspace
  | 'online' // connected and in sync
  | 'offline' // working from the local copy; changes sync when the connection is back
  | 'error' // fatal (e.g. removed from the workspace); `error` explains

export interface Peer {
  clientId: number
  userId: string
  name: string
  color: string
  /** The page this person is looking at (presence), if any. */
  pageId: string | null
}

export interface CloudState {
  /** A SimpleCMS One server answers on this origin (GET api/config). */
  available: boolean
  status: CloudStatus
  user: CloudUser | null
  workspaces: CloudWorkspace[]
  active: WorkspaceRef
  /** Role in the active cloud workspace (null in local mode). */
  role: Role | null
  /** Viewers (and a revoked membership) can't write. */
  readOnly: boolean
  /** Other people in the active workspace right now. */
  peers: Peer[]
  error: string | null
}

export class CloudError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const useCloud = create<CloudState>(() => ({
  available: false,
  status: 'local',
  user: null,
  workspaces: [],
  active: { kind: 'local', id: 'local' },
  role: null,
  readOnly: false,
  peers: [],
  error: null,
}))

/* ------------------------------------------------------------------ boot & selection */

/**
 * Called by main.tsx before the workspace is loaded. Detects the server, restores the active
 * workspace choice and the session. 'cloud' = the store will be filled from the cloud workspace
 * (the caller must not seed); 'signed-out' = show the sign-in screen; 'local' = load as before.
 */
export async function bootCloud(): Promise<'local' | 'cloud' | 'signed-out'> {
  return 'local'
}

export function activeWorkspace(): WorkspaceRef {
  return useCloud.getState().active
}

/** Remember the choice for this browser and reload the app into that workspace. */
export function switchWorkspace(ref: WorkspaceRef): void {
  void ref
}

/* ------------------------------------------------------------------ account */

export async function requestSignIn(email: string, opts?: { invite?: string; lang?: string }): Promise<void> {
  void email
  void opts
  throw unavailable()
}

export async function signOut(): Promise<void> {
  throw unavailable()
}

export async function updateProfile(name: string): Promise<void> {
  void name
  throw unavailable()
}

/* ------------------------------------------------------------------ workspaces, members, invites */

export interface Member {
  user: CloudUser
  role: Role
  created_at: number
}

export interface Invite {
  id: string
  role: Role
  email: string | null
  created_at: number
  expires_at: number
  /** Only present right after creation (the server stores a hash). */
  link?: string
}

export async function createWorkspace(name: string): Promise<CloudWorkspace> {
  void name
  throw unavailable()
}
export async function renameWorkspace(id: string, name: string): Promise<void> {
  void id
  void name
  throw unavailable()
}
export async function deleteWorkspace(id: string): Promise<void> {
  void id
  throw unavailable()
}
export async function listMembers(wsId: string): Promise<Member[]> {
  void wsId
  throw unavailable()
}
export async function setMemberRole(wsId: string, userId: string, role: Role): Promise<void> {
  void wsId
  void userId
  void role
  throw unavailable()
}
export async function removeMember(wsId: string, userId: string): Promise<void> {
  void wsId
  void userId
  throw unavailable()
}
export async function createInvite(wsId: string, role: Role, email?: string): Promise<Invite> {
  void wsId
  void role
  void email
  throw unavailable()
}
export async function listInvites(wsId: string): Promise<Invite[]> {
  void wsId
  throw unavailable()
}
export async function revokeInvite(wsId: string, inviteId: string): Promise<void> {
  void wsId
  void inviteId
  throw unavailable()
}
export async function previewInvite(token: string): Promise<{ workspace: { name: string }; role: Role; inviter: string | null }> {
  void token
  throw unavailable()
}
export async function acceptInvite(token: string): Promise<{ workspaceId: string }> {
  void token
  throw unavailable()
}

/**
 * Copy the browser's local workspace into a (new, empty) team workspace: pages, databases, rows,
 * content and files. Progress 0–1. The local workspace stays untouched.
 */
export async function uploadLocalWorkspace(wsId: string, onProgress?: (p: number) => void): Promise<void> {
  void wsId
  void onProgress
  throw unavailable()
}

/* ------------------------------------------------------------------ live collaboration (editor) */

export interface ContentDocHandle {
  /** The page's content document; the TipTap XmlFragment lives in `field`. */
  doc: Y.Doc
  provider: HocuspocusProvider
  field: 'default'
  /** This person's caret label and colour. */
  user: { name: string; color: string }
  readOnly: boolean
  /** Resolves when the local copy (IndexedDB) is loaded — render the editor after this. */
  ready: Promise<void>
}

/** The content document of a page in the active cloud workspace (ref-counted); null in local mode. */
export function acquireContentDoc(pageId: string): ContentDocHandle | null {
  void pageId
  return null
}

export function releaseContentDoc(pageId: string): void {
  void pageId
}

/** Tell the others which page this tab is looking at (presence). */
export function setPresencePage(pageId: string | null): void {
  void pageId
}

/** True while the store is being updated from the cloud (remote changes must not trigger automations). */
export function isApplyingCloudChange(): boolean {
  return false
}

function unavailable(): CloudError {
  return new CloudError('unavailable', 'No SimpleCMS One server is available here.')
}
