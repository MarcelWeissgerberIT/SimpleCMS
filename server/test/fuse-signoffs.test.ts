/**
 * The Patchbay's allowed paths (docs/CLOUD.md § Meta document schema → fuseSignoffs), against a real server: owners
 * and admins allow and withdraw paths (the server stamps updatedBy with the real writer — "Allowed by …" cannot be
 * forged); a member writing the meta document's `fuseSignoffs` map directly (raw Yjs, no app) cannot add, change or
 * withdraw an entry — the server puts it back; an entry smuggled in as waiting ("pending") structs that the owner's own
 * update releases is still the member's and goes; deletes a member plants for the next clocks of the server or of an
 * admin cannot take an allowance away; a role change applies to open sockets at once. /api/config says the server
 * guards the map (`supports` lists 'signoffs'). Fix (rest): a nested Yjs value is flattened (an admin's, stamped) or put
 * back, a change inside one from before the guard counts as its key's; the first load under the guard drops what an
 * older server let in. Path keys and signatures are made-up hex; the names are fictional.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import type { Logger } from '../src/log.ts'
import { guardFuseSignoffs } from '../src/collab/fuse-signoffs.ts'
import { Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

type Entry = Record<string, unknown>

/** A path key / signature: 64 hex from one letter (made up). */
const hex = (c: string) => c.repeat(64)
const K1 = hex('a')
const K2 = hex('b')
const K3 = hex('c')
const entry = (sig: string, by: string | null = null): Entry => ({ sig: hex(sig), parts: { d: 'd'.repeat(16), x: 'e'.repeat(16) }, at: Date.now(), updatedBy: by })

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

