/**
 * Private pages in team workspaces (docs/CLOUD.md § Private pages): `ws:<id>:u:<userId>` meta and
 * `ws:<id>:u:<userId>:p:<pageId>` content documents open for their owner only — never for another
 * member (owner of the workspace included), the public API, incoming webhooks or invites. DELETE of
 * private content documents only names the caller's own; private files are served to their
 * uploader only; leaving / removal deletes a member's private documents and files.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

let server: TestServer
let owner: Client, ada: Client, bob: Client, vera: Client, outsider: Client
let adaId: string, bobId: string, veraId: string
let wsId: string
const open: DocClient[] = []

const doc = (client: Client | null, name: string) => {
  const d = openDoc(server, client, name)
  open.push(d)
  return d
}

async function joinAs(client: Client, role: 'member' | 'viewer' | 'admin') {
  const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
  const res = await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
  assert.equal(res.status, 200)
}

/** A page entry like the app's binding writes it (the server only checks that the id is listed). */
function addPage(d: Y.Doc, id: string, title: string, extra: Record<string, unknown> = {}) {
  const yp = new Y.Map<unknown>()
  d.transact(() => {
    for (const [k, v] of Object.entries({ kind: 'page', title, parentId: null, databaseId: null, order: 1, trashed: false, createdAt: Date.now(), updatedAt: Date.now(), ...extra })) yp.set(k, v)
    yp.set('properties', new Y.Map())
    yp.set('comments', new Y.Map())
    d.getMap('pages').set(id, yp)
  })
}

function addText(d: Y.Doc, text: string) {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  d.getXmlFragment('default').insert(d.getXmlFragment('default').length, [p])
}

const sql = <T>(query: string, ...params: Array<string | number>) => {
  const db = new DatabaseSync(join(server.dataDir, 'one.sqlite'), { readOnly: true })
  try {
    return db.prepare(query).all(...params) as T[]
  } finally {
    db.close()
  }
}
const storedNames = (prefix: string) => sql<{ name: string }>('SELECT name FROM documents WHERE substr(name, 1, ?) = ?', prefix.length, prefix).map((r) => r.name)

before(async () => {
  server = await startServer({ MAX_UPLOAD_MB: '1' })
  owner = await signIn(server, 'owner@private.test')
  ada = await signIn(server, 'ada@private.test')
  bob = await signIn(server, 'bob@private.test')
  vera = await signIn(server, 'vera@private.test')
  outsider = await signIn(server, 'outsider@private.test')
  wsId = (await owner.post('/api/workspaces', { name: 'Private' })).body.id
  await joinAs(ada, 'member')
  await joinAs(bob, 'member')
  await joinAs(vera, 'viewer')
    const ids = await Promise.all([ada, bob, vera].map(async (c) => (await c.get('/api/me')).body.user.id as string))
  ;[adaId, bobId, veraId] = ids as [string, string, string]
})

after(async () => {
  for (const d of open) d.destroy()
  await server.stop()
})

test('a private meta document opens for its owner only', async () => {
  const mine = doc(ada, `ws:${wsId}:u:${adaId}`)
  assert.equal(await mine.ready, 'read-write')
  await mine.synced
  addPage(mine.doc, 'secret1', 'Secret plan')
  await flushed(mine)

  // every other member — the workspace owner, a member, a viewer — and outsiders are refused
  for (const [who, client] of [
    ['workspace owner', owner],
    ['member', bob],
    ['viewer', vera],
    ['outsider', outsider],
  ] as const) {
    await assert.rejects(doc(client, `ws:${wsId}:u:${adaId}`).ready, /forbidden/, who)
    await assert.rejects(doc(client, `ws:${wsId}:u:${adaId}:p:secret1`).ready, /forbidden/, who)
  }

  // a fresh connection of the owner gets it back; another member's own private document is separate
  const again = doc(ada, `ws:${wsId}:u:${adaId}`)
  await again.synced
  assert.equal((again.doc.getMap('pages').get('secret1') as Y.Map<unknown>).get('title'), 'Secret plan')
  const bobs = doc(bob, `ws:${wsId}:u:${bobId}`)
  assert.equal(await bobs.ready, 'read-write')
  await bobs.synced
  assert.equal(bobs.doc.getMap('pages').size, 0)
  // and the shared meta document does not carry it
  const shared = doc(bob, `ws:${wsId}`)
  await shared.synced
  assert.equal(shared.doc.getMap('pages').has('secret1'), false)
})

