import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { Client, mailbox, runServerExpectingExit, signIn, sleep, startServer, tempDir } from './helpers.ts'

const CLI = new URL('../dist/cli.js', import.meta.url).pathname
const cli = (dataDir: string, ...args: string[]) =>
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { PATH: process.env.PATH, DATA_DIR: dataDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

describe('SIGNUP=invite', () => {
  test('only existing users and invited people get a link', async () => {
    const server = await startServer({ SIGNUP: 'invite' })
    try {
      const stranger = new Client(server.url)
      assert.equal((await stranger.post('/api/auth/request', { email: 'stranger@example.com' })).status, 204, 'same answer as for everyone')
      await sleep(100)
      assert.equal((await mailbox(server, 'stranger@example.com')).length, 0)

      // the first admin is created on the command line
      assert.match(cli(server.dataDir, 'create-user', 'admin@example.com', 'Ada', 'Admin'), /created admin@example\.com/)
      const admin = await signIn(server, 'admin@example.com')
      assert.equal((await admin.get('/api/me')).body.user.name, 'Ada Admin')
      const ws = (await admin.post('/api/workspaces', { name: 'Closed shop' })).body

      // email invite → that address may sign up
      await admin.post(`/api/workspaces/${ws.id}/invites`, { email: 'invited@example.com', role: 'member' })
      const invited = await signIn(server, 'invited@example.com')
      assert.equal((await invited.get('/api/me')).status, 200)

      // link invite → whoever holds the token may sign up (and only with it)
      const link = (await admin.post(`/api/workspaces/${ws.id}/invites`, { role: 'viewer' })).body.link as string
      const token = link.split('#/invite/')[1]
      const holder = new Client(server.url)
      await holder.post('/api/auth/request', { email: 'holder@example.com' })
      await sleep(100)
      assert.equal((await mailbox(server, 'holder@example.com')).length, 0)
      await holder.post('/api/auth/request', { email: 'holder@example.com', invite: token, redirect: `/app/#/invite/${token}` })
      const [mail] = await mailbox(server, 'holder@example.com')
      assert.ok(mail)
      const verify = await holder.fetch(new URL(mail.link).pathname + new URL(mail.link).search)
      assert.equal(verify.status, 302)
      assert.equal(verify.headers.get('location'), `/app/#/invite/${token}`)
      assert.deepEqual((await holder.post(`/api/invites/${token}/accept`)).body, { workspaceId: ws.id, role: 'viewer' })

      const config = (await (await fetch(`${server.url}/api/config`)).json()) as any
      assert.deepEqual(config.signup, { mode: 'invite' })
    } finally {
      await server.stop()
    }
  })
})

describe('SIGNUP=domains', () => {
  test('allowed domains sign up, others do not', async () => {
    const server = await startServer({ SIGNUP: 'domains:acme.com, Acme.DE' })
    try {
      const c = new Client(server.url)
      for (const email of ['a@acme.com', 'b@acme.de', 'c@evil.com', 'd@sub.acme.com', 'e@acme.com.evil.org']) await c.post('/api/auth/request', { email })
      await sleep(100)
      const to = (await mailbox(server)).map((m) => m.to).sort()
      assert.deepEqual(to, ['a@acme.com', 'b@acme.de'])
      assert.equal((await (await signIn(server, 'a@acme.com')).get('/api/me')).status, 200)
    } finally {
      await server.stop()
    }
  })
})

describe('configuration', () => {
  test('production refuses to start without SECRET, PUBLIC_URL, or with DEV_MODE', async () => {
    const base = { NODE_ENV: 'production', DATA_DIR: tempDir(), PUBLIC_URL: 'https://cloud.example.com', SECRET: 'a'.repeat(64) }
    const noSecret = await runServerExpectingExit({ ...base, SECRET: '' })
    assert.equal(noSecret.code, 78)
    assert.match(noSecret.output, /SECRET is required in production/)
    const shortSecret = await runServerExpectingExit({ ...base, SECRET: 'abcd' })
    assert.equal(shortSecret.code, 78)
    const noUrl = await runServerExpectingExit({ ...base, PUBLIC_URL: '' })
    assert.equal(noUrl.code, 78)
    assert.match(noUrl.output, /PUBLIC_URL is required/)
    const dev = await runServerExpectingExit({ ...base, DEV_MODE: '1' })
    assert.equal(dev.code, 78)
    assert.match(dev.output, /DEV_MODE must not be enabled/)
    const badSignup = await runServerExpectingExit({ ...base, SIGNUP: 'everyone' })
    assert.equal(badSignup.code, 78)
  })

  test('production over https: Secure cookie, no dev mailbox, links in the log without SMTP', async () => {
    const server = await startServer({ NODE_ENV: 'production', DEV_MODE: '', PUBLIC_URL: 'https://cloud.example.com', SECRET: 'ab'.repeat(32) })
    try {
      assert.equal((await fetch(`${server.url}/api/dev/mailbox`)).status, 404)
      const c = new Client(server.url)
      // a browser on https://cloud.example.com sends that Origin; the proxy keeps the Host
      const req = await c.fetch('/api/auth/request', { method: 'POST', json: { email: 'prod@example.com' }, headers: { origin: 'https://cloud.example.com' } })
      assert.equal(req.status, 204)
      assert.match(req.headers.getSetCookie().join('\n'), /one_login=.*; Secure/)
      await sleep(100)
      const link = /link=(https:\/\/cloud\.example\.com\/api\/auth\/verify\?token=[A-Za-z0-9_-]{43})/.exec(server.logs())?.[1]
      assert.ok(link, 'dev-mail mode logs the link for the operator')
      const verify = await c.fetch(new URL(link).pathname + new URL(link).search)
      assert.equal(verify.status, 302)
      const cookie = verify.headers.getSetCookie().find((s) => s.startsWith('one_session='))
      assert.match(cookie ?? '', /; Secure/)
      const health = await fetch(`${server.url}/api/health`)
      assert.match(health.headers.get('strict-transport-security') ?? '', /max-age=/)
    } finally {
      await server.stop()
    }
  })
})
