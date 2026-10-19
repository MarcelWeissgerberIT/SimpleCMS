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
import { cleanupAll, tempDir } from './worker-helpers.ts'

after(cleanupAll)
test('external MCP tools cooperate in one task; namespaced calls, auth redaction and read-only policy hold', async () => {
  const secret = 'test-mcp-private-token-not-model-context'
  const calls: string[] = []
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`)
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const mcp = new McpServer({ name: 'atlas-fixture', version: '1' })
    mcp.registerTool('atlas_get', { description: 'Fetch a record', inputSchema: { ref: z.number() } }, async ({ ref }) => {
      calls.push(`get:${ref}`); return { content: [{ type: 'text', text: `Record ${ref}: implement local task. ${secret}` }] }
    })
    mcp.registerTool('atlas_create', { description: 'Create a record', inputSchema: { title: z.string() } }, async () => {
      calls.push('create'); return { content: [{ type: 'text', text: 'Created' }] }
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
  const connection = { type: 'http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, headers: { Authorization: 'Bearer ${ATLAS_TEST_TOKEN}' } }
  await writeFile(config, JSON.stringify({ mcpServers: { atlas: connection, docs: { ...connection, oneReadOnlyTools: ['atlas_get'] } } }))
  const env = { ...process.env, ONE_CODER_MCP_CONFIG: config, ATLAS_TEST_TOKEN: secret }
  const readOnly = new LocalMcp(true)
  let ollama: ReturnType<typeof createServer> | null = null
  try {
    await readOnly.connect(['atlas', 'docs'], env, AbortSignal.timeout(10000))
    assert.equal(readOnly.search('atlas_get')[0]?.name, 'atlas_get')
    assert.equal(readOnly.search('atlas_create').length, 0)
    assert.ok(readOnly.search('docs atlas_get').some(t => t.server === 'docs' && t.readOnly))
    await assert.rejects(readOnly.call('atlas', 'atlas_create', { title: 'no' }, new AbortController().signal))
    assert.ok(!(await readOnly.call('atlas', 'atlas_get', { ref: 42 }, new AbortController().signal)).includes(secret))
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
  } finally {
    await readOnly.close()
    await Promise.all([server, ...(ollama ? [ollama] : [])].map(s => new Promise<void>(r => s.close(() => r()))))
  }
})
