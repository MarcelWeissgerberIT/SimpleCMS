/**
 * Tenancy (docs/CLOUD.md § Tenancy & encryption at rest): everyone has a workspace of their own from
 * the first sign-in, and nothing of one workspace is reachable from another. The sweep below calls
 * every route the app registers — REST, public API, MCP tools — and every WebSocket document name as a
 * member of workspace A against workspace B (and with B's ids inside A) and expects refusals. The
 * route list is read from the app itself: a new route without an entry in ROUTES fails this test.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as Y from 'yjs'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { Services } from '../src/context.ts'
import { Client, type DocClient, flushed, mailbox, openDoc, signIn, startServer, tempDir, type TestServer } from './helpers.ts'

/* ------------------------------------------------------------------ fixtures */

function pageEntry(fields: Record<string, unknown>): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('properties', new Y.Map<unknown>())
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

/** A database (one title property) with one row and a plain page next to it. */
function seedMeta(doc: Y.Doc, ids: { db: string; row: string; page: string }, marker: string) {
  doc.transact(() => {
    const pages = doc.getMap('pages')
    pages.set(ids.db, pageEntry({ kind: 'database', title: `Tasks ${marker}` }))
    const ydb = new Y.Map<unknown>()
    const props = new Y.Map<unknown>()
    props.set('t-title', { id: 't-title', name: 'Name', type: 'title', order: 0 })
    ydb.set('properties', props)
    ydb.set('views', new Y.Map<unknown>())
    ydb.set('nextUniqueId', 1)
    doc.getMap('databases').set(ids.db, ydb)
    pages.set(ids.row, pageEntry({ title: `Row ${marker}`, parentId: ids.db, databaseId: ids.db }))
    pages.set(ids.page, pageEntry({ title: `Page ${marker}`, plain: marker }))
  })
}

const writeText = (doc: Y.Doc, text: string) =>
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText(text)])
    doc.getXmlFragment('default').insert(0, [p])
  })

/** Mail-free sign-in variant: request with a language, open the link. */
async function signInWith(server: TestServer, email: string, extra: Record<string, unknown>): Promise<{ client: Client; location: string | null }> {
  const client = new Client(server.url)
  const before = (await mailbox(server, email)).length
  const req = await client.post('/api/auth/request', { email, ...extra })
  assert.equal(req.status, 204)
  const mails = await mailbox(server, email)
  assert.equal(mails.length, before + 1, `a sign-in mail for ${email}`)
  const url = new URL(mails[0]!.link)
  const res = await client.fetch(url.pathname + url.search)
  assert.equal(res.status, 302)
  return { client, location: res.headers.get('location') }
}

type Ws = { id: string; name: string; role: string; personal: boolean }
const spaces = async (c: Client) => (await c.get('/api/me')).body.workspaces as Ws[]

/* ------------------------------------------------------------------ 1. own space */

