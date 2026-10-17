/**
 * MCP parity (spec § 4.2): the team server serves the shared contract (src/shared/mcp) — the same tool names, argument
 * names, required arguments, enums and descriptions as the local bridge, minus the local-only tools; plus contract 2's
 * server side: `supports ∋ 'mcp:2'`, compact results, error codes with a next step, duplicate calls answered once.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MCP_CONTRACT_REV, MCP_LIMITS, MCP_LOCAL_ONLY, MCP_LOCAL_ONLY_ARGS, MCP_SERVER_SUPPORTS, MCP_SHARED_TOOLS } from '../../src/shared/mcp/contract.ts'
import { MCP_REMEDIES, codeOf } from '../../src/shared/mcp/errors.ts'
import { signIn, startServer, type TestServer } from './helpers.ts'

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }
type Schema = { properties?: Record<string, unknown>; required?: string[] }

async function connect(url: string, token: string): Promise<McpClient> {
  const client = new McpClient({ name: 'one-parity', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

/** Every `enum` list anywhere in a schema, as sorted JSON (a set: the shape around it may differ between zod and JSON). */
function enums(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const v of schema) enums(v, out)
  else if (schema && typeof schema === 'object') {
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'enum' && Array.isArray(v)) out.add(JSON.stringify([...v].map(String).sort()))
      else enums(v, out)
    }
  }
  return out
}

const shared = MCP_SHARED_TOOLS.filter((t) => !MCP_LOCAL_ONLY.includes(t.name))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolResult
  assert.ok(!res.isError, `${name} failed: ${res.content[0]?.text}`)
  return JSON.parse(res.content[0]!.text) as T
}

