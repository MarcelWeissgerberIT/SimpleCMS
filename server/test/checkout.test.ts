import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as Y from 'yjs'
import { Client, signIn, startServer, openDoc, flushed, type TestServer } from './helpers.ts'
import { planCheckout, prepareCheckoutIds, type CheckoutData, type CheckoutSnapshot } from '../../src/shared/checkout.ts'

let server: TestServer
before(async () => { server = await startServer() })
after(async () => { await server.stop() })
const page = (title: string, text = 'Base') => ({ meta: { kind: 'page', title, parentId: null, databaseId: null, order: 0, trashed: false, settings: { locked: false } }, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph1' }, content: [{ type: 'text', text }] }] } })
const cp = <T,>(v: T): T => structuredClone(v)

test('three-way fields preserve independent changes, detect text/deletion conflicts and respect explicit choices', () => {
  const base = { pages: { p: page('Base') }, databases: {} } as CheckoutData
  const local = cp(base); const cloud = cp(base)
  local.pages.p!.meta.title = 'Local title'
  cloud.pages.p!.meta.icon = { type: 'emoji', value: '🧪' }
  let plan = planCheckout(base, local, cloud)
  assert.equal(plan.unresolved.length, 0)
  assert.equal(plan.data.pages.p!.meta.title, 'Local title')
  assert.deepEqual(plan.data.pages.p!.meta.icon, { type: 'emoji', value: '🧪' })
  cloud.pages.p!.meta.title = 'Cloud title'
  plan = planCheckout(base, local, cloud)
  assert.equal(plan.unresolved.length, 1)
  const chosen = { [plan.unresolved[0]!.key]: 'cloud' as const }
  assert.equal(planCheckout(base, local, cloud, chosen).data.pages.p!.meta.title, 'Cloud title')
  delete local.pages.p
  assert.equal(planCheckout(base, local, cloud).unresolved.length, 1)
  const textLocal = cp(base); const textCloud = cp(base)
  textLocal.pages.p!.content = page('x', 'Local text').content
  textCloud.pages.p!.content = page('x', 'Cloud text').content
  assert.equal(planCheckout(base, textLocal, textCloud).unresolved.length, 1)
  const trashed = cp(base); trashed.pages.p!.meta.trashed = true
  assert.equal(planCheckout(base, trashed, textCloud).unresolved.length, 1)
})

test('new detached rows receive free computed ids in the review, while cloud ids and counters survive', () => {
  const base: CheckoutData = { pages: {}, databases: { db: { nextUniqueId: 1, properties: { uid: { id: 'uid', type: 'unique_id' } } } } }
  const local = cp(base); const cloud = cp(base)
  local.pages.local = { ...page('Local row'), meta: { ...page('Local row').meta, databaseId: 'db', properties: { uid: 1 } } }
  cloud.pages.cloud = { ...page('Cloud row'), meta: { ...page('Cloud row').meta, databaseId: 'db', properties: { uid: 1 } } }
  local.databases.db!.nextUniqueId = 2; cloud.databases.db!.nextUniqueId = 2
  const prepared = prepareCheckoutIds(base, local, cloud)
  assert.deepEqual(prepared.pages.local!.meta.properties, { uid: 2 })
  const plan = planCheckout(base, prepared, cloud)
  assert.equal(plan.unresolved.length, 0)
  assert.equal(plan.data.databases.db!.nextUniqueId, 3)
  assert.deepEqual(plan.data.pages.cloud!.meta.properties, { uid: 1 })
})

async function setup() {
  const owner = await signIn(server, `checkout-${Math.random()}@example.com`)
  const { body: ws } = await owner.post('/api/workspaces', { name: 'Checkout test' })
  const path = `/api/workspaces/${ws.id}/checkout`
  const { body: empty } = await owner.get(path)
  const seed = { pages: { testpage0001: page('Brief'), testpage0002: page('Tests') }, databases: {} }
  assert.equal((await owner.post(`${path}/merge`, { revisions: empty.revisions, data: seed })).status, 200)
  const snap = (await owner.get(path)).body as CheckoutSnapshot
  return { owner, ws, path, snap }
}

test('checkout is authenticated, scoped to current membership and excludes private/settings/agent data', async () => {
  const { owner, path, ws, snap } = await setup()
  assert.equal((await new Client(server.url).get(path)).status, 401)
  const stranger = await signIn(server, 'checkout-stranger@example.com')
  assert.equal((await stranger.get(path)).status, 404)
  const priv = openDoc(server, owner, `ws:${ws.id}:u:${(await owner.get('/api/me')).body.user.id}`)
  try { await priv.ready; await priv.synced; priv.doc.getMap('pages').set('secretpage', new Y.Map([['title', 'Private secret']])); await flushed(priv) } finally { priv.destroy() }
  assert.equal(JSON.stringify((await owner.get(path)).body).includes('Private secret'), false)
  assert.deepEqual(Object.keys(snap.data).sort(), ['databases', 'pages'])
  const invite = (await owner.post(`/api/workspaces/${ws.id}/invites`, { role: 'viewer' })).body.link.split('#/invite/')[1]
  await stranger.post(`/api/invites/${invite}/accept`)
  assert.equal((await stranger.get(path)).status, 200)
  assert.equal((await stranger.post(`${path}/merge`, { revisions: snap.revisions, data: snap.data })).status, 403)
})

test('guarded merge broadcasts rich text and preserves all marks, attrs and text order', async () => {
  const { owner, path, ws, snap } = await setup()
  const live = openDoc(server, owner, `ws:${ws.id}:p:testpage0001`)
  try {
    await live.ready; await live.synced
    const next = cp(snap.data)
    next.pages.testpage0001!.meta.title = 'Implemented'
    next.pages.testpage0001!.content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2, id: 'head-id' }, content: [{ type: 'text', text: 'One ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'two', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] }
    assert.equal((await owner.post(`${path}/merge`, { revisions: snap.revisions, data: next })).status, 200)
    const after = (await owner.get(path)).body
    assert.deepEqual(after.data.pages.testpage0001.content, next.pages.testpage0001!.content)
    assert.equal(after.data.pages.testpage0001.meta.title, 'Implemented')
    await new Promise(r => setTimeout(r, 100))
    assert.equal(live.doc.getXmlFragment('default').toString().includes('two'), true)
  } finally { live.destroy() }
})

test('live deletion-only changes make a review stale and reject the entire batch, including unrelated edits', async () => {
  const { owner, path, ws, snap } = await setup()
  const live = openDoc(server, owner, `ws:${ws.id}:p:testpage0001`)
  try {
    await live.ready; await live.synced
    const text = live.doc.getXmlFragment('default').get(0) as Y.XmlElement
    const value = text.get(0) as Y.XmlText
    value.delete(0, 1); await flushed(live)
    const next = cp(snap.data); next.pages.testpage0002!.meta.title = 'Must not land'
    const result = await owner.post(`${path}/merge`, { revisions: snap.revisions, data: next })
    assert.equal(result.status, 409)
    assert.equal(result.body.error.code, 'checkout_stale')
    assert.equal((await owner.get(path)).body.data.pages.testpage0002.meta.title, 'Tests')
  } finally { live.destroy() }
})

test('foreign revisions, missing document guards, cyclic structure and locked pages are refused', async () => {
  const { owner, path, ws, snap } = await setup()
  const missing = cp(snap.revisions); delete missing[`ws:${ws.id}:p:testpage0002`]
  assert.equal((await owner.post(`${path}/merge`, { revisions: missing, data: snap.data })).status, 409)
  assert.equal((await owner.post(`${path}/merge`, { revisions: { ...snap.revisions, 'ws:elsewhere': 'a'.repeat(64) }, data: snap.data })).status, 400)
  const cycle = cp(snap.data); cycle.pages.testpage0001!.meta.parentId = 'testpage0001'
  assert.equal((await owner.post(`${path}/merge`, { revisions: snap.revisions, data: cycle })).body.error.code, 'checkout_structure')
  const locked = cp(snap.data); locked.pages.testpage0001!.meta.settings = { locked: true }
  assert.equal((await owner.post(`${path}/merge`, { revisions: snap.revisions, data: locked })).status, 200)
  const fresh = (await owner.get(path)).body
  fresh.data.pages.testpage0001.meta.title = 'Refused'
  assert.equal((await owner.post(`${path}/merge`, { revisions: fresh.revisions, data: fresh.data })).body.error.code, 'checkout_locked')
})

test('database automation and command configuration stays out of snapshots and survives content merges', async () => {
  const { owner, path, ws } = await setup()
  const live = openDoc(server, owner, `ws:${ws.id}`)
  try {
    await live.ready; await live.synced
    const page = new Y.Map<unknown>([['kind', 'database'], ['title', 'Requirements'], ['parentId', null], ['databaseId', null], ['settings', { locked: false }]])
    const database = new Y.Map<unknown>()
    database.set('properties', new Y.Map([['title', { id: 'title', type: 'title', name: 'Title' }]]))
    database.set('views', new Y.Map())
    database.set('automations', new Y.Map([['protected', { id: 'protected', enabled: true, webhookUrl: 'https://example.invalid/private-hook' }]]))
    database.set('commands', [{ id: 'protected-command', url: 'https://example.invalid/private-command' }])
    live.doc.getMap('pages').set('database0001', page)
    live.doc.getMap('databases').set('database0001', database)
    await flushed(live)
    const snapshot = (await owner.get(path)).body
    assert.equal(JSON.stringify(snapshot).includes('private-hook'), false)
    assert.equal(JSON.stringify(snapshot).includes('private-command'), false)
    snapshot.data.pages.testpage0001.meta.title = 'Content only'
    assert.equal((await owner.post(`${path}/merge`, { revisions: snapshot.revisions, data: snapshot.data })).status, 200)
    assert.equal((database.get('automations') as Y.Map<any>).get('protected').enabled, true)
    assert.equal((database.get('commands') as any[])[0].id, 'protected-command')
  } finally { live.destroy() }
})
