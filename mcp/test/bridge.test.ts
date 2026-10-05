import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, afterEach, describe, test } from 'node:test'
import { MCP_CLOSE_REPLACED, MCP_NO_APP, MCP_SUBPROTOCOL_V1, MCP_TOOLS, type BridgeMessage } from '../../src/app/features/mcp/contract.ts'
import { connectApp, helloApp, PORT, serve, startBridge, textOf, waitFor, type FakeApp, type Started } from './helpers.ts'

let bridge: Started | null = null
const apps: FakeApp[] = []

async function start(env: Record<string, string> = {}, clientName?: string) {
  bridge = await startBridge(env, clientName)
  return bridge
}

afterEach(async () => {
  for (const a of apps.splice(0)) a.close()
  await bridge?.close()
  bridge = null
  // the port is free again before the next test starts its bridge
  await new Promise((r) => setTimeout(r, 60))
})

after(() => {
  for (const a of apps) a.close()
})

const track = <T extends FakeApp>(a: T) => {
  apps.push(a)
  return a
}

describe('tool list', () => {
  test('matches the shared contract: names, schemas, read/write hints', async () => {
    const { client } = await start()
    const { tools } = await client.listTools()
    assert.deepEqual(
      tools.map((t) => t.name),
      MCP_TOOLS.map((t) => t.name),
    )
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'one_create_database',
      'one_create_page',
      'one_create_property',
      'one_create_row',
      'one_create_view',
      'one_delete_property',
      'one_delete_view',
      'one_get_database',
      'one_get_page',
      'one_list_databases',
      'one_list_workspaces',
      'one_move_page',
      'one_move_row',
      'one_overview',
      'one_query_database',
      'one_restore_page',
      'one_run_query',
      'one_run_script',
      'one_search',
      'one_trash_page',
      'one_update_database',
      'one_update_page',
      'one_update_property',
      'one_update_row',
      'one_update_view',
    ])
    // what removes something says so (clients ask before running these)
    const destructive = ['one_delete_property', 'one_delete_view', 'one_run_script', 'one_trash_page', 'one_update_property']
    for (const def of MCP_TOOLS) {
      const tool = tools.find((t) => t.name === def.name)!
      assert.deepEqual(tool.inputSchema, def.inputSchema, def.name)
      assert.equal(tool.annotations?.readOnlyHint, !def.write, `${def.name} readOnlyHint`)
      assert.equal(tool.annotations?.destructiveHint, destructive.includes(def.name), `${def.name} destructiveHint`)
      assert.ok(tool.description && tool.description.length > 40, `${def.name} has a description`)
      // every tool but the list itself takes the workspace it is meant for (optional)
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>
      if (def.name === 'one_list_workspaces') assert.equal(props.workspace, undefined)
      else {
        assert.equal(props.workspace?.type, 'string', `${def.name} takes workspace`)
        assert.ok(!(tool.inputSchema.required ?? []).includes('workspace'), `${def.name}: workspace is optional`)
      }
    }
    const info = client.getServerVersion()
    assert.equal(info?.name, 'one')
    assert.match(client.getInstructions() ?? '', /one_overview/)
    assert.match(client.getInstructions() ?? '', /one_list_workspaces/)
    assert.match(client.getInstructions() ?? '', /workspace_mismatch/)
    assert.match(client.getInstructions() ?? '', /one_restore_page/)
    assert.match(client.getInstructions() ?? '', /one_run_query/)
    assert.match(client.getInstructions() ?? '', /one_run_script/)
  })

  test('One Script: one_run_query reads (with the language reference), one_run_script writes and is asked first', async () => {
    const { client } = await start()
    const { tools } = await client.listTools()
    const query = tools.find((t) => t.name === 'one_run_query')!
    assert.equal(query.annotations?.readOnlyHint, true)
    assert.deepEqual(query.inputSchema.required, ['code'])
    assert.match(query.description ?? '', /One Script/)
    assert.match(query.description ?? '', /db\(@Tasks\)/)
    const run = tools.find((t) => t.name === 'one_run_script')!
    assert.equal(run.annotations?.readOnlyHint, false)
    assert.equal(run.annotations?.destructiveHint, true)
    assert.deepEqual(run.inputSchema.required, ['script'])
    assert.match(run.description ?? '', /dry/)
    assert.match(run.description ?? '', /approve/)
  })

  test('trash and restore take one id or up to 50 ids', async () => {
    const { client } = await start()
    const { tools } = await client.listTools()
    for (const name of ['one_trash_page', 'one_restore_page']) {
      const props = tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { type?: string; maxItems?: number }>
      assert.equal(props.id?.type, 'string', name)
      assert.deepEqual([props.ids?.type, props.ids?.maxItems], ['array', 50], name)
    }
  })
})

