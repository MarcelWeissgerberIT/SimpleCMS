/**
 * Remote MCP endpoint (docs/MCP.md § Team server): `POST /mcp`, the Streamable HTTP transport in
 * stateless mode with JSON answers — every request carries the API token and gets a fresh server
 * bound to that token's workspace, so any instance (and any reverse proxy) can answer it.
 *
 * - Auth: `Authorization: Bearer one_…` exactly like /api/v1 (same tokens, rate limit and failed-auth
 *   limit); the session cookie is never read here.
 * - GET (a server → client event stream) and DELETE (ending a session) are 405: there are no
 *   sessions and nothing the server sends on its own.
 * - No CORS: MCP clients are programs, not web pages. A request with an `Origin` other than this
 *   server's own is refused (the transport spec's DNS-rebinding rule).
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { bearer } from '../api/auth.ts'
import type { WorkspaceModel } from '../api/model.ts'
import type { AppEnv, Services } from '../context.ts'
import { LOCKED_CSP, isSameOrigin } from '../http/security.ts'
import { buildMcpServer } from './tools.ts'
import { MCP_LIMITS } from '../../../src/shared/mcp/tables.ts'
import { mcpError } from '../../../src/shared/mcp/errors.ts'

export const MCP_PATH = '/mcp'

/**
 * Request bodies per token (spec § 3.6): a read token's calls are small (256 KB), a write token's may carry a batch of
 * pages or rows (512 KB — MCP_LIMITS.bodyWrite). A call over its limit (and under BODY_READ_MAX) is answered as the
 * contract's tool refusal `too_large` — never a bare transport error a model cannot branch on.
 */
export const MCP_BODY_LIMIT = MCP_LIMITS.bodyRead
const bodyLimit = (scope: string) => (scope === 'write' ? MCP_LIMITS.bodyWrite : MCP_LIMITS.bodyRead)
/** The most this server reads of one request at all (beyond it: the transport's 413, nothing parsed). */
const BODY_READ_MAX = 4 * MCP_LIMITS.bodyWrite

const rpcError = (status: 400 | 403 | 405 | 413, message: string, headers: Record<string, string> = {}, code = -32000) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

/** A request body as text, read up to `max` bytes (null: more than that — a declared length too). */
async function readBody(req: Request, max: number): Promise<{ text: string; bytes: number } | null> {
  if (Number(req.headers.get('content-length')) > max) return null
  if (!req.body) return { text: '', bytes: 0 }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > max) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), bytes }
}

/**
 * A tool call over this token's body limit, answered as the call's refusal in the contract's shape (`too_large`, nothing
 * changed, split it) — as the result of its JSON-RPC request, so the client gets a tool error with a code. Anything else
 * that is too large (no single tools/call request): null — the transport's 413.
 */
function tooLarge(msg: unknown, bytes: number, limit: number): Response | null {
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown } } | null
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.method !== 'tools/call' || (typeof m.id !== 'string' && typeof m.id !== 'number')) return null
  const kb = (n: number) => Math.ceil(n / 1024).toLocaleString('en')
  const text = mcpError('too_large', '', `The request is ${kb(bytes)} KB (at most ${kb(limit)} KB per request on this team server)`, 'Split it into smaller calls.')
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }], isError: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

export function mcpRoutes(s: Services, model: WorkspaceModel) {
  const app = new Hono<AppEnv>()

  // only /mcp itself: /mcp/one-mcp.mjs (the local bridge, from the app build) stays a static file
  app.use('/', async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
    c.res.headers.set('Content-Security-Policy', LOCKED_CSP)
  })

  app.use('/', async (c, next) => {
    if (!isSameOrigin(c.req.header('origin'), c.req.header('host'), s.config.publicUrl)) return rpcError(403, 'Cross-origin requests are not accepted')
    await next()
  })

  app.on(['GET', 'DELETE'], '/', () => rpcError(405, 'This MCP endpoint is stateless: POST JSON-RPC messages to it', { Allow: 'POST' }))

  app.post('/', bearer(s), async (c) => {
    const token = c.get('token')
    const limit = bodyLimit(token.scope)
    // the body, read once with the limit (streamed — a declared length over the hard cap is refused unread)
    const body = await readBody(c.req.raw, BODY_READ_MAX)
    if (body === null) return rpcError(413, `Payload Too Large: Request body must not exceed ${BODY_READ_MAX} bytes`)
    let parsed: unknown
    try {
      parsed = JSON.parse(body.text)
    } catch {
      return rpcError(400, 'Parse error: Invalid JSON', {}, -32700)
    }
    if (body.bytes > limit) return tooLarge(parsed, body.bytes, limit) ?? rpcError(413, `Payload Too Large: Request body must not exceed ${limit} bytes`)
    const server = buildMcpServer(s, model, token)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: limit })
    server.server.onerror = (err) => s.log.debug('mcp transport', { error: err.message })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw, { parsedBody: parsed })
    } finally {
      // the JSON answer is complete here (enableJsonResponse): nothing outlives the request
      void server.close().catch(() => {})
    }
  })

  app.all('/', () => rpcError(405, 'Method not allowed', { Allow: 'POST' }))

  return app
}
