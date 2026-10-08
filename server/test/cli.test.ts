import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { signIn, startServer, waitFor } from './helpers.ts'

const CLI = new URL('../dist/cli.js', import.meta.url).pathname
const execFileAsync = promisify(execFile)

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

test('admin CLI: revoke-workers stops a cloud coding worker (revoke-sessions does not)', async () => {
  // a short sweep: the relay notices a token the CLI revoked (another process) at once
  const server = await startServer({ CODING_PING_MS: '200' })
  // asynchronous: a blocked test process could not answer the relay's 200 ms pings (the socket would go as dead, 1006)
  const cli = async (...args: string[]) =>
    (await execFileAsync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { PATH: process.env.PATH, DATA_DIR: server.dataDir }, encoding: 'utf8' })).stdout
  try {
    const ada = await signIn(server, 'cli-worker@example.com')
    const ws = (await ada.post('/api/workspaces', { name: 'Workers' })).body
    const { token } = (await ada.post(`/api/workspaces/${ws.id}/coding/workers`, {})).body
    const sock = new WebSocket(`${server.url.replace(/^http/, 'ws')}/coding/worker`, { protocols: ['one-worker.v1'], headers: { authorization: `Bearer ${token}`, 'x-one-workspace': `team:${ws.id}` } } as unknown as string[])
    let closed: { code: number; reason: string } | null = null
    let ready = false
    sock.onmessage = () => (ready = true)
    sock.onclose = (e) => (closed = { code: e.code, reason: e.reason })
    await waitFor(() => ready, 5000, 'worker ready')
    assert.match(await cli('help'), /revoke-workers/)
    assert.match(await cli('revoke-sessions', 'cli-worker@example.com'), /cloud coding workers keep running/)
    await new Promise((r) => setTimeout(r, 800))
    assert.equal(closed, null, 'signing out does not stop the worker')
    await assert.rejects(cli('revoke-workers', 'nobody@example.com'))
    assert.match(await cli('revoke-workers', 'cli-worker@example.com', ws.id), /revoked 1 cloud worker token/)
    await waitFor(() => closed !== null, 5000, 'worker closed')
    assert.deepEqual(closed, { code: 4401, reason: 'revoked' })
    assert.equal((await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer ${token}` } })).status, 401)
  } finally {
    await server.stop()
  }
})