describe('a workspace of one\'s own', () => {
  let server: TestServer
  before(async () => {
    server = await startServer()
  })
  after(async () => {
    await server.stop()
  })

  test('the first sign-in creates it — once, with nobody else in it', async () => {
    const ada = await signIn(server, 'ada@tenancy.test')
    const [own, ...rest] = await spaces(ada)
    assert.equal(rest.length, 0)
    assert.equal(own!.name, 'ada’s space')
    assert.equal(own!.role, 'owner')
    assert.equal(own!.personal, true)
    const members = (await ada.get(`/api/workspaces/${own!.id}/members`)).body
    assert.deepEqual(members.map((m: { user: { email: string }; role: string }) => [m.user.email, m.role]), [['ada@tenancy.test', 'owner']])

    // signing in again (another device) creates nothing
    const again = await signIn(server, 'ada@tenancy.test')
    assert.deepEqual((await spaces(again)).map((w) => w.id), [own!.id])

    // a team workspace created later is listed after it, and is not personal
    const team = (await ada.post('/api/workspaces', { name: 'Ada & Co' })).body
    assert.equal(team.personal, false)
    assert.deepEqual((await spaces(ada)).map((w) => [w.name, w.personal]), [['ada’s space', true], ['Ada & Co', false]])
  })

  test('named in the sign-in language', async () => {
    const { client } = await signInWith(server, 'bea@tenancy.test', { lang: 'de' })
    assert.deepEqual((await spaces(client)).map((w) => w.name), ['Bereich von bea'])
  })

  test('an invited person gets the invitation and a space of their own', async () => {
    const owner = await signIn(server, 'owner@tenancy.test')
    const team = (await owner.post('/api/workspaces', { name: 'Team' })).body.id
    const invite = await owner.post(`/api/workspaces/${team}/invites`, { role: 'member', email: 'cleo@tenancy.test' })
    const token = invite.body.link.split('#/invite/')[1]
    // the invitation mail's link and the sign-in link: the redirect (with the invite token) survives
    const { client: cleo, location } = await signInWith(server, 'cleo@tenancy.test', { invite: token, redirect: `/app/?signed-in=1#/invite/${token}` })
    assert.equal(location, `/app/?signed-in=1#/invite/${token}`)
    assert.equal((await cleo.post(`/api/invites/${token}/accept`)).status, 200)
    const list = await spaces(cleo)
    assert.deepEqual(list.map((w) => [w.name, w.role, w.personal]), [['cleo’s space', 'owner', true], ['Team', 'member', false]])
    // the owner's view of the team is unchanged; nobody else is in Cleo's space
    const own = list[0]!.id
    assert.equal((await owner.get(`/api/workspaces/${own}/members`)).status, 404)
    assert.equal((await cleo.get(`/api/workspaces/${own}/members`)).body.length, 1)
  })

  test('a deleted space does not come back; a handed-over one is nobody\'s personal space', async () => {
    const dan = await signIn(server, 'dan@tenancy.test')
    const own = (await spaces(dan))[0]!
    assert.equal((await dan.del(`/api/workspaces/${own.id}`)).status, 204)
    assert.deepEqual(await spaces(await signIn(server, 'dan@tenancy.test')), [])

    const eve = await signIn(server, 'eve@tenancy.test')
    const fay = await signIn(server, 'fay@tenancy.test')
    const eveSpace = (await spaces(eve))[0]!
    const inv = await eve.post(`/api/workspaces/${eveSpace.id}/invites`, { role: 'admin' })
    await fay.post(`/api/invites/${inv.body.link.split('#/invite/')[1]}/accept`)
    const fayId = (await fay.get('/api/me')).body.user.id
    assert.equal((await eve.patch(`/api/workspaces/${eveSpace.id}/members/${fayId}`, { role: 'owner' })).status, 200)
    const forFay = (await spaces(fay)).find((w) => w.id === eveSpace.id)!
    const forEve = (await spaces(eve)).find((w) => w.id === eveSpace.id)!
    assert.deepEqual([forFay.role, forFay.personal, forEve.role, forEve.personal], ['owner', false, 'admin', false])
  })
})

/* ------------------------------------------------------------------ 2. the sweep */

interface Req {
  method: string
  path: string
  json?: unknown
  body?: string
  headers?: Record<string, string>
}

/** Everything of workspace B a member of A could try to name. */
interface Foreign {
  ws: string
  owner: string
  invite: string
  token: string
  hook: string
  /** A registration link B's owner (a server admin) created. */
  signupLink: string
  file: string
  page: string
  db: string
  row: string
}

/**
 * Every route of the app. `workspace`: a cookie route under /api/workspaces/:id — called by A's owner
 * with :id = B (always `404 workspace_not_found`), and, when `own` is set, with :id = A and B's ids in
 * the other parameters (that status: nothing of B is found or touched). `api`: the public API with A's
 * token and B's ids. `mcp`: see MCP_TOOLS. `secret`: the path carries the credential itself (nobody
 * can name another workspace's secret). `server`: server administration (ADMIN_EMAILS) — A's owner,
 * no server admin, is refused (403) and signed-out callers too (401). `none`: not about a workspace.
 */
type Entry =
  | { scope: 'workspace'; req: (ws: string, x: Foreign) => Req; own?: number }
  | { scope: 'server'; req: (x: Foreign) => Req }
  | { scope: 'api'; req: (x: Foreign) => Req; expect: number | ((body: any, x: Foreign) => void) }
  | { scope: 'mcp' | 'secret' | 'none'; why: string }

const W = (ws: string) => `/api/workspaces/${ws}`

