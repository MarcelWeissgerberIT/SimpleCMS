/**
 * Review 7 on the team server — the bridge's rules where the server had its own (MCP plan § 3.2 / § 3.3 / § 4):
 *  - one_move_row never gives a select bound to a shared list an option of its own (the list owns them);
 *  - one_delete_property clears no rollup in a locked database or in One's own database (refused), and leaves a
 *    template's alone;
 *  - Restore is all or nothing (Weg 4 D3): an inline database the team added a row to, or a page made with linkInParent
 *    that someone wrote into, refuses the whole call — the database keeps its block, both pages keep their links;
 *  - one_create_database: a property of another type named like the default title "Name" is refused, as on the bridge;
 *  - one rule for options (colours lower-cased, unknown colours, duplicates refused — also options.add), an unknown
 *    property is not_found, an ambiguous view bad_argument, the lock the person's decision (rejected), a long option
 *    name cut.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Wissensbasis).
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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}, page: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1, ...page }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    props.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    const views = new Y.Map<unknown>()
    views.set('v-1', { id: 'v-1', name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id), order: 0 })
    views.set('v-2', { id: 'v-2', name: 'Board', type: 'table', filter: null, sorts: [], visibleProperties: [], order: 1 })
    views.set('v-3', { id: 'v-3', name: 'Board', type: 'table', filter: null, sorts: [], visibleProperties: [], order: 2 })
    ydb.set('views', views)
    ydb.set('nextUniqueId', 1)
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-parity7', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

async function refusal(client: McpClient, name: string, args: Record<string, unknown>): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.equal(res.isError, true, `${name} should be refused: ${res.content[0]?.text}`)
  return res.content[0]!.text
}

const para = (text: string, id: string) => {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('id', id)
  p.insert(0, [new Y.XmlText(text)])
  return p
}

describe('review 7: the team server takes what the bridge takes', () => {
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
  const dbOf = (id: string) => meta.doc.getMap('databases').get(id) as Y.Map<unknown>
  const defs = (id: string) => [...(dbOf(id).get('properties') as Y.Map<unknown>).values()] as Def[]
  const calls = async () => (await owner.get(`/api/workspaces/${wsId}/mcp-calls`)).body as Array<{ callId: string; tool: string; titles: string[] }>
  const restore = (callId: string) => owner.post(`/api/workspaces/${wsId}/mcp-calls/${callId}/restore`, {})
  const hostXml = async (id: string) => {
    const d = await doc(`ws:${wsId}:p:${id}`)
    await sleep(150)
    return d.doc.getXmlFragment('default').toString()
  }

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht-p7.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => {
      pages().set('host', pageEntry({ title: 'Projekt Nordlicht', order: 1 }))
      pages().set('host2', pageEntry({ title: 'Wissensbasis', order: 2 }))
      pages().set('host3', pageEntry({ title: 'Handbuch', order: 3 }))
      meta.doc.getMap('lists').set('list-stages', { id: 'list-stages', name: 'Stages', items: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], createdAt: 1, updatedAt: 1 })
    })
    // move_row: an inbox whose Stage holds Omega, a pipeline whose Stage is bound to the list
    addDatabase(meta.doc, 'db-inbox', 'Inbox leads', [
      { id: 'i-title', name: 'Name', type: 'title' },
      { id: 'i-stage', name: 'Stage', type: 'select', options: [{ id: 'o-x', name: 'Omega', color: 'red' }] },
    ])
    addDatabase(meta.doc, 'db-pipe', 'Pipeline', [
      { id: 'p-title', name: 'Name', type: 'title' },
      { id: 'p-stage', name: 'Stage', type: 'select', options: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], listId: 'list-stages' },
    ])
    // delete_property: Deals.Amount rolled up from a locked database, from the memory, from a template's database
    addDatabase(meta.doc, 'db-deals', 'Deals', [
      { id: 'a-title', name: 'Name', type: 'title' },
      { id: 'a-amt', name: 'Amount', type: 'number' },
      { id: 'a-note', name: 'Note', type: 'number' },
      { id: 'a-pages', name: 'Pages', type: 'number' },
    ])
    const rollupDb = (id: string, title: string, target: string, extra: Record<string, unknown> = {}, page: Record<string, unknown> = {}) =>
      addDatabase(
        meta.doc,
        id,
        title,
        [
          { id: `${id}-title`, name: 'Name', type: 'title' },
          { id: `${id}-rel`, name: 'Deals', type: 'relation', relationDatabaseId: 'db-deals' },
          { id: `${id}-sum`, name: 'Total', type: 'rollup', rollup: { relationPropertyId: `${id}-rel`, targetPropertyId: target, fn: 'sum' } },
        ],
        extra,
        page,
      )
    rollupDb('db-reports', 'Reports', 'a-amt', { locked: true })
    rollupDb('db-mem', 'Memory', 'a-note', { system: 'memory' })
    meta.doc.transact(() => pages().set('tpl', pageEntry({ title: 'Report template', template: { name: 'Report template' }, hidden: true })))
    rollupDb('db-tpl', 'Template report', 'a-pages', {}, { parentId: 'tpl' })
    meta.doc.transact(() => pages().set('lead', pageEntry({ title: 'Lead Tessera', parentId: 'db-inbox', databaseId: 'db-inbox', order: 1 }, { 'i-stage': 'o-x' })))
    await flushed(meta)
    for (const id of ['host', 'host2', 'host3']) {
      const c = await doc(`ws:${wsId}:p:${id}`)
      c.doc.transact(() => c.doc.getXmlFragment('default').insert(0, [para('Intro text', `blk-${id}-1`)]))
      await flushed(c)
    }
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server?.stop()
  })

  test('one_move_row never gives a select bound to a shared list an option of its own — refused with the list named, nothing moved', async () => {
    const msg = await refusal(writer, 'one_move_row', { id: 'lead', databaseId: 'db-pipe' })
    assert.match(msg, /^bad_argument: /, msg)
    assert.match(msg, /shared list "Stages"/, msg)
    await sleep(200)
    assert.deepEqual((defs('db-pipe').find((d) => d.id === 'p-stage')!.options as Array<{ name: string }>).map((o) => o.name), ['Alpha', 'Beta'])
    assert.equal(yp('lead').get('databaseId'), 'db-inbox')
  })

  test("one_delete_property clears no rollup in a locked database or in One's own database; a template's database is left alone", async () => {
    const target = (db: string) => (defs(db).find((d) => d.id === `${db}-sum`)!.rollup as { targetPropertyId: string }).targetPropertyId
    const locked = await refusal(writer, 'one_delete_property', { databaseId: 'db-deals', property: 'Amount' })
    assert.match(locked, /^locked: property: "Reports" is locked in One: its rollup "Total" rolls up "Amount"/, locked)
    const mem = await refusal(writer, 'one_delete_property', { databaseId: 'db-deals', property: 'Note' })
    assert.match(mem, /^system_database: property: "Memory" is One's memory database/, mem)
    await sleep(200)
    assert.deepEqual([target('db-reports'), target('db-mem')], ['a-amt', 'a-note'])
    assert.ok(defs('db-deals').some((d) => d.id === 'a-amt') && defs('db-deals').some((d) => d.id === 'a-note'), 'nothing deleted')
    // a rollup in a template's database: not looked at over MCP (it reads as not found) — the delete goes through, the
    // template's rollup is left as it was
    await call(writer, 'one_delete_property', { databaseId: 'db-deals', property: 'Pages' })
    await waitFor(() => !defs('db-deals').some((d) => d.id === 'a-pages'), 5000, 'Pages deleted')
    assert.equal(target('db-tpl'), 'a-pages')
  })

  test('Restore: an inline database the team added a row to refuses the call — the database and its block stay', async () => {
    const made = await call(writer, 'one_create_database', { title: 'Board', inline: { pageId: 'host' }, rows: [{ title: 'Kick-off' }] })
    await waitFor(() => !!yp(made.id), 5000, 'db')
    // a member adds a row: the database is theirs too now
    meta.doc.transact(() => pages().set('r-member', pageEntry({ title: 'Member row', parentId: made.id, databaseId: made.id })))
    await flushed(meta)
    const c = (await calls()).find((x) => x.tool === 'one_create_database' && x.titles.includes('Board'))!
    const res = await restore(c.callId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.deepEqual(res.body.error.details.changed.map((k: { id: string; what: string[] }) => [k.id, k.what]), [[made.id, ['below']]])
    assert.notEqual(yp(made.id).get('trashed'), true, 'the database stays')
    const xml = await hostXml('host')
    assert.match(xml, /databaseblock/i, `its block stays: ${xml}`)
    assert.match(xml, /Intro text/)
  })

  test('Restore: a page made with linkInParent that someone wrote into refuses the call — both pages and both links stay, also with force', async () => {
    const made = await call(writer, 'one_create_page', { parentId: 'host2', linkInParent: 'block', pages: [{ title: 'Kick-off notes' }, { title: 'Agenda' }] })
    const [notes, agenda] = made.pages as Array<{ id: string }>
    await waitFor(() => !!yp(notes!.id) && !!yp(agenda!.id), 5000, 'pages')
    const kid = await doc(`ws:${wsId}:p:${notes!.id}`)
    kid.doc.transact(() => kid.doc.getXmlFragment('default').insert(0, [para('Typed by Mara Lind', 'blk-kid-1')]))
    await flushed(kid)
    const c = (await calls()).find((x) => x.tool === 'one_create_page' && x.titles.includes('Kick-off notes'))!
    for (const force of [false, true]) {
      const res = await owner.post(`/api/workspaces/${wsId}/mcp-calls/${c.callId}/restore`, force ? { force } : {})
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.deepEqual(res.body.error.details.changed.map((k: { id: string; what: string[] }) => [k.id, k.what]), [[notes!.id, ['text']]])
      assert.equal(res.body.error.details.canForce, false, 'the call only made pages: force has nothing to put back')
    }
    await sleep(200)
    assert.notEqual(yp(notes!.id).get('trashed'), true)
    assert.notEqual(yp(agenda!.id).get('trashed'), true, 'the untouched page stays too')
    const xml = await hostXml('host2')
    assert.ok(xml.includes(`pageId="${notes!.id}"`) && xml.includes(`pageId="${agenda!.id}"`), `both links stay: ${xml}`)
    assert.match(xml, /Intro text/)
  })

  test('one_create_database: a property of another type named "Name" is refused (no quiet "Title"), as on the bridge', async () => {
    const msg = await refusal(writer, 'one_create_database', { title: 'People', parentId: 'host3', properties: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'email' }] })
    assert.match(msg, /^bad_argument: properties\[0\]\.name: "Name" is the name of the title property/, msg)
    assert.ok(![...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'People'), 'nothing made')
    // with a title property of its own, "Name" may be another column's name
    const ok = await call(writer, 'one_create_database', { title: 'People 2', parentId: 'host3', properties: [{ name: 'Person', type: 'title' }, { name: 'Name', type: 'text' }] })
    assert.deepEqual(
      (ok.properties as Array<{ name: string; type: string }>).map((p) => [p.name, p.type]),
      [
        ['Person', 'title'],
        ['Name', 'text'],
      ],
    )
  })

  test('one rule for options and codes: colours lower-cased, an unknown colour / a duplicate refused (also options.add), unknown property not_found, ambiguous view bad_argument, the lock rejected, a long name cut', async () => {
    const db = await call(writer, 'one_create_database', { title: 'Opt probe', parentId: 'host3' })
    const made = await call(writer, 'one_create_property', { databaseId: db.id, name: 'Prio', type: 'select', options: [{ name: 'High', color: 'Red' }] })
    assert.equal(made.property.options[0].color, 'red')
    assert.match(await refusal(writer, 'one_create_property', { databaseId: db.id, name: 'Prio2', type: 'select', options: ['A', 'a'] }), /^bad_argument: options\[1\]\.name: option "a" is listed twice/)
    assert.match(await refusal(writer, 'one_create_property', { databaseId: db.id, name: 'Prio3', type: 'select', options: [{ name: 'X', color: 'teal' }] }), /^bad_argument: options\[0\]\.color: "teal" is not a colour/)
    assert.match(await refusal(writer, 'one_update_property', { databaseId: db.id, property: 'Prio', options: { add: ['Low', 'low'] } }), /^bad_argument: options\.add\[1\]\.name: option "low" is listed twice/)
    assert.match(await refusal(writer, 'one_update_property', { databaseId: db.id, property: 'Prio', options: { add: [{ name: 'Mid', color: 'teal' }] } }), /^bad_argument: options\.add\[0\]\.color/)
    assert.match(await refusal(writer, 'one_delete_property', { databaseId: db.id, property: 'Budgte' }), /^not_found: /)
    assert.match(await refusal(writer, 'one_update_database', { id: db.id, locked: true }), /^rejected: locked: /)
    assert.match(await refusal(writer, 'one_update_view', { databaseId: 'db-inbox', view: 'Board', name: 'x' }), /^bad_argument: view: "Inbox leads" has several views named "Board"/)
    const long = 'Ein sehr langer Optionsname, der weit über sechzig Zeichen hinausgeht und gekürzt wird'
    const renamed = await call(writer, 'one_update_property', { databaseId: db.id, property: 'Prio', options: { update: [{ name: 'High', newName: long }] } })
    assert.equal(renamed.property.options[0].name, long.slice(0, 60).trim())
  })
})
