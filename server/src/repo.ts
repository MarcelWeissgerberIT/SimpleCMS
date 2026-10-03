import type { Db } from './db/index.ts'
import { DAY, hashToken, iso, newId, randomToken } from './tokens.ts'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'
export type InviteRole = Exclude<Role, 'owner'>
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }
export const atLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min]

export const INVITE_TTL = 7 * DAY

export interface UserRow {
  id: string
  email: string
  name: string | null
  created_at: number
  last_seen_at: number | null
}

export interface WorkspaceRow {
  id: string
  name: string
  icon: string | null
  created_at: number
  created_by: string | null
  plan: string
}

export interface InviteRow {
  id: string
  token_hash: string
  workspace_id: string
  role: InviteRole
  email: string | null
  created_by: string | null
  created_at: number
  expires_at: number
  accepted_by: string | null
  accepted_at: number | null
}

export interface FileRow {
  id: string
  workspace_id: string
  name: string
  mime: string
  size: number
  sha256: string
  created_by: string | null
  created_at: number
}

export const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name })

export const publicWorkspace = (w: WorkspaceRow, role: Role) => ({
  id: w.id,
  name: w.name,
  icon: parseJson(w.icon),
  role,
  plan: w.plan,
  created_at: iso(w.created_at),
})

function parseJson(s: string | null): unknown {
  if (s == null) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** All SQL lives here, so routes, collab and the CLI share one vocabulary. */
export class Repo {
  readonly db: Db
  private readonly secret: Buffer

  constructor(db: Db, secret: Buffer) {
    this.db = db
    this.secret = secret
  }

  hash(token: string): string {
    return hashToken(this.secret, token)
  }

  // ── users ────────────────────────────────────────────────────────────

  userById(id: string) {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)
  }

  userByEmail(email: string) {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', normalizeEmail(email))
  }

  createUser(email: string, name: string | null = null): UserRow {
    const user: UserRow = { id: newId(), email: normalizeEmail(email), name, created_at: Date.now(), last_seen_at: null }
    this.db.run('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)', user.id, user.email, user.name, user.created_at)
    return user
  }

  findOrCreateUser(email: string): { user: UserRow; created: boolean } {
    return this.db.tx(() => {
      const existing = this.userByEmail(email)
      return existing ? { user: existing, created: false } : { user: this.createUser(email), created: true }
    })
  }

  setUserName(id: string, name: string | null) {
    this.db.run('UPDATE users SET name = ? WHERE id = ?', name, id)
  }

  // ── workspaces & members ─────────────────────────────────────────────

  workspaceById(id: string) {
    return this.db.get<WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?', id)
  }

  workspacesForUser(userId: string) {
    return this.db.all<WorkspaceRow & { role: Role }>(
      `SELECT w.*, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.created_at`,
      userId,
    )
  }

  countWorkspacesCreatedSince(userId: string, since: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workspaces WHERE created_by = ? AND created_at > ?', userId, since)?.n ?? 0
  }

  createWorkspace(userId: string, name: string, icon: unknown): WorkspaceRow {
    const ws: WorkspaceRow = {
      id: newId(),
      name,
      icon: icon == null ? null : JSON.stringify(icon),
      created_at: Date.now(),
      created_by: userId,
      plan: 'free',
    }
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO workspaces (id, name, icon, created_at, created_by, plan) VALUES (?, ?, ?, ?, ?, ?)',
        ws.id, ws.name, ws.icon, ws.created_at, ws.created_by, ws.plan,
      )
      this.addMember(ws.id, userId, 'owner')
    })
    return ws
  }

  updateWorkspace(id: string, patch: { name?: string; icon?: unknown }) {
    if (patch.name !== undefined) this.db.run('UPDATE workspaces SET name = ? WHERE id = ?', patch.name, id)
    if (patch.icon !== undefined) this.db.run('UPDATE workspaces SET icon = ? WHERE id = ?', patch.icon == null ? null : JSON.stringify(patch.icon), id)
  }

  /** Members, invites, documents and file rows go with it (ON DELETE CASCADE). */
  deleteWorkspace(id: string) {
    this.db.run('DELETE FROM workspaces WHERE id = ?', id)
  }

  memberRole(workspaceId: string, userId: string): Role | undefined {
    return this.db.get<{ role: Role }>('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId)?.role
  }

  members(workspaceId: string) {
    return this.db.all<UserRow & { role: Role; member_since: number }>(
      `SELECT u.*, m.role, m.created_at AS member_since FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.created_at`,
      workspaceId,
    )
  }

  addMember(workspaceId: string, userId: string, role: Role) {
    this.db.run('INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', workspaceId, userId, role, Date.now())
  }

  setRole(workspaceId: string, userId: string, role: Exclude<Role, 'owner'>) {
    this.db.run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, workspaceId, userId)
  }

  /** The current owner becomes admin; the target (added if needed) becomes the one owner. */
  transferOwnership(workspaceId: string, toUserId: string) {
    this.db.tx(() => {
      this.db.run("UPDATE members SET role = 'admin' WHERE workspace_id = ? AND role = 'owner'", workspaceId)
      if (this.memberRole(workspaceId, toUserId)) this.db.run("UPDATE members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?", workspaceId, toUserId)
      else this.addMember(workspaceId, toUserId, 'owner')
    })
  }

  ownerOf(workspaceId: string) {
    return this.db.get<UserRow>(
      "SELECT u.* FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner'",
      workspaceId,
    )
  }

  removeMember(workspaceId: string, userId: string) {
    this.db.run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId)
  }

  // ── invites ──────────────────────────────────────────────────────────

  createInvite(input: { workspaceId: string; role: InviteRole; email: string | null; createdBy: string }) {
    const token = randomToken()
    const now = Date.now()
    const row: InviteRow = {
      id: newId(),
      token_hash: this.hash(token),
      workspace_id: input.workspaceId,
      role: input.role,
      email: input.email ? normalizeEmail(input.email) : null,
      created_by: input.createdBy,
      created_at: now,
      expires_at: now + INVITE_TTL,
      accepted_by: null,
      accepted_at: null,
    }
    this.db.run(
      `INSERT INTO invites (id, token_hash, workspace_id, role, email, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.token_hash, row.workspace_id, row.role, row.email, row.created_by, row.created_at, row.expires_at,
    )
    return { token, row }
  }

  countInvitesSince(workspaceId: string, since: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invites WHERE workspace_id = ? AND created_at > ?', workspaceId, since)?.n ?? 0
  }

  openInvites(workspaceId: string) {
    return this.db.all<InviteRow & { inviter_name: string | null; inviter_email: string | null }>(
      `SELECT i.*, u.name AS inviter_name, u.email AS inviter_email FROM invites i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.workspace_id = ? AND i.accepted_by IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`,
      workspaceId,
      Date.now(),
    )
  }

  inviteByToken(token: string) {
    return this.db.get<InviteRow>('SELECT * FROM invites WHERE token_hash = ?', this.hash(token))
  }

  inviteByHash(hash: string) {
    return this.db.get<InviteRow>('SELECT * FROM invites WHERE token_hash = ?', hash)
  }

  deleteInvite(workspaceId: string, inviteId: string): boolean {
    return this.db.run('DELETE FROM invites WHERE id = ? AND workspace_id = ?', inviteId, workspaceId) > 0
  }

  hasOpenInviteForEmail(email: string): boolean {
    return !!this.db.get(
      'SELECT 1 FROM invites WHERE email = ? AND accepted_by IS NULL AND expires_at > ? LIMIT 1',
      normalizeEmail(email),
      Date.now(),
    )
  }

  /** Marks the invite used; returns false when someone else got there first. */
  consumeInvite(inviteId: string, userId: string): boolean {
    return this.db.run('UPDATE invites SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_by IS NULL', userId, Date.now(), inviteId) > 0
  }

  // ── Yjs documents ────────────────────────────────────────────────────

  loadDocument(name: string): Uint8Array | undefined {
    return this.db.get<{ data: Uint8Array }>('SELECT data FROM documents WHERE name = ?', name)?.data
  }

  /** Upsert; silently skipped when the workspace is gone (a late debounced store after deletion). */
  saveDocument(name: string, workspaceId: string, data: Uint8Array): boolean {
    return (
      this.db.run(
        `INSERT INTO documents (name, workspace_id, data, updated_at)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        name, workspaceId, data, Date.now(), workspaceId,
      ) > 0
    )
  }

  // ── files ────────────────────────────────────────────────────────────

  file(workspaceId: string, id: string) {
    return this.db.get<FileRow>('SELECT * FROM files WHERE workspace_id = ? AND id = ?', workspaceId, id)
  }

  insertFile(row: FileRow): boolean {
    return (
      this.db.run(
        `INSERT INTO files (id, workspace_id, name, mime, size, sha256, created_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
         ON CONFLICT DO NOTHING`,
        row.id, row.workspace_id, row.name, row.mime, row.size, row.sha256, row.created_by, row.created_at, row.workspace_id,
      ) > 0
    )
  }

  // ── housekeeping ─────────────────────────────────────────────────────

  purgeExpired(now = Date.now()) {
    return {
      loginTokens: this.db.run('DELETE FROM login_tokens WHERE expires_at < ?', now - DAY),
      sessions: this.db.run('DELETE FROM sessions WHERE expires_at < ?', now),
      invites: this.db.run('DELETE FROM invites WHERE accepted_by IS NULL AND expires_at < ?', now - 30 * DAY),
    }
  }
}
