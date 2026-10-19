import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { coderServer } from '../src/local-coder/server.ts'

let key = 'a-test-only-key-with-at-least-32-characters'
const origin = 'http://localhost:5173'
const upstreamCalls: Array<Record<string, any>> = []
const upstream = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/ps' || req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-coder:latest' }] }))
  let raw = ''
  for await (const c of req) raw += c
  upstreamCalls.push(JSON.parse(raw))
  res.end(JSON.stringify({ message: { content: 'def add(a, b):\n    return a + b' } }))
})
let base: string
let active: ReturnType<typeof coderServer>
const listen = (s: ReturnType<typeof createServer>) => new Promise<number>(resolve => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)))
before(async () => {
  const port = await listen(upstream)
  active = coderServer({ key: () => key, origins: [origin], model: 'test-coder', ollama: `http://127.0.0.1:${port}` })
  base = `http://127.0.0.1:${await listen(active)}/mcp`
})
after(async () => {
  await Promise.all([upstream, active].map(s => new Promise<void>(resolve => s.close(() => resolve()))))
})
const post = (authorization?: string, customOrigin?: string, body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) => fetch(base, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(authorization ? { Authorization: authorization } : {}), ...(customOrigin ? { Origin: customOrigin } : {}) }, body,
})

test('missing and incorrect keys cannot list tools or reach Ollama', async () => {
  const before = upstreamCalls.length
  assert.equal((await post()).status, 401)
  assert.equal((await post('Bearer wrong-key', origin)).status, 401)
  assert.equal(upstreamCalls.length, before)
})
test('untrusted origins are blocked even with the key; valid preflight permits Authorization', async () => {
  assert.equal((await post(`Bearer ${key}`, 'https://untrusted.example')).status, 403)
  assert.equal((await post(`Bearer ${key}`, 'null')).status, 403)
  const preflight = await fetch(base, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Headers': 'authorization,content-type' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.match(preflight.headers.get('access-control-allow-headers')!, /Authorization/)
})
test('real MCP handshake, tool listing, status and coding task round trip', async () => {
  const client = new Client({ name: 'test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${key}`, Origin: origin } } }))
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['coding_status', 'coding_task'])
    const status = await client.callTool({ name: 'coding_status', arguments: {} })
    assert.equal(status.isError, false)
    const result = await client.callTool({ name: 'coding_task', arguments: { task: 'Implement add', context: 'Python', max_tokens: 128 } })
    assert.equal(result.isError, false)
    assert.match(JSON.stringify(result.content), /return a \+ b/)
    assert.equal(upstreamCalls.at(-1)?.model, 'test-coder')
    assert.equal(upstreamCalls.at(-1)?.messages[1].content, 'Implement add\n\nProject context:\nPython')
    const invalid = await client.callTool({ name: 'coding_task', arguments: { task: '', max_tokens: 99999 } })
    assert.equal(invalid.isError, true)
  } finally { await client.close() }
})
test('rotation revokes the old key immediately, and oversized/invalid input is rejected', async () => {
  const old = key
  key = 'a-rotated-test-only-key-with-at-least-32-characters'
  assert.equal((await post(`Bearer ${old}`)).status, 401)
  assert.equal((await post(`Bearer ${key}`)).status, 200)
  assert.equal((await post(`Bearer ${key}`, undefined, '{')).status, 400)
  assert.equal((await post(`Bearer ${key}`, undefined, 'x'.repeat(530000))).status, 413)
})
test('upstream URLs must remain loopback without credentials', () => {
  assert.throws(() => coderServer({ key: () => key, origins: [], model: 'coder', ollama: 'https://external.example' }))
  assert.throws(() => coderServer({ key: () => key, origins: [], model: 'coder', ollama: 'http://key@localhost' }))
})
