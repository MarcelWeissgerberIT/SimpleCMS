import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import { Client, type DocClient, flushed, openDoc, runServerExpectingExit, signIn, startServer, type TestServer, tempDir, waitFor } from './helpers.ts'

describe('GET /api/session', () => {
  let server: TestServer
  before(async () => {
    server = await startServer()
  })
  after(async () => {
    await server.stop()
  })

  test('answers 200 with user null when nobody is signed in (no 401 on a signed-out boot)', async () => {
    const anon = new Client(server.url)
    const res = await anon.get('/api/session')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { user: null, workspaces: [] })
    assert.equal(res.res.headers.get('cache-control'), 'no-store')
    // /api/me keeps its contract
    assert.equal((await anon.get('/api/me')).status, 401)
  })

  test('signed in: the same shape as /api/me', async () => {
    const owner = await signIn(server, 'session@example.com')
    const ws = await owner.post('/api/workspaces', { name: 'Session' })
    const session = await owner.get('/api/session')
    const me = await owner.get('/api/me')
    assert.equal(session.status, 200)
    assert.deepEqual(session.body, me.body)
    assert.equal(session.body.user.email, 'session@example.com')
    // the personal workspace (created at the first sign-in) comes first
    assert.deepEqual(
      session.body.workspaces.map((w: { id: string; role: string; personal: boolean }) => [w.personal ? 'personal' : w.id, w.role]),
      [['personal', 'owner'], [ws.body.id, 'owner']],
    )
  })

  test('an invalid or ended session reads as signed out and the cookie is cleared', async () => {
    const stale = new Client(server.url)
    stale.cookies.set('one_session', 'x'.repeat(43))
    const res = await stale.get('/api/session')
    assert.equal(res.status, 200)
    assert.equal(res.body.user, null)
    assert.ok(res.res.headers.getSetCookie().some((c) => c.startsWith('one_session=') && /Max-Age=0/i.test(c)), 'cookie cleared')

    // signed out elsewhere: the old cookie no longer counts
    const gone = await signIn(server, 'gone@example.com')
    const token = gone.cookies.get('one_session')!
    assert.equal((await gone.post('/api/auth/logout')).status, 204)
    gone.cookies.set('one_session', token)
    const after = await gone.get('/api/session')
    assert.equal(after.status, 200)
    assert.equal(after.body.user, null)
  })
})

describe('AUTH_IP_LIMIT (test servers only)', () => {
  test('DEV_MODE: the per-IP sign-in limit follows AUTH_IP_LIMIT', async () => {
    const own = await startServer({ AUTH_IP_LIMIT: '3' })
    try {
      const c = new Client(own.url)
      for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/auth/request', { email: `ip-limit-${i}@example.com` })).status, 204)
      const limited = await c.post('/api/auth/request', { email: 'ip-limit-x@example.com' })
      assert.equal(limited.status, 429)
      assert.equal(limited.body.error.code, 'rate_limited')
    } finally {
      await own.stop()
    }

    const roomy = await startServer({ AUTH_IP_LIMIT: '200' })
    try {
      const c = new Client(roomy.url)
      let ok = 0
      for (let i = 0; i < 40; i++) if ((await c.post('/api/auth/request', { email: `roomy-${i}@example.com` })).status === 204) ok++
      assert.equal(ok, 40, 'more than the default 20 per IP')
    } finally {
      await roomy.stop()
    }
  })

  test('without DEV_MODE the variable is refused (deployments keep 20 per IP)', async () => {
    const run = await runServerExpectingExit({ DATA_DIR: tempDir(), AUTH_IP_LIMIT: '1000' })
    assert.equal(run.code, 78)
    assert.match(run.output, /AUTH_IP_LIMIT/)
    const bad = await runServerExpectingExit({ DATA_DIR: tempDir(), DEV_MODE: '1', AUTH_IP_LIMIT: 'lots' })
    assert.equal(bad.code, 78)
  })
})