describe('the Patchbay’s allowed paths: owners and admins only, enforced by the server', () => {
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
  const map = (d: DocClient) => d.doc.getMap<unknown>('fuseSignoffs')
  const at = (d: DocClient, key: string) => map(d).get(key) as Entry | undefined
  const sigAt = (d: DocClient, key: string) => (at(d, key)?.sig as string | undefined) ?? null
  const write = async (d: DocClient, key: string, value: Entry | null) => {
    if (value === null) map(d).delete(key)
    else map(d).set(key, value)
    await flushed(d)
  }
  /** The server's copy: what a fresh connection receives. */
  const stored = async (key: string) => {
    const d = await meta(ada)
    const v = at(d, key)
    d.destroy()
    return v
  }
  const tick = async (d: DocClient, name: string) => {
    d.doc.getMap('workspace').set('name', name)
    await flushed(d)
    await sleep(300)
  }

  before(async () => {
    server = await startServer()
    ada = await signIn(server, 'ada@signoffs.test')
    bob = await signIn(server, 'bob@signoffs.test')
    cyd = await signIn(server, 'cyd@signoffs.test')
    adaId = (await ada.get('/api/me')).body.user.id
    bobId = (await bob.get('/api/me')).body.user.id
    cydId = (await cyd.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Nordlicht Schaltplan' })).body.id
    for (const client of [bob, cyd]) {
      const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
      assert.equal((await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    // cyd becomes an admin (invites are never admin)
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })).status, 200)
    ;[A, B, C] = await Promise.all([meta(ada), meta(bob), meta(cyd)])
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('/api/config: the server guards the allowed paths (and still workspace.ai and the governor)', async () => {
    const res = await ada.get('/api/config')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.supports), JSON.stringify(res.body))
    for (const what of ['ai', 'governor', 'signoffs']) assert.ok(res.body.supports.includes(what), `${what} in ${JSON.stringify(res.body.supports)}`)
  })

  test('a member cannot allow a path: the entry is taken away again', async () => {
    await write(B, K1, entry('1', bobId))
    await waitFor(() => at(B, K1) === undefined, 5000, 'put back on the writer')
    await sleep(400)
    assert.equal(at(A, K1), undefined)
    assert.equal(await stored(K1), undefined)
    assert.match(server.logs(), /fuse sign-off change put back/)
  })

  test('the owner allows one; the server stamps the real writer (a claimed one is replaced)', async () => {
    await write(A, K1, entry('1', bobId))
    await waitFor(() => at(B, K1)?.updatedBy === adaId, 5000, 'stamped for everyone')
    const s = await stored(K1)
    assert.deepEqual([s?.sig, s?.updatedBy, (s?.parts as Entry | undefined)?.d], [hex('1'), adaId, 'd'.repeat(16)])
  })

  test('a member can neither change nor withdraw the owner’s allowance; an admin can — every key of the map alike', async () => {
    await write(B, K1, entry('2', bobId))
    await waitFor(() => sigAt(B, K1) === hex('1'), 5000, 'the owner’s allowance comes back')
    await write(B, K1, null)
    await waitFor(() => sigAt(B, K1) === hex('1'), 5000, 'a withdrawal is undone')
    assert.equal((await stored(K1))?.sig, hex('1'))
    // another key: the same rule (the whole map is guarded, not one key)
    await write(B, K2, entry('3', null))
    await waitFor(() => at(B, K2) === undefined, 5000, 'a second key is put back too')

    await write(C, K2, entry('4', null))
    await waitFor(() => at(A, K2)?.updatedBy === cydId && sigAt(A, K2) === hex('4'), 5000, 'the admin’s allowance reaches the owner')
    await write(C, K1, null)
    await waitFor(() => at(A, K1) === undefined && at(B, K1) === undefined, 5000, 'an admin may withdraw the owner’s')
    assert.equal(await stored(K1), undefined)
    // the workspace name stays writable for members (only the guarded keys are)
    await tick(B, 'Nordlicht Schaltplan (renamed)')
    await waitFor(() => A.doc.getMap('workspace').get('name') === 'Nordlicht Schaltplan (renamed)', 5000, 'name reaches the owner')
  })

  test('an entry hidden in waiting structs is the member’s even when the owner’s update releases it: put back', async () => {
    // bob forges structs under ada's Yjs client id one clock ahead: they wait for her next change and would be applied
    // inside her transaction
    const forge = new Y.Doc()
    Y.applyUpdate(forge, Y.encodeStateAsUpdate(A.doc))
    forge.clientID = A.doc.clientID
    forge.getMap('filler').set('gap', 1)
    const sv = Y.encodeStateVector(forge)
    forge.getMap('fuseSignoffs').set(K3, entry('5', adaId))
    B.provider.documentUpdateHandler(Y.encodeStateAsUpdate(forge, sv), null)
    await flushed(B)
    await sleep(300)
    assert.equal(at(A, K3), undefined, 'waiting, not applied')
    // ada changes something else: her update releases bob's structs — the guard counts them as bob's
    A.doc.getMap('misc').set('tick', 1)
    await flushed(A)
    await sleep(500)
    for (const d of [A, B, C]) assert.equal(at(d, K3), undefined)
    assert.equal(await stored(K3), undefined)
  })

  test('deletes a member plants for the server’s or an admin’s next clocks cannot take an allowance away', async () => {
    await write(A, K1, entry('6', null))
    await waitFor(() => at(B, K1)?.updatedBy === adaId, 5000, 'stamped by the server')
    // the stamp is the server's own struct: its Yjs client id is visible to every member
    const item = map(B)._map.get(K1)
    assert.ok(item)
    const serverClient = item.id.client
    assert.notEqual(serverClient, A.doc.clientID)
    B.provider.documentUpdateHandler(deletesAhead(serverClient, Y.getState(B.doc.store, serverClient), 1_000_000), null)
    await flushed(B)
    // bob's change is put back by the server — with a struct his waiting deletes name
    await write(B, K1, entry('7', bobId))
    await waitFor(() => sigAt(B, K1) === hex('6'), 5000, 'put back')
    await tick(A, 'Nordlicht Schaltplan (tick 1)')
    await tick(A, 'Nordlicht Schaltplan (tick 2)')
    for (const d of [A, B, C]) assert.equal(sigAt(d, K1), hex('6'))
    assert.deepEqual([(await stored(K1))?.sig, (await stored(K1))?.updatedBy], [hex('6'), adaId])

    // the admin's next allowance: bob's deletes wait for her clocks
    await flushed(C)
    B.provider.documentUpdateHandler(deletesAhead(C.doc.clientID, Y.getState(C.doc.store, C.doc.clientID), 1_000_000), null)
    await flushed(B)
    await write(C, K3, entry('8', null))
    await waitFor(() => sigAt(A, K3) === hex('8') && at(A, K3)?.updatedBy === cydId, 5000, 'the admin’s allowance survives')
    await tick(A, 'Nordlicht Schaltplan (tick 3)')
    for (const d of [A, B, C]) assert.equal(sigAt(d, K3), hex('8'))
    assert.deepEqual([(await stored(K3))?.sig, (await stored(K3))?.updatedBy], [hex('8'), cydId])
  })

  test('a role change applies to open sockets: a demoted admin is put back at once, promoted again allowed', async () => {
    const D = await meta(cyd)
    const demoted = await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'member' })
    assert.equal(demoted.status, 200, JSON.stringify(demoted.body))
    await waitFor(() => D.closes.includes('role-changed'), 5000, 'role-changed close')
    const D2 = await meta(cyd)
    await write(D2, K2, entry('9', cydId))
    await waitFor(() => sigAt(D2, K2) === hex('4'), 5000, 'a demoted admin’s change is put back')
    await write(D2, K3, null)
    await waitFor(() => sigAt(D2, K3) === hex('8'), 5000, 'nor may they withdraw any more')

    const promoted = await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })
    assert.equal(promoted.status, 200)
    await waitFor(() => D2.closes.includes('role-changed'), 5000, 'role-changed close on promotion')
    const D3 = await meta(cyd)
    await write(D3, K2, entry('a', null))
    await waitFor(() => sigAt(A, K2) === hex('a') && at(A, K2)?.updatedBy === cydId, 5000, 'a promoted admin allows at once')
  })
})