describe('the "one:" codeword', () => {
  test('the instructions name it; prompts/list offers "one"; prompts/get renders the task', async () => {
    const { client } = await start()
    assert.match(client.getInstructions() ?? '', /Codeword: a message that starts with "one:"/)
    assert.ok(client.getServerCapabilities()?.prompts, 'prompts capability')
    const { prompts } = await client.listPrompts()
    assert.deepEqual(prompts.map((p) => p.name), ['one'])
    assert.deepEqual(prompts[0]!.arguments, [{ name: 'task', description: 'What to do in One, e.g. "summarise my meeting notes from this week"', required: true }])
    const got = await client.getPrompt({ name: 'one', arguments: { task: '  tidy up my Projects database ' } })
    assert.equal(got.messages.length, 1)
    assert.equal(got.messages[0]!.role, 'user')
    const text = (got.messages[0]!.content as { type: string; text: string }).text
    assert.match(text, /^one: tidy up my Projects database\n\nUse the One tools for this/)
    assert.match(text, /one_run_query/)
  })

  test('an unknown prompt or an empty task is refused', async () => {
    const { client } = await start()
    await assert.rejects(client.getPrompt({ name: 'two', arguments: { task: 'x' } }), /Unknown prompt "two"/)
    await assert.rejects(client.getPrompt({ name: 'one', arguments: { task: '   ' } }), /argument "task"/)
    await assert.rejects(client.getPrompt({ name: 'one', arguments: {} }), /argument "task"/)
  })
})