test('private content documents: owner reads and writes, nobody else gets in', async () => {
  const name = `ws:${wsId}:u:${adaId}:p:secret1`
  const a = doc(ada, name)
  assert.equal(await a.ready, 'read-write')
  await a.synced
  addText(a.doc, 'the private text')
  await flushed(a)
  await assert.rejects(doc(bob, name).ready, /forbidden/)
  // the same page id in the workspace's (or Bob's own) namespace is another, empty document
  for (const other of [doc(bob, `ws:${wsId}:p:secret1`), doc(bob, `ws:${wsId}:u:${bobId}:p:secret1`)]) {
    await other.synced
    assert.equal(other.doc.getXmlFragment('default').length, 0)
  }
  // malformed private names are invalid, not a way around the check
  for (const bad of [`ws:${wsId}:u:`, `ws:${wsId}:u:${adaId}:p:`, `ws:${wsId}:u:short`, `ws:${wsId}:u:${adaId}:x:1`, `ws:${wsId}:u:${adaId}:p:a:b`, `ws:${wsId}:u:${adaId}:u:${bobId}`]) {
    await assert.rejects(doc(ada, bad).ready, /invalid-document/, bad)
  }
})

test('viewers open their own private documents read-only, nobody else’s', async () => {
  const v = doc(vera, `ws:${wsId}:u:${veraId}`)
  assert.equal(await v.ready, 'readonly')
  await v.synced
  addPage(v.doc, 'vera1', 'Should not arrive')
  await sleep(300)
  const fresh = doc(vera, `ws:${wsId}:u:${veraId}`)
  await fresh.synced
  assert.equal(fresh.doc.getMap('pages').has('vera1'), false, 'a viewer cannot write, not even privately')
  await assert.rejects(doc(vera, `ws:${wsId}:u:${adaId}`).ready, /forbidden/)
})

