/**
 * One data key per workspace (DEK, 32 random bytes), stored only wrapped by the master key (KEK,
 * `DATA_KEY`) in `workspace_keys`. Unwrapped keys are cached in memory for the life of the process.
 *
 * - A workspace's key is created with the workspace (same transaction); workspaces from before
 *   encryption get theirs on first use (race-safe: INSERT … ON CONFLICT DO NOTHING, then re-read).
 * - Deleting a workspace deletes its wrapped key first (crypto-shredding): everything still sealed
 *   with it — leftover file blocks, copies of `files/` — can no longer be decrypted.
 * - `kek_id` names the master key that wrapped each row, so a wrong DATA_KEY is reported as such
 *   (and a half-done rotation names the rows that still need the old key).
 */
import { ConfigError } from '../config.ts'
import type { Db } from '../db/index.ts'
import { DecryptError, type WorkspaceKey, deriveWorkspaceKey, keyId, newDataKey, unwrapKey, wrapKey } from './aead.ts'

export interface KeyRow {
  workspace_id: string
  wrapped: Uint8Array
  kek_id: string
  created_at: number
  rotated_at: number | null
}

/** DATA_KEY does not open the keys in this database (wrong key, restore with the wrong key, half-done rotation). */
export class KeyMismatchError extends ConfigError {}

export class Keyring {
  private readonly db: Db
  private readonly kek: Buffer
  readonly kekId: string
  private readonly cache = new Map<string, WorkspaceKey>()

  constructor(db: Db, kek: Buffer) {
    this.db = db
    this.kek = kek
    this.kekId = keyId(kek)
  }

  /**
   * The workspace's key (unwrapped, cached). Created for a workspace from before encryption.
   * null: there is no such workspace (deleted meanwhile) — nothing may be stored for it.
   */
  forWorkspace(workspaceId: string): WorkspaceKey | null {
    const cached = this.cache.get(workspaceId)
    if (cached) return cached
    let row = this.row(workspaceId)
    if (!row) {
      if (!this.db.get('SELECT 1 AS x FROM workspaces WHERE id = ?', workspaceId)) return null
      try {
        this.insert(workspaceId, 'ignore')
      } catch {
        return null // the workspace went away between the check and the insert (foreign key)
      }
      row = this.row(workspaceId)
      if (!row) return null
    }
    if (row.kek_id !== this.kekId) {
      throw new KeyMismatchError(`the data key of workspace ${workspaceId} was wrapped with another DATA_KEY (key id ${row.kek_id}, this DATA_KEY is ${this.kekId})`)
    }
    const dek = unwrapKey(this.kek, row.wrapped, workspaceId)
    const key = deriveWorkspaceKey(dek)
    dek.fill(0)
    this.cache.set(workspaceId, key)
    return key
  }

  /** A new workspace's key — call inside the transaction that inserts the workspace. */
  create(workspaceId: string): void {
    this.insert(workspaceId, 'fail')
  }

  private insert(workspaceId: string, onConflict: 'ignore' | 'fail') {
    const dek = newDataKey()
    try {
      this.db.run(
        `INSERT INTO workspace_keys (workspace_id, wrapped, kek_id, created_at) VALUES (?, ?, ?, ?)${onConflict === 'ignore' ? ' ON CONFLICT(workspace_id) DO NOTHING' : ''}`,
        workspaceId, wrapKey(this.kek, dek, workspaceId), this.kekId, Date.now(),
      )
    } finally {
      dek.fill(0)
    }
  }

  /** Crypto-shredding: the wrapped key goes (call before deleting the workspace's rows, same transaction). */
  shred(workspaceId: string): void {
    this.db.run('DELETE FROM workspace_keys WHERE workspace_id = ?', workspaceId)
    this.forget(workspaceId)
  }

  /** Drop a cached key (after shredding; best effort to clear it from memory). */
  forget(workspaceId: string): void {
    const key = this.cache.get(workspaceId)
    if (!key) return
    key.aead.fill(0)
    key.mac.fill(0)
    this.cache.delete(workspaceId)
  }

  private row(workspaceId: string) {
    return this.db.get<KeyRow>('SELECT * FROM workspace_keys WHERE workspace_id = ?', workspaceId)
  }

  /**
   * Startup check: every wrapped key belongs to this DATA_KEY and one of them actually opens. A
   * mismatch refuses to start (with what to do) instead of failing document by document later.
   */
  verify(): { keys: number } {
    const counts = this.db.all<{ kek_id: string; n: number }>('SELECT kek_id, COUNT(*) AS n FROM workspace_keys GROUP BY kek_id')
    const foreign = counts.filter((c) => c.kek_id !== this.kekId)
    const total = counts.reduce((sum, c) => sum + c.n, 0)
    if (foreign.length) {
      const n = foreign.reduce((sum, c) => sum + c.n, 0)
      throw new KeyMismatchError(
        `DATA_KEY (key id ${this.kekId}) is not the key this database's workspace keys are wrapped with — ${n} of ${total} use key id ${foreign.map((f) => f.kek_id).join(', ')}. ` +
          'Start with the DATA_KEY these data were written with (a restored backup needs the key from the time of the backup); ' +
          'to finish a rotation run: DATA_KEY=<old key> NEW_DATA_KEY=<this key> node dist/cli.js rotate-data-key',
      )
    }
    const sample = this.db.get<KeyRow>('SELECT * FROM workspace_keys ORDER BY created_at LIMIT 1')
    if (sample) {
      try {
        unwrapKey(this.kek, sample.wrapped, sample.workspace_id).fill(0)
      } catch (err) {
        if (err instanceof DecryptError) throw new KeyMismatchError(`DATA_KEY cannot open the key of workspace ${sample.workspace_id} (damaged key row?)`)
        throw err
      }
    }
    return { keys: total }
  }
}

/**
 * KEK rotation (CLI `rotate-data-key`): every DEK re-wrapped from `oldKek` to `newKek` — the
 * content stays as it is. Idempotent (rows already under the new key are skipped); refuses as a
 * whole when a row is under neither key.
 */
export function rewrapAll(db: Db, oldKek: Buffer, newKek: Buffer): { rewrapped: number; already: number } {
  const oldId = keyId(oldKek)
  const newId = keyId(newKek)
  if (oldId === newId) throw new Error('the new key is the old key')
  return db.tx(() => {
    const rows = db.all<KeyRow>('SELECT * FROM workspace_keys')
    const unknown = rows.filter((r) => r.kek_id !== oldId && r.kek_id !== newId)
    if (unknown.length) {
      throw new KeyMismatchError(`${unknown.length} workspace key(s) are wrapped with neither key (key id ${[...new Set(unknown.map((r) => r.kek_id))].join(', ')}; old ${oldId}, new ${newId}) — nothing was changed`)
    }
    let rewrapped = 0
    const now = Date.now()
    for (const r of rows) {
      if (r.kek_id === newId) continue
      const dek = unwrapKey(oldKek, r.wrapped, r.workspace_id)
      try {
        db.run('UPDATE workspace_keys SET wrapped = ?, kek_id = ?, rotated_at = ? WHERE workspace_id = ? AND kek_id = ?', wrapKey(newKek, dek, r.workspace_id), newId, now, r.workspace_id, oldId)
      } finally {
        dek.fill(0)
      }
      rewrapped++
    }
    return { rewrapped, already: rows.length - rewrapped }
  })
}