const ROUTES: Record<string, Entry> = {
  'ALL /api/*': { scope: 'none', why: 'catch-all 404 for unknown API paths' },
  'GET /api/health': { scope: 'none', why: 'liveness' },
  'GET /api/config': { scope: 'none', why: 'server settings for the sign-in screen' },
  'POST /api/auth/request': { scope: 'none', why: 'sign-in link request' },
  'GET /api/auth/verify': { scope: 'secret', why: 'the magic-link token is the credential' },
  'POST /api/auth/verify': { scope: 'secret', why: 'the magic-link token is the credential' },
  'POST /api/auth/logout': { scope: 'none', why: 'ends the caller\'s own session' },
  'GET /api/me': { scope: 'none', why: 'the caller\'s own account and memberships' },
  'PATCH /api/me': { scope: 'none', why: 'the caller\'s own account' },
  'GET /api/session': { scope: 'none', why: 'the caller\'s own account and memberships' },
  'POST /api/workspaces': { scope: 'none', why: 'creates a new workspace owned by the caller' },
  'GET /api/invites/:token': { scope: 'secret', why: 'the invite token is the credential' },
  'POST /api/invites/:token/accept': { scope: 'secret', why: 'the invite token is the credential' },
  'GET /api/signup/:token': { scope: 'secret', why: 'the registration link token is the credential (and names no workspace)' },
  'GET /api/server/signup-links': { scope: 'server', req: () => ({ method: 'GET', path: '/api/server/signup-links' }) },
  'POST /api/server/signup-links': { scope: 'server', req: () => ({ method: 'POST', path: '/api/server/signup-links', json: { max_uses: 100, expires_in_days: 30 } }) },
  'DELETE /api/server/signup-links/:linkId': { scope: 'server', req: (x) => ({ method: 'DELETE', path: `/api/server/signup-links/${x.signupLink}` }) },
  'GET /api/v1/hooks/:secret': { scope: 'secret', why: 'the hook URL secret is the credential (and names one database)' },
  'POST /api/v1/hooks/:secret': { scope: 'secret', why: 'the hook URL secret is the credential (and names one database)' },
  'GET /api/dev/mailbox': { scope: 'none', why: 'DEV_MODE only' },
  'ALL /mcp': { scope: 'mcp', why: 'MCP: 405 for anything but POST' },
  'GET /mcp': { scope: 'mcp', why: 'MCP: 405' },
  'DELETE /mcp': { scope: 'mcp', why: 'MCP: 405' },
  'POST /mcp': { scope: 'mcp', why: 'MCP: every tool is swept below (MCP_TOOLS)' },
  'GET /app': { scope: 'none', why: 'static app' },
  'GET /*': { scope: 'none', why: 'static files' },

  'PATCH /api/workspaces/:id': { scope: 'workspace', req: (ws) => ({ method: 'PATCH', path: W(ws), json: { name: 'Taken over' } }) },
  'DELETE /api/workspaces/:id': { scope: 'workspace', req: (ws) => ({ method: 'DELETE', path: W(ws) }) },
  'GET /api/workspaces/:id/members': { scope: 'workspace', req: (ws) => ({ method: 'GET', path: `${W(ws)}/members` }) },
  'PATCH /api/workspaces/:id/members/:userId': { scope: 'workspace', req: (ws, x) => ({ method: 'PATCH', path: `${W(ws)}/members/${x.owner}`, json: { role: 'viewer' } }), own: 404 },
  'DELETE /api/workspaces/:id/members/:userId': { scope: 'workspace', req: (ws, x) => ({ method: 'DELETE', path: `${W(ws)}/members/${x.owner}` }), own: 404 },
  'POST /api/workspaces/:id/invites': { scope: 'workspace', req: (ws) => ({ method: 'POST', path: `${W(ws)}/invites`, json: { role: 'admin' } }) },
  'POST /api/workspaces/:id/invites/emails': { scope: 'workspace', req: (ws) => ({ method: 'POST', path: `${W(ws)}/invites/emails`, json: { emails: ['mallory@sweep.test'], role: 'admin' } }) },
  'GET /api/workspaces/:id/invites': { scope: 'workspace', req: (ws) => ({ method: 'GET', path: `${W(ws)}/invites` }) },
  'DELETE /api/workspaces/:id/invites/:inviteId': { scope: 'workspace', req: (ws, x) => ({ method: 'DELETE', path: `${W(ws)}/invites/${x.invite}` }), own: 404 },
  'PUT /api/workspaces/:id/files/:fileId': { scope: 'workspace', req: (ws, x) => ({ method: 'PUT', path: `${W(ws)}/files/${x.file}`, body: 'overwrite', headers: { 'content-type': 'text/plain' } }) },
  'GET /api/workspaces/:id/files/:fileId': { scope: 'workspace', req: (ws, x) => ({ method: 'GET', path: `${W(ws)}/files/${x.file}` }), own: 404 },
  'POST /api/workspaces/:id/files/publish': { scope: 'workspace', req: (ws, x) => ({ method: 'POST', path: `${W(ws)}/files/publish`, json: { ids: [x.file] } }), own: 200 },
  'DELETE /api/workspaces/:id/documents/:pageId': { scope: 'workspace', req: (ws, x) => ({ method: 'DELETE', path: `${W(ws)}/documents/${x.page}` }), own: 204 },
  'GET /api/workspaces/:id/tokens': { scope: 'workspace', req: (ws) => ({ method: 'GET', path: `${W(ws)}/tokens` }) },
  'POST /api/workspaces/:id/tokens': { scope: 'workspace', req: (ws) => ({ method: 'POST', path: `${W(ws)}/tokens`, json: { name: 'stolen', scope: 'write' } }) },
  'DELETE /api/workspaces/:id/tokens/:tokenId': { scope: 'workspace', req: (ws, x) => ({ method: 'DELETE', path: `${W(ws)}/tokens/${x.token}` }), own: 404 },
  'GET /api/workspaces/:id/hooks': { scope: 'workspace', req: (ws) => ({ method: 'GET', path: `${W(ws)}/hooks` }) },
  'POST /api/workspaces/:id/hooks': { scope: 'workspace', req: (ws, x) => ({ method: 'POST', path: `${W(ws)}/hooks`, json: { databaseId: x.db } }), own: 404 },
  'POST /api/workspaces/:id/hooks/:hookId/regenerate': { scope: 'workspace', req: (ws, x) => ({ method: 'POST', path: `${W(ws)}/hooks/${x.hook}/regenerate` }), own: 404 },
  'DELETE /api/workspaces/:id/hooks/:hookId': { scope: 'workspace', req: (ws, x) => ({ method: 'DELETE', path: `${W(ws)}/hooks/${x.hook}` }), own: 404 },

  'GET /api/v1/workspace': { scope: 'api', req: () => ({ method: 'GET', path: '/api/v1/workspace' }), expect: (b, x) => assert.notEqual(b.id, x.ws) },
  'GET /api/v1/databases': { scope: 'api', req: () => ({ method: 'GET', path: '/api/v1/databases' }), expect: (b, x) => assert.ok(!JSON.stringify(b).includes(x.db)) },
  'GET /api/v1/databases/:id': { scope: 'api', req: (x) => ({ method: 'GET', path: `/api/v1/databases/${x.db}` }), expect: 404 },
  'GET /api/v1/databases/:id/rows': { scope: 'api', req: (x) => ({ method: 'GET', path: `/api/v1/databases/${x.db}/rows` }), expect: 404 },
  'POST /api/v1/databases/:id/rows': { scope: 'api', req: (x) => ({ method: 'POST', path: `/api/v1/databases/${x.db}/rows`, json: { title: 'injected' } }), expect: 404 },
  'GET /api/v1/rows/:id': { scope: 'api', req: (x) => ({ method: 'GET', path: `/api/v1/rows/${x.row}` }), expect: 404 },
  'PATCH /api/v1/rows/:id': { scope: 'api', req: (x) => ({ method: 'PATCH', path: `/api/v1/rows/${x.row}`, json: { title: 'changed' } }), expect: 404 },
  'GET /api/v1/pages/:id': { scope: 'api', req: (x) => ({ method: 'GET', path: `/api/v1/pages/${x.page}` }), expect: 404 },
  'POST /api/v1/pages': { scope: 'api', req: (x) => ({ method: 'POST', path: '/api/v1/pages', json: { title: 'injected', parentId: x.page } }), expect: 404 },
}

