/**
 * Encrypting what was stored before encryption at rest existed — at every server start (database
 * rows before listening, files in the background) and with `node dist/cli.js encrypt-all`.
 *
 * Idempotent and crash-safe:
 * - rows are sealed in place in transactions, `WHERE enc = 0` (a row sealed meanwhile is skipped);
 * - a file is sealed into a temp file, fsynced and renamed to `<id>.enc` (atomic), THEN its row is
 *   marked, THEN the plaintext `<id>` is removed. Reads prefer `<id>.enc`, so every intermediate
 *   state serves the right bytes, and a run after a crash finishes the job.
 */
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { open as openFd, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import type { Db } from '../db/index.ts'
import { legacyPath, sealedPath } from '../storage.ts'
import { newId } from '../tokens.ts'
import { docContext, fileNameContext, fileSealer, idempotencyContext, openFile, seal, sealText, type WorkspaceKey } from './aead.ts'
import type { Keyring } from './keyring.ts'

const BATCH = 100

export interface RowReport {
  /** Workspaces from before encryption that got their data key now. */
  keys: number
  documents: number
  idempotency: number
}

export interface FileReport {
  files: number
  /** Rows whose bytes are gone from disk (nothing to seal; the name was sealed anyway). */
  missing: number
}

/** What is still stored in plaintext (for `encrypt-all` and the startup log). */
export function plaintextLeft(db: Db): { documents: number; files: number; idempotency: number; workspacesWithoutKey: number } {
  const n = (sql: string) => db.get<{ n: number }>(sql)?.n ?? 0
  return {
    documents: n('SELECT COUNT(*) AS n FROM documents WHERE enc = 0'),
    files: n('SELECT COUNT(*) AS n FROM files WHERE enc = 0'),
    idempotency: n("SELECT COUNT(*) AS n FROM idempotency WHERE substr(body, 1, 3) != 'v1.'"),
    workspacesWithoutKey: n('SELECT COUNT(*) AS n FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_keys)'),
  }
}

/** Keys for old workspaces, then every plaintext Yjs state and kept API answer sealed. */
export function sealRows(db: Db, keys: Keyring): RowReport {
  const report: RowReport = { keys: 0, documents: 0, idempotency: 0 }
  for (const { id } of db.all<{ id: string }>('SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_keys)')) {
    if (keys.forWorkspace(id)) report.keys++
  }

  let last = ''
  for (;;) {
    const names = db.all<{ name: string }>('SELECT name FROM documents WHERE enc = 0 AND name > ? ORDER BY name LIMIT ?', last, BATCH)
    if (!names.length) break
    last = names[names.length - 1]!.name
    db.tx(() => {
      for (const { name } of names) {
        const row = db.get<{ data: Uint8Array; workspace_id: string }>('SELECT data, workspace_id FROM documents WHERE name = ? AND enc = 0', name)
        const key = row && keys.forWorkspace(row.workspace_id)
        if (!row || !key) continue
        report.documents += db.run('UPDATE documents SET data = ?, enc = 1 WHERE name = ? AND enc = 0', seal(key.aead, row.data, docContext(name)), name)
      }
    })
  }

  const answers = db.all<{ scope: string; key: string; workspace_id: string; body: string }>(
    "SELECT scope, key, workspace_id, body FROM idempotency WHERE substr(body, 1, 3) != 'v1.'",
  )
  db.tx(() => {
    for (const a of answers) {
      const key = keys.forWorkspace(a.workspace_id)
      if (!key) continue
      report.idempotency += db.run(
        "UPDATE idempotency SET body = ? WHERE scope = ? AND key = ? AND substr(body, 1, 3) != 'v1.'",
        sealText(key.aead, a.body, idempotencyContext(a.scope, a.key)), a.scope, a.key,
      )
    }
  })

  // plaintext page images must not linger in the WAL (secure_delete zeroes freed pages in the file)
  if (report.documents || report.idempotency) db.checkpoint()
  return report
}

interface PlainFileRow {
  workspace_id: string
  id: string
  name: string
  sha256: string
}

/** Every file from before encryption sealed into `<id>.enc` (name and fingerprint too). */
export async function sealFiles(db: Db, keys: Keyring, dataDir: string): Promise<FileReport> {
  const report: FileReport = { files: 0, missing: 0 }
  let last = { ws: '', id: '' }
  for (;;) {
    const rows = db.all<PlainFileRow>(
      'SELECT workspace_id, id, name, sha256 FROM files WHERE enc = 0 AND (workspace_id > ? OR (workspace_id = ? AND id > ?)) ORDER BY workspace_id, id LIMIT ?',
      last.ws, last.ws, last.id, BATCH,
    )
    if (!rows.length) break
    const tail = rows[rows.length - 1]!
    last = { ws: tail.workspace_id, id: tail.id }
    for (const row of rows) {
      const key = keys.forWorkspace(row.workspace_id)
      if (!key) continue
      const result = await sealFile(db, key, dataDir, row)
      if (result === 'sealed') report.files++
      else if (result === 'missing') report.missing++
    }
  }
  if (report.files || report.missing) db.checkpoint()
  return report
}

async function sealFile(db: Db, key: WorkspaceKey, dataDir: string, row: PlainFileRow): Promise<'sealed' | 'missing' | 'skipped'> {
  const legacy = legacyPath(dataDir, row.workspace_id, row.id)
  const sealed = sealedPath(dataDir, row.workspace_id, row.id)
  let fp: string
  let outcome: 'sealed' | 'missing' = 'sealed'
  if (existsSync(legacy)) {
    fp = await sealInto(key, legacy, sealed, row)
  } else if (existsSync(sealed)) {
    // an earlier run sealed the bytes and stopped before the row: fingerprint the sealed content
    const mac = createHmac('sha256', key.mac)
    for await (const chunk of (await openFile(sealed, key, row.workspace_id, row.id)).stream()) mac.update(chunk as Buffer)
    fp = mac.digest('hex')
  } else {
    // the bytes are gone (lost before the upgrade): no plain content hash stays behind either
    fp = createHmac('sha256', key.mac).update(`missing:${row.sha256}`).digest('hex')
    outcome = 'missing'
  }
  const changed = db.run(
    'UPDATE files SET name = ?, sha256 = ?, enc = 1 WHERE workspace_id = ? AND id = ? AND enc = 0',
    sealText(key.aead, row.name, fileNameContext(row.workspace_id, row.id)), fp, row.workspace_id, row.id,
  )
  await rm(legacy, { force: true })
  return changed ? outcome : 'skipped'
}

/** Plaintext file → temp file (sealed, fsynced) → atomic rename to `<id>.enc`. Returns the keyed fingerprint. */
async function sealInto(key: WorkspaceKey, from: string, to: string, row: PlainFileRow): Promise<string> {
  const tmp = join(dirname(to), `.seal-${newId()}`)
  const sealer = fileSealer(key, row.workspace_id, row.id)
  const out = createWriteStream(tmp, { flags: 'wx', mode: 0o640 })
  try {
    out.write(sealer.header)
    for await (const chunk of createReadStream(from)) {
      if (!out.write(sealer.update(chunk as Buffer))) await once(out, 'drain')
    }
    out.write(sealer.final())
    out.end()
    await finished(out)
    const fh = await openFd(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, to)
  } catch (err) {
    out.destroy()
    await rm(tmp, { force: true })
    throw err
  }
  return sealer.fingerprint()
}
