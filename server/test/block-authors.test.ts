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
  let s = await startServer()
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
    const history = [...fresh.doc.getMap<any>('blockChangesV1').values()]
    assert.ok(history.some(c => c.block === 'p2' && c.actor === bid && c.before && c.after), 'a fresh reader sees the real contribution')
    opened.splice(0).forEach(d => d.destroy())
    await s.stop()
    s = await startServer(s.env, s.dataDir)
    const restarted = openDoc(s, alice, `ws:${ws}:p:blocks`); opened.push(restarted); await restarted.synced
    const storedHistory = [...restarted.doc.getMap<any>('blockChangesV1').values()]
    assert.ok(storedHistory.some(c => c.block === 'p2' && c.actor === bid && c.before && c.after), 'encrypted history persists across a real server restart')
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

test('section changes coalesce typing, preserve other writers, reject forged history and survive reload', () => {
  const d = new Y.Doc()
  const frag = d.getXmlFragment('default')
  const heading = new Y.XmlElement('heading'); heading.setAttribute('id', 'ready'); heading.setAttribute('level', '2')
  const ht = new Y.XmlText(); ht.insert(0, 'Ready'); heading.insert(0, [ht])
  frag.insert(0, [heading, paragraph('body', 'Base'), paragraph('delete-me', 'Remove this')])
  let stop = guardBlockAuthors(d)
  const map = d.getMap<any>('blockChangesV1')
  const edit = (by: string, text: string) => d.transact(() => ((frag.get(1) as Y.XmlElement).get(0) as Y.XmlText).insert(0, text), member(by))
  edit('alice', 'A '); edit('alice', 'AA ')
  assert.equal(map.size, 1, 'typing does not create one record per key')
  const first = [...map.values()][0]
  assert.equal(first.area, 'ready')
  assert.equal(first.before.content[0].text, 'Base')
  assert.equal(first.after.content[0].text, 'AA A Base')
  edit('bob', 'B '); edit('alice', 'AAA ')
  assert.equal(map.size, 3, 'interleaved writers are separate contributions')
  const entries = [...map.values()].sort((a,b) => a.seq-b.seq)
  assert.deepEqual(entries.map(x => x.actor), ['alice','bob','alice'])
  assert.equal(entries[2].before.content[0].text, 'B AA A Base', 'Bobs text is context, never an insertion credited to Alice')
  const saved = JSON.stringify(map.toJSON())
  d.transact(() => map.set(first.id, {...first, actor:'bob'}), member('bob'))
  assert.equal(JSON.stringify(map.toJSON()), saved)
  d.transact(() => map.clear(), member('bob'))
  assert.equal(JSON.stringify(map.toJSON()), saved)
  d.transact(() => frag.delete(2,1), member('alice'))
  const removed = [...map.values()].find(x => x.block==='delete-me')
  assert.equal(removed.area, 'ready'); assert.equal(removed.after,null)
  assert.equal(removed.before.content[0].text,'Remove this')
  stop()
  const copy = new Y.Doc(); Y.applyUpdate(copy,Y.encodeStateAsUpdate(d))
  stop = guardBlockAuthors(copy)
  copy.transact(() => ((copy.getXmlFragment('default').get(1) as Y.XmlElement).get(0) as Y.XmlText).insert(0,'Later '),member('alice'))
  assert.equal(copy.getMap('blockChangesV1').size, 4, 'reload continues the latest contribution without losing older ones')
  stop(); copy.destroy(); d.destroy()
})

test('private page changes do not record content comparisons', () => {
  const d = new Y.Doc(); const stop = guardBlockAuthors(d,{history:false})
  d.transact(() => d.getXmlFragment('default').insert(0,[paragraph('private','Private text')]),member('alice'))
  assert.equal(d.getMap('blockChangesV1').size,0)
  stop(); d.destroy()
})
