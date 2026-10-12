/**
 * The workspace's governor (docs/CLOUD.md § Meta document schema → workspace.governor), against a real server: owners
 * and admins change it (the server stamps updatedBy with the real writer); a member writing the meta document's
 * `workspace` map directly (raw Yjs, no app) cannot set, change or remove it — the server puts the value back. Unknown
 * keys of a later slice and a newer shape travel untouched (the guard does not judge the value; the shared sanitizer
 * keeps them). /api/config says the server guards it (`supports` lists 'governor').
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sanitizeGovernor } from '../../src/shared/ai/governor.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

type Gov = Record<string, unknown>

const gov = (day: number, by: string | null = null, extra: Gov = {}): Gov => ({ v: 1, day, month: 120, updatedAt: Date.now(), updatedBy: by, ...extra })

describe('workspace governor: owners and admins only, enforced by the server', () => {
  let server: TestServer
  let ada: Client, bob: Client, cyd: Client
  let adaId: string, bobId: string, cydId: string
  let wsId: string
  let A: DocClient, B: DocClient, C: DocClient
  const open: DocClient[] = []

  const meta = async (client: Client) => {
    const d = openDoc(server, client, `ws:${wsId}`)
    open.push(d)
    await d.synced
    return d
  }
  const govIn = (d: DocClient) => d.doc.getMap('workspace').get('governor') as Gov | undefined
  const dayIn = (d: DocClient) => (govIn(d)?.day as number | undefined) ?? null
  const write = async (d: DocClient, value: Gov | null) => {
    const m = d.doc.getMap('workspace')
    if (value === null) m.delete('governor')
    else m.set('governor', value)
    await flushed(d)
  }
  const stored = async () => {
    const d = await meta(ada)
    const v = govIn(d)
    d.destroy()
    return v
  }

  before(async () => {
    server = await startServer()
    ada = await signIn(server, 'ada@governor.test')
    bob = await signIn(server, 'bob@governor.test')
    cyd = await signIn(server, 'cyd@governor.test')
    adaId = (await ada.get('/api/me')).body.user.id
    bobId = (await bob.get('/api/me')).body.user.id
    cydId = (await cyd.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Nordlicht Regler' })).body.id
    for (const client of [bob, cyd]) {
      const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
      assert.equal((await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })).status, 200)
    ;[A, B, C] = await Promise.all([meta(ada), meta(bob), meta(cyd)])
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('/api/config: the server guards workspace.governor (and still workspace.ai)', async () => {
    const res = await ada.get('/api/config')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.supports) && res.body.supports.includes('governor') && res.body.supports.includes('ai'), JSON.stringify(res.body))
  })

  test('a member cannot set a budget: the key is taken away again', async () => {
    await write(B, gov(50, bobId))
    await waitFor(() => govIn(B) === undefined, 5000, 'put back on the writer')
    await sleep(400)
    assert.equal(govIn(A), undefined)
    assert.equal(await stored(), undefined)
    assert.match(server.logs(), /workspace governor change put back/)
  })

  test('the owner sets it; the server stamps the real writer; unknown keys travel; the shared sanitizer keeps them', async () => {
    await write(A, gov(6, bobId, { lever2: { note: 'a later slice' } }))
    await waitFor(() => govIn(B)?.updatedBy === adaId, 5000, 'stamped for everyone')
    const s = await stored()
    assert.deepEqual([dayIn(A), s?.updatedBy, (s?.lever2 as Gov | undefined)?.note], [6, adaId, 'a later slice'])
    assert.deepEqual(sanitizeGovernor(s), { ...s })
  })

  test('a member can neither raise nor remove the owner’s budget; an admin can', async () => {
    await write(B, gov(500, bobId))
    await waitFor(() => dayIn(B) === 6, 5000, 'the owner’s budget comes back')
    await write(B, null)
    await waitFor(() => dayIn(B) === 6, 5000, 'a removal is undone')
    assert.equal(dayIn(await meta(ada)), 6)

    await write(C, gov(8, null))
    await waitFor(() => govIn(A)?.updatedBy === cydId && dayIn(A) === 8, 5000, 'the admin’s budget reaches the owner')
    await write(C, null)
    await waitFor(() => govIn(A) === undefined && govIn(B) === undefined, 5000, 'an admin may remove it')
  })

  test('a newer shape (v 2) is kept whole by the guard; the AI rules and the name keep their own rules', async () => {
    await write(A, { v: 2, day: 6, dial: { future: true } })
    await waitFor(() => govIn(B)?.v === 2, 5000, 'the newer shape reaches the member')
    assert.deepEqual((govIn(B)?.dial as Gov | undefined) ?? null, { future: true })
    // the AI guard watches its own key: a member's AI rules are still put back
    B.doc.getMap('workspace').set('ai', { gen: 1, updatedBy: bobId })
    await flushed(B)
    await waitFor(() => B.doc.getMap('workspace').get('ai') === undefined, 5000, 'AI rules put back')
    // the name stays writable for members
    B.doc.getMap('workspace').set('name', 'Nordlicht Regler (renamed)')
    await flushed(B)
    await waitFor(() => A.doc.getMap('workspace').get('name') === 'Nordlicht Regler (renamed)', 5000, 'name reaches the owner')
  })
})
