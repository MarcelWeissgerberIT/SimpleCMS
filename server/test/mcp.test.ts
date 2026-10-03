/**
 * Remote MCP (docs/MCP.md § Team server): the MCP SDK's own client against a real server — initialize,
 * tools per token scope, every tool's happy path and its failures, live writes, privacy, auth.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1 }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    props.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    const views = new Y.Map<unknown>()
    views.set('v-1', { id: 'v-1', name: 'Board', type: 'board', filter: null, sorts: [{ propertyId: 'p-est', direction: 'desc' }], visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id), groupBy: 'p-status', order: 0 })
    ydb.set('views', views)
    ydb.set('nextUniqueId', 1)
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

const STATUS = [{ id: 'o-todo', name: 'Not started', color: 'gray', group: 'todo' }, { id: 'o-doing', name: 'In progress', color: 'blue', group: 'in_progress' }, { id: 'o-done', name: 'Done', color: 'green', group: 'done' }]
const TASKS: Def[] = [
  { id: 'p-title', name: 'Name', type: 'title' },
  { id: 'p-status', name: 'Status', type: 'status', options: STATUS },
  { id: 'p-tags', name: 'Tags', type: 'multi_select', options: [{ id: 't-a', name: 'Alpha', color: 'red' }, { id: 't-b', name: 'Beta', color: 'blue' }] },
  { id: 'p-due', name: 'Due', type: 'date' },
  { id: 'p-est', name: 'Estimate', type: 'number' },
  { id: 'p-done', name: 'Done?', type: 'checkbox' },
  { id: 'p-proj', name: 'Project', type: 'relation', relationDatabaseId: 'db-proj' },
]
const PROJECTS: Def[] = [
  { id: 'q-title', name: 'Name', type: 'title' },
  { id: 'p-proj.2way', name: 'Tasks', type: 'relation', relationDatabaseId: 'db-tasks' },
]

/** Content blocks the way y-prosemirror stores them (a small subset of the editor's nodes). */
type Spec = string | { type: string; attrs?: Record<string, unknown>; text?: Array<[string, Record<string, unknown>?]>; content?: Spec[] }
function toY(spec: Spec): Y.XmlElement {
  if (typeof spec === 'string') return toY({ type: 'paragraph', text: [[spec]] })
  const el = new Y.XmlElement(spec.type)
  for (const [k, v] of Object.entries(spec.attrs ?? {})) el.setAttribute(k, v as string)
  const kids: Array<Y.XmlElement | Y.XmlText> = []
  if (spec.text) {
    const t = new Y.XmlText()
    t.applyDelta(spec.text.map(([insert, attributes]) => ({ insert, attributes: attributes ?? {} })))
    kids.push(t)
  }
  for (const c of spec.content ?? []) kids.push(toY(c))
  if (kids.length) el.insert(0, kids)
  return el
}

const write = (d: Y.Doc, specs: Spec[]) => d.transact(() => d.getXmlFragment('default').insert(0, specs.map(toY)))

/* ------------------------------------------------------------------ MCP client */

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  return client
}

async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

async function fails(client: McpClient, name: string, args: Record<string, unknown>, pattern: RegExp): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.equal(res.isError, true, `${name} should fail`)
  assert.match(res.content[0]!.text, pattern)
  return res.content[0]!.text
}

const READ_TOOLS = ['one_get_database', 'one_get_page', 'one_list_databases', 'one_overview', 'one_query_database', 'one_search']
const WRITE_TOOLS = ['one_create_database', 'one_create_page', 'one_create_property', 'one_create_row', 'one_trash_page', 'one_update_page', 'one_update_row']

/* ------------------------------------------------------------------ suite */

