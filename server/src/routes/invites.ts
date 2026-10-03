import { Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { forbidden, notFound } from '../errors.ts'
import { requireAuth } from '../http/util.ts'
import type { InviteRow } from '../repo.ts'
import { isTokenShape, iso } from '../tokens.ts'

/** Public invite endpoints, addressed by the secret token from the invite link (/api/invites/:token). */
export function inviteRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  /** Unknown, used and expired invites are all 404 — with distinct codes so the app can explain. */
  const load = (token: string): InviteRow => {
    const invite = isTokenShape(token) ? s.repo.inviteByToken(token) : undefined
    if (!invite) throw notFound('invite_not_found', 'This invitation does not exist or was revoked')
    if (invite.accepted_by) throw notFound('invite_used', 'This invitation was already used')
    if (invite.expires_at <= Date.now()) throw notFound('invite_expired', 'This invitation has expired')
    return invite
  }

  app.get('/:token', (c) => {
    const invite = load(c.req.param('token'))
    const ws = s.repo.workspaceById(invite.workspace_id)
    if (!ws) throw notFound('invite_not_found', 'This invitation does not exist or was revoked')
    const inviter = invite.created_by ? s.repo.userById(invite.created_by) : undefined
    return c.json({
      workspace: { name: ws.name, icon: ws.icon ? JSON.parse(ws.icon) : null },
      role: invite.role,
      inviter: inviter ? { name: inviter.name, email: inviter.email } : null,
      email: invite.email,
      expires_at: iso(invite.expires_at),
    })
  })

  app.post('/:token/accept', (c) => {
    const { user } = requireAuth(c)
    const invite = load(c.req.param('token'))
    if (invite.email && invite.email !== user.email) throw forbidden('invite_email_mismatch', `This invitation is for ${invite.email}`)
    const result = s.db.tx(() => {
      const existing = s.repo.memberRole(invite.workspace_id, user.id)
      // already a member: keep the role and leave the invite for whoever it was meant for
      if (existing) return { workspaceId: invite.workspace_id, role: existing }
      if (!s.repo.consumeInvite(invite.id, user.id)) throw notFound('invite_used', 'This invitation was already used')
      s.repo.addMember(invite.workspace_id, user.id, invite.role)
      return { workspaceId: invite.workspace_id, role: invite.role }
    })
    s.log.info('invite accepted', { workspace: result.workspaceId, user: user.id, role: result.role })
    return c.json(result)
  })

  return app
}
