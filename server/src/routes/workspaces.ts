import { rm } from 'node:fs/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { domainList, parseDomains } from '../auth/signup.ts'
import { badRequest, conflict, forbidden, notFound, rateLimited } from '../errors.ts'
import { body, idSchema, requireAuth } from '../http/util.ts'
import { pickLang } from '../i18n.ts'
import { inviteMail } from '../mail/templates.ts'
import { MAX_LINK_USES, normalizeEmail, publicUser, publicWorkspace, type InviteRow, type Role } from '../repo.ts'
import { filesDir, legacyPath, sealedPath } from '../storage.ts'
import { DAY, iso } from '../tokens.ts'
import { access, iconSchema, nameSchema } from './access.ts'

const WORKSPACES_PER_DAY = 20
const INVITES_PER_DAY = 50
/** "Send by email" takes at most this many addresses at once (one single-use invite + mail each). */
export const INVITE_EMAILS_MAX = 20

const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])
const inviteRoleSchema = z.enum(['admin', 'member', 'viewer'])
/** Validity in days (the app offers 1 · 7 · 30) and people per link (1 · 5 · 10 · 25 · 100). */
export const daysSchema = z.number().int().min(1).max(30)
export const usesSchema = z.number().int().min(1).max(MAX_LINK_USES)
export const domainsSchema = z.array(z.string().max(254)).max(10)
const langSchema = z.enum(['en', 'de'])

/** Domains typed by an admin → normalised list, or a 400 naming the problem. */
export function domainsOrThrow(input: string[] | undefined): string[] | null {
  const list = parseDomains(input)
  if (!list) throw badRequest('invalid_request', 'domains: every entry must be a domain like example.com')
  return list.length ? list : null
}

