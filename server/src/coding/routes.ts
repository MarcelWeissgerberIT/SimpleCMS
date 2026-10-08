/**
 * Cloud coding workers over REST (docs/CLOUD.md § Coding relay):
 *  - /api/workspaces/:id/coding/workers (cookie session, role ≥ member): a member lists, creates (= downloads)
 *    and revokes their own worker token; admins and the owner see and revoke everyone's. The secret is only
 *    in the create answer — One writes it into the downloaded file and keeps it nowhere else.
 *  - GET /api/coding/worker (the worker token as bearer, never a cookie): what `one-worker check` prints.
 * A new token starts pending; the relay activates it on its first connection and only then revokes the
 * member's older one.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { failedAttempt } from '../api/auth.ts'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, forbidden, notFound, rateLimited } from '../errors.ts'
import { body, idSchema } from '../http/util.ts'
import { atLeast, isWorkerTokenShape, type CodingWorkerRow } from '../repo.ts'
import { access } from '../routes/access.ts'
import { DAY, iso, safeEqual } from '../tokens.ts'

/** Downloads (new tokens) per member per day. */
export const CODING_WORKERS_PER_DAY = 20

const relayOff = () => notFound('coding_relay_off', 'The coding relay is switched off on this server (CODING_RELAY=off)')

export function codingRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  const json = (r: CodingWorkerRow & { user_name: string | null; user_email: string }, me: string, online: Map<string, { since: number; tab: boolean }>) => {
    const live = online.get(r.id)
    return {
      id: r.id,
      label: r.label,
      state: r.activated_at === null ? 'pending' : 'active',
      user: { id: r.user_id, name: r.user_name, email: r.user_email },
      mine: r.user_id === me,
      created_at: iso(r.created_at),
      created_from: r.created_ua,
      activated_at: iso(r.activated_at),
      last_used_at: iso(r.last_used_at),
      online: !!live,
      tab: live?.tab ?? false,
      since: iso(live?.since ?? null),
    }
  }

  app.get('/:id/coding/workers', (c) => {
    if (!s.config.codingRelay) throw relayOff()
    const { workspace, role, auth } = access(s, c, 'member')
    const rows = s.repo.codingWorkers(workspace.id, atLeast(role, 'admin') ? undefined : auth.user.id)
    const online = s.coding.online(workspace.id)
    return c.json(rows.map((r) => json(r, auth.user.id, online)))
  })

  app.post('/:id/coding/workers', async (c) => {
    if (!s.config.codingRelay) throw relayOff()
    const { workspace, auth } = access(s, c, 'member')
    const input = await body(c, z.object({ label: z.string().trim().max(60).optional() }))
    const wait = s.limiter.hit(`coding:create:${auth.user.id}`, CODING_WORKERS_PER_DAY, DAY)
    if (wait) throw rateLimited(Math.min(wait, 3600))
    const { token, row, replaced } = s.repo.createCodingWorker({ workspaceId: workspace.id, userId: auth.user.id, label: input.label ?? '', userAgent: c.req.header('user-agent') ?? null })
    // only a download that was never started is replaced now; the working worker stays until the new one connects
    for (const id of replaced) s.coding.closeWorker(id, 'replaced')
    s.coding.refresh(workspace.id, auth.user.id)
    s.log.info('coding worker token created', { workspace: workspace.id, worker: row.id, user: auth.user.id, replaced: replaced.length || undefined })
    return c.json({ ...json({ ...row, user_name: auth.user.name, user_email: auth.user.email }, auth.user.id, new Map()), token }, 201)
  })

  app.delete('/:id/coding/workers/:workerId', (c) => {
    if (!s.config.codingRelay) throw relayOff()
    const { workspace, role, auth } = access(s, c, 'member')
    const workerId = c.req.param('workerId')
    const row = idSchema.safeParse(workerId).success ? s.repo.codingWorker(workspace.id, workerId) : undefined
    // someone else's token: only admins and the owner (to a member it does not exist)
    if (!row || (row.user_id !== auth.user.id && !atLeast(role, 'admin'))) throw notFound('worker_not_found', 'No such cloud worker')
    s.repo.revokeCodingWorker(workspace.id, row.id)
    s.coding.closeWorker(row.id, 'revoked')
    s.coding.refresh(workspace.id, row.user_id)
    s.log.info('coding worker token revoked', { workspace: workspace.id, worker: row.id, user: auth.user.id })
    return c.body(null, 204)
  })

  return app
}

/** GET /api/coding/worker — the worker token checks itself (`one-worker check`). Never a cookie, never a web page. */
export function codingWorkerRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  app.get('/worker', (c) => {
    if (!s.config.codingRelay) throw relayOff()
    if (c.req.header('origin') !== undefined) throw forbidden('forbidden', 'Worker tokens are not for web pages')
    const secret = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization') ?? '')?.[1]
    const row = isWorkerTokenShape(secret) ? s.repo.codingWorkerBySecret(secret) : undefined
    if (!row || !secret || !safeEqual(row.token_hash, s.repo.hash(secret))) {
      throw failedAttempt(s, c, new ApiError(401, 'unauthenticated', 'This worker token is not valid: revoked, replaced by a newer download, or never created', { headers: { 'WWW-Authenticate': 'Bearer realm="SimpleCMS One coding relay"' } }))
    }
    const role = s.repo.memberRole(row.workspace_id, row.user_id)
    if (!role) throw forbidden('forbidden', 'The person this worker belongs to is no longer a member of the workspace')
    if (role === 'viewer') throw forbidden('viewer', 'Viewers cannot run coding tasks in this workspace')
    const workspace = s.repo.workspaceById(row.workspace_id)
    const user = s.repo.userById(row.user_id)
    return c.json({
      workspace: { id: `team:${row.workspace_id}`, name: workspace?.name ?? '' },
      member: { email: user?.email ?? '', name: user?.name ?? null },
      state: row.activated_at === null ? 'pending' : 'active',
      online: s.coding.online(row.workspace_id).has(row.id),
    })
  })
  return app
}
