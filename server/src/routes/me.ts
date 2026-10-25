import { isVaultEnvelope } from '../../../src/shared/personalVault.ts'
import { ApiError, rateLimited } from '../errors.ts'
import { MINUTE } from '../tokens.ts'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Auth } from '../auth/sessions.ts'
import { isServerAdmin } from '../auth/signup.ts'
import type { AppEnv, Services } from '../context.ts'
import { body, requireAuth } from '../http/util.ts'
import { publicUser, publicWorkspace } from '../repo.ts'

/** The signed-in person, their workspaces (own one first) and — for server admins only — `server_admin: true`. */
function account(s: Services, auth: Auth) {
  if (auth.testAccess) {
    const t = auth.testAccess
    const actor = s.repo.db.get<{ name: string | null; email: string }>('SELECT name, email FROM users WHERE id = ?', t.actor_id)!
    return { user: publicUser(auth.user), workspaces: [publicWorkspace(s.repo.workspaceById(t.workspace_id)!, 'viewer')],
      test_access: { id: t.session_id, workspaceId: t.workspace_id, name: t.target_name, guest: !!t.guest, role: t.target_role, expiresAt: t.expires_at, actorName: actor.name || actor.email } }
  }
  return {
    user: publicUser(auth.user),
    workspaces: s.repo.workspacesForUser(auth.user.id).map((w) => publicWorkspace(w, w.role, auth.user.id)),
    ...(isServerAdmin(s.config, auth.user) ? { server_admin: true } : {}),
  }
}

/**
 * GET /api/session: who is signed in, answered with 200 either way (`user: null` when nobody is), so
 * a signed-out app boot leaves no failed request in the console. /api/me keeps its 401.
 */
export function sessionRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  app.get('/', (c) => {
    const auth = c.get('auth')
    if (!auth) return c.json({ user: null, workspaces: [] })
    return c.json(account(s, auth))
  })
  return app
}

export function meRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.get('/', (c) => c.json(account(s, requireAuth(c))))

  // Only the current session's owner. No user-id parameter, admin bypass, MCP or workspace export.
  app.get('/secrets', (c) => {
    const { user } = requireAuth(c)
    const row = s.db.get<{ envelope: string; version: number }>('SELECT envelope, version FROM personal_vaults WHERE user_id = ?', user.id)
    return c.json(row ? { envelope: JSON.parse(row.envelope), version: row.version } : { envelope: null, version: 0 })
  })
  app.put('/secrets', async (c) => {
    const { user } = requireAuth(c)
    const wait = s.limiter.hit(`personal-vault:${user.id}`, 30, MINUTE)
    if (wait) throw rateLimited(wait)
    const input = await body(c, z.object({ version: z.number().int().min(0).max(2147483646), envelope: z.unknown().refine(isVaultEnvelope) }).strict())
    const saved = s.db.tx(() => {
      const row = s.db.get<{ version: number }>('SELECT version FROM personal_vaults WHERE user_id = ?', user.id)
      if ((row?.version ?? 0) !== input.version) return false
      s.db.run('INSERT INTO personal_vaults (user_id, envelope, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET envelope = excluded.envelope, version = excluded.version, updated_at = excluded.updated_at', user.id, JSON.stringify(input.envelope), input.version + 1, Date.now())
      return true
    })
    if (!saved) throw new ApiError(409, 'vault_changed', 'Your personal vault changed on another device. Lock and unlock again before saving.')
    s.log.info('personal vault updated', { user: user.id })
    return c.json({ version: input.version + 1 })
  })

  app.patch('/', async (c) => {
    const { user } = requireAuth(c)
    const input = await body(c, z.object({ name: z.string().trim().max(80).nullable() }))
    const name = input.name || null
    s.repo.setUserName(user.id, name)
    return c.json(publicUser({ ...user, name }))
  })

  return app
}
