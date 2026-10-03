/**
 * Admin CLI — works on the same DATA_DIR as the server (safe while it runs: SQLite WAL + busy timeout).
 *   node dist/cli.js <command> [args]
 * In Docker: docker compose exec one node dist/cli.js <command>
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ConfigError, loadDataKey, parseKey, resolveDataDir } from './config.ts'
import { keyId } from './crypto/aead.ts'
import { Keyring, rewrapAll } from './crypto/keyring.ts'
import { plaintextLeft, sealFiles, sealRows } from './crypto/migrate.ts'
import { heartbeatAge, openDb } from './db/index.ts'
import { normalizeEmail, Repo } from './repo.ts'

const HELP = `SimpleCMS One server — admin CLI

Usage: node dist/cli.js <command> [arguments]

  create-user <email> [name]         create an account (e.g. the first admin under SIGNUP=invite)
  list-users                         all accounts
  list-workspaces                    all workspaces with owner and member count
  make-owner <workspaceId> <email>   hand a workspace to this user (the old owner becomes admin)
  revoke-sessions <email>            sign this user out everywhere
  backup [file]                      consistent copy of the database (VACUUM INTO);
                                     default: DATA_DIR/backups/one-<timestamp>.sqlite
                                     (ciphertext: restoring it needs the same DATA_KEY)

Encryption at rest (DATA_KEY from the environment; development: DATA_DIR/dev-data-key):
  encrypt-all                        seal everything stored before encryption (documents, files,
                                     API answers) and report what is left — safe while the server runs
                                     (it does the same at every start)
  rotate-data-key [--force]          re-wrap every workspace key with a new master key; content is not
                                     re-encrypted. Stop the server first, then:
                                     DATA_KEY=<old> NEW_DATA_KEY=<new> node dist/cli.js rotate-data-key

DATA_DIR: ${resolveDataDir()}
`

const [command, ...args] = process.argv.slice(2)
const dataDir = resolveDataDir()
const dbFile = join(dataDir, 'one.sqlite')

const dataKey = () => {
  try {
    return loadDataKey(process.env, process.env.NODE_ENV === 'production', dataDir)
  } catch (err) {
    fail((err as Error).message)
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return console.log('(none)')
  console.table(rows)
}

const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '')

if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}
if (!existsSync(dbFile) && command !== 'create-user') fail(`no database at ${dbFile} (set DATA_DIR)`)
mkdirSync(dataDir, { recursive: true })

const db = openDb(dbFile)
// the CLI never hashes tokens, so it needs no SECRET; DATA_KEY only for the encryption commands
const repo = new Repo(db, Buffer.alloc(32))

try {
  switch (command) {
    case 'create-user': {
      const [email, ...name] = args
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('usage: create-user <email> [name]')
      if (repo.userByEmail(email)) fail(`${normalizeEmail(email)} already exists`)
      const user = repo.createUser(email, name.join(' ').trim() || null)
      console.log(`created ${user.email} (${user.id}) — they can now sign in with a magic link`)
      break
    }
    case 'list-users': {
      table(
        db
          .all<{ id: string; email: string; name: string | null; created_at: number; last_seen_at: number | null; workspaces: number }>(
            'SELECT u.*, (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS workspaces FROM users u ORDER BY u.created_at',
          )
          .map((u) => ({ id: u.id, email: u.email, name: u.name ?? '', workspaces: u.workspaces, created: day(u.created_at), last_seen: day(u.last_seen_at) })),
      )
      break
    }
    case 'list-workspaces': {
      table(
        db
          .all<{ id: string; name: string; plan: string; created_at: number; owner: string | null; members: number; documents: number; files_mb: number; personal_of: string | null }>(
            `SELECT w.id, w.name, w.plan, w.created_at, w.personal_of,
               (SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner') AS owner,
               (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members,
               (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id) AS documents,
               (SELECT ROUND(COALESCE(SUM(size), 0) / 1048576.0, 1) FROM files f WHERE f.workspace_id = w.id) AS files_mb
             FROM workspaces w ORDER BY w.created_at`,
          )
          .map((w) => ({ id: w.id, name: w.name, owner: w.owner ?? '', personal: w.personal_of ? 'yes' : '', members: w.members, documents: w.documents, files_mb: w.files_mb, plan: w.plan, created: day(w.created_at) })),
      )
      break
    }
    case 'make-owner': {
      const [workspaceId, email] = args
      if (!workspaceId || !email) fail('usage: make-owner <workspaceId> <email>')
      const ws = repo.workspaceById(workspaceId)
      if (!ws) fail(`no workspace ${workspaceId}`)
      const user = repo.userByEmail(email) ?? fail(`no user ${email} (create-user first)`)
      repo.transferOwnership(ws.id, user.id)
      console.log(`${user.email} now owns "${ws.name}" (connected clients pick up the change when they reconnect)`)
      break
    }
    case 'revoke-sessions': {
      const [email] = args
      const user = (email && repo.userByEmail(email)) || fail('usage: revoke-sessions <email> (existing user)')
      const n = db.run('DELETE FROM sessions WHERE user_id = ?', user.id)
      console.log(`revoked ${n} session(s) of ${user.email}; open connections close within a minute`)
      break
    }
    case 'backup': {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const target = resolve(args[0] ?? join(dataDir, 'backups', `one-${stamp}.sqlite`))
      if (existsSync(target)) fail(`${target} already exists`)
      mkdirSync(dirname(target), { recursive: true })
      db.raw.prepare('VACUUM INTO ?').run(target)
      console.log(`backup written to ${target}`)
      console.log(`files are not inside the database — copy ${join(dataDir, 'files')} as well`)
      console.log('both are encrypted: keep DATA_KEY apart from the backup (a restore needs both)')
      break
    }
    case 'encrypt-all': {
      const keyring = new Keyring(db, dataKey())
      keyring.verify()
      const rows = sealRows(db, keyring)
      const files = await sealFiles(db, keyring, dataDir)
      const left = plaintextLeft(db)
      console.log(`sealed: ${rows.documents} document(s), ${files.files} file(s), ${rows.idempotency} API answer(s); ${rows.keys} workspace key(s) created`)
      if (files.missing) console.log(`${files.missing} file row(s) had no bytes on disk (lost before the upgrade)`)
      const plain = left.documents + left.files + left.idempotency + left.workspacesWithoutKey
      console.log(plain ? `still in plaintext: ${JSON.stringify(left)}` : 'everything is encrypted at rest')
      if (plain) process.exitCode = 1
      break
    }
    case 'rotate-data-key': {
      const force = args.includes('--force')
      const age = heartbeatAge(db)
      if (age !== null && !force) {
        fail(`the server is running (heartbeat ${Math.round(age / 1000)} s ago) — stop it first (docker compose stop one), or pass --force if it really is not running`)
      }
      if (!process.env.NEW_DATA_KEY?.trim()) fail('set NEW_DATA_KEY to the new key (generate one with: openssl rand -base64 32); DATA_KEY is the current one')
      const oldKey = dataKey()
      const newKey = parseKey(process.env.NEW_DATA_KEY, 'NEW_DATA_KEY')
      if (process.env.SECRET && newKey.equals(parseSecretLoose(process.env.SECRET))) fail('NEW_DATA_KEY must not be the same as SECRET')
      const { rewrapped, already } = rewrapAll(db, oldKey, newKey)
      db.checkpoint() // no page image with the old wrapping stays in the WAL
      console.log(`re-wrapped ${rewrapped} workspace key(s)${already ? ` (${already} already used the new key)` : ''}; new key id ${keyId(newKey)}`)
      if (!process.env.DATA_KEY?.trim() && process.env.NODE_ENV !== 'production') {
        writeFileSync(join(dataDir, 'dev-data-key'), newKey.toString('base64'), { mode: 0o600 })
        console.log(`development: ${join(dataDir, 'dev-data-key')} now holds the new key`)
      } else {
        console.log('next: set DATA_KEY to the new key (e.g. in .env), start the server and check it opens the workspaces.')
        console.log('keep the OLD key as long as you keep backups made before today — they need it; destroying it makes them unreadable.')
      }
      break
    }
    default:
      fail(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (err) {
  if (err instanceof ConfigError) fail(err.message)
  throw err
} finally {
  db.close()
}

/** SECRET as the server reads it (hex or base64) — only to refuse a NEW_DATA_KEY equal to it. */
function parseSecretLoose(raw: string): Buffer {
  const s = raw.trim()
  return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64')
}
