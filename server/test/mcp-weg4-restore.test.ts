/**
 * MCP T-a, Weg 4 D3 on the team server (the owner's decision): Restore (Workspace → API "Recent MCP writes") is ALL OR
 * NOTHING.
 *  - nothing the call made or changed was touched since → everything goes back in one go: the fields it wrote, the texts
 *    it replaced or wrote into, and what it made to the trash;
 *  - anything moved since — a field it wrote, a text it replaced or wrote a link / block into, a made page's or row's
 *    title, text, values, icon / cover / comments, place, trash, something put below it, a page locked since — → `409
 *    changed_since` naming each, and NOTHING is written (no untouched sibling trashed, no other field put back);
 *  - `force` puts back the recorded texts and the written fields whole and never trashes anything: what the call made
 *    stays and is listed (`left`); a call that only made things (or a page locked since) has nothing force could put
 *    back (`canForce: false`) and stays refused.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan, Wissensbasis).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

function pageEntry(fields: Record<string, unknown>, properties: Record<string, unknown> = {}): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('createdBy', 'seed')
  yp.set('updatedBy', 'seed')
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(properties)) props.set(k, v)
  yp.set('properties', props)
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

type Def = { id: string; name: string; type: string; [k: string]: unknown }

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[]) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1 }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    props.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    const views = new Y.Map<unknown>()
    views.set('v-1', { id: 'v-1', name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id), order: 0 })
    ydb.set('views', views)
    ydb.set('nextUniqueId', 1)
    doc.getMap('databases').set(id, ydb)
  })
}

const para = (text: string, id: string) => {
  const el = new Y.XmlElement('paragraph')
  el.setAttribute('id', id)
  const t = new Y.XmlText()
  t.insert(0, text)
  el.insert(0, [t])
  return el
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-weg4-d3', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

type Changed = { id: string; title: string; what: string[]; fields?: string[] }

const STATUS = [
  { id: 's-todo', name: 'Todo', color: 'gray', group: 'todo' },
  { id: 's-done', name: 'Done', color: 'green', group: 'done' },
]

describe('Weg 4 D3: Restore on the team server is all or nothing', () => {
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  const open: DocClient[] = []
  const doc = async (name: string) => {
    const d = openDoc(server, owner, name)
    open.push(d)
    await d.synced
    return d
  }
  const pages = () => meta.doc.getMap('pages')
  const yp = (id: string) => pages().get(id) as Y.Map<unknown>
  const props = (id: string) => yp(id).get('properties') as Y.Map<unknown>
  const calls = async () => (await owner.get(`/api/workspaces/${wsId}/mcp-calls`)).body as Array<{ callId: string; tool: string; kinds: string[]; titles: string[]; restoredAt: string | null }>
  const callOf = async (tool: string, title: string) => (await calls()).find((c) => c.tool === tool && c.titles.includes(title))!
  const restore = (callId: string, force = false) => owner.post(`/api/workspaces/${wsId}/mcp-calls/${callId}/restore`, force ? { force: true } : {})
  /** a refusal: 409 changed_since, its details (what moved, whether force could put something back) */
  const refused = (res: { status: number; body: { error?: { code?: string; message?: string; details?: { changed?: Changed[]; canForce?: boolean } } } }) => {
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error?.code, 'changed_since')
    assert.match(String(res.body.error?.message), /Nothing was put back/)
    return { changed: res.body.error?.details?.changed ?? [], canForce: res.body.error?.details?.canForce }
  }
  const named = (changed: Changed[]) => changed.map((c) => [c.id, [...c.what].sort(), c.fields ?? []] as const).sort((a, b) => a[0].localeCompare(b[0]))
  const pageLinks = (d: DocClient) => d.doc.getXmlFragment('default').toArray().filter((n) => (n as Y.XmlElement).nodeName === 'pageLink').map((n) => (n as Y.XmlElement).getAttribute('pageId'))

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => {
      pages().set('wiki', pageEntry({ title: 'Wissensbasis', order: 1 }))
      pages().set('plan', pageEntry({ title: 'Launch plan', order: 2 }))
    })
    addDatabase(meta.doc, 'db-cards', 'Cards', [
      { id: 'c-title', name: 'Name', type: 'title' },
      { id: 'c-status', name: 'Status', type: 'status', options: STATUS },
      { id: 'c-ticket', name: 'Ticket', type: 'text', key: true },
      { id: 'c-owner', name: 'Owner', type: 'text' },
    ])
    meta.doc.transact(() => {
      for (let i = 1; i <= 10; i++) pages().set(`card-${i}`, pageEntry({ title: `Card ${i}`, parentId: 'db-cards', databaseId: 'db-cards', order: i }, { 'c-status': 's-todo', 'c-ticket': `T-${i}` }))
    })
    await flushed(meta)
    for (const id of ['wiki', 'plan']) {
      const d = await doc(`ws:${wsId}:p:${id}`)
      d.doc.transact(() => d.doc.getXmlFragment('default').insert(0, [para(`Intro of ${id}.`, `blk-intro-${id}`)]))
      await flushed(d)
    }
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('untouched: one Restore puts back the fields, the body and what the call made — all in one go', async () => {
    const card1 = await doc(`ws:${wsId}:p:card-1`)
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-1', properties: { Owner: 'Mirror' }, markdown: 'Body from the mirror.' }, { key: 'K-NEW', title: 'Neue Karte' }] })
    const made = out.rows.find((r: { action: string }) => r.action === 'created').id as string
    await waitFor(() => props('card-1').get('c-owner') === 'Mirror' && !!yp(made) && card1.doc.getXmlFragment('default').toString().includes('Body from the mirror'), 5000, 'written')
    const c = await callOf('one_upsert_rows', 'Card 1')
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.restored, 3, JSON.stringify(res.body))
    assert.deepEqual(res.body.left, [], 'nothing left in place')
    assert.equal(res.body.kept, undefined, 'no per-part "kept" any more')
    await waitFor(() => props('card-1').get('c-owner') === undefined, 5000, 'Owner back')
    await waitFor(() => yp(made).get('trashed') === true, 5000, 'the made row in the trash')
    await waitFor(() => !card1.doc.getXmlFragment('default').toString().includes('Body from the mirror'), 5000, 'the body back')
    assert.doesNotMatch(String(yp('card-1').get('plain') ?? ''), /mirror/)
    assert.ok((await calls()).find((x) => x.callId === c.callId)!.restoredAt, 'the call is put back')
    assert.match((await restore(c.callId)).body.note, /put back already/)
  })

  test('a field changed since: refused, naming the row and the field — the untouched row keeps the call\'s value; force puts both back', async () => {
    await call(writer, 'one_update_row', { rows: [{ id: 'card-2', properties: { Owner: 'Tessera' } }, { id: 'card-3', properties: { Owner: 'Tessera' } }] })
    await waitFor(() => props('card-3').get('c-owner') === 'Tessera', 5000, 'written')
    meta.doc.transact(() => props('card-3').set('c-owner', 'Mara Lind'))
    await flushed(meta)
    const c = await callOf('one_update_row', 'Card 3')
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [['card-3', ['values'], ['Owner']]])
    assert.equal(canForce, true, 'force can put the fields back')
    await sleep(200)
    assert.equal(props('card-2').get('c-owner'), 'Tessera', 'nothing was put back — not the untouched row either')
    assert.equal(props('card-3').get('c-owner'), 'Mara Lind')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
    // "Restore anyway": the written fields back, both
    const forced = await restore(c.callId, true)
    assert.equal(forced.status, 200, JSON.stringify(forced.body))
    assert.deepEqual(forced.body.left, [])
    await waitFor(() => props('card-2').get('c-owner') === undefined && props('card-3').get('c-owner') === undefined, 5000, 'both back')
    assert.ok((await calls()).find((x) => x.callId === c.callId)!.restoredAt)
  })

  test('a made page renamed since: refused — the untouched sibling stays, both links stay; force cannot help (it never trashes)', async () => {
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    const made = await call(writer, 'one_create_page', { parentId: 'wiki', linkInParent: 'block', pages: [{ title: 'Glossar' }, { title: 'Index' }] })
    const [glossar, index] = made.pages.map((p: { id: string }) => p.id) as [string, string]
    await waitFor(() => pageLinks(wiki).length === 2 && !!yp(glossar), 5000, 'pages and links')
    meta.doc.transact(() => yp(glossar).set('title', 'Glossary'))
    await flushed(meta)
    const c = await callOf('one_create_page', 'Index')
    const first = refused(await restore(c.callId))
    assert.deepEqual(named(first.changed), [[glossar, ['title'], []]])
    assert.equal(first.changed[0]!.title, 'Glossary', 'named as it is called now')
    assert.equal(first.canForce, false, 'the call only made things: force would put nothing back')
    const again = refused(await restore(c.callId, true))
    assert.deepEqual(named(again.changed), [[glossar, ['title'], []]])
    await sleep(200)
    assert.notEqual(yp(index).get('trashed'), true, 'the untouched sibling is not trashed')
    assert.notEqual(yp(glossar).get('trashed'), true)
    assert.deepEqual(pageLinks(wiki).sort(), [glossar, index].sort(), 'no link taken out')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })

  test('upsert with a made row changed since: force puts back the field and the body it wrote, never trashes — the made row is listed in left', async () => {
    const card4 = await doc(`ws:${wsId}:p:card-4`)
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-4', properties: { Owner: 'Mirror' }, markdown: 'Mirror body for card 4.' }, { key: 'K-50', title: 'Neu von Claude' }] })
    const made = out.rows.find((r: { action: string }) => r.action === 'created').id as string
    await waitFor(() => !!yp(made) && card4.doc.getXmlFragment('default').toString().includes('Mirror body'), 5000, 'written')
    // Mara fills the made row's empty Owner
    meta.doc.transact(() => props(made).set('c-owner', 'Mara Lind'))
    await flushed(meta)
    const c = await callOf('one_upsert_rows', 'Card 4')
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [[made, ['values'], []]])
    assert.equal(canForce, true)
    await sleep(150)
    assert.equal(props('card-4').get('c-owner'), 'Mirror', 'nothing put back')
    const forced = await restore(c.callId, true)
    assert.equal(forced.status, 200, JSON.stringify(forced.body))
    assert.deepEqual(forced.body.left, [{ id: made, title: 'Neu von Claude' }], 'the made row stays and is listed')
    await waitFor(() => props('card-4').get('c-owner') === undefined, 5000, 'the field back')
    await waitFor(() => !card4.doc.getXmlFragment('default').toString().includes('Mirror body'), 5000, 'the body back')
    await sleep(200)
    assert.notEqual(yp(made).get('trashed'), true, 'force never trashes')
    assert.equal(props(made).get('c-owner'), 'Mara Lind')
  })

  test('a text the call only put its database block into counts too: typed into since → refused, the database stays', async () => {
    const plan = await doc(`ws:${wsId}:p:plan`)
    const db = await call(writer, 'one_create_database', { title: 'Sprint board', inline: { pageId: 'plan' }, rows: [{ title: 'Kick-off' }] })
    const frag = plan.doc.getXmlFragment('default')
    await waitFor(() => frag.toArray().some((n) => (n as Y.XmlElement).nodeName === 'databaseBlock'), 5000, 'block')
    plan.doc.transact(() => frag.insert(frag.length, [para('Typed by Tessera after the call.', 'blk-tess-001')]))
    await flushed(plan)
    const c = await callOf('one_create_database', 'Sprint board')
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [['plan', ['text'], []]])
    assert.equal(canForce, false)
    await sleep(200)
    assert.notEqual(yp(db.id).get('trashed'), true, 'the database is not trashed')
    assert.ok(frag.toArray().some((n) => (n as Y.XmlElement).nodeName === 'databaseBlock'), 'its block stays')
  })

  test('moved, in the trash, a page put below: each made page is named — nothing is trashed', async () => {
    const made = await call(writer, 'one_create_page', { parentId: 'wiki', pages: [{ title: 'Moved' }, { title: 'Binned' }, { title: 'Parent' }, { title: 'Quiet' }] })
    const [moved, binned, parent, quiet] = made.pages.map((p: { id: string }) => p.id) as [string, string, string, string]
    await waitFor(() => !!yp(quiet), 5000, 'pages')
    meta.doc.transact(() => {
      yp(moved).set('parentId', 'plan')
      yp(binned).set('trashed', true)
      yp(binned).set('trashedAt', Date.now())
      pages().set('mara-sub', pageEntry({ title: 'Maras Notizen', parentId: parent, order: 1 }))
    })
    await flushed(meta)
    const c = await callOf('one_create_page', 'Moved')
    const { changed } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [[binned, ['trash'], []], [moved, ['place'], []], [parent, ['below'], []]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    await sleep(200)
    assert.notEqual(yp(quiet).get('trashed'), true, 'the untouched page is not trashed either')
    assert.notEqual(yp(parent).get('trashed'), true)
  })

  test('a replaced page locked in One since: refused, also with force — its text stays as it is', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Protokoll', parentId: 'plan', markdown: 'First version.' })
    await call(writer, 'one_update_page', { id: page.id, markdown: 'Second version.', mode: 'replace' })
    const d = await doc(`ws:${wsId}:p:${page.id}`)
    await waitFor(() => d.doc.getXmlFragment('default').toString().includes('Second version.'), 5000, 'replaced')
    meta.doc.transact(() => yp(page.id).set('settings', { fullWidth: false, smallText: false, font: 'sans', locked: true }))
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_update_page' && x.titles.includes('Protokoll'))!
    const first = refused(await restore(c.callId))
    assert.deepEqual(named(first.changed), [[page.id, ['locked'], []]])
    assert.equal(first.canForce, false, 'force never writes into a locked page')
    refused(await restore(c.callId, true))
    await sleep(200)
    assert.ok(d.doc.getXmlFragment('default').toString().includes('Second version.'), 'the locked text is untouched')
  })

  test('W2: "Restore anyway" when nothing moved by then still never trashes — what the call made stays and is listed', async () => {
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-5', properties: { Owner: 'Mirror' } }, { key: 'K-PROBE', title: 'Probe card' }] })
    const made = out.rows.find((r: { action: string }) => r.action === 'created').id as string
    await waitFor(() => props('card-5').get('c-owner') === 'Mirror' && !!yp(made), 5000, 'written')
    meta.doc.transact(() => props('card-5').set('c-owner', 'Mara Lind'))
    await flushed(meta)
    const c = await callOf('one_upsert_rows', 'Card 5')
    assert.equal(refused(await restore(c.callId)).canForce, true)
    // Mara puts the value back: nothing has moved any more when the owner confirms "Restore anyway"
    meta.doc.transact(() => props('card-5').set('c-owner', 'Mirror'))
    await flushed(meta)
    const forced = await restore(c.callId, true)
    assert.equal(forced.status, 200, JSON.stringify(forced.body))
    assert.deepEqual(forced.body.left, [{ id: made, title: 'Probe card' }], 'what it made stays and is listed')
    await waitFor(() => props('card-5').get('c-owner') === undefined, 5000, 'the field back')
    await sleep(200)
    assert.notEqual(yp(made).get('trashed'), true, 'force never trashes')
  })

  test('W2: force on a call that only made things, nothing moved: refused — nothing trashed, the call not marked', async () => {
    const made = await call(writer, 'one_create_page', { parentId: 'plan', title: 'Nur gemacht' })
    await waitFor(() => !!yp(made.id), 5000, 'made')
    const c = await callOf('one_create_page', 'Nur gemacht')
    const res = await restore(c.callId, true)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error?.code, 'nothing_to_force')
    await sleep(200)
    assert.notEqual(yp(made.id).get('trashed'), true)
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })

  test('W2: a row the call changed, in the trash since: refused (trash), also with force — its values are not written', async () => {
    await call(writer, 'one_update_row', { rows: [{ id: 'card-6', properties: { Owner: 'Tessera' } }] })
    await waitFor(() => props('card-6').get('c-owner') === 'Tessera', 5000, 'written')
    meta.doc.transact(() => {
      yp('card-6').set('trashed', true)
      yp('card-6').set('trashedAt', Date.now())
    })
    await flushed(meta)
    const c = await callOf('one_update_row', 'Card 6')
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [['card-6', ['trash'], []]])
    assert.equal(canForce, false, 'force never writes into a row in the trash')
    refused(await restore(c.callId, true))
    await sleep(200)
    assert.equal(props('card-6').get('c-owner'), 'Tessera', 'nothing written')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })

  test('W2: a row the call changed, moved to another database since: refused (place) — no field id lands there', async () => {
    addDatabase(meta.doc, 'db-archive', 'Archive', [{ id: 'a-title', name: 'Name', type: 'title' }])
    await call(writer, 'one_update_row', { rows: [{ id: 'card-7', properties: { Owner: 'Tessera' } }] })
    await waitFor(() => props('card-7').get('c-owner') === 'Tessera', 5000, 'written')
    meta.doc.transact(() => {
      yp('card-7').set('parentId', 'db-archive')
      yp('card-7').set('databaseId', 'db-archive')
    })
    await flushed(meta)
    const c = await callOf('one_update_row', 'Card 7')
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [['card-7', ['place'], []]])
    assert.equal(canForce, false)
    await sleep(200)
    assert.equal(props('card-7').get('c-owner'), 'Tessera', 'nothing written')
  })

  test('W2: a page whose text the call replaced, in the trash since: refused (trash) — its text stays', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Wochenbericht', parentId: 'plan', markdown: 'Erste Fassung.' })
    await call(writer, 'one_update_page', { id: page.id, markdown: 'Zweite Fassung.', mode: 'replace' })
    const d = await doc(`ws:${wsId}:p:${page.id}`)
    await waitFor(() => d.doc.getXmlFragment('default').toString().includes('Zweite Fassung.'), 5000, 'replaced')
    meta.doc.transact(() => {
      yp(page.id).set('trashed', true)
      yp(page.id).set('trashedAt', Date.now())
    })
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_update_page' && x.titles.includes('Wochenbericht'))!
    const { changed, canForce } = refused(await restore(c.callId))
    assert.deepEqual(named(changed), [[page.id, ['trash'], []]])
    assert.equal(canForce, false)
    await sleep(200)
    assert.ok(d.doc.getXmlFragment('default').toString().includes('Zweite Fassung.'), 'the text stays')
  })
})

