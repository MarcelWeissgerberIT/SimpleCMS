import { rm } from 'node:fs/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { conflict, forbidden, notFound, rateLimited } from '../errors.ts'
import { body, idSchema, requireAuth } from '../http/util.ts'
import { pickLang } from '../i18n.ts'
import { inviteMail } from '../mail/templates.ts'
import { INVITE_TTL, publicUser, publicWorkspace, type Role } from '../repo.ts'
import { filesDir, legacyPath, sealedPath } from '../storage.ts'
import { DAY, iso } from '../tokens.ts'
import { access, iconSchema, nameSchema } from './access.ts'

const WORKSPACES_PER_DAY = 20
const INVITES_PER_DAY = 50

const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])
const inviteRoleSchema = z.enum(['admin', 'member', 'viewer'])

/** Workspaces, members and a workspace's invites (all under /api/workspaces). */
export function workspaceRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  // ── workspaces ───────────────────────────────────────────────────────

  app.post('/', async (c) => {
    const { user } = requireAuth(c)
    const input = await body(c, z.object({ name: nameSchema, icon: iconSchema.optional() }))
    if (s.repo.countWorkspacesCreatedSince(user.id, Date.now() - DAY) >= WORKSPACES_PER_DAY) throw rateLimited(3600)
    const ws = s.repo.createWorkspace(user.id, input.name, input.icon ?? null)
    s.log.info('workspace created', { workspace: ws.id, user: user.id })
    return c.json(publicWorkspace(ws, 'owner'), 201)
  })

  app.patch('/:id', async (c) => {
    const { workspace, role, auth } = access(s, c, 'admin')
    const input = await body(c, z.object({ name: nameSchema.optional(), icon: iconSchema.optional() }))
    s.repo.updateWorkspace(workspace.id, input)
    return c.json(publicWorkspace(s.repo.workspaceById(workspace.id) ?? workspace, role, auth.user.id))
  })

  app.delete('/:id', async (c) => {
    const { workspace, auth } = access(s, c, 'owner')
    // the workspace's key goes first (crypto-shredding): whatever bytes are left anywhere are unreadable
    s.repo.deleteWorkspace(workspace.id)
    s.collab.closeWorkspace(workspace.id, 'workspace-deleted')
    await rm(filesDir(s.config.dataDir, workspace.id), { recursive: true, force: true })
    s.log.info('workspace deleted', { workspace: workspace.id, user: auth.user.id })
    return c.body(null, 204)
  })

  // ── members ──────────────────────────────────────────────────────────

  const memberJson = (m: { id: string; email: string; name: string | null; role: Role; member_since: number }) => ({
    user: publicUser(m),
    role: m.role,
    created_at: iso(m.member_since),
  })

  app.get('/:id/members', (c) => {
    const { workspace } = access(s, c, 'viewer')
    return c.json(s.repo.members(workspace.id).map(memberJson))
  })

  app.patch('/:id/members/:userId', async (c) => {
    const { workspace, role: actorRole, auth } = access(s, c, 'admin')
    const userId = c.req.param('userId')
    const { role } = await body(c, z.object({ role: roleSchema }))
    const current = idSchema.safeParse(userId).success ? s.repo.memberRole(workspace.id, userId) : undefined
    if (!current) throw notFound('member_not_found', 'This person is not a member')

    if (role === 'owner') {
      if (actorRole !== 'owner') throw forbidden('owner_only', 'Only the owner can hand over ownership')
      if (userId !== auth.user.id) {
        s.repo.transferOwnership(workspace.id, userId)
        if (current === 'viewer') s.collab.closeUser(userId, workspace.id, 'role-changed')
        s.log.info('ownership transferred', { workspace: workspace.id, from: auth.user.id, to: userId })
      }
    } else if (role !== current) {
      if (current === 'owner') throw conflict('owner_must_transfer', 'Transfer ownership to someone else first')
      s.repo.setRole(workspace.id, userId, role)
      // a viewer's socket is read-only and a member's is not: reconnect so the new role applies
      if (current === 'viewer' || role === 'viewer') s.collab.closeUser(userId, workspace.id, 'role-changed')
    }
    const updated = s.repo.members(workspace.id).find((m) => m.id === userId)
    if (!updated) throw notFound('member_not_found', 'This person is not a member')
    return c.json(memberJson(updated))
  })

  app.delete('/:id/members/:userId', async (c) => {
    const { workspace, role: actorRole, auth } = access(s, c, 'viewer')
    const userId = c.req.param('userId')
    const self = userId === auth.user.id
    if (!self && actorRole !== 'owner' && actorRole !== 'admin') throw forbidden('forbidden', 'Only admins can remove members')
    const current = idSchema.safeParse(userId).success ? s.repo.memberRole(workspace.id, userId) : undefined
    if (!current) throw notFound('member_not_found', 'This person is not a member')
    if (current === 'owner') throw conflict('owner_must_transfer', self ? 'Transfer ownership before leaving (or delete the workspace)' : 'The owner cannot be removed')
    s.repo.removeMember(workspace.id, userId)
    s.collab.closeUser(userId, workspace.id, 'membership-revoked')
    // their private pages go with the membership (docs/CLOUD.md § Private pages); stores of documents
    // still closing are refused for non-members, so nothing comes back
    const documents = s.repo.deletePrivateDocuments(workspace.id, userId)
    const files = s.repo.deletePrivateFiles(workspace.id, userId)
    await Promise.all(
      files.flatMap((id) => [sealedPath(s.config.dataDir, workspace.id, id), legacyPath(s.config.dataDir, workspace.id, id)]).map((p) => rm(p, { force: true })),
    )
    s.log.info(self ? 'member left' : 'member removed', { workspace: workspace.id, user: userId, by: auth.user.id, privateDocuments: documents, privateFiles: files.length })
    return c.body(null, 204)
  })

  // ── invites (admin) ──────────────────────────────────────────────────

  app.post('/:id/invites', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(c, z.object({ role: inviteRoleSchema.default('member'), email: z.email().max(254).optional(), lang: z.enum(['en', 'de']).optional() }))
    if (s.repo.countInvitesSince(workspace.id, Date.now() - DAY) >= INVITES_PER_DAY) throw rateLimited(3600)
    if (input.email) {
      const existing = s.repo.userByEmail(input.email)
      if (existing && s.repo.memberRole(workspace.id, existing.id)) throw conflict('already_member', 'This person is already a member')
    }
    const { token, row } = s.repo.createInvite({ workspaceId: workspace.id, role: input.role, email: input.email ?? null, createdBy: auth.user.id })
    const link = `${s.config.publicUrl}/app/#/invite/${token}`

    let emailSent: boolean | undefined
    if (row.email) {
      const lang = pickLang(input.lang, c.req.header('accept-language'))
      const mail = inviteMail(lang, { link, workspace: workspace.name, inviter: auth.user.name || auth.user.email, role: row.role, days: INVITE_TTL / DAY })
      try {
        await s.mailer.send({ to: row.email, link, ...mail })
        emailSent = true
      } catch (err) {
        s.log.error('sending invite mail failed', { to: row.email, error: (err as Error).message })
        emailSent = false
      }
    }
    return c.json({ id: row.id, link, expires_at: iso(row.expires_at), role: row.role, email: row.email, ...(emailSent === undefined ? {} : { email_sent: emailSent }) }, 201)
  })

  app.get('/:id/invites', (c) => {
    const { workspace } = access(s, c, 'admin')
    return c.json(
      s.repo.openInvites(workspace.id).map((i) => ({
        id: i.id,
        role: i.role,
        email: i.email,
        created_at: iso(i.created_at),
        expires_at: iso(i.expires_at),
        inviter: i.created_by ? { id: i.created_by, name: i.inviter_name, email: i.inviter_email } : null,
      })),
    )
  })

  app.delete('/:id/invites/:inviteId', (c) => {
    const { workspace } = access(s, c, 'admin')
    if (!s.repo.deleteInvite(workspace.id, c.req.param('inviteId'))) throw notFound('invite_not_found', 'Invite not found')
    return c.body(null, 204)
  })

  return app
}