describe('the allowed-paths guard reads the role at every change', () => {
  const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  /** A transaction origin as Hocuspocus makes it for a member's socket (role = the one it opened with). */
  const from = (userId: string, role: string) => ({ source: 'connection', connection: { context: { userId, role } } })
  const sync = (a: Y.Doc, b: Y.Doc, origin: unknown = null) => Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), origin)

  test('a socket opened as admin loses the right the moment the role changes (and gets it back)', () => {
    const roles = new Map<string, string>([['ada', 'owner'], ['cyd', 'admin']])
    const server = new Y.Doc()
    const stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    const cyd = new Y.Doc()
    const socket = from('cyd', 'admin')
    const sigOf = () => ((server.getMap('fuseSignoffs').get(K1) as Entry | undefined)?.sig as string | undefined) ?? null

    cyd.getMap('fuseSignoffs').set(K1, entry('1'))
    sync(cyd, server, socket)
    assert.equal(sigOf(), hex('1'))
    assert.equal((server.getMap('fuseSignoffs').get(K1) as Entry).updatedBy, 'cyd')

    roles.set('cyd', 'member')
    sync(server, cyd)
    cyd.getMap('fuseSignoffs').set(K1, entry('2'))
    sync(cyd, server, socket)
    assert.equal(sigOf(), hex('1'), 'put back: the socket still says admin, the workspace does not')
    sync(server, cyd)
    cyd.getMap('fuseSignoffs').delete(K1)
    sync(cyd, server, socket)
    assert.equal(sigOf(), hex('1'), 'a withdrawal is put back too')

    roles.set('cyd', 'admin')
    sync(server, cyd)
    cyd.getMap('fuseSignoffs').set(K1, entry('3'))
    sync(cyd, server, socket)
    assert.equal(sigOf(), hex('3'))
    stop()
  })

  test('an admin’s NEW key that a member’s waiting deletes take away in the same transaction comes back as the admin’s', () => {
    // (Yjs' `changes.keys` leaves such a key out: added and deleted at once with nothing there before)
    const roles = new Map<string, string>([['ada', 'owner'], ['cyd', 'admin'], ['bob', 'member']])
    const server = new Y.Doc()
    const stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    const cyd = new Y.Doc()
    // bob plants deletes for cyd's next clocks
    Y.applyUpdate(server, deletesAhead(cyd.clientID, Y.getState(cyd.store, cyd.clientID), 1_000), from('bob', 'member'))
    // cyd allows a path nobody had allowed before
    cyd.getMap('fuseSignoffs').set(K2, entry('5'))
    sync(cyd, server, from('cyd', 'admin'))
    const got = server.getMap('fuseSignoffs').get(K2) as Entry | undefined
    assert.deepEqual([got?.sig, got?.updatedBy], [hex('5'), 'cyd'])
    // the waiting deletes are dropped: the next update leaves it alone
    const ada = new Y.Doc()
    ada.getMap('misc').set('tick', 1)
    sync(ada, server, from('ada', 'owner'))
    assert.equal(((server.getMap('fuseSignoffs').get(K2) as Entry | undefined)?.sig as string | undefined) ?? null, hex('5'))
    stop()
  })
})

