import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { LocalMcp } from '../src/worker/local-mcp.ts'
import { runLocal } from '../src/worker/local-agent.ts'
import { MemoryOAuth } from '../src/worker/local-memory-oauth.ts'
import { cleanupAll, tempDir } from './worker-helpers.ts'

after(cleanupAll)
const agentTools = ['atlas_agent_list', 'atlas_agent_create', 'atlas_agent_update', 'atlas_agent_block', 'atlas_agent_revoke', 'atlas_agent_token', 'atlas_agent_token_revoke']
test('external MCP tools cooperate in one task; namespaced calls, auth redaction and read-only policy hold', async () => {
  const secret = 'test-mcp-private-token-not-model-context'
  const calls: string[] = []
  let memoryFails = false
  let shadowEnabled = true
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`)
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const mcp = new McpServer({ name: 'atlas-fixture', version: '1' })
    mcp.registerTool('atlas_whoami', { annotations: { readOnlyHint: true }, inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ shadowScope: shadowEnabled ? 'fixture-owner' : null }) }] }))
    mcp.registerTool('atlas_tenant_select', { inputSchema: { tenant: z.string() } }, async ({ tenant }) => {
      assert.equal(tenant, 'fixture-tenant'); calls.push('memory-tenant'); return { content: [{ type: 'text', text: '{}' }] }
    })
    mcp.registerTool('atlas_context', { annotations: { readOnlyHint: true }, inputSchema: { ref: z.number(), budgetTokens: z.number(), limit: z.number() } }, async ({ ref, budgetTokens }) => {
      assert.equal(budgetTokens, 1800); return { content: [{ type: 'text', text: `Scoped memory ${ref} ${secret}` }] }
    })
    mcp.registerTool('atlas_get', { description: 'Fetch a record', inputSchema: { ref: z.number() } }, async ({ ref }) => {
      calls.push(`get:${ref}`); return { content: [{ type: 'text', text: `Record ${ref}: implement local task. ${secret}` }] }
    })
    mcp.registerTool('atlas_create', { description: 'Create a record', inputSchema: { title: z.string() } }, async () => {
      calls.push('create'); return { content: [{ type: 'text', text: 'Created' }] }
    })
    mcp.registerTool('atlas_memory_save', { inputSchema: { project: z.string(), title: z.string(), body: z.string(), scope: z.literal('private'), memoryType: z.literal('project'), confidence: z.literal('observed'), sourceNote: z.string() } }, async args => {
      calls.push('memory-save')
      assert.equal(args.project, 'fixture-project')
      assert.ok(!args.body.includes(secret))
      return memoryFails ? { isError: true, content: [{ type: 'text', text: 'Shadow permission missing' }] } : { content: [{ type: 'text', text: JSON.stringify({ ref: 700 }) }] }
    })
    mcp.registerTool('atlas_large', { annotations: { readOnlyHint: true }, inputSchema: {} }, async () => ({ content: [{ type: 'text', text: '\n"'.repeat(20000) }] }))
    for (const name of agentTools) mcp.registerTool(name, { description: name, inputSchema: {} }, async () => {
      calls.push(name); return { content: [{ type: 'text', text: '[]' }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void mcp.close() })
    let body = ''; for await (const c of req) body += c
    await mcp.connect(transport)
    await transport.handleRequest(req, res, JSON.parse(body))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const root = tempDir('local-mcp')
  const config = join(root, 'mcp.json')
  const connection = { type: 'http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, headers: { Authorization: 'Bearer ${ATLAS_TEST_TOKEN}' }, oneMemoryProjects: { fixture: 'fixture-project' } }
  const oauthFile = join(root, 'oauth.json')
  const oauth = new MemoryOAuth(oauthFile)
  oauth.setRedirect('http://127.0.0.1/callback')
  await oauth.saveTokens({ access_token: secret, token_type: 'Bearer' })
  await writeFile(config, JSON.stringify({ mcpServers: { atlas: connection, docs: { ...connection, oneReadOnlyTools: ['atlas_get'] }, 'atlas-memory': { type: 'http', url: connection.url, oneOAuthFile: oauthFile, oneMemoryProjects: { isolated: 'fixture-project' }, oneTaskMemoryOnly: true, oneMemoryTenant: 'fixture-tenant', oneAllowedTools: ['atlas_context', 'atlas_whoami', 'atlas_memory_save'] } } }))
  const env = { ...process.env, ONE_CODER_MCP_CONFIG: config, ATLAS_TEST_TOKEN: secret }
  const readOnly = new LocalMcp(true)
  let ollama: ReturnType<typeof createServer> | null = null
  try {
    await readOnly.connect(['atlas', 'docs'], env, AbortSignal.timeout(10000))
    assert.equal(readOnly.search('atlas_get')[0]?.name, 'atlas_get')
    assert.equal(readOnly.search('atlas_create').length, 0)
    assert.equal(readOnly.search('atlas_agent_list').find(t => t.name === 'atlas_agent_list')?.readOnly, true)
    await readOnly.call('atlas', 'atlas_agent_list', {}, new AbortController().signal)
    for (const name of agentTools.slice(1)) {
      assert.ok(!readOnly.search(name).some(t => t.name === name))
      await assert.rejects(readOnly.call('atlas', name, {}, new AbortController().signal))
    }
    assert.ok(readOnly.search('docs atlas_get').some(t => t.server === 'docs' && t.readOnly))
    await assert.rejects(readOnly.call('atlas', 'atlas_create', { title: 'no' }, new AbortController().signal))
    assert.ok(!(await readOnly.call('atlas', 'atlas_get', { ref: 42 }, new AbortController().signal)).includes(secret))
    const large = await readOnly.call('atlas', 'atlas_large', {}, new AbortController().signal)
    assert.ok(large.length <= 20000)
    assert.equal(JSON.parse(large).oneOutputShortened, true)
    assert.equal(readOnly.memoryProject('fixture'), null)
    const responses = [
      { function: { name: 'mcp_search_tools', arguments: { query: 'atlas_get' } } },
      { function: { name: 'mcp_call_tool', arguments: { server: 'atlas', name: 'atlas_get', arguments: { ref: 43 } } } },
      { function: { name: 'mcp_search_tools', arguments: { query: 'docs atlas_get' } } },
      { function: { name: 'mcp_call_tool', arguments: { server: 'docs', name: 'atlas_get', arguments: { ref: 44 } } } },
      { function: { name: 'write_file', arguments: { path: 'feature.txt', content: 'Implemented from Atlas context.' } } },
    ]
    const bodies: any[] = []
    ollama = createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c
      bodies.push(JSON.parse(raw))
      const call = responses.shift()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ message: call ? { role: 'assistant', content: '', tool_calls: [call] } : { role: 'assistant', content: 'Atlas context read and feature implemented.' } }))
    })
    await new Promise<void>(r => ollama!.listen(0, '127.0.0.1', r))
    const outcome = await runLocal({ agent: 'local', cwd: root, prompt: 'Use Atlas record 43 and implement.', readOnly: false, maxSteps: 8, taskMcp: null, mcpServers: ['atlas', 'docs'], signal: new AbortController().signal, log: () => {}, env: { ...env, ONE_CODER_OLLAMA: `http://127.0.0.1:${(ollama.address() as { port: number }).port}` } })
    assert.equal(outcome.ok, true, outcome.error)
    assert.ok(calls.includes('get:43'))
    assert.ok(calls.includes('get:44'))
    assert.ok(!calls.includes('create'))
    assert.ok(JSON.stringify(bodies).includes('Record 43'))
    assert.ok(!JSON.stringify(bodies).includes(secret))
    assert.ok(!calls.some(name => agentTools.slice(1).includes(name)))
    const implementation = new LocalMcp(false)
    try {
      await implementation.connect(['atlas'], env, AbortSignal.timeout(10000))
      for (const name of agentTools) assert.ok(implementation.search(name).some(t => t.name === name), name)
      assert.equal(implementation.memoryProject('fixture'), 'fixture-project')
    } finally { await implementation.close() }
    const oauthConnector = new LocalMcp(false)
    try {
      await oauthConnector.connect(['atlas-memory'], env, AbortSignal.timeout(10000))
      assert.deepEqual(oauthConnector.memoryTarget('isolated'), { server: 'atlas-memory', project: 'fixture-project' })
      assert.equal(await oauthConnector.shadowAccess('atlas-memory', new AbortController().signal), true)
      assert.equal(oauthConnector.search('atlas-memory').length, 0)
      await assert.rejects(oauthConnector.call('atlas-memory', 'atlas_memory_save', {}, new AbortController().signal), /reserved/)
      assert.ok(!(await oauthConnector.memoryContext('atlas-memory', 99, new AbortController().signal)).includes(secret))
      assert.ok(calls.includes('memory-tenant'))
    } finally { await oauthConnector.close() }
    // An explicit Continue cannot replay the same external mutation, even after changing models.
    const memory = { directory: join(root, 'private-memory'), scope: 'remote-task', resume: false, projectKey: 'fixture' }
    const create = { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'mcp_call_tool', arguments: { server: 'atlas', name: 'atlas_create', arguments: { title: 'One requested record' } } } }] } }
    const run = { agent: 'local' as const, cwd: root, prompt: 'Create the requested record.', readOnly: false, maxSteps: 1, taskMcp: null, mcpServers: ['atlas'], signal: new AbortController().signal, log: () => {}, env }
    const stopped = await runLocal({ ...run, memory, inference: async () => create })
    assert.equal(stopped.limited, true)
    assert.equal(calls.filter(x => x === 'create').length, 1)
    let n = 0
    const resumed = await runLocal({ ...run, maxSteps: 4, memory: { ...memory, resume: true }, env: { ...env, ONE_CODER_MODEL: 'another-local-model' }, inference: async () => n++ === 0 ? create : { message: { role: 'assistant', content: 'Already created.' } } })
    assert.equal(resumed.ok, true, resumed.error)
    assert.equal(calls.filter(x => x === 'create').length, 1)
    assert.match(resumed.text, /Private Atlas checkpoint: \/r\/700/)
    memoryFails = true
    const before = calls.filter(x => x === 'memory-save').length
    const offline = await runLocal({ ...run, maxSteps: 4, memory: { ...memory, scope: 'offline' }, inference: async () => ({ message: { role: 'assistant', content: 'Local work complete.' } }) })
    assert.equal(offline.ok, true, offline.error)
    assert.match(offline.text, /Atlas checkpoint unavailable/)
    assert.equal(calls.filter(x => x === 'memory-save').length, before + 1)
    shadowEnabled = false
    const shadowMissing = await runLocal({ ...run, maxSteps: 4, memory: { ...memory, scope: 'no-shadow' }, inference: async () => ({ message: { role: 'assistant', content: 'Local result.' } }) })
    assert.equal(shadowMissing.ok, true, shadowMissing.error)
    assert.match(shadowMissing.text, /shadow memory is not active/)
    assert.equal(calls.filter(x => x === 'memory-save').length, before + 1)
    const readOnlyRun = await runLocal({ ...run, readOnly: true, memory: { ...memory, scope: 'read-only' }, inference: async () => ({ message: { role: 'assistant', content: 'Read-only proposal.' } }) })
    assert.equal(readOnlyRun.ok, true, readOnlyRun.error)
    assert.equal(calls.filter(x => x === 'memory-save').length, before + 1)
  } finally {
    await readOnly.close()
    await Promise.all([server, ...(ollama ? [ollama] : [])].map(s => new Promise<void>(r => s.close(() => r()))))
  }
})
