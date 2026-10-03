import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client, mailbox, signIn, startServer, type TestServer } from './helpers.ts'

let server: TestServer
before(async () => {
  server = await startServer()
})
after(async () => {
  await server.stop()
})

const tokenOf = (link: string) => link.split('#/invite/')[1]!

test('workspace lifecycle: create, invite, accept, roles, ownership, leave, delete', async () => {
  const owner = await signIn(server, 'owner@example.com')
  const bob = await signIn(server, 'bob@example.com')
  const carol = await signIn(server, 'carol@example.com')
  const dave = await signIn(server, 'dave@example.com')
  await owner.patch('/api/me', { name: 'Olga Owner' })

  // create
  const created = await owner.post('/api/workspaces', { name: '  Acme Team ', icon: { type: 'emoji', value: '🛠️' } })
  assert.equal(created.status, 201)
  const ws = created.body
  assert.equal(ws.name, 'Acme Team')
  assert.equal(ws.role, 'owner')
  assert.deepEqual(ws.icon, { type: 'emoji', value: '🛠️' })
  assert.match(ws.id, /^[A-Za-z0-9_-]{16}$/)
  const me = await owner.get('/api/me')
  assert.deepEqual(
    me.body.workspaces.map((w: any) => [w.personal ? 'personal' : w.id, w.name, w.role]),
    [['personal', 'owner’s space', 'owner'], [ws.id, 'Acme Team', 'owner']],
  )

  // invite by link
  const linkInvite = await owner.post(`/api/workspaces/${ws.id}/invites`, { role: 'member' })
  assert.equal(linkInvite.status, 201)
  assert.match(linkInvite.body.link, /\/app\/#\/invite\/[A-Za-z0-9_-]{43}$/)
  assert.ok(Date.parse(linkInvite.body.expires_at) > Date.now() + 6 * 86400_000)
  const linkToken = tokenOf(linkInvite.body.link)

  const preview = await new Client(server.url).get(`/api/invites/${linkToken}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.workspace.name, 'Acme Team')
  assert.equal(preview.body.role, 'member')
  assert.deepEqual(preview.body.inviter, { name: 'Olga Owner', email: 'owner@example.com' })

  assert.equal((await new Client(server.url).post(`/api/invites/${linkToken}/accept`)).status, 401)
  const accepted = await bob.post(`/api/invites/${linkToken}/accept`)
  assert.equal(accepted.status, 200)
  assert.deepEqual(accepted.body, { workspaceId: ws.id, role: 'member' })
  const reused = await dave.post(`/api/invites/${linkToken}/accept`)
  assert.equal(reused.status, 404)
  assert.equal(reused.body.error.code, 'invite_used')
  assert.equal((await new Client(server.url).get(`/api/invites/${linkToken}`)).body.error.code, 'invite_used')

  // invite by email (sent in the inviter's language)
  const emailInvite = await owner.fetch(`/api/workspaces/${ws.id}/invites`, {
    method: 'POST',
    json: { role: 'viewer', email: 'Carol@Example.com' },
    headers: { 'accept-language': 'de' },
  })
  assert.equal(emailInvite.status, 201)
  const emailBody = (await emailInvite.json()) as any
  assert.equal(emailBody.email_sent, true)
  const [inviteMail] = await mailbox(server, 'carol@example.com')
  assert.ok(inviteMail)
  assert.match(inviteMail.subject, /Olga Owner hat dich zu „Acme Team“ eingeladen/)
  assert.equal(inviteMail.link, emailBody.link)
  const emailToken = tokenOf(emailBody.link)
  const mismatch = await dave.post(`/api/invites/${emailToken}/accept`)
  assert.equal(mismatch.status, 403)
  assert.equal(mismatch.body.error.code, 'invite_email_mismatch')
  assert.deepEqual((await carol.post(`/api/invites/${emailToken}/accept`)).body, { workspaceId: ws.id, role: 'viewer' })

  const conflictInvite = await owner.post(`/api/workspaces/${ws.id}/invites`, { email: 'bob@example.com' })
  assert.equal(conflictInvite.status, 409)
  assert.equal(conflictInvite.body.error.code, 'already_member')

  // member list (any member, viewers included)
  const members = await carol.get(`/api/workspaces/${ws.id}/members`)
  assert.equal(members.status, 200)
  assert.deepEqual(
    members.body.map((m: any) => [m.user.email, m.role]),
    [
      ['owner@example.com', 'owner'],
      ['bob@example.com', 'member'],
      ['carol@example.com', 'viewer'],
    ],
  )
  assert.ok(members.body[0].user.id && members.body[0].created_at)
  const bobId = members.body[1].user.id
  const carolId = members.body[2].user.id
  const ownerId = members.body[0].user.id

  // non-members see nothing
  for (const path of [`/api/workspaces/${ws.id}/members`, `/api/workspaces/${ws.id}/invites`]) {
    const res = await dave.get(path)
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'workspace_not_found')
  }

  // open invites (admin only)
  const pending = await owner.post(`/api/workspaces/${ws.id}/invites`, { role: 'admin', email: 'erin@example.com' })
  const open = await owner.get(`/api/workspaces/${ws.id}/invites`)
  assert.deepEqual(
    open.body.map((i: any) => [i.id, i.role, i.email]),
    [[pending.body.id, 'admin', 'erin@example.com']],
  )
  assert.equal((await bob.get(`/api/workspaces/${ws.id}/invites`)).status, 403)
  assert.equal((await bob.post(`/api/workspaces/${ws.id}/invites`, { role: 'member' })).status, 403)
  assert.equal((await owner.del(`/api/workspaces/${ws.id}/invites/${pending.body.id}`)).status, 204)
  assert.equal((await new Client(server.url).get(`/api/invites/${tokenOf(pending.body.link)}`)).body.error.code, 'invite_not_found')

  // workspace settings: admin+
  assert.equal((await bob.patch(`/api/workspaces/${ws.id}`, { name: 'Hijack' })).status, 403)
  const renamed = await owner.patch(`/api/workspaces/${ws.id}`, { name: 'Acme', icon: null })
  assert.equal(renamed.body.name, 'Acme')
  assert.equal(renamed.body.icon, null)

  // roles
  assert.equal((await bob.patch(`/api/workspaces/${ws.id}/members/${carolId}`, { role: 'member' })).status, 403, 'members cannot change roles')
  const promoted = await owner.patch(`/api/workspaces/${ws.id}/members/${bobId}`, { role: 'admin' })
  assert.equal(promoted.status, 200)
  assert.equal(promoted.body.role, 'admin')
  assert.equal((await bob.patch(`/api/workspaces/${ws.id}/members/${carolId}`, { role: 'member' })).body.role, 'member')
  const steal = await bob.patch(`/api/workspaces/${ws.id}/members/${bobId}`, { role: 'owner' })
  assert.equal(steal.status, 403)
  assert.equal(steal.body.error.code, 'owner_only')
  const demoteOwner = await bob.patch(`/api/workspaces/${ws.id}/members/${ownerId}`, { role: 'member' })
  assert.equal(demoteOwner.status, 409)
  assert.equal(demoteOwner.body.error.code, 'owner_must_transfer')
  assert.equal((await bob.del(`/api/workspaces/${ws.id}/members/${ownerId}`)).body.error.code, 'owner_must_transfer')
  assert.equal((await owner.patch(`/api/workspaces/${ws.id}/members/${ownerId}`, { role: 'admin' })).status, 409, 'the owner cannot demote themself')

  // ownership transfer: exactly one owner afterwards
  const transfer = await owner.patch(`/api/workspaces/${ws.id}/members/${bobId}`, { role: 'owner' })
  assert.equal(transfer.status, 200)
  assert.equal(transfer.body.role, 'owner')
  const roles = Object.fromEntries((await owner.get(`/api/workspaces/${ws.id}/members`)).body.map((m: any) => [m.user.email, m.role]))
  assert.deepEqual(roles, { 'owner@example.com': 'admin', 'bob@example.com': 'owner', 'carol@example.com': 'member' })

  // leaving / removing
  const ownerLeaves = await bob.del(`/api/workspaces/${ws.id}/members/${bobId}`)
  assert.equal(ownerLeaves.status, 409)
  assert.equal(ownerLeaves.body.error.code, 'owner_must_transfer')
  assert.equal((await carol.del(`/api/workspaces/${ws.id}/members/${ownerId}`)).status, 403, 'members cannot remove others')
  assert.equal((await carol.del(`/api/workspaces/${ws.id}/members/${carolId}`)).status, 204, 'anyone can leave')
  assert.equal((await carol.get(`/api/workspaces/${ws.id}/members`)).status, 404)
  assert.equal((await bob.del(`/api/workspaces/${ws.id}/members/${carolId}`)).status, 404)

  // delete: owner only
  assert.equal((await owner.del(`/api/workspaces/${ws.id}`)).status, 403)
  assert.equal((await bob.del(`/api/workspaces/${ws.id}`)).status, 204)
  assert.equal((await bob.get(`/api/workspaces/${ws.id}/members`)).status, 404)
  assert.deepEqual(
    (await owner.get('/api/me')).body.workspaces.map((w: any) => w.personal),
    [true],
    'only their own space is left',
  )
})

test('validation and invite rate limit', async () => {
  const admin = await signIn(server, 'limits@example.com')
  assert.equal((await admin.post('/api/workspaces', { name: '' })).body.error.code, 'invalid_request')
  assert.equal((await admin.post('/api/workspaces', { name: 'x', icon: { big: 'y'.repeat(3000) } })).status, 400)
  const ws = (await admin.post('/api/workspaces', { name: 'Limits' })).body
  assert.equal((await admin.post(`/api/workspaces/${ws.id}/invites`, { role: 'owner' })).status, 400, 'owner cannot be invited')

  let created = 0
  let limited = null
  for (let i = 0; i < 51; i++) {
    const res = await admin.post(`/api/workspaces/${ws.id}/invites`, { role: 'viewer' })
    if (res.status === 201) created++
    else limited = res
  }
  assert.equal(created, 50)
  assert.equal(limited?.status, 429)
})
