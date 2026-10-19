/**
 * MCP T-a, Weg 4 D1 on the team server (the owner's decision): two-way relations stay out of MCP until T-b.
 *  - a value of a two-way relation — an explicit pair (`<id>.2way`), a sub-items or a dependencies pair — is refused on
 *    every row tool (one_create_row single and rows[], one_update_row single and rows[], one_upsert_rows) with
 *    `refused_type` and the shared words; nothing is written: no row, no value, no link on a partner row;
 *  - `twoWay: true` is refused by one_create_property and one_create_database: no property on either side, no database;
 *  - a one-way relation (and `twoWay: false`) stays fine.
 * Fictional data (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer } from './helpers.ts'

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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}) {
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
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-weg4', version: '1.0.0' })
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

/** The shared words of a refused two-way value (src/shared/mcp/twoWay.ts), after its path. */
const twoWayWords = (name: string) => `${JSON.stringify(name)} is two-way (or a sub-items / dependencies pair); set it in One. Nothing was changed. A one-way relation is fine`

describe('Weg 4 D1: two-way relations stay out of MCP on the team server', () => {
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  const pages = () => meta.doc.getMap('pages')
  const yp = (id: string) => pages().get(id) as Y.Map<unknown> | undefined
  const valueOf = (id: string, prop: string) => ((yp(id)?.get('properties') as Y.Map<unknown> | undefined)?.toJSON() ?? {})[prop]
  const titled = (title: string) => [...pages().values()].filter((p) => (p as Y.Map<unknown>).get('title') === title).length
  const dbOf = (id: string) => meta.doc.getMap('databases').get(id) as Y.Map<unknown> | undefined
  const defs = (id: string) => [...((dbOf(id)?.get('properties') as Y.Map<unknown> | undefined)?.values() ?? [])] as Def[]
  /** what a refused call could have written: every value of the seeded rows, the schema of both databases */
  const snapshot = () => JSON.stringify([['proj-1', 'task-1', 'task-2'].map((id) => (yp(id)?.get('properties') as Y.Map<unknown>).toJSON()), defs('db-tasks').map((d) => d.id), defs('db-proj').map((d) => d.id), pages().size])

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht-weg4.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = openDoc(server, owner, `ws:${wsId}`)
    await meta.synced
    addDatabase(meta.doc, 'db-proj', 'Projects', [
      { id: 'p-title', name: 'Name', type: 'title' },
      // the reverse side of Tasks.Project: Project is two-way
      { id: 't-proj.2way', name: 'Tasks', type: 'relation', relationDatabaseId: 'db-tasks' },
    ])
    addDatabase(
      meta.doc,
      'db-tasks',
      'Tasks',
      [
        { id: 't-title', name: 'Name', type: 'title' },
        { id: 't-code', name: 'Code', type: 'text' },
        { id: 't-proj', name: 'Project', type: 'relation', relationDatabaseId: 'db-proj' },
        { id: 't-ref', name: 'Reference', type: 'relation', relationDatabaseId: 'db-proj' },
        { id: 't-parent', name: 'Parent item', type: 'relation', relationDatabaseId: 'db-tasks' },
        { id: 't-parent.2way', name: 'Sub-items', type: 'relation', relationDatabaseId: 'db-tasks' },
        { id: 't-blk', name: 'Blocked by', type: 'relation', relationDatabaseId: 'db-tasks' },
        { id: 't-blk.2way', name: 'Blocking', type: 'relation', relationDatabaseId: 'db-tasks' },
      ],
      {
        subItems: { enabled: true, parentPropertyId: 't-parent', childPropertyId: 't-parent.2way' },
        dependencies: { enabled: true, blockedByPropertyId: 't-blk', blockingPropertyId: 't-blk.2way', onConflict: 'warn' },
      },
    )
    meta.doc.transact(() => {
      pages().set('proj-1', pageEntry({ title: 'Nordlicht', parentId: 'db-proj', databaseId: 'db-proj', order: 1 }))
      pages().set('task-1', pageEntry({ title: 'Launch plan', parentId: 'db-tasks', databaseId: 'db-tasks', order: 1 }, { 't-code': 'LP' }))
      pages().set('task-2', pageEntry({ title: 'Tessera', parentId: 'db-tasks', databaseId: 'db-tasks', order: 2 }, { 't-code': 'TS' }))
    })
    await flushed(meta)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    meta?.destroy()
    await server?.stop()
  })

  test('a two-way value is refused on every row tool — refused_type, the shared words, nothing written', async () => {
    const before = snapshot()
    // one_create_row: an explicit pair, a sub-items parent, a dependency — a cleared value too
    const single = await refusal(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Mara Lind', properties: { Project: ['proj-1'] } })
    assert.ok(single.startsWith(`refused_type: properties.Project: ${twoWayWords('Project')}`), single)
    const parent = await refusal(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Mara Lind', properties: { 'Parent item': ['task-1'] } })
    assert.ok(parent.startsWith(`refused_type: properties.Parent item: ${twoWayWords('Parent item')}`), parent)
    // rows[]: every row that does not fit is named, the code they share
    const batch = await refusal(writer, 'one_create_row', { databaseId: 'db-tasks', rows: [{ title: 'Mara Lind' }, { title: 'Kick-off', properties: { 'Blocked by': ['task-1'] } }, { title: 'Review', properties: { Blocking: [] } }] })
    assert.match(batch, /^refused_type: rows: 2 of 3 rows do not fit:\n- rows\[1\] \("Kick-off"\): properties\.Blocked by: "Blocked by" is two-way \(or a sub-items \/ dependencies pair\); set it in One\.[^\n]*\n- rows\[2\] \("Review"\): properties\.Blocking: "Blocking" is two-way/, batch)
    // one_update_row: single and rows[], clearing too
    const upd = await refusal(writer, 'one_update_row', { id: 'task-2', properties: { 'Sub-items': ['task-1'] } })
    assert.ok(upd.startsWith(`refused_type: properties.Sub-items: ${twoWayWords('Sub-items')}`), upd)
    const cleared = await refusal(writer, 'one_update_row', { id: 'task-2', properties: { Project: null } })
    assert.ok(cleared.startsWith(`refused_type: properties.Project: ${twoWayWords('Project')}`), cleared)
    const rows = await refusal(writer, 'one_update_row', { rows: [{ id: 'task-1', properties: { Code: 'LP-2' } }, { id: 'task-2', properties: { 'Blocked by': ['task-1'] } }] })
    // a single row that does not fit keeps its own refusal, with its path
    assert.match(rows, /^refused_type: rows\[1\]: properties\.Blocked by: "Blocked by" is two-way \(or a sub-items \/ dependencies pair\); set it in One\./, rows)
    // one_upsert_rows: a new row and a changed one
    const ups = await refusal(writer, 'one_upsert_rows', { databaseId: 'db-tasks', keyProperty: 'Code', rows: [{ key: 'LP', properties: { Project: ['proj-1'] } }, { key: 'NEW', title: 'Mara Lind', properties: { 'Parent item': ['task-1'] } }] })
    // (the upsert's own refusal lists every row on one line, as on the bridge)
    assert.match(ups, /^bad_argument: rows: 2 of 2 rows do not fit: rows\[0\] \(key "LP"\): refused_type: properties\.Project: "Project" is two-way .*; rows\[1\] \(key "NEW"\): refused_type: properties\.Parent item: "Parent item" is two-way/, ups)
    // a relation on the partner's side (Projects.Tasks) is two-way too
    const back = await refusal(writer, 'one_update_row', { id: 'proj-1', properties: { Tasks: ['task-1'] } })
    assert.ok(back.startsWith(`refused_type: properties.Tasks: ${twoWayWords('Tasks')}`), back)
    await sleep(200)
    assert.equal(snapshot(), before, 'nothing written: no row, no value, no partner link')
    assert.equal(titled('Mara Lind'), 0)
  })

  test('a one-way relation stays fine: its value is written, the related row is not touched', async () => {
    const made = await call(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Mara Lind', properties: { Reference: ['proj-1'] } })
    await sleep(200)
    assert.deepEqual(valueOf(made.id, 't-ref'), ['proj-1'])
    assert.equal(valueOf('proj-1', 't-proj.2way'), undefined, 'the project is not touched')
    await call(writer, 'one_update_row', { id: 'task-1', properties: { Reference: ['proj-1'] } })
    await sleep(200)
    assert.deepEqual(valueOf('task-1', 't-ref'), ['proj-1'])
  })

  test('twoWay: true is refused by one_create_property and one_create_database — nothing made on either side; twoWay: false is fine', async () => {
    const before = snapshot()
    const prop = await refusal(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Owner project', type: 'relation', relation: { databaseId: 'db-proj', twoWay: true, reverseName: 'Owned tasks' } })
    assert.match(prop, /^refused_type: relation\.twoWay: two-way relations are set up in One; over MCP a relation is one-way\. Nothing was changed\. Leave out twoWay/, prop)
    const dbs = meta.doc.getMap('databases').size
    const db = await refusal(writer, 'one_create_database', { title: 'Notes', properties: [{ name: 'Topic', type: 'text' }, { name: 'Project', type: 'relation', relation: { databaseId: 'db-proj', twoWay: true } }] })
    assert.match(db, /^refused_type: properties\[1\]\.relation\.twoWay: two-way relations are set up in One/, db)
    // a self-relation too
    const self = await refusal(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Related', type: 'relation', relation: { databaseId: 'db-tasks', twoWay: true } })
    assert.match(self, /^refused_type: relation\.twoWay: /, self)
    await sleep(200)
    assert.equal(snapshot(), before)
    assert.equal(meta.doc.getMap('databases').size, dbs)
    assert.equal(titled('Notes'), 0)
    // one-way: fine
    const one = await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Owner project', type: 'relation', relation: { databaseId: 'db-proj', twoWay: false } })
    assert.equal(one.property.name, 'Owner project')
    assert.equal(one.reverse, undefined)
    await sleep(200)
    assert.ok(!defs('db-proj').some((d) => d.id === `${one.property.id}.2way`), 'no reverse property')
  })
})