describe('forwarding', () => {
  test('without a connected tab every tool explains what to do', async () => {
    const { client } = await start()
    const res = await client.callTool({ name: 'one_overview', arguments: {} })
    assert.equal(res.isError, true)
    assert.equal(textOf(res), MCP_NO_APP)
  })

  test('a call waits a little for the tab to connect (ONE_MCP_WAIT_MS)', async () => {
    const { client } = await start({ ONE_MCP_WAIT_MS: '3000' })
    const pending = client.callTool({ name: 'one_overview', arguments: {} })
    await new Promise((r) => setTimeout(r, 300))
    const app = track(await helloApp('Late'))
    serve(app, () => ({ result: { today: '2026-10-04' } }))
    const res = await pending
    assert.equal(res.isError, undefined)
    assert.deepEqual(JSON.parse(textOf(res)), { today: '2026-10-04', workspace: { id: 'local:late', name: 'Late' } })
  })

  test('forwards name + arguments (bound to the workspace id) and returns the tab\'s JSON result', async () => {
    const { client } = await start({}, 'claude-ai')
    const app = track(await connectApp())
    app.workspace = { id: 'local:acme', name: 'Acme', kind: 'local', readOnly: false }
    app.send({ type: 'hello', app: 'one', version: '1.0', workspace: app.workspace, mode: 'ask' })
    const welcome = (await app.next('welcome')) as Extract<BridgeMessage, { type: 'welcome' }>
    assert.equal(welcome.client?.name, 'claude-ai')
    assert.equal(welcome.client?.version, '1.2.3')
    const seen: Array<[string, unknown, unknown]> = []
    serve(app, (tool, args, call) => {
      seen.push([tool, args, call.workspace])
      return { result: { query: args.query, results: [{ id: 'p1', title: 'Roadmap' }] } }
    })
    const res = await client.callTool({ name: 'one_search', arguments: { query: 'roadmap', limit: 3 } })
    // the workspace travels next to the arguments, never inside them
    assert.deepEqual(seen, [['one_search', { query: 'roadmap', limit: 3 }, 'local:acme']])
    assert.deepEqual(JSON.parse(textOf(res)), { query: 'roadmap', results: [{ id: 'p1', title: 'Roadmap' }], workspace: { id: 'local:acme', name: 'Acme' } })
    await client.callTool({ name: 'one_search', arguments: { query: 'x', workspace: 'acme' } })
    assert.deepEqual(seen[1], ['one_search', { query: 'x' }, 'local:acme'])
  })

  test('a tab error becomes a tool error with its message', async () => {
    const { client } = await start()
    const app = track(await helloApp())
    serve(app, () => ({ error: 'No page with id "nope". Use one_search to find page ids.' }))
    const res = await client.callTool({ name: 'one_get_page', arguments: { id: 'nope' } })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /No page with id "nope"/)
  })

  test('unknown tools are refused by the bridge itself', async () => {
    const { client } = await start()
    const res = await client.callTool({ name: 'one_delete_everything', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /Unknown tool/)
  })

  test('times out when the tab does not answer, and tells the tab to cancel', async () => {
    const { client } = await start({ ONE_MCP_TIMEOUT_MS: '300' })
    const app = track(await helloApp())
    const res = await client.callTool({ name: 'one_overview', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /did not answer within/)
    const call = (await app.next('call')) as Extract<BridgeMessage, { type: 'call' }>
    const cancel = (await app.next('cancel')) as Extract<BridgeMessage, { type: 'cancel' }>
    assert.equal(cancel.id, call.id)
  })

  test('a write waiting for approval gets the approval window and reports progress', async () => {
    const { client } = await start({ ONE_MCP_TIMEOUT_MS: '300' })
    const app = track(await helloApp())
    app.ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as BridgeMessage
      if (msg.type !== 'call') return
      app.send({ type: 'pending', id: msg.id, timeoutMs: 5000 })
      setTimeout(() => app.send({ type: 'result', id: msg.id, result: { id: 'row1', workspace: { id: msg.workspace!, name: 'Test workspace' } } }), 800)
    })
    const progress: string[] = []
    const res = await client.callTool({ name: 'one_create_row', arguments: { databaseId: 'db', title: 'Q4 launch' } }, undefined, {
      onprogress: (p) => progress.push(p.message ?? ''),
    })
    assert.equal(res.isError, undefined)
    assert.deepEqual(JSON.parse(textOf(res)), { id: 'row1', workspace: { id: 'local:test-workspace', name: 'Test workspace' } })
    assert.deepEqual(progress, ['Waiting for approval in One…'])
  })

  test('a cancelled call is cancelled in the tab too', async () => {
    const { client } = await start()
    const app = track(await helloApp())
    const ac = new AbortController()
    const pending = client.callTool({ name: 'one_create_page', arguments: { title: 'x' } }, undefined, { signal: ac.signal }).catch((e: Error) => e)
    const call = (await app.next('call')) as Extract<BridgeMessage, { type: 'call' }>
    ac.abort()
    const cancel = (await app.next('cancel')) as Extract<BridgeMessage, { type: 'cancel' }>
    assert.equal(cancel.id, call.id)
    assert.ok((await pending) instanceof Error)
  })
})

const from = (res: unknown) => JSON.parse(textOf(res)) as { from?: string; workspace?: { id: string | null; name: string } }

