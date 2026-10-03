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

export type ApiScope = 'read' | 'write'

export interface ApiTokenRow {
  id: string
  workspace_id: string
  name: string
  scope: ApiScope
  token_hash: string
  created_by: string | null
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

export interface WebhookRow {
  id: string
  workspace_id: string
  database_id: string
  secret_hash: string
  created_by: string | null
  created_at: number
  rotated_at: number | null
  last_delivery_at: number | null
  deliveries: number
}

/** API token secrets: "one_" + 43 URL-safe chars (32 random bytes). */
export const API_TOKEN_PREFIX = 'one_'
export const isApiTokenShape = (s: unknown): s is string => typeof s === 'string' && /^one_[A-Za-z0-9_-]{43}$/.test(s)

export const publicUser = (u: Pick<UserRow, 'id' | 'email' | 'name'>) => ({ id: u.id, email: u.email, name: u.name })

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

  /**
   * Upsert; silently skipped when the workspace is gone (a late debounced store after deletion) or the
   * document was deleted for good (a client that still had it open, or an offline copy syncing late).
   */
  saveDocument(name: string, workspaceId: string, data: Uint8Array): boolean {
    return (
      this.db.run(
        `INSERT INTO documents (name, workspace_id, data, updated_at)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
                            AND NOT EXISTS (SELECT 1 FROM document_tombstones WHERE name = ?)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        name, workspaceId, data, Date.now(), workspaceId, name,
      ) > 0
    )
  }

  /** Delete a document for good and remember that it is gone. True when stored data was removed. */
  deleteDocument(name: string, workspaceId: string, userId: string): boolean {
    return this.db.tx(() => {
      this.db.run(
        'INSERT INTO document_tombstones (name, workspace_id, deleted_at, deleted_by) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING',
        name, workspaceId, Date.now(), userId,
      )
      return this.db.run('DELETE FROM documents WHERE name = ? AND workspace_id = ?', name, workspaceId) > 0
    })
  }

  isDocumentDeleted(name: string): boolean {
    return !!this.db.get('SELECT 1 AS x FROM document_tombstones WHERE name = ?', name)
  }

  /** The page came back (undo, restored backup): its document may be stored again. */
  reviveDocument(name: string): void {
    this.db.run('DELETE FROM document_tombstones WHERE name = ?', name)
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

  // ── API tokens (docs/API.md) ─────────────────────────────────────────

  /** The secret is returned once and stored only as HMAC. */
  createApiToken(input: { workspaceId: string; name: string; scope: ApiScope; createdBy: string }): { token: string; row: ApiTokenRow } {
    const token = API_TOKEN_PREFIX + randomToken()
    const row: ApiTokenRow = {
      id: newId(),
      workspace_id: input.workspaceId,
      name: input.name,
      scope: input.scope,
      token_hash: this.hash(token),
      created_by: input.createdBy,
      created_at: Date.now(),
      last_used_at: null,
      revoked_at: null,
    }
    this.db.run(
      'INSERT INTO api_tokens (id, workspace_id, name, scope, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, row.workspace_id, row.name, row.scope, row.token_hash, row.created_by, row.created_at,
    )
    return { token, row }
  }

  /** Active (not revoked) tokens, newest first, with their creator. */
  apiTokens(workspaceId: string) {
    return this.db.all<ApiTokenRow & { creator_name: string | null; creator_email: string | null }>(
      `SELECT t.*, u.name AS creator_name, u.email AS creator_email FROM api_tokens t LEFT JOIN users u ON u.id = t.created_by
       WHERE t.workspace_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at DESC`,
      workspaceId,
    )
  }

  countApiTokens(workspaceId: string): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM api_tokens WHERE workspace_id = ? AND revoked_at IS NULL', workspaceId)?.n ?? 0
  }

  /** An active token of an existing workspace (HMAC lookup; the plain secret is never stored). */
  apiTokenBySecret(token: string): ApiTokenRow | undefined {
    return this.db.get<ApiTokenRow>(
      `SELECT t.* FROM api_tokens t JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
      this.hash(token),
    )
  }

  revokeApiToken(workspaceId: string, tokenId: string): boolean {
    return this.db.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL', Date.now(), tokenId, workspaceId) > 0
  }

  touchApiToken(tokenId: string, at = Date.now()) {
    this.db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', at, tokenId)
  }

  // ── incoming webhooks ────────────────────────────────────────────────

  createWebhook(input: { workspaceId: string; databaseId: string; createdBy: string }): { secret: string; row: WebhookRow } {
    const secret = randomToken()
    const row: WebhookRow = {
      id: newId(),
      workspace_id: input.workspaceId,
      database_id: input.databaseId,
      secret_hash: this.hash(secret),
      created_by: input.createdBy,
      created_at: Date.now(),
      rotated_at: null,
      last_delivery_at: null,
      deliveries: 0,
    }
    this.db.run(
      'INSERT INTO webhooks (id, workspace_id, database_id, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      row.id, row.workspace_id, row.database_id, row.secret_hash, row.created_by, row.created_at,
    )
    return { secret, row }
  }

  webhooks(workspaceId: string) {
    return this.db.all<WebhookRow & { creator_name: string | null; creator_email: string | null }>(
      `SELECT h.*, u.name AS creator_name, u.email AS creator_email FROM webhooks h LEFT JOIN users u ON u.id = h.created_by
       WHERE h.workspace_id = ? ORDER BY h.created_at DESC`,
      workspaceId,
    )
  }

  webhook(workspaceId: string, hookId: string) {
    return this.db.get<WebhookRow & { creator_name: string | null; creator_email: string | null }>(
      `SELECT h.*, u.name AS creator_name, u.email AS creator_email FROM webhooks h LEFT JOIN users u ON u.id = h.created_by
       WHERE h.workspace_id = ? AND h.id = ?`,
      workspaceId,
      hookId,
    )
  }

  countWebhooks(workspaceId: string): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM webhooks WHERE workspace_id = ?', workspaceId)?.n ?? 0
  }

