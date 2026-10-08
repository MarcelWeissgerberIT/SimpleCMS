/**
 * Server agents — the MCP tool allow-list (`mcpTools` → the MCP connector's toolset), the last successful run in
 * the run's context, and the agent's own state (agent_state_get / agent_state_set: sealed at rest, saved only when a
 * run ends ok). Against a real server and the fake Messages API (fake-anthropic.ts — never the real one); the MCP
 * servers are fictional addresses nobody calls. The state tools are offered because an integration profile matches
 * the runtime's "tracker" by name (integrations.test.ts covers the gate itself).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import { sanitizeAgent } from '../src/agents/sanitize.ts'
import { type FakeAnthropic, type FakeRequest, fakeAnthropic, say, toolResults, tools } from './fake-anthropic.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

const KEY = 'sk-ant-api03-TESTKEY-not-real-memory-0123456789WXYZ'

function agentDef(id: string, name: string, extra: Record<string, unknown>) {
  const at = Date.now()
  return { id, name, instructions: `Instructions of ${name}.`, trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'server', model: null, effort: null, maxRunUsd: 1, enabled: true, createdBy: null, createdAt: at, updatedAt: at, ...extra }
}

const firstText = (req: FakeRequest): string => {
  const m = req.body.messages[0]
  return typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text ?? '').join('\n')
}

describe('server agents: tool allow-list, last run, own state', () => {
  let fake: FakeAnthropic
  let server: TestServer
  let owner: Client
  let wsId: string
  let meta: DocClient

  const runs = async (agentId: string) => (await owner.get(`/api/workspaces/${wsId}/agent-runs?agentId=${agentId}&limit=50`)).body as any[]
  async function finished(agentId: string, count: number): Promise<any[]> {
    let list: any[] = []
    await waitFor(
      async () => {
        list = await runs(agentId)
        return list.filter((r) => r.status !== 'running').length >= count
      },
      20_000,
      `${count} finished run(s) of ${agentId}`,
    )
    return list
  }
  const run = async (agentId: string, count: number) => {
    const started = await owner.post(`/api/workspaces/${wsId}/agents/${agentId}/run`)
    assert.equal(started.status, 202, JSON.stringify(started.body))
    const list = await finished(agentId, count)
    return list.find((r) => r.id === started.body.runId)
  }

  before(async () => {
    fake = await fakeAnthropic()
    server = await startServer({ ANTHROPIC_BASE_URL: fake.url, AGENT_TICK_MS: '300', AGENT_COALESCE_MS: '800', API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'owner@memory.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Mirror Co' })).body.id
    meta = openDoc(server, owner, `ws:${wsId}`)
    await meta.synced
    meta.doc.transact(() => {
      const agents = meta.doc.getMap('agents')
      // a bad tool name, a duplicate and a server the agent does not use are dropped by the sanitizer
      agents.set('ag-allow', agentDef('ag-allow', 'Item mirror', { mcpServers: ['tracker', 'wiki'], mcpTools: { tracker: ['list_items', 'get_item', 'bad name!', 'list_items'], wiki: [], ghost: ['x'] } }))
      agents.set('ag-all', agentDef('ag-all', 'All tools', { mcpServers: ['tracker'] }))
      agents.set('ag-state', agentDef('ag-state', 'Cursor keeper', {}))
      meta.doc.getMap('integrations').set('tracker', { schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['upsert', 'toolAllowList', 'agentState', 'notify'] })
    })
    await flushed(meta)
    const put = await owner.json('PUT', `/api/workspaces/${wsId}/agent-runtime`, {
      claudeKey: KEY,
      mcpServers: [
        { name: 'tracker', url: 'https://tracker.example.com/mcp' },
        { name: 'wiki', url: 'https://wiki.example.com/mcp' },
      ],
      enabled: true,
    })
    assert.equal(put.status, 200)
  })

  after(async () => {
    meta?.destroy()
    await server.stop()
    await fake.close()
  })

  test('MCP allow-list: only the allowed tools are switched on; an empty list leaves the server out; no list = all', async () => {
    fake.script('Item mirror', () => say('Found 2 open items.'))
    const r = await run('ag-allow', 1)
    assert.equal(r.status, 'ok', JSON.stringify(r))
    const [req] = fake.of('Item mirror') as [FakeRequest]
    assert.deepEqual(req.body.mcp_servers, [{ type: 'url', url: 'https://tracker.example.com/mcp', name: 'tracker' }])
    assert.deepEqual(
      req.body.tools.filter((t: any) => t.type === 'mcp_toolset'),
      [{ type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { list_items: { enabled: true }, get_item: { enabled: true } } }],
    )
    assert.match(req.body.system, /<mcp_server name="tracker">[\s\S]*Only these of its tools are switched on for you: list_items, get_item\./)
    assert.doesNotMatch(req.body.system, /<mcp_server name="wiki">/)
    assert.ok(r.steps.some((s: any) => s.kind === 'note' && s.label === 'MCP server "wiki": no tool is allowed for this agent — left out.'), JSON.stringify(r.steps))
    // the agent's own tools come after the workspace tools; no notify_me on the server (no inbox there)
    const names = req.body.tools.filter((t: any) => t.name).map((t: any) => t.name)
    assert.deepEqual(names.slice(-2), ['agent_state_get', 'agent_state_set'])
    assert.equal(names.includes('notify_me'), false)

    fake.script('All tools', () => say('ok'))
    await run('ag-all', 1)
    const [all] = fake.of('All tools') as [FakeRequest]
    assert.deepEqual(
      all.body.tools.filter((t: any) => t.type === 'mcp_toolset'),
      [{ type: 'mcp_toolset', mcp_server_name: 'tracker' }],
    )
    assert.doesNotMatch(all.body.system, /Only these of its tools/)
  })

  test('state: saved (sealed) when a run ends ok, read by the next run with its last successful run; an error keeps the old state', async () => {
    fake.script('Cursor keeper', (_req, n) => {
      switch (n) {
        // run 1
        case 0:
          return tools(['agent_state_get', {}])
        case 1:
          return tools(['agent_state_set', { json: '{"cursor": "c1"}' }])
        case 2:
          return say('Mirrored 2 items.')
        // run 2: sets c2, then fails
        case 3:
          return tools(['agent_state_get', {}], ['agent_state_set', { json: '{"cursor":"c2"}' }])
        case 4:
          return { status: 400, error: { type: 'invalid_request_error', message: 'broken on purpose' } }
        // run 3: c1 again; a state over 4 KB is refused
        case 5:
          return tools(['agent_state_get', {}], ['agent_state_set', { json: JSON.stringify({ seen: 'x'.repeat(5000) }) }])
        default:
          return say('Nothing new.')
      }
    })
    const r1 = await run('ag-state', 1)
    assert.equal(r1.status, 'ok', JSON.stringify(r1))
    const reqs = () => fake.of('Cursor keeper')
    assert.match(firstText(reqs()[0]!), /Last successful run: none — this is the first run\./)
    assert.match(toolResults(reqs()[1]!)[0]!.content, /Nothing saved yet/)
    assert.ok(r1.steps.some((s: any) => s.label === 'State saved for the next run (15 bytes).'), JSON.stringify(r1.steps))
    // sealed at rest: no plaintext in the table
    const raw = new DatabaseSync(join(server.dataDir, 'one.sqlite'), { readOnly: true })
    try {
      const row = raw.prepare('SELECT data, run_id FROM agent_state WHERE workspace_id = ? AND agent_id = ?').get(wsId, 'ag-state') as { data: string; run_id: string }
      assert.equal(row.run_id, r1.id)
      assert.match(row.data, /^v1\./)
      assert.equal(row.data.includes('cursor'), false)
    } finally {
      raw.close()
    }

    const r2 = await run('ag-state', 2)
    assert.equal(r2.status, 'error', JSON.stringify(r2))
    assert.match(firstText(reqs()[3]!), new RegExp(`Last successful run: ${new Date(r1.startedAt).toISOString().replace(/\./g, '\\.')} \\(`))
    assert.match(toolResults(reqs()[4]!)[0]!.content, /\{"cursor":"c1"\}/)
    assert.ok(r2.steps.some((s: any) => s.label === 'The run did not finish: the previous state stays.'), JSON.stringify(r2.steps))

    const r3 = await run('ag-state', 3)
    assert.equal(r3.status, 'ok', JSON.stringify(r3))
    // the failed run does not count: the last successful one is still run 1
    assert.match(firstText(reqs()[5]!), new RegExp(`Last successful run: ${new Date(r1.startedAt).toISOString().replace(/\./g, '\\.')} \\(`))
    const [get3, set3] = toolResults(reqs()[6]!)
    assert.match(get3!.content, /\{"cursor":"c1"\}/)
    assert.equal(set3!.is_error, true)
    assert.match(set3!.content, /The state is too large/)
    assert.equal(r3.steps.some((s: any) => /State saved/.test(s.label)), false)
  })

  test('the stored definition keeps the sanitised allow-list', async () => {
    const def = meta.doc.getMap('agents').get('ag-allow') as Record<string, unknown>
    assert.ok(def && !(def instanceof Y.AbstractType))
    // what a client wrote is read with the server's own rules (sanitize.ts)
    assert.deepEqual(sanitizeAgent('ag-allow', def)?.mcpTools, { tracker: ['list_items', 'get_item'], wiki: [] })
    assert.equal(sanitizeAgent('ag-all', meta.doc.getMap('agents').get('ag-all'))?.mcpTools, undefined)
  })
})
