import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, afterEach, describe, test } from 'node:test'
import { MCP_CLOSE_REPLACED, MCP_NO_APP, MCP_TOOLS, type BridgeMessage } from '../../src/app/features/mcp/contract.ts'
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
      'one_get_database',
      'one_get_page',
      'one_list_databases',
      'one_overview',
      'one_query_database',
      'one_search',
      'one_trash_page',
      'one_update_page',
      'one_update_row',
    ])
    for (const def of MCP_TOOLS) {
      const tool = tools.find((t) => t.name === def.name)!
      assert.deepEqual(tool.inputSchema, def.inputSchema, def.name)
      assert.equal(tool.annotations?.readOnlyHint, !def.write, `${def.name} readOnlyHint`)
      assert.equal(tool.annotations?.destructiveHint, def.name === 'one_trash_page', `${def.name} destructiveHint`)
      assert.ok(tool.description && tool.description.length > 40, `${def.name} has a description`)
    }
    const info = client.getServerVersion()
    assert.equal(info?.name, 'one')
    assert.match(client.getInstructions() ?? '', /one_overview/)
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
    const app = track(await helloApp())
    serve(app, () => ({ result: { workspace: { name: 'Late' } } }))
    const res = await pending
    assert.equal(res.isError, undefined)
    assert.deepEqual(JSON.parse(textOf(res)), { workspace: { name: 'Late' } })
  })

  test('forwards name + arguments and returns the tab\'s JSON result', async () => {
    const { client } = await start({}, 'claude-ai')
    const app = track(await connectApp())
    app.send({ type: 'hello', app: 'one', version: '1.0', workspace: { name: 'Acme', kind: 'local', readOnly: false }, mode: 'ask' })
    const welcome = (await app.next('welcome')) as Extract<BridgeMessage, { type: 'welcome' }>
    assert.equal(welcome.client?.name, 'claude-ai')
    assert.equal(welcome.client?.version, '1.2.3')
    const seen: Array<[string, unknown]> = []
    serve(app, (tool, args) => {
      seen.push([tool, args])
      return { result: { query: args.query, results: [{ id: 'p1', title: 'Roadmap' }] } }
    })
    const res = await client.callTool({ name: 'one_search', arguments: { query: 'roadmap', limit: 3 } })
    assert.deepEqual(seen, [['one_search', { query: 'roadmap', limit: 3 }]])
    assert.deepEqual(JSON.parse(textOf(res)), { query: 'roadmap', results: [{ id: 'p1', title: 'Roadmap' }] })
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
      setTimeout(() => app.send({ type: 'result', id: msg.id, result: { id: 'row1' } }), 800)
    })
    const progress: string[] = []
    const res = await client.callTool({ name: 'one_create_row', arguments: { databaseId: 'db', title: 'Q4 launch' } }, undefined, {
      onprogress: (p) => progress.push(p.message ?? ''),
    })
    assert.equal(res.isError, undefined)
    assert.deepEqual(JSON.parse(textOf(res)), { id: 'row1' })
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

describe('connections', () => {
  test('the newest tab wins; the older one is told and closed', async () => {
    const { client } = await start()
    const a = track(await helloApp('First'))
    serve(a, () => ({ result: 'from A' }))
    const b = track(await helloApp('Second'))
    serve(b, () => ({ result: 'from B' }))
    await a.next('replaced')
    await waitFor(() => a.closed !== null)
    assert.equal(a.closed?.code, MCP_CLOSE_REPLACED)
    const res = await client.callTool({ name: 'one_overview', arguments: {} })
    assert.equal(textOf(res), 'from B')
  })

  test('a connection that never says hello cannot push the tab out', async () => {
    const { client } = await start()
    const a = track(await helloApp())
    serve(a, () => ({ result: 'still A' }))
    track(await connectApp())
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(a.messages.some((m) => m.type === 'replaced'), false)
    assert.equal(textOf(await client.callTool({ name: 'one_overview', arguments: {} })), 'still A')
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
