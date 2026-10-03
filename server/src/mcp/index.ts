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

export const MCP_PATH = '/mcp'

/** Request bodies, like the public API's. */
export const MCP_BODY_LIMIT = 256 * 1024

const rpcError = (status: 403 | 405, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

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
    const server = buildMcpServer(s, model, c.get('token'))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MCP_BODY_LIMIT })
    server.server.onerror = (err) => s.log.debug('mcp transport', { error: err.message })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      // the JSON answer is complete here (enableJsonResponse): nothing outlives the request
      void server.close().catch(() => {})
    }
  })

  app.all('/', () => rpcError(405, 'Method not allowed', { Allow: 'POST' }))

  return app
}