describe('connections', () => {
  test('a newer tab of the same workspace wins; the older one is told and closed', async () => {
    const { client } = await start()
    const a = track(await helloApp('First', 'ask', { id: 'local:same' }))
    serve(a, () => ({ result: { from: 'A' } }))
    const b = track(await helloApp('First', 'ask', { id: 'local:same' }))
    serve(b, () => ({ result: { from: 'B' } }))
    await a.next('replaced')
    await waitFor(() => a.closed !== null)
    assert.equal(a.closed?.code, MCP_CLOSE_REPLACED)
    const res = await client.callTool({ name: 'one_overview', arguments: {} })
    assert.equal(from(res).from, 'B')
  })

  test('a connection that never says hello cannot push the tab out', async () => {
    const { client } = await start()
    const a = track(await helloApp())
    serve(a, () => ({ result: { from: 'still A' } }))
    track(await connectApp())
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(a.messages.some((m) => m.type === 'replaced'), false)
    assert.equal(from(await client.callTool({ name: 'one_overview', arguments: {} })).from, 'still A')
  })

  test('calls in flight fail when the tab disconnects', async () => {
    const { client } = await start()
    const app = track(await helloApp())
    const pending = client.callTool({ name: 'one_overview', arguments: {} })
    await app.next('call')
    app.close()
    const res = await pending
    assert.equal(res.isError, true)
    assert.match(textOf(res), /closed or disconnected/)
  })

  test('a second bridge on a taken port explains it on every call', async () => {
    await start()
    const second = await startBridge()
    try {
      assert.match(second.stderr(), /in use/)
      const res = await second.client.callTool({ name: 'one_overview', arguments: {} })
      assert.equal(res.isError, true)
      assert.match(textOf(res), /already using port 47399/)
    } finally {
      await second.close()
    }
  })
})

