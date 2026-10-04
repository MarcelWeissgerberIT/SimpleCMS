/**
 * Reusable invite links, invites to several addresses at once, and registration links (docs/CLOUD.md
 * § Invites & registration links): one link for many people (max uses, validity, domain restriction),
 * joining twice is no use, used up / expired / revoked links are dead (the same 404 to everyone but the
 * admins), registration links let people create an account on an invite-only server — checked when the
 * link is requested and again when the account is created — and no token ever reaches a log or the disk.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { redactPath } from '../src/app.ts'
import { migrate, Db } from '../src/db/index.ts'
import { migrations } from '../src/db/migrations.ts'
import { Client, decodeMail, mailbox, runServerExpectingExit, signIn, sleep, smtpSink, startServer, tempDir, type TestServer, waitFor } from './helpers.ts'

const inviteToken = (link: string) => link.split('#/invite/')[1]!
const signupToken = (link: string) => link.split('#/signup/')[1]!

/** Push a link's expiry into the past, straight in the server's database (WAL: the server sees it at once). */
function expire(server: TestServer, table: 'invites' | 'signup_links', id: string) {
  const db = new DatabaseSync(join(server.dataDir, 'one.sqlite'))
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.prepare(`UPDATE ${table} SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, id)
  } finally {
    db.close()
  }
}

/** Request a sign-in link (optionally holding an invite / registration token); the mail's link, or null when none came. */
async function requestLink(server: TestServer, client: Client, email: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  const before = (await mailbox(server, email)).length
  const res = await client.post('/api/auth/request', { email, ...extra })
  assert.equal(res.status, 204, `request for ${email}: ${JSON.stringify(res.body)}`)
  await sleep(60)
  const mails = await mailbox(server, email)
  return mails.length > before ? mails[0]!.link : null
}

/** Open a magic link in `client` (the browser that asked for it). */
async function openLink(client: Client, link: string): Promise<Response> {
  const url = new URL(link)
  return client.fetch(url.pathname + url.search)
}

/* ------------------------------------------------------------------ reusable invites */

describe('reusable invite links', () => {
  let server: TestServer
  let owner: Client
  let ws: string
  before(async () => {
    server = await startServer({ AUTH_IP_LIMIT: '1000' })
    owner = await signIn(server, 'owner@reuse.test')
    await owner.patch('/api/me', { name: 'Olga' })
    ws = (await owner.post('/api/workspaces', { name: 'Reuse Co' })).body.id
  })
  after(async () => {
    await server.stop()
  })

  test('three people join through one link, the fourth is refused; joining twice is no use', async () => {
    const created = await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', max_uses: 3, expires_in_days: 30 })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.max_uses, 3)
    assert.equal(created.body.uses, 0)
    assert.equal(created.body.email, null)
    const days = (Date.parse(created.body.expires_at) - Date.now()) / 86400_000
    assert.ok(days > 29.9 && days <= 30, `valid 30 days (${days})`)
    const token = inviteToken(created.body.link)

    // invitees see the invitation, never how many places are left; the workspace's admins do
    const anonymous = (await new Client(server.url).get(`/api/invites/${token}`)).body
    assert.equal(anonymous.workspace.name, 'Reuse Co')
    assert.equal(anonymous.domains, null)
    assert.equal(anonymous.places_left, undefined)
    assert.equal(anonymous.uses, undefined)
    assert.equal((await owner.get(`/api/invites/${token}`)).body.places_left, 3)

    const people = await Promise.all(['ann', 'ben', 'cid', 'dot'].map((n) => signIn(server, `${n}@reuse.test`)))
    const [ann, ben, cid, dot] = people as [Client, Client, Client, Client]
    assert.deepEqual((await ann.post(`/api/invites/${token}/accept`)).body, { workspaceId: ws, role: 'member' })
    // Ann again (another tab): still a member, no place used
    assert.deepEqual((await ann.post(`/api/invites/${token}/accept`)).body, { workspaceId: ws, role: 'member' })
    assert.equal((await ann.get(`/api/invites/${token}`)).body.places_left, undefined, 'members who are no admins see no count')
    assert.equal((await owner.get(`/api/invites/${token}`)).body.places_left, 2)
    assert.equal((await ben.post(`/api/invites/${token}/accept`)).status, 200)
    assert.equal((await cid.post(`/api/invites/${token}/accept`)).status, 200)

    const refused = await dot.post(`/api/invites/${token}/accept`)
    assert.equal(refused.status, 404)
    assert.equal(refused.body.error.code, 'invite_not_found', 'used up looks like unknown to non-admins')
    assert.equal((await dot.get(`/api/invites/${token}`)).body.error.code, 'invite_not_found')
    assert.equal((await owner.get(`/api/invites/${token}`)).body.error.code, 'invite_used', 'admins learn why')
    const members = (await owner.get(`/api/workspaces/${ws}/members`)).body.map((m: { user: { email: string } }) => m.user.email).sort()
    assert.deepEqual(members, ['ann@reuse.test', 'ben@reuse.test', 'cid@reuse.test', 'owner@reuse.test'])
    // used up: no longer in the open list
    assert.equal((await owner.get(`/api/workspaces/${ws}/invites`)).body.some((i: { id: string }) => i.id === created.body.id), false)
  })

  test('the admins\' list shows uses and who joined last', async () => {
    const created = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'viewer', max_uses: 10 })).body
    const eve = await signIn(server, 'eve@reuse.test')
    await eve.patch('/api/me', { name: 'Eve' })
    assert.equal((await eve.post(`/api/invites/${inviteToken(created.link)}/accept`)).body.role, 'viewer')
    const listed = (await owner.get(`/api/workspaces/${ws}/invites`)).body.find((i: { id: string }) => i.id === created.id)
    assert.equal(listed.max_uses, 10)
    assert.equal(listed.uses, 1)
    assert.equal(listed.last_joined.name, 'Eve')
    assert.equal(listed.last_joined.email, 'eve@reuse.test')
    assert.ok(Date.parse(listed.last_joined_at) > Date.now() - 60_000)
    assert.deepEqual(listed.inviter, { id: listed.inviter.id, name: 'Olga', email: 'owner@reuse.test' })
    // non-admins don't get the list
    assert.equal((await eve.get(`/api/workspaces/${ws}/invites`)).status, 403)
  })

  test('expired and revoked links are dead — at preview and at accept', async () => {
    const fay = await signIn(server, 'fay@reuse.test')
    const expiring = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', max_uses: 5, expires_in_days: 1 })).body
    assert.ok(Date.parse(expiring.expires_at) - Date.now() <= 86400_000)
    expire(server, 'invites', expiring.id)
    const t1 = inviteToken(expiring.link)
    assert.equal((await fay.get(`/api/invites/${t1}`)).body.error.code, 'invite_not_found')
    assert.equal((await fay.post(`/api/invites/${t1}/accept`)).body.error.code, 'invite_not_found')
    assert.equal((await owner.get(`/api/invites/${t1}`)).body.error.code, 'invite_expired')

    const revoked = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', max_uses: 5 })).body
    assert.equal((await owner.del(`/api/workspaces/${ws}/invites/${revoked.id}`)).status, 204)
    const t2 = inviteToken(revoked.link)
    assert.equal((await fay.post(`/api/invites/${t2}/accept`)).body.error.code, 'invite_not_found')
    assert.equal((await owner.get(`/api/invites/${t2}`)).body.error.code, 'invite_not_found', 'a revoked link is gone for everyone')
    assert.equal((await owner.get(`/api/workspaces/${ws}/members`)).body.some((m: { user: { email: string } }) => m.user.email === 'fay@reuse.test'), false)
  })

  test('only addresses at the allowed domains may join', async () => {
    const created = await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', max_uses: 5, domains: ['@Acme.test', 'acme.test', 'partner.test'] })
    assert.equal(created.status, 201)
    assert.deepEqual(created.body.domains, ['acme.test', 'partner.test'])
    const token = inviteToken(created.body.link)
    assert.deepEqual((await new Client(server.url).get(`/api/invites/${token}`)).body.domains, ['acme.test', 'partner.test'])

    const outsider = await signIn(server, 'gil@elsewhere.test')
    const refused = await outsider.post(`/api/invites/${token}/accept`)
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error.code, 'invite_domain_mismatch')
    const sub = await signIn(server, 'hal@sub.acme.test')
    assert.equal((await sub.post(`/api/invites/${token}/accept`)).body.error.code, 'invite_domain_mismatch', 'subdomains do not count')
    const insider = await signIn(server, 'ida@acme.test')
    assert.equal((await insider.post(`/api/invites/${token}/accept`)).status, 200)
    assert.equal((await owner.get(`/api/invites/${token}`)).body.places_left, 4, 'refusals use no place')
  })

  test('what a link may be: validation', async () => {
    const bad = async (json: Record<string, unknown>) => {
      const res = await owner.post(`/api/workspaces/${ws}/invites`, json)
      assert.equal(res.status, 400, JSON.stringify(json))
      assert.equal(res.body.error.code, 'invalid_request')
    }
    await bad({ role: 'admin', max_uses: 5 }) // reusable links never make admins
    await bad({ role: 'member', email: 'one@reuse.test', max_uses: 2 }) // an address-bound invite is for one person
    await bad({ role: 'member', email: 'one@reuse.test', domains: ['reuse.test'] })
    await bad({ role: 'member', max_uses: 101 })
    await bad({ role: 'member', max_uses: 0 })
    await bad({ role: 'member', expires_in_days: 31 })
    await bad({ role: 'member', domains: ['not a domain'] })
    await bad({ role: 'member', domains: Array.from({ length: 11 }, (_, i) => `d${i}.test`) })
    // single-use admin links (with or without an address) keep working
    assert.equal((await owner.post(`/api/workspaces/${ws}/invites`, { role: 'admin' })).status, 201)
    assert.equal((await owner.post(`/api/workspaces/${ws}/invites`, { role: 'admin', email: 'boss@reuse.test' })).body.max_uses, 1)
  })

  test('the last place goes to one person only (concurrent joins)', async () => {
    const created = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member', max_uses: 2 })).body
    const token = inviteToken(created.link)
    const racers = await Promise.all(['r1', 'r2', 'r3', 'r4', 'r5'].map((n) => signIn(server, `${n}@race.test`)))
    const results = await Promise.all(racers.map((c) => c.post(`/api/invites/${token}/accept`)))
    assert.equal(results.filter((r) => r.status === 200).length, 2)
    assert.equal(results.filter((r) => r.status === 404).length, 3)
    const members = (await owner.get(`/api/workspaces/${ws}/members`)).body.filter((m: { user: { email: string } }) => m.user.email.endsWith('@race.test'))
    assert.equal(members.length, 2)
  })
})

/* ------------------------------------------------------------------ several addresses at once */

describe('invite several addresses at once', () => {
  test('one invite + mail each; per-address results; capped', async () => {
    // mails to bounce@… fail like a bounce at the SMTP server; DEV_MODE keeps the dev mailbox for sign-ins
    const sink = await smtpSink({ reject: (rcpt) => rcpt.startsWith('bounce@') })
    const server = await startServer({ SMTP_URL: `smtp://127.0.0.1:${sink.port}` })
    try {
      const owner = await signIn(server, 'owner@batch.test')
      const ws = (await owner.post('/api/workspaces', { name: 'Batch Co' })).body.id
      const member = await signIn(server, 'member@batch.test')
      const link = (await owner.post(`/api/workspaces/${ws}/invites`, { role: 'member' })).body.link
      await member.post(`/api/invites/${inviteToken(link)}/accept`)

      const res = await owner.fetch(`/api/workspaces/${ws}/invites/emails`, {
        method: 'POST',
        json: { emails: ['New.One@Batch.test', 'new.one@batch.test', 'two@batch.test', 'member@batch.test', 'not-an-address', 'bounce@batch.test'], role: 'viewer', expires_in_days: 1 },
        headers: { 'accept-language': 'de' },
      })
      assert.equal(res.status, 200)
      const { results } = (await res.json()) as { results: Array<{ email: string; status: string; link?: string; id?: string }> }
      assert.deepEqual(
        results.map((r) => [r.email, r.status]),
        [
          ['new.one@batch.test', 'sent'],
          ['two@batch.test', 'sent'],
          ['member@batch.test', 'already_member'],
          ['not-an-address', 'invalid'],
          ['bounce@batch.test', 'failed'],
        ],
      )
      // a failed mail still leaves a working invite: its link is in the answer for the admin to pass on
      const failed = results.find((r) => r.status === 'failed')!
      assert.match(failed.link!, /#\/invite\/[A-Za-z0-9_-]{43}$/)
      assert.equal(results.find((r) => r.status === 'already_member')!.link, undefined)

      // (sign-in mails go through the sink too)
      const invitations = () => sink.mails.map(decodeMail).filter((m) => /#\/invite\//.test(m))
      await waitFor(() => invitations().length >= 2, 5000, 'two invitations')
      const sent = invitations()
      assert.equal(sent.length, 2)
      // (decodeMail reads the UTF-8 bytes as Latin-1: compare ASCII only)
      assert.ok(sent.some((m) => m.includes('new.one@batch.test') && /dich als Leser/.test(m) && /einen Tag g/.test(m)), 'German, viewer, one day')
      assert.ok(sent.every((m) => !m.includes('bounce@batch.test')))

      // every invite is single-use and bound to its address
      const open = (await owner.get(`/api/workspaces/${ws}/invites`)).body as Array<{ email: string; max_uses: number; role: string }>
      assert.deepEqual(open.map((i) => i.email).sort(), ['bounce@batch.test', 'new.one@batch.test', 'two@batch.test'])
      assert.ok(open.every((i) => i.max_uses === 1 && i.role === 'viewer'))
      const two = await signIn(server, 'two@batch.test')
      const twoToken = inviteToken(results.find((r) => r.email === 'two@batch.test')!.link!)
      assert.equal((await two.post(`/api/invites/${twoToken}/accept`)).body.role, 'viewer')
      const stranger = await signIn(server, 'stranger@batch.test')
      assert.equal((await stranger.post(`/api/invites/${inviteToken(failed.link!)}/accept`)).body.error.code, 'invite_email_mismatch')

      // capped at 20 addresses per go; members below admin can't
      const many = Array.from({ length: 21 }, (_, i) => `p${i}@batch.test`)
      assert.equal((await owner.post(`/api/workspaces/${ws}/invites/emails`, { emails: many })).status, 400)
      assert.equal((await owner.post(`/api/workspaces/${ws}/invites/emails`, { emails: [] })).status, 400)
      assert.equal((await member.post(`/api/workspaces/${ws}/invites/emails`, { emails: ['x@batch.test'] })).status, 403)
      // the daily invite budget (50 per workspace) covers batches too
      for (let i = 0; i < 2; i++) assert.equal((await owner.post(`/api/workspaces/${ws}/invites/emails`, { emails: many.slice(0, 20).map((e) => `${i}${e}`) })).status, 200)
      const over = await owner.post(`/api/workspaces/${ws}/invites/emails`, { emails: many.slice(0, 20) })
      assert.equal(over.status, 429)
    } finally {
      await server.stop()
      await sink.close()
    }
  })
})

