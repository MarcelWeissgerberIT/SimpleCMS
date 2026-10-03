/**
 * Cloud area — shared types and state. index.ts re-exports everything public from here; the
 * implementation files import from here (never from index.ts) so there are no import cycles.
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
  /** A CSS colour (a token, e.g. `var(--c-blue-text)`) — the person's caret / avatar colour. */
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
  /**
   * Why the cloud workspace stopped (status 'error' / 'signed-out'), or the last boot problem:
   * 'membership-revoked' · 'workspace-deleted' · 'session-ended' · 'workspace_not_found' · 'forbidden' …
   */
  error: string | null
}

export class CloudError extends Error {
  code: string
  status: number
  /** 429 only: seconds until the next attempt may succeed (Retry-After). */
  retryAfter?: number
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

/**
 * Sync details for status UIs (optional): changes not yet confirmed by the server, files waiting
 * for upload and uploads that were refused (too large, no permission).
 */
export interface CloudSyncState {
  /** Local changes the server has not confirmed yet (meta document or any open page). */
  unsynced: boolean
  /** Files saved on this device that still have to reach the server. */
  pendingUploads: number
  /** Uploads the server refused for good (code: 'file_too_large' | 'forbidden' | …). */
  failedUploads: Array<{ id: string; name: string; code: string }>
  /** Server limits from GET api/config (null until known). */
  maxUploadMb: number | null
}

export const useCloudSync = create<CloudSyncState>(() => ({
  unsynced: false,
  pendingUploads: 0,
  failedUploads: [],
  maxUploadMb: null,
}))

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
  /** Who created it (list only; null when that account is gone). */
  inviter?: { id: string; name: string; email: string } | null
  /** Create only: whether the server sent the invitation mail. */
  email_sent?: boolean
}

export interface InvitePreview {
  workspace: { name: string; icon?: unknown }
  role: Role
  /** Name (or address) of the person who invited. */
  inviter: string | null
  /** Email-bound invites: the address that may accept it. */
  email?: string | null
  expires_at?: number
}

export interface ContentDocHandle {
  /** The page's content document; the TipTap XmlFragment lives in `field`. */
  doc: Y.Doc
  provider: HocuspocusProvider
  field: 'default'
  /** This person's caret label and colour (`color` is a CSS colour, see Peer.color). */
  user: { name: string; color: string }
  readOnly: boolean
  /** Resolves when the local copy (IndexedDB) is loaded — render the editor after this. */
  ready: Promise<void>
}

export function unavailable(): CloudError {
  return new CloudError('unavailable', 'No SimpleCMS One server is available here.')
}
