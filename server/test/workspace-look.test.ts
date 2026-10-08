/**
 * The workspace look (docs/CLOUD.md § Meta document schema → workspace.look), against a real server: owners and
 * admins change it (the server stamps updatedBy with the real writer); a member writing the meta document's
 * `workspace` map directly (raw Yjs, no app) cannot set, change or remove it — the server puts the value back and
 * every copy converges on the owner's look; deletes a member plants for clocks that do not exist yet (Yjs pending
 * delete sets, replayed inside someone else's later update) cannot take it away either; a role change applies to
 * open sockets at once (demoted: put back; promoted / new owner: allowed); the workspace name stays writable.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import type { Logger } from '../src/log.ts'
import { guardWorkspaceLook } from '../src/collab/workspace-look.ts'
import { Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

type Look = Record<string, unknown>

const varUint = (n: number): number[] => {
  const out: number[] = []
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f))
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
/** A raw Yjs update (v1) with no structs and one delete range — for clocks that need not exist yet. */
const deletesAhead = (client: number, clock: number, len: number) => new Uint8Array([0, 1, ...varUint(client), 1, ...varUint(clock), ...varUint(len)])

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

  const signal = (d: DocClient) => (lookIn(d)?.colors as Look | undefined)?.signal
  const rename = async (d: DocClient, name: string) => {
    d.doc.getMap('workspace').set('name', name)
    await flushed(d)
    await sleep(300)
  }

  test('deletes a member plants for the server’s next clocks cannot take the look away', async () => {
    await write(A, look('#1f4fd1', bobId))
    await waitFor(() => lookIn(B)?.updatedBy === adaId, 5000, 'stamped by the server')
    // the stamp is the server's own struct: its Yjs client id is visible to every member
    const item = B.doc.getMap('workspace')._map.get('look')
    assert.ok(item)
    const serverClient = item.id.client
    assert.notEqual(serverClient, A.doc.clientID)
    B.provider.documentUpdateHandler(deletesAhead(serverClient, Y.getState(B.doc.store, serverClient), 1_000_000), null)
    await flushed(B)
    // bob's write is put back by the server — with a struct his waiting deletes name
    await write(B, look('#00704a', bobId))
    await waitFor(() => signal(B) === '#1f4fd1', 5000, 'put back')
    // an unrelated edit of the owner replays bob's deletes: the look stays
    await rename(A, 'Look Co (tick 1)')
    await rename(A, 'Look Co (tick 2)')
    for (const d of [A, B, C]) assert.equal(signal(d), '#1f4fd1')
    const s = await stored()
    assert.deepEqual([(s?.colors as Look | undefined)?.signal, s?.updatedBy], ['#1f4fd1', adaId])
  })

  test('deletes a member plants for an admin’s next clocks cannot take the admin’s new look away', async () => {
    await flushed(C)
    B.provider.documentUpdateHandler(deletesAhead(C.doc.clientID, Y.getState(C.doc.store, C.doc.clientID), 1_000_000), null)
    await flushed(B)
    await write(C, look('#e0a000', null))
    await waitFor(() => signal(A) === '#e0a000' && lookIn(A)?.updatedBy === cydId, 5000, 'the admin’s look survives')
    await rename(A, 'Look Co (tick 3)')
    for (const d of [A, B, C]) assert.equal(signal(d), '#e0a000')
    const s = await stored()
    assert.deepEqual([(s?.colors as Look | undefined)?.signal, s?.updatedBy], ['#e0a000', cydId])
  })

  test('a role change applies to open sockets: demoted → put back, promoted / new owner → allowed', async () => {
    const D = await meta(cyd)
    const demoted = await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'member' })
    assert.equal(demoted.status, 200, JSON.stringify(demoted.body))
    // the app refreshes its role on this close (cloud/workspace.ts handleClose → refreshRole)
    await waitFor(() => D.closes.includes('role-changed') && C.closes.includes('role-changed'), 5000, 'role-changed close')
    const D2 = await meta(cyd)
    await write(D2, look('#d4006e', cydId))
    await waitFor(() => signal(D2) === '#e0a000', 5000, 'a demoted admin’s look is put back')

    const promoted = await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })
    assert.equal(promoted.status, 200)
    await waitFor(() => D2.closes.includes('role-changed'), 5000, 'role-changed close on promotion')
    const D3 = await meta(cyd)
    await write(D3, look('#00704a', null))
    await waitFor(() => signal(A) === '#00704a' && lookIn(A)?.updatedBy === cydId, 5000, 'a promoted admin styles at once')

    // ownership to a member: their sockets reconnect as owner; the old owner (now admin) keeps styling
    const handed = await ada.patch(`/api/workspaces/${wsId}/members/${bobId}`, { role: 'owner' })
    assert.equal(handed.status, 200)
    await waitFor(() => B.closes.includes('role-changed'), 5000, 'the new owner’s sockets reconnect')
    const B2 = await meta(bob)
    await write(B2, look('#d4006e', null))
    await waitFor(() => signal(A) === '#d4006e' && lookIn(A)?.updatedBy === bobId, 5000, 'the new owner styles')
    await write(A, look('#1f4fd1', null))
    await waitFor(() => signal(B2) === '#1f4fd1' && lookIn(B2)?.updatedBy === adaId, 5000, 'the old owner, now admin, still styles')
  })
})

describe('the look guard reads the role at every change', () => {
  const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  /** A transaction origin as Hocuspocus makes it for a member's socket (role = the one it opened with). */
  const from = (userId: string, role: string) => ({ source: 'connection', connection: { context: { userId, role } } })
  const sync = (a: Y.Doc, b: Y.Doc, origin: unknown = null) => Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), origin)

  test('a socket opened as admin loses the right the moment the role changes (and gets it back)', () => {
    const roles = new Map<string, string>([['ada', 'owner'], ['cyd', 'admin']])
    const server = new Y.Doc()
    const stop = guardWorkspaceLook(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    const cyd = new Y.Doc()
    const socket = from('cyd', 'admin')
    const signalOf = () => ((server.getMap('workspace').get('look') as Look | undefined)?.colors as Look | undefined)?.signal

    cyd.getMap('workspace').set('look', look('#1f4fd1'))
    sync(cyd, server, socket)
    assert.equal(signalOf(), '#1f4fd1')
    assert.equal((server.getMap('workspace').get('look') as Look).updatedBy, 'cyd')

    roles.set('cyd', 'member')
    sync(server, cyd)
    cyd.getMap('workspace').set('look', look('#d4006e'))
    sync(cyd, server, socket)
    assert.equal(signalOf(), '#1f4fd1', 'put back: the socket still says admin, the workspace does not')

    roles.set('cyd', 'admin')
    sync(server, cyd)
    cyd.getMap('workspace').set('look', look('#00704a'))
    sync(cyd, server, socket)
    assert.equal(signalOf(), '#00704a')
    stop()
  })
})