/* ------------------------------------------------------------------ registration links */

describe('registration links (SIGNUP=invite)', () => {
  let server: TestServer
  let root: Client
  before(async () => {
    server = await startServer({ SIGNUP: 'invite', ADMIN_EMAILS: 'Root@Reg.test, second-admin@reg.test', AUTH_IP_LIMIT: '1000' })
    // a server admin needs no invitation and no CLI to create the account
    root = await signIn(server, 'root@reg.test')
  })
  after(async () => {
    await server.stop()
  })

  test('only server admins create, list and revoke them', async () => {
    const me = (await root.get('/api/me')).body
    assert.equal(me.server_admin, true)
    const created = await root.post('/api/server/signup-links', { max_uses: 5, expires_in_days: 7, label: '  Spring cohort ' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.match(created.body.link, /\/app\/#\/signup\/[A-Za-z0-9_-]{43}$/)
    assert.equal(created.body.label, 'Spring cohort')
    assert.equal(created.body.max_uses, 5)
    assert.equal(created.body.uses, 0)
    const listed = (await root.get('/api/server/signup-links')).body
    assert.equal(listed[0].id, created.body.id)
    assert.equal(listed[0].created_by.email, 'root@reg.test')
    assert.equal(listed[0].link, undefined, 'the link is shown once')

    // someone who is not a server admin (here: invited to root's space) gets 403, signed out 401
    const space = (await root.get('/api/me')).body.workspaces[0].id
    const invite = (await root.post(`/api/workspaces/${space}/invites`, { role: 'admin', email: 'helper@reg.test' })).body
    const helper = await signIn(server, 'helper@reg.test')
    assert.equal((await helper.post(`/api/invites/${inviteToken(invite.link)}/accept`)).status, 200)
    assert.equal((await helper.get('/api/me')).body.server_admin, undefined)
    for (const [method, path] of [['GET', '/api/server/signup-links'], ['POST', '/api/server/signup-links'], ['DELETE', `/api/server/signup-links/${created.body.id}`]] as const) {
      const res = await helper.json(method, path, method === 'GET' ? undefined : {})
      assert.equal(res.status, 403, `${method} ${path}`)
      assert.equal(res.body.error.code, 'server_admin_only')
      assert.equal((await new Client(server.url).json(method, path, method === 'GET' ? undefined : {})).status, 401)
    }

    assert.equal((await root.del(`/api/server/signup-links/${created.body.id}`)).status, 204)
    assert.equal((await root.del(`/api/server/signup-links/${created.body.id}`)).status, 404)
    assert.equal((await root.post('/api/server/signup-links', { max_uses: 101 })).status, 400)
    assert.equal((await root.post('/api/server/signup-links', { domains: ['nope'] })).status, 400)
  })

  test('a holder creates an account and lands in a space of their own — nothing else', async () => {
    const created = (await root.post('/api/server/signup-links', { max_uses: 2 })).body
    const token = signupToken(created.link)

    // the preview: no count for the holder, the count for server admins
    const preview = (await new Client(server.url).get(`/api/signup/${token}`)).body
    assert.equal(preview.server, `localhost:${server.port}`) // PUBLIC_URL's host
    assert.equal(preview.domains, null)
    assert.equal(preview.places_left, undefined)
    assert.equal(preview.label, undefined)
    assert.equal((await root.get(`/api/signup/${token}`)).body.places_left, 2)

    // without the link: no mail (the same 204 as always); with it: the account
    const stranger = new Client(server.url)
    assert.equal(await requestLink(server, stranger, 'stranger@new.test'), null)
    const nina = new Client(server.url)
    const link = await requestLink(server, nina, 'nina@new.test', { signup: token, redirect: `/app/?signed-in=1#/signup/${token}`, lang: 'de' })
    assert.ok(link, 'the holder gets a sign-in link')
    const verified = await openLink(nina, link)
    assert.equal(verified.status, 302)
    assert.equal(verified.headers.get('location'), `/app/?signed-in=1#/signup/${token}`)
    const me = (await nina.get('/api/me')).body
    assert.equal(me.user.email, 'nina@new.test')
    assert.deepEqual(me.workspaces.map((w: { name: string; role: string; personal: boolean }) => [w.name, w.role, w.personal]), [['Bereich von nina', 'owner', true]])
    assert.equal((await root.get(`/api/signup/${token}`)).body.places_left, 1)
    const listed = (await root.get('/api/server/signup-links')).body.find((l: { id: string }) => l.id === created.id)
    assert.equal(listed.uses, 1)
    assert.ok(Date.parse(listed.last_used_at) > Date.now() - 60_000)

    // signing in again (an existing account) uses no place
    assert.ok(await requestLink(server, nina, 'nina@new.test', { signup: token }))
    assert.equal((await root.get(`/api/signup/${token}`)).body.places_left, 1)
  })

  test('used up, expired or revoked: refused when the link is requested and when it is opened', async () => {
    // one place, two people asked: the first to open the mail gets it, the second is refused
    const one = (await root.post('/api/server/signup-links', { max_uses: 1 })).body
    const t1 = signupToken(one.link)
    const ola = new Client(server.url)
    const pia = new Client(server.url)
    const olaLink = await requestLink(server, ola, 'ola@new.test', { signup: t1 })
    const piaLink = await requestLink(server, pia, 'pia@new.test', { signup: t1 })
    assert.ok(olaLink && piaLink)
    assert.equal((await openLink(ola, olaLink)).status, 302)
    const late = await openLink(pia, piaLink)
    assert.equal(late.status, 403)
    assert.match(await late.text(), /registration link expired, was used up or revoked meanwhile/)
    assert.equal((await pia.get('/api/me')).status, 401)
    // used up now: no more mails, and the preview is dead (with the reason for admins only)
    assert.equal(await requestLink(server, new Client(server.url), 'quin@new.test', { signup: t1 }), null)
    assert.equal((await new Client(server.url).get(`/api/signup/${t1}`)).body.error.code, 'signup_link_not_found')
    assert.equal((await root.get(`/api/signup/${t1}`)).body.error.code, 'signup_link_used')

    // revoked between the request and opening the mail
    const two = (await root.post('/api/server/signup-links', { max_uses: 5 })).body
    const t2 = signupToken(two.link)
    const rex = new Client(server.url)
    const rexLink = await requestLink(server, rex, 'rex@new.test', { signup: t2 })
    assert.ok(rexLink)
    assert.equal((await root.del(`/api/server/signup-links/${two.id}`)).status, 204)
    assert.equal((await openLink(rex, rexLink)).status, 403)
    assert.equal(await requestLink(server, new Client(server.url), 'rex@new.test', { signup: t2 }), null)
    assert.equal((await root.get(`/api/signup/${t2}`)).body.error.code, 'signup_link_not_found', 'revoked = gone, for admins too')

    // expired between the request and opening the mail
    const three = (await root.post('/api/server/signup-links', { max_uses: 5, expires_in_days: 1 })).body
    const t3 = signupToken(three.link)
    const sam = new Client(server.url)
    const samLink = await requestLink(server, sam, 'sam@new.test', { signup: t3 })
    assert.ok(samLink)
    expire(server, 'signup_links', three.id)
    assert.equal((await openLink(sam, samLink)).status, 403)
    assert.equal(await requestLink(server, new Client(server.url), 'sam@new.test', { signup: t3 }), null)
    assert.equal((await new Client(server.url).get(`/api/signup/${t3}`)).body.error.code, 'signup_link_not_found')
    assert.equal((await root.get(`/api/signup/${t3}`)).body.error.code, 'signup_link_expired')

    // garbage tokens: the same 404
    for (const t of ['nope', 'x'.repeat(43)]) assert.equal((await new Client(server.url).get(`/api/signup/${t}`)).body.error.code, 'signup_link_not_found')
  })

  test('a domain restriction is checked on the verified address', async () => {
    const created = (await root.post('/api/server/signup-links', { max_uses: 5, domains: ['ok.test'] })).body
    const token = signupToken(created.link)
    assert.deepEqual((await new Client(server.url).get(`/api/signup/${token}`)).body.domains, ['ok.test'])
    assert.equal(await requestLink(server, new Client(server.url), 'tom@bad.test', { signup: token }), null)
    const uma = new Client(server.url)
    const link = await requestLink(server, uma, 'uma@ok.test', { signup: token })
    assert.ok(link)
    assert.equal((await openLink(uma, link)).status, 302)
    assert.equal((await root.get(`/api/signup/${token}`)).body.places_left, 4)
  })

  test('a reusable workspace link lets new people in while it has places left', async () => {
    const space = (await root.get('/api/me')).body.workspaces[0].id
    const created = (await root.post(`/api/workspaces/${space}/invites`, { role: 'viewer', max_uses: 1, domains: ['team.test'] })).body
    const token = inviteToken(created.link)
    assert.equal(await requestLink(server, new Client(server.url), 'vic@other.test', { invite: token }), null, 'wrong domain: no account')
    const wes = new Client(server.url)
    const link = await requestLink(server, wes, 'wes@team.test', { invite: token })
    assert.ok(link)
    assert.equal((await openLink(wes, link)).status, 302)
    assert.equal((await wes.post(`/api/invites/${token}/accept`)).body.role, 'viewer')
    // used up: it admits nobody else
    assert.equal(await requestLink(server, new Client(server.url), 'xia@team.test', { invite: token }), null)
  })
})

describe('registration links and the other sign-up modes', () => {
  test('SIGNUP=open needs none: creating one is refused', async () => {
    const server = await startServer({ ADMIN_EMAILS: 'admin@open.test' })
    try {
      const admin = await signIn(server, 'admin@open.test')
      const res = await admin.post('/api/server/signup-links', {})
      assert.equal(res.status, 409)
      assert.equal(res.body.error.code, 'signup_open')
      assert.deepEqual((await admin.get('/api/server/signup-links')).body, [])
    } finally {
      await server.stop()
    }
  })

  test('SIGNUP=domains: a link lets other addresses in; allowed ones use no place', async () => {
    const server = await startServer({ SIGNUP: 'domains:corp.test', ADMIN_EMAILS: 'it@corp.test' })
    try {
      const it = await signIn(server, 'it@corp.test')
      const created = (await it.post('/api/server/signup-links', { max_uses: 3 })).body
      const token = signupToken(created.link)
      const guest = new Client(server.url)
      const link = await requestLink(server, guest, 'freelancer@else.test', { signup: token })
      assert.ok(link)
      assert.equal((await openLink(guest, link)).status, 302)
      const colleague = new Client(server.url)
      assert.equal((await openLink(colleague, (await requestLink(server, colleague, 'colleague@corp.test', { signup: token }))!)).status, 302)
      assert.equal((await it.get(`/api/signup/${token}`)).body.places_left, 2)
    } finally {
      await server.stop()
    }
  })

  test('ADMIN_EMAILS must be addresses', async () => {
    const res = await runServerExpectingExit({ DATA_DIR: tempDir(), DEV_MODE: '1', ADMIN_EMAILS: 'admin@ok.test, not-an-address' })
    assert.equal(res.code, 78)
    assert.match(res.output, /ADMIN_EMAILS must be a comma-separated list of email addresses \(not valid: not-an-address\)/)
  })
})

/* ------------------------------------------------------------------ secrets */

describe('no token in the log or on disk', () => {
  test('registration, reusable and mailed invite tokens', async () => {
    const sink = await smtpSink()
    // like a deployment: real SMTP, no DEV_MODE (dev-mail mode logs mail links on purpose)
    const server = await startServer({ DEV_MODE: '', SMTP_URL: `smtp://127.0.0.1:${sink.port}`, LOG_LEVEL: 'debug', SIGNUP: 'invite', ADMIN_EMAILS: 'root@quiet.test' })
    const secrets: Array<[string, string]> = []
    const mailedToken = async (to: string, pattern: RegExp, count = 1) => {
      await waitFor(() => sink.mails.filter((m) => m.includes(to)).length >= count, 5000, `mail to ${to}`)
      const m = pattern.exec(decodeMail(sink.mails.filter((x) => x.includes(to)).at(-1)!))
      assert.ok(m, `a link in the mail to ${to}`)
      return m[1]!
    }
    const signInBySmtp = async (email: string, extra: Record<string, unknown> = {}, count = 1) => {
      const c = new Client(server.url)
      assert.equal((await c.post('/api/auth/request', { email, ...extra })).status, 204)
      const token = await mailedToken(email, /\/api\/auth\/verify\?token=([A-Za-z0-9_-]{43})/, count)
      secrets.push(['magic link', token])
      assert.equal((await c.fetch(`/api/auth/verify?token=${token}`)).status, 302)
      return c
    }
    try {
      const root = await signInBySmtp('root@quiet.test')
      const reg = (await root.post('/api/server/signup-links', { max_uses: 3 })).body
      secrets.push(['registration link', signupToken(reg.link)])
      const newbie = await signInBySmtp('newbie@quiet.test', { signup: signupToken(reg.link), redirect: `/app/#/signup/${signupToken(reg.link)}` })
      assert.equal((await newbie.get('/api/me')).status, 200)
      assert.equal((await new Client(server.url).get(`/api/signup/${signupToken(reg.link)}`)).status, 200)

      const space = (await root.get('/api/me')).body.workspaces[0].id
      const reusable = (await root.post(`/api/workspaces/${space}/invites`, { role: 'member', max_uses: 10 })).body
      secrets.push(['reusable invite', inviteToken(reusable.link)])
      assert.equal((await newbie.post(`/api/invites/${inviteToken(reusable.link)}/accept`)).status, 200)
      const batch = (await root.post(`/api/workspaces/${space}/invites/emails`, { emails: ['one@quiet.test', 'two@quiet.test'] })).body
      assert.deepEqual(batch.results.map((r: { status: string }) => r.status), ['sent', 'sent'])
      secrets.push(['mailed invite', await mailedToken('one@quiet.test', /#\/invite\/([A-Za-z0-9_-]{43})/)])
      await sleep(200)
    } finally {
      await server.stop()
      await sink.close()
    }
    const log = server.logs()
    assert.match(log, /registration link created/, 'sanity: the log was captured')
    assert.match(log, /account created .*via=signup-link/)
    const disk = ['one.sqlite', 'one.sqlite-wal']
      .map((f) => join(server.dataDir, f))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f))
    for (const [what, secret] of secrets) {
      assert.equal(secret.length, 43, what)
      assert.equal(log.includes(secret), false, `${what} is in the log`)
      assert.equal(disk.some((bytes) => bytes.includes(Buffer.from(secret))), false, `${what} is stored in the clear`)
    }
  })

  test('paths with tokens are redacted for the error log', () => {
    assert.equal(redactPath(`/api/signup/${'a'.repeat(43)}`), '/api/signup/…')
    assert.equal(redactPath(`/api/invites/${'b'.repeat(43)}/accept`), '/api/invites/…/accept')
  })
})

/* ------------------------------------------------------------------ migration */

test('migration v7: invites accepted before stay used, open ones keep their one place', () => {
  const db = new Db(join(tempDir(), 'one.sqlite'))
  try {
    db.raw.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    for (const m of migrations.filter((m) => m.version <= 6)) {
      db.raw.exec(m.sql)
      db.run('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, Date.now())
    }
    const now = Date.now()
    db.run("INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@old.test', ?)", now)
    db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'Old', ?)", now)
    const add = (id: string, acceptedBy: string | null, acceptedAt: number | null) =>
      db.run("INSERT INTO invites (id, token_hash, workspace_id, role, created_at, expires_at, accepted_by, accepted_at) VALUES (?, ?, 'w1', 'member', ?, ?, ?, ?)", id, `h-${id}`, now, now + 86400_000, acceptedBy, acceptedAt)
    add('used', 'u1', now)
    add('used-by-deleted', null, now) // the acceptor's account was deleted (ON DELETE SET NULL)
    add('open', null, null)
    migrate(db)
    const rows = db.all<{ id: string; uses: number; max_uses: number; allowed_domains: string | null }>('SELECT id, uses, max_uses, allowed_domains FROM invites ORDER BY id')
    assert.deepEqual(
      rows.map((r) => [r.id, r.uses, r.max_uses, r.allowed_domains]),
      [
        ['open', 0, 1, null],
        ['used', 1, 1, null],
        ['used-by-deleted', 1, 1, null],
      ],
    )
  } finally {
    db.close()
  }
})
