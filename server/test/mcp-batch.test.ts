/**
 * MCP B3 on the team server (MCP plan § 2.2 / § 2.3 / § 3.6): sub-pages, boards and rows in one call each — the same
 * tools as the local bridge — and the pre-images a team server keeps instead of a card: Workspace → API lists the
 * calls, a restore puts them back (rows field by field, made pages to the trash, content as it was), refused
 * `changed_since` for a document that moved unless forced. Plus the compensating write: an inline database whose
 * block could not be written goes to the trash again (in process, over a failing collab). Fictional data.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'
import { McpWrites } from '../src/mcp/writes.ts'
import { McpBatch } from '../src/mcp/batch.ts'
import { contentDoc, metaDoc } from '../src/api/model.ts'
import { roots } from '../src/api/meta.ts'
import type { Services } from '../src/context.ts'
import type { WorkspaceModel } from '../src/api/model.ts'
import type { Recorder } from '../src/mcp/preimages.ts'

/* ------------------------------------------------------------------ fixtures */

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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], page: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1, ...page }))
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
  const client = new McpClient({ name: 'one-batch', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

async function fails(client: McpClient, name: string, args: Record<string, unknown>, pattern: RegExp): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.equal(res.isError, true, `${name} should fail: ${res.content[0]?.text}`)
  assert.match(res.content[0]!.text, pattern)
  return res.content[0]!.text
}

const STATUS = [
  { id: 's-todo', name: 'Todo', color: 'gray', group: 'todo' },
  { id: 's-doing', name: 'Doing', color: 'blue', group: 'in_progress' },
  { id: 's-done', name: 'Done', color: 'green', group: 'done' },
]

/* ------------------------------------------------------------------ suite */

describe('MCP B3: sub-pages, boards, rows (team server)', () => {
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
  const kids = (parentId: string) => [...pages().entries()].filter(([, p]) => (p as Y.Map<unknown>).get('parentId') === parentId && (p as Y.Map<unknown>).get('trashed') !== true).map(([id]) => id)
  const calls = async () => (await owner.get(`/api/workspaces/${wsId}/mcp-calls`)).body as Array<{ callId: string; tool: string; token: { name: string }; kinds: string[]; made: number; changed: number; titles: string[]; restoredAt: string | null }>

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => {
      pages().set('proj', pageEntry({ title: 'Launch plan', order: 1 }))
      pages().set('wiki', pageEntry({ title: 'Wissensbasis', order: 2 }))
      pages().set('locked-1', pageEntry({ title: 'Tessera charter', order: 3, settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } }))
    })
    addDatabase(meta.doc, 'db-cards', 'Cards', [
      { id: 'c-title', name: 'Name', type: 'title' },
      { id: 'c-status', name: 'Status', type: 'status', options: STATUS },
      { id: 'c-ticket', name: 'Ticket', type: 'text', key: true },
      { id: 'c-owner', name: 'Owner', type: 'text' },
    ])
    meta.doc.transact(() => {
      for (let i = 1; i <= 20; i++) pages().set(`card-${i}`, pageEntry({ title: `Card ${i}`, parentId: 'db-cards', databaseId: 'db-cards', order: i }, { 'c-status': 's-todo', 'c-ticket': `T-${i}` }))
    })
    await flushed(meta)
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    wiki.doc.transact(() => wiki.doc.getXmlFragment('default').insert(0, [para('Intro of the wiki.', 'blk-intro-001'), para('Second paragraph.', 'blk-second-002')]))
    await flushed(wiki)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('one_create_page: 50 pages as a tree in one call; a sub-page under a ROW; private is local_only; before / index place one page', async () => {
    const list = Array.from({ length: 50 }, (_, i) => ({ title: `Kapitel ${i + 1}`, ...(i === 0 ? {} : { parentId: i < 10 ? '$0' : `$${(i % 9) + 1}` }), ...(i < 3 ? { markdown: `Text of chapter ${i + 1}.` } : {}) }))
    const out = await call(writer, 'one_create_page', { parentId: 'proj', pages: list })
    assert.equal(out.pages.length, 50)
    assert.equal(out.pages[0].parentId, 'proj')
    assert.equal(out.pages[5].parentId, out.pages[0].id)
    assert.equal(out.pages[12].parentId, out.pages[(12 % 9) + 1].id)
    await waitFor(() => kids(out.pages[0].id).length === 9, 5000, 'tree')
    assert.equal((await call(writer, 'one_get_page', { id: out.pages[1].id })).markdown, 'Text of chapter 2.')
    // a "$n" that is not an earlier page, and a parent that is a database: nothing is made
    const n = pages().size
    await fails(writer, 'one_create_page', { pages: [{ title: 'A', parentId: '$1' }, { title: 'B' }] }, /^bad_argument: pages\[0\]\.parentId: "\$1" is no earlier page/)
    await fails(writer, 'one_create_page', { pages: [{ title: 'A' }, { title: 'B', parentId: 'db-cards' }] }, /^bad_argument: pages\[1\]\.parentId: "Cards" is a database/)
    await fails(writer, 'one_create_page', { title: 'Mine', private: true }, /^local_only: private: .*Nothing was changed/)
    await sleep(100)
    assert.equal(pages().size, n)
    // a sub-page inside a database row
    const sub = await call(writer, 'one_create_page', { title: 'Notes on card 3', parentId: 'card-3', markdown: 'Tessera follows up.' })
    assert.equal(sub.parentId, 'card-3')
    await waitFor(() => yp(sub.id)?.get('parentId') === 'card-3', 5000, 'sub-page under a row')
    // place one page: before the second chapter, then first of all
    const before = await call(writer, 'one_create_page', { title: 'Vorwort', parentId: out.pages[0].id, before: out.pages[2].id })
    const first = await call(writer, 'one_create_page', { title: 'Inhalt', parentId: out.pages[0].id, index: 0 })
    await waitFor(() => !!yp(first.id), 5000, 'placed')
    const order = kids(out.pages[0].id).sort((a, b) => Number(yp(a).get('order')) - Number(yp(b).get('order')))
    assert.equal(order[0], first.id)
    assert.equal(order.indexOf(before.id), order.indexOf(out.pages[2].id) - 1)
  })

  test('linkInParent: each new page linked at the end of its parent; a locked parent refuses', async () => {
    const made = await call(writer, 'one_create_page', { parentId: 'wiki', linkInParent: 'block', pages: [{ title: 'Glossar' }, { title: 'FAQ' }, { title: 'Begriffe', parentId: '$0' }] })
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    await waitFor(() => wiki.doc.getXmlFragment('default').length === 4, 5000, 'links in the wiki')
    const links = wiki.doc.getXmlFragment('default').toArray().slice(2) as Y.XmlElement[]
    assert.deepEqual(links.map((l) => [l.nodeName, l.getAttribute('pageId')]), [['pageLink', made.pages[0].id], ['pageLink', made.pages[1].id]])
    // the link to a page of the same call is part of that page's own text
    const glossar = await doc(`ws:${wsId}:p:${made.pages[0].id}`)
    assert.equal((glossar.doc.getXmlFragment('default').get(0) as Y.XmlElement).getAttribute('pageId'), made.pages[2].id)
    await fails(writer, 'one_create_page', { title: 'Anhang', parentId: 'locked-1', linkInParent: 'mention' }, /^locked: linkInParent: .*locked in One/)
  })

  test('one_create_database: a board grouped by Status with rows in one call; no groupable property → a Status is added; an inline board after a block', async () => {
    const board = await call(writer, 'one_create_database', {
      title: 'Sprint board',
      parentId: 'proj',
      icon: '🗂️',
      properties: [{ name: 'Status', type: 'status', options: ['Todo', 'Doing', 'Done'] }, { name: 'Owner', type: 'text' }],
      views: [{ type: 'board', groupBy: 'Status' }],
      rows: [
        { title: 'Kick-off', properties: { Status: 'Doing', Owner: 'Mara Lind' } },
        { title: 'Brief', properties: { Status: 'Todo' } },
        { title: 'Retro', properties: { Status: 'Done' } },
      ],
    })
    assert.deepEqual(board.views.map((v: { type: string; groupBy: string | null }) => [v.type, v.groupBy]), [['board', 'Status'], ['table', null]])
    assert.match(board.note, /table view was added/)
    assert.equal(board.rows.length, 3)
    const kick = await call(writer, 'one_get_page', { id: board.rows[0].id })
    assert.equal(kick.properties.Status, 'Doing')
    assert.equal(kick.properties.Owner, 'Mara Lind')
    // nothing to group by: a Status property is added and the note says so
    const plain = await call(writer, 'one_create_database', { title: 'Ideen', properties: [{ name: 'Notes', type: 'text' }], views: [{ type: 'board' }] })
    assert.ok(plain.properties.some((p: { name: string; type: string }) => p.name === 'Status' && p.type === 'status'))
    assert.equal(plain.views[0].groupBy, 'Status')
    assert.match(plain.note, /"Status" property/)
    // a bad row writes nothing — not even the database
    await waitFor(() => !!yp(plain.id), 5000, 'plain board arrived')
    const n = pages().size
    await fails(writer, 'one_create_database', { title: 'Broken', properties: [{ name: 'Status', type: 'status', options: ['Todo'] }], rows: [{ title: 'Ok' }, { title: 'Bad', properties: { Status: 'Nope' } }] }, /^bad_argument: rows\[1\]: /)
    await sleep(100)
    assert.equal(pages().size, n)
    // inline: a database block after the wiki's first paragraph
    // a ref with a content hash (as one_get_page hands it out) must still fit the block; a changed one is stale_ref
    const read = await call(writer, 'one_get_page', { id: 'wiki', format: 'blocks' })
    const intro: string = read.blocks[0].ref
    assert.match(intro, /^#blk-in[\w-]*~[0-9a-f]{6}$/)
    const stale = intro.replace(/~[0-9a-f]{6}$/, intro.endsWith('~000000') ? '~111111' : '~000000')
    await fails(writer, 'one_create_database', { title: 'No', inline: { pageId: 'wiki', afterBlock: stale } }, /^stale_ref: inline\.afterBlock: .*changed since the read \(it is #blk-in[\w-]*~[0-9a-f]{6} now\)/)
    // without a hash the block found is the block
    const inline = await call(writer, 'one_create_database', { title: 'Wiki board', inline: { pageId: 'wiki', afterBlock: '#blk-intro' }, views: [{ type: 'board' }] })
    assert.equal(inline.pageId, 'wiki')
    // the answer names the new block by its full ref — the one the next read hands out
    assert.match(inline.block, /^#[\w-]+~[0-9a-f]{6}$/)
    assert.equal((await call(writer, 'one_get_page', { id: 'wiki', format: 'blocks' })).blocks[1].ref, inline.block)
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    await waitFor(() => wiki.doc.getXmlFragment('default').toArray().some((n) => (n as Y.XmlElement).nodeName === 'databaseBlock'), 5000, 'block')
    const blocks = wiki.doc.getXmlFragment('default').toArray() as Y.XmlElement[]
    assert.equal(blocks[1]!.nodeName, 'databaseBlock')
    assert.equal(blocks[1]!.getAttribute('databaseId'), inline.id)
    assert.equal(yp(inline.id).get('parentId'), 'wiki')
    await fails(writer, 'one_create_database', { title: 'No', inline: { pageId: 'locked-1' } }, /^locked: inline\.pageId/)
    await fails(writer, 'one_create_database', { title: 'No', inline: { pageId: 'wiki', afterBlock: '#zzzzzz' } }, /^stale_ref: inline\.afterBlock/)
  })

  test('rows: 20 cards set to Done in one call; a bad row fails the whole call and writes nothing; rows in bulk', async () => {
    const out = await call(writer, 'one_update_row', { rows: Array.from({ length: 20 }, (_, i) => ({ id: `card-${i + 1}`, properties: { Status: 'Done' } })) })
    assert.equal(out.rows.length, 20)
    assert.deepEqual(out.rows[0], { id: 'card-1', changed: ['Status'] })
    await waitFor(() => (yp('card-20').get('properties') as Y.Map<unknown>).get('c-status') === 's-done', 5000, 'done')
    await fails(writer, 'one_update_row', { rows: [{ id: 'card-1', properties: { Status: 'Doing' } }, { id: 'card-2', properties: { Status: 'Nope' } }] }, /^bad_argument: rows\[1\]: /)
    await sleep(100)
    assert.equal((yp('card-1').get('properties') as Y.Map<unknown>).get('c-status'), 's-done')
    const made = await call(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'Neu 1', properties: { Ticket: 'T-101' } }, { title: 'Neu 2', properties: { Ticket: 'T-102' } }] })
    assert.deepEqual(made.rows.map((r: { title: string }) => r.title), ['Neu 1', 'Neu 2'])
    // the key stays unique, also within the call
    await fails(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'X', properties: { Ticket: 'T-200' } }, { title: 'Y', properties: { Ticket: 'T-200' } }] }, /rows\[1\]/)
  })

  test('one_upsert_rows: created / updated / unchanged; a refused row fails the whole call', async () => {
    const out = await call(writer, 'one_upsert_rows', {
      databaseId: 'db-cards',
      keyProperty: 'Ticket',
      rows: [
        { key: 'T-1', properties: { Owner: 'Mara Lind' } },
        { key: 'T-2', properties: { Status: 'Done' } },
        { key: 'T-300', title: 'Neues Ticket', properties: { Status: 'Todo' } },
      ],
    })
    assert.deepEqual(out.rows.map((r: { key: string; action: string }) => [r.key, r.action]), [['T-1', 'updated'], ['T-2', 'unchanged'], ['T-300', 'created']])
    await waitFor(() => !!yp(out.rows[2].id), 5000, 'new row arrived')
    const n = pages().size
    await fails(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-400', title: 'Ok' }, { key: 'T-401', properties: { Status: 'Nope' } }] }, /^bad_argument: rows: 1 of 2 rows do not fit: rows\[1\] \(key "T-401"\)/)
    await sleep(100)
    assert.equal(pages().size, n)
  })

  test('files values: only files of this workspace that everyone may see — never a web address, never an unknown id', async () => {
    assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/file-tessera`, { method: 'PUT', body: 'Tessera logo', headers: { 'content-type': 'text/plain' } })).status, 201)
    await call(writer, 'one_create_property', { databaseId: 'db-cards', name: 'Attachments', type: 'files' })
    const ok = await call(writer, 'one_update_row', { rows: [{ id: 'card-7', properties: { Attachments: 'onefile:file-tessera' } }] })
    assert.deepEqual(ok.rows[0].changed, ['Attachments'])
    await fails(writer, 'one_update_row', { rows: [{ id: 'card-7', properties: { Attachments: 'https://cdn.nordlicht.test/logo.png' } }] }, /^refused_type: rows\[0\]: properties\.Attachments: over MCP a files property takes only/)
    await fails(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'Neu', properties: { Attachments: 'onefile:nope-404' } }] }, /^not_found: rows\[0\]: properties\.Attachments: onefile:nope-404 is no file of this workspace/)
    await fails(writer, 'one_update_row', { id: 'card-7', properties: { Attachments: 'onefile:nope-404' } }, /^not_found: properties\.Attachments: onefile:nope-404 is no file of this workspace/)
  })

  test('pre-images: Workspace → API lists the calls; a restore puts rows, pages and content back; changed_since unless forced', async () => {
    // a row batch, then one card changed by hand: the restore keeps that field and names it
    const upd = await call(writer, 'one_update_row', { rows: [{ id: 'card-5', properties: { Owner: 'Tessera' } }, { id: 'card-6', properties: { Owner: 'Tessera' } }] })
    assert.equal(upd.rows.length, 2)
    let list = await calls()
    const rowsCall = list.find((c) => c.tool === 'one_update_row')!
    assert.equal(rowsCall.token.name, 'Claude')
    assert.deepEqual(rowsCall.kinds, ['rows'])
    assert.deepEqual([rowsCall.made, rowsCall.changed, rowsCall.titles], [0, 2, ['Card 5', 'Card 6']])
    await waitFor(() => (yp('card-6').get('properties') as Y.Map<unknown>).get('c-owner') === 'Tessera', 5000, 'owner set')
    meta.doc.transact(() => (yp('card-6').get('properties') as Y.Map<unknown>).set('c-owner', 'Mara Lind'))
    await flushed(meta)
    const back = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${rowsCall.callId}/restore`, {})
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.deepEqual(back.body.kept.map((k: { id: string; fields: string[] }) => [k.id, k.fields]), [['card-6', ['Owner']]])
    await waitFor(() => (yp('card-5').get('properties') as Y.Map<unknown>).get('c-owner') === undefined, 5000, 'card-5 back')
    assert.equal((yp('card-6').get('properties') as Y.Map<unknown>).get('c-owner'), 'Mara Lind')

    // a replace: the page moves after the call → changed_since; force puts it back
    const protokoll = (await call(writer, 'one_create_page', { title: 'Protokoll', parentId: 'proj', markdown: 'First version.' })).id as string
    await call(writer, 'one_update_page', { id: protokoll, markdown: 'Second version.', mode: 'replace' })
    list = await calls()
    const replace = list.find((c) => c.tool === 'one_update_page')!
    assert.deepEqual(replace.kinds, ['content'])
    assert.deepEqual([replace.made, replace.changed, replace.titles], [0, 1, ['Protokoll']])
    const content = await doc(`ws:${wsId}:p:${protokoll}`)
    await waitFor(() => content.doc.getXmlFragment('default').toString().includes('Second version.'), 5000, 'replaced')
    content.doc.transact(() => content.doc.getXmlFragment('default').insert(1, [para('A line typed later.', 'blk-later')]))
    await flushed(content)
    const refused = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${replace.callId}/restore`, {})
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error?.code ?? refused.body.code, 'changed_since')
    const forced = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${replace.callId}/restore`, { force: true })
    assert.equal(forced.status, 200, JSON.stringify(forced.body))
    await waitFor(() => content.doc.getXmlFragment('default').toString().includes('First version.') && !content.doc.getXmlFragment('default').toString().includes('later'), 5000, 'content back')
    // put back once: a second restore is a no-op
    assert.match((await owner.post(`/api/workspaces/${wsId}/mcp-calls/${replace.callId}/restore`, {})).body.note, /put back already/)

    // made pages and rows go to the trash; the database of a board too
    const db = await call(writer, 'one_create_database', { title: 'Restore me', parentId: 'proj', views: [{ type: 'board' }], rows: [{ title: 'A' }, { title: 'B' }] })
    list = await calls()
    const made = list.find((c) => c.tool === 'one_create_database' && c.kinds.includes('rows'))!
    assert.deepEqual([made.made, made.titles], [3, ['Restore me', 'A', 'B']])
    assert.equal((await owner.post(`/api/workspaces/${wsId}/mcp-calls/${made.callId}/restore`, {})).status, 200)
    assert.ok((await calls()).find((c) => c.callId === made.callId)!.restoredAt)
    await waitFor(() => yp(db.id).get('trashed') === true, 5000, 'database trashed')
    // its rows go along with it (in its trash, as in One), not on their own
    assert.equal(yp(db.rows[0].id).get('parentId'), db.id)
    assert.notEqual(yp(db.rows[0].id).get('trashed'), true)
    // members who are not admins cannot list or restore
    const viewer = await signIn(server, 'gast@nordlicht.test')
    assert.ok([403, 404].includes((await viewer.get(`/api/workspaces/${wsId}/mcp-calls`)).status))
  })

  /* ---------------------------------------------------------------- review fixes (T-a) */

  test('upsert: a row body it writes keeps a pre-image — a restore takes the text back out; a later edit → changed_since', async () => {
    const card8 = await doc(`ws:${wsId}:p:card-8`)
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-8', properties: { Owner: 'Mirror' }, markdown: 'Injected body text from the mirror.' }] })
    assert.equal(out.rows[0].action, 'updated')
    await waitFor(() => card8.doc.getXmlFragment('default').toString().includes('Injected body text'), 5000, 'body written')
    const call8 = (await calls()).find((c) => c.tool === 'one_upsert_rows' && c.titles.includes('Card 8'))!
    assert.deepEqual([...call8.kinds].sort(), ['content', 'rows'])
    // the row is one thing changed (its values and its body)
    assert.equal(call8.changed, 1)
    const back = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${call8.callId}/restore`, {})
    assert.equal(back.status, 200, JSON.stringify(back.body))
    assert.deepEqual(back.body.kept, [])
    await waitFor(() => !card8.doc.getXmlFragment('default').toString().includes('Injected body text'), 5000, 'body taken back')
    await waitFor(() => (yp('card-8').get('properties') as Y.Map<unknown>).get('c-owner') === undefined, 5000, 'owner back')
    assert.doesNotMatch(String(yp('card-8').get('plain') ?? ''), /Injected/)
    // a body typed into after the call: the restore refuses (the later text would go)
    const card9 = await doc(`ws:${wsId}:p:card-9`)
    await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-9', markdown: 'Mirror text for card 9.' }] })
    await waitFor(() => card9.doc.getXmlFragment('default').toString().includes('Mirror text'), 5000, 'body 9 written')
    card9.doc.transact(() => card9.doc.getXmlFragment('default').insert(card9.doc.getXmlFragment('default').length, [para('Typed by Mara Lind.', 'blk-mara-009')]))
    await flushed(card9)
    const call9 = (await calls()).find((c) => c.tool === 'one_upsert_rows' && c.kinds.includes('content') && c.callId !== call8.callId)!
    const refused = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${call9.callId}/restore`, {})
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error?.code ?? refused.body.code, 'changed_since')
  })

  test('a restore after a later DELETION is refused changed_since (the state hash covers deletions)', async () => {
    const host = await call(writer, 'one_create_page', { title: 'Host', parentId: 'proj', markdown: 'Alpha line\n\nBeta line\n\nGamma line' })
    await call(writer, 'one_create_database', { title: 'Inline board', inline: { pageId: host.id }, views: [{ type: 'board' }] })
    const d = await doc(`ws:${wsId}:p:${host.id}`)
    await waitFor(() => d.doc.getXmlFragment('default').toArray().some((n) => (n as Y.XmlElement).nodeName === 'databaseBlock'), 5000, 'block')
    const frag = d.doc.getXmlFragment('default')
    const beta = frag.toArray().findIndex((n) => n.toString().includes('Beta line'))
    assert.ok(beta >= 0)
    // the person removes "Beta line" after the call — a deletion only
    d.doc.transact(() => frag.delete(beta, 1))
    await flushed(d)
    const c = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Inline board'))!
    const res = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${c.callId}/restore`, {})
    assert.equal(res.status, 409, JSON.stringify(res.body))
    await sleep(150)
    assert.ok(!frag.toString().includes('Beta line'), 'the deleted line is not brought back')
  })

  test('a restored call is forgotten: repeating it makes the thing again (never answered with what went to the trash)', async () => {
    const args = { title: 'Notizen Nordlicht', parentId: 'proj' }
    const first = await call(writer, 'one_create_page', args)
    const repeat = await call(writer, 'one_create_page', args)
    assert.equal(repeat.duplicateOf, first.id)
    const made = (await calls()).find((c) => c.tool === 'one_create_page' && c.titles.includes('Notizen Nordlicht'))!
    assert.equal((await owner.post(`/api/workspaces/${wsId}/mcp-calls/${made.callId}/restore`, {})).status, 200)
    await waitFor(() => yp(first.id).get('trashed') === true, 5000, 'trashed')
    const again = await call(writer, 'one_create_page', args)
    assert.equal(again.duplicateOf, undefined)
    assert.notEqual(again.id, first.id)
    await waitFor(() => !!yp(again.id) && yp(again.id).get('trashed') !== true, 5000, 'made again')
  })

  test('one_upsert_rows only joins: a repeat after it was applied runs again and brings the row back in step', async () => {
    const args = { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-11', properties: { Owner: 'Tessera' } }] }
    assert.equal((await call(writer, 'one_upsert_rows', args)).rows[0].action, 'updated')
    await waitFor(() => (yp('card-11').get('properties') as Y.Map<unknown>).get('c-owner') === 'Tessera', 5000, 'owner set')
    // changed by hand meanwhile
    meta.doc.transact(() => (yp('card-11').get('properties') as Y.Map<unknown>).set('c-owner', 'Mara Lind'))
    await flushed(meta)
    const again = await call(writer, 'one_upsert_rows', args)
    assert.equal(again.duplicateOf, undefined)
    assert.deepEqual(again.rows.map((r: { key: string; action: string }) => [r.key, r.action]), [['T-11', 'updated']])
    await waitFor(() => (yp('card-11').get('properties') as Y.Map<unknown>).get('c-owner') === 'Tessera', 5000, 'in step again')
  })

  test('inline.afterBlock naming a block INSIDE another one: bad_argument with its top-level ref (not stale_ref)', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Spalten', parentId: 'proj' })
    const d = await doc(`ws:${wsId}:p:${page.id}`)
    d.doc.transact(() => {
      const cols = new Y.XmlElement('columns')
      cols.setAttribute('id', 'cols-outer-01')
      const mk = (id: string, text: string, pid: string) => {
        const col = new Y.XmlElement('column')
        col.setAttribute('id', id)
        col.insert(0, [para(text, pid)])
        return col
      }
      cols.insert(0, [mk('colm-left-01', 'Left side', 'para-left-01'), mk('colm-right-1', 'Right side', 'para-right-1')])
      d.doc.getXmlFragment('default').insert(0, [cols, para('After the columns.', 'para-after-1')])
    })
    await flushed(d)
    const read = await call(writer, 'one_get_page', { id: page.id, format: 'blocks' })
    const top: string = read.blocks[0].ref
    const inner: string = read.blocks[0].children[0].children[0].ref
    const msg = await fails(writer, 'one_create_database', { title: 'Board', inline: { pageId: page.id, afterBlock: inner } }, /^bad_argument: inline\.afterBlock: .*a block inside another one/)
    assert.ok(msg.includes(top), msg)
    // the remedy works: its top-level block
    const ok = await call(writer, 'one_create_database', { title: 'Board', inline: { pageId: page.id, afterBlock: top } })
    assert.equal(ok.pageId, page.id)
    // a block that is gone stays stale_ref
    await fails(writer, 'one_create_database', { title: 'Board 2', inline: { pageId: page.id, afterBlock: '#qqqqqqqq' } }, /^stale_ref: inline\.afterBlock/)
  })
})

/* ------------------------------------------------------------------ compensating trash (in process) */

describe('one_create_database inline: a failed block write trashes the new database again', () => {
  test('the content write fails → the database (made first) goes to the trash, the error stands', async () => {
    const docs = new Map<string, Y.Doc>()
    const get = (name: string) => docs.get(name) ?? (docs.set(name, new Y.Doc()), docs.get(name)!)
    const ws = 'w1'
    const log = { info() {}, warn() {}, error() {}, debug() {} }
    const s = {
      log,
      collab: {
        write: async <T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> => {
          if (name === contentDoc(ws, 'host')) throw new Error('disk full')
          const d = get(name)
          let out!: T
          d.transact(() => {
            out = fn(d)
          })
          return out
        },
        read: async <T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> => fn(get(name)),
      },
    } as unknown as Services
    const model = {
      read: async <T>(_w: string, fn: (r: ReturnType<typeof roots>, d: Y.Doc) => T) => fn(roots(get(metaDoc(ws))), get(metaDoc(ws))),
      url: (_w: string, id: string) => `#/p/${id}`,
      context: () => ({ members: [], people: new Map() }),
    } as unknown as WorkspaceModel
    get(metaDoc(ws)).getMap('pages').set('host', pageEntry({ title: 'Launch plan' }))
    const rec: Recorder = { callId: 'c1', rows() {}, pages() {}, content() {} }
    const batch = new McpBatch(s, model, new McpWrites(s, model))
    await assert.rejects(() => batch.createDatabase(ws, { title: 'Inline board', inline: { pageId: 'host' } }, 'api:t1', rec), /disk full/)
    const dbs = [...get(metaDoc(ws)).getMap('pages').entries()].filter(([, p]) => (p as Y.Map<unknown>).get('kind') === 'database')
    assert.equal(dbs.length, 1)
    assert.equal((dbs[0]![1] as Y.Map<unknown>).get('trashed'), true)
  })
})

