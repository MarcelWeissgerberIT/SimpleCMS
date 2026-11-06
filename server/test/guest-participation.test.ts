import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { Client, flushed, openDoc, signIn, startServer, waitFor, type TestServer } from './helpers.ts'

let server: TestServer
before(async () => { server = await startServer({ CODING_RELAY: 'on' }) })
after(async () => { await server.stop() })
const grant = (client: Client, ws: string, emails: string[], expiresAt: number | null) => client.fetch(`/api/workspaces/${ws}/guest-participation`, { method: 'PUT', json: { emails, expiresAt } })

test('named guest can participate, work and use own worker only until expiry, including existing sockets', async () => {
  const owner = await signIn(server, 'workshop-owner@example.test'), guest = await signIn(server, 'workshop-guest@example.test'), outsider = await signIn(server, 'uninvited@example.test')
  const ws = (await owner.post('/api/workspaces', { name: 'Guest workshop' })).body.id
  const invite = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'viewer', guest: true, email: 'workshop-guest@example.test' })).body
  const expiresAt = Date.now() + 3600_000
  // Preconfigure a personal pending invitation; no new mail or user is needed.
  assert.equal((await grant(owner, ws, ['workshop-guest@example.test'], expiresAt)).status, 200)
  assert.equal((await grant(owner, ws, ['uninvited@example.test'], expiresAt)).status, 400)
  await guest.post('/api/invites/' + invite.link.split('#/invite/')[1] + '/accept')
  const user = (await guest.get('/api/me')).body.user
  const membership = (await guest.get('/api/me')).body.workspaces.find((w: any) => w.id === ws)
  assert.equal(membership.role, 'member'); assert.equal(membership.participation_until, expiresAt)
  const base = (await owner.get(`/api/workspaces/${ws}/members`)).body.find((m: any) => m.user.id === user.id)
  assert.equal(base.role, 'viewer'); assert.equal(base.guest, true)
  assert.equal((await grant(guest, ws, [user.email], Date.now() + 7200_000)).status, 403)
  assert.equal((await guest.patch(`/api/workspaces/${ws}`, { name: 'Guest cannot administer' })).status, 403)
  const workerToken = await guest.post(`/api/workspaces/${ws}/coding/workers`, {})
  assert.equal(workerToken.status, 201)
  const worker = new WebSocket(server.url.replace(/^http/, 'ws') + '/coding/worker', { protocols: ['one-worker.v1'], headers: { authorization: 'Bearer ' + workerToken.body.token, 'x-one-workspace': 'team:' + ws } } as unknown as string[])
  let workerClosed: number | undefined
  worker.onclose = event => { workerClosed = event.code }
  await new Promise<void>((resolve, reject) => { worker.onopen = () => resolve(); worker.onerror = () => reject(Error('Worker did not connect')) })
  assert.equal((await outsider.post(`/api/workspaces/${ws}/coding/workers`, {})).status, 404)
  const doc = openDoc(server, guest, `ws:${ws}`), observer = openDoc(server, owner, `ws:${ws}`)
  try {
    assert.equal(await doc.ready, 'read-write'); await doc.synced; await observer.synced
    doc.doc.getMap('settings').set('guestTest', 'allowed before expiry'); await flushed(doc)
    await waitFor(() => observer.doc.getMap('settings').get('guestTest') === 'allowed before expiry')
    const db = new DatabaseSync(join(server.dataDir, 'one.sqlite'))
    try { db.prepare('UPDATE guest_participation SET expires_at=? WHERE workspace_id=?').run(Date.now() - 1, ws) } finally { db.close() }
    assert.equal((await guest.get('/api/me')).body.workspaces.find((w: any) => w.id === ws).role, 'viewer')
    assert.equal((await guest.post(`/api/workspaces/${ws}/coding/workers`, {})).status, 403)
    worker.send('{}') // an already connected worker cannot forward a new frame after expiry
    await waitFor(() => workerClosed !== undefined)
    assert.equal(workerClosed, 4403)
    doc.doc.getMap('settings').set('guestTest', 'must not reach server')
    await waitFor(() => doc.closes.length > 0)
    assert.equal(observer.doc.getMap('settings').get('guestTest'), 'allowed before expiry')
  } finally { doc.destroy(); observer.destroy(); worker.close() }
})

test('grants persist across restart; revocation and regular role changes remove the temporary elevation', async () => {
  const owner = await signIn(server, 'expiry-owner@example.test'), guest = await signIn(server, 'expiry-guest@example.test')
  const ws = (await owner.post('/api/workspaces', { name: 'Persistent grant' })).body.id
  const i = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'viewer', guest: true, email: 'expiry-guest@example.test' })).body
  await guest.post('/api/invites/' + i.link.split('#/invite/')[1] + '/accept')
  const uid = (await guest.get('/api/me')).body.user.id
  assert.equal((await grant(owner, ws, ['expiry-guest@example.test'], Date.now() + 3600_000)).status, 200)
  const dir = server.dataDir; await server.stop(); server = await startServer({ CODING_RELAY: 'on' }, dir)
  const o = await signIn(server, 'expiry-owner@example.test'), g = await signIn(server, 'expiry-guest@example.test')
  assert.equal((await g.get('/api/me')).body.workspaces.find((w: any) => w.id === ws).role, 'member')
  assert.equal((await grant(o, ws, ['expiry-guest@example.test'], null)).status, 200)
  assert.equal((await g.get('/api/me')).body.workspaces.find((w: any) => w.id === ws).role, 'viewer')
  assert.equal((await grant(o, ws, ['expiry-guest@example.test'], Date.now() + 8 * 86400_000)).status, 400)
  await grant(o, ws, ['expiry-guest@example.test'], Date.now() + 3600_000)
  await o.patch(`/api/workspaces/${ws}/members/${uid}`, { role: 'viewer', guest: true })
  assert.equal((await g.get('/api/me')).body.workspaces.find((w: any) => w.id === ws).role, 'viewer')
  assert.equal((await o.get(`/api/workspaces/${ws}/guest-participation`)).body.length, 0)
})
