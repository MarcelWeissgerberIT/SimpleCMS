/**
 * Schema gate (src/collab/schema-gate.ts, docs/CLOUD.md § Schema gate): a collab connection writes only when it
 * sends a document schema generation at or above the server's minimum. An older tab — no generation at all —
 * stays read-only (its delete of a node it cannot read never reaches the server); one that is new enough to
 * listen but behind is read-only AND told it is outdated.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as Y from 'yjs'
import { MIN_CLIENT_SCHEMA, OUTDATED_NOTICE, outdatedNotice, schemaAccess } from '../src/collab/schema-gate.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

let server: TestServer
let owner: Client, member: Client
let wsId: string
const open: DocClient[] = []

const doc = (client: Client, name: string, schema?: number | string | null) => {
  const d = openDoc(server, client, name, {}, { schema })
  open.push(d)
  return d
}

/** Stateless messages a client received. */
const notices = (d: DocClient) => {
  const got: string[] = []
  d.provider.on('stateless', ({ payload }: { payload: string }) => got.push(payload))
  return got
}

before(async () => {
  server = await startServer()
  owner = await signIn(server, 'owner@gate.test')
  member = await signIn(server, 'member@gate.test')
  wsId = (await owner.post('/api/workspaces', { name: 'Gate' })).body.id
  const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
  await member.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
})

after(async () => {
  for (const d of open) d.destroy()
  await server.stop()
})

test('schemaAccess: missing / junk → missing, below the minimum → outdated, at or above → current', () => {
  assert.equal(MIN_CLIENT_SCHEMA >= 1, true)
  assert.equal(schemaAccess(null), 'missing')
  assert.equal(schemaAccess(''), 'missing')
  assert.equal(schemaAccess('one'), 'missing')
  assert.equal(schemaAccess('1.5'), 'missing')
  assert.equal(schemaAccess('-1'), 'missing')
  assert.equal(schemaAccess('9999999'), 'missing')
  assert.equal(schemaAccess(String(MIN_CLIENT_SCHEMA - 1)), 'outdated')
  assert.equal(schemaAccess(String(MIN_CLIENT_SCHEMA)), 'current')
  assert.equal(schemaAccess(String(MIN_CLIENT_SCHEMA + 3)), 'current')
  assert.equal(schemaAccess(' 2 ', 3), 'outdated')
  assert.deepEqual(JSON.parse(outdatedNotice(4)), { type: OUTDATED_NOTICE, status: 'outdated', min: 4 })
})

test('a connection without a schema generation reads but never writes — a page or the meta document', async () => {
  const name = `ws:${wsId}:p:gatepage0001`
  const current = doc(owner, name)
  assert.equal(await current.ready, 'read-write')
  await current.synced
  // the current client writes a block (a task) into the page
  const item = new Y.XmlElement('workItem')
  item.setAttribute('itemId', 'wi_AbCdEfGhIj')
  const title = new Y.XmlElement('paragraph')
  title.insert(0, [new Y.XmlText('Ship the pricing page')])
  item.insert(0, [title])
  current.doc.getXmlFragment('default').insert(0, [item])
  await flushed(current)

  // an older build: no ?schema= — it reads the page, live …
  const old = doc(member, name, null)
  assert.equal(await old.ready, 'readonly')
  await old.synced
  assert.equal(old.doc.getXmlFragment('default').length, 1)
  // … but what it does (here: deleting the node it cannot read) never reaches the server
  old.doc.getXmlFragment('default').delete(0, 1)
  old.doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
  await sleep(500)
  assert.equal(current.doc.getXmlFragment('default').length, 1, 'the delete was not applied')
  assert.equal((current.doc.getXmlFragment('default').get(0) as Y.XmlElement).nodeName, 'workItem')
  const fresh = doc(owner, name)
  await fresh.synced
  assert.equal((fresh.doc.getXmlFragment('default').get(0) as Y.XmlElement).nodeName, 'workItem', 'stored state keeps the task')

  // the meta document too
  const meta = doc(member, `ws:${wsId}`, 'junk')
  assert.equal(await meta.ready, 'readonly')
  await meta.synced
  meta.doc.getMap('pages').set('evil', 'old tab')
  await sleep(400)
  const check = doc(owner, `ws:${wsId}`)
  await check.synced
  assert.equal(check.doc.getMap('pages').has('evil'), false)
})

test('a client behind the minimum is read-only and told it is outdated; a current one is not', async () => {
  const name = `ws:${wsId}:p:gatepage0002`
  const behind = doc(member, name, MIN_CLIENT_SCHEMA - 1)
  const got = notices(behind)
  assert.equal(await behind.ready, 'readonly')
  await behind.synced
  await waitFor(() => got.length > 0, 5000, 'outdated notice')
  assert.deepEqual(JSON.parse(got[0]!), { type: OUTDATED_NOTICE, status: 'outdated', min: MIN_CLIENT_SCHEMA })

  const current = doc(member, name)
  const none = notices(current)
  assert.equal(await current.ready, 'read-write')
  await current.synced
  current.doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
  await flushed(current)
  await sleep(200)
  assert.deepEqual(none, [], 'no notice for a current client')
  await waitFor(() => behind.doc.getXmlFragment('default').length === 1, 5000, 'the outdated tab still receives updates')
})

test('a newer client than the server knows writes as usual', async () => {
  const name = `ws:${wsId}:p:gatepage0003`
  const newer = doc(member, name, MIN_CLIENT_SCHEMA + 5)
  assert.equal(await newer.ready, 'read-write')
})
