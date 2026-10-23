import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import { BLOCK_AUTHORS, guardBlockAuthors } from '../src/collab/block-authors.ts'
import { flushed, openDoc, signIn, startServer, waitFor } from './helpers.ts'

const paragraph = (id: string | null, text: string) => {
  const p = new Y.XmlElement('paragraph')
  if (id) p.setAttribute('id', id)
  const t = new Y.XmlText()
  t.insert(0, text)
  p.insert(0, [t])
  return p
}
const member = (userId: string) => ({ source: 'connection', connection: { context: { userId } } })

test('block stamps preserve untouched blocks, survive moves, reject forgeries and ignore ID normalisation', () => {
  const d = new Y.Doc()
  const frag = d.getXmlFragment('default')
  frag.insert(0, [paragraph(null, 'old text')])
  const stop = guardBlockAuthors(d)
  const stamps = d.getMap<any>(BLOCK_AUTHORS)
  d.transact(() => (frag.get(0) as Y.XmlElement).setAttribute('id', 'old'), member('alice'))
  assert.equal(stamps.size, 0, 'no invented past author')
  d.transact(() => frag.insert(1, [paragraph('new', 'new text')]), member('alice'))
  assert.equal(stamps.get('new').actor, 'alice')
  d.transact(() => ((frag.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'edit '), member('bob'))
  assert.equal(stamps.get('old').actor, 'bob')
  const before = JSON.stringify(stamps.toJSON())
  d.transact(() => stamps.set('old', { actor: 'alice', at: 0 }), member('alice'))
  assert.equal(JSON.stringify(stamps.toJSON()), before, 'a forged author is restored')
  d.transact(() => stamps.clear(), member('alice'))
  assert.equal(JSON.stringify(stamps.toJSON()), before, 'stamp deletion is restored')
  d.transact(() => {
    const moved = (frag.get(1) as Y.XmlElement).clone()
    frag.delete(1, 1)
    frag.insert(0, [moved])
  }, member('bob'))
  assert.equal(JSON.stringify(stamps.toJSON()), before, 'moving untouched text keeps its author')
  d.transact(() => frag.delete(0, 1), member('bob'))
  assert.equal(stamps.has('new'), false)
  stop(); d.destroy()
})

test('real sockets attribute two members, retain stamps across reconnect, and viewers cannot stamp', async () => {
  const s = await startServer()
  const opened: ReturnType<typeof openDoc>[] = []
  try {
    const alice = await signIn(s, 'alice@blocks.test')
    const bob = await signIn(s, 'bob@blocks.test')
    const viewer = await signIn(s, 'viewer@blocks.test')
    const aid = (await alice.get('/api/me')).body.user.id
    const bid = (await bob.get('/api/me')).body.user.id
    const ws = (await alice.post('/api/workspaces', { name: 'Block attribution' })).body.id
    for (const [c, role] of [[bob, 'member'], [viewer, 'viewer']] as const) {
      const inv = await alice.post(`/api/workspaces/${ws}/invites`, { role })
      await c.post(`/api/invites/${inv.body.link.split('#/invite/')[1]}/accept`)
    }
    const meta = openDoc(s, alice, `ws:${ws}`); opened.push(meta); await meta.synced
    const page = new Y.Map(); page.set('id', 'blocks'); page.set('title', 'Blocks')
    meta.doc.getMap('pages').set('blocks', page); await flushed(meta)
    const a = openDoc(s, alice, `ws:${ws}:p:blocks`); opened.push(a); await a.synced
    a.doc.getXmlFragment('default').insert(0, [paragraph('p1', 'First'), paragraph('p2', 'Second')]); await flushed(a)
    const stamp = (d: typeof a, id: string) => d.doc.getMap<any>(BLOCK_AUTHORS).get(id)
    await waitFor(() => stamp(a, 'p1')?.actor === aid)
    const b = openDoc(s, bob, `ws:${ws}:p:blocks`); opened.push(b); await b.synced
    ;((b.doc.getXmlFragment('default').get(1) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Bob ')
    await flushed(b); await waitFor(() => stamp(a, 'p2')?.actor === bid)
    assert.equal(stamp(a, 'p1').actor, aid)
    b.doc.getMap(BLOCK_AUTHORS).set('p1', {actor: bid, at: 1}); await flushed(b)
    await waitFor(() => stamp(b, 'p1')?.actor === aid)
    const v = openDoc(s, viewer, `ws:${ws}:p:blocks`); opened.push(v); await v.synced
    v.doc.getMap(BLOCK_AUTHORS).set('p2', {actor: aid, at: 1})
    const fresh = openDoc(s, alice, `ws:${ws}:p:blocks`); opened.push(fresh); await fresh.synced
    assert.equal(stamp(fresh, 'p1').actor, aid)
    assert.equal(stamp(fresh, 'p2').actor, bid)
  } finally { opened.forEach(d => d.destroy()); await s.stop() }
})

test('waiting CRDT edits are unknown, and stored stamps survive a fresh guard', () => {
  const upstream = new Y.Doc()
  upstream.getXmlFragment('default').insert(0, [paragraph('pending', 'Before')])
  const base = Y.encodeStateAsUpdate(upstream)
  const vector = Y.encodeStateVector(upstream)
  ;((upstream.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'After ')
  const later = Y.encodeStateAsUpdate(upstream, vector)
  const server = new Y.Doc()
  let stop = guardBlockAuthors(server)
  Y.applyUpdate(server, later, member('bob'))
  assert.ok(server.store.pendingStructs)
  Y.applyUpdate(server, base, member('alice'))
  assert.equal(server.getMap<any>(BLOCK_AUTHORS).get('pending').actor, '@unverified')
  stop()
  const copy = new Y.Doc(); Y.applyUpdate(copy, Y.encodeStateAsUpdate(server))
  stop = guardBlockAuthors(copy)
  assert.equal(copy.getMap<any>(BLOCK_AUTHORS).get('pending').actor, '@unverified')
  stop(); server.destroy(); copy.destroy(); upstream.destroy()
})
