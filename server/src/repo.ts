import { docContext, fileNameContext, idempotencyContext, isSealedText, open, openText, seal, sealText, type WorkspaceKey } from './crypto/aead.ts'
import type { Keyring } from './crypto/keyring.ts'
import type { Db } from './db/index.ts'
import { DAY, hashToken, iso, newId, randomToken } from './tokens.ts'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'
export type InviteRole = Exclude<Role, 'owner'>
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }
export const atLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min]

export const INVITE_TTL = 7 * DAY
/** Reusable links: at most this many people per invite / registration link. */
export const MAX_LINK_USES = 100

export interface UserRow {
  id: string
  email: string
  name: string | null
  created_at: number
  last_seen_at: number | null
  /** When this person's own workspace was created (null: not yet — at their next sign-in). */
  personal_space_at?: number | null
}

export interface WorkspaceRow {
  id: string
  name: string
  icon: string | null
  created_at: number
  created_by: string | null
  plan: string
  /** The user whose personal workspace this is (created at their first sign-in), else null. */
  personal_of: string | null
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
  /** The latest person who joined through it (and when). */
  accepted_by: string | null
  accepted_at: number | null
  /** How many people may join through it (1 = single use) and how many did. */
  max_uses: number
  uses: number
  /** Comma-separated domains the joiner's address must be at; null = any address. */
  allowed_domains: string | null
}

/** A registration link (server admins): lets someone create an account under SIGNUP=invite / domains. */
export interface SignupLinkRow {
  id: string
  token_hash: string
  label: string | null
  created_by: string | null
  created_at: number
  expires_at: number
  max_uses: number
  uses: number
  last_used_at: number | null
  allowed_domains: string | null
}

