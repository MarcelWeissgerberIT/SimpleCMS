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