/** Every MCP tool with B's ids: refused (not found), or — for the listing tools — nothing of B in the answer. */
const MCP_TOOLS: Record<string, (x: Foreign) => Record<string, unknown>> = {
  one_overview: () => ({}),
  one_list_workspaces: () => ({}),
  one_search: () => ({ query: MARKER.slice(0, 10) }), // (the answer repeats the query)
  one_list_databases: () => ({}),
  one_get_page: (x) => ({ id: x.page }),
  one_get_database: (x) => ({ id: x.db }),
  one_query_database: (x) => ({ databaseId: x.db }),
  one_create_page: (x) => ({ title: 'injected', parentId: x.page }),
  one_update_page: (x) => ({ id: x.page, title: 'changed' }),
  one_create_row: (x) => ({ databaseId: x.db, title: 'injected' }),
  one_update_row: (x) => ({ id: x.row, properties: { Name: 'changed' } }),
  one_create_property: (x) => ({ databaseId: x.db, name: 'Injected', type: 'text' }),
  one_create_database: (x) => ({ title: 'injected', parentId: x.page }),
  one_trash_page: (x) => ({ id: x.row }),
}

const MARKER = 'bravo-only-7f3c'

/** The app's own route table (no server needed): METHOD + path of every handler, middleware left out. */
function registeredRoutes(): string[] {
  const dir = tempDir()
  mkdirSync(join(dir, 'app'))
  const config = loadConfig({ DATA_DIR: dir, DEV_MODE: '1', APP_DIR: join(dir, 'app') })
  const quiet = { debug() {}, info() {}, warn() {}, error() {} }
  const app = buildApp({ config, log: quiet, sessions: { secure: false } } as unknown as Services)
  // middleware takes (c, next); a route handler takes (c) or nothing
  return [...new Set(app.routes.filter((r) => r.method !== 'ALL' || r.handler.length < 2).map((r) => `${r.method} ${r.path}`))]
}