type Call = Extract<BridgeMessage, { type: 'call' }>
const callsOf = (app: FakeApp) => app.messages.filter((m): m is Call => m.type === 'call')
/** Record calls without consuming them (serve() answers). */
function record(app: FakeApp): Call[] {
  const seen: Call[] = []
  app.ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as BridgeMessage
    if (m.type === 'call') seen.push(m)
  })
  return seen
}
const json = (res: unknown) => JSON.parse(textOf(res)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('workspaces', () => {
  test('tabs of different workspaces coexist; one_list_workspaces lists them, newest first; each hears of the other', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal', 'apply'))
    const b = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1' }))
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(a.closed, null)
    assert.equal(b.closed, null)
    const list = json(await client.callTool({ name: 'one_list_workspaces', arguments: {} }))
    assert.deepEqual(
      list.workspaces.map((w: { id: string; name: string; kind: string; mode: string; newest: boolean; access: string }) => [w.id, w.name, w.kind, w.mode, w.access, w.newest]),
      [
        ['team:acme1', 'Acme', 'team', 'ask', 'read-write', true],
        ['local:personal', 'Personal', 'local', 'apply', 'read-write', false],
      ],
    )
    assert.ok(!JSON.stringify(list).includes('"pages"'), 'no content')
    // each tab knows the other is there (names only), for the settings note
    const peersA = a.messages.filter((m) => m.type === 'peers').at(-1) as Extract<BridgeMessage, { type: 'peers' }>
    assert.deepEqual(peersA.workspaces, [{ name: 'Acme', kind: 'team' }])
    b.close()
    await waitFor(() => (a.messages.filter((m) => m.type === 'peers').at(-1) as Extract<BridgeMessage, { type: 'peers' }>).workspaces.length === 0)
  })

  test('routing: by id, by name (case-insensitive, trimmed) — the call lands in that tab only', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal'))
    const b = track(await helloApp('Acme Studio', 'ask', { kind: 'team', id: 'team:acme1' }))
    const seenA = record(a)
    const seenB = record(b)
    serve(a, () => ({ result: { from: 'A' } }))
    serve(b, () => ({ result: { from: 'B' } }))
    const byId = json(await client.callTool({ name: 'one_overview', arguments: { workspace: 'team:acme1' } }))
    assert.deepEqual(byId, { from: 'B', workspace: { id: 'team:acme1', name: 'Acme Studio' } })
    const byName = json(await client.callTool({ name: 'one_search', arguments: { query: 'x', workspace: '  acme   STUDIO ' } }))
    assert.equal(byName.from, 'B')
    const other = json(await client.callTool({ name: 'one_get_page', arguments: { id: 'p1', workspace: 'personal' } }))
    assert.deepEqual(other.workspace, { id: 'local:personal', name: 'Personal' })
    assert.deepEqual(
      seenB.map((c) => [c.tool, c.workspace]),
      [
        ['one_overview', 'team:acme1'],
        ['one_search', 'team:acme1'],
      ],
    )
    assert.deepEqual(seenA.map((c) => [c.tool, c.workspace, c.args]), [['one_get_page', 'local:personal', { id: 'p1' }]])
  })

  test('without "workspace" and several connected: refused, never guessed — nothing reaches a tab', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal'))
    const b = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1' }))
    const res = await client.callTool({ name: 'one_create_page', arguments: { title: 'Where?' } })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /^workspace_required: 2 One workspaces are connected: "Personal" \(local:personal\), "Acme" \(team:acme1\)/)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(callsOf(a).length + callsOf(b).length, 0)
  })

  test('an ambiguous name lists the ids; an unknown one lists what is connected; an id-shaped value never matches a name', async () => {
    const { client } = await start()
    const a = track(await helloApp('Acme', 'ask', { id: 'local:one' }))
    const b = track(await helloApp('ACME', 'ask', { kind: 'team', id: 'team:two' }))
    const c = track(await helloApp('team:three', 'ask', { id: 'local:three' }))
    const amb = await client.callTool({ name: 'one_overview', arguments: { workspace: 'acme' } })
    assert.equal(amb.isError, true)
    assert.match(textOf(amb), /^workspace_ambiguous: 2 connected workspaces are called "acme": local:one, team:two/)
    const unknown = await client.callTool({ name: 'one_overview', arguments: { workspace: 'Globex' } })
    assert.equal(unknown.isError, true)
    assert.match(textOf(unknown), /^workspace_unknown: no connected workspace has the id or name "Globex"\. Connected: "Acme" \(local:one\), "ACME" \(team:two\), "team:three" \(local:three\)/)
    // a tab NAMED like a workspace id never receives calls for that id
    const spoof = await client.callTool({ name: 'one_overview', arguments: { workspace: 'team:three' } })
    assert.equal(spoof.isError, true)
    assert.match(textOf(spoof), /^workspace_unknown/)
    const bad = await client.callTool({ name: 'one_overview', arguments: { workspace: 42 } })
    assert.match(textOf(bad), /"workspace" must be a string/)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(callsOf(a).length + callsOf(b).length + callsOf(c).length, 0)
  })

  test('the same id from two sites is not one workspace: both stay, addressing it is refused', async () => {
    const { client } = await start()
    const a = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1', origin: 'http://localhost:5173' }))
    const b = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1', origin: 'http://127.0.0.1:4510' }))
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(a.closed, null, 'a page of another site cannot push a tab out by claiming its id')
    const res = await client.callTool({ name: 'one_overview', arguments: { workspace: 'team:acme1' } })
    assert.match(textOf(res), /^workspace_ambiguous: more than one tab claims the workspace id "team:acme1" \(from http:\/\/localhost:5173, http:\/\/127\.0\.0\.1:4510\)/)
    assert.equal(callsOf(a).length + callsOf(b).length, 0)
  })

  test('a tab that switches workspace while a call is open: the call is refused and cancelled, a late answer dropped', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal'))
    const pending = client.callTool({ name: 'one_create_page', arguments: { title: 'Plan', workspace: 'Personal' } })
    const call = (await a.next('call')) as Call
    assert.equal(call.workspace, 'local:personal')
    a.send({ type: 'pending', id: call.id, timeoutMs: 5000 })
    // the person opens a team workspace in this tab
    a.send({ type: 'status', workspace: { id: 'team:acme1', name: 'Acme', kind: 'team', readOnly: false }, mode: 'ask' })
    const res = await pending
    assert.equal(res.isError, true)
    assert.match(textOf(res), /^workspace_mismatch: this call was meant for the workspace "Personal" \(local:personal\), but that One tab switched to "Acme" \(team:acme1\)/)
    const cancel = (await a.next('cancel')) as Extract<BridgeMessage, { type: 'cancel' }>
    assert.equal(cancel.id, call.id)
    // an answer after the switch changes nothing
    a.send({ type: 'result', id: call.id, result: { id: 'p9', workspace: { id: 'team:acme1', name: 'Acme' } } })
    // the tab is listed with its new workspace; the old one is gone
    const list = json(await client.callTool({ name: 'one_list_workspaces', arguments: {} }))
    assert.deepEqual(list.workspaces.map((w: { id: string }) => w.id), ['team:acme1'])
  })

  test('a result from another workspace than the call\'s is dropped', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal'))
    a.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as BridgeMessage
      if (m.type === 'call') a.send({ type: 'result', id: m.id, result: { secret: 'other', workspace: { id: 'team:other', name: 'Other' } } })
    })
    const res = await client.callTool({ name: 'one_overview', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /^workspace_mismatch: One answered from another workspace/)
    assert.doesNotMatch(textOf(res), /secret/)
    // an answer that names no workspace at all is not trusted either
    const b = track(await helloApp('Personal'))
    b.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as BridgeMessage
      if (m.type === 'call') b.send({ type: 'result', id: m.id, result: 'plain text' })
    })
    assert.match(textOf(await client.callTool({ name: 'one_overview', arguments: {} })), /^workspace_mismatch/)
  })

  test('without "workspace", calls stay in the workspace this session used: another one in its place is refused', async () => {
    const { client } = await start()
    const a = track(await helloApp('Personal'))
    serve(a, () => ({ result: { from: 'A' } }))
    assert.equal(json(await client.callTool({ name: 'one_overview', arguments: {} })).from, 'A')
    // the person switches the tab to a team workspace (the app reloads: a new connection)
    a.close()
    await waitFor(() => a.closed !== null)
    const b = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1' }))
    serve(b, () => ({ result: { from: 'B' } }))
    const res = await client.callTool({ name: 'one_create_page', arguments: { title: 'Notes' } })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /^workspace_mismatch: the connected One tab now shows the workspace "Acme" \(team:acme1\), but your earlier calls went to "Personal" \(local:personal\)\. Nothing was done\./)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(callsOf(b).length, 0)
    // naming it is the decision: from then on it is this session's workspace
    assert.equal(json(await client.callTool({ name: 'one_overview', arguments: { workspace: 'Acme' } })).from, 'B')
    assert.equal(json(await client.callTool({ name: 'one_overview', arguments: {} })).from, 'B')
  })

  test('a v2 tab must name its workspace by a valid id (hello and status)', async () => {
    await start()
    const noId = track(await connectApp())
    noId.send({ type: 'hello', app: 'one', version: '1.0', workspace: { name: 'X', kind: 'local', readOnly: false }, mode: 'ask' })
    await waitFor(() => noId.closed !== null)
    assert.equal(noId.closed?.code, 1008)
    const wrongKind = track(await connectApp())
    wrongKind.send({ type: 'hello', app: 'one', version: '1.0', workspace: { id: 'team:x', name: 'X', kind: 'local', readOnly: false }, mode: 'ask' })
    await waitFor(() => wrongKind.closed !== null)
    const ok = track(await helloApp('Personal'))
    ok.send({ type: 'status', workspace: { id: 'local:../../etc', name: 'X', kind: 'local', readOnly: false }, mode: 'ask' })
    await waitFor(() => ok.closed !== null)
    assert.equal(ok.closed?.code, 1008)
  })

  test('an older app (v1, no id) is the only tab, as before; its answers name its workspace; a v2 tab replaces it', async () => {
    const { client } = await start()
    const v2 = track(await helloApp('Personal'))
    const old = track(await helloApp('Old One', 'ask', { legacy: true }))
    assert.equal(old.ws.protocol, MCP_SUBPROTOCOL_V1)
    await v2.next('replaced')
    await waitFor(() => v2.closed !== null)
    const seen = record(old)
    serve(old, () => ({ result: { from: 'old' } }))
    const res = json(await client.callTool({ name: 'one_search', arguments: { query: 'x', workspace: 'old one' } }))
    assert.deepEqual(res, { from: 'old', workspace: { id: null, name: 'Old One' } })
    assert.equal(seen[0]!.workspace, undefined, 'no binding the old app could not check')
    assert.deepEqual(seen[0]!.args, { query: 'x' })
    const list = json(await client.callTool({ name: 'one_list_workspaces', arguments: {} }))
    assert.equal(list.workspaces[0].id, null)
    assert.match(list.workspaces[0].note, /older One version/)
    assert.equal(old.messages.some((m) => m.type === 'peers'), false, 'v1 tabs get no peers messages')
    // a newer tab takes over from the old app
    const next = track(await helloApp('Acme', 'ask', { kind: 'team', id: 'team:acme1' }))
    await old.next('replaced')
    assert.equal(next.closed, null)
  })
})

