import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client, openDoc, signIn, startServer, waitFor, type DocClient } from './helpers.ts'

test('presence is authenticated, shared-membership scoped, deduplicated and expires on disconnect/revocation', async () => {
  const server = await startServer()
  const docs: DocClient[] = []
  try {
    const owner = await signIn(server, 'owner@presence.test')
    const member = await signIn(server, 'member@presence.test')
    const stranger = await signIn(server, 'stranger@presence.test')
    const uid = (await member.get('/api/me')).body.user.id
    await member.patch('/api/me', { name: 'Nadine Test' })
    const ws = (await owner.post('/api/workspaces', { name: 'Shared' })).body.id
    const second = (await owner.post('/api/workspaces', { name: 'Also shared' })).body.id
    const secret = (await member.post('/api/workspaces', { name: 'Not shared' })).body.id
    for (const id of [ws, second]) {
      const inv = await owner.post(`/api/workspaces/${id}/invites`, { role: 'member' })
      assert.equal((await member.post(`/api/invites/${inv.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    const connect = async (client: Client, name: string) => {
      const d = openDoc(server, client, name)
      docs.push(d)
      await d.synced
      return d
    }
    const snapshot = async (client = owner) => (await client.get('/api/workspaces/presence')).body
    const people = async (id = ws) => (await snapshot()).workspaces.find((w: { id: string }) => w.id === id)?.people
    assert.equal((await new Client(server.url).get('/api/workspaces/presence')).status, 401)
    await connect(member, `ws:${ws}:u:${uid}`)
    await connect(member, `ws:${ws}:u:${uid}:p:private-title-never-exposed`)
    assert.deepEqual(await people(), []) // private/background documents alone do not announce presence
    const first = await connect(member, `ws:${ws}`)
    const duplicate = await connect(member, `ws:${ws}`)
    await connect(owner, `ws:${ws}`)
    await connect(member, `ws:${second}`)
    await connect(member, `ws:${secret}`)
    await waitFor(async () => (await people()).length === 1)
    assert.deepEqual(await people(), [{ id: uid, name: 'Nadine Test' }])
    assert.deepEqual(await people(second), [{ id: uid, name: 'Nadine Test' }])
    // Client awareness cannot forge another person's server-side identity.
    first.provider.awareness?.setLocalState({ user: { id: 'forged-id', name: 'Pretend Admin' }, pageId: 'private-page' })
    const res = await owner.get('/api/workspaces/presence')
    assert.equal(res.res.headers.get('cache-control'), 'private, no-store')
    assert.equal(res.body.workspaces.length, 2)
    assert.ok(!JSON.stringify(res.body).match(/private-|forged|Pretend|Not shared|email|session|pageId/))
    assert.deepEqual((await snapshot(stranger)).workspaces, [])
    first.destroy()
    assert.deepEqual(await people(), [{ id: uid, name: 'Nadine Test' }])
    duplicate.destroy()
    await waitFor(async () => (await people()).length === 0)
    assert.equal((await owner.del(`/api/workspaces/${second}/members/${uid}`)).status, 204)
    await waitFor(async () => (await people(second)).length === 0)
    assert.ok(!(await snapshot(member)).workspaces.some((w: { id: string }) => w.id === second))
    await connect(member, `ws:${ws}`)
    assert.equal((await member.post('/api/auth/logout')).status, 204)
    await waitFor(async () => (await people()).length === 0)
  } finally {
    docs.forEach(d => d.destroy())
    await server.stop()
  }
})