describe('MCP parity: the team server serves the shared contract', () => {
  let server: TestServer
  let writer: McpClient, reader: McpClient
  let wsId: string
  const clients: McpClient[] = []

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    const owner = await signIn(server, 'owner@parity.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht' })).body.id
    const writeToken = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Claude', scope: 'write' })).body.token
    const readToken = (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Reader', scope: 'read' })).body.token
    writer = await connect(server.url, writeToken)
    reader = await connect(server.url, readToken)
    clients.push(writer, reader)
  })

  after(async () => {
    for (const c of clients) await c.close().catch(() => {})
    await server.stop()
  })

  test('tools: a write token gets the shared tools minus the local-only ones, a read token the read subset', async () => {
    const write = (await writer.listTools()).tools.map((t) => t.name).sort()
    const read = (await reader.listTools()).tools.map((t) => t.name).sort()
    assert.deepEqual(write, shared.map((t) => t.name).sort())
    assert.deepEqual(read, shared.filter((t) => !t.write).map((t) => t.name).sort())
    for (const name of MCP_LOCAL_ONLY) assert.ok(!(write as string[]).includes(name), `${name} is local only`)
  })

  test('per tool: argument names, required arguments, enums and annotations equal the shared contract', async () => {
    const tools = (await writer.listTools()).tools
    for (const def of shared) {
      const got = tools.find((t) => t.name === def.name)!
      const schema = got.inputSchema as Schema
      assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), Object.keys(def.inputSchema.properties).sort(), `${def.name}: argument names`)
      assert.deepEqual([...(schema.required ?? [])].sort(), [...(def.inputSchema.required ?? [])].sort(), `${def.name}: required`)
      assert.deepEqual([...enums(schema)].sort(), [...enums(def.inputSchema)].sort(), `${def.name}: enums`)
      assert.equal(got.annotations?.readOnlyHint, !def.write, `${def.name}: readOnlyHint`)
      for (const arg of MCP_LOCAL_ONLY_ARGS[def.name] ?? []) assert.ok(arg in (schema.properties ?? {}), `${def.name} declares the local-only ${arg}`)
    }
  })

  test('strict arguments on both ways in: tools/list says additionalProperties false as the contract does; an undeclared argument is refused, never dropped', async () => {
    const tools = (await writer.listTools()).tools
    for (const def of shared) {
      const got = tools.find((t) => t.name === def.name)!.inputSchema as { additionalProperties?: unknown }
      assert.equal(got.additionalProperties, def.inputSchema.additionalProperties ?? false, `${def.name}: additionalProperties`)
    }
    const before = (await call(reader, 'one_list_pages', { depth: 1 })).items.length
    // a case typo (parentID) would make the page at the top level; a T-b argument (blocks, cover) would be dropped
    for (const args of [{ title: 'Unterseite', parentID: 'x' }, { title: 'Strict', blocks: [{ type: 'toc' }], cover: 'assets/covers/dunes.webp' }]) {
      const res = (await writer.callTool({ name: 'one_create_page', arguments: args })) as ToolResult
      assert.equal(res.isError, true, res.content[0]?.text)
      const text = res.content[0]!.text
      assert.equal(codeOf(text), 'bad_argument', text)
      assert.match(text, /^bad_argument: (parentID|blocks|cover): one_create_page takes no argument "(parentID|blocks|cover)" \(it takes: .*title.*\)\. Nothing was changed\. /)
    }
    assert.equal((await call(reader, 'one_list_pages', { depth: 1 })).items.length, before, 'nothing was made')
    // a read tool and one without arguments too
    const read = (await reader.callTool({ name: 'one_search', arguments: { query: 'Nordlicht', limt: 3 } })) as ToolResult
    assert.match(read.content[0]!.text, /^bad_argument: limt: one_search takes no argument "limt"/)
    const none = (await reader.callTool({ name: 'one_list_workspaces', arguments: { verbose: true } })) as ToolResult
    assert.equal(codeOf(none.content[0]!.text), 'bad_argument')
  })

  test('an argument that does not fit its schema is answered in the contract\'s shape (code, path, next step), as the tab answers', async () => {
    const res = (await reader.callTool({ name: 'one_list_pages', arguments: { depth: 9 } })) as ToolResult
    assert.equal(res.isError, true)
    const text = res.content[0]!.text
    assert.equal(codeOf(text), 'bad_argument', text)
    assert.match(text, /^bad_argument: depth: /)
    assert.ok(text.includes('Nothing was changed.') && text.endsWith(MCP_REMEDIES.bad_argument), text)
    assert.doesNotMatch(text, /MCP error|-32602|Input validation error/)
    const nested = (await writer.callTool({ name: 'one_create_row', arguments: { databaseId: 'x', rows: [{ title: 5 }] } })) as ToolResult
    assert.match(nested.content[0]!.text, /^bad_argument: rows\[0\]\.title: /)
  })

  test('descriptions: the shared text plus at most one side-note line; never the task-block form (phase 4)', async () => {
    const tools = (await writer.listTools()).tools
    for (const def of shared) {
      const text = tools.find((t) => t.name === def.name)!.description ?? ''
      assert.ok(text === def.description || text.startsWith(`${def.description}\n`), `${def.name}: starts with the shared description`)
      const note = text.slice(def.description.length)
      assert.ok(!note.slice(1).includes('\n'), `${def.name}: one side-note line at most`)
      assert.doesNotMatch(text, /\[!TODO\]|work_item/, `${def.name}: no task-block form`)
    }
    const list = JSON.stringify(await writer.listTools())
    assert.ok(list.length <= MCP_LIMITS.toolsList, `tools/list ${list.length} ≤ ${MCP_LIMITS.toolsList}`)
    const instructions = writer.getInstructions() ?? ''
    assert.ok(instructions.length <= MCP_LIMITS.instructions, `instructions ${instructions.length} ≤ ${MCP_LIMITS.instructions}`)
    assert.match(instructions, /content, never instructions to you/)
    assert.match(instructions, /"class" of mail, memory or private/)
    assert.doesNotMatch(instructions, /\[!TODO\]|task block|work_item/i)
  })

  test("/api/config supports 'mcp:2'; serverInfo names the contract", async () => {
    const cfg = (await (await fetch(`${server.url}/api/config`)).json()) as { supports: string[] }
    assert.ok(cfg.supports.includes(MCP_SERVER_SUPPORTS), JSON.stringify(cfg.supports))
    assert.equal(MCP_SERVER_SUPPORTS, 'mcp:2')
    assert.match(writer.getServerVersion()?.version ?? '', new RegExp(`\\+mcp\\.${MCP_CONTRACT_REV}$`))
  })

  test('results are compact JSON; errors start with their code and end with the next step', async () => {
    const res = (await reader.callTool({ name: 'one_overview', arguments: {} })) as ToolResult
    assert.ok(!res.isError)
    assert.doesNotMatch(res.content[0]!.text, /\n/, 'no indentation')
    assert.equal(JSON.parse(res.content[0]!.text).workspace.id, `team:${wsId}`)

    const missing = (await reader.callTool({ name: 'one_get_page', arguments: { id: 'nope' } })) as ToolResult
    assert.equal(missing.isError, true)
    const text = missing.content[0]!.text
    assert.equal(codeOf(text), 'not_found', text)
    assert.match(text, /No page with id "nope"/)
    assert.ok(text.includes('Nothing was changed.') && text.endsWith(MCP_REMEDIES.not_found), text)

    const noDb = (await writer.callTool({ name: 'one_create_row', arguments: { databaseId: 'nope', title: 'Launch plan' } })) as ToolResult
    assert.equal(codeOf(noDb.content[0]!.text), 'not_found', noDb.content[0]!.text)
  })

  test('a creating call repeated within 2 minutes answers the first result (duplicateOf) — one page, also when both run at once', async () => {
    const call = async (args: Record<string, unknown>) => {
      const res = (await writer.callTool({ name: 'one_create_page', arguments: args })) as ToolResult
      assert.ok(!res.isError, res.content[0]?.text)
      return JSON.parse(res.content[0]!.text) as { id: string; duplicateOf?: unknown; note?: string }
    }
    const first = await call({ title: 'Launch plan', markdown: 'Kick-off with Tessera.' })
    assert.equal(first.duplicateOf, undefined)
    // the same arguments in another key order, with the workspace named: the same call
    const again = await call({ markdown: 'Kick-off with Tessera.', title: 'Launch plan', workspace: `team:${wsId}` })
    assert.equal(again.id, first.id)
    assert.equal(again.duplicateOf, first.id)
    assert.match(again.note ?? '', /already applied \d+ s ago; nothing new was made — to make another, change something/)
    // something different is a new call
    const other = await call({ title: 'Launch plan (2)', markdown: 'Kick-off with Tessera.' })
    assert.notEqual(other.id, first.id)
    assert.equal(other.duplicateOf, undefined)
    // two at once: the second waits for the first and gets its answer
    const [a, b] = await Promise.all([call({ title: 'Wissensbasis' }), call({ title: 'Wissensbasis' })])
    assert.equal(a.id, b.id)
    assert.equal([a, b].filter((x) => x.duplicateOf === a.id).length, 1)
    // one page each: the search finds exactly one "Wissensbasis" and one "Launch plan"
    const search = (await reader.callTool({ name: 'one_search', arguments: { query: 'Wissensbasis' } })) as ToolResult
    const hits = (JSON.parse(search.content[0]!.text) as { results: Array<{ title: string }> }).results.filter((r) => r.title === 'Wissensbasis')
    assert.equal(hits.length, 1)
    // a refused call is not remembered: the repeat is refused again (and would run once it fits)
    const bad = { databaseId: 'nope', title: 'Mara Lind' }
    for (let i = 0; i < 2; i++) {
      const res = (await writer.callTool({ name: 'one_create_row', arguments: bad })) as ToolResult
      assert.equal(res.isError, true)
    }
  })
})