/** An invite as the admins' list and the create answers show it (never the token). */
function inviteJson(i: InviteRow & { inviter_name?: string | null; inviter_email?: string | null; joiner_name?: string | null; joiner_email?: string | null }) {
  return {
    id: i.id,
    role: i.role,
    email: i.email,
    created_at: iso(i.created_at),
    expires_at: iso(i.expires_at),
    max_uses: i.max_uses,
    uses: i.uses,
    domains: domainList(i.allowed_domains),
    last_joined_at: iso(i.accepted_at),
    ...('inviter_email' in i ? { inviter: i.created_by ? { id: i.created_by, name: i.inviter_name ?? null, email: i.inviter_email ?? null } : null } : {}),
    ...('joiner_email' in i ? { last_joined: i.accepted_by ? { id: i.accepted_by, name: i.joiner_name ?? null, email: i.joiner_email ?? null } : null } : {}),
  }
}

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
        // the new owner's sockets reconnect with the new role (a viewer's were read-only; the app refreshes its
        // role on 'role-changed': owner-only parts, the workspace look); the old owner stays admin
        s.collab.closeUser(userId, workspace.id, 'role-changed')
        s.log.info('ownership transferred', { workspace: workspace.id, from: auth.user.id, to: userId })
      }
    } else if (role !== current) {
      if (current === 'owner') throw conflict('owner_must_transfer', 'Transfer ownership to someone else first')
      s.repo.setRole(workspace.id, userId, role)
      // every role means something on the socket now: a viewer's is read-only, only owners' and admins' may
      // change the workspace look — reconnect so the new role applies (the app refreshes its role on 'role-changed')
      s.collab.closeUser(userId, workspace.id, 'role-changed')
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

  const inviteSchema = z.object({
    role: inviteRoleSchema.default('member'),
    email: z.email().max(254).optional(),
    lang: langSchema.optional(),
    max_uses: usesSchema.optional(),
    expires_in_days: daysSchema.optional(),
    domains: domainsSchema.optional(),
  })

  const mailInvite = async (to: string, input: { link: string; workspace: string; inviter: string; role: string; days: number; lang: 'en' | 'de' }): Promise<boolean> => {
    const mail = inviteMail(input.lang, { link: input.link, workspace: input.workspace, inviter: input.inviter, role: input.role, days: input.days })
    try {
      await s.mailer.send({ to, link: input.link, ...mail })
      return true
    } catch (err) {
      s.log.error('sending invite mail failed', { to, error: (err as Error).message })
      return false
    }
  }

  const inviteLink = (token: string) => `${s.config.publicUrl}/app/#/invite/${token}`

  app.post('/:id/invites', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(c, inviteSchema)
    const maxUses = input.max_uses ?? 1
    const domains = domainsOrThrow(input.domains)
    // an address-bound invite is for that one person; a reusable link never makes admins
    if (input.email && (maxUses !== 1 || domains)) throw badRequest('invalid_request', 'An invite for an email address is single-use and has no domain restriction')
    if (input.role === 'admin' && maxUses !== 1) throw badRequest('invalid_request', 'Admin invites are single-use')
    if (s.repo.countInvitesSince(workspace.id, Date.now() - DAY) >= INVITES_PER_DAY) throw rateLimited(3600)
    if (input.email) {
      const existing = s.repo.userByEmail(input.email)
      if (existing && s.repo.memberRole(workspace.id, existing.id)) throw conflict('already_member', 'This person is already a member')
    }
    const days = input.expires_in_days ?? 7
    const { token, row } = s.repo.createInvite({ workspaceId: workspace.id, role: input.role, email: input.email ?? null, createdBy: auth.user.id, maxUses, ttl: days * DAY, domains })
    const link = inviteLink(token)

    let emailSent: boolean | undefined
    if (row.email) {
      const lang = pickLang(input.lang, c.req.header('accept-language'))
      emailSent = await mailInvite(row.email, { link, workspace: workspace.name, inviter: auth.user.name || auth.user.email, role: row.role, days, lang })
    }
    if (maxUses > 1) s.log.info('reusable invite created', { workspace: workspace.id, invite: row.id, user: auth.user.id, max_uses: maxUses })
    return c.json({ ...inviteJson(row), link, ...(emailSent === undefined ? {} : { email_sent: emailSent }) }, 201)
  })

  /**
   * Several people by email at once: one single-use invite + mail per address. Per address:
   * `sent` · `failed` (the mail could not be sent — the invite exists, `link` lets the admin pass it on)
   * · `already_member` · `invalid`. Duplicates count once.
   */
  app.post('/:id/invites/emails', async (c) => {
    const { workspace, auth } = access(s, c, 'admin')
    const input = await body(
      c,
      z.object({
        emails: z.array(z.string().max(320)).min(1).max(INVITE_EMAILS_MAX),
        role: inviteRoleSchema.default('member'),
        expires_in_days: daysSchema.optional(),
        lang: langSchema.optional(),
      }),
    )
    const addresses = [...new Set(input.emails.map(normalizeEmail).filter(Boolean))]
    const valid = addresses.filter((a) => z.email().max(254).safeParse(a).success)
    const toInvite = valid.filter((a) => {
      const user = s.repo.userByEmail(a)
      return !(user && s.repo.memberRole(workspace.id, user.id))
    })
    if (s.repo.countInvitesSince(workspace.id, Date.now() - DAY) + toInvite.length > INVITES_PER_DAY) throw rateLimited(3600)
    const days = input.expires_in_days ?? 7
    const lang = pickLang(input.lang, c.req.header('accept-language'))
    const inviter = auth.user.name || auth.user.email
    type Result = { email: string; status: 'sent' | 'failed' | 'already_member' | 'invalid'; id?: string; link?: string; expires_at?: string | null }
    // the invites are made in order; the mails go out side by side (a slow SMTP server costs one wait, not twenty)
    const results = await Promise.all(
      addresses.map(async (email): Promise<Result> => {
        if (!valid.includes(email)) return { email, status: 'invalid' }
        if (!toInvite.includes(email)) return { email, status: 'already_member' }
        const { token, row } = s.repo.createInvite({ workspaceId: workspace.id, role: input.role, email, createdBy: auth.user.id, ttl: days * DAY })
        const link = inviteLink(token)
        const sent = await mailInvite(email, { link, workspace: workspace.name, inviter, role: row.role, days, lang })
        return { email, status: sent ? 'sent' : 'failed', id: row.id, link, expires_at: iso(row.expires_at) }
      }),
    )
    s.log.info('invites sent', { workspace: workspace.id, user: auth.user.id, sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length })
    return c.json({ results })
  })

  app.get('/:id/invites', (c) => {
    const { workspace } = access(s, c, 'admin')
    return c.json(s.repo.openInvites(workspace.id).map(inviteJson))
  })

  app.delete('/:id/invites/:inviteId', (c) => {
    const { workspace } = access(s, c, 'admin')
    if (!s.repo.deleteInvite(workspace.id, c.req.param('inviteId'))) throw notFound('invite_not_found', 'Invite not found')
    return c.body(null, 204)
  })

  return app
}

