import { Hono } from 'hono'
import { z } from 'zod'
import { liveDatabase } from '../api/meta.ts'
import type { WorkspaceModel } from '../api/model.ts'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, conflict, notFound } from '../errors.ts'
import { body, idSchema } from '../http/util.ts'
import type { ApiTokenRow, WebhookRow } from '../repo.ts'
import { iso } from '../tokens.ts'
import { access } from './access.ts'

/** Active API tokens and incoming webhooks per workspace. */
export const MAX_TOKENS = 25
export const MAX_HOOKS = 25

type WithCreator = { created_by: string | null; creator_name: string | null; creator_email: string | null }

const creator = (r: WithCreator) => (r.created_by ? { id: r.created_by, name: r.creator_name, email: r.creator_email } : null)

/**
 * The team settings' "API & webhooks" (cookie session, admin and owner): API tokens and incoming
 * webhooks of a workspace, under /api/workspaces/:id. Secrets are only ever in the create answer.
 */
export function integrationRoutes(s: Services, model: WorkspaceModel) {
  const app = new Hono<AppEnv>()

  const tokenJson = (t: ApiTokenRow & WithCreator) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    created_at: iso(t.created_at),
    last_used_at: iso(t.last_used_at),
    revoked: t.revoked_at !== null,
    created_by: creator(t),
  })

  const hookUrl = (secret: string) => `${s.config.publicUrl}/api/v1/hooks/${secret}`

  // ── API tokens ───────────────────────────────────────────────────────

  app.get('/:id/tokens', (c) => {
    const { workspace } = access(s, c, 'admin')
    return c.json(s.repo.apiTokens(workspace.id).map(tokenJson))
  })

  app.post('/:id/tokens', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), scope: z.enum(['read', 'write']).default('read') }))
    if (s.repo.countApiTokens(workspace.id) >= MAX_TOKENS) throw conflict('too_many_tokens', `A workspace has at most ${MAX_TOKENS} API tokens — revoke one first`)
    const { token, row } = s.repo.createApiToken({ workspaceId: workspace.id, name: input.name, scope: input.scope, createdBy: auth.user.id })
    s.log.info('api token created', { workspace: workspace.id, token: row.id, scope: row.scope, user: auth.user.id })
    return c.json({ ...tokenJson({ ...row, creator_name: auth.user.name, creator_email: auth.user.email }), token }, 201)
  })

  app.delete('/:id/tokens/:tokenId', (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const tokenId = c.req.param('tokenId')
    if (!idSchema.safeParse(tokenId).success || !s.repo.revokeApiToken(workspace.id, tokenId)) throw notFound('token_not_found', 'No such API token')
    s.log.info('api token revoked', { workspace: workspace.id, token: tokenId, user: auth.user.id })
    return c.body(null, 204)
  })

  // ── incoming webhooks ────────────────────────────────────────────────

  /** Database titles from the meta document (null: the database is gone or in the trash). */
  const titles = (wsId: string, ids: string[]) =>
    model.read(wsId, (r) => new Map(ids.map((id) => [id, liveDatabase(r, id)?.page.title ?? null] as const)))

  const hookJson = (h: WebhookRow & WithCreator, title: string | null) => ({
    id: h.id,
    database: { id: h.database_id, title },
    created_at: iso(h.created_at),
    rotated_at: iso(h.rotated_at),
    last_delivery_at: iso(h.last_delivery_at),
    deliveries: h.deliveries,
    created_by: creator(h),
  })

  app.get('/:id/hooks', async (c) => {
    const { workspace } = access(s, c, 'admin')
    const hooks = s.repo.webhooks(workspace.id)
    const t = await titles(workspace.id, hooks.map((h) => h.database_id))
    return c.json(hooks.map((h) => hookJson(h, t.get(h.database_id) ?? null)))
  })

  app.post('/:id/hooks', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(c, z.object({ databaseId: idSchema }))
    const title = (await titles(workspace.id, [input.databaseId])).get(input.databaseId)
    if (title === null || title === undefined) throw new ApiError(404, 'database_not_found', 'No such database in this workspace')
    if (s.repo.countWebhooks(workspace.id) >= MAX_HOOKS) throw conflict('too_many_hooks', `A workspace has at most ${MAX_HOOKS} incoming webhooks — delete one first`)
    const { secret, row } = s.repo.createWebhook({ workspaceId: workspace.id, databaseId: input.databaseId, createdBy: auth.user.id })
    s.log.info('webhook created', { workspace: workspace.id, hook: row.id, database: row.database_id, user: auth.user.id })
    return c.json({ ...hookJson({ ...row, creator_name: auth.user.name, creator_email: auth.user.email }, title), url: hookUrl(secret) }, 201)
  })

  app.post('/:id/hooks/:hookId/regenerate', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const hookId = c.req.param('hookId')
    const secret = idSchema.safeParse(hookId).success ? s.repo.rotateWebhook(workspace.id, hookId) : null
    const hook = secret ? s.repo.webhook(workspace.id, hookId) : undefined
    if (!secret || !hook) throw notFound('hook_not_found', 'No such webhook')
    s.log.info('webhook regenerated', { workspace: workspace.id, hook: hookId, user: auth.user.id })
    const t = await titles(workspace.id, [hook.database_id])
    return c.json({ ...hookJson(hook, t.get(hook.database_id) ?? null), url: hookUrl(secret) })
  })

  app.delete('/:id/hooks/:hookId', (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const hookId = c.req.param('hookId')
    if (!idSchema.safeParse(hookId).success || !s.repo.deleteWebhook(workspace.id, hookId)) throw notFound('hook_not_found', 'No such webhook')
    s.log.info('webhook deleted', { workspace: workspace.id, hook: hookId, user: auth.user.id })
    return c.body(null, 204)
  })

  return app
}
