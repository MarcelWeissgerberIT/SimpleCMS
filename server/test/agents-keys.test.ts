/**
 * Row keys and "Only by hand" on the team server (api/keys.ts) against a real server and a fake Messages API
 * (fake-anthropic.ts — never the real one): the public API refuses a duplicate key (409 duplicate_key) and may write
 * a protected field, MCP clients may not write it and see the marks, server agents' list_databases marks both,
 * upsert_rows created / updated / unchanged / refused in write modes "stage" and "apply", create_row with a taken
 * key and update_row on a protected field are refused, and applying a staged row whose key was taken since fails.
 * upsert_rows is offered because an integration profile of the workspace matches the runtime's MCP server by name
 * (integrations.test.ts covers the gate itself).
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { type FakeAnthropic, type FakeRequest, fakeAnthropic, say, toolResults, tools } from './fake-anthropic.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

const KEY = 'sk-ant-api03-TESTKEY-not-real-0123456789abcdefKEYS'

function pageEntry(fields: Record<string, unknown>, properties: Record<string, unknown> = {}): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', createdBy: 'seed', updatedBy: 'seed', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(properties)) props.set(k, v)
  yp.set('properties', props)
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

const STATUS = [
  { id: 'o-open', name: 'Open', color: 'gray' },
  { id: 'o-ready', name: 'Ready', color: 'green' },
  { id: 'o-done', name: 'Done', color: 'blue' },
]
const TICKETS = [
  { id: 'k-title', name: 'Name', type: 'title' },
  { id: 'k-ticket', name: 'Ticket', type: 'text', key: true },
  { id: 'k-status', name: 'Status', type: 'select', options: STATUS },
  { id: 'k-notes', name: 'Notes', type: 'text', agentReadOnly: true },
]

function agentDef(id: string, name: string, extra: Record<string, unknown>) {
  const at = Date.now()
  return { id, name, instructions: `Mirror the tracker into Tickets (${name}).`, trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'server', model: null, effort: null, maxRunUsd: 1, enabled: true, createdBy: null, createdAt: at, updatedAt: at, ...extra }
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

describe('row keys and "Only by hand" on the server', () => {
  let fake: FakeAnthropic
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient
  let token: string
  let mcp: McpClient
  const open: DocClient[] = []

  const pages = () => meta.doc.getMap('pages')
  const prop = (row: string, id: string) => ((pages().get(row) as Y.Map<any> | undefined)?.get('properties') as Y.Map<unknown> | undefined)?.get(id)
  const rowsWith = (ticket: string) => [...pages().entries()].filter(([, p]) => (p as Y.Map<any>).get('databaseId') === 'db-tk' && (p as Y.Map<any>).get('trashed') !== true && ((p as Y.Map<any>).get('properties') as Y.Map<unknown>).get('k-ticket') === ticket)
  const api = async (method: string, path: string, json?: unknown) => {
    const res = await fetch(server.url + path, { method, headers: { authorization: `Bearer ${token}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}) }, body: json === undefined ? undefined : JSON.stringify(json) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  const runs = async (agentId: string) => (await owner.get(`/api/workspaces/${wsId}/agent-runs?agentId=${agentId}&limit=50`)).body as any[]
  async function runAgent(agentId: string): Promise<any> {
    const started = await owner.post(`/api/workspaces/${wsId}/agents/${agentId}/run`)
    assert.equal(started.status, 202, JSON.stringify(started.body))
    let run: any
    await waitFor(async () => {
      run = (await runs(agentId)).find((r) => r.id === started.body.runId)
      return !!run && run.status !== 'running'
    }, 20_000, `run of ${agentId}`)
    return run
  }

  before(async () => {
    fake = await fakeAnthropic()
    server = await startServer({ ANTHROPIC_BASE_URL: fake.url, AGENT_TICK_MS: '300', API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'owner@keys.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Keys Co' })).body.id
    const d = openDoc(server, owner, `ws:${wsId}`)
    open.push(d)
    await d.synced
    meta = d
    meta.doc.transact(() => {
      pages().set('db-tk', pageEntry({ kind: 'database', title: 'Tickets', order: 1 }))
      const ydb = new Y.Map<unknown>()
      const pm = new Y.Map<unknown>()
      TICKETS.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
      ydb.set('properties', pm)
      ydb.set('views', new Y.Map<unknown>())
      ydb.set('nextUniqueId', 1)
      meta.doc.getMap('databases').set('db-tk', ydb)
      pages().set('tk-a', pageEntry({ title: 'Login fails', parentId: 'db-tk', databaseId: 'db-tk', order: 1 }, { 'k-ticket': '8215', 'k-status': 'o-open' }))
      pages().set('tk-b', pageEntry({ title: 'Export broken', parentId: 'db-tk', databaseId: 'db-tk', order: 2 }, { 'k-ticket': '8216', 'k-status': 'o-ready' }))
      pages().set('tk-c', pageEntry({ title: 'Slow search', parentId: 'db-tk', databaseId: 'db-tk', order: 3, plain: 'Seen on phones' }, { 'k-ticket': '8217', 'k-status': 'o-open', 'k-notes': 'Call back Mira first' }))
      // an older list with the same fields: its rows can move over only with a free key and no protected value
      pages().set('db-old', pageEntry({ kind: 'database', title: 'Old tickets', order: 2 }))
      const old = new Y.Map<unknown>()
      const om = new Y.Map<unknown>()
      ;[
        { id: 'x-title', name: 'Name', type: 'title' },
        { id: 'x-ticket', name: 'Ticket', type: 'text' },
        { id: 'x-notes', name: 'Notes', type: 'text' },
      ].forEach((p, i) => om.set(p.id, { ...p, order: i }))
      old.set('properties', om)
      old.set('views', new Y.Map<unknown>())
      old.set('nextUniqueId', 1)
      meta.doc.getMap('databases').set('db-old', old)
      pages().set('old-a', pageEntry({ title: 'Login fails (old)', parentId: 'db-old', databaseId: 'db-old', order: 1 }, { 'x-ticket': '8215' }))
      pages().set('old-b', pageEntry({ title: 'Printing', parentId: 'db-old', databaseId: 'db-old', order: 2 }, { 'x-ticket': '7001', 'x-notes': 'Old note' }))
      pages().set('old-c', pageEntry({ title: 'Fonts', parentId: 'db-old', databaseId: 'db-old', order: 3 }, { 'x-ticket': '7002' }))
      const agents = meta.doc.getMap('agents')
      agents.set('ag-stage', agentDef('ag-stage', 'Stage mirror', {}))
      agents.set('ag-apply', agentDef('ag-apply', 'Apply mirror', { write: 'apply' }))
      agents.set('ag-late', agentDef('ag-late', 'Late mirror', {}))
      // the profile that unlocks upsert_rows for the runtime's (fictional) tracker server
      meta.doc.getMap('integrations').set('tracker', { schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['keys', 'onlyByHand', 'upsert', 'agentState'] })
    })
    await flushed(meta)
    const rt = await owner.json('PUT', `/api/workspaces/${wsId}/agent-runtime`, { claudeKey: KEY, mcpServers: [{ name: 'tracker', url: 'https://tracker.example.com/mcp' }], enabled: true })
    assert.equal(rt.status, 200)
    token = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Tracker sync', scope: 'write' })).body.token
    mcp = new McpClient({ name: 'keys-test', version: '1.0.0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  })

  after(async () => {
    await mcp?.close()
    for (const d of open) d.destroy()
    await server.stop()
    await fake.close()
  })

  test('public API: a duplicate key is 409 duplicate_key; keeping its own value, empty and a protected field are fine', async () => {
    const dup = await api('POST', '/api/v1/databases/db-tk/rows', { title: 'Copy', properties: { Ticket: ' 8215 ' } })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'duplicate_key')
    assert.match(dup.body.error.message, /Ticket: "8215" is this database's key, and the row "Login fails"/)
    assert.equal((await api('PATCH', '/api/v1/rows/tk-b', { properties: { Ticket: '8215' } })).status, 409)
    assert.equal(prop('tk-b', 'k-ticket'), '8216')
    // its own value again, an empty key, and a field only people fill in (the API is no agent)
    const same = await api('PATCH', '/api/v1/rows/tk-b', { properties: { Ticket: '8216', Notes: 'Asked the vendor' } })
    assert.equal(same.status, 200, JSON.stringify(same.body))
    assert.equal((await api('POST', '/api/v1/databases/db-tk/rows', { title: 'No key yet', properties: { Ticket: '' } })).status, 201)
    assert.equal((await api('POST', '/api/v1/databases/db-tk/rows', { title: 'No key either' })).status, 201)
    // the schema says which property is the key and which only people fill in
    const db = await api('GET', '/api/v1/databases/db-tk')
    const byName = Object.fromEntries((db.body.properties as any[]).map((p) => [p.name, p]))
    assert.equal(byName.Ticket.key, true)
    assert.equal(byName.Notes.onlyByHand, true)
    assert.equal(byName.Status.key, undefined)
  })

  test('MCP: a protected field and a duplicate key are refused; one_get_database marks them', async () => {
    const call = async (name: string, args: Record<string, unknown>) => (await mcp.callTool({ name, arguments: args })) as ToolResult
    const hand = await call('one_update_row', { id: 'tk-c', properties: { Notes: 'from Claude' } })
    assert.equal(hand.isError, true)
    assert.match(hand.content[0]!.text, /Notes: filled in only by hand/)
    assert.equal(prop('tk-c', 'k-notes'), 'Call back Mira first')
    const dup = await call('one_create_row', { databaseId: 'db-tk', title: 'Twin', properties: { Ticket: '8217', Status: 'Brand new option' } })
    assert.equal(dup.isError, true)
    assert.match(dup.content[0]!.text, /unique per row/)
    // nothing was added for the refused row (not even its new option)
    const options = ((meta.doc.getMap('databases').get('db-tk') as Y.Map<any>).get('properties') as Y.Map<any>).get('k-status').options as Array<{ name: string }>
    assert.equal(options.some((o) => o.name === 'Brand new option'), false)
    const db = JSON.parse((await call('one_get_database', { id: 'db-tk' })).content[0]!.text)
    const notesProp = db.properties.find((p: any) => p.name === 'Notes')
    assert.deepEqual([notesProp.onlyByHand, notesProp.readOnly], [true, true])
    assert.equal(db.properties.find((p: any) => p.name === 'Ticket').key, true)

    // moving a row in: its key must be free there, and a protected field stays the person's
    const taken = await call('one_move_row', { id: 'old-a', databaseId: 'db-tk' })
    assert.equal(taken.isError, true)
    assert.match(taken.content[0]!.text, /"Ticket" is the key of "Tickets" — unique per row — and "Login fails" has "8215" there already/)
    const notes = await call('one_move_row', { id: 'old-b', databaseId: 'db-tk' })
    assert.equal(notes.isError, true)
    assert.match(notes.content[0]!.text, /"Notes" is filled in only by hand in "Tickets"/)
    const moved = await call('one_move_row', { id: 'old-c', databaseId: 'db-tk' })
    assert.equal(moved.isError, undefined, moved.content[0]?.text)
    await waitFor(() => (pages().get('old-c') as Y.Map<any>).get('databaseId') === 'db-tk', 5000, 'moved')
  })

  test('stage mode: list_databases marks; upsert_rows created / updated / unchanged / refused; create_row and update_row refused', async () => {
    fake.script('Stage mirror', (req: FakeRequest, n: number) => {
      if (n === 0) return tools(['list_databases', {}])
      if (n === 1)
        return tools([
          'upsert_rows',
          {
            database_id: 'db-tk',
            key_property: 'Ticket',
            rows: [
              { key: '8215', title: 'Login fails', properties: { Status: 'Ready' } },
              { key: 8216, title: 'Export broken', properties: { Status: 'Ready' } },
              { key: '9001', title: 'Dark mode', properties: { Status: 'Open' }, body: 'Asked for by three teams.' },
              { key: '9002', title: 'Typo', properties: { Notes: 'from the tracker' } },
              { key: '9001', properties: { Status: 'Ready' } },
              { key: '8217', title: 'Slow search on phones', body: 'Replaced?' },
            ],
          },
        ])
      if (n === 2) return tools(['create_row', { database_id: 'db-tk', title: 'Twin', properties: { Ticket: '8216' } }], ['update_row', { id: 'tk-a', properties: { Notes: 'overwritten' } }])
      void req
      return say('Mirrored the tracker.')
    })
    const run = await runAgent('ag-stage')
    assert.equal(run.status, 'staged', JSON.stringify(run))
    const reqs = fake.of('Stage mirror')
    const [schema] = toolResults(reqs[1]!)
    assert.match(schema!.content, /Ticket \(text, key: unique per row\)/)
    assert.match(schema!.content, /Notes \(text, read-only for agents \(only by hand\)\)/)
    const [upsert] = toolResults(reqs[2]!)
    assert.match(upsert!.content, /1 created, 3 updated, 1 unchanged, 1 refused/)
    const lines = upsert!.content.split('\n').slice(1).map((l) => JSON.parse(l))
    assert.deepEqual(lines.map((l: any) => [l.key, l.action]), [
      ['8215', 'updated'],
      ['8216', 'unchanged'],
      ['9001', 'created'],
      ['9002', 'refused'],
      ['9001', 'updated'],
      ['8217', 'updated'],
    ])
    assert.match(lines[3].reason, /"Notes" is filled in only by hand/)
    // the person's page has text: the body is left alone, the title is staged
    assert.equal(lines[5].body, 'kept')
    const [dup, hand] = toolResults(reqs[3]!)
    assert.equal(dup!.is_error, true)
    assert.match(dup!.content, /"Ticket" is this database's key — unique per row — and the row "Export broken"/)
    assert.equal(hand!.is_error, true)
    assert.match(hand!.content, /"Notes" is filled in only by hand/)

    // the staged changes: an update, a new row (both values of 9001 in one change), a rename
    assert.deepEqual(run.staged.map((c: any) => [c.kind, c.pageId === 'tk-a' || c.pageId === 'tk-c' ? c.pageId : 'new']), [
      ['update_row', 'tk-a'],
      ['create_row', 'new'],
      ['rename', 'tk-c'],
    ])
    const created = run.staged[1]
    assert.deepEqual(created.props.map((p: any) => [p.name, p.after]), [
      ['Ticket', '9001'],
      ['Status', 'Ready'],
    ])
    assert.equal(created.markdown, 'Asked for by three teams.')
    assert.equal(prop('tk-a', 'k-status'), 'o-open')

    // applied on the server: written as the agent, the key unique
    const applied = await owner.post(`/api/workspaces/${wsId}/agent-runs/${run.id}/apply`, {})
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    await waitFor(() => prop('tk-a', 'k-status') === 'o-ready' && rowsWith('9001').length === 1, 5000, 'applied')
    assert.equal((pages().get('tk-c') as Y.Map<any>).get('title'), 'Slow search on phones')
    assert.equal(prop('tk-c', 'k-notes'), 'Call back Mira first')
  })

  test('apply mode: upsert_rows writes at once as the agent; running it again changes nothing', async () => {
    const batch = {
      database_id: 'db-tk',
      key_property: 'Ticket',
      rows: [
        { key: '8216', properties: { Status: 'Done' } },
        { key: 9100, title: 'Offline mode', properties: { Status: 'Open' }, body: 'Works without a network.' },
      ],
    }
    fake.script('Apply mirror', (_req: FakeRequest, n: number) => (n % 2 === 0 ? tools(['upsert_rows', batch]) : say('Mirrored.')))
    const first = await runAgent('ag-apply')
    assert.equal(first.status, 'ok', JSON.stringify(first))
    assert.equal(first.applied, 2)
    const [res1] = toolResults(fake.of('Apply mirror')[1]!)
    assert.match(res1!.content, /1 created, 1 updated, 0 unchanged, 0 refused/)
    await waitFor(() => prop('tk-b', 'k-status') === 'o-done' && rowsWith('9100').length === 1, 5000, 'written')
    const [id] = rowsWith('9100')[0]!
    assert.equal((pages().get(id) as Y.Map<any>).get('createdBy'), 'agent:ag-apply')
    assert.equal((pages().get('tk-b') as Y.Map<any>).get('updatedBy'), 'agent:ag-apply')

    const second = await runAgent('ag-apply')
    assert.equal(second.applied ?? 0, 0)
    const [res2] = toolResults(fake.of('Apply mirror')[3]!)
    assert.match(res2!.content, /0 created, 0 updated, 2 unchanged, 0 refused/)
    assert.equal(rowsWith('9100').length, 1)
  })

  test('applying a staged row whose key another row took since fails that change', async () => {
    fake.script('Late mirror', (_req: FakeRequest, n: number) => (n === 0 ? tools(['upsert_rows', { database_id: 'db-tk', key_property: 'Ticket', rows: [{ key: '9500', title: 'Late one' }] }]) : say('Proposed one.')))
    const run = await runAgent('ag-late')
    assert.equal(run.staged.length, 1)
    // meanwhile a person gives another row that key
    meta.doc.transact(() => ((pages().get('tk-a') as Y.Map<any>).get('properties') as Y.Map<unknown>).set('k-ticket', '9500'))
    await flushed(meta)
    await owner.post(`/api/workspaces/${wsId}/agent-runs/${run.id}/apply`, {})
    const after = (await runs('ag-late')).find((r) => r.id === run.id)
    assert.equal(after.staged[0].status, 'failed')
    assert.match(after.staged[0].error, /unique per row/)
    assert.equal(rowsWith('9500').length, 1)
  })
})
