import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { mayCreateAccount } from '../auth/signup.ts'
import type { AppEnv, Services } from '../context.ts'
import { isSealedText, keyFromSecret, openText, sealText } from '../crypto/aead.ts'
import { rateLimited } from '../errors.ts'
import { confirmSignInPage, linkInvalidPage } from '../http/pages.ts'
import { body, clientIp, safeRedirect } from '../http/util.ts'
import { pickLang, personalSpaceName } from '../i18n.ts'
import { magicLinkMail } from '../mail/templates.ts'
import { normalizeEmail, type UserRow } from '../repo.ts'
import { MINUTE, isTokenShape, randomToken, safeEqual } from '../tokens.ts'

const LINK_TTL = 15 * MINUTE
/** The redirect is sealed with a key only the link's token gives (it may carry an invite token). */
const REDIRECT_KEY = 'one/login-redirect/v1'
const sealRedirect = (token: string, redirect: string) => sealText(keyFromSecret(token, REDIRECT_KEY), redirect, 'login-redirect')
function openRedirect(token: string, stored: string | null): string | null {
  if (!stored || !isSealedText(stored)) return stored // a row from before (plain path)
  try {
    return openText(keyFromSecret(token, REDIRECT_KEY), stored, 'login-redirect')
  } catch {
    return null
  }
}
/** Marks the browser that asked for a link: opening the link there signs in with one click. */
const LOGIN_COOKIE = 'one_login'

interface LoginTokenRow {
  token_hash: string
  email: string
  created_at: number
  expires_at: number
  used_at: number | null
  redirect: string | null
  browser_hash: string | null
  invite_hash: string | null
  lang: string | null
}

const requestSchema = z.object({
  email: z.email().max(254),
  redirect: z.string().max(512).optional(),
  lang: z.enum(['en', 'de']).optional(),
  /** Invite token the person is holding (lets a new account through SIGNUP=invite / domains). */
  invite: z.string().max(100).optional(),
})