export interface FileRow {
  id: string
  workspace_id: string
  /** Plaintext here; sealed with the workspace's key in the database (enc = 1). */
  name: string
  mime: string
  size: number
  /** Content fingerprint for the ETag: HMAC-SHA256 with the workspace's key (enc = 1), plain SHA-256 before. */
  sha256: string
  created_by: string | null
  created_at: number
  /** Uploaded from a private page: served to this user only (until published, docs/CLOUD.md § Private pages). */
  private_to: string | null
  /** 1: name sealed, bytes in `<id>.enc` · 0: from before encryption (plain name, bytes in `<id>` until migrated). */
  enc: number
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

/** A cloud coding worker's token (docs/CLOUD.md § Coding relay): one member, one workspace, only /coding/worker. */
export interface CodingWorkerRow {
  id: string
  workspace_id: string
  user_id: string
  label: string
  token_hash: string
  created_at: number
  /** the browser that downloaded it (user agent, ≤ 200 characters) */
  created_ua: string | null
  /** null = pending: never connected yet (expires after CODING_PENDING_TTL) */
  activated_at: number | null
  last_used_at: number | null
  revoked_at: number | null
}

/** Worker token secrets: "onew_" + 43 URL-safe chars — never accepted where API tokens ("one_") are. */
export const WORKER_TOKEN_PREFIX = 'onew_'
export const isWorkerTokenShape = (s: unknown): s is string => typeof s === 'string' && /^onew_[A-Za-z0-9_-]{43}$/.test(s)
/** A downloaded cloud worker must connect within a day, else its token lapses. */
export const CODING_PENDING_TTL = DAY

/** API token secrets: "one_" + 43 URL-safe chars (32 random bytes). */
export const API_TOKEN_PREFIX = 'one_'
export const isApiTokenShape = (s: unknown): s is string => typeof s === 'string' && /^one_[A-Za-z0-9_-]{43}$/.test(s)

export const publicUser = (u: Pick<UserRow, 'id' | 'email' | 'name'>) => ({ id: u.id, email: u.email, name: u.name })

/** `viewer`: the user asking — `personal` is true on their own personal workspace (while they own it). */
export const publicWorkspace = (w: WorkspaceRow, role: Role, viewer?: string) => ({
  id: w.id,
  name: w.name,
  icon: parseJson(w.icon),
  role,
  plan: w.plan,
  created_at: iso(w.created_at),
  personal: !!viewer && w.personal_of === viewer && role === 'owner',
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

/**
 * All SQL lives here, so routes, collab and the CLI share one vocabulary. Workspace content is
 * encrypted and decrypted here (documents, file names, idempotency answers — docs/CLOUD.md § Tenancy
 * & encryption at rest), so every caller reads and writes plaintext.
 */
export class Repo {
  readonly db: Db
  private readonly secret: Buffer
  private readonly keyring: Keyring | null

  constructor(db: Db, secret: Buffer, keyring: Keyring | null = null) {
    this.db = db
    this.secret = secret
    this.keyring = keyring
  }

  /** The keyring (DATA_KEY loaded). The admin CLI's plain commands run without one. */
  get keys(): Keyring {
    if (!this.keyring) throw new Error('no DATA_KEY loaded')
    return this.keyring
  }

  /** The workspace's key; throws when the workspace is gone (callers checked access first). */
  private keyOf(workspaceId: string): WorkspaceKey {
    const key = this.keys.forWorkspace(workspaceId)
    if (!key) throw new Error(`workspace ${workspaceId} has no key (deleted?)`)
    return key
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

  /** The person's own workspace first, then the others by age. */
  workspacesForUser(userId: string) {
    return this.db.all<WorkspaceRow & { role: Role }>(
      `SELECT w.*, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY (w.personal_of IS NOT NULL AND w.personal_of = m.user_id AND m.role = 'owner') DESC, w.created_at`,
      userId,
    )
  }

  /** Workspaces this user created (the personal one, created for them, does not count). */
  countWorkspacesCreatedSince(userId: string, since: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workspaces WHERE created_by = ? AND created_at > ? AND personal_of IS NULL', userId, since)?.n ?? 0
  }

  /** A new workspace with its data key (one transaction) and the caller as owner. */
  createWorkspace(userId: string, name: string, icon: unknown, opts: { personal?: boolean } = {}): WorkspaceRow {
    const ws: WorkspaceRow = {
      id: newId(),
      name,
      icon: icon == null ? null : JSON.stringify(icon),
      created_at: Date.now(),
      created_by: userId,
      plan: 'free',
      personal_of: opts.personal ? userId : null,
    }
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO workspaces (id, name, icon, created_at, created_by, plan, personal_of) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ws.id, ws.name, ws.icon, ws.created_at, ws.created_by, ws.plan, ws.personal_of,
      )
      this.keys.create(ws.id)
      this.addMember(ws.id, userId, 'owner')
    })
    return ws
  }

  /**
   * The person's own workspace — created once, at their first sign-in (docs/CLOUD.md § Tenancy).
   * null when it was created before (also when they deleted it since: it does not come back).
   */
  ensurePersonalWorkspace(userId: string, name: string): WorkspaceRow | null {
    return this.db.tx(() => {
      if (!this.db.run('UPDATE users SET personal_space_at = ? WHERE id = ? AND personal_space_at IS NULL', Date.now(), userId)) return null
      return this.createWorkspace(userId, name, null, { personal: true })
    })
  }

  updateWorkspace(id: string, patch: { name?: string; icon?: unknown }) {
    if (patch.name !== undefined) this.db.run('UPDATE workspaces SET name = ? WHERE id = ?', patch.name, id)
    if (patch.icon !== undefined) this.db.run('UPDATE workspaces SET icon = ? WHERE id = ?', patch.icon == null ? null : JSON.stringify(patch.icon), id)
  }

  /**
   * Crypto-shredding first: the wrapped data key goes, then the workspace — members, invites,
   * documents, file rows, tokens and hooks with it (ON DELETE CASCADE). Then the WAL is checkpointed
   * and truncated, so no older page image of the key stays in it (secure_delete zeroes the rest).
   */
  deleteWorkspace(id: string) {
    this.db.tx(() => {
      this.keys.shred(id)
      this.db.run('DELETE FROM workspaces WHERE id = ?', id)
    })
    this.db.checkpoint()
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

  /**
   * The current owner becomes admin; the target (added if needed) becomes the one owner. A personal
   * workspace handed to someone else is nobody's personal workspace any more.
   */
  transferOwnership(workspaceId: string, toUserId: string) {
    this.db.tx(() => {
      this.db.run('UPDATE workspaces SET personal_of = NULL WHERE id = ? AND personal_of IS NOT NULL AND personal_of != ?', workspaceId, toUserId)
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

  /** Their cloud worker tokens go with the membership (the relay closes the sockets). */
  removeMember(workspaceId: string, userId: string) {
    this.db.tx(() => {
      this.db.run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId)
      this.revokeCodingWorkersOf(workspaceId, userId)
    })
  }

  // ── invites ──────────────────────────────────────────────────────────

  createInvite(input: { workspaceId: string; role: InviteRole; email: string | null; createdBy: string; maxUses?: number; ttl?: number; domains?: string[] | null }) {
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
      expires_at: now + (input.ttl ?? INVITE_TTL),
      accepted_by: null,
      accepted_at: null,
      max_uses: input.maxUses ?? 1,
      uses: 0,
      allowed_domains: input.domains?.length ? input.domains.join(',') : null,
    }
    this.db.run(
      `INSERT INTO invites (id, token_hash, workspace_id, role, email, created_by, created_at, expires_at, max_uses, allowed_domains)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.token_hash, row.workspace_id, row.role, row.email, row.created_by, row.created_at, row.expires_at, row.max_uses, row.allowed_domains,
    )
    return { token, row }
  }

  countInvitesSince(workspaceId: string, since: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invites WHERE workspace_id = ? AND created_at > ?', workspaceId, since)?.n ?? 0
  }

  /** Invites with places left that have not expired, newest first, with their creator and the latest joiner. */
  openInvites(workspaceId: string) {
    return this.db.all<InviteRow & { inviter_name: string | null; inviter_email: string | null; joiner_name: string | null; joiner_email: string | null }>(
      `SELECT i.*, u.name AS inviter_name, u.email AS inviter_email, j.name AS joiner_name, j.email AS joiner_email
       FROM invites i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users j ON j.id = i.accepted_by
       WHERE i.workspace_id = ? AND i.uses < i.max_uses AND i.expires_at > ? ORDER BY i.created_at DESC`,
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
      'SELECT 1 FROM invites WHERE email = ? AND uses < max_uses AND expires_at > ? LIMIT 1',
      normalizeEmail(email),
      Date.now(),
    )
  }

  /**
   * One more person joined: atomically, only while a place is left and the invite has not expired.
   * False when someone else took the last place (or it expired) meanwhile.
   */
  consumeInvite(inviteId: string, userId: string): boolean {
    const now = Date.now()
    return this.db.run('UPDATE invites SET uses = uses + 1, accepted_by = ?, accepted_at = ? WHERE id = ? AND uses < max_uses AND expires_at > ?', userId, now, inviteId, now) > 0
  }

  // ── registration links (server admins) ───────────────────────────────

  createSignupLink(input: { createdBy: string; ttl: number; maxUses: number; domains: string[] | null; label: string | null }) {
    const token = randomToken()
    const now = Date.now()
    const row: SignupLinkRow = {
      id: newId(),
      token_hash: this.hash(token),
      label: input.label,
      created_by: input.createdBy,
      created_at: now,
      expires_at: now + input.ttl,
      max_uses: input.maxUses,
      uses: 0,
      last_used_at: null,
      allowed_domains: input.domains?.length ? input.domains.join(',') : null,
    }
    this.db.run(
      `INSERT INTO signup_links (id, token_hash, label, created_by, created_at, expires_at, max_uses, allowed_domains)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.token_hash, row.label, row.created_by, row.created_at, row.expires_at, row.max_uses, row.allowed_domains,
    )
    return { token, row }
  }

  countSignupLinksSince(since: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM signup_links WHERE created_at > ?', since)?.n ?? 0
  }

  /** Links with places left that have not expired, newest first, with their creator. */
  openSignupLinks() {
    return this.db.all<SignupLinkRow & { creator_name: string | null; creator_email: string | null }>(
      `SELECT l.*, u.name AS creator_name, u.email AS creator_email FROM signup_links l LEFT JOIN users u ON u.id = l.created_by
       WHERE l.uses < l.max_uses AND l.expires_at > ? ORDER BY l.created_at DESC`,
      Date.now(),
    )
  }

  signupLinkByToken(token: string) {
    return this.db.get<SignupLinkRow>('SELECT * FROM signup_links WHERE token_hash = ?', this.hash(token))
  }

  signupLinkByHash(hash: string) {
    return this.db.get<SignupLinkRow>('SELECT * FROM signup_links WHERE token_hash = ?', hash)
  }

  /** Revoking a registration link deletes it: the link stops working at once. */
  deleteSignupLink(id: string): boolean {
    return this.db.run('DELETE FROM signup_links WHERE id = ?', id) > 0
  }

  /** An account was created through the link: atomically, only while a place is left and it has not expired. */
  consumeSignupLink(id: string): boolean {
    const now = Date.now()
    return this.db.run('UPDATE signup_links SET uses = uses + 1, last_used_at = ? WHERE id = ? AND uses < max_uses AND expires_at > ?', now, id, now) > 0
  }

  // ── Yjs documents ────────────────────────────────────────────────────

  /**
   * The stored Yjs state, decrypted (AAD = the document name: a ciphertext copied from another row
   * fails here). Throws DecryptError rather than ever handing out an empty document for damaged data.
   */
  loadDocument(name: string): Uint8Array | undefined {
    const row = this.db.get<{ data: Uint8Array; enc: number; workspace_id: string }>('SELECT data, enc, workspace_id FROM documents WHERE name = ?', name)
    if (!row) return undefined
    if (!row.enc) return row.data // from before encryption, until the startup migration sealed it
    const key = this.keys.forWorkspace(row.workspace_id)
    if (!key) return undefined
    return open(key.aead, row.data, docContext(name))
  }

  /**
   * Upsert, sealed with the workspace's key (a fresh nonce every time); silently skipped when the
   * workspace is gone (a late debounced store after deletion — its key went first) or the document
   * was deleted for good (a client that still had it open, or an offline copy syncing late).
   */
  saveDocument(name: string, workspaceId: string, data: Uint8Array): boolean {
    const key = this.keys.forWorkspace(workspaceId)
    if (!key) return false
    return (
      this.db.run(
        `INSERT INTO documents (name, workspace_id, data, enc, updated_at)
         SELECT ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
                               AND NOT EXISTS (SELECT 1 FROM document_tombstones WHERE name = ?)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data, enc = 1, updated_at = excluded.updated_at`,
        name, workspaceId, seal(key.aead, data, docContext(name)), Date.now(), workspaceId, name,
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

  /**
   * A member's private documents (`ws:<id>:u:<userId>` and its page documents) and their tombstones —
   * when the member leaves or is removed. Returns how many stored documents went.
   */
  deletePrivateDocuments(workspaceId: string, userId: string): number {
    const prefix = `ws:${workspaceId}:u:${userId}`
    // no LIKE: ids contain `_`, a LIKE wildcard
    const mine = 'name = ? OR substr(name, 1, ?) = ?'
    return this.db.tx(() => {
      this.db.run(`DELETE FROM document_tombstones WHERE workspace_id = ? AND (${mine})`, workspaceId, prefix, prefix.length + 3, `${prefix}:p:`)
      return this.db.run(`DELETE FROM documents WHERE workspace_id = ? AND (${mine})`, workspaceId, prefix, prefix.length + 3, `${prefix}:p:`)
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

  /** A file's row with its name decrypted. */
  file(workspaceId: string, id: string): FileRow | undefined {
    const row = this.db.get<FileRow>('SELECT * FROM files WHERE workspace_id = ? AND id = ?', workspaceId, id)
    if (!row?.enc) return row
    return { ...row, name: openText(this.keyOf(workspaceId).aead, row.name, fileNameContext(workspaceId, id)) }
  }

  /** A new file row (bytes already in `<id>.enc`): the name is sealed, `sha256` is the keyed fingerprint. */
  insertFile(row: Omit<FileRow, 'enc'>): boolean {
    const key = this.keys.forWorkspace(row.workspace_id)
    if (!key) return false
    return (
      this.db.run(
        `INSERT INTO files (id, workspace_id, name, mime, size, sha256, created_by, created_at, private_to, enc)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
         ON CONFLICT DO NOTHING`,
        row.id, row.workspace_id, sealText(key.aead, row.name, fileNameContext(row.workspace_id, row.id)), row.mime, row.size, row.sha256,
        row.created_by, row.created_at, row.private_to, row.workspace_id,
      ) > 0
    )
  }

  /** The owner's private files become workspace files (their page moved to the workspace). Returns how many. */
  publishFiles(workspaceId: string, userId: string, ids: string[]): number {
    let n = 0
    this.db.tx(() => {
      for (const id of ids) n += this.db.run('UPDATE files SET private_to = NULL WHERE workspace_id = ? AND id = ? AND private_to = ?', workspaceId, id, userId)
    })
    return n
  }

  /** A leaving member's private files: the rows go, the ids are returned (the bytes are the caller's job). */
  deletePrivateFiles(workspaceId: string, userId: string): string[] {
    return this.db.tx(() => {
      const ids = this.db.all<{ id: string }>('SELECT id FROM files WHERE workspace_id = ? AND private_to = ?', workspaceId, userId).map((r) => r.id)
      this.db.run('DELETE FROM files WHERE workspace_id = ? AND private_to = ?', workspaceId, userId)
      return ids
    })
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

  // ── cloud coding workers (docs/CLOUD.md § Coding relay) ──────────────

  /**
   * A new download's token, PENDING: the member's working token stays until this one first connects
   * (activateCodingWorker). An older pending token (a download never started) is revoked now. The secret is
   * returned once and stored only as HMAC.
   */
  createCodingWorker(input: { workspaceId: string; userId: string; label: string; userAgent: string | null }): { token: string; row: CodingWorkerRow; replaced: string[] } {
    const token = WORKER_TOKEN_PREFIX + randomToken()
    const now = Date.now()
    const row: CodingWorkerRow = {
      id: newId(),
      workspace_id: input.workspaceId,
      user_id: input.userId,
      label: input.label,
      token_hash: this.hash(token),
      created_at: now,
      created_ua: input.userAgent ? input.userAgent.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : null,
      activated_at: null,
      last_used_at: null,
      revoked_at: null,
    }
    const replaced = this.db.tx(() => {
      const ids = this.db
        .all<{ id: string }>('SELECT id FROM coding_workers WHERE workspace_id = ? AND user_id = ? AND revoked_at IS NULL AND activated_at IS NULL', input.workspaceId, input.userId)
        .map((r) => r.id)
      for (const id of ids) this.db.run('UPDATE coding_workers SET revoked_at = ? WHERE id = ?', now, id)
      this.db.run(
        'INSERT INTO coding_workers (id, workspace_id, user_id, label, token_hash, created_at, created_ua) VALUES (?, ?, ?, ?, ?, ?, ?)',
        row.id, row.workspace_id, row.user_id, row.label, row.token_hash, row.created_at, row.created_ua,
      )
      return ids
    })
    return { token, row, replaced }
  }

  /** Live tokens (active, and pending ones not expired) with their member, newest first — one member's or everyone's. */
  codingWorkers(workspaceId: string, userId?: string, now = Date.now()) {
    return this.db.all<CodingWorkerRow & { user_name: string | null; user_email: string }>(
      `SELECT c.*, u.name AS user_name, u.email AS user_email FROM coding_workers c JOIN users u ON u.id = c.user_id
       WHERE c.workspace_id = ? AND c.revoked_at IS NULL AND (c.activated_at IS NOT NULL OR c.created_at > ?)${userId ? ' AND c.user_id = ?' : ''}
       ORDER BY c.created_at DESC`,
      ...(userId ? [workspaceId, now - CODING_PENDING_TTL, userId] : [workspaceId, now - CODING_PENDING_TTL]),
    )
  }

  /** A live token of that workspace. */
  codingWorker(workspaceId: string, id: string, now = Date.now()): CodingWorkerRow | undefined {
    return this.db.get<CodingWorkerRow>(
      'SELECT * FROM coding_workers WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL AND (activated_at IS NOT NULL OR created_at > ?)',
      id, workspaceId, now - CODING_PENDING_TTL,
    )
  }

  /** A live token of an existing workspace by its secret (HMAC lookup; the caller compares in constant time too). */
  codingWorkerBySecret(token: string, now = Date.now()): CodingWorkerRow | undefined {
    return this.db.get<CodingWorkerRow>(
      `SELECT c.* FROM coding_workers c JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.token_hash = ? AND c.revoked_at IS NULL AND (c.activated_at IS NOT NULL OR c.created_at > ?)`,
      this.hash(token), now - CODING_PENDING_TTL,
    )
  }

  codingWorkerLive(id: string, now = Date.now()): boolean {
    return !!this.db.get('SELECT 1 AS ok FROM coding_workers WHERE id = ? AND revoked_at IS NULL AND (activated_at IS NOT NULL OR created_at > ?)', id, now - CODING_PENDING_TTL)
  }

  /**
   * The token's first connection: it becomes the member's active one, and every other live token of the member
   * in that workspace is revoked (returned: the relay closes them as "replaced"). Already active: nothing.
   */
  activateCodingWorker(id: string, now = Date.now()): { activated: boolean; replaced: string[] } {
    return this.db.tx(() => {
      const row = this.db.get<CodingWorkerRow>('SELECT * FROM coding_workers WHERE id = ? AND revoked_at IS NULL', id)
      if (!row || row.activated_at !== null) return { activated: false, replaced: [] }
      const replaced = this.db
        .all<{ id: string }>('SELECT id FROM coding_workers WHERE workspace_id = ? AND user_id = ? AND id != ? AND revoked_at IS NULL', row.workspace_id, row.user_id, id)
        .map((r) => r.id)
      for (const other of replaced) this.db.run('UPDATE coding_workers SET revoked_at = ? WHERE id = ?', now, other)
      this.db.run('UPDATE coding_workers SET activated_at = ?, last_used_at = ? WHERE id = ?', now, now, id)
      return { activated: true, replaced }
    })
  }

  revokeCodingWorker(workspaceId: string, id: string): boolean {
    return this.db.run('UPDATE coding_workers SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL', Date.now(), id, workspaceId) > 0
  }

  /** Every live token of a member in a workspace (leaving, removal). Returns their ids. */
  revokeCodingWorkersOf(workspaceId: string, userId: string): string[] {
    const ids = this.db.all<{ id: string }>('SELECT id FROM coding_workers WHERE workspace_id = ? AND user_id = ? AND revoked_at IS NULL', workspaceId, userId).map((r) => r.id)
    if (ids.length) this.db.run('UPDATE coding_workers SET revoked_at = ? WHERE workspace_id = ? AND user_id = ? AND revoked_at IS NULL', Date.now(), workspaceId, userId)
    return ids
  }

  touchCodingWorker(id: string, at = Date.now()) {
    this.db.run('UPDATE coding_workers SET last_used_at = ? WHERE id = ?', at, id)
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

  /** A kept answer (decrypted). The answer of a create request is workspace content: sealed at rest. */
  idempotent(scope: string, key: string, since: number): { status: number; body: string } | undefined {
    const row = this.db.get<{ status: number; body: string; workspace_id: string }>(
      'SELECT status, body, workspace_id FROM idempotency WHERE scope = ? AND key = ? AND created_at > ?',
      scope, key, since,
    )
    if (!row || !isSealedText(row.body)) return row // JSON from before encryption (kept 24 h at most)
    // a damaged answer fails the request (500) — running the create again could duplicate it
    return { status: row.status, body: openText(this.keyOf(row.workspace_id).aead, row.body, idempotencyContext(scope, key)) }
  }

  rememberIdempotent(scope: string, key: string, workspaceId: string, status: number, body: string) {
    this.db.run(
      `INSERT INTO idempotency (scope, key, workspace_id, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET status = excluded.status, body = excluded.body, created_at = excluded.created_at`,
      scope, key, workspaceId, status, sealText(this.keyOf(workspaceId).aead, body, idempotencyContext(scope, key)), Date.now(),
    )
  }

  // ── housekeeping ─────────────────────────────────────────────────────

  purgeExpired(now = Date.now()) {
    return {
      loginTokens: this.db.run('DELETE FROM login_tokens WHERE expires_at < ?', now - DAY),
      sessions: this.db.run('DELETE FROM sessions WHERE expires_at < ?', now),
      invites: this.db.run('DELETE FROM invites WHERE uses = 0 AND expires_at < ?', now - 30 * DAY),
      signupLinks: this.db.run('DELETE FROM signup_links WHERE expires_at < ?', now - 30 * DAY),
      idempotency: this.db.run('DELETE FROM idempotency WHERE created_at < ?', now - DAY),
      // revoked tokens are kept a while for the audit trail (rows written by `api:<tokenId>`)
      apiTokens: this.db.run('DELETE FROM api_tokens WHERE revoked_at IS NOT NULL AND revoked_at < ?', now - 90 * DAY),
      // cloud worker tokens: revoked ones kept like API tokens; a download never started lapses after a day
      codingWorkers: this.db.run(
        'DELETE FROM coding_workers WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR (activated_at IS NULL AND revoked_at IS NULL AND created_at < ?)',
        now - 90 * DAY, now - CODING_PENDING_TTL,
      ),
    }
  }
}
