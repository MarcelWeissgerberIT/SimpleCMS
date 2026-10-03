import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { signIn, startServer } from './helpers.ts'

const CLI = new URL('../dist/cli.js', import.meta.url).pathname

test('admin CLI: list, make-owner, revoke-sessions, backup', async () => {
  const server = await startServer()
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { PATH: process.env.PATH, DATA_DIR: server.dataDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const owner = await signIn(server, 'cli-owner@example.com')
    const other = await signIn(server, 'cli-other@example.com')
    const ws = (await owner.post('/api/workspaces', { name: 'CLI Space' })).body

    assert.match(cli('help'), /make-owner/)
    assert.match(cli('list-users'), /cli-other@example\.com/)
    const list = cli('list-workspaces')
    assert.match(list, /CLI Space/)
    assert.match(list, /cli-owner@example\.com/)

    assert.match(cli('make-owner', ws.id, 'cli-other@example.com'), /now owns/)
    const roles = Object.fromEntries((await other.get(`/api/workspaces/${ws.id}/members`)).body.map((m: any) => [m.user.email, m.role]))
    assert.deepEqual(roles, { 'cli-owner@example.com': 'admin', 'cli-other@example.com': 'owner' })

    assert.match(cli('revoke-sessions', 'cli-owner@example.com'), /revoked 1 session/)
    assert.equal((await owner.get('/api/me')).status, 401)

    const target = join(server.dataDir, 'backup-test.sqlite')
    assert.match(cli('backup', target), /backup written/)
    assert.ok(existsSync(target))
    const copy = new DatabaseSync(target, { readOnly: true })
    const row = copy.prepare('SELECT name FROM workspaces WHERE id = ?').get(ws.id) as { name: string }
    copy.close()
    assert.equal(row.name, 'CLI Space')
    assert.throws(() => cli('backup', target), /already exists/)
    assert.throws(() => cli('nonsense'))
  } finally {
    await server.stop()
  }
})