export function authRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  const secure = s.sessions.secure

  const openToken = (token: string | undefined) =>
    isTokenShape(token)
      ? s.db.get<LoginTokenRow>('SELECT * FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', s.repo.hash(token), Date.now())
      : undefined

  app.post('/request', async (c) => {
    const input = await body(c, requestSchema)
    const email = normalizeEmail(input.email)
    const ipWait = s.limiter.hit(`auth:ip:${clientIp(c, s.config)}`, s.config.authIpLimit, 15 * MINUTE)
    if (ipWait) throw rateLimited(ipWait)
    const emailWait = s.limiter.hit(`auth:email:${email}`, 5, 15 * MINUTE)
    if (emailWait) throw rateLimited(emailWait)

    // identical response either way (no account enumeration): 204 + the browser cookie
    const browser = randomToken()
    setCookie(c, LOGIN_COOKIE, browser, { path: '/api/auth', httpOnly: true, sameSite: 'Lax', secure, maxAge: LINK_TTL / 1000 })

    const inviteHash = isTokenShape(input.invite) ? s.repo.hash(input.invite) : null
    if (!s.repo.userByEmail(email) && !mayCreateAccount(s.config.signup, s.repo, email, inviteHash)) {
      s.log.info('sign-in link not sent: signup not allowed for this address', { email, signup: s.config.signup.mode })
      return c.body(null, 204)
    }

    const token = randomToken()
    const lang = pickLang(input.lang, c.req.header('accept-language'))
    const now = Date.now()
    s.db.run(
      `INSERT INTO login_tokens (token_hash, email, created_at, expires_at, redirect, browser_hash, invite_hash, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      s.repo.hash(token), email, now, now + LINK_TTL, sealRedirect(token, safeRedirect(input.redirect)), s.repo.hash(browser), inviteHash, lang,
    )
    const link = `${s.config.publicUrl}/api/auth/verify?token=${token}`
    // not awaited: SMTP latency must not reveal whether an account exists
    s.mailer
      .send({ to: email, link, ...magicLinkMail(lang, { link, email, minutes: LINK_TTL / MINUTE }) })
      .catch((err: Error) => s.log.error('sending sign-in mail failed', { to: email, error: err.message }))
    return c.body(null, 204)
  })

  app.get('/verify', (c) => {
    const token = c.req.query('token')
    const row = openToken(token)
    const lang = pickLang(row?.lang, c.req.header('accept-language'))
    if (!row || !token) return htmlPage(c, linkInvalidPage(lang, 'invalid'), 400)
    const browser = getCookie(c, LOGIN_COOKIE)
    if (browser && row.browser_hash && safeEqual(s.repo.hash(browser), row.browser_hash)) return complete(c, token, row)
    // another browser/device, or a mail scanner pre-fetching links: confirm with a button (does not burn the token)
    return htmlPage(c, confirmSignInPage(lang, { email: row.email, token }), 200)
  })

  app.post('/verify', async (c) => {
    const type = c.req.header('content-type') ?? ''
    let token: unknown
    try {
      token = type.includes('application/json') ? ((await c.req.json()) as { token?: unknown }).token : (await c.req.parseBody()).token
    } catch {
      token = undefined
    }
    const row = openToken(typeof token === 'string' ? token : undefined)
    if (!row || typeof token !== 'string') return htmlPage(c, linkInvalidPage(pickLang(null, c.req.header('accept-language')), 'invalid'), 400)
    return complete(c, token, row)
  })

  app.post('/logout', (c) => {
    const auth = c.get('auth')
    if (auth) {
      s.sessions.revoke(auth.session.id)
      s.collab.closeSession(auth.session.id, 'session-ended')
    }
    s.sessions.clearCookie(c)
    return c.body(null, 204)
  })

  /** Burns the token (single use, race-safe), finds or creates the user, starts a session. */
  function complete(c: Context<AppEnv>, token: string, row: LoginTokenRow) {
    const lang = pickLang(row.lang, c.req.header('accept-language'))
    const now = Date.now()
    const used = s.db.run('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', now, s.repo.hash(token), now)
    if (!used) return htmlPage(c, linkInvalidPage(lang, 'invalid'), 400)

    let user = s.repo.userByEmail(row.email)
    if (!user) {
      // re-checked here: the invite that allowed the request may have been revoked meanwhile
      if (!mayCreateAccount(s.config.signup, s.repo, row.email, row.invite_hash)) return htmlPage(c, linkInvalidPage(lang, 'signup_closed'), 403)
      user = s.repo.findOrCreateUser(row.email).user
      s.log.info('account created', { user: user.id })
    }
    ensurePersonalSpace(user, lang)

    const previous = s.sessions.resolve(s.sessions.readCookie(c))
    if (previous) {
      s.sessions.revoke(previous.session.id)
      s.collab.closeSession(previous.session.id, 'session-ended')
    }
    const session = s.sessions.create(user.id, c.req.header('user-agent') ?? null)
    s.sessions.setCookie(c, session.token)
    deleteCookie(c, LOGIN_COOKIE, { path: '/api/auth', httpOnly: true, sameSite: 'Lax', secure })
    c.header('Cache-Control', 'no-store')
    return c.redirect(safeRedirect(openRedirect(token, row.redirect)), c.req.method === 'POST' ? 303 : 302)
  }

  /**
   * Everyone who signs in has a workspace of their own (docs/CLOUD.md § Tenancy): created at the first
   * sign-in, named in the sign-in's language, nobody else in it. Never blocks the sign-in.
   */
  function ensurePersonalSpace(user: UserRow, lang: 'en' | 'de') {
    try {
      const ws = s.repo.ensurePersonalWorkspace(user.id, personalSpaceName(lang, user.name || user.email.split('@')[0] || user.email))
      if (ws) s.log.info('personal workspace created', { workspace: ws.id, user: user.id })
    } catch (err) {
      s.log.error('creating the personal workspace failed', { user: user.id, error: err as Error })
    }
  }

  return app
}

/**
 * The token never leaves the site: no external resources, and `same-origin` (not `no-referrer`, which
 * would make the confirmation form POST with `Origin: null` and fail the CSRF check).
 */
function htmlPage(c: Context<AppEnv>, html: string, status: 200 | 400 | 403) {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'same-origin')
  return c.html(html, status)
}