describe('isolation sweep: a member of A against workspace B', () => {
  let server: TestServer
  let alice: Client, bob: Client
  let A: string, aliceId: string, aliceToken: string
  let x: Foreign
  let hookSecretB: string, tokenSecretB: string
  const fileBytes = `file of B ${MARKER}`
  const docs: DocClient[] = []

  const doc = async (client: Client, name: string) => {
    const d = openDoc(server, client, name)
    docs.push(d)
    await d.synced
    return d
  }

  before(async () => {
    // Bob is a server admin (registration links); Alice is not
    server = await startServer({ API_RATE_LIMIT: '1000', ADMIN_EMAILS: 'bob@sweep.test', SIGNUP: 'domains:sweep.test' })
    alice = await signIn(server, 'alice@sweep.test')
    bob = await signIn(server, 'bob@sweep.test')
    aliceId = (await alice.get('/api/me')).body.user.id
    const bobId = (await bob.get('/api/me')).body.user.id
    A = (await alice.post('/api/workspaces', { name: 'Alpha' })).body.id
    const B = (await bob.post('/api/workspaces', { name: 'Bravo' })).body.id

    const metaA = await doc(alice, `ws:${A}`)
    seedMeta(metaA.doc, { db: 'db-alpha', row: 'row-alpha', page: 'page-alpha' }, 'alpha')
    await flushed(metaA)
    aliceToken = (await alice.post(`${W(A)}/tokens`, { name: 'Alice', scope: 'write' })).body.token

    const metaB = await doc(bob, `ws:${B}`)
    seedMeta(metaB.doc, { db: 'db-bravo', row: 'row-bravo', page: 'page-bravo' }, MARKER)
    await flushed(metaB)
    const pageB = await doc(bob, `ws:${B}:p:page-bravo`)
    writeText(pageB.doc, `content of B ${MARKER}`)
    await flushed(pageB)
    const privB = await doc(bob, `ws:${B}:u:${bobId}`)
    privB.doc.transact(() => privB.doc.getMap('pages').set('secret-bravo', pageEntry({ title: `Secret ${MARKER}` })))
    await flushed(privB)
    for (const d of docs.splice(0)) d.destroy()

    assert.equal((await bob.fetch(`${W(B)}/files/file-bravo`, { method: 'PUT', body: fileBytes, headers: { 'content-type': 'text/plain' } })).status, 201)
    const invite = (await bob.post(`${W(B)}/invites`, { role: 'member' })).body
    const token = (await bob.post(`${W(B)}/tokens`, { name: 'Bob', scope: 'write' })).body
    tokenSecretB = token.token
    const hook = (await bob.post(`${W(B)}/hooks`, { databaseId: 'db-bravo' })).body
    hookSecretB = hook.url.split('/hooks/')[1]
    const signupLink = (await bob.post('/api/server/signup-links', { max_uses: 5 })).body
    assert.ok(signupLink.id, JSON.stringify(signupLink))
    x = { ws: B, owner: bobId, invite: invite.id, token: token.id, hook: hook.id, signupLink: signupLink.id, file: 'file-bravo', page: 'page-bravo', db: 'db-bravo', row: 'row-bravo' }
  })

  after(async () => {
    for (const d of docs) d.destroy()
    await server.stop()
  })

  test('every registered route has an entry (a new route must say how it is scoped)', () => {
    const routes = registeredRoutes()
    const missing = routes.filter((r) => !ROUTES[r])
    assert.deepEqual(missing, [], `add these routes to ROUTES in test/tenancy.test.ts: ${missing.join(', ')}`)
    const stale = Object.keys(ROUTES).filter((r) => !routes.includes(r))
    assert.deepEqual(stale, [], 'ROUTES lists routes that no longer exist')
  })

  test('REST: every workspace route answers 404 for B, and B\'s ids inside A find nothing', async () => {
    // mutating cookie requests carry a JSON content type (the CSRF guard), also without a body
    const send = (r: Req) => alice.fetch(r.path, { method: r.method, json: r.json ?? (r.method === 'GET' || r.body ? undefined : {}), body: r.body, headers: r.headers })
    for (const [route, entry] of Object.entries(ROUTES)) {
      if (entry.scope !== 'workspace') continue
      const res = await send(entry.req(x.ws, x))
      assert.equal(res.status, 404, `${route} with B's id`)
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'workspace_not_found', route)
      if (entry.own === undefined) continue
      const inA = await send(entry.req(A, x))
      assert.equal(inA.status, entry.own, `${route} in A with B's ids`)
      if (route === 'POST /api/workspaces/:id/files/publish') assert.deepEqual(await inA.json(), { published: 0 })
    }
  })

  test('server administration: refused to everyone but the server admins', async () => {
    const anonymous = new Client(server.url)
    for (const [route, entry] of Object.entries(ROUTES)) {
      if (entry.scope !== 'server') continue
      const r = entry.req(x)
      const res = await alice.fetch(r.path, { method: r.method, json: r.json ?? (r.method === 'GET' ? undefined : {}) })
      assert.equal(res.status, 403, route)
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'server_admin_only', route)
      const out = await anonymous.fetch(r.path, { method: r.method, json: r.json ?? (r.method === 'GET' ? undefined : {}) })
      assert.equal(out.status, 401, `${route} signed out`)
    }
    // a member of B is no server admin either; the link is untouched
    assert.equal((await bob.get('/api/server/signup-links')).body.map((l: { id: string }) => l.id).join(), x.signupLink)
    assert.equal((await alice.get('/api/me')).body.server_admin, undefined)
    assert.equal((await bob.get('/api/me')).body.server_admin, true)
  })

  test('public API: A\'s token never reaches B', async () => {
    for (const [route, entry] of Object.entries(ROUTES)) {
      if (entry.scope !== 'api') continue
      const r = entry.req(x)
      const res = await fetch(server.url + r.path, {
        method: r.method,
        headers: { authorization: `Bearer ${aliceToken}`, ...(r.json ? { 'content-type': 'application/json' } : {}) },
        body: r.json ? JSON.stringify(r.json) : undefined,
      })
      const body = await res.json()
      if (typeof entry.expect === 'number') assert.equal(res.status, entry.expect, `${route}: ${JSON.stringify(body)}`)
      else {
        assert.equal(res.status, 200, route)
        entry.expect(body, x)
      }
      assert.ok(!JSON.stringify(body).includes(MARKER), `${route} must not show B's content`)
    }
    // B's hook secret and B's token are not interchangeable with anything of A's
    assert.equal((await fetch(`${server.url}/api/v1/hooks/${tokenSecretB}`)).status, 404)
    assert.equal((await fetch(`${server.url}/api/v1/workspace`, { headers: { authorization: `Bearer ${hookSecretB}` } })).status, 401)
  })

  test('MCP: every tool with B\'s ids is refused or shows nothing of B', async () => {
    const client = new McpClient({ name: 'sweep', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${aliceToken}` } } }))
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort()
      assert.deepEqual(tools, Object.keys(MCP_TOOLS).sort(), 'every MCP tool has an entry in MCP_TOOLS')
      for (const [name, args] of Object.entries(MCP_TOOLS)) {
        const res = (await client.callTool({ name, arguments: args(x) })) as { isError?: boolean; content: Array<{ text: string }> }
        const text = res.content.map((c) => c.text).join('\n')
        assert.ok(!text.includes(MARKER), `${name} must not show B's content: ${text}`)
        if (name === 'one_search') assert.equal(JSON.parse(text).total, 0, text)
        else if (name === 'one_list_workspaces') assert.deepEqual(JSON.parse(text).workspaces.map((w: { id: string; name: string }) => [w.id, w.name]), [[`team:${A}`, 'Alpha']])
        else if (!['one_overview', 'one_list_databases'].includes(name)) assert.equal(res.isError, true, `${name} must be refused: ${text}`)
      }
      // the `workspace` argument naming B (its id, bare or "team:", its name) is refused by every tool — even with A's own ids
      const own: Foreign = { ...x, page: 'page-alpha', db: 'db-alpha', row: 'row-alpha' }
      for (const target of [x.ws, `team:${x.ws}`, 'Bravo', ' bravo ']) {
        for (const [name, args] of Object.entries(MCP_TOOLS)) {
          if (name === 'one_list_workspaces') continue
          const res = (await client.callTool({ name, arguments: { ...args(own), workspace: target } })) as { isError?: boolean; content: Array<{ text: string }> }
          const text = res.content.map((c) => c.text).join('\n')
          assert.equal(res.isError, true, `${name} with workspace ${JSON.stringify(target)}: ${text}`)
          assert.match(text, /^workspace_mismatch: this connection \(its API token\) reaches only the workspace "Alpha"/, name)
          assert.ok(!text.includes(MARKER), `${name} must not show B's content`)
        }
      }
      // nothing of A was changed by those refused calls
      const page = (await client.callTool({ name: 'one_get_page', arguments: { id: 'page-alpha', workspace: 'alpha' } })) as { isError?: boolean; content: Array<{ text: string }> }
      assert.ok(!page.isError, page.content[0]?.text)
      assert.notEqual(JSON.parse(page.content[0]!.text).title, 'changed')
    } finally {
      await client.close()
    }
  })

  test('WebSocket: no document of B opens, nor anyone else\'s private namespace', async () => {
    const names = [
      `ws:${x.ws}`,
      `ws:${x.ws}:p:${x.page}`,
      `ws:${x.ws}:p:page-alpha`,
      `ws:${x.ws}:u:${x.owner}`,
      `ws:${x.ws}:u:${x.owner}:p:secret-bravo`,
      `ws:${x.ws}:u:${aliceId}`,
      `ws:${x.ws}:u:${aliceId}:p:anything`,
      `ws:${A}:u:${x.owner}`,
      `ws:${A}:u:${x.owner}:p:secret-bravo`,
    ]
    for (const name of names) {
      const d = openDoc(server, alice, name)
      try {
        await assert.rejects(d.ready, /forbidden/, name)
      } finally {
        d.destroy()
      }
    }
  })

  test('afterwards B is untouched', async () => {
    const list = (await bob.get('/api/me')).body.workspaces as Ws[]
    assert.deepEqual(list.filter((w) => w.id === x.ws).map((w) => [w.name, w.role]), [['Bravo', 'owner']])
    assert.deepEqual((await bob.get(`${W(x.ws)}/members`)).body.map((m: { role: string }) => m.role), ['owner'])
    assert.deepEqual((await bob.get(`${W(x.ws)}/invites`)).body.map((i: { id: string }) => i.id), [x.invite])
    assert.equal((await bob.get(`${W(x.ws)}/tokens`)).body.length, 1)
    assert.equal((await bob.get(`${W(x.ws)}/hooks`)).body[0].id, x.hook)
    assert.equal(await (await bob.fetch(`${W(x.ws)}/files/file-bravo`)).text(), fileBytes)
    const api = await fetch(`${server.url}/api/v1/pages/${x.page}`, { headers: { authorization: `Bearer ${tokenSecretB}` } })
    assert.equal(api.status, 200)
    const page = (await api.json()) as { title: string }
    assert.equal(page.title, `Page ${MARKER}`)
    assert.match(JSON.stringify(page), new RegExp(`content of B ${MARKER}`))
    const listed = await fetch(`${server.url}/api/v1/databases/${x.db}/rows`, { headers: { authorization: `Bearer ${tokenSecretB}` } })
    const rows = (await listed.json()) as { rows: Array<{ title: string }> }
    assert.deepEqual(rows.rows.map((r) => r.title), [`Row ${MARKER}`])
    // B's hook still answers
    assert.equal((await fetch(`${server.url}/api/v1/hooks/${hookSecretB}`)).status, 200)
  })
})
