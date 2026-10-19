/**
 * Review 5 on the team server — the bridge's rules where the server had its own (MCP plan § 3.2 / § 3.6 / § 4):
 *  - Restore refuses (all or nothing) when a made page / row was MOVED since (its place is part of "changed since", as on
 *    the bridge);
 *  - one_upsert_rows checks a locked row page before anything is written, and reads "empty" from the content (a picture
 *    or a divider is no empty page);
 *  - every row of a batch that does not fit is named in ONE refusal (create_row / update_row / create_database rows);
 *  - titles: whitespace collapsed, never empty (one_update_page, a row's title through properties);
 *  - one_create_database under a database says "a database goes under a page"; a replace of a page holding a task is
 *    `lossy_replace`; a write token's request may carry 512 KB, and a bigger tool call is answered `too_large`.
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

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-parity5', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

/** A tool's refusal: its text (a transport error — no tool result at all — counts as a failed expectation). */
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

describe('review 5: the team server words and checks as the bridge does', () => {
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
  const calls = async () => (await owner.get(`/api/workspaces/${wsId}/mcp-calls`)).body as Array<{ callId: string; tool: string; titles: string[] }>
  const restore = (callId: string) => owner.post(`/api/workspaces/${wsId}/mcp-calls/${callId}/restore`, {})

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'mara@nordlicht-p5.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    meta = await doc(`ws:${wsId}`)
    meta.doc.transact(() => {
      pages().set('wiki', pageEntry({ title: 'Wissensbasis', order: 1 }))
      pages().set('important', pageEntry({ title: 'Important', order: 2 }))
    })
    addDatabase(meta.doc, 'db-cards', 'Cards', [
      { id: 'c-title', name: 'Name', type: 'title' },
      { id: 'c-ticket', name: 'Ticket', type: 'text', key: true },
      { id: 'c-owner', name: 'Owner', type: 'text' },
      { id: 'c-points', name: 'Points', type: 'number' },
    ])
    addDatabase(meta.doc, 'db-archive', 'Archive', [
      { id: 'a-title', name: 'Name', type: 'title' },
      { id: 'a-ticket', name: 'Ticket', type: 'text' },
    ])
    meta.doc.transact(() => {
      pages().set('card-l', pageEntry({ title: 'Locked card', parentId: 'db-cards', databaseId: 'db-cards', order: 1, settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } }, { 'c-ticket': 'T-L', 'c-owner': 'Tessera' }))
      pages().set('card-i', pageEntry({ title: 'Card with a picture', parentId: 'db-cards', databaseId: 'db-cards', order: 2 }, { 'c-ticket': 'T-I' }))
      pages().set('card-r', pageEntry({ title: 'Card to rename', parentId: 'db-cards', databaseId: 'db-cards', order: 3 }, { 'c-ticket': 'T-R' }))
    })
    await flushed(meta)
    // a row page holding only a picture and a divider: no text, but not empty
    const picture = await doc(`ws:${wsId}:p:card-i`)
    picture.doc.transact(() => {
      const img = new Y.XmlElement('image')
      img.setAttribute('id', 'blk-img-0001')
      img.setAttribute('src', 'onefile:abc123')
      img.setAttribute('alt', 'Whiteboard photo')
      const hr = new Y.XmlElement('horizontalRule')
      hr.setAttribute('id', 'blk-hr-0001')
      picture.doc.getXmlFragment('default').insert(0, [img, hr])
    })
    await flushed(picture)
    const token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    writer = await connect(server.url, token)
  })

  after(async () => {
    await writer?.close().catch(() => {})
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('Restore is refused for a made page a member MOVED since, and a made row a member moved into another database (named)', async () => {
    const page = await call(writer, 'one_create_page', { title: 'Meeting notes', parentId: 'wiki' })
    const rows = await call(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'Moved card', properties: { Ticket: 'T-M' } }] })
    const row = rows.rows[0].id as string
    await waitFor(() => !!yp(page.id) && !!yp(row), 5000, 'made')
    // a member moves the page under "Important", and the row into the archive (no value changed)
    meta.doc.transact(() => {
      yp(page.id).set('parentId', 'important')
      yp(row).set('parentId', 'db-archive')
      yp(row).set('databaseId', 'db-archive')
    })
    await flushed(meta)
    for (const [id, title, tool] of [
      [page.id, 'Meeting notes', 'one_create_page'],
      [row, 'Moved card', 'one_create_row'],
    ] as const) {
      const c = (await calls()).find((x) => x.tool === tool && x.titles.includes(title))!
      const res = await restore(c.callId)
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.deepEqual(res.body.error.details.changed.map((k: { id: string; what: string[] }) => [k.id, k.what]), [[id, ['place']]], `${title} is named`)
      await sleep(150)
      assert.notEqual(yp(id).get('trashed'), true, `${title} stays where the member put it`)
    }
  })

  test('one_upsert_rows: a body into a locked row page is refused BEFORE anything is written — no new row, no value touched', async () => {
    const before = { owner: props('card-l').get('c-owner'), updatedBy: yp('card-l').get('updatedBy'), count: pages().size }
    const text = await refusal(writer, 'one_upsert_rows', {
      databaseId: 'db-cards',
      keyProperty: 'Ticket',
      rows: [
        { key: 'NEW-1', title: 'New one' },
        { key: 'T-L', properties: { Owner: 'Mara' }, markdown: 'Notes for the locked card' },
      ],
    })
    await sleep(300)
    // nothing was written — not a row made and put into the trash, not a value written and put back
    assert.equal(pages().size, before.count, 'no row was made (not even one in the trash)')
    assert.equal([...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'New one'), false)
    assert.equal(props('card-l').get('c-owner'), before.owner)
    assert.equal(yp('card-l').get('updatedBy'), before.updatedBy, 'the locked row was never written (nor put back)')
    assert.match(text, /^locked: rows\[1\]\.markdown: "Locked card" is locked in One: its content cannot change/)
  })

  test('one_upsert_rows: a row page holding only a picture and a divider is not empty — its markdown is kept out (body "kept")', async () => {
    const out = await call(writer, 'one_upsert_rows', { databaseId: 'db-cards', keyProperty: 'Ticket', rows: [{ key: 'T-I', markdown: 'Mirrored notes from the ticket system' }] })
    assert.equal(out.rows[0].action, 'unchanged', JSON.stringify(out))
    const content = await doc(`ws:${wsId}:p:card-i`)
    await sleep(200)
    assert.doesNotMatch(content.doc.getXmlFragment('default').toString(), /Mirrored notes/)
  })

  test('a batch names EVERY row that does not fit in one refusal: create_row, update_row and create_database rows', async () => {
    const created = await refusal(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'A', properties: { Points: 'abc' } }, { title: 'B' }, { title: 'C', properties: { Points: 'xyz' } }] })
    assert.match(created, /^bad_argument: rows: 2 of 3 rows do not fit:\n- rows\[0\] \("A"\): .*\n- rows\[2\] \("C"\): .*\nNothing was changed\./)
    const made = await call(writer, 'one_create_row', { databaseId: 'db-cards', rows: [{ title: 'R1' }, { title: 'R2' }] })
    const updated = await refusal(writer, 'one_update_row', { rows: [{ id: made.rows[0].id, properties: { Points: 'abc' } }, { id: made.rows[1].id, properties: { Points: 'xyz' } }] })
    assert.match(updated, /^bad_argument: rows: 2 of 2 rows do not fit:\n- rows\[0\] \("R1"\): .*\n- rows\[1\] \("R2"\): /)
    const board = await refusal(writer, 'one_create_database', { title: 'Board2', properties: [{ name: 'Points', type: 'number' }], rows: [{ title: 'A', properties: { Points: 'abc' } }, { title: 'C', properties: { Points: 'xyz' } }] })
    assert.match(board, /^bad_argument: rows: 2 of 2 rows do not fit:\n- rows\[0\] \("A"\): .*\n- rows\[1\] \("C"\): /)
    assert.equal([...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'Board2'), false)
  })

  test('titles as the bridge takes them: never empty, whitespace collapsed (one_update_page and a row title through properties)', async () => {
    const pg = await call(writer, 'one_create_page', { title: 'Plain page', markdown: 'Hello' })
    assert.match(await refusal(writer, 'one_update_page', { id: pg.id, title: '' }), /^bad_argument: title: "title" must not be empty\. Nothing was changed\./)
    assert.match(await refusal(writer, 'one_update_page', { id: pg.id, title: '   ' }), /^bad_argument: title: "title" must not be empty/)
    await call(writer, 'one_update_page', { id: pg.id, title: '  Two\nlines  ' })
    await waitFor(() => yp(pg.id)?.get('title') === 'Two lines', 5000, 'collapsed title')
    assert.match(await refusal(writer, 'one_update_row', { id: 'card-r', properties: { title: '' } }), /^bad_argument: properties\.title: the title must not be empty/)
    assert.match(await refusal(writer, 'one_update_row', { id: 'card-r', properties: { Name: ' ' } }), /^bad_argument: properties\.Name: the title must not be empty/)
    assert.equal(yp('card-r').get('title'), 'Card to rename')
    await call(writer, 'one_update_row', { id: 'card-r', properties: { title: ' Renamed \n card ' } })
    await waitFor(() => yp('card-r').get('title') === 'Renamed card', 5000, 'collapsed row title')
  })

  test('one_create_database under a database: "a database goes under a page" — never "add a row with one_create_row"', async () => {
    const text = await refusal(writer, 'one_create_database', { title: 'Nested', parentId: 'db-cards' })
    assert.match(text, /^bad_argument: parentId: "Cards" is a database; a database goes under a page\./)
    assert.doesNotMatch(text, /one_create_row/)
  })

  test('a replace of a page holding a task is lossy_replace (a contract code), never bad_argument with "check the arguments"', async () => {
    const pg = await call(writer, 'one_create_page', { title: 'Launch plan', markdown: 'Intro line.' })
    const content = await doc(`ws:${wsId}:p:${pg.id}`)
    content.doc.transact(() => {
      const item = new Y.XmlElement('workItem')
      item.setAttribute('itemId', 'wi_7f3a9c2d01')
      item.setAttribute('status', 'todo')
      const p = new Y.XmlElement('paragraph')
      const t = new Y.XmlText()
      t.insert(0, 'Ship the pricing page')
      p.insert(0, [t])
      item.insert(0, [p])
      content.doc.getXmlFragment('default').insert(0, [item])
    })
    await flushed(content)
    const text = await refusal(writer, 'one_update_page', { id: pg.id, markdown: 'Only this.', mode: 'replace' })
    assert.match(text, /^lossy_replace: "Launch plan" holds tasks; a replace over the team server would turn them into plain text\. Nothing was changed\. Append instead/)
    assert.doesNotMatch(text, /Check the tool's arguments/)
  })

  test('a write token carries 512 KB per request; a bigger tool call is the contract refusal too_large (not a transport error)', async () => {
    const big = 'x'.repeat(6000)
    // 300,000 characters in 50 pages: within the shared description's 600,000, over the old 256 KB transport limit
    const made = await call(writer, 'one_create_page', { pages: Array.from({ length: 50 }, (_, i) => ({ title: `P${i}`, markdown: big })) })
    assert.equal(made.pages.length, 50)
    const huge = 'y'.repeat(12_000)
    const text = await refusal(writer, 'one_create_page', { pages: Array.from({ length: 50 }, (_, i) => ({ title: `Q${i}`, markdown: huge })) })
    assert.match(text, /^too_large: The request is [\d,]+ KB \(at most 512 KB per request on this team server\)\. Nothing was changed\. Split it into smaller calls\./)
    assert.equal([...pages().values()].some((p) => (p as Y.Map<unknown>).get('title') === 'Q0'), false)
  })
})
