import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { forbidden, notFound } from '../errors.ts'
import { idSchema, requireAuth } from '../http/util.ts'
import { atLeast, type Role } from '../repo.ts'

/**
 * Membership gate for every /api/workspaces/:id route. Non-members get 404 (the workspace's existence is
 * not revealed), members below the required role get 403.
 */
export function access(s: Services, c: Context<AppEnv>, min: Role) {
  const auth = requireAuth(c)
  const id = c.req.param('id') ?? ''
  const role = idSchema.safeParse(id).success ? s.repo.memberRole(id, auth.user.id) : undefined
  const workspace = role ? s.repo.workspaceById(id) : undefined
  if (!role || !workspace) throw notFound('workspace_not_found', 'Workspace not found')
  if (!atLeast(role, min)) throw forbidden('forbidden', `This needs the ${min} role or higher`)
  return { auth, role, workspace }
}

export const nameSchema = z.string().trim().min(1).max(100)

/** Icons are opaque client JSON (an emoji string or a PageIcon object), size-capped. */
export const iconSchema = z
  .unknown()
  .refine((v) => v === null || (typeof v === 'string' && v.length <= 64) || (typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 2048), {
    message: 'icon must be null, a short string or a JSON object (≤ 2 KB)',
  })
