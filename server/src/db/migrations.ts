/**
 * Versioned schema migrations. Append new entries; never edit an applied one.
 * Timestamps are integer milliseconds since the epoch (the API renders them as ISO strings).
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT,
        created_at    INTEGER NOT NULL,
        last_seen_at  INTEGER
      );

      CREATE TABLE sessions (
        id            TEXT PRIMARY KEY,
        token_hash    TEXT NOT NULL UNIQUE,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL,
        user_agent    TEXT,
        last_used_at  INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE INDEX sessions_expires ON sessions(expires_at);

      -- browser_hash: binds the link to the browser that asked for it (one-click sign-in there,
      -- a confirmation button elsewhere, so mail scanners cannot burn the single-use token).
      -- invite_hash: the invite that allowed a new account under SIGNUP=invite/domains.
      CREATE TABLE login_tokens (
        token_hash    TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL,
        used_at       INTEGER,
        redirect      TEXT,
        browser_hash  TEXT,
        invite_hash   TEXT,
        lang          TEXT
      );
      CREATE INDEX login_tokens_expires ON login_tokens(expires_at);

      CREATE TABLE workspaces (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        icon          TEXT,
        created_at    INTEGER NOT NULL,
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        plan          TEXT NOT NULL DEFAULT 'free'
      );

      CREATE TABLE members (
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE INDEX members_user ON members(user_id);
      -- at most one owner per workspace (the API keeps it at exactly one)
      CREATE UNIQUE INDEX members_one_owner ON members(workspace_id) WHERE role = 'owner';

      CREATE TABLE invites (
        id            TEXT PRIMARY KEY,
        token_hash    TEXT NOT NULL UNIQUE,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        role          TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
        email         TEXT,
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL,
        accepted_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        accepted_at   INTEGER
      );
      CREATE INDEX invites_workspace ON invites(workspace_id, created_at);
      CREATE INDEX invites_email ON invites(email);

      CREATE TABLE documents (
        name          TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        data          BLOB NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX documents_workspace ON documents(workspace_id);

      -- file ids are chosen by the client (its onefile:<id>), so they are unique per workspace
      CREATE TABLE files (
        id            TEXT NOT NULL,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        mime          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
    `,
  },
  {
    version: 2,
    name: 'document tombstones',
    sql: `
      -- content documents of pages deleted for good (DELETE /api/workspaces/:id/documents/:pageId):
      -- never stored again, even when a device that still holds a copy syncs it later
      CREATE TABLE document_tombstones (
        name          TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        deleted_at    INTEGER NOT NULL,
        deleted_by    TEXT REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX document_tombstones_workspace ON document_tombstones(workspace_id);
    `,
  },
  {
    version: 3,
    name: 'public api: tokens, incoming webhooks, idempotency',
    sql: `
      -- bearer tokens for /api/v1 (docs/API.md); the secret "one_<random>" is shown once, stored as HMAC
      CREATE TABLE api_tokens (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        scope         TEXT NOT NULL CHECK (scope IN ('read', 'write')),
        token_hash    TEXT NOT NULL UNIQUE,
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        last_used_at  INTEGER,
        revoked_at    INTEGER
      );
      CREATE INDEX api_tokens_workspace ON api_tokens(workspace_id, created_at);

      -- incoming webhooks: POST /api/v1/hooks/<secret> creates a row in database_id
      CREATE TABLE webhooks (
        id                TEXT PRIMARY KEY,
        workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        database_id       TEXT NOT NULL,
        secret_hash       TEXT NOT NULL UNIQUE,
        created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at        INTEGER NOT NULL,
        rotated_at        INTEGER,
        last_delivery_at  INTEGER,
        deliveries        INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX webhooks_workspace ON webhooks(workspace_id, created_at);

      -- first answers of create requests by Idempotency-Key / deliveryId, replayed for 24 h
      CREATE TABLE idempotency (
        scope         TEXT NOT NULL,
        key           TEXT NOT NULL,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status        INTEGER NOT NULL,
        body          TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      );
      CREATE INDEX idempotency_created ON idempotency(created_at);
    `,
  },
  {
    version: 4,
    name: 'private pages: private files',
    sql: `
      -- files uploaded from a private page (docs/CLOUD.md § Private pages): only this user may
      -- download them until a page that uses them moves to the workspace (POST …/files/publish)
      ALTER TABLE files ADD COLUMN private_to TEXT;
      CREATE INDEX files_private ON files(workspace_id, private_to) WHERE private_to IS NOT NULL;
    `,
  },
  {
    version: 5,
    name: 'personal workspaces',
    sql: `
      -- every person gets a workspace of their own at their first sign-in (docs/CLOUD.md § Tenancy):
      -- personal_space_at marks that it was created (once — deleting it does not bring it back)
      ALTER TABLE users ADD COLUMN personal_space_at INTEGER;
      ALTER TABLE workspaces ADD COLUMN personal_of TEXT REFERENCES users(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX workspaces_personal ON workspaces(personal_of) WHERE personal_of IS NOT NULL;
      -- people who already own a workspace already have a space of their own
      UPDATE users SET personal_space_at = created_at
        WHERE EXISTS (SELECT 1 FROM members m WHERE m.user_id = users.id AND m.role = 'owner');
    `,
  },
  {
    version: 6,
    name: 'encryption at rest',
    sql: `
      -- one data key per workspace, stored only wrapped by the master key (DATA_KEY); kek_id names
      -- that master key. Deleting the row (first, when a workspace is deleted) shreds its data.
      CREATE TABLE workspace_keys (
        workspace_id  TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        wrapped       BLOB NOT NULL,
        kek_id        TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        rotated_at    INTEGER
      );

      -- enc: 0 = plaintext from before encryption (read as is, encrypted at startup / encrypt-all),
      -- 1 = sealed with the workspace's key (documents.data; files.name + keyed fingerprint in sha256,
      -- the bytes in DATA_DIR/files/<ws>/<id>.enc)
      ALTER TABLE documents ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE files ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX documents_plain ON documents(name) WHERE enc = 0;
      CREATE INDEX files_plain ON files(workspace_id, id) WHERE enc = 0;

      -- a running server's heartbeat (the CLI refuses a key rotation while the server runs)
      CREATE TABLE server_state (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `,
  },
]
