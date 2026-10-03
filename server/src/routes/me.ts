import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { body, requireAuth } from '../http/util.ts'
import { publicUser, publicWorkspace } from '../repo.ts'

export function meRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.get('/', (c) => {
    const { user } = requireAuth(c)
    return c.json({ user: publicUser(user), workspaces: s.repo.workspacesForUser(user.id).map((w) => publicWorkspace(w, w.role)) })
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