test('the public API never sees private pages', async () => {
  // a private database + row in Ada's private meta document, content in her private page document
  const meta = doc(ada, `ws:${wsId}:u:${adaId}`)
  await meta.synced
  meta.doc.transact(() => {
    addPage(meta.doc, 'privdb', 'Private DB', { kind: 'database' })
    const ydb = new Y.Map<unknown>()
    const props = new Y.Map<unknown>()
    props.set('t', { id: 't', name: 'Name', type: 'title', order: 0 })
    ydb.set('properties', props)
    ydb.set('views', new Y.Map())
    meta.doc.getMap('databases').set('privdb', ydb)
    addPage(meta.doc, 'privrow', 'Private row', { parentId: 'privdb', databaseId: 'privdb' })
  })
  await flushed(meta)

  const created = await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Probe', scope: 'write' })
  assert.equal(created.status, 201)
  const call = async (method: string, path: string, json?: unknown) => {
    const res = await fetch(`${server.url}/api/v1${path}`, { method, headers: { authorization: `Bearer ${created.body.token}`, ...(json ? { 'content-type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined })
    return { status: res.status, body: (await res.json()) as any }
  }
  const dbs = await call('GET', '/databases')
  assert.equal(dbs.status, 200)
  assert.equal(JSON.stringify(dbs.body).includes('privdb'), false)
  for (const path of ['/pages/secret1', '/pages/privdb', '/databases/privdb', '/databases/privdb/rows', '/rows/privrow']) {
    assert.equal((await call('GET', path)).status, 404, path)
  }
  assert.equal((await call('POST', '/databases/privdb/rows', { title: 'x' })).status, 404)
  assert.equal((await call('PATCH', '/rows/privrow', { title: 'x' })).status, 404)
  assert.equal((await call('POST', '/pages', { parentId: 'secret1', title: 'child' })).status, 404)
  // an incoming webhook can't be bound to a private database
  assert.equal((await owner.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'privdb' })).status, 404)
  // Ada's private documents are untouched
  assert.equal((meta.doc.getMap('pages').get('privrow') as Y.Map<unknown>).get('title'), 'Private row')
})

test('DELETE …/documents?scope=private drops only the caller’s own private content documents', async () => {
  const meta = doc(ada, `ws:${wsId}:u:${adaId}`)
  await meta.synced
  addPage(meta.doc, 'gone1', 'To be deleted')
  await flushed(meta)
  const content = doc(ada, `ws:${wsId}:u:${adaId}:p:gone1`)
  await content.synced
  addText(content.doc, 'gone soon')
  await flushed(content)
  content.destroy()
  await waitFor(() => storedNames(`ws:${wsId}:u:${adaId}:p:gone1`).length === 1, 5000, 'stored on disconnect')

  assert.equal((await ada.del(`/api/workspaces/${wsId}/documents/gone1?scope=private`)).status, 409, 'still listed privately')
  assert.equal((await ada.del(`/api/workspaces/${wsId}/documents/gone1?scope=nope`)).status, 400)
  // Bob's call names Bob's namespace only: Ada's document stays
  assert.equal((await bob.del(`/api/workspaces/${wsId}/documents/gone1?scope=private`)).status, 204)
  assert.equal(storedNames(`ws:${wsId}:u:${adaId}:p:gone1`).length, 1)
  // the workspace-scope call does not reach it either (and the shared meta never listed it)
  assert.equal((await bob.del(`/api/workspaces/${wsId}/documents/gone1`)).status, 204)
  assert.equal(storedNames(`ws:${wsId}:u:${adaId}:p:gone1`).length, 1)
  // viewers can't delete documents
  assert.equal((await vera.del(`/api/workspaces/${wsId}/documents/gone1?scope=private`)).status, 403)

  meta.doc.getMap('pages').delete('gone1')
  await flushed(meta)
  assert.equal((await ada.del(`/api/workspaces/${wsId}/documents/gone1?scope=private`)).status, 204)
  assert.deepEqual(storedNames(`ws:${wsId}:u:${adaId}:p:gone1`), [])

  // an old copy syncing later is not stored again …
  const late = doc(ada, `ws:${wsId}:u:${adaId}:p:gone1`)
  await late.synced
  addText(late.doc, 'from an old copy')
  await flushed(late)
  late.destroy()
  await sleep(400)
  assert.deepEqual(storedNames(`ws:${wsId}:u:${adaId}:p:gone1`), [])
  // … unless the page is back in the private meta document (e.g. moved back to Private)
  addPage(meta.doc, 'gone1', 'Back again')
  await flushed(meta)
  const back = doc(ada, `ws:${wsId}:u:${adaId}:p:gone1`)
  await back.synced
  addText(back.doc, 'back')
  await flushed(back)
  back.destroy()
  await waitFor(() => storedNames(`ws:${wsId}:u:${adaId}:p:gone1`).length === 1, 5000, 'revived')
})

test('private files are served to their uploader only, until published', async () => {
  const put = (client: Client, id: string, scope?: string) =>
    client.fetch(`/api/workspaces/${wsId}/files/${id}`, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]), headers: { 'content-type': 'image/png', ...(scope ? { 'x-file-scope': scope } : {}) } })
  assert.equal((await put(ada, 'privfile1', 'private')).status, 201)
  assert.equal((await put(ada, 'pubfile1')).status, 201)
  const get = (client: Client, id: string) => client.fetch(`/api/workspaces/${wsId}/files/${id}`).then((r) => r.status)
  assert.equal(await get(ada, 'privfile1'), 200)
  assert.equal(await get(bob, 'privfile1'), 404)
  assert.equal(await get(vera, 'privfile1'), 404)
  assert.equal(await get(owner, 'privfile1'), 404)
  assert.equal(await get(bob, 'pubfile1'), 200)
  // Bob can neither publish Ada's file nor take its id over
  assert.deepEqual((await bob.post(`/api/workspaces/${wsId}/files/publish`, { ids: ['privfile1'] })).body, { published: 0 })
  assert.equal((await put(bob, 'privfile1')).status, 200)
  assert.equal(await get(bob, 'privfile1'), 404)
  assert.equal((await ada.post(`/api/workspaces/${wsId}/files/publish`, { ids: [] })).status, 400)
  assert.equal((await vera.post(`/api/workspaces/${wsId}/files/publish`, { ids: ['privfile1'] })).status, 403)
  // the owner publishes it (the page moved to the workspace): everyone sees it
  assert.deepEqual((await ada.post(`/api/workspaces/${wsId}/files/publish`, { ids: ['privfile1', 'unknown1'] })).body, { published: 1 })
  assert.equal(await get(bob, 'privfile1'), 200)
  assert.equal(await get(vera, 'privfile1'), 200)
})

