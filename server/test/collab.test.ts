import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, test } from 'node:test'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

let server: TestServer
let owner: Client, member: Client, viewer: Client, outsider: Client
let wsId: string
let memberId: string
const open: DocClient[] = []

const doc = (client: Client | null, name: string, headers?: Record<string, string>) => {
  const d = openDoc(server, client, name, headers)
  open.push(d)
  return d
}

before(async () => {
  server = await startServer()
  owner = await signIn(server, 'owner@collab.test')
  member = await signIn(server, 'member@collab.test')
  viewer = await signIn(server, 'viewer@collab.test')
  outsider = await signIn(server, 'outsider@collab.test')
  wsId = (await owner.post('/api/workspaces', { name: 'Realtime' })).body.id
  for (const [client, role] of [
    [member, 'member'],
    [viewer, 'viewer'],
  ] as const) {
    const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
    await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
  }
  memberId = (await member.get('/api/me')).body.user.id
})

after(async () => {
  for (const d of open) d.destroy()
  await server.stop()
})

test('members write to the meta document, viewers are read-only', async () => {
  const meta = `ws:${wsId}`
  const o = doc(owner, meta)
  const m = doc(member, meta)
  const v = doc(viewer, meta)
  assert.equal(await o.ready, 'read-write')
  assert.equal(await m.ready, 'read-write')
  assert.equal(await v.ready, 'readonly')
  await Promise.all([o.synced, m.synced, v.synced])

  const page = new Y.Map<unknown>()
  m.doc.transact(() => {
    page.set('title', 'From member')
    m.doc.getMap('pages').set('page1', page)
  })
  await waitFor(() => (o.doc.getMap('pages').get('page1') as Y.Map<unknown> | undefined)?.get('title') === 'From member', 5000, 'member edit at owner')
  await waitFor(() => v.doc.getMap('pages').has('page1'), 5000, 'viewers still receive updates')

  v.doc.getMap('pages').set('evil', 'viewer write')
  await sleep(400)
  assert.equal(o.doc.getMap('pages').has('evil'), false, 'viewer write was not applied')
  const fresh = doc(owner, meta)
  await fresh.synced
  assert.equal(fresh.doc.getMap('pages').has('page1'), true)
  assert.equal(fresh.doc.getMap('pages').has('evil'), false)
})

test('two clients editing the same page converge', async () => {
  const name = `ws:${wsId}:p:abc123def456`
  const a = doc(owner, name)
  const b = doc(member, name)
  await Promise.all([a.synced, b.synced])
  const ta = a.doc.getText('t')
  const tb = b.doc.getText('t')
  // concurrent edits from both sides, including into the XmlFragment the editor uses
  for (let i = 0; i < 20; i++) {
    ta.insert(0, `a${i} `)
    tb.insert(tb.length, ` b${i}`)
  }
  const pa = new Y.XmlElement('paragraph')
  pa.insert(0, [new Y.XmlText('hello from A')])
  a.doc.getXmlFragment('default').insert(0, [pa])
  const pb = new Y.XmlElement('paragraph')
  pb.insert(0, [new Y.XmlText('hello from B')])
  b.doc.getXmlFragment('default').insert(0, [pb])

  await waitFor(() => ta.toString() === tb.toString() && ta.toString().includes('a19') && ta.toString().includes('b19'), 5000, 'text convergence')
  await waitFor(() => a.doc.getXmlFragment('default').length === 2 && b.doc.getXmlFragment('default').length === 2, 5000, 'fragment convergence')
  assert.equal(a.doc.getXmlFragment('default').toString(), b.doc.getXmlFragment('default').toString())
  assert.deepEqual(Y.encodeStateVector(a.doc), Y.encodeStateVector(b.doc))
})

test('non-members and malformed document names are rejected', async () => {
  await assert.rejects(doc(outsider, `ws:${wsId}`).ready, /forbidden/)
  await assert.rejects(doc(outsider, `ws:${wsId}:p:page1`).ready, /forbidden/)
  for (const name of ['other', `ws:${wsId}:x:1`, `ws:${wsId}:p:`, `ws:${wsId}:p:../../etc`, 'ws:short', `ws:${wsId}:p:a:b`]) {
    await assert.rejects(doc(owner, name).ready, /invalid-document/, name)
  }
})

test('the upgrade itself needs a session, the right path and our origin', async () => {
  const upgrade = (path: string, headers: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const req = request(`${server.url}${path}`, {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
      })
      req.on('upgrade', (res, socket) => {
        socket.destroy()
        resolve(res.statusCode ?? 0)
      })
      req.on('response', (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
  const cookie = owner.cookieHeader()
  assert.equal(await upgrade('/collab'), 401)
  assert.equal(await upgrade('/collab', { cookie: 'one_session=forged' }), 401)
  assert.equal(await upgrade('/somewhere', { cookie }), 404)
  assert.equal(await upgrade('/collab', { cookie, origin: 'https://evil.example' }), 403)
  assert.equal(await upgrade('/collab', { cookie, origin: server.url }), 101)
})

test('a removed member is disconnected at once', async () => {
  const meta = `ws:${wsId}`
  const pageName = `ws:${wsId}:p:removal`
  const o = doc(owner, meta)
  const mMeta = doc(member, meta)
  const mPage = doc(member, pageName)
  await Promise.all([o.synced, mMeta.synced, mPage.synced])

  const removed = await owner.del(`/api/workspaces/${wsId}/members/${memberId}`)
  assert.equal(removed.status, 204)
  await waitFor(() => mMeta.closes.includes('membership-revoked') && mPage.closes.includes('membership-revoked'), 5000, 'close messages')

  mMeta.doc.getMap('pages').set('after-removal', 'should not arrive')
  await sleep(400)
  assert.equal(o.doc.getMap('pages').has('after-removal'), false)
  await assert.rejects(doc(member, meta).ready, /forbidden/)
})

test('a role change reconnects with the new rights', async () => {
  const viewerId = (await viewer.get('/api/me')).body.user.id
  const meta = `ws:${wsId}`
  const v = doc(viewer, meta)
  assert.equal(await v.ready, 'readonly')
  await v.synced
  await owner.patch(`/api/workspaces/${wsId}/members/${viewerId}`, { role: 'member' })
  await waitFor(() => v.closes.includes('role-changed'), 5000, 'role-changed close')
  const again = doc(viewer, meta)
  assert.equal(await again.ready, 'read-write')
  again.doc.getMap('pages').set('by-promoted', 1)
  await flushed(again)
})

test('logging out closes that session’s sockets', async () => {
  const temp = await signIn(server, 'owner@collab.test')
  const d = doc(temp, `ws:${wsId}`)
  await d.synced
  await temp.post('/api/auth/logout')
  await waitFor(() => d.closes.includes('session-ended'), 5000, 'session-ended close')
})
