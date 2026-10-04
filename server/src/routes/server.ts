import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { domainList, isOpenSignupLink, isServerAdmin } from '../auth/signup.ts'
import type { AppEnv, Services } from '../context.ts'
import { conflict, forbidden, notFound, rateLimited } from '../errors.ts'
import { body, requireAuth } from '../http/util.ts'
import type { SignupLinkRow } from '../repo.ts'
import { DAY, isTokenShape, iso } from '../tokens.ts'
import { daysSchema, domainsOrThrow, domainsSchema, usesSchema } from './workspaces.ts'

/** Registration links created per day on the whole server (they are few: one per cohort / team). */
const SIGNUP_LINKS_PER_DAY = 50

const linkJson = (l: SignupLinkRow & { creator_name?: string | null; creator_email?: string | null }) => ({
  id: l.id,
  label: l.label,
  created_at: iso(l.created_at),
  expires_at: iso(l.expires_at),
  max_uses: l.max_uses,
  uses: l.uses,
  last_used_at: iso(l.last_used_at),
  domains: domainList(l.allowed_domains),
  ...('creator_email' in l ? { created_by: l.created_by ? { id: l.created_by, name: l.creator_name ?? null, email: l.creator_email ?? null } : null } : {}),
})

/**
 * Server administration (/api/server): registration links. Only server admins — the addresses in
 * ADMIN_EMAILS, signed in like everyone else — get past `admin()`; everyone else 403 (signed out 401).
 */
export function serverRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  const admin = (c: Context<AppEnv>) => {
    const auth = requireAuth(c)
    if (!isServerAdmin(s.config, auth.user)) throw forbidden('server_admin_only', 'Only the server admins (ADMIN_EMAILS) can do this')
    return auth
  }

  app.get('/signup-links', (c) => {
    admin(c)
    return c.json(s.repo.openSignupLinks().map(linkJson))
  })

  app.post('/signup-links', async (c) => {
    const auth = admin(c)
    const input = await body(
      c,
      z.object({
        expires_in_days: daysSchema.default(7),
        max_uses: usesSchema.default(1),
        domains: domainsSchema.optional(),
        label: z.string().trim().max(80).optional(),
      }),
    )
    // an open server needs no link — the plain sign-up page does
    if (s.config.signup.mode === 'open') throw conflict('signup_open', 'Everyone can create an account on this server — no registration link needed')
    const domains = domainsOrThrow(input.domains)
    if (s.repo.countSignupLinksSince(Date.now() - DAY) >= SIGNUP_LINKS_PER_DAY) throw rateLimited(3600)
    const { token, row } = s.repo.createSignupLink({ createdBy: auth.user.id, ttl: input.expires_in_days * DAY, maxUses: input.max_uses, domains, label: input.label || null })
    s.log.info('registration link created', { link: row.id, user: auth.user.id, max_uses: row.max_uses, days: input.expires_in_days })
    return c.json({ ...linkJson(row), link: `${s.config.publicUrl}/app/#/signup/${token}` }, 201)
  })

  app.delete('/signup-links/:linkId', (c) => {
    const auth = admin(c)
    const id = c.req.param('linkId')
    if (!s.repo.deleteSignupLink(id)) throw notFound('signup_link_not_found', 'Registration link not found')
    s.log.info('registration link revoked', { link: id, user: auth.user.id })
    return c.body(null, 204)
  })

  return app
}

/**
 * GET /api/signup/:token — what the registration screen (#/signup/<token>) shows. Unknown, revoked,
 * expired and used-up links are the same 404 `signup_link_not_found`; only server admins get
 * `signup_link_used` / `signup_link_expired`, and only they see how many places are left.
 */
export function signupRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.get('/:token', (c) => {
    const token = c.req.param('token')
    const link = isTokenShape(token) ? s.repo.signupLinkByToken(token) : undefined
    const auth = c.get('auth')
    const adminView = !!auth && isServerAdmin(s.config, auth.user)
    if (!link || !isOpenSignupLink(link)) {
      if (link && adminView) {
        if (link.uses >= link.max_uses) throw notFound('signup_link_used', 'This registration link was used up')
        throw notFound('signup_link_expired', 'This registration link has expired')
      }
      throw notFound('signup_link_not_found', 'This registration link does not exist, has expired, was used up or revoked')
    }
    return c.json({
      server: new URL(s.config.publicUrl).host,
      expires_at: iso(link.expires_at),
      domains: domainList(link.allowed_domains),
      ...(adminView ? { label: link.label, max_uses: link.max_uses, uses: link.uses, places_left: link.max_uses - link.uses } : {}),
    })
  })

  return app
}