test('leaving or being removed deletes a member’s private documents and files', async () => {
  const meta = doc(bob, `ws:${wsId}:u:${bobId}`)
  await meta.synced
  addPage(meta.doc, 'bobpage', 'Bob only')
  await flushed(meta)
  const content = doc(bob, `ws:${wsId}:u:${bobId}:p:bobpage`)
  await content.synced
  addText(content.doc, 'mine')
  await flushed(content)
  const up = await bob.fetch(`/api/workspaces/${wsId}/files/bobfile1`, { method: 'PUT', body: new Uint8Array([9]), headers: { 'content-type': 'image/png', 'x-file-scope': 'private' } })
  assert.equal(up.status, 201)
  // a workspace file of Bob's stays
  await bob.fetch(`/api/workspaces/${wsId}/files/bobshared1`, { method: 'PUT', body: new Uint8Array([8]), headers: { 'content-type': 'image/png' } })
  const shared = doc(owner, `ws:${wsId}`)
  await shared.synced
  addPage(shared.doc, 'teampage', 'Team page')
  await flushed(shared)
  await waitFor(() => storedNames(`ws:${wsId}:u:${bobId}`).length >= 1, 5000, 'stored')

  assert.equal((await owner.del(`/api/workspaces/${wsId}/members/${bobId}`)).status, 204)
  await waitFor(() => meta.closes.includes('membership-revoked') && content.closes.includes('membership-revoked'), 5000, 'closed')
  // the live copies unload and their last store is refused: nothing comes back
  await sleep(600)
  assert.deepEqual(storedNames(`ws:${wsId}:u:${bobId}`), [])
  assert.equal(sql('SELECT id FROM files WHERE workspace_id = ? AND id = ?', wsId, 'bobfile1').length, 0)
  assert.equal(existsSync(join(server.dataDir, 'files', wsId, 'bobfile1')), false)
  assert.equal(sql('SELECT id FROM files WHERE workspace_id = ? AND id = ?', wsId, 'bobshared1').length, 1)
  // the workspace's documents and other members' private documents are untouched
  assert.ok(storedNames(`ws:${wsId}:u:${adaId}`).length >= 1)
  const check = doc(owner, `ws:${wsId}`)
  await check.synced
  assert.equal(check.doc.getMap('pages').has('teampage'), true)

  // invited again: an empty private section
  await joinAs(bob, 'member')
  const back = doc(bob, `ws:${wsId}:u:${bobId}`)
  assert.equal(await back.ready, 'read-write')
  await back.synced
  assert.equal(back.doc.getMap('pages').size, 0)
})

test('deleting the workspace removes every private document', async () => {
  const ws2 = (await ada.post('/api/workspaces', { name: 'Short-lived' })).body.id as string
  const d = doc(ada, `ws:${ws2}:u:${adaId}`)
  await d.synced
  addPage(d.doc, 'p1', 'x')
  await flushed(d)
  d.destroy()
  await waitFor(() => storedNames(`ws:${ws2}:u:${adaId}`).length === 1, 5000, 'stored')
  assert.equal((await ada.del(`/api/workspaces/${ws2}`)).status, 204)
  await sleep(300)
  assert.deepEqual(storedNames(`ws:${ws2}`), [])
})