describe('remote MCP', () => {
  let server: TestServer
  let owner: Client, other: Client
  let wsId: string, ownerId: string
  let meta: DocClient
  let writer: McpClient, reader: McpClient, outsider: McpClient
  let writeToken: string, readToken: string
  const open: DocClient[] = []
  const clients: McpClient[] = []

  const doc = async (client: Client, name: string) => {
    const d = openDoc(server, client, name)
    open.push(d)
    await d.synced
    return d
  }

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'owner@mcp.test')
    other = await signIn(server, 'other@mcp.test')
    ownerId = (await owner.get('/api/me')).body.user.id
    wsId = (await owner.post('/api/workspaces', { name: 'MCP Works' })).body.id
    const otherWs = (await other.post('/api/workspaces', { name: 'Elsewhere' })).body.id

    meta = await doc(owner, `ws:${wsId}`)
    addDatabase(meta.doc, 'db-tasks', 'Tasks', TASKS)
    addDatabase(meta.doc, 'db-proj', 'Projects', PROJECTS)
    addDatabase(meta.doc, 'db-locked', 'Archive', [{ id: 'l-title', name: 'Name', type: 'title' }], { locked: true })
    meta.doc.transact(() => {
      const pages = meta.doc.getMap('pages')
      pages.set('proj-1', pageEntry({ title: 'Apollo', parentId: 'db-proj', databaseId: 'db-proj', order: 1 }, { 'p-proj.2way': ['row-1'] }))
      pages.set('row-1', pageEntry({ title: 'Write the brief', parentId: 'db-tasks', databaseId: 'db-tasks', order: 1, createdAt: 1000 }, { 'p-status': 'o-doing', 'p-tags': ['t-a'], 'p-due': { start: '2026-10-05', end: null }, 'p-est': 3, 'p-proj': ['proj-1'] }))
      pages.set('row-2', pageEntry({ title: 'Review copy', parentId: 'db-tasks', databaseId: 'db-tasks', order: 2, createdAt: 2000 }, { 'p-status': 'o-todo', 'p-tags': ['t-a', 't-b'], 'p-due': { start: '2026-11-20', end: null }, 'p-est': 8 }))
      pages.set('row-3', pageEntry({ title: 'Ship it', parentId: 'db-tasks', databaseId: 'db-tasks', order: 3, createdAt: 3000 }, { 'p-status': 'o-done', 'p-done': true, 'p-est': 1 }))
      pages.set('doc-1', pageEntry({ title: 'Handbook', order: 1, icon: { type: 'emoji', value: '📘' }, plain: 'How we work\nOnboarding checklist for new people' }))
      pages.set('doc-2', pageEntry({ title: 'Onboarding', parentId: 'doc-1', order: 1, plain: 'Read the Handbook' }))
      pages.set('old-1', pageEntry({ title: 'Old notes', order: 5, trashed: true, trashedAt: Date.now(), plain: 'stale handbook draft' }))
      meta.doc.getMap('people').set(ownerId, { id: ownerId, name: 'Olivia Owner', color: 'blue' })
    })
    await flushed(meta)

    // the Handbook's content, with a link to Onboarding, a mention of a private page and a database block
    const content = await doc(owner, `ws:${wsId}:p:doc-1`)
    write(content.doc, [
      { type: 'heading', attrs: { level: 1 }, text: [['How we work']] },
      { type: 'paragraph', text: [['Read '], ['this', { bold: {} }], [' and '], ['the site', { link: { href: 'https://example.com' } }], ['.']] },
      { type: 'bulletList', content: [{ type: 'listItem', content: ['First'] }, { type: 'listItem', content: ['Second', { type: 'bulletList', content: [{ type: 'listItem', content: ['Nested'] }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: ['Done thing'] }, { type: 'taskItem', attrs: { checked: false }, content: ['Open thing'] }] },
      { type: 'pageLink', attrs: { pageId: 'doc-2' } },
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'secret-1', label: 'Secret plans', kind: 'page' } }] },
      { type: 'databaseBlock', attrs: { databaseId: 'db-tasks', viewId: null } },
      { type: 'codeBlock', attrs: { language: 'ts' }, text: [['const x = 1']] },
    ])
    await flushed(content)

    // a private page of the owner: never visible over MCP
    const priv = await doc(owner, `ws:${wsId}:u:${ownerId}`)
    priv.doc.transact(() => priv.doc.getMap('pages').set('secret-1', pageEntry({ title: 'Secret plans', plain: 'classified handbook' })))
    await flushed(priv)

    writeToken = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    readToken = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Reader', scope: 'read' })).body.token
    const otherToken = (await other.post(`/api/workspaces/${otherWs}/tokens`, { name: 'Other', scope: 'write' })).body.token
    writer = await connect(server.url, writeToken)
    reader = await connect(server.url, readToken)
    outsider = await connect(server.url, otherToken)
    clients.push(writer, reader, outsider)
  })

  after(async () => {
    for (const c of clients) await c.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('initialize and tools/list: read tokens get the read tools, write tokens all of them', async () => {
    assert.equal(writer.getServerVersion()?.name, 'one')
    assert.match(writer.getInstructions() ?? '', /MCP Works/)
    assert.match(reader.getInstructions() ?? '', /can only read/)
    const all = (await writer.listTools()).tools
    assert.deepEqual(all.map((t) => t.name).sort(), [...READ_TOOLS, ...WRITE_TOOLS].sort())
    assert.deepEqual((await reader.listTools()).tools.map((t) => t.name).sort(), READ_TOOLS)
    const query = all.find((t) => t.name === 'one_query_database')!
    assert.deepEqual(query.inputSchema.required, ['databaseId'])
    assert.equal(query.annotations?.readOnlyHint, true)
    assert.equal(all.find((t) => t.name === 'one_trash_page')!.annotations?.destructiveHint, true)
    // a read token can't call a write tool even when it knows the name
    await fails(reader, 'one_create_row', { databaseId: 'db-tasks', title: 'nope' }, /one_create_row/)
  })

  test('auth: bearer only — missing, unknown and cookie-only requests are 401; GET is 405; foreign origins 403', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '1' } } }
    const post = (headers: Record<string, string>) =>
      fetch(`${server.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init) })
    const anon = await post({})
    assert.equal(anon.status, 401)
    assert.match(anon.headers.get('www-authenticate') ?? '', /^Bearer/)
    assert.equal((await post({ authorization: `Bearer one_${'x'.repeat(43)}` })).status, 401)
    assert.equal((await post({ cookie: owner.cookieHeader() })).status, 401, 'the session cookie means nothing here')
    const ok = await post({ authorization: `Bearer ${writeToken}` })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type')?.split(';')[0], 'application/json')
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal(ok.headers.get('access-control-allow-origin'), null, 'no CORS')
    assert.equal(((await ok.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'one')
    assert.equal((await post({ authorization: `Bearer ${writeToken}`, origin: 'https://evil.example' })).status, 403)
    const get = await fetch(`${server.url}/mcp`, { headers: { authorization: `Bearer ${writeToken}`, accept: 'text/event-stream' } })
    assert.equal(get.status, 405)
    assert.equal(get.headers.get('allow'), 'POST')
    await assert.rejects(connect(server.url, `one_${'y'.repeat(43)}`))
  })

  test('one_overview: name, page tree, databases with row counts, today', async () => {
    const o = await call(reader, 'one_overview')
    assert.equal(o.workspace.name, 'MCP Works')
    assert.equal(o.access, 'read-only')
    assert.equal(o.today, new Date().toISOString().slice(0, 10))
    const handbook = o.pages.find((p: { id: string }) => p.id === 'doc-1')
    assert.equal(handbook.icon, '📘')
    assert.deepEqual(handbook.children.map((c: { title: string }) => c.title), ['Onboarding'])
    assert.ok(!JSON.stringify(o).includes('Old notes'), 'trashed pages are left out')
    assert.ok(!JSON.stringify(o).includes('Secret'), 'private pages are never there')
    const tasks = o.databases.find((d: { id: string }) => d.id === 'db-tasks')
    assert.equal(tasks.rows, 3)
    assert.equal((await call(writer, 'one_overview')).access, 'read-write')
    assert.deepEqual(o.people, [{ name: 'Olivia Owner', email: 'owner@mcp.test' }])
  })

  test('one_search: titles and content, snippets; trash and private pages stay out', async () => {
    const r = await call(reader, 'one_search', { query: 'handbook' })
    assert.equal(r.results[0].id, 'doc-1', 'a title match first')
    assert.ok(r.results.some((x: { id: string }) => x.id === 'doc-2'), 'content matches too')
    const onboarding = r.results.find((x: { id: string }) => x.id === 'doc-2')
    assert.equal(onboarding.path, 'Handbook / Onboarding')
    assert.match(onboarding.snippet, /Handbook/)
    assert.ok(!r.results.some((x: { id: string }) => x.id === 'old-1' || x.id === 'secret-1'))
    const rows = await call(reader, 'one_search', { query: 'review', limit: 1 })
    assert.deepEqual(rows.results.map((x: { id: string; kind: string }) => [x.id, x.kind]), [['row-2', 'row']])
    assert.equal((await call(reader, 'one_search', { query: 'classified' })).results.length, 0)
    // a row's property values count too
    assert.ok((await call(reader, 'one_search', { query: 'beta' })).results.some((x: { id: string }) => x.id === 'row-2'))
    await fails(reader, 'one_search', { query: '' }, /query/i)
  })

  test('one_get_page: Markdown content, path, children, backlinks; by title; 404s', async () => {
    const p = await call(reader, 'one_get_page', { id: 'doc-1' })
    assert.equal(p.kind, 'page')
    assert.equal(p.icon, '📘')
    assert.deepEqual(p.children, [{ id: 'doc-2', title: 'Onboarding', kind: 'page' }])
    const md = p.markdown as string
    assert.match(md, /^# How we work/)
    assert.match(md, /Read \*\*this\*\* and \[the site\]\(https:\/\/example\.com\)\./)
    assert.match(md, /- First\n- Second\n {2}- Nested/)
    assert.match(md, /- \[x\] Done thing\n- \[ \] Open thing/)
    assert.match(md, /\[Onboarding\]\(#\/p\/doc-2\)/)
    assert.match(md, /\[Database: Tasks\]\(#\/p\/db-tasks\)/)
    assert.match(md, /```ts\nconst x = 1\n```/)
    assert.ok(!md.includes('Secret plans'), 'a private page’s stored mention label never leaves')
    assert.match(md, /@\(No access\)/)

    const sub = await call(reader, 'one_get_page', { title: 'onboarding' })
    assert.equal(sub.id, 'doc-2')
    assert.equal(sub.path, 'Handbook / Onboarding')
    assert.deepEqual(sub.backlinks.map((b: { id: string }) => b.id), ['doc-1'])

    const row = await call(reader, 'one_get_page', { id: 'row-1' })
    assert.equal(row.kind, 'row')
    assert.equal(row.database.title, 'Tasks')
    assert.equal(row.properties.Status, 'In progress')
    assert.deepEqual(row.properties.Project, [{ id: 'proj-1', title: 'Apollo' }])
    assert.deepEqual((await call(reader, 'one_get_page', { id: 'db-tasks' })).rows, 3)

    await fails(reader, 'one_get_page', { id: 'nope' }, /No page with id "nope"/)
    await fails(reader, 'one_get_page', { id: 'secret-1' }, /No page with id/)
    await fails(reader, 'one_get_page', { id: 'old-1' }, /trash/)
    await fails(reader, 'one_get_page', { title: 'Hand' }, /Similar: "Handbook" \(doc-1\)/)
    await fails(reader, 'one_get_page', {}, /id/)
  })

  test('databases: list, schema with options and relations, views; another workspace is 404', async () => {
    const list = await call(reader, 'one_list_databases')
    assert.deepEqual(list.databases.map((d: { title: string }) => d.title), ['Archive', 'Projects', 'Tasks'])
    const db = await call(reader, 'one_get_database', { id: 'db-tasks' })
    assert.deepEqual(db.properties.find((p: { name: string }) => p.name === 'Status').options.map((o: { name: string }) => o.name), ['Not started', 'In progress', 'Done'])
    const rel = db.properties.find((p: { name: string }) => p.name === 'Project')
    assert.deepEqual([rel.relationDatabaseId, rel.relationDatabaseTitle], ['db-proj', 'Projects'])
    assert.deepEqual(db.views, [{ id: 'v-1', name: 'Board', type: 'board', groupBy: 'Status', sorts: [{ property: 'Estimate', direction: 'desc' }], filtered: false }])
    assert.equal(db.rows, 3)
    await fails(reader, 'one_get_database', { id: 'doc-1' }, /No database/)
    await fails(outsider, 'one_get_database', { id: 'db-tasks' }, /No database/)
    await fails(outsider, 'one_get_page', { id: 'doc-1' }, /No page/)
  })

  test('one_query_database: filters, sorts, cursors, friendly values', async () => {
    const ids = (r: { rows: Array<{ id: string }> }) => r.rows.map((x) => x.id)
    const all = await call(reader, 'one_query_database', { databaseId: 'db-tasks' })
    assert.deepEqual(ids(all), ['row-1', 'row-2', 'row-3'], 'the table order by default')
    assert.equal(all.total, 3)
    assert.deepEqual(all.rows[0].properties.Tags, ['Alpha'])
    assert.deepEqual(all.rows[0].properties.Due, { start: '2026-10-05', end: null })

    const q = (args: Record<string, unknown>) => call(reader, 'one_query_database', { databaseId: 'db-tasks', ...args })
    assert.deepEqual(ids(await q({ filter: [{ property: 'status', op: 'equals', value: 'in progress' }] })), ['row-1'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'status', op: 'not_equals', value: 'in progress' }] })), ['row-2', 'row-3'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Status', op: 'neq', value: 'Done' }, { property: 'Tags', op: 'contains', value: 'beta' }] })), ['row-2'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Due', op: 'after', value: '2026-10-31' }] })), ['row-2'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Estimate', op: 'gte', value: 3 }] })), ['row-1', 'row-2'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Done?', op: 'is_checked' }] })), ['row-3'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Due', op: 'is_empty' }] })), ['row-3'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'title', op: 'starts_with', value: 'ship' }] })), ['row-3'])
    assert.deepEqual(ids(await q({ filter: [{ property: 'Project', op: 'eq', value: 'Apollo' }] })), ['row-1'])
    assert.deepEqual(ids(await q({ sort: { property: 'Estimate', direction: 'desc' } })), ['row-2', 'row-1', 'row-3'])
    assert.deepEqual(ids(await q({ sort: [{ property: 'createdAt', direction: 'desc' }] })), ['row-3', 'row-2', 'row-1'])
    assert.deepEqual(ids(await q({ sort: '-Estimate' })), ['row-2', 'row-1', 'row-3'], 'the local bridge’s string form')
    assert.deepEqual(ids(await q({ sort: 'Due' })), ['row-1', 'row-2', 'row-3'], 'empty values last')
    assert.deepEqual(ids(await q({ sort: 'order' })), ['row-1', 'row-2', 'row-3'])

    const first = await q({ sort: { property: 'Name' }, limit: 2 })
    assert.deepEqual(ids(first), ['row-2', 'row-3'])
    assert.ok(first.next)
    const second = await q({ sort: { property: 'Name' }, limit: 2, cursor: first.next })
    assert.deepEqual(ids(second), ['row-1'])
    assert.equal(second.next, null)
    await fails(reader, 'one_query_database', { databaseId: 'db-tasks', limit: 2, cursor: first.next }, /cursor/)
    await fails(reader, 'one_query_database', { databaseId: 'db-tasks', filter: [{ property: 'Colour', op: 'eq', value: 'x' }] }, /Unknown property "Colour".*Status/)
    await fails(reader, 'one_query_database', { databaseId: 'db-tasks', filter: [{ property: 'Status', op: 'like', value: 'x' }] }, /op/)
    await fails(reader, 'one_query_database', { databaseId: 'nope' }, /No database/)
  })

  test('one_create_row: friendly values in, live at a connected client; 422 names the allowed values', async () => {
    const watcher = await doc(owner, `ws:${wsId}`)
    const created = await call(writer, 'one_create_row', {
      databaseId: 'db-tasks',
      title: 'Plan launch',
      properties: { Status: 'not started', Tags: ['Beta'], Due: '2026-12-01', Estimate: 5, Project: 'proj-1' },
      markdown: '## Steps\n\n- [ ] draft\n- [ ] review',
    })
    assert.match(created.url, new RegExp(`/app/\\?w=${wsId}#/p/${created.id}$`))
    await waitFor(() => !!watcher.doc.getMap('pages').get(created.id), 5000, 'row at the connected client')
    const yp = watcher.doc.getMap('pages').get(created.id) as Y.Map<unknown>
    assert.equal(yp.get('title'), 'Plan launch')
    assert.equal(yp.get('createdBy'), yp.get('updatedBy'))
    assert.match(String(yp.get('createdBy')), /^api:/)
    assert.deepEqual((yp.get('properties') as Y.Map<unknown>).toJSON(), { 'p-status': 'o-todo', 'p-tags': ['t-b'], 'p-due': { start: '2026-12-01', end: null }, 'p-est': 5, 'p-proj': ['proj-1'] })
    // the two-way partner got the row too
    await waitFor(() => ((watcher.doc.getMap('pages').get('proj-1') as Y.Map<unknown>).get('properties') as Y.Map<unknown>).toJSON()['p-proj.2way'].length === 2, 5000, 'partner')
    const back = await call(reader, 'one_get_page', { id: created.id })
    assert.match(back.markdown, /## Steps\n\n- \[ \] draft\n- \[ \] review/)

    // agent-friendly input: "title", new multi_select options, related rows by title
    const smart = await call(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'placeholder', properties: { title: 'Smart row', Tags: 'Gamma, alpha', Project: 'apollo' } })
    const got = await call(reader, 'one_get_page', { id: smart.id })
    assert.equal(got.title, 'Smart row')
    assert.deepEqual(got.properties.Tags, ['Gamma', 'Alpha'])
    assert.deepEqual(got.properties.Project, [{ id: 'proj-1', title: 'Apollo' }])
    const tags = (await call(reader, 'one_get_database', { id: 'db-tasks' })).properties.find((p: { name: string }) => p.name === 'Tags')
    assert.deepEqual(tags.options.map((o: { name: string }) => o.name), ['Alpha', 'Beta', 'Gamma'])
    // nothing is added for a row that can't be written
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'x', properties: { Tags: ['Delta'], Estimate: 'lots' } }, /Estimate: expected a number/)
    const after = (await call(reader, 'one_get_database', { id: 'db-tasks' })).properties.find((p: { name: string }) => p.name === 'Tags')
    assert.ok(!after.options.some((o: { name: string }) => o.name === 'Delta'))

    const msg = await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'x', properties: { Status: 'Blocked' } }, /Status: unknown option "Blocked"/)
    assert.match(msg, /allowed — Status: Not started, In progress, Done/)
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'x', properties: { Colour: 'red' } }, /Unknown property "Colour"/)
    await fails(writer, 'one_create_row', { databaseId: 'doc-1', title: 'x' }, /No such database/)
    await fails(outsider, 'one_create_row', { databaseId: 'db-tasks', title: 'x' }, /No such database/)
  })

  test('one_update_row: values by name, the title by its property name; 404 for pages that are not rows', async () => {
    const row = await call(writer, 'one_update_row', { id: 'row-2', properties: { Status: 'Done', 'Done?': true, Name: 'Review the copy', Tags: null } })
    assert.equal(row.title, 'Review the copy')
    assert.equal(row.properties.Status, 'Done')
    assert.deepEqual(row.properties.Tags, [])
    await waitFor(() => (meta.doc.getMap('pages').get('row-2') as Y.Map<unknown>).get('title') === 'Review the copy', 5000, 'live title')
    await fails(writer, 'one_update_row', { id: 'doc-1', properties: { Status: 'Done' } }, /No such row/)
    await fails(writer, 'one_update_row', { id: 'row-2', properties: { Estimate: 'lots' } }, /Estimate: expected a number/)
  })

  test('one_create_page and one_update_page: Markdown in, title, icon, append and replace', async () => {
    const created = await call(writer, 'one_create_page', { title: 'Release notes', parentId: 'doc-1', icon: '🚀', markdown: '# 1.0\n\nFirst **release**.' })
    const yp = () => meta.doc.getMap('pages').get(created.id) as Y.Map<unknown> | undefined
    await waitFor(() => !!yp(), 5000, 'page live')
    assert.deepEqual(yp()!.get('icon'), { type: 'emoji', value: '🚀' })
    assert.equal(yp()!.get('parentId'), 'doc-1')
    let page = await call(reader, 'one_get_page', { id: created.id })
    assert.equal(page.markdown, '# 1.0\n\nFirst **release**.')
    assert.equal(page.path, 'Handbook / Release notes')

    await call(writer, 'one_update_page', { id: created.id, markdown: '- fast\n- small' })
    page = await call(reader, 'one_get_page', { id: created.id })
    assert.equal(page.markdown, '# 1.0\n\nFirst **release**.\n\n- fast\n- small')
    await waitFor(() => String(yp()!.get('plain')).includes('small'), 5000, 'plain refreshed')

    await call(writer, 'one_update_page', { id: created.id, title: 'Changelog', icon: 'lucide:Rocket', markdown: 'Only this.', mode: 'replace' })
    page = await call(reader, 'one_get_page', { id: created.id })
    assert.equal(page.markdown, 'Only this.')
    assert.equal(page.title, 'Changelog')
    assert.equal(page.icon, 'lucide:Rocket')
    await call(writer, 'one_update_page', { id: created.id, icon: '' })
    assert.equal((await call(reader, 'one_get_page', { id: created.id })).icon, null)

    const top = await call(writer, 'one_create_page', { title: 'Loose page' })
    await waitFor(() => (meta.doc.getMap('pages').get(top.id) as Y.Map<unknown> | undefined)?.get('parentId') === null, 5000, 'top-level page')

    await fails(writer, 'one_create_page', { title: 'x', parentId: 'db-tasks' }, /one_create_row/)
    await fails(writer, 'one_create_page', { title: 'x', parentId: 'secret-1' }, /No such parent/)
    await fails(writer, 'one_update_page', { id: 'db-tasks', markdown: 'x' }, /database/)
    await fails(writer, 'one_update_page', { id: 'nope', title: 'x' }, /No page/)
    await fails(writer, 'one_update_page', { id: created.id, icon: 'not an icon at all' }, /icon/)
  })

  test('one_create_property: options, two-way relations, unique ids; duplicates and locked databases refused', async () => {
    const sel = await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Priority', type: 'select', options: ['High', { name: 'Low', color: 'gray' }] })
    assert.deepEqual(sel.property.options.map((o: { name: string; color: string }) => [o.name, o.color]), [['High', 'gray'], ['Low', 'gray']])
    await call(writer, 'one_update_row', { id: 'row-1', properties: { Priority: 'high' } })
    assert.equal((await call(reader, 'one_get_page', { id: 'row-1' })).properties.Priority, 'High')
    const ydb = () => meta.doc.getMap('databases').get('db-tasks') as Y.Map<unknown>
    await waitFor(() => ((ydb().get('views') as Y.Map<unknown>).get('v-1') as { visibleProperties: string[] }).visibleProperties.includes(sel.property.id), 5000, 'shown in views')

    const status = await call(writer, 'one_create_property', { databaseId: 'db-proj', name: 'Phase', type: 'status' })
    assert.deepEqual(status.property.options.map((o: { name: string }) => o.name), ['Not started', 'In progress', 'Done'])

    const rel = await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Reviewers', type: 'relation', relation: { databaseId: 'db-proj', twoWay: true, reverseName: 'Reviewed tasks' } })
    assert.equal(rel.reverse.property.id, `${rel.property.id}.2way`)
    await call(writer, 'one_update_row', { id: 'row-3', properties: { Reviewers: ['proj-1'] } })
    const apollo = await call(reader, 'one_query_database', { databaseId: 'db-proj' })
    assert.deepEqual(apollo.rows[0].properties['Reviewed tasks'], [{ id: 'row-3', title: 'Ship it' }])

    const key = await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Key', type: 'unique_id' })
    assert.equal(key.property.readOnly, true)
    const keys = (await call(reader, 'one_query_database', { databaseId: 'db-tasks', sort: { property: 'createdAt' } })).rows.map((r: { properties: Record<string, unknown> }) => r.properties.Key)
    assert.deepEqual(keys.slice(0, 3), [1, 2, 3])

    await fails(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'priority', type: 'text' }, /already has a property named/)
    await fails(writer, 'one_create_property', { databaseId: 'db-locked', name: 'Notes', type: 'text' }, /locked/)
    await fails(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Score', type: 'formula' }, /type/)
    await fails(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Link', type: 'relation' }, /relation\.databaseId/)
    await fails(writer, 'one_create_property', { databaseId: 'nope', name: 'x', type: 'text' }, /No database/)
  })

  test('one_create_database: schema and a table view; the defaults without properties', async () => {
    const made = await call(writer, 'one_create_database', {
      title: 'Leads',
      parentId: 'doc-1',
      properties: [{ name: 'Company', type: 'title' }, { name: 'Stage', type: 'status', options: ['New', 'Talking', 'Won'] }, { name: 'Owner', type: 'person' }, { name: 'Projects', type: 'relation', relation: { databaseId: 'db-proj', twoWay: true } }],
    })
    assert.deepEqual(made.properties.map((p: { name: string }) => p.name), ['Company', 'Stage', 'Owner', 'Projects'])
    assert.deepEqual(made.properties[1].options.map((o: { name: string; group: string }) => o.group), ['todo', 'in_progress', 'done'])
    assert.equal(made.reverse[0].property.name, 'Leads')
    const db = await call(reader, 'one_get_database', { id: made.id })
    assert.equal(db.path, 'Handbook / Leads')
    assert.deepEqual(db.views.map((v: { type: string }) => v.type), ['table'])
    const row = await call(writer, 'one_create_row', { databaseId: made.id, title: 'Analytical Engines', properties: { Stage: 'Talking', Owner: 'olivia owner' } })
    const got = await call(reader, 'one_get_page', { id: row.id })
    assert.equal(got.properties.Stage, 'Talking')
    assert.deepEqual(got.properties.Owner, [{ id: ownerId, name: 'Olivia Owner', email: 'owner@mcp.test' }])
    const dbPage = await call(reader, 'one_get_page', { id: made.id })
    assert.deepEqual(dbPage.schema.map((p: { name: string }) => p.name), ['Company', 'Stage', 'Owner', 'Projects'])
    const entry = meta.doc.getMap('pages').get(made.id) as Y.Map<unknown> | undefined
    await waitFor(() => !!meta.doc.getMap('pages').get(made.id), 5000, 'database live')
    assert.equal((entry ?? (meta.doc.getMap('pages').get(made.id) as Y.Map<unknown>)).get('kind'), 'database')

    const plain = await call(writer, 'one_create_database', { title: 'Inbox' })
    assert.deepEqual(plain.properties.map((p: { name: string; type: string }) => `${p.name}:${p.type}`), ['Name:title', 'Status:status', 'Tags:multi_select', 'Date:date'])
    await fails(writer, 'one_create_database', { title: 'x', parentId: 'db-tasks' }, /parent is a database/)
    await fails(writer, 'one_create_database', { title: 'x', properties: [{ name: 'A', type: 'title' }, { name: 'B', type: 'title' }] }, /one title property/)
    await fails(writer, 'one_create_database', { title: 'x', properties: [{ name: 'Rel', type: 'relation', relation: { databaseId: 'nope' } }] }, /no database with id "nope"/)
  })

  test('one_trash_page: a soft delete like the app’s (restorable); gone for every tool afterwards', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Temporary', markdown: 'bye' })
    const res = await call(writer, 'one_trash_page', { id: page.id })
    assert.equal(res.trashed, true)
    await waitFor(() => (meta.doc.getMap('pages').get(page.id) as Y.Map<unknown> | undefined)?.get('trashed') === true, 5000, 'trashed live')
    const yp = meta.doc.getMap('pages').get(page.id) as Y.Map<unknown>
    assert.equal(typeof yp.get('trashedAt'), 'number')
    await fails(reader, 'one_get_page', { id: page.id }, /trash/)
    await fails(writer, 'one_trash_page', { id: page.id }, /already in the trash/)
    assert.ok(!(await call(reader, 'one_search', { query: 'Temporary' })).results.length)
    // a row: out of the queries
    await call(writer, 'one_trash_page', { id: 'row-3' })
    assert.ok(!(await call(reader, 'one_query_database', { databaseId: 'db-tasks' })).rows.some((r: { id: string }) => r.id === 'row-3'))
    // the app restores it by clearing the flag
    meta.doc.transact(() => {
      ;(meta.doc.getMap('pages').get('row-3') as Y.Map<unknown>).set('trashed', false)
      ;(meta.doc.getMap('pages').get('row-3') as Y.Map<unknown>).set('trashedAt', null)
    })
    await flushed(meta)
    assert.equal((await call(reader, 'one_get_page', { id: 'row-3' })).title, 'Ship it')
  })

  test('the token’s last use is recorded and nothing secret reaches the log', async () => {
    const list = (await owner.get(`/api/workspaces/${wsId}/tokens`)).body as Array<{ name: string; last_used_at: string | null }>
    assert.ok(list.find((t) => t.name === 'Claude')?.last_used_at)
    assert.ok(!server.logs().includes(writeToken))
    assert.ok(!server.logs().includes('unhandled error'), server.logs())
    assert.ok(!server.logs().includes('mcp tool failed'), server.logs())
  })
})
