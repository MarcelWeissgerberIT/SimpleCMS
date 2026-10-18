/**
 * Review 6 on the team server — the bridge's rules where the server had its own (MCP plan § 3.2 / § 3.3 / § 4):
 *  - one_get_page by a title several pages carry names the others (alsoTitled), as the bridge;
 *  - one_create_row never makes a row without a title; titles, property names, option names and an upserted row's text
 *    keep the bridge's limits (MCP_LIMITS) on every create path; an icon is an emoji, never a word;
 *  - one_update_page: nothing to change / an empty append is refused, an equal title is no write, `changed` is answered;
 *  - one_move_row brings the row's record type along (its properties added there), a locked target refuses it, a gone
 *    type leaves a plain row;
 *  - a select bound to a shared list takes no option of its own (a row value, one_update_property options); a type
 *    change makes it a plain property;
 *  - a fault of the server's own never claims "not made".
 * Fictional data (Nordlicht, Tessera, Mara Lind, Wissensbasis).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'
import { McpWrites } from '../src/mcp/writes.ts'
// namespace imports: the file also runs against code without them (the old-code proof), failing on behaviour
import * as batchModule from '../src/mcp/batch.ts'
import { contentDoc, metaDoc, type WorkspaceModel } from '../src/api/model.ts'
import { roots } from '../src/api/meta.ts'
import { ApiError } from '../src/errors.ts'
import type { Services } from '../src/context.ts'
import type { Recorder } from '../src/mcp/preimages.ts'
import * as toolsModule from '../src/mcp/tools.ts'

const { McpBatch } = batchModule

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
  const client = new McpClient({ name: 'one-parity6', version: '1.0.0' })
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
  let res: ToolResult
  try {
    res = (await client.callTool({ name, arguments: args })) as ToolResult
  } catch (e) {
    assert.fail(`${name} answered with no tool result (a transport error): ${(e as Error).message}`)
  }
  assert.equal(res.isError, true, `${name} should be refused: ${res.content[0]?.text}`)
  return res.content[0]!.text
}

describe('review 6: the team server takes what the bridge takes, and words what it does not know', () => {
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let writer: McpClient
  const open: DocClient[] = []
  const pages = () => meta.doc.getMap('pages')
  const yp = (id: string) => pages().get(id) as Y.Map<unknown>
  const dbOf = (id: string) => meta.doc.getMap('databases').get(id) as Y.Map<unknown>
  const defs = (id: string) => [...(dbOf(id).get('properties') as Y.Map<unknown>).values()] as Def[]
  const rowsIn = (db: string) => [...pages().values()].filter((p) => (p as Y.Map<unknown>).get('databaseId') === db && (p as Y.Map<unknown>).get('trashed') !== true).length

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht-p6.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = openDoc(server, owner, `ws:${wsId}`)
    open.push(meta)
    await meta.synced
    const old = Date.now() - 60_000
    meta.doc.transact(() => {
      pages().set('wiki', pageEntry({ title: 'Wissensbasis', order: 1 }))
      pages().set('n1', pageEntry({ title: 'Notes', order: 2, updatedAt: old }))
      pages().set('n2', pageEntry({ title: 'Notes', order: 3 }))
      meta.doc.getMap('lists').set('list-stages', { id: 'list-stages', name: 'Stages', items: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], createdAt: 1, updatedAt: 1 })
      meta.doc.getMap('recordTypes').set('rt-lead', { id: 'rt-lead', name: 'Lead', properties: [{ id: 'rp-src', name: 'Source', type: 'text' }], createdAt: 1, updatedAt: 1 })
    })
    addDatabase(
      meta.doc,
      'db-cards',
      'Cards',
      [
        { id: 'c-title', name: 'Name', type: 'title' },
        { id: 'c-ticket', name: 'Ticket', type: 'text', key: true },
        { id: 'c-stage', name: 'Stage', type: 'select', options: [{ id: 'o-a', name: 'Alpha', color: 'blue' }, { id: 'o-b', name: 'Beta', color: 'green' }], listId: 'list-stages' },
        { id: 'c-src', name: 'Source', type: 'text', fromType: { id: 'rt-lead', prop: 'rp-src' } },
      ],
      { recordTypes: ['rt-lead'] },
    )
    addDatabase(meta.doc, 'db-arch', 'Archive', [{ id: 'a-title', name: 'Name', type: 'title' }, { id: 'a-ticket', name: 'Ticket', type: 'text' }])
    addDatabase(meta.doc, 'db-locked', 'Locked archive', [{ id: 'l-title', name: 'Name', type: 'title' }, { id: 'l-ticket', name: 'Ticket', type: 'text' }], { locked: true })
    meta.doc.transact(() => {
      pages().set('typed', pageEntry({ title: 'Typed card', parentId: 'db-cards', databaseId: 'db-cards', order: 1, recordType: 'rt-lead' }, { 'c-ticket': 'T-1' }))
      pages().set('typed-gone', pageEntry({ title: 'Card of a gone type', parentId: 'db-cards', databaseId: 'db-cards', order: 2, recordType: 'rt-gone' }, { 'c-ticket': 'T-2' }))
      pages().set('typed-locked', pageEntry({ title: 'Card for the locked archive', parentId: 'db-cards', databaseId: 'db-cards', order: 3, recordType: 'rt-lead' }, { 'c-ticket': 'T-3' }))
      pages().set('staged', pageEntry({ title: 'Staged card', parentId: 'db-cards', databaseId: 'db-cards', order: 4 }, { 'c-ticket': 'T-4', 'c-stage': 'o-a' }))
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

  test('one_get_page by a title two live pages carry: the newer one, the other named in alsoTitled', async () => {
    const page = await call(writer, 'one_get_page', { title: 'Notes' })
    assert.equal(page.id, 'n2')
    assert.deepEqual(page.alsoTitled?.map((x: { id: string }) => x.id), ['n1'])
  })

  test('one_create_row never makes a row without a title (properties only, an empty title) — nothing is made', async () => {
    const before = rowsIn('db-cards')
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-cards', properties: { Ticket: 'T-90' } }), /^bad_argument: title: a row needs a title/)
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-cards', title: '   ', properties: { Ticket: 'T-91' } }), /^bad_argument: title: a row needs a title/)
    assert.equal(rowsIn('db-cards'), before)
    // a title through the properties is a title
    const row = await call(writer, 'one_create_row', { databaseId: 'db-cards', properties: { Name: '  Kick-off   Nordlicht ', Ticket: 'T-92' } })
    await waitFor(() => !!yp(row.id), 5000, 'row')
    assert.equal(yp(row.id).get('title'), 'Kick-off Nordlicht')
  })

  test('the bridge\'s limits on every create path: titles ≤ 300 (whitespace collapsed), property names ≤ 100, option names cut to 60, an upserted row\'s text ≤ 100,000', async () => {
    const long = 'x'.repeat(500)
    const tooLong = /too long \(500 characters, at most 300\)/
    assert.match(await refusal(writer, 'one_create_page', { title: long }), tooLong)
    assert.match(await refusal(writer, 'one_create_page', { pages: [{ title: 'Fine' }, { title: long }] }), tooLong)
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-arch', title: long }), tooLong)
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-arch', rows: [{ title: long }] }), tooLong)
    assert.match(await refusal(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-L1', title: long }] }), tooLong)
    assert.match(await refusal(writer, 'one_create_database', { title: long }), tooLong)
    assert.match(await refusal(writer, 'one_update_database', { id: 'db-arch', title: long }), tooLong)
    assert.equal(rowsIn('db-arch'), 0)
    assert.match(await refusal(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'BIG-1', markdown: 'y'.repeat(150_000) }] }), /^bad_argument: rows\[0\]\.markdown/)
    assert.equal([...pages().values()].some((p) => ((p as Y.Map<unknown>).get('properties') as Y.Map<unknown>).get('c-ticket') === 'BIG-1'), false)
    assert.match(await refusal(writer, 'one_create_property', { databaseId: 'db-arch', name: 'p'.repeat(150), type: 'text' }), /^bad_argument: name/)
    const made = await call(writer, 'one_create_page', { title: '  Launch \n  plan  ' })
    assert.equal(made.title, 'Launch plan')
    const prop = await call(writer, 'one_create_property', { databaseId: 'db-arch', name: '  Phase  ', type: 'select', options: ['o'.repeat(80)] })
    assert.equal(prop.property.name, 'Phase')
    assert.equal(prop.property.options[0].name.length, 60)
  })

  test('an icon is an emoji, "asset:<name>" or "lucide:<Name>": a word is refused as on the bridge, on create and update', async () => {
    const words = /^bad_argument: .*"icon" must be an emoji .* got "rocket"/
    assert.match(await refusal(writer, 'one_create_page', { title: 'Icon probe', icon: 'rocket' }), words)
    assert.match(await refusal(writer, 'one_update_page', { id: 'wiki', icon: 'rocket' }), words)
    assert.match(await refusal(writer, 'one_update_database', { id: 'db-arch', icon: 'rocket' }), words)
    assert.equal([...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'Icon probe'), false)
    const ok = await call(writer, 'one_create_page', { title: 'Icon probe', icon: '🚀' })
    await waitFor(() => !!yp(ok.id), 5000, 'page')
    assert.deepEqual(yp(ok.id).get('icon'), { type: 'emoji', value: '🚀' })
  })

  test('one_update_page: nothing to change or an empty append is refused, an equal title is no write — `changed` says what changed', async () => {
    assert.match(await refusal(writer, 'one_update_page', { id: 'wiki' }), /^bad_argument: Nothing to change: pass "title", "icon" and\/or "markdown"/)
    assert.match(await refusal(writer, 'one_update_page', { id: 'wiki', markdown: '' }), /^bad_argument: markdown: "markdown" is empty: nothing to append/)
    const same = await call(writer, 'one_update_page', { id: 'wiki', title: 'Wissensbasis' })
    assert.deepEqual(same.changed, [])
    assert.equal(yp('wiki').get('updatedBy'), 'seed', 'no write stamped the page as edited by the token')
    const renamed = await call(writer, 'one_update_page', { id: 'wiki', title: 'Wissensbasis Nordlicht' })
    assert.deepEqual(renamed.changed, ['title'])
  })

  test('one_move_row brings the record type along (its properties added there), refuses a locked target, and a gone type leaves a plain row', async () => {
    const moved = await call(writer, 'one_move_row', { id: 'typed', databaseId: 'db-arch' })
    assert.equal(moved.recordType?.name, 'Lead')
    assert.deepEqual(moved.recordType?.addedProperties, ['Source'])
    await waitFor(() => yp('typed').get('databaseId') === 'db-arch', 5000, 'moved')
    assert.equal(yp('typed').get('recordType'), 'rt-lead')
    assert.deepEqual(dbOf('db-arch').get('recordTypes'), ['rt-lead'])
    assert.deepEqual(defs('db-arch').filter((d) => d.name === 'Source').map((d) => d.fromType), [{ id: 'rt-lead', prop: 'rp-src' }])
    // a locked target cannot take the type: nothing moves
    assert.match(await refusal(writer, 'one_move_row', { id: 'typed-locked', databaseId: 'db-locked' }), /^locked: databaseId: .*record type "Lead"/)
    assert.equal(yp('typed-locked').get('databaseId'), 'db-cards')
    // a type that is gone: a plain row there
    await call(writer, 'one_move_row', { id: 'typed-gone', databaseId: 'db-arch' })
    await waitFor(() => yp('typed-gone').get('databaseId') === 'db-arch', 5000, 'moved')
    assert.equal(yp('typed-gone').get('recordType'), undefined)
  })

  test('a select bound to a shared list takes no option of its own; a type change makes it a plain property', async () => {
    const before = rowsIn('db-cards')
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-cards', title: 'Lead 9', properties: { Ticket: 'T-99', Stage: 'Omega' } }), /shared list "Stages"/)
    assert.match(await refusal(writer, 'one_update_row', { id: 'staged', properties: { Stage: 'Gamma' } }), /shared list "Stages"/)
    assert.match(await refusal(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'Lead 10', properties: { Ticket: 'T-100', Stage: 'Omega' } }] }), /shared list "Stages"/)
    assert.match(await refusal(writer, 'one_update_property', { databaseId: 'db-cards', property: 'Stage', options: { add: ['Gamma'] } }), /^bad_argument: options: .*shared list "Stages"/)
    assert.equal(rowsIn('db-cards'), before)
    const stage = () => defs('db-cards').find((d) => d.id === 'c-stage')!
    assert.deepEqual((stage().options as Array<{ name: string }>).map((o) => o.name), ['Alpha', 'Beta'])
    // an option of the list is fine
    await call(writer, 'one_update_row', { id: 'staged', properties: { Stage: 'Beta' } })
    await call(writer, 'one_update_property', { databaseId: 'db-cards', property: 'Stage', type: 'multi_select' })
    await waitFor(() => stage().type === 'multi_select', 5000, 'type')
    assert.equal(stage().listId, undefined)
  })
})

describe('review 6: a fault of the server\'s own never claims the call was not made', () => {
  test('the answer to an unexpected error is coded and says the outcome is not known; a failed rollback too', async () => {
    const fault = (toolsModule as { MCP_FAULT?: string }).MCP_FAULT
    assert.equal(typeof fault, 'string', 'the server words its own fault in one place')
    assert.match(fault!, /^rejected: /)
    assert.doesNotMatch(fault!, /not made|[Nn]othing was changed|Try again in a moment/)
    assert.match(fault!, /not known/)
    const partly = (batchModule as { partly?: (e: unknown) => unknown }).partly
    assert.equal(typeof partly, 'function', 'a failed rollback is worded too')
    const p = partly!(new Error('disk full'))
    assert.ok(p instanceof ApiError)
    assert.match((p as ApiError).message, /^rejected: .*could not be taken back/)
  })

  test('one_create_page with linkInParent: the pages are made before the parent\'s text fails — so "not made" would be untrue', async () => {
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
    const err = await batch.createPages(ws, { title: 'Notizen', parentId: 'host', linkInParent: 'block' }, 'api:t1', rec).then(
      () => null,
      (e: unknown) => e,
    )
    assert.ok(err && !(err instanceof ApiError), 'a fault of its own (no ApiError)')
    const made = [...get(metaDoc(ws)).getMap('pages').values()].filter((p) => (p as Y.Map<unknown>).get('title') === 'Notizen')
    assert.equal(made.length, 1, 'the page was made before the fault')
  })
})
