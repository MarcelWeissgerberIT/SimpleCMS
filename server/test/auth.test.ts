import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client, mailbox, signIn, startServer, type TestServer } from './helpers.ts'

let server: TestServer
before(async () => {
  server = await startServer()
})
after(async () => {
  await server.stop()
})

describe('magic-link sign-in', () => {
  test('request → mailbox → verify → cookie → /api/me', async () => {
    const browser = new Client(server.url)
    const req = await browser.post('/api/auth/request', { email: 'Alice@Example.com', redirect: '/app/#/p/abc' })
    assert.equal(req.status, 204)

    const [mail] = await mailbox(server, 'alice@example.com')
    assert.ok(mail, 'a mail was sent')
    assert.equal(mail.subject, 'Sign in to SimpleCMS One')
    assert.ok(mail.text.includes(mail.link))
    const link = new URL(mail.link)
    assert.equal(link.pathname, '/api/auth/verify')

    const verify = await browser.fetch(link.pathname + link.search)
    assert.equal(verify.status, 302)
    assert.equal(verify.headers.get('location'), '/app/#/p/abc')
    const cookie = verify.headers.getSetCookie().find((c) => c.startsWith('one_session='))
    assert.ok(cookie)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Path=\//)
    assert.doesNotMatch(cookie, /Secure/, 'no Secure flag on plain http')

    const me = await browser.get('/api/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.user.email, 'alice@example.com')
    assert.equal(me.body.user.name, null)
    // everyone gets a workspace of their own at the first sign-in (docs/CLOUD.md § Tenancy)
    assert.deepEqual(
      me.body.workspaces.map((w: { name: string; role: string; personal: boolean }) => [w.name, w.role, w.personal]),
      [['alice’s space', 'owner', true]],
    )

    // single use
    const again = await new Client(server.url).fetch(link.pathname + link.search)
    assert.equal(again.status, 400)
    assert.match(await again.text(), /expired|already used/)
  })

  test('opening the link in another browser asks for confirmation instead of burning it', async () => {
    await new Client(server.url).post('/api/auth/request', { email: 'scanner@example.com' })
    const [mail] = await mailbox(server, 'scanner@example.com')
    const link = new URL(mail!.link)
    const token = link.searchParams.get('token')!

    // e.g. a mail security scanner fetching the link: gets a page, the token stays valid
    for (let i = 0; i < 2; i++) {
      const page = await new Client(server.url).fetch(link.pathname + link.search)
      assert.equal(page.status, 200)
      assert.match(page.headers.get('content-type') ?? '', /text\/html/)
      const html = await page.text()
      assert.match(html, /<form method="post" action="\/api\/auth\/verify">/)
      assert.match(html, /scanner@example\.com/)
      // `no-referrer` would make browsers post the form with `Origin: null`, which the CSRF guard refuses
      assert.equal(page.headers.get('referrer-policy'), 'same-origin')
      assert.match(page.headers.get('content-security-policy') ?? '', /form-action 'self'/)
    }

    // a cross-site form post is refused
    const evil = await new Client(server.url).fetch('/api/auth/verify', {
      method: 'POST',
      body: new URLSearchParams({ token }),
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    })
    assert.equal(evil.status, 403)

    const device = new Client(server.url)
    const confirm = await device.fetch('/api/auth/verify', {
      method: 'POST',
      body: new URLSearchParams({ token }),
      headers: { origin: server.url, 'content-type': 'application/x-www-form-urlencoded' },
    })
    assert.equal(confirm.status, 303)
    assert.equal(confirm.headers.get('location'), '/app/')
    assert.equal((await device.get('/api/me')).body.user.email, 'scanner@example.com')
  })

  test('mails follow the app language, then Accept-Language', async () => {
    const c = new Client(server.url)
    await c.fetch('/api/auth/request', { method: 'POST', json: { email: 'de1@example.com' }, headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.5' } })
    assert.equal((await mailbox(server, 'de1@example.com'))[0]?.subject, 'Bei SimpleCMS One anmelden')
    await c.fetch('/api/auth/request', { method: 'POST', json: { email: 'de2@example.com', lang: 'en' }, headers: { 'accept-language': 'de' } })
    assert.equal((await mailbox(server, 'de2@example.com'))[0]?.subject, 'Sign in to SimpleCMS One')
  })

  test('redirects never leave the site', async () => {
    for (const redirect of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
      const c = new Client(server.url)
      const email = `redir${Math.random().toString(36).slice(2, 8)}@example.com`
      await c.post('/api/auth/request', { email, redirect })
      const link = new URL((await mailbox(server, email))[0]!.link)
      const res = await c.fetch(link.pathname + link.search)
      assert.equal(res.headers.get('location'), '/app/')
    }
  })

  test('invalid and malformed tokens show the error page', async () => {
    const res = await new Client(server.url).fetch('/api/auth/verify?token=nope')
    assert.equal(res.status, 400)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
  })

  test('logout revokes the session', async () => {
    const c = await signIn(server, 'logout@example.com')
    const cookie = c.cookieHeader()
    assert.equal((await c.post('/api/auth/logout')).status, 204)
    assert.equal(c.cookies.has('one_session'), false, 'cookie cleared')
    const stale = await fetch(`${server.url}/api/me`, { headers: { cookie } })
    assert.equal(stale.status, 401)
  })

  test('PATCH /api/me sets the display name', async () => {
    const c = await signIn(server, 'named@example.com')
    const res = await c.patch('/api/me', { name: '  Nora Named ' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { id: res.body.id, email: 'named@example.com', name: 'Nora Named' })
    assert.equal((await c.get('/api/me')).body.user.name, 'Nora Named')
    assert.equal((await c.patch('/api/me', { name: 'x'.repeat(81) })).body.error.code, 'invalid_request')
  })

  test('errors are JSON with a stable code', async () => {
    const anon = new Client(server.url)
    const me = await anon.get('/api/me')
    assert.equal(me.status, 401)
    assert.deepEqual(me.body, { error: { code: 'unauthenticated', message: 'Sign in first' } })
    const bad = await anon.post('/api/auth/request', { email: 'not-an-email' })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'invalid_request')
    const missing = await anon.get('/api/nothing-here')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found')
  })
})

describe('CSRF guard', () => {
  test('mutating requests need application/json', async () => {
    const c = await signIn(server, 'csrf@example.com')
    const plain = await c.fetch('/api/workspaces', { method: 'POST', body: '{"name":"x"}', headers: { 'content-type': 'text/plain' } })
    assert.equal(plain.status, 400)
    assert.equal(((await plain.json()) as any).error.code, 'json_required')
    const form = await c.fetch('/api/workspaces', { method: 'POST', body: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    assert.equal(form.status, 400)
    const none = await c.fetch('/api/auth/logout', { method: 'POST' })
    assert.equal(none.status, 400, 'no content type at all')
    assert.equal((await c.get('/api/me')).status, 200, 'still signed in')
  })

  test('cross-origin requests are rejected even with JSON', async () => {
    const c = await signIn(server, 'csrf2@example.com')
    const res = await c.fetch('/api/workspaces', { method: 'POST', json: { name: 'x' }, headers: { origin: 'https://evil.example' } })
    assert.equal(res.status, 403)
    assert.equal(((await res.json()) as any).error.code, 'bad_origin')
    const site = await c.fetch('/api/workspaces', { method: 'POST', json: { name: 'x' }, headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(site.status, 403)
    const same = await c.fetch('/api/workspaces', { method: 'POST', json: { name: 'ok' }, headers: { origin: server.url, 'sec-fetch-site': 'same-origin' } })
    assert.equal(same.status, 201)
  })
})

describe('server basics', () => {
  test('health, config and security headers', async () => {
    const res = await fetch(`${server.url}/api/health`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { ok: boolean; version: string }
    assert.equal(body.ok, true)
    assert.match(body.version, /^\d+\.\d+\.\d+/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    assert.ok(res.headers.get('referrer-policy'))

    const config = (await (await fetch(`${server.url}/api/config`)).json()) as any
    assert.deepEqual(config.signup, { mode: 'open' })
    assert.equal(config.max_upload_mb, 25)
    assert.equal(config.dev_mode, true)
    assert.match(config.source_url, /^https:\/\//)
  })
})

describe('rate limits', () => {
  test('5 sign-in requests per email and 20 per IP in 15 minutes', async () => {
    const own = await startServer()
    try {
      const c = new Client(own.url)
      for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/request', { email: 'spam@example.com' })).status, 204)
      const limited = await c.post('/api/auth/request', { email: 'spam@example.com' })
      assert.equal(limited.status, 429)
      assert.equal(limited.body.error.code, 'rate_limited')
      assert.ok(Number(limited.res.headers.get('retry-after')) > 0)
      assert.equal((await mailbox(own, 'spam@example.com')).length, 5)

      // 6 requests used by this IP so far; other addresses still work until the IP budget (20) is spent
      let ok = 0
      for (let i = 0; i < 20; i++) if ((await c.post('/api/auth/request', { email: `ip${i}@example.com` })).status === 204) ok++
      assert.equal(ok, 14)
    } finally {
      await own.stop()
    }
  })
})
