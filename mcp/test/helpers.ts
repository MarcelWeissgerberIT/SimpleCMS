/**
 * Test helpers: start the BUILT bridge (public/mcp/one-mcp.mjs — what people download) with the
 * MCP SDK client over stdio, and play the One tab with a plain WebSocket client.
 */
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import WebSocket from 'ws'
import { MCP_SUBPROTOCOL, MCP_SUBPROTOCOL_V1, type AppMessage, type BridgeMessage, type McpWorkspaceInfo } from '../../src/app/features/mcp/contract.ts'

export const BUNDLE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
export const PORT = 47399

export interface Started {
  client: Client
  stderr: () => string
  close: () => Promise<void>
}

/** Start the bridge as an MCP client would (stdio), with extra environment. */
export async function startBridge(env: Record<string, string> = {}, clientName = 'claude-code'): Promise<Started> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '0', ...env },
    stderr: 'pipe',
  })
  let err = ''
  transport.stderr?.on('data', (d: Buffer) => {
    err += d.toString()
  })
  const client = new Client({ name: clientName, version: '1.2.3' })
  await client.connect(transport)
  await waitFor(() => /waiting for One|in use/.test(err), 5000, () => err)
  return { client, stderr: () => err, close: () => client.close() }
}

export async function waitFor(ok: () => boolean, ms = 5000, what: () => string = () => ''): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting${what() ? `: ${what()}` : ''}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

export interface FakeApp {
  ws: WebSocket
  /** the workspace it said hello with (helloApp) */
  workspace: McpWorkspaceInfo | null
  messages: BridgeMessage[]
  closed: { code: number } | null
  send: (msg: AppMessage) => void
  next: (type: BridgeMessage['type'], ms?: number) => Promise<BridgeMessage>
  close: () => void
}

/** Connect like the One tab (Origin + subprotocol); resolves after the open (no hello yet). */
export function connectApp(opts: { origin?: string | null; protocol?: string | null; port?: number; host?: string } = {}): Promise<FakeApp> {
  const headers: Record<string, string> = {}
  if (opts.host) headers.host = opts.host
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? PORT}`, opts.protocol === null ? [] : [opts.protocol ?? MCP_SUBPROTOCOL], {
    ...(opts.origin === null ? {} : { origin: opts.origin ?? 'http://127.0.0.1:4510' }),
    headers,
  })
  const app: FakeApp = {
    ws,
    workspace: null,
    messages: [],
    closed: null,
    send: (msg) => ws.send(JSON.stringify(msg)),
    async next(type, ms = 3000) {
      const seen = app.messages.length
      const start = app.messages.findIndex((m) => m.type === type)
      if (start >= 0) return app.messages.splice(start, 1)[0]!
      await waitFor(() => app.messages.slice(seen).some((m) => m.type === type) || app.messages.some((m) => m.type === type), ms, () => `${type} (got ${JSON.stringify(app.messages)})`)
      const i = app.messages.findIndex((m) => m.type === type)
      return app.messages.splice(i, 1)[0]!
    },
    close: () => ws.close(),
  }
  ws.on('message', (d) => app.messages.push(JSON.parse(d.toString()) as BridgeMessage))
  ws.on('close', (code) => {
    app.closed = { code }
  })
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(app))
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.once('error', reject)
  })
}

/** 'Acme Studio' → 'local:acme-studio' (a v2 tab's id, unless one is given). */
export const idFor = (name: string, kind: 'local' | 'team' = 'local') => `${kind}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'}`

export interface HelloOptions {
  id?: string
  kind?: 'local' | 'team'
  readOnly?: boolean
  /** an older app: subprotocol one-mcp.v1, no workspace id */
  legacy?: boolean
  origin?: string
}

/** Connect and say hello (v2: with a workspace id); resolves with the welcome. */
export async function helloApp(name = 'Test workspace', mode: 'ask' | 'apply' | 'read' = 'ask', opts: HelloOptions = {}): Promise<FakeApp> {
  const app = await connectApp({ protocol: opts.legacy ? MCP_SUBPROTOCOL_V1 : MCP_SUBPROTOCOL, origin: opts.origin })
  const kind = opts.kind ?? 'local'
  const workspace: McpWorkspaceInfo = opts.legacy ? { name, kind, readOnly: !!opts.readOnly } : { id: opts.id ?? idFor(name, kind), name, kind, readOnly: !!opts.readOnly }
  app.workspace = workspace
  app.send({ type: 'hello', app: 'one', version: '1.0', workspace, mode })
  await app.next('welcome')
  return app
}

/**
 * Answer every call with a canned result (or error) per tool. Like the real tab, a v2 app checks the
 * call's workspace and names its own in every (object) result.
 */
export function serve(app: FakeApp, answer: (tool: string, args: Record<string, unknown>, call: Extract<BridgeMessage, { type: 'call' }>) => { result?: unknown; error?: string } | null) {
  const handle = (msg: BridgeMessage) => {
    if (msg.type !== 'call') return
    const ws = app.workspace
    if (ws?.id && msg.workspace !== ws.id) return app.send({ type: 'error', id: msg.id, error: `workspace_mismatch: meant for ${msg.workspace}, this tab shows ${ws.id}` })
    const a = answer(msg.tool, msg.args, msg)
    if (!a) return
    if (a.error !== undefined) app.send({ type: 'error', id: msg.id, error: a.error })
    else {
      const r = a.result
      const stamped = ws?.id && r && typeof r === 'object' && !Array.isArray(r) ? { ...(r as object), workspace: { id: ws.id, name: ws.name } } : r
      app.send({ type: 'result', id: msg.id, result: stamped })
    }
  }
  // calls that arrived before we started serving (right after the welcome)
  for (const msg of app.messages.filter((m) => m.type === 'call')) handle(msg)
  app.ws.on('message', (d) => handle(JSON.parse(d.toString()) as BridgeMessage))
}

export function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}
