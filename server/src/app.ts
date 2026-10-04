import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { agentHookRoutes, agentRoutes } from './agents/routes.ts'
import { AgentService } from './agents/service.ts'
import { hookRoutes } from './api/hooks.ts'
import { WorkspaceModel } from './api/model.ts'
import { apiRoutes } from './api/v1.ts'
import type { AppEnv, Services } from './context.ts'
import { ApiError, notFound } from './errors.ts'
import { csrfGuard, securityHeaders } from './http/security.ts'
import { mountStatic } from './http/static.ts'
import { MCP_PATH, mcpRoutes } from './mcp/index.ts'
import { authRoutes } from './routes/auth.ts'
import { documentRoutes } from './routes/documents.ts'
import { fileRoutes } from './routes/files.ts'
import { integrationRoutes } from './routes/integrations.ts'
import { inviteRoutes } from './routes/invites.ts'
import { meRoutes, sessionRoutes } from './routes/me.ts'
import { serverRoutes, signupRoutes } from './routes/server.ts'
import { workspaceRoutes } from './routes/workspaces.ts'

const JSON_LIMIT = 256 * 1024

/** The public API: bearer tokens / webhook secrets only — never the session cookie (docs/API.md). */
export const PUBLIC_API = '/api/v1/'

/** `extra`: the workspace model and the agent service the server runs (else fresh ones, not started). */
export function buildApp(s: Services, extra: { model?: WorkspaceModel; agents?: AgentService } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const model = extra.model ?? new WorkspaceModel(s)
  const agents = extra.agents ?? new AgentService(s, model)

  app.use('*', securityHeaders(s.config))
  app.use('/api/*', async (c, next) => {
    await next()
    if (!c.res.headers.has('cache-control')) c.res.headers.set('Cache-Control', 'no-store')
  })
  app.use('/api/*', csrfGuard(s.config))
  app.use('/api/*', jsonLimit())
  app.use('/api/*', sessionMiddleware(s))

  app.get('/api/health', (c) => {
    try {
      s.db.get('SELECT 1')
      return c.json({ ok: true, version: s.config.version })
    } catch {
      return c.json({ ok: false, version: s.config.version }, 503)
    }
  })

  // what the sign-in screen and uploader need to know about this server
  app.get('/api/config', (c) =>
    c.json({
      version: s.config.version,
      signup: s.config.signup,
      max_upload_mb: s.config.maxUploadBytes / 1024 / 1024,
      dev_mode: s.config.devMode,
      source_url: s.config.sourceUrl,
    }),
  )

  app.route('/api/auth', authRoutes(s))
  app.route('/api/me', meRoutes(s))
  app.route('/api/session', sessionRoutes(s))
  app.route('/api/workspaces', workspaceRoutes(s))
  app.route('/api/workspaces', fileRoutes(s))
  app.route('/api/workspaces', documentRoutes(s))
  app.route('/api/workspaces', integrationRoutes(s, model))
  app.route('/api/workspaces', agentRoutes(s, model, agents))
  app.route('/api/invites', inviteRoutes(s))
  app.route('/api/signup', signupRoutes(s))
  app.route('/api/server', serverRoutes(s))
  app.route('/api/v1/hooks', hookRoutes(s, model))
  app.route('/api/v1/agents', agentHookRoutes(s, agents))
  app.route('/api/v1', apiRoutes(s, model))

  if (s.config.devMode) {
    app.get('/api/dev/mailbox', (c) => {
      const to = c.req.query('to')?.toLowerCase()
      return c.json(s.mailer.mailbox().filter((m) => !to || m.to === to))
    })
  }

  app.all('/api/*', () => {
    throw notFound('not_found', 'Unknown API endpoint')
  })

  // remote MCP (docs/MCP.md): bearer tokens like /api/v1, never the cookie
  app.route(MCP_PATH, mcpRoutes(s, model))

  mountStatic(app, s)

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v)
      return c.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status)
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json({ error: { code: err.status === 413 ? 'payload_too_large' : 'bad_request', message: err.message || 'Bad request' } }, err.status)
    }
    // a webhook URL's last segment, an invite's and a registration link's token are secrets: never in the log
    s.log.error('unhandled error', { method: c.req.method, path: redactPath(c.req.path), error: err })
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500)
  })

  return app
}

/** Paths that carry a secret (incoming webhook URLs, agent webhooks, invite and registration tokens) as they may appear in a log. */
export const redactPath = (path: string) =>
  path.replace(/^(\/api\/v1\/hooks\/|\/api\/invites\/|\/api\/signup\/)[^/]+/, '$1…').replace(/^(\/api\/v1\/agents\/[^/]+\/hook\/)[^/]+/, '$1…')

/** Resolves the session cookie on every API request and slides its expiry (not on the public API). */
function sessionMiddleware(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith(PUBLIC_API)) {
      c.set('auth', null)
      return next()
    }
    const token = s.sessions.readCookie(c)
    const auth = token ? s.sessions.resolve(token) : null
    c.set('auth', auth)
    if (token && !auth) s.sessions.clearCookie(c)
    if (token && auth && s.sessions.touch(auth.session)) s.sessions.setCookie(c, token)
    await next()
  }
}

/** JSON bodies are small; file uploads (PUT …/files/:id) enforce MAX_UPLOAD_MB themselves while streaming. */
function jsonLimit(): MiddlewareHandler<AppEnv> {
  const limit = bodyLimit({
    maxSize: JSON_LIMIT,
    onError: () => {
      throw new ApiError(413, 'payload_too_large', 'Request body too large')
    },
  })
  return (c, next) => (c.req.method === 'PUT' && /\/files\/[^/]+$/.test(c.req.path) ? next() : limit(c, next))
}
