/**
 * The workspace look (docs/CLOUD.md § Meta document schema → workspace.look), against a real server: owners and
 * admins change it (the server stamps updatedBy with the real writer); a member writing the meta document's
 * `workspace` map directly (raw Yjs, no app) cannot set, change or remove it — the server puts the value back and
 * every copy converges on the owner's look; the workspace name stays writable as before.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

type Look = Record<string, unknown>

const look = (signal: string, by: string | null = null): Look => ({
  preset: 'blueprint',
  colors: { paper: '#edf0f2', ink: '#0e1a2b', signal },
  fonts: { ui: 'archivo', text: 'ui', headings: 'condensed' },
  corners: 'standard',
  updatedAt: Date.now(),
  updatedBy: by,
})

describe('the workspace look: owners and admins only, enforced by the server', () => {
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
  const lookIn = (d: DocClient) => d.doc.getMap('workspace').get('look') as Look | undefined
  const write = async (d: DocClient, value: Look | null) => {
    const m = d.doc.getMap('workspace')
    if (value === null) m.delete('look')
    else m.set('look', value)
    await flushed(d)
  }
  /** The server's copy: what a fresh connection receives. */
  const stored = async () => {
    const d = await meta(ada)
    const v = lookIn(d)
    d.destroy()
    return v
  }

  before(async () => {
    server = await startServer()
    ada = await signIn(server, 'ada@look.test')
    bob = await signIn(server, 'bob@look.test')
    cyd = await signIn(server, 'cyd@look.test')
    adaId = (await ada.get('/api/me')).body.user.id
    bobId = (await bob.get('/api/me')).body.user.id
    cydId = (await cyd.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Look Co' })).body.id
    for (const [client, role] of [
      [bob, 'member'],
      [cyd, 'admin'],
    ] as const) {
      const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: role === 'admin' ? 'member' : role })
      assert.equal((await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    // cyd becomes an admin (invites are never admin)
    const members = (await ada.get(`/api/workspaces/${wsId}/members`)).body as Array<{ user: { id: string } }>
    assert.ok(members.some((m) => m.user.id === cydId))
    const promoted = await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })
    assert.equal(promoted.status, 200, JSON.stringify(promoted.body))
    ;[A, B, C] = await Promise.all([meta(ada), meta(bob), meta(cyd)])
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('a member cannot set the look: the key is taken away again', async () => {
    await write(B, look('#d4006e', bobId))
    await waitFor(() => lookIn(B) === undefined, 5000, 'put back on the writer')
    await sleep(400)
    assert.equal(lookIn(A), undefined)
    assert.equal(await stored(), undefined)
    assert.match(server.logs(), /workspace look change put back/)
  })

  test('the owner sets it; the server stamps the real writer (a claimed one is replaced)', async () => {
    await write(A, look('#1f4fd1', bobId))
    await waitFor(() => lookIn(B)?.updatedBy === adaId, 5000, 'stamped for everyone')
    const s = await stored()
    assert.deepEqual([(s?.colors as Look | undefined)?.signal, s?.updatedBy], ['#1f4fd1', adaId])
  })

  test('a member can neither change nor remove the owner’s look; an admin can', async () => {
    await write(B, look('#00704a', bobId))
    await waitFor(() => (lookIn(B)?.colors as Look | undefined)?.signal === '#1f4fd1', 5000, 'the owner’s look comes back')
    await write(B, null)
    await waitFor(() => (lookIn(B)?.colors as Look | undefined)?.signal === '#1f4fd1', 5000, 'a removal is undone')
    assert.equal(((await stored())?.colors as Look | undefined)?.signal, '#1f4fd1')

    await write(C, look('#e0a000', null))
    await waitFor(() => lookIn(A)?.updatedBy === cydId && (lookIn(A)?.colors as Look | undefined)?.signal === '#e0a000', 5000, 'the admin’s look reaches the owner')
    await write(C, null)
    await waitFor(() => lookIn(A) === undefined && lookIn(B) === undefined, 5000, 'an admin may reset to standard')
  })

  test('the workspace name is not guarded (members keep it in step with the server, as before)', async () => {
    B.doc.getMap('workspace').set('name', 'Look Co (renamed)')
    await flushed(B)
    await waitFor(() => A.doc.getMap('workspace').get('name') === 'Look Co (renamed)', 5000, 'name reaches the owner')
  })
})
