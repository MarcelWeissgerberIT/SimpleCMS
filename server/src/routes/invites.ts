import { Hono, type Context } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { domainAllowed, domainList, isOpenInvite } from '../auth/signup.ts'
import { z } from 'zod'
import { forbidden, notFound, rateLimited } from '../errors.ts'
import { body, clientIp, requireAuth } from '../http/util.ts'
import { atLeast, type InviteRow, type WorkspaceRow } from '../repo.ts'
import { MINUTE, isTokenShape, iso } from '../tokens.ts'

const DEAD = 'This invitation does not exist, has expired, was used up or revoked'

/** Public invite endpoints, addressed by the secret token from the invite link (/api/invites/:token). */
export function inviteRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  /** Is the caller (if signed in) an admin of the invite's workspace? They may learn more about it. */
  const isAdminOf = (c: Context<AppEnv>, invite: InviteRow) => {
    const auth = c.get('auth')
    const role = auth ? s.repo.memberRole(invite.workspace_id, auth.user.id) : undefined
    return !!role && atLeast(role, 'admin')
  }

  /**
   * An open invite (places left, not expired) and its workspace. Everything else — unknown, revoked,
   * expired, used up — is the same 404 `invite_not_found` (nothing to tell a token's holder apart);
   * only the workspace's own admins get `invite_used` / `invite_expired`.
   */
  const load = (c: Context<AppEnv>, token: string): { invite: InviteRow; ws: WorkspaceRow } => {
    const invite = isTokenShape(token) ? s.repo.inviteByToken(token) : undefined
    const ws = invite ? s.repo.workspaceById(invite.workspace_id) : undefined
    if (invite && ws && isOpenInvite(invite)) return { invite, ws }
    if (invite && ws && isAdminOf(c, invite)) {
      if (invite.uses >= invite.max_uses) throw notFound('invite_used', 'This invitation was used up')
      throw notFound('invite_expired', 'This invitation has expired')
    }
    throw notFound('invite_not_found', DEAD)
  }

  app.get('/:token', (c) => {
    const { invite, ws } = load(c, c.req.param('token'))
    const inviter = invite.created_by ? s.repo.userById(invite.created_by) : undefined
    return c.json({
      workspace: { name: ws.name, icon: ws.icon ? JSON.parse(ws.icon) : null },
      role: invite.role,
      guest: !!invite.guest,
      direct: !!invite.direct,
      inviter: inviter ? { name: inviter.name, email: inviter.email } : null,
      email: invite.email,
      expires_at: iso(invite.expires_at),
      domains: domainList(invite.allowed_domains),
      // how many places are left is the workspace admins' business, not the invitees'
      ...(isAdminOf(c, invite) ? { max_uses: invite.max_uses, uses: invite.uses, places_left: invite.max_uses - invite.uses } : {}),
    })
  })

  // Possession of an explicitly created direct link grants workspace membership, never an existing identity.
  app.post('/:token/join', async (c) => {
    const wait = s.limiter.hit(`invite:join:${clientIp(c, s.config)}`, 20, 15 * MINUTE)
    if (wait) throw rateLimited(wait)
    const input = await body(c, z.object({ email: z.email().max(254), name: z.string().trim().min(1).max(80) }).strict())
    if (c.get('auth')) throw forbidden('already_signed_in', 'Use the signed-in join action')
    const result = s.db.tx(() => {
      const { invite } = load(c, c.req.param('token'))
      if (!invite.direct || invite.email || invite.allowed_domains || invite.role === 'admin') throw forbidden('invite_signin_required', 'This invitation requires email sign-in')
      const user = s.repo.createInviteUser(input.email, input.name)
      if (!s.repo.consumeInvite(invite.id, user.id)) throw notFound('invite_not_found', DEAD)
      s.repo.addMember(invite.workspace_id, user.id, invite.role, !!invite.guest)
      const session = s.sessions.create(user.id, c.req.header('user-agent') ?? null)
      return { workspaceId: invite.workspace_id, user, session }
    })
    s.sessions.setCookie(c, result.session.token)
    c.header('Cache-Control', 'no-store')
    s.log.info('direct invite accepted', { workspace: result.workspaceId, user: result.user.id })
    return c.json({ workspaceId: result.workspaceId }, 201)
  })

  app.post('/:token/accept', (c) => {
    const { user } = requireAuth(c)
    const { invite } = load(c, c.req.param('token'))
    if (user.pending_email && (invite.email || invite.allowed_domains || invite.role === 'admin')) throw forbidden('email_unverified', 'Verify your email before accepting a restricted invitation')
    if (invite.email && invite.email !== user.email) throw forbidden('invite_email_mismatch', `This invitation is for ${invite.email}`)
    if (!domainAllowed(invite.allowed_domains, user.email)) {
      throw forbidden('invite_domain_mismatch', `This invitation is for addresses at ${domainList(invite.allowed_domains)?.join(', ')}`)
    }
    const result = s.db.tx(() => {
      const existing = s.repo.memberRole(invite.workspace_id, user.id)
      // already a member: keep the role, and the place stays for someone else (not a use)
      if (existing) return { workspaceId: invite.workspace_id, role: existing, joined: false }
      if (!s.repo.consumeInvite(invite.id, user.id)) throw notFound('invite_not_found', DEAD)
      s.repo.addMember(invite.workspace_id, user.id, invite.role, !!invite.guest)
      return { workspaceId: invite.workspace_id, role: invite.role, joined: true }
    })
    if (result.joined) s.log.info('invite accepted', { workspace: result.workspaceId, user: user.id, role: result.role, invite: invite.id })
    return c.json({ workspaceId: result.workspaceId, role: result.role })
  })

  return app
}