describe('DELETE /api/workspaces/:id/documents/:pageId', () => {
  let server: TestServer
  let owner: Client, member: Client, viewer: Client, outsider: Client
  let wsId: string
  const open: DocClient[] = []
  const doc = (client: Client, name: string) => {
    const d = openDoc(server, client, name)
    open.push(d)
    return d
  }
  const storedDocs = () => {
    const db = new DatabaseSync(join(server.dataDir, 'one.sqlite'), { readOnly: true })
    try {
      return (db.prepare('SELECT name FROM documents WHERE workspace_id = ?').all(wsId) as Array<{ name: string }>).map((r) => r.name)
    } finally {
      db.close()
    }
  }
  const tombstones = () => {
    const db = new DatabaseSync(join(server.dataDir, 'one.sqlite'), { readOnly: true })
    try {
      return (db.prepare('SELECT name, deleted_by FROM document_tombstones WHERE workspace_id = ?').all(wsId) as Array<{ name: string; deleted_by: string }>).map((r) => ({ name: r.name, deleted_by: r.deleted_by }))
    } finally {
      db.close()
    }
  }

  before(async () => {
    server = await startServer()
    owner = await signIn(server, 'docs-owner@example.com')
    member = await signIn(server, 'docs-member@example.com')
    viewer = await signIn(server, 'docs-viewer@example.com')
    outsider = await signIn(server, 'docs-outsider@example.com')
    wsId = (await owner.post('/api/workspaces', { name: 'Docs' })).body.id
    for (const [client, role] of [
      [member, 'member'],
      [viewer, 'viewer'],
    ] as const) {
      const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
      await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
    }
  })
  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  /** A page in the meta document (optionally trashed) with stored content. */
  async function pageWithContent(pageId: string, trashed = false) {
    const meta = doc(member, `ws:${wsId}`)
    const content = doc(member, `ws:${wsId}:p:${pageId}`)
    await Promise.all([meta.synced, content.synced])
    meta.doc.transact(() => {
      const p = new Y.Map<unknown>()
      p.set('title', pageId)
      p.set('trashed', trashed)
      meta.doc.getMap('pages').set(pageId, p)
    })
    content.doc.getText('t').insert(0, `content of ${pageId}`)
    await Promise.all([flushed(meta), flushed(content)])
    await waitFor(() => storedDocs().includes(`ws:${wsId}:p:${pageId}`), 15_000, 'content stored')
    return { meta, content }
  }

  test('only pages gone from the meta document; trashed pages keep their content', async () => {
    const { meta, content } = await pageWithContent('trashme', true)
    const name = `ws:${wsId}:p:trashme`

    const early = await member.del(`/api/workspaces/${wsId}/documents/trashme`)
    assert.equal(early.status, 409)
    assert.equal(early.body.error.code, 'page_exists')
    assert.ok(storedDocs().includes(name))

    // deleted for good (trash emptied): the page leaves the meta document
    meta.doc.getMap('pages').delete('trashme')
    await flushed(meta)
    content.destroy()
    const res = await member.del(`/api/workspaces/${wsId}/documents/trashme`)
    assert.equal(res.status, 204)
    assert.ok(!storedDocs().includes(name), 'stored content removed')
    const memberId = (await member.get('/api/me')).body.user.id
    assert.deepEqual(tombstones(), [{ name, deleted_by: memberId }])
    // idempotent
    assert.equal((await member.del(`/api/workspaces/${wsId}/documents/trashme`)).status, 204)
    assert.ok(server.logs().includes('page document deleted'), 'audit log line')
  })

  test('roles and ids: viewers 403, outsiders 404, bad ids 400', async () => {
    assert.equal((await viewer.del(`/api/workspaces/${wsId}/documents/nopage`)).status, 403)
    const out = await outsider.del(`/api/workspaces/${wsId}/documents/nopage`)
    assert.equal(out.status, 404)
    assert.equal(out.body.error.code, 'workspace_not_found')
    const bad = await member.del(`/api/workspaces/${wsId}/documents/${'x'.repeat(65)}`)
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'invalid_page_id')
    assert.equal((await new Client(server.url).del(`/api/workspaces/${wsId}/documents/nopage`)).status, 401)
    // a page that never had a document: fine (idempotent)
    assert.equal((await owner.del(`/api/workspaces/${wsId}/documents/neverstored`)).status, 204)
  })

  test('a device that still holds the document cannot store it again', async () => {
    const { meta, content } = await pageWithContent('zombie')
    const name = `ws:${wsId}:p:zombie`
    meta.doc.getMap('pages').delete('zombie')
    await flushed(meta)
    // the content document is still open somewhere while it is deleted …
    assert.equal((await owner.del(`/api/workspaces/${wsId}/documents/zombie`)).status, 204)
    assert.ok(!storedDocs().includes(name))
    // … and that device keeps writing, then leaves (the last disconnect would store it)
    content.doc.getText('t').insert(0, 'late edit ')
    await flushed(content)
    content.destroy()
    // a later device syncing its offline copy back
    const late = doc(owner, name)
    await late.synced
    late.doc.getText('t').insert(0, 'offline copy ')
    await flushed(late)
    late.destroy()
    await new Promise((r) => setTimeout(r, 2600)) // past the store debounce
    assert.ok(!storedDocs().includes(name), 'never stored again')
  })

  test('a page that comes back with the same id (undo, restored backup) is stored again', async () => {
    const { meta, content } = await pageWithContent('phoenix')
    const name = `ws:${wsId}:p:phoenix`
    meta.doc.getMap('pages').delete('phoenix')
    await flushed(meta)
    content.destroy()
    assert.equal((await member.del(`/api/workspaces/${wsId}/documents/phoenix`)).status, 204)
    assert.ok(tombstones().some((t) => t.name === name))

    meta.doc.transact(() => {
      const p = new Y.Map<unknown>()
      p.set('title', 'phoenix (restored)')
      meta.doc.getMap('pages').set('phoenix', p)
    })
    await flushed(meta)
    const back = doc(member, name)
    await back.synced
    back.doc.getText('t').insert(0, 'restored content')
    await flushed(back)
    await waitFor(() => storedDocs().includes(name), 15_000, 'stored again')
    assert.ok(!tombstones().some((t) => t.name === name), 'tombstone lifted')
    assert.ok(server.logs().includes('page document revived'))
  })
})
