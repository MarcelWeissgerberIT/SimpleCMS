import { Hono } from 'hono'
import { z } from 'zod'
import type { Auth } from '../auth/sessions.ts'
import { isServerAdmin } from '../auth/signup.ts'
import type { AppEnv, Services } from '../context.ts'
import { body, requireAuth } from '../http/util.ts'
import { publicUser, publicWorkspace } from '../repo.ts'

/** The signed-in person, their workspaces (own one first) and — for server admins only — `server_admin: true`. */
function account(s: Services, auth: Auth) {
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

  app.patch('/', async (c) => {
    const { user } = requireAuth(c)
    const input = await body(c, z.object({ name: z.string().trim().max(80).nullable() }))
    const name = input.name || null
    s.repo.setUserName(user.id, name)
    return c.json(publicUser({ ...user, name }))
  })

  return app
}