/* ------------------------------------------------------------------ restore leaves what changed since alone (review 2) */

describe('Restore puts back only what nobody changed since — made pages, boards, partner rows, earlier restores', () => {
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
  const restore = (callId: string, force = false) => owner.post(`/api/workspaces/${wsId}/mcp-calls/${callId}/restore`, force ? { force: true } : {})

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@polaris.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Polaris' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => pages().set('wiki', pageEntry({ title: 'Wissensbasis', order: 1 })))
    addDatabase(meta.doc, 'db-tasks', 'Tasks', [{ id: 't-title', name: 'Name', type: 'title' }])
    addDatabase(meta.doc, 'db-proj', 'Projects', [{ id: 'p-title', name: 'Name', type: 'title' }])
    addDatabase(meta.doc, 'db-keyed', 'Tickets', [
      { id: 'k-title', name: 'Name', type: 'title' },
      { id: 'k-key', name: 'Ticket', type: 'text', key: true },
      { id: 'k-owner', name: 'Owner', type: 'text' },
      { id: 'k-note', name: 'Note', type: 'text' },
    ])
    meta.doc.transact(() => {
      pages().set('task-1', pageEntry({ title: 'Task one', parentId: 'db-tasks', databaseId: 'db-tasks', order: 1 }))
      pages().set('proj-1', pageEntry({ title: 'Apollo', parentId: 'db-proj', databaseId: 'db-proj', order: 1 }))
      pages().set('tk-3', pageEntry({ title: 'Ticket 3', parentId: 'db-keyed', databaseId: 'db-keyed', order: 3 }, { 'k-key': 'K-3', 'k-note': 'old note' }))
    })
    await flushed(meta)
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    wiki.doc.transact(() => wiki.doc.getXmlFragment('default').insert(0, [para('Intro of the wiki.', 'blk-intro-001')]))
    await flushed(wiki)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('a two-way relation the call wrote goes back on both sides: no one-sided link on the partner row', async () => {
    await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Project', type: 'relation', relation: { databaseId: 'db-proj', twoWay: true, reverseName: 'Tasks' } })
    await call(writer, 'one_update_row', { id: 'task-1', properties: { Project: 'proj-1' } })
    const linked = (id: string, to: string) => [...props(id).entries()].some(([, v]) => Array.isArray(v) && (v as string[]).includes(to))
    await waitFor(() => linked('task-1', 'proj-1') && linked('proj-1', 'task-1'), 5000, 'both sides linked')
    const c = (await calls()).find((x) => x.tool === 'one_update_row')!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept, [])
    await waitFor(() => !linked('task-1', 'proj-1'), 5000, 'forward link gone')
    await waitFor(() => !linked('proj-1', 'task-1'), 5000, 'the partner row no longer links back')
  })

  test('a made page someone wrote into, or put a sub-page under, stays (named in kept); force puts it into the trash', async () => {
    const made = await call(writer, 'one_create_page', { title: 'Meeting notes', parentId: 'wiki' })
    await waitFor(() => !!yp(made.id), 5000, 'page arrived')
    const d = await doc(`ws:${wsId}:p:${made.id}`)
    d.doc.transact(() => d.doc.getXmlFragment('default').insert(0, [para('Decisions: ship on Friday. Budget 40k.', 'blk-mara-001')]))
    await flushed(d)
    const c = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Meeting notes'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id), [made.id])
    await sleep(200)
    assert.notEqual(yp(made.id).get('trashed'), true, 'a page with text typed since stays')
    assert.equal((await calls()).find((x) => x.callId === c.callId)!.restoredAt, null)
    // a page with only a sub-page someone added: kept as well
    const second = await call(writer, 'one_create_page', { title: 'Action items', parentId: 'wiki' })
    await waitFor(() => !!yp(second.id), 5000, 'second arrived')
    meta.doc.transact(() => pages().set('mara-sub', pageEntry({ title: 'Her own sub-page', parentId: second.id, order: 1 })))
    await flushed(meta)
    const c2 = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Action items'))!
    assert.deepEqual((await restore(c2.callId)).body.kept.map((k: { id: string }) => k.id), [second.id])
    await sleep(200)
    assert.notEqual(yp(second.id).get('trashed'), true)
    // "Restore anyway": to the trash (with what is below it — nothing is deleted)
    assert.equal((await restore(c.callId, true)).status, 200)
    await waitFor(() => yp(made.id).get('trashed') === true, 5000, 'forced into the trash')
    assert.ok((await calls()).find((x) => x.callId === c.callId)!.restoredAt)
  })

  test('a board the call made that the team filled since stays — with its rows; an untouched one goes', async () => {
    const db = await call(writer, 'one_create_database', { title: 'Team board', parentId: 'wiki', views: [{ type: 'board' }], rows: [{ title: 'Card by Claude' }] })
    await waitFor(() => !!yp(db.id), 5000, 'db arrived')
    meta.doc.transact(() => {
      for (let i = 1; i <= 3; i++) pages().set(`human-${i}`, pageEntry({ title: `Card typed by Mara ${i}`, parentId: db.id, databaseId: db.id, order: i + 1 }))
    })
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Team board'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id), [db.id])
    await sleep(200)
    assert.notEqual(yp(db.id).get('trashed'), true)
    assert.notEqual(yp(db.rows[0].id).get('trashed'), true, "the call's own row stays with its board")
    // the same call without a person's row: to the trash
    const other = await call(writer, 'one_create_database', { title: 'Scratch board', parentId: 'wiki', views: [{ type: 'board' }], rows: [{ title: 'Only Claude' }] })
    const c2 = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Scratch board'))!
    assert.deepEqual((await restore(c2.callId)).body.kept, [])
    await waitFor(() => yp(other.id).get('trashed') === true, 5000, 'untouched board trashed')
  })

  test('each part is put back once: a retry and "Restore anyway" never write a content part an earlier restore put back', async () => {
    const made = await call(writer, 'one_create_page', { title: 'Glossar', parentId: 'wiki', linkInParent: 'block' })
    const wiki = await doc(`ws:${wsId}:p:wiki`)
    const links = () => wiki.doc.getXmlFragment('default').toArray().filter((n) => (n as Y.XmlElement).nodeName === 'pageLink').length
    await waitFor(() => links() === 1, 5000, 'link in the wiki')
    // the made page is renamed → kept on restore; the wiki's link is taken out
    meta.doc.transact(() => yp(made.id).set('title', 'Glossary'))
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_page' && x.kinds.includes('content') && x.titles.includes('Glossary'))!
    const first = await restore(c.callId)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual(first.body.kept.map((k: { title: string }) => k.title), ['Glossary'])
    await waitFor(() => links() === 0, 5000, 'link taken back')
    // someone writes into the wiki after the restore
    wiki.doc.transact(() => wiki.doc.getXmlFragment('default').insert(wiki.doc.getXmlFragment('default').length, [para('Typed after the restore by Tessera.', 'blk-tess-001')]))
    await flushed(wiki)
    // a plain retry: no changed_since from the first restore's own write — the renamed page is still kept, nothing else runs
    const again = await restore(c.callId)
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.deepEqual(again.body.kept.map((k: { title: string }) => k.title), ['Glossary'])
    assert.equal(again.body.restored, 0)
    // "Restore anyway": only the kept page goes; the wiki keeps Tessera's line
    const forced = await restore(c.callId, true)
    assert.equal(forced.status, 200, JSON.stringify(forced.body))
    await waitFor(() => yp(made.id).get('trashed') === true, 5000, 'kept page trashed')
    await sleep(300)
    assert.ok(wiki.doc.getXmlFragment('default').toString().includes('Typed after the restore'), "the wiki's later text stays")
    assert.match((await restore(c.callId)).body.note, /put back already/)
  })

  test("an upsert's pre-image holds only the fields it wrote: a field a person changed since is neither named nor put back", async () => {
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-keyed', keyProperty: 'Ticket', rows: [{ key: 'K-3', properties: { Owner: 'Mirror' } }] })
    assert.equal(out.rows[0].action, 'updated')
    await waitFor(() => props('tk-3').get('k-owner') === 'Mirror', 5000, 'owner written')
    meta.doc.transact(() => {
      props('tk-3').set('k-note', 'Mara wrote this later')
      yp('tk-3').set('title', 'Ticket 3 (renamed by Mara)')
    })
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_upsert_rows')!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept, [])
    await waitFor(() => props('tk-3').get('k-owner') === undefined, 5000, 'owner back')
    const forced = await restore(c.callId, true)
    assert.equal(forced.status, 200)
    await sleep(200)
    assert.equal(props('tk-3').get('k-note'), 'Mara wrote this later')
    assert.equal(yp('tk-3').get('title'), 'Ticket 3 (renamed by Mara)')
  })

  /* review 3: what "changed since" covers — every stored value, icon / cover / comments, a database's schema, kept children */

  test('a made row a member filled an EMPTY field of since stays (named in kept); its untouched sibling goes; force takes it too', async () => {
    const out = await call(writer, 'one_create_row', { databaseId: 'db-keyed', rows: [{ title: 'Card from Claude', properties: { Ticket: 'K-9' } }, { title: 'Untouched card', properties: { Ticket: 'K-10' } }] })
    const [filled, untouched] = [out.rows[0].id as string, out.rows[1].id as string]
    await waitFor(() => !!yp(filled) && !!yp(untouched), 5000, 'rows arrived')
    assert.equal(props(filled).get('k-owner'), undefined, 'Owner is empty right after the call')
    // Mara fills the field that was empty
    meta.doc.transact(() => props(filled).set('k-owner', 'Mara Lind'))
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_row' && x.titles.includes('Card from Claude'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id), [filled], 'the filled row is named in kept')
    await waitFor(() => yp(untouched).get('trashed') === true, 5000, 'the untouched row goes')
    await sleep(200)
    assert.notEqual(yp(filled).get('trashed'), true, "Mara's value stays with its row")
    assert.equal(props(filled).get('k-owner'), 'Mara Lind')
    assert.equal((await restore(c.callId, true)).status, 200)
    await waitFor(() => yp(filled).get('trashed') === true, 5000, 'forced into the trash')
  })

  test('a made page whose icon or comments a member changed since stays (named in kept)', async () => {
    const iconPage = await call(writer, 'one_create_page', { title: 'Icon page', parentId: 'wiki' })
    const talkPage = await call(writer, 'one_create_page', { title: 'Talk page', parentId: 'wiki' })
    await waitFor(() => !!yp(iconPage.id) && !!yp(talkPage.id), 5000, 'pages arrived')
    meta.doc.transact(() => {
      yp(iconPage.id).set('icon', { type: 'emoji', value: '📘' })
      const thread = new Y.Map<unknown>()
      thread.set('id', 'th-1')
      thread.set('resolved', false)
      ;(yp(talkPage.id).get('comments') as Y.Map<unknown>).set('th-1', thread)
    })
    await flushed(meta)
    for (const [made, title] of [[iconPage.id, 'Icon page'], [talkPage.id, 'Talk page']] as const) {
      const c = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes(title))!
      const res = await restore(c.callId)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id), [made], `${title} is named in kept`)
      await sleep(150)
      assert.notEqual(yp(made).get('trashed'), true, `${title} stays`)
    }
  })

  test('nested made pages: a sub-page that stays keeps its made parent (and what is below it) out of the trash', async () => {
    // someone puts their own page under the made sub-page
    const made = await call(writer, 'one_create_page', { parentId: 'wiki', pages: [{ title: 'Handbuch' }, { title: 'Kapitel 1', parentId: '$0' }, { title: 'Anhang', parentId: '$0' }] })
    const [parent, child, sibling] = [made.pages[0].id as string, made.pages[1].id as string, made.pages[2].id as string]
    await waitFor(() => !!yp(parent) && !!yp(child) && !!yp(sibling), 5000, 'pages arrived')
    meta.doc.transact(() => pages().set('mara-notes', pageEntry({ title: 'Maras Notizen', parentId: child, order: 1 })))
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Handbuch'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id).sort(), [child, parent].sort(), 'the sub-page and its made parent are kept')
    await waitFor(() => yp(sibling).get('trashed') === true, 5000, 'the untouched sibling goes')
    await sleep(200)
    assert.notEqual(yp(parent).get('trashed'), true, 'the made parent of a kept page stays')
    assert.notEqual(yp(child).get('trashed'), true)
    assert.notEqual(yp('mara-notes').get('trashed'), true, "Mara's page stays where it is")
    // text typed into a made sub-page keeps its parent as well
    const made2 = await call(writer, 'one_create_page', { parentId: 'wiki', pages: [{ title: 'Leitfaden' }, { title: 'Teil A', parentId: '$0' }] })
    const [p2, c2] = [made2.pages[0].id as string, made2.pages[1].id as string]
    await waitFor(() => !!yp(p2) && !!yp(c2), 5000, 'second tree arrived')
    const d = await doc(`ws:${wsId}:p:${c2}`)
    d.doc.transact(() => d.doc.getXmlFragment('default').insert(0, [para('Typed by Tessera into the sub-page.', 'blk-tess-sub')]))
    await flushed(d)
    const call2 = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Leitfaden'))!
    const res2 = await restore(call2.callId)
    assert.deepEqual(res2.body.kept.map((k: { id: string }) => k.id).sort(), [c2, p2].sort())
    await sleep(200)
    assert.notEqual(yp(p2).get('trashed'), true)
  })

  test('a made database whose properties or views the team changed since stays (named in kept); force takes it', async () => {
    const db = await call(writer, 'one_create_database', { title: 'Team Tracker', parentId: 'wiki', properties: [{ name: 'Name', type: 'title' }, { name: 'Status', type: 'status' }] })
    await waitFor(() => !!yp(db.id), 5000, 'db arrived')
    const ydb = meta.doc.getMap('databases').get(db.id) as Y.Map<unknown>
    meta.doc.transact(() => {
      ;(ydb.get('properties') as Y.Map<unknown>).set('mara-prop', { id: 'mara-prop', name: 'Budget (Mara)', type: 'number', order: 9 })
      ;(ydb.get('views') as Y.Map<unknown>).set('mara-view', { id: 'mara-view', name: 'Maras Board', type: 'board', filter: null, sorts: [], visibleProperties: [], order: 9 })
    })
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Team Tracker'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.kept.map((k: { id: string }) => k.id), [db.id])
    await sleep(200)
    assert.notEqual(yp(db.id).get('trashed'), true, 'the extended board stays')
    // an untouched database of the same shape goes (the mark is taken after its rows: no false "changed")
    const other = await call(writer, 'one_create_database', { title: 'Scratch tracker', parentId: 'wiki', properties: [{ name: 'Name', type: 'title' }, { name: 'Tag', type: 'select' }], rows: [{ title: 'One', properties: { Tag: 'new option' } }] })
    const c2 = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Scratch tracker'))!
    assert.deepEqual((await restore(c2.callId)).body.kept, [])
    await waitFor(() => yp(other.id).get('trashed') === true, 5000, 'untouched tracker trashed')
    assert.equal((await restore(c.callId, true)).status, 200)
    await waitFor(() => yp(db.id).get('trashed') === true, 5000, 'forced into the trash')
  })

  /* review 4: opening a page is no change — the editor's closing paragraph and the block ids it fills in */

  test("a member who only opens a made page or an inline database's host changed nothing: Restore puts both back", async () => {
    meta.doc.transact(() => pages().set('host-open', pageEntry({ title: 'Besprechung', parentId: 'wiki', order: 9 })))
    await flushed(meta)
    const made = await call(writer, 'one_create_page', { title: 'Notizen', parentId: 'wiki', markdown: 'Text from Claude.\n\n- one\n- two' })
    const db = await call(writer, 'one_create_database', { title: 'Inline board', inline: { pageId: 'host-open' }, rows: [{ title: 'I1' }] })
    await waitFor(() => !!yp(made.id) && !!yp(db.id), 5000, 'page and database arrived')
    // what an editor writes when the member opens the page: the empty paragraph it keeps after a closing list / database
    // block, an id on a block that has none — and nothing else
    const opens = async (id: string, closing: string) => {
      const d = await doc(`ws:${wsId}:p:${id}`)
      const frag = d.doc.getXmlFragment('default')
      await waitFor(() => (frag.get(frag.length - 1) as Y.XmlElement | undefined)?.nodeName === closing, 5000, `${id} ends with its ${closing}`)
      d.doc.transact(() => {
        frag.toArray().forEach((n, i) => {
          if (n instanceof Y.XmlElement && !n.getAttribute('id')) n.setAttribute('id', `ed-fill-${i}-0001`)
        })
        const trailing = new Y.XmlElement('paragraph')
        trailing.setAttribute('id', 'ed-trailing-0001')
        frag.insert(frag.length, [trailing])
      })
      await flushed(d)
      return d
    }
    await opens(made.id, 'bulletList')
    const host = await opens('host-open', 'databaseBlock')
    const pageCall = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Notizen'))!
    const r1 = await restore(pageCall.callId)
    assert.equal(r1.status, 200, JSON.stringify(r1.body))
    assert.deepEqual(r1.body.kept, [], 'an opened page is not "changed since"')
    await waitFor(() => yp(made.id).get('trashed') === true, 5000, 'the opened page goes to the trash')
    const dbCall = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Inline board'))!
    const r2 = await restore(dbCall.callId)
    assert.equal(r2.status, 200, JSON.stringify(r2.body))
    assert.deepEqual(r2.body.kept, [])
    await waitFor(() => yp(db.id).get('trashed') === true, 5000, 'the inline database goes to the trash')
    await waitFor(() => !host.doc.getXmlFragment('default').toArray().some((n) => (n as Y.XmlElement).nodeName === 'databaseBlock'), 5000, "the host's database block is taken back")
    // a real edit after opening still counts: typed text keeps a made page
    const typed = await call(writer, 'one_create_page', { title: 'Protokoll', parentId: 'wiki', markdown: '- first' })
    const d = await opens(typed.id, 'bulletList')
    d.doc.transact(() => d.doc.getXmlFragment('default').insert(0, [para('Mara typed this.', 'blk-mara-open')]))
    await flushed(d)
    const typedCall = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Protokoll'))!
    assert.deepEqual((await restore(typedCall.callId)).body.kept.map((k: { id: string }) => k.id), [typed.id])
  })
})