describe('handshake security', () => {
  const status = async (opts: Parameters<typeof connectApp>[0]) => {
    try {
      track(await connectApp(opts))
      return 101
    } catch (e) {
      return Number(/HTTP (\d+)/.exec(String(e))?.[1] ?? 0)
    }
  }

  test('only One\'s own origins may connect', async () => {
    await start({ ONE_ORIGINS: 'https://one.example.com, http://intranet.local:*, not a url' })
    assert.equal(await status({ origin: 'https://evil.example' }), 403)
    assert.equal(await status({ origin: 'https://getonecms.com.evil.example' }), 403)
    assert.equal(await status({ origin: 'http://getonecms.com' }), 403)
    assert.equal(await status({ origin: 'null' }), 403)
    assert.equal(await status({ origin: null }), 403)
    assert.equal(await status({ origin: 'https://getonecms.com' }), 101)
    assert.equal(await status({ origin: 'http://localhost:5173' }), 101)
    assert.equal(await status({ origin: 'http://127.0.0.1:4510' }), 101)
    assert.equal(await status({ origin: 'https://one.example.com' }), 101)
    assert.equal(await status({ origin: 'http://intranet.local:8080' }), 101)
    assert.match(bridge!.stderr(), /ignoring ONE_ORIGINS entry "not a url"/)
    assert.match(bridge!.stderr(), /refused a connection: origin "https:\/\/evil.example"/)
  })

  test('a rebinding page (foreign Host) and an old protocol are refused', async () => {
    await start()
    assert.equal(await status({ host: `evil.example:${PORT}` }), 403)
    assert.equal(await status({ host: '127.0.0.1:1234' }), 403)
    assert.equal(await status({ protocol: null }), 400)
    assert.equal(await status({ protocol: 'one-mcp.v0' }), 400)
    assert.equal(await status({ host: `localhost:${PORT}` }), 101)
    // older apps still connect (as the only tab, see 'workspaces')
    assert.equal(await status({ protocol: MCP_SUBPROTOCOL_V1 }), 101)
  })

  test('plain HTTP gets nothing', async () => {
    await start()
    const res = await new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: PORT, path: '/', headers: { origin: 'https://evil.example' } }, (r) => {
        let body = ''
        r.on('data', (d) => (body += d))
        r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body }))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(res.status, 426)
    assert.equal(res.headers['access-control-allow-origin'], undefined)
    assert.match(res.body, /WebSocket only/)
  })
})