  webhookBySecret(secret: string): WebhookRow | undefined {
    return this.db.get<WebhookRow>('SELECT h.* FROM webhooks h JOIN workspaces w ON w.id = h.workspace_id WHERE h.secret_hash = ?', this.hash(secret))
  }

  /** A new secret; the old URL stops working at once. */
  rotateWebhook(workspaceId: string, hookId: string): string | null {
    const secret = randomToken()
    const ok = this.db.run('UPDATE webhooks SET secret_hash = ?, rotated_at = ? WHERE id = ? AND workspace_id = ?', this.hash(secret), Date.now(), hookId, workspaceId) > 0
    return ok ? secret : null
  }

  deleteWebhook(workspaceId: string, hookId: string): boolean {
    return this.db.run('DELETE FROM webhooks WHERE id = ? AND workspace_id = ?', hookId, workspaceId) > 0
  }

  recordDelivery(hookId: string, at = Date.now()) {
    this.db.run('UPDATE webhooks SET deliveries = deliveries + 1, last_delivery_at = ? WHERE id = ?', at, hookId)
  }

  // ── idempotency (create requests, 24 h) ──────────────────────────────

  idempotent(scope: string, key: string, since: number) {
    return this.db.get<{ status: number; body: string }>('SELECT status, body FROM idempotency WHERE scope = ? AND key = ? AND created_at > ?', scope, key, since)
  }

  rememberIdempotent(scope: string, key: string, workspaceId: string, status: number, body: string) {
    this.db.run(
      `INSERT INTO idempotency (scope, key, workspace_id, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET status = excluded.status, body = excluded.body, created_at = excluded.created_at`,
      scope, key, workspaceId, status, body, Date.now(),
    )
  }

  // ── housekeeping ─────────────────────────────────────────────────────

  purgeExpired(now = Date.now()) {
    return {
      loginTokens: this.db.run('DELETE FROM login_tokens WHERE expires_at < ?', now - DAY),
      sessions: this.db.run('DELETE FROM sessions WHERE expires_at < ?', now),
      invites: this.db.run('DELETE FROM invites WHERE accepted_by IS NULL AND expires_at < ?', now - 30 * DAY),
      idempotency: this.db.run('DELETE FROM idempotency WHERE created_at < ?', now - DAY),
      // revoked tokens are kept a while for the audit trail (rows written by `api:<tokenId>`)
      apiTokens: this.db.run('DELETE FROM api_tokens WHERE revoked_at IS NOT NULL AND revoked_at < ?', now - 90 * DAY),
    }
  }
}