/* ------------------------------------------------------------------ upsert: all or nothing (in process) */

describe('one_upsert_rows is all or nothing: a step that fails takes the values AND the bodies back', () => {
  test('the second body cannot be written → the first body, the changed value and the new row are taken back; no pre-image kept', async () => {
    const docs = new Map<string, Y.Doc>()
    const get = (name: string) => docs.get(name) ?? (docs.set(name, new Y.Doc()), docs.get(name)!)
    const ws = 'w1'
    const s = {
      log: { info() {}, warn() {}, error() {}, debug() {} },
      config: { publicUrl: 'https://one.test' },
      repo: { members: () => [], file: () => undefined },
      collab: {
        write: async <T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> => {
          if (name === contentDoc(ws, 'tk-2')) throw new Error('disk full')
          const d = get(name)
          let out!: T
          d.transact(() => {
            out = fn(d)
          })
          return out
        },
        read: async <T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> => fn(get(name)),
      },
    } as unknown as Services
    const { WorkspaceModel: Model } = await import('../src/api/model.ts')
    const model = new Model(s)
    const m = get(metaDoc(ws))
    addDatabase(m, 'db-keyed', 'Tickets', [{ id: 'k-title', name: 'Name', type: 'title' }, { id: 'k-key', name: 'Ticket', type: 'text', key: true }, { id: 'k-owner', name: 'Owner', type: 'text' }])
    m.transact(() => {
      for (let i = 1; i <= 2; i++) m.getMap('pages').set(`tk-${i}`, pageEntry({ title: `Ticket ${i}`, parentId: 'db-keyed', databaseId: 'db-keyed', order: i }, { 'k-key': `K-${i}` }))
    })
    const recorded: unknown[] = []
    const rec: Recorder = { callId: 'c1', rows: (p) => void recorded.push(['rows', p]), pages: (p) => void recorded.push(['pages', p]), content: (id) => void recorded.push(['content', id]) }
    const batch = new McpBatch(s, model, new McpWrites(s, model))
    await assert.rejects(
      () => batch.upsertRows(ws, { databaseId: 'db-keyed', keyProperty: 'Ticket', rows: [{ key: 'K-1', properties: { Owner: 'Mirror' }, markdown: 'Mirror body for ticket 1.' }, { key: 'K-2', markdown: 'Mirror body for ticket 2.' }, { key: 'K-NEW', title: 'Brand new' }] }, 'api:t1', rec),
      /disk full/,
    )
    const tk1 = m.getMap('pages').get('tk-1') as Y.Map<unknown>
    assert.ok(!get(contentDoc(ws, 'tk-1')).getXmlFragment('default').toString().includes('Mirror body'), 'the first body is taken back')
    assert.doesNotMatch(String(tk1.get('plain') ?? ''), /Mirror/)
    assert.equal((tk1.get('properties') as Y.Map<unknown>).get('k-owner'), undefined, 'the changed value is back')
    const fresh = [...m.getMap('pages').entries()].filter(([, p]) => (p as Y.Map<unknown>).get('title') === 'Brand new')
    assert.equal(fresh.length, 1)
    assert.equal((fresh[0]![1] as Y.Map<unknown>).get('trashed'), true, 'the new row goes to the trash')
    assert.deepEqual(recorded, [], 'a call taken back keeps no pre-image')
  })
})