/**
 * W1 review: a Restore checks again as it writes. A change that lands between the first check and the writes (here held
 * open by the DEV-only MCP_RESTORE_GAP_MS) refuses the whole Restore: no text typed meanwhile is overwritten, a page
 * locked meanwhile gets no text — also with force — and texts already put back are taken back again.
 */
describe('Weg 4 W1: a Restore checks again as it writes', () => {
  const GAP = 1500
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  const open: DocClient[] = []
  const doc = async (name: string) => {
    const d = openDoc(server, owner, name)
    open.push(d)
    await d.synced
    return d
  }
  const pages = () => meta.doc.getMap('pages')
  const yp = (id: string) => pages().get(id) as Y.Map<unknown>
  const calls = async () => (await owner.get(`/api/workspaces/${wsId}/mcp-calls`)).body as Array<{ callId: string; tool: string; titles: string[]; restoredAt: string | null }>
  const callOf = async (tool: string, title: string) => (await calls()).find((c) => c.tool === tool && c.titles.includes(title))!
  const restore = (callId: string, force = false) => owner.post(`/api/workspaces/${wsId}/mcp-calls/${callId}/restore`, force ? { force: true } : {})
  const text = (d: DocClient) => d.doc.getXmlFragment('default').toString()
  const type = async (d: DocClient, words: string, id: string) => {
    const frag = d.doc.getXmlFragment('default')
    d.doc.transact(() => frag.insert(frag.length, [para(words, id)]))
    await flushed(d)
  }
  const lock = async (id: string) => {
    meta.doc.transact(() => yp(id).set('settings', { fullWidth: false, smallText: false, font: 'sans', locked: true }))
    await flushed(meta)
  }

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000', MCP_RESTORE_GAP_MS: String(GAP) })
    owner = await signIn(server, 'mara@nordlicht.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => pages().set('plan', pageEntry({ title: 'Launch plan', order: 1 })))
    addDatabase(meta.doc, 'db-cards', 'Cards', [
      { id: 'c-title', name: 'Name', type: 'title' },
      { id: 'c-ticket', name: 'Ticket', type: 'text', key: true },
      { id: 'c-owner', name: 'Owner', type: 'text' },
    ])
    meta.doc.transact(() => {
      for (let i = 1; i <= 2; i++) pages().set(`card-${i}`, pageEntry({ title: `Card ${i}`, parentId: 'db-cards', databaseId: 'db-cards', order: i }, { 'c-ticket': `T-${i}` }))
    })
    await flushed(meta)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('typed into a replaced text while the Restore runs: refused, the sentence stays, nothing goes to the trash', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Protokoll', parentId: 'plan', markdown: 'First version.' })
    await call(writer, 'one_update_page', { id: page.id, markdown: 'Second version.', mode: 'replace' })
    const d = await doc(`ws:${wsId}:p:${page.id}`)
    await waitFor(() => text(d).includes('Second version.'), 5000, 'replaced')
    const c = await callOf('one_update_page', 'Protokoll')
    const pending = restore(c.callId)
    await sleep(GAP / 3)
    await type(d, 'Mara Lind typed this meanwhile.', 'blk-mara-001')
    const res = await pending
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error?.code, 'changed_since')
    assert.match(String(res.body.error?.message), /Nothing was put back/)
    assert.deepEqual(res.body.error?.details?.changed.map((m: Changed) => [m.id, m.what]), [[page.id, ['text']]])
    await sleep(300)
    assert.ok(text(d).includes('Mara Lind typed this meanwhile.'), 'the sentence typed meanwhile stays')
    assert.ok(text(d).includes('Second version.'), 'the text is not put back')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })

  test('two bodies, one typed into while the Restore runs: refused as a whole — neither body is put back, no field either', async () => {
    const one = await doc(`ws:${wsId}:p:card-1`)
    const two = await doc(`ws:${wsId}:p:card-2`)
    await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-1', properties: { Owner: 'Tessera' }, markdown: 'Body one from the mirror.' }, { key: 'T-2', properties: { Owner: 'Tessera' }, markdown: 'Body two from the mirror.' }] })
    await waitFor(() => text(one).includes('Body one') && text(two).includes('Body two'), 5000, 'written')
    const c = await callOf('one_upsert_rows', 'Card 2')
    const pending = restore(c.callId)
    await sleep(GAP / 3)
    await type(two, 'Nordlicht note typed meanwhile.', 'blk-nord-001')
    const res = await pending
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.match(String(res.body.error?.message), /Nothing was put back/)
    await sleep(300)
    assert.ok(text(two).includes('Nordlicht note typed meanwhile.') && text(two).includes('Body two'), 'the typed body stays as it is')
    assert.ok(text(one).includes('Body one from the mirror.'), 'the untouched body is not put back either (or was taken back again)')
    assert.equal((yp('card-1').get('properties') as Y.Map<unknown>).get('c-owner'), 'Tessera', 'no field put back')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })

  test('force, and the page is locked while the Restore runs: refused — the text it had put back is taken back again', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Wissensbasis', parentId: 'plan', markdown: 'Old wiki text.' })
    await call(writer, 'one_update_page', { id: page.id, markdown: 'Wiki text from the call.', mode: 'replace' })
    const d = await doc(`ws:${wsId}:p:${page.id}`)
    await waitFor(() => text(d).includes('Wiki text from the call.'), 5000, 'replaced')
    await type(d, 'Tessera added a line.', 'blk-tess-001')
    const c = await callOf('one_update_page', 'Wissensbasis')
    const first = await restore(c.callId)
    assert.equal(first.status, 409)
    assert.equal(first.body.error?.details?.canForce, true, 'force could put the text back')
    const pending = restore(c.callId, true)
    await sleep(GAP / 3)
    await lock(page.id)
    const res = await pending
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error?.details?.canForce, false)
    assert.ok(res.body.error?.details?.changed.some((m: Changed) => m.id === page.id && m.what.includes('locked')), JSON.stringify(res.body))
    await sleep(300)
    assert.ok(text(d).includes('Tessera added a line.') && text(d).includes('Wiki text from the call.'), `the locked page keeps its text: ${text(d)}`)
    assert.ok(!text(d).includes('Old wiki text.'))
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
  })
})
