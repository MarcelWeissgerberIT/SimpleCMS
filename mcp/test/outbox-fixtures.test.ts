/**
 * The Outbox's shared fixtures and vectors (slice 1b; slice 2's dispatch tests build on them):
 *  - canonicalJson + SHA-256: the same fixed vectors as tests/e2e/outbox-engine.spec.ts — tab and worker hash the
 *    same bytes;
 *  - the mock MCP server (tests/fixtures/mock-mcp.mjs): the real SDK over Streamable HTTP, tools with annotations,
 *    the recorder (authSha256, never the token), the control endpoints.
 * Fictional data only; nothing leaves 127.0.0.1.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { canonicalJson } from '../../src/app/features/coding/protocol.ts'
// @ts-expect-error — a plain .mjs fixture without types
import { startMockMcp } from '../../tests/fixtures/mock-mcp.mjs'

const VECTORS: Array<[unknown, string, string]> = [
  [{ b: 1, a: [true, null, 'x'] }, '{"a":[true,null,"x"],"b":1}', '54a65415ad370228851a1da4b31b6fd42dc58b19a50d35cae759325f7388ce64'],
  [{ é: '‮', z: 'a"b\n' }, '{"z":"a\\"b\\n","é":"‮"}', '447d88b8dd18229e860bdc8ab04b98e14c6577b99e63c4c4dcdaa30918023d77'],
  [{ a: undefined, c: { y: 2, x: [1, { k: 'v' }] } }, '{"c":{"x":[1,{"k":"v"}],"y":2}}', '35ef94395a80b82310a8fb8059bf3f1da0a0e7d18ddca50f5d64b7b00e38524e'],
  [{ n: 1e21, m: -0, f: 1.5, s: '' }, '{"f":1.5,"m":0,"n":1e+21,"s":""}', 'cf7e380a5185b004ec39c0b68176f08c8f1002cf5f0327c7a8f499dd66461f1c'],
  [{ ref: '10668', visibility: 'team', body: '"}, "x": 1' }, '{"body":"\\"}, \\"x\\": 1","ref":"10668","visibility":"team"}', 'ac69218e2c40f83b2cce4b1c48deb75f8e4b3a294deab0b2cec9cfae96d94a23'],
]

test('canonicalJson: the fixed vectors and their SHA-256', () => {
  for (const [v, text, sha] of VECTORS) {
    assert.equal(canonicalJson(v), text)
    assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), sha)
  }
  assert.throws(() => canonicalJson({ x: Infinity }))
})

test('the mock MCP server: tools with annotations, calls recorded with the token hashed, the control endpoints', async () => {
  const mock = await startMockMcp()
  const token = 'tok_fictional_e2e'
  const client = new Client({ name: 'outbox-test', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(mock.url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), ['add_comment', 'get_item', 'list_comments', 'log_work', 'update_item'])
    assert.equal(tools.find((t) => t.name === 'get_item')?.annotations?.readOnlyHint, true)
    assert.equal(tools.find((t) => t.name === 'add_comment')?.annotations?.readOnlyHint, false)

    const item = await client.callTool({ name: 'get_item', arguments: { ref: '10668' } })
    assert.equal((item.structuredContent as { comments: unknown[] }).comments.length, 1)
    const added = await client.callTool({ name: 'add_comment', arguments: { ref: '10668', body: 'Take B6.', visibility: 'team' } })
    assert.deepEqual(added.structuredContent, { id: '88213' })
    const calls = mock.calls()
    assert.deepEqual(
      calls.map((c: { tool: string; args: unknown }) => [c.tool, c.args]),
      [
        ['get_item', { ref: '10668' }],
        ['add_comment', { ref: '10668', body: 'Take B6.', visibility: 'team' }],
      ],
    )
    assert.equal(calls[0].authSha256, createHash('sha256').update(token).digest('hex'))
    assert.ok(!JSON.stringify(calls).includes(token))

    // a foreign comment arrives; an error; reset
    await fetch(`http://127.0.0.1:${mock.port}/__mutate`, { method: 'POST', body: JSON.stringify({ ref: '10668', body: 'It is settled, B7 fits.', by: 'J. Weber' }) })
    const list = await client.callTool({ name: 'list_comments', arguments: { ref: '10668' } })
    assert.equal((list.structuredContent as { items: Array<{ body: string }> }).items.at(-1)?.body, 'It is settled, B7 fits.')
    await fetch(`http://127.0.0.1:${mock.port}/__error?tool=update_item`, { method: 'POST' })
    const failed = await client.callTool({ name: 'update_item', arguments: { ref: '10668', status: 'Done' } })
    assert.equal(failed.isError, true)
    const recorded = (await (await fetch(`http://127.0.0.1:${mock.port}/__calls`)).json()) as unknown[]
    assert.equal(recorded.length, 4)
    await fetch(`http://127.0.0.1:${mock.port}/__reset`, { method: 'POST' })
    assert.equal(mock.calls().length, 0)
    assert.equal(mock.state.items['10668'].comments.length, 1)
  } finally {
    await client.close().catch(() => undefined)
    await mock.close()
  }
})