describe('fix (rest): nested values and what an older server let in', () => {
  const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  const from = (userId: string, role: string) => ({ source: 'connection', connection: { context: { userId, role } } })
  const sync = (a: Y.Doc, b: Y.Doc, origin: unknown = null) => Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), origin)
  const roles = new Map<string, string>([['ada', 'owner'], ['cyd', 'admin'], ['bob', 'member']])
  /** A nested Y.Map allowance (a raw client's) — `by` is what it claims. */
  const nested = (sig: string, by: string) => {
    const m = new Y.Map<unknown>()
    m.set('sig', hex(sig))
    m.set('parts', { d: 'd'.repeat(16) })
    m.set('at', 1)
    m.set('updatedBy', by)
    return m
  }
  const valueAt = (d: Y.Doc, key: string) => d.getMap('fuseSignoffs').get(key)

  test('an admin’s nested allowance is kept as plain JSON, stamped with the admin — never the owner it claims', () => {
    const server = new Y.Doc()
    const stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    const cyd = new Y.Doc()
    cyd.getMap('fuseSignoffs').set(K1, nested('1', 'ada'))
    sync(cyd, server, from('cyd', 'admin'))
    const v = valueAt(server, K1)
    assert.ok(!(v instanceof Y.AbstractType), 'no nested type stays')
    assert.deepEqual([(v as Entry).sig, (v as Entry).updatedBy], [hex('1'), 'cyd'])
    // a member's client gets the plain value: nothing inside it to re-point
    const bob = new Y.Doc()
    sync(server, bob)
    assert.ok(!(valueAt(bob, K1) instanceof Y.AbstractType))
    stop()
  })

  test('a member’s nested allowance is put back like any change of theirs', () => {
    const server = new Y.Doc()
    const stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    const bob = new Y.Doc()
    bob.getMap('fuseSignoffs').set(K2, nested('2', 'ada'))
    sync(bob, server, from('bob', 'member'))
    assert.equal(valueAt(server, K2), undefined)
    stop()
  })

  test('a nested value from before the guard: a member’s change inside it removes the key, an admin’s flattens it', () => {
    for (const [who, role] of [['bob', 'member'], ['cyd', 'admin']] as const) {
      const server = new Y.Doc()
      // planted while nothing guarded the map (an older server)
      const old = new Y.Doc()
      old.getMap('fuseSignoffs').set(K1, nested('1', 'ada'))
      sync(old, server)
      const stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
      const client = new Y.Doc()
      sync(server, client)
      ;(valueAt(client, K1) as Y.Map<unknown>).set('sig', hex('2'))
      sync(client, server, from(who, role))
      const v = valueAt(server, K1)
      if (role === 'member') assert.equal(v, undefined, 'a member re-pointed a nested allowance: it goes')
      else {
        assert.ok(!(v instanceof Y.AbstractType))
        assert.deepEqual([(v as Entry).sig, (v as Entry).updatedBy], [hex('2'), 'cyd'])
      }
      stop()
    }
  })

  test('the first load under the guard drops every entry from before it; later loads keep them', () => {
    const server = new Y.Doc()
    server.getMap('fuseSignoffs').set(K1, entry('1', 'ada'))
    server.getMap('fuseSignoffs').set(K2, entry('2', 'ada'))
    let done = false
    const first = { done: () => done, mark: () => (done = true) }
    let stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u), first })
    assert.equal(server.getMap('fuseSignoffs').size, 0)
    assert.equal(done, true)
    stop()
    // an owner allows one under the guard; the next load keeps it
    const ada = new Y.Doc()
    sync(server, ada)
    stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u) })
    ada.getMap('fuseSignoffs').set(K3, entry('3'))
    sync(ada, server, from('ada', 'owner'))
    stop()
    stop = guardFuseSignoffs(server, { workspaceId: 'w', log: quiet, roleOf: (u) => roles.get(u), first })
    assert.equal((valueAt(server, K3) as Entry).updatedBy, 'ada')
    stop()
  })

  test('a real server: an allowance from before the guard (its marker gone) is dropped on the first load — once', async () => {
    const first = await startServer()
    const ada = await signIn(first, 'ada@first-guard.test')
    const wsId = (await ada.post('/api/workspaces', { name: 'Nordlicht Alt' })).body.id as string
    const d = openDoc(first, ada, `ws:${wsId}`)
    await d.synced
    d.doc.getMap('fuseSignoffs').set(K1, entry('1'))
    await flushed(d)
    await waitFor(() => (d.doc.getMap('fuseSignoffs').get(K1) as Entry | undefined)?.updatedBy !== null, 5000, 'stamped')
    assert.equal(await first.stop(), 0)
    d.destroy()
    // as if the entry had been written while the server had no guard: the marker is not there
    const raw = new DatabaseSync(join(first.dataDir, 'one.sqlite'))
    const gone = raw.prepare('DELETE FROM server_state WHERE key = ?').run(`guard:fuseSignoffs:${wsId}`)
    raw.close()
    assert.equal(Number(gone.changes), 1, 'the first load had set the marker')

    const second = await startServer({}, first.dataDir)
    try {
      const client = new Client(second.url)
      for (const [k, v] of ada.cookies) client.cookies.set(k, v)
      const d2 = openDoc(second, client, `ws:${wsId}`)
      await d2.synced
      assert.equal(d2.doc.getMap('fuseSignoffs').get(K1), undefined, 'dropped before any client synced')
      // allowed again under the guard: it stays across the next load
      d2.doc.getMap('fuseSignoffs').set(K2, entry('2'))
      await flushed(d2)
      await sleep(300)
      d2.destroy()
      const d3 = openDoc(second, client, `ws:${wsId}`)
      await d3.synced
      assert.equal((d3.doc.getMap('fuseSignoffs').get(K2) as Entry | undefined)?.sig, hex('2'))
      d3.destroy()
    } finally {
      await second.stop()
    }
  })
})
