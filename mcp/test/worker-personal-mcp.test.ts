import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { PersonalMcp, personalConnections } from '../src/worker/personal-mcp.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { buildPrompt } from '../src/worker/run.ts'
import { task } from './worker-helpers.ts'
const token = 'fixture-personal-token-never-in-model-context'
const entry = { id: 'fixture', name: 'atlas-my-agent', url: 'https://atlas.example.test/mcp', token, tools: ['atlas_get', 'atlas_create'] }
test('handoff refuses malformed credentials and strips executable transports; prompt has no token', () => {
  assert.equal(personalConnections([{ ...entry, url: 'http://127.0.0.1/mcp' }]), null)
  assert.equal(personalConnections([{ ...entry, token: 'header\r\ninjection' }]), null)
  assert.equal(personalConnections([entry, entry]), null)
  assert.equal(personalConnections([{ ...entry, tools: [] }]), null)
  const clean = personalConnections([{ ...entry, command: 'untrusted', env: { BAD: 'value' } }])!
  assert.deepEqual(Object.keys(clean[0]!).sort(), ['id', 'name', 'token', 'tools', 'url'])
  const t = sanitizeTask({ ...task({ kind: 'implement' }), agent: 'claude', personalMcp: clean })!
  assert.ok(t)
  const prompt = buildPrompt(t, { name: 'fixture', claude: { mcpServers: [] } } as any, 'one/fixture')
  assert.ok(!prompt.includes(token));assert.ok(!prompt.includes(entry.url))
  assert.equal(sanitizeTask({ ...task({ kind: 'implement' }), agent: 'codex', personalMcp: clean }), null)
  assert.equal(sanitizeTask({ ...task({ kind: 'implement' }), agent: 'copilot', personalMcp: clean })?.agent, 'copilot')
  assert.equal(sanitizeTask({ ...task({ kind: 'test' }), agent: 'claude', personalMcp: clean }), null)
})
test('proxy enforces auth, allow-list and plan read-only; results redact tokens and close ends access', async t => {
  const calls: string[] = []
  const http = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token)
    if (req.method !== 'POST') { res.writeHead(405);res.end();return }
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    mcp.registerTool('atlas_get', { description: 'Read fixture' }, async () => { calls.push('read');return { content: [{ type: 'text', text: 'record ' + token }] } })
    mcp.registerTool('atlas_create', { description: 'Write fixture' }, async () => { calls.push('write');return { content: [{ type: 'text', text: 'created' }] } })
    mcp.registerTool('atlas_agent_token', {}, async () => { calls.push('forbidden');return { content: [{ type: 'text', text: 'never' }] } })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close();void mcp.close() })
    let body = '';for await (const c of req) body += c
    await mcp.connect(transport);await transport.handleRequest(req, res, JSON.parse(body))
  })
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r))
  const nativeFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));assert.equal(url.origin, 'https://atlas.example.test')
    return nativeFetch(`http://127.0.0.1:${(http.address() as { port: number }).port}${url.pathname}`, init)
  })
  const signal = new AbortController().signal, plan = new PersonalMcp([entry], true), implement = new PersonalMcp([entry], false)
  try {
    await plan.connect(signal)
    assert.deepEqual(plan.client.search('').map(x => x.name), ['atlas_get'])
    const result = await plan.client.call(entry.name, 'atlas_get', {}, signal)
    assert.ok(result.includes('record'));assert.ok(!result.includes(token))
    await assert.rejects(plan.client.call(entry.name, 'atlas_create', {}, signal))
    await implement.connect(signal);await implement.client.call(entry.name, 'atlas_create', {}, signal)
    await assert.rejects(implement.client.call(entry.name, 'atlas_agent_token', {}, signal))
    assert.deepEqual(calls, ['read', 'write'])
    await implement.close();await assert.rejects(implement.client.call(entry.name, 'atlas_get', {}, signal))
  } finally { await plan.close();await implement.close();await new Promise<void>(r => http.close(() => r())) }
})
