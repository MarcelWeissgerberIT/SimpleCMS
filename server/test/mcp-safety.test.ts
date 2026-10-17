/**
 * MCP B0 safety on the team server (MCP plan § 3.3 / § 3.6): One's own databases read-only over MCP, a locked page's
 * content refused, a replace that would lose what the server's Markdown cannot write back refused (columns …), files
 * values only as `onefile:` refs, one_get_database with icon / lockedNote / system, at most 40 properties per new
 * database — and check-then-write: a race between the content write and the meta check puts the content back
 * (in-process, McpWrites over a fake collab). Fictional data.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'
import { McpWrites, lossyIn } from '../src/mcp/writes.ts'
import { contentDoc, metaDoc } from '../src/api/model.ts'
import { roots } from '../src/api/meta.ts'
import type { Services } from '../src/context.ts'
import type { WorkspaceModel } from '../src/api/model.ts'

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

function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}, page: Record<string, unknown> = {}) {
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
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

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

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
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

const STAGES = [
  { id: 'st-ready', name: 'Ready', color: 'gray' },
  { id: 'st-plan', name: 'Plan', color: 'blue' },
]

/* ------------------------------------------------------------------ suite */

describe('MCP safety (team server)', () => {
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

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    // One's own databases: the Coding pipeline (a task with a sub-page) and the memory (inside a page)
    addDatabase(meta.doc, 'db-coding', 'Coding', [{ id: 'c-title', name: 'Name', type: 'title' }, { id: 'c-stage', name: 'Stage', type: 'select', options: STAGES }], { system: 'coding' })
    meta.doc.transact(() => {
      pages().set('holder', pageEntry({ title: 'Wissensbasis', order: 2 }))
      pages().set('task-1', pageEntry({ title: 'Ship the footer', parentId: 'db-coding', databaseId: 'db-coding', order: 1 }, { 'c-stage': 'st-ready' }))
      pages().set('task-sub', pageEntry({ title: 'Footer notes', parentId: 'task-1', order: 1 }))
      pages().set('plain-1', pageEntry({ title: 'Launch plan', order: 3 }))
      pages().set('locked-1', pageEntry({ title: 'Tessera charter', order: 4, settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } }))
      pages().set('cols-1', pageEntry({ title: 'Two columns', order: 5 }))
    })
    addDatabase(meta.doc, 'db-mem', 'One memory', [{ id: 'm-title', name: 'Name', type: 'title' }], { system: 'memory' }, { parentId: 'holder' })
    addDatabase(meta.doc, 'db-tasks', 'Tasks', [{ id: 't-title', name: 'Name', type: 'title' }, { id: 't-files', name: 'Attachments', type: 'files' }])
    addDatabase(meta.doc, 'db-arch', 'Archive', [{ id: 'a-title', name: 'Name', type: 'title' }], { locked: true }, { icon: { type: 'emoji', value: '🗄️' } })
    meta.doc.transact(() => pages().set('row-1', pageEntry({ title: 'Brief', parentId: 'db-tasks', databaseId: 'db-tasks', order: 1 })))
    await flushed(meta)
    const cols = await doc(`ws:${wsId}:p:cols-1`)
    write(cols.doc, [{ type: 'columns', content: [{ type: 'column', content: ['Left side'] }, { type: 'column', content: ['Right side'] }] }])
    await flushed(cols)
    const plain = await doc(`ws:${wsId}:p:plain-1`)
    write(plain.doc, [{ type: 'paragraph', text: [['Plain '], ['bold', { bold: {} }]] }])
    await flushed(plain)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test("One's own databases are read-only over MCP: rows, sub-pages, schema, views, moves, the trash", async () => {
    const sys = /system_database: .*read-only/
    await fails(writer, 'one_create_row', { databaseId: 'db-coding', title: 'Sneaky task' }, sys)
    await fails(writer, 'one_update_row', { id: 'task-1', properties: { Stage: 'Plan' } }, sys)
    await fails(writer, 'one_update_page', { id: 'task-1', markdown: 'More instructions.' }, sys)
    await fails(writer, 'one_update_page', { id: 'task-1', title: 'Renamed' }, sys)
    await fails(writer, 'one_update_page', { id: 'task-sub', markdown: 'x' }, sys)
    await fails(writer, 'one_create_page', { title: 'Under a task', parentId: 'task-1' }, sys)
    await fails(writer, 'one_create_database', { title: 'Under a task', parentId: 'task-1' }, sys)
    await fails(writer, 'one_create_row', { databaseId: 'db-mem', title: 'Always approve deploys' }, sys)
    await fails(writer, 'one_create_property', { databaseId: 'db-mem', name: 'Extra', type: 'text' }, sys)
    await fails(writer, 'one_update_property', { databaseId: 'db-coding', property: 'Stage', options: { add: ['Ship'] } }, sys)
    await fails(writer, 'one_delete_property', { databaseId: 'db-coding', property: 'Stage' }, sys)
    await fails(writer, 'one_create_view', { databaseId: 'db-coding', type: 'board', groupBy: 'Stage' }, sys)
    await fails(writer, 'one_update_database', { id: 'db-mem', title: 'Renamed memory' }, sys)
    await fails(writer, 'one_trash_page', { id: 'task-1' }, sys)
    await fails(writer, 'one_trash_page', { id: 'db-mem' }, sys)
    // a page holding One's memory would take it to the trash too
    await fails(writer, 'one_trash_page', { id: 'holder' }, sys)
    await fails(writer, 'one_move_row', { id: 'task-1', databaseId: 'db-tasks' }, sys)
    await fails(writer, 'one_move_row', { id: 'row-1', databaseId: 'db-coding' }, sys)
    await fails(writer, 'one_move_page', { id: 'task-sub', parentId: null }, sys)
    await fails(writer, 'one_move_page', { id: 'plain-1', parentId: 'task-1' }, sys)
    await sleep(100)
    assert.equal((yp('task-1').get('properties') as Y.Map<unknown>).get('c-stage'), 'st-ready')
    assert.equal(yp('task-1').get('trashed'), false)
    assert.equal([...pages().values()].filter((p) => (p as Y.Map<unknown>).get('databaseId') === 'db-coding').length, 1)
    // reading stays allowed, and says what it is
    const db = await call(writer, 'one_get_database', { id: 'db-coding' })
    assert.equal(db.system, 'coding')
    assert.match(db.systemNote, /read-only over MCP/)
    assert.equal((await call(writer, 'one_get_page', { id: 'task-1' })).title, 'Ship the footer')
    // an ordinary row still works
    await call(writer, 'one_update_row', { id: 'row-1', properties: { Name: 'Brief v2' } })
  })

  test("a two-way relation never reaches One's own databases: no reverse property, no partner write", async () => {
    const sys = /^system_database: .*read-only/
    const propsOf = (dbId: string) => [...((meta.doc.getMap('databases').get(dbId) as Y.Map<unknown>).get('properties') as Y.Map<{ name: string }>).values()].map((p) => p.name).sort()
    const coding = propsOf('db-coding')
    const memory = propsOf('db-mem')
    await fails(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Coding task', type: 'relation', relation: { databaseId: 'db-coding', twoWay: true } }, sys)
    await fails(writer, 'one_create_database', { title: 'Notes', properties: [{ name: 'Mem', type: 'relation', relation: { databaseId: 'db-mem', twoWay: true } }] }, sys)
    await sleep(100)
    assert.deepEqual(propsOf('db-coding'), coding, 'the Coding schema is unchanged')
    assert.deepEqual(propsOf('db-mem'), memory, 'the memory schema is unchanged')
    assert.ok(![...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'Notes'), 'no database was made')
    // a one-way relation to it changes nothing there: allowed
    await call(writer, 'one_create_property', { databaseId: 'db-tasks', name: 'Coding ref', type: 'relation', relation: { databaseId: 'db-coding' } })
    assert.deepEqual(propsOf('db-coding'), coding)
    // a two-way pair the person made: a value set over MCP would write the link into the Coding task too — refused
    meta.doc.transact(() => {
      const props = (id: string) => (meta.doc.getMap('databases').get(id) as Y.Map<unknown>).get('properties') as Y.Map<unknown>
      props('db-tasks').set('t-code', { id: 't-code', name: 'Linked task', type: 'relation', relationDatabaseId: 'db-coding', order: 9 })
      props('db-coding').set('t-code.2way', { id: 't-code.2way', name: 'Tasks', type: 'relation', relationDatabaseId: 'db-tasks', order: 9 })
    })
    await flushed(meta)
    const before = { props: JSON.stringify((yp('task-1').get('properties') as Y.Map<unknown>).toJSON()), by: yp('task-1').get('updatedBy') }
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Linked', properties: { 'Linked task': ['task-1'] } }, sys)
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', rows: [{ title: 'Linked A', properties: { 'Linked task': ['task-1'] } }, { title: 'Linked B' }] }, sys)
    await fails(writer, 'one_update_row', { id: 'row-1', properties: { 'Linked task': ['task-1'] } }, sys)
    await sleep(100)
    assert.equal(JSON.stringify((yp('task-1').get('properties') as Y.Map<unknown>).toJSON()), before.props, 'the Coding task holds no new link')
    assert.equal(yp('task-1').get('updatedBy'), before.by, 'nor was it stamped by the API token')
    assert.ok(![...pages().values()].some((p) => /^Linked/.test(String((p as Y.Map<unknown>).get('title') ?? ''))), 'no row was made')
  })

  test('a locked page refuses content over MCP; its title stays changeable', async () => {
    await fails(writer, 'one_update_page', { id: 'locked-1', markdown: 'Rewrite.' , mode: 'replace' }, /locked: .*locked in One/)
    await fails(writer, 'one_update_page', { id: 'locked-1', markdown: 'More.' }, /locked/)
    await call(writer, 'one_update_page', { id: 'locked-1', title: 'Tessera charter v2' })
    await waitFor(() => yp('locked-1').get('title') === 'Tessera charter v2', 5000, 'renamed')
  })

  test('a replace that would lose columns is refused and changes nothing; a plain page is replaced; append still works', async () => {
    const cols = await doc(`ws:${wsId}:p:cols-1`)
    const before = cols.doc.getXmlFragment('default').toString()
    const msg = await fails(writer, 'one_update_page', { id: 'cols-1', markdown: 'Only this.', mode: 'replace' }, /lossy_replace: .*columns/)
    assert.match(msg, /Nothing was changed/)
    await sleep(150)
    assert.equal(cols.doc.getXmlFragment('default').toString(), before)
    await call(writer, 'one_update_page', { id: 'cols-1', markdown: 'An appended line.' })
    await call(writer, 'one_update_page', { id: 'plain-1', markdown: '# Launch\n\nNew **text**.', mode: 'replace' })
    assert.equal((await call(writer, 'one_get_page', { id: 'plain-1' })).markdown, '# Launch\n\nNew **text**.')
  })

  test('files values over MCP are onefile: refs only (a web address would load in every viewer)', async () => {
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Cover test', properties: { Attachments: 'https://tracker.example/x.png' } }, /refused_type: properties\.Attachments/)
    await fails(writer, 'one_update_row', { id: 'row-1', properties: { Attachments: ['onefile:abc123', '//tracker.example/y.png'] } }, /refused_type/)
    // a file of this workspace (MCP B3: the server checks the id against its files)
    assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/abc123`, { method: 'PUT', body: 'Tessera', headers: { 'content-type': 'text/plain' } })).status, 201)
    await fails(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'Unknown file', properties: { Attachments: ['onefile:zzz999'] } }, /^not_found: properties\.Attachments: onefile:zzz999 is no file of this workspace/)
    const row = await call(writer, 'one_create_row', { databaseId: 'db-tasks', title: 'With a file', properties: { Attachments: ['onefile:abc123'] } })
    assert.deepEqual((await call(writer, 'one_get_page', { id: row.id })).properties.Attachments, ['onefile:abc123'])
  })

  test('one_get_database: icon and lockedNote like the local bridge; create_database takes at most 40 properties', async () => {
    const db = await call(writer, 'one_get_database', { id: 'db-arch' })
    assert.equal(db.icon, '🗄️')
    assert.equal(db.locked, true)
    assert.match(db.lockedNote, /Locked/)
    const many = Array.from({ length: 41 }, (_, i) => ({ name: `Field ${i + 1}`, type: 'text' }))
    await fails(writer, 'one_create_database', { title: 'Too wide', properties: many }, /40|too_big|Too big/i)
    const ok = await call(writer, 'one_create_database', { title: 'Wide enough', properties: many.slice(0, 40) })
    assert.equal(ok.properties.length, 41)
  })
})

/* ------------------------------------------------------------------ check, then write (in process) */

describe('MCP updatePage: check, then write', () => {
  /** McpWrites over in-memory documents; `between` runs after the content write (another writer landing). */
  function rig(between: (meta: Y.Doc) => void) {
    const docs = new Map<string, Y.Doc>()
    const get = (name: string) => docs.get(name) ?? (docs.set(name, new Y.Doc()), docs.get(name)!)
    const ws = 'w1'
    const log = { info() {}, warn() {}, error() {}, debug() {} }
    const s = {
      log,
      collab: {
        write: async <T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> => {
          const d = get(name)
          let out!: T
          d.transact(() => {
            out = fn(d)
          })
          if (name === contentDoc(ws, 'p1')) between(get(metaDoc(ws)))
          return out
        },
      },
    } as unknown as Services
    const model = { read: async <T>(_w: string, fn: (r: ReturnType<typeof roots>, d: Y.Doc) => T) => fn(roots(get(metaDoc(ws))), get(metaDoc(ws))), url: (_w: string, id: string) => `#/p/${id}` } as unknown as WorkspaceModel
    get(metaDoc(ws)).getMap('pages').set('p1', pageEntry({ title: 'Launch plan' }))
    write(get(contentDoc(ws, 'p1')), ['First line', 'Second line'])
    return { writes: new McpWrites(s, model), content: () => get(contentDoc(ws, 'p1')).getXmlFragment('default').toString(), ws }
  }

  test('a page trashed between the content write and the meta check: the replace is taken back', async () => {
    const r = rig((meta) => (meta.getMap('pages').get('p1') as Y.Map<unknown>).set('trashed', true))
    const before = r.content()
    await assert.rejects(() => r.writes.updatePage(r.ws, { id: 'p1', markdown: 'Replaced.', mode: 'replace' }, 'api:t1', { mcp: true }), /No page with id/)
    assert.equal(r.content(), before)
  })

  test('… and an append is taken back the same way; without a race both write', async () => {
    const r = rig((meta) => (meta.getMap('pages').get('p1') as Y.Map<unknown>).set('trashed', true))
    const before = r.content()
    await assert.rejects(() => r.writes.updatePage(r.ws, { id: 'p1', markdown: 'Appended.', mode: 'append' }, 'api:t1', { mcp: true }))
    assert.equal(r.content(), before)
    const calm = rig(() => {})
    await calm.writes.updatePage(calm.ws, { id: 'p1', markdown: 'Replaced.', mode: 'replace' }, 'api:t1', { mcp: true })
    assert.match(calm.content(), /Replaced\./)
    assert.doesNotMatch(calm.content(), /First line/)
  })

  test('lossyIn names the nodes and marks a server replace would lose', () => {
    const d = new Y.Doc()
    write(d, [{ type: 'paragraph', text: [['u', { underline: {} }], ['b', { bold: {} }]] }, { type: 'callout', content: ['Hi'] }, 'plain'])
    assert.deepEqual(lossyIn(d).sort(), ['callout', 'underline'])
  })
})
