/**
 * Admin CLI — works on the same DATA_DIR as the server (safe while it runs: SQLite WAL + busy timeout).
 *   node dist/cli.js <command> [args]
 * In Docker: docker compose exec one node dist/cli.js <command>
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDataDir } from './config.ts'
import { openDb } from './db/index.ts'
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

DATA_DIR: ${resolveDataDir()}
`

const [command, ...args] = process.argv.slice(2)
const dataDir = resolveDataDir()
const dbFile = join(dataDir, 'one.sqlite')

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
// the CLI never hashes tokens, so it needs no SECRET
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
          .all<{ id: string; name: string; plan: string; created_at: number; owner: string | null; members: number; documents: number; files_mb: number }>(
            `SELECT w.id, w.name, w.plan, w.created_at,
               (SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner') AS owner,
               (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members,
               (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id) AS documents,
               (SELECT ROUND(COALESCE(SUM(size), 0) / 1048576.0, 1) FROM files f WHERE f.workspace_id = w.id) AS files_mb
             FROM workspaces w ORDER BY w.created_at`,
          )
          .map((w) => ({ id: w.id, name: w.name, owner: w.owner ?? '', members: w.members, documents: w.documents, files_mb: w.files_mb, plan: w.plan, created: day(w.created_at) })),
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
      break
    }
    default:
      fail(`unknown command "${command}"\n\n${HELP}`)
  }
} finally {
  db.close()
}
