import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import { Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

/* ------------------------------------------------------------------ helpers */

/** A page entry the way the app's binding writes it (src/app/cloud/schema.ts newPageMap). */
function pageEntry(fields: Record<string, unknown>, properties: Record<string, unknown> = {}): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('createdBy', 'seed')
  yp.set('updatedBy', 'seed')
  const props = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(properties)) props.set(k, v)
  yp.set('properties', props)
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

type Def = { id: string; name: string; type: string; [k: string]: unknown }

/** A database page + its schema entry (keyed properties with `order`). */
function addDatabase(doc: Y.Doc, id: string, title: string, props: Def[], extra: Record<string, unknown> = {}) {
  doc.transact(() => {
    doc.getMap('pages').set(id, pageEntry({ kind: 'database', title, order: doc.getMap('pages').size + 1 }))
    const ydb = new Y.Map<unknown>()
    const pm = new Y.Map<unknown>()
    props.forEach((p, i) => pm.set(p.id, { ...p, order: i }))
    ydb.set('properties', pm)
    ydb.set('views', new Y.Map<unknown>())
    ydb.set('nextUniqueId', 1)
    for (const [k, v] of Object.entries(extra)) ydb.set(k, v)
    doc.getMap('databases').set(id, ydb)
  })
}

const TASKS: Def[] = [
  { id: 'p-title', name: 'Name', type: 'title' },
  { id: 'p-status', name: 'Status', type: 'status', options: [{ id: 'o-todo', name: 'Not started', color: 'gray', group: 'todo' }, { id: 'o-doing', name: 'In progress', color: 'blue', group: 'in_progress' }, { id: 'o-done', name: 'Done', color: 'green', group: 'done' }] },
  { id: 'p-tags', name: 'Tags', type: 'multi_select', options: [{ id: 't-a', name: 'Alpha', color: 'red' }, { id: 't-b', name: 'Beta', color: 'blue' }] },
  { id: 'p-due', name: 'Due', type: 'date' },
  { id: 'p-done', name: 'Done?', type: 'checkbox' },
  { id: 'p-est', name: 'Estimate', type: 'number' },
  { id: 'p-link', name: 'Link', type: 'url' },
  { id: 'p-owner', name: 'Owner', type: 'person' },
  { id: 'p-key', name: 'Key', type: 'unique_id', idPrefix: 'TASK' },
  { id: 'p-f', name: 'Score', type: 'formula', formula: '1+1' },
  { id: 'p-proj', name: 'Project', type: 'relation', relationDatabaseId: 'db-proj' },
  { id: 'p-created', name: 'Created', type: 'created_time' },
  { id: 'p-by', name: 'Created by', type: 'created_by' },
]
const PROJECTS: Def[] = [
  { id: 'q-title', name: 'Name', type: 'title' },
  { id: 'p-proj.2way', name: 'Tasks', type: 'relation', relationDatabaseId: 'db-tasks' },
]

const rowEntry = (doc: Y.Doc, id: string) => doc.getMap('pages').get(id) as Y.Map<unknown> | undefined
const propsOf = (doc: Y.Doc, id: string) => (rowEntry(doc, id)?.get('properties') as Y.Map<unknown>).toJSON()

class Bearer {
  readonly base: string
  readonly token: string
  constructor(base: string, token: string) {
    this.base = base
    this.token = token
  }
  async req<T = any>(method: string, path: string, json?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; res: Response }> {
    const res = await fetch(this.base + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: json === undefined ? undefined : JSON.stringify(json),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, res }
  }
  get = <T = any>(p: string) => this.req<T>('GET', p)
  post = <T = any>(p: string, j?: unknown, h?: Record<string, string>) => this.req<T>('POST', p, j ?? {}, h)
  patch = <T = any>(p: string, j?: unknown) => this.req<T>('PATCH', p, j ?? {})
}

/* ------------------------------------------------------------------ suite */

describe('public API v1', () => {
  let server: TestServer
  let owner: Client, admin: Client, member: Client, viewer: Client, other: Client
  let wsId: string, otherWs: string
  let meta: DocClient
  let memberId: string
  let writer: Bearer, reader: Bearer
  let writeTokenId: string
  const open: DocClient[] = []

  before(async () => {
    server = await startServer({ API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'owner@api.test')
    admin = await signIn(server, 'admin@api.test')
    member = await signIn(server, 'member@api.test')
    viewer = await signIn(server, 'viewer@api.test')
    other = await signIn(server, 'other@api.test')
    wsId = (await owner.post('/api/workspaces', { name: 'API Works' })).body.id
    otherWs = (await other.post('/api/workspaces', { name: 'Elsewhere' })).body.id
    for (const [client, role] of [[admin, 'admin'], [member, 'member'], [viewer, 'viewer']] as const) {
      const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
      await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
    }
    memberId = (await member.get('/api/me')).body.user.id

    meta = openDoc(server, owner, `ws:${wsId}`)
    open.push(meta)
    await meta.synced
    addDatabase(meta.doc, 'db-tasks', 'Tasks', TASKS)
    addDatabase(meta.doc, 'db-proj', 'Projects', PROJECTS)
    meta.doc.transact(() => {
      meta.doc.getMap('pages').set('proj-1', pageEntry({ title: 'Apollo', parentId: 'db-proj', databaseId: 'db-proj', order: 1 }))
      meta.doc.getMap('pages').set('proj-2', pageEntry({ title: 'Gemini', parentId: 'db-proj', databaseId: 'db-proj', order: 2 }))
      meta.doc.getMap('pages').set('row-0', pageEntry({ title: 'Existing', parentId: 'db-tasks', databaseId: 'db-tasks', order: 7 }, { 'p-key': 41 }))
      meta.doc.getMap('pages').set('doc-1', pageEntry({ title: 'Handbook', order: 3 }))
      meta.doc.getMap('people').set(memberId, { id: memberId, name: 'Mia Member', color: 'blue' })
      ;(meta.doc.getMap('databases').get('db-tasks') as Y.Map<unknown>).set('nextUniqueId', 42)
    })
    await flushed(meta)

    const w = await admin.post(`/api/workspaces/${wsId}/tokens`, { name: 'Zapier', scope: 'write' })
    assert.equal(w.status, 201)
    writeTokenId = w.body.id
    writer = new Bearer(server.url, w.body.token)
    const r = await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Dashboard', scope: 'read' })
    reader = new Bearer(server.url, r.body.token)
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('tokens: admins manage them, the secret is shown once, members and viewers cannot', async () => {
    const list = await owner.get(`/api/workspaces/${wsId}/tokens`)
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.map((t: { name: string }) => t.name).sort(), ['Dashboard', 'Zapier'])
    const z = list.body.find((t: { name: string }) => t.name === 'Zapier')
    assert.equal(z.scope, 'write')
    assert.equal(z.revoked, false)
    assert.equal(z.created_by.email, 'admin@api.test')
    assert.equal('token' in z, false, 'the secret is never listed')
    assert.match(writer.token, /^one_[A-Za-z0-9_-]{43}$/)
    assert.ok(!server.logs().includes(writer.token), 'the secret is never logged')

    assert.equal((await member.get(`/api/workspaces/${wsId}/tokens`)).status, 403)
    assert.equal((await viewer.post(`/api/workspaces/${wsId}/tokens`, { name: 'x', scope: 'write' })).status, 403)
    assert.equal((await other.get(`/api/workspaces/${wsId}/tokens`)).status, 404)
    assert.equal((await owner.post(`/api/workspaces/${wsId}/tokens`, { name: '', scope: 'write' })).status, 400)
    assert.equal((await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'x', scope: 'admin' })).status, 400)
  })

  test('auth: bearer only — no header, bad tokens, the session cookie and revoked tokens are refused', async () => {
    const anon = await fetch(`${server.url}/api/v1/workspace`)
    assert.equal(anon.status, 401)
    assert.equal(((await anon.json()) as { error: { code: string } }).error.code, 'unauthenticated')
    assert.match(anon.headers.get('www-authenticate') ?? '', /^Bearer/)
    assert.equal((await new Bearer(server.url, 'one_' + 'x'.repeat(43)).get('/api/v1/workspace')).body.error.code, 'invalid_token')
    assert.equal((await new Bearer(server.url, 'nonsense').get('/api/v1/workspace')).status, 401)
    // a signed-in browser's cookie means nothing here
    const cookie = await owner.fetch('/api/v1/workspace')
    assert.equal(cookie.status, 401)
    assert.equal(cookie.headers.getSetCookie().length, 0, 'the session is not even touched')

    const ws = await writer.get('/api/v1/workspace')
    assert.equal(ws.status, 200)
    assert.deepEqual({ id: ws.body.id, name: ws.body.name, scope: ws.body.scope }, { id: wsId, name: 'API Works', scope: 'write' })
    assert.equal(ws.res.headers.get('access-control-allow-origin'), null, 'no CORS')

    const temp = await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Temp', scope: 'read' })
    const t = new Bearer(server.url, temp.body.token)
    assert.equal((await t.get('/api/v1/databases')).status, 200)
    assert.equal((await owner.del(`/api/workspaces/${wsId}/tokens/${temp.body.id}`)).status, 204)
    assert.equal((await t.get('/api/v1/databases')).body.error.code, 'invalid_token')
    assert.equal((await owner.del(`/api/workspaces/${wsId}/tokens/${temp.body.id}`)).status, 404)

    const used = (await owner.get(`/api/workspaces/${wsId}/tokens`)).body.find((x: { id: string }) => x.id === writeTokenId)
    assert.ok(used.last_used_at, 'last use is recorded')
  })

  test('scope: a read token reads but cannot write (403); cross-origin server calls are not blocked', async () => {
    assert.equal((await reader.get('/api/v1/databases')).status, 200)
    const denied = await reader.post('/api/v1/databases/db-tasks/rows', { title: 'nope' })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error.code, 'insufficient_scope')
    assert.equal((await reader.patch('/api/v1/rows/row-0', { title: 'x' })).status, 403)
    assert.equal((await reader.post('/api/v1/pages', { title: 'x' })).status, 403)
    // the cookie routes' Origin / Sec-Fetch-Site / JSON checks don't apply to bearer calls
    const cross = await writer.req('PATCH', '/api/v1/rows/row-0', { title: 'Existing' }, { origin: 'https://n8n.example', 'sec-fetch-site': 'cross-site' })
    assert.equal(cross.status, 200)
  })

  test('databases: list and schema; ids of another workspace are 404', async () => {
    const list = await reader.get('/api/v1/databases')
    assert.deepEqual(list.body.map((d: { title: string }) => d.title), ['Projects', 'Tasks'])
    const tasks = list.body.find((d: { id: string }) => d.id === 'db-tasks')
    assert.equal(tasks.url, `http://localhost:${server.port}/app/?w=${wsId}#/p/db-tasks`)
    const status = tasks.properties.find((p: { name: string }) => p.name === 'Status')
    assert.deepEqual(status.options.map((o: { name: string }) => o.name), ['Not started', 'In progress', 'Done'])
    assert.equal(tasks.properties.find((p: { name: string }) => p.name === 'Score').readOnly, true)
    assert.equal(tasks.properties.find((p: { name: string }) => p.name === 'Key').prefix, 'TASK')
    assert.equal((await reader.get('/api/v1/databases/db-tasks')).body.id, 'db-tasks')

    // another workspace with its own database: invisible to this token
    const m = openDoc(server, other, `ws:${otherWs}`)
    open.push(m)
    await m.synced
    addDatabase(m.doc, 'db-secret', 'Secret', [{ id: 's-title', name: 'Name', type: 'title' }])
    m.doc.transact(() => m.doc.getMap('pages').set('secret-row', pageEntry({ title: 'Classified', parentId: 'db-secret', databaseId: 'db-secret' })))
    await flushed(m)
    for (const path of ['/api/v1/databases/db-secret', '/api/v1/databases/db-secret/rows', '/api/v1/rows/secret-row', '/api/v1/pages/secret-row']) {
      assert.equal((await writer.get(path)).status, 404, path)
    }
    assert.equal((await writer.post('/api/v1/databases/db-secret/rows', { title: 'x' })).status, 404)
    assert.equal((await writer.patch('/api/v1/rows/secret-row', { title: 'x' })).status, 404)
    assert.equal((await writer.post('/api/v1/pages', { parentId: 'secret-row', title: 'x' })).status, 404)
    // a page is not a row, a database is not a page parent
    assert.equal((await writer.get('/api/v1/rows/doc-1')).status, 404)
    assert.equal((await writer.post('/api/v1/pages', { parentId: 'db-tasks', title: 'x' })).body.error.code, 'parent_is_database')
  })

  test('rows: friendly values in, the exact meta entry and content document out — live to connected clients', async () => {
    const watcher = openDoc(server, member, `ws:${wsId}`)
    open.push(watcher)
    await watcher.synced
    const before = Date.now()
    const res = await writer.post('/api/v1/databases/db-tasks/rows', {
      title: 'Ship the API',
      properties: {
        status: 'in PROGRESS',
        Tags: ['alpha', 't-b'],
        Due: '2026-10-05T14:30',
        'Done?': 'yes',
        Estimate: '3,5',
        Link: ' https://one.example ',
        Owner: 'MEMBER@api.test',
        Project: ['proj-1'],
      },
      content: '# Plan\n\nWrite **docs** and *tests*.\nSecond line\n\n- [ ] curl\n- [x] n8n\n\n1. one\n2. two\n   - nested\n\n> quoted\n\n```ts\nconst x = 1\n```\n\n---\nSee [the docs](https://example.com/docs) and `code`.',
    })
    assert.equal(res.status, 201)
    const id = res.body.id as string
    assert.equal(res.body.url, `http://localhost:${server.port}/app/?w=${wsId}#/p/${id}`)

    // live: the open meta document of someone else receives it (no reconnect)
    await waitFor(() => !!rowEntry(watcher.doc, id), 5000, 'row at the connected client')
    const yp = rowEntry(watcher.doc, id)!
    const j = yp.toJSON()
    assert.equal(j.kind, 'page')
    assert.equal(j.title, 'Ship the API')
    assert.equal(j.parentId, 'db-tasks')
    assert.equal(j.databaseId, 'db-tasks')
    assert.equal(j.order, 8, 'after the last row')
    assert.equal(j.trashed, false)
    assert.equal(j.trashedAt, null)
    assert.equal(j.icon, null)
    assert.equal(j.cover, null)
    assert.deepEqual(j.settings, { fullWidth: false, smallText: false, font: 'sans', locked: false })
    assert.ok(j.createdAt >= before && j.updatedAt === j.createdAt)
    assert.equal(j.createdBy, `api:${writeTokenId}`)
    assert.equal(j.updatedBy, `api:${writeTokenId}`)
    assert.ok(yp.get('properties') instanceof Y.Map)
    assert.ok(yp.get('comments') instanceof Y.Map)
    assert.match(j.plain, /^Plan\nWrite docs and tests.Second line/)
    assert.deepEqual(propsOf(watcher.doc, id), {
      'p-status': 'o-doing',
      'p-tags': ['t-a', 't-b'],
      'p-due': { start: '2026-10-05T14:30', end: null, includeTime: true },
      'p-done': true,
      'p-est': 3.5,
      'p-link': 'https://one.example',
      'p-owner': [memberId],
      'p-proj': ['proj-1'],
      'p-key': 42,
    })
    const ydb = watcher.doc.getMap('databases').get('db-tasks') as Y.Map<unknown>
    assert.equal(ydb.get('nextUniqueId'), 43)
    // two-way relation: the project lists the task
    assert.deepEqual(propsOf(watcher.doc, 'proj-1')['p-proj.2way'], [id])

    // the content document, as y-prosemirror stores TipTap nodes
    const content = openDoc(server, member, `ws:${wsId}:p:${id}`)
    open.push(content)
    await content.synced
    const frag = content.doc.getXmlFragment('default')
    const names = frag.toArray().map((n) => (n as Y.XmlElement).nodeName)
    assert.deepEqual(names, ['heading', 'paragraph', 'taskList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'paragraph'])
    const els = frag.toArray() as Y.XmlElement[]
    assert.equal(els[0]!.getAttribute('level'), 1)
    assert.match(String(els[0]!.getAttribute('id')), /^[0-9a-f-]{36}$/, 'block ids')
    const ids = new Set<string>()
    const walk = (n: Y.XmlElement) => {
      if (n.nodeName !== 'hardBreak') {
        const bid = n.getAttribute('id') as string | undefined
        assert.ok(bid && !ids.has(bid), `unique block id on ${n.nodeName}`)
        ids.add(bid)
      }
      for (const c of n.toArray()) if (c instanceof Y.XmlElement) walk(c)
    }
    els.forEach(walk)
    const para = els[1]!
    assert.deepEqual(
      (para.toArray()[0] as Y.XmlText).toDelta(),
      [{ insert: 'Write ' }, { insert: 'docs', attributes: { bold: {} } }, { insert: ' and ' }, { insert: 'tests', attributes: { italic: {} } }, { insert: '.' }],
    )
    assert.equal((para.toArray()[1] as Y.XmlElement).nodeName, 'hardBreak')
    const task = els[2]!.toArray() as Y.XmlElement[]
    assert.deepEqual(task.map((t) => [t.nodeName, t.getAttribute('checked')]), [['taskItem', false], ['taskItem', true]])
    assert.equal((task[0]!.toArray()[0] as Y.XmlElement).nodeName, 'paragraph')
    const nested = (els[3]!.toArray()[1] as Y.XmlElement).toArray().map((n) => (n as Y.XmlElement).nodeName)
    assert.deepEqual(nested, ['paragraph', 'bulletList'])
    assert.equal(els[5]!.getAttribute('language'), 'ts')
    assert.equal(els[5]!.toString().includes('const x = 1'), true)
    const last = (els[7]!.toArray()[0] as Y.XmlText).toDelta() as Array<{ insert: string; attributes?: Record<string, unknown> }>
    assert.deepEqual(last.find((d) => d.insert === 'the docs')?.attributes, { link: { href: 'https://example.com/docs' } })
    assert.deepEqual(last.find((d) => d.insert === 'code')?.attributes, { code: {} })

    // reading it back: friendly values
    const row = await reader.get(`/api/v1/rows/${id}`)
    const { 'Created by': by, ...values } = row.body.properties
    assert.equal(by.kind, 'api') // written by the token: { kind: 'api', id: <token id> }
    assert.equal(typeof by.id, 'string')
    assert.deepEqual(values, {
      Status: 'In progress',
      Tags: ['Alpha', 'Beta'],
      Due: { start: '2026-10-05T14:30', end: null },
      'Done?': true,
      Estimate: 3.5,
      Link: 'https://one.example',
      Owner: [{ id: memberId, name: 'Mia Member', email: 'member@api.test' }],
      Key: 'TASK-42',
      Project: [{ id: 'proj-1', title: 'Apollo' }],
      Created: row.body.createdAt,
    })
    const page = await reader.get(`/api/v1/pages/${id}`)
    assert.equal(page.body.kind, 'row')
    assert.match(page.body.text, /^Plan\nWrite docs and tests.Second line\ncurl\n\nn8n\n\none/)

    // the next row gets the next number
    const second = await writer.post('/api/v1/databases/db-tasks/rows', { properties: { Name: 'Second via title property' } })
    await waitFor(() => !!rowEntry(watcher.doc, second.body.id), 5000, 'second row')
    assert.equal(propsOf(watcher.doc, second.body.id)['p-key'], 43)
    assert.equal(rowEntry(watcher.doc, second.body.id)!.get('title'), 'Second via title property')
  })

  test('values that do not fit are a 422 that names the problem (nothing is written)', async () => {
    const count = async () => (await reader.get('/api/v1/databases/db-tasks/rows?limit=100')).body.rows.length as number
    const n = await count()
    const bad = async (properties: Record<string, unknown>, code = 'invalid_value') => {
      const r = await writer.post('/api/v1/databases/db-tasks/rows', { title: 'bad', properties })
      assert.equal(r.status, 422, JSON.stringify(properties))
      assert.equal(r.body.error.code, code)
      return r.body.error
    }
    const unknownOpt = await bad({ Status: 'Blocked' })
    assert.deepEqual(unknownOpt.details.errors[0].allowed, ['Not started', 'In progress', 'Done'])
    assert.match(unknownOpt.message, /Status: unknown option "Blocked"/)
    await bad({ Tags: ['Alpha', 'Gamma'] })
    await bad({ Due: '05.10.2026' })
    await bad({ Due: '2026-02-30' })
    await bad({ Due: { start: '2026-10-05', end: '2026-10-01' } })
    await bad({ 'Done?': 'maybe' })
    await bad({ Estimate: 'lots' })
    await bad({ Owner: 'stranger@api.test' })
    await bad({ Project: ['row-0'] }, 'invalid_value')
    await bad({ Score: 3 })
    await bad({ Key: 7 })
    await bad({ Created: '2026-01-01' })
    await bad({ 'Created by': 'member@api.test' })
    const unknown = await bad({ Nope: 1, Status: 'Blocked' })
    assert.equal(unknown.details.errors.length, 2, 'every problem is listed')
    assert.equal((await writer.post('/api/v1/databases/db-tasks/rows', { title: 5 })).status, 400)
    assert.equal(await count(), n, 'no row was created')
  })

  test('PATCH changes cells live and keeps two-way relations in step', async () => {
    const created = await writer.post('/api/v1/databases/db-tasks/rows', { title: 'Patch me', properties: { Project: 'proj-1' } })
    const id = created.body.id
    await waitFor(() => !!rowEntry(meta.doc, id), 5000, 'row')
    const res = await writer.patch(`/api/v1/rows/${id}`, { title: 'Patched', properties: { Status: 'done', Project: ['proj-2'], Due: { start: '2026-11-01', end: '2026-11-03' }, Tags: null } })
    assert.equal(res.status, 200)
    assert.equal(res.body.title, 'Patched')
    assert.equal(res.body.properties.Status, 'Done')
    assert.deepEqual(res.body.properties.Due, { start: '2026-11-01', end: '2026-11-03' })
    assert.deepEqual(res.body.properties.Tags, [])
    await waitFor(() => propsOf(meta.doc, id)['p-status'] === 'o-done', 5000, 'cell at the client')
    assert.equal(rowEntry(meta.doc, id)!.get('updatedBy'), `api:${writeTokenId}`)
    assert.ok(!(propsOf(meta.doc, 'proj-1')['p-proj.2way'] as string[]).includes(id), 'unlinked from the old project')
    assert.ok((propsOf(meta.doc, 'proj-2')['p-proj.2way'] as string[]).includes(id), 'linked to the new one')
    assert.equal((await writer.patch(`/api/v1/rows/${id}`, { properties: { Status: 'Blocked' } })).status, 422)
    assert.equal(propsOf(meta.doc, id)['p-status'], 'o-done')
  })

  test('rows are listed with cursors, in the table order or by time', async () => {
    for (let i = 0; i < 5; i++) await writer.post('/api/v1/databases/db-tasks/rows', { title: `Bulk ${i}` })
    const all: string[] = []
    let cursor: string | null = null
    do {
      const page: { status: number; body: { rows: Array<{ id: string; title: string }>; next: string | null } } = await reader.get(`/api/v1/databases/db-tasks/rows?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(page.status, 200)
      assert.ok(page.body.rows.length <= 3)
      all.push(...page.body.rows.map((r) => r.id))
      cursor = page.body.next
    } while (cursor)
    assert.equal(new Set(all).size, all.length, 'no duplicates across pages')
    const flat = (await reader.get('/api/v1/databases/db-tasks/rows?limit=100')).body.rows.map((r: { id: string }) => r.id)
    assert.deepEqual(all, flat)
    assert.equal(flat[0], 'row-0', 'table order')
    const newest = (await reader.get('/api/v1/databases/db-tasks/rows?sort=-createdAt&limit=1')).body.rows[0]
    assert.equal(newest.title, 'Bulk 4')
    assert.equal((await reader.get('/api/v1/databases/db-tasks/rows?limit=0')).status, 400)
    assert.equal((await reader.get('/api/v1/databases/db-tasks/rows?sort=title')).status, 400)
    assert.equal((await reader.get('/api/v1/databases/db-tasks/rows?cursor=garbage')).body.error.code, 'invalid_cursor')
  })

  test('pages: create at the root or under a page, read back with text', async () => {
    const root = await writer.post('/api/v1/pages', { title: 'Release notes', content: 'Version **1.0**\n\n- fast\n- small' })
    assert.equal(root.status, 201)
    await waitFor(() => !!rowEntry(meta.doc, root.body.id), 5000, 'page')
    const yp = rowEntry(meta.doc, root.body.id)!
    assert.equal(yp.get('parentId'), null)
    assert.equal(yp.get('databaseId'), null)
    assert.ok((yp.get('order') as number) >= 4, 'after the last root page')
    const child = await writer.post('/api/v1/pages', { parentId: 'doc-1', title: 'Chapter 1' })
    await waitFor(() => !!rowEntry(meta.doc, child.body.id), 5000, 'child')
    assert.equal(rowEntry(meta.doc, child.body.id)!.get('parentId'), 'doc-1')
    const got = await reader.get(`/api/v1/pages/${root.body.id}`)
    assert.equal(got.body.kind, 'page')
    assert.equal(got.body.title, 'Release notes')
    assert.equal(got.body.text, 'Version 1.0\nfast\n\nsmall', 'the app\'s plainText rules')
    assert.equal((await reader.get('/api/v1/pages/db-tasks')).body.kind, 'database')
    assert.equal((await writer.post('/api/v1/pages', { parentId: 'nope', title: 'x' })).status, 404)
  })

  test('Idempotency-Key: a repeat within 24 h returns the first answer and creates nothing', async () => {
    const key = { 'idempotency-key': 'order-1001' }
    const a = await writer.post('/api/v1/databases/db-tasks/rows', { title: 'Order 1001' }, key)
    const [b, c] = await Promise.all([
      writer.post('/api/v1/databases/db-tasks/rows', { title: 'Order 1001' }, key),
      writer.post('/api/v1/databases/db-tasks/rows', { title: 'Order 1001' }, key),
    ])
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(c.status, 200)
    assert.equal(b.body.id, a.body.id)
    assert.equal(c.body.id, a.body.id)
    assert.equal(b.res.headers.get('idempotent-replayed'), 'true')
    await waitFor(() => !!rowEntry(meta.doc, a.body.id), 5000, 'row')
    const same = [...meta.doc.getMap('pages').values()].filter((p) => (p as Y.Map<unknown>).get('title') === 'Order 1001')
    assert.equal(same.length, 1)
  })
})

describe('incoming webhooks', () => {
  let server: TestServer
  let owner: Client, member: Client
  let wsId: string
  let meta: DocClient
  let url: string
  let hookId: string

  const post = (u: string, body: string, type = 'application/json', headers: Record<string, string> = {}) =>
    fetch(u, { method: 'POST', headers: { 'content-type': type, ...headers }, body }).then(async (r) => ({ status: r.status, body: (await r.json()) as any, res: r }))

  before(async () => {
    server = await startServer()
    owner = await signIn(server, 'owner@hooks.test')
    member = await signIn(server, 'member@hooks.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Hooks' })).body.id
    const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
    await member.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
    meta = openDoc(server, owner, `ws:${wsId}`)
    await meta.synced
    addDatabase(meta.doc, 'db-leads', 'Leads', [
      { id: 'l-title', name: 'Name', type: 'title' },
      { id: 'l-email', name: 'Email', type: 'email' },
      { id: 'l-stage', name: 'Stage', type: 'select', options: [{ id: 's-new', name: 'New', color: 'gray' }, { id: 's-won', name: 'Won', color: 'green' }] },
      { id: 'l-size', name: 'Seats', type: 'number' },
      { id: 'l-n', name: 'No', type: 'unique_id' },
    ])
    await flushed(meta)
  })

  after(async () => {
    meta.destroy()
    await server.stop()
  })

  test('admins create a hook for a database; members cannot; unknown databases are 404', async () => {
    assert.equal((await member.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'db-leads' })).status, 403)
    assert.equal((await owner.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'nope' })).status, 404)
    const res = await owner.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'db-leads' })
    assert.equal(res.status, 201)
    url = res.body.url
    hookId = res.body.id
    assert.match(url, new RegExp(`^http://localhost:${server.port}/api/v1/hooks/[A-Za-z0-9_-]{43}$`))
    url = url.replace('localhost', '127.0.0.1')
    assert.deepEqual(res.body.database, { id: 'db-leads', title: 'Leads' })
    const list = await owner.get(`/api/workspaces/${wsId}/hooks`)
    assert.equal(list.body.length, 1)
    assert.equal('url' in list.body[0], false, 'the URL is only in the create answer')
    const info = await fetch(url)
    assert.equal(((await info.json()) as { database: { title: string } }).database.title, 'Leads')
  })

  test('JSON: keys map to properties, title / name to the title, the rest into the content', async () => {
    const res = await post(url, JSON.stringify({ name: 'Ada Lovelace', EMAIL: 'ada@example.com', stage: 'won', Seats: 'lots', company: 'Analytical Engines', meta: { utm: 'x' } }))
    assert.equal(res.status, 201)
    await waitFor(() => !!meta.doc.getMap('pages').get(res.body.id), 5000, 'row')
    assert.equal(rowEntry(meta.doc, res.body.id)!.get('title'), 'Ada Lovelace')
    assert.equal(rowEntry(meta.doc, res.body.id)!.get('createdBy'), `hook:${hookId}`)
    assert.deepEqual(propsOf(meta.doc, res.body.id), { 'l-email': 'ada@example.com', 'l-stage': 's-won', 'l-n': 1 })
    const plain = rowEntry(meta.doc, res.body.id)!.get('plain') as string
    assert.match(plain, /Seats: lots/)
    assert.match(plain, /company: Analytical Engines/)
    assert.match(plain, /meta: \{"utm":"x"\}/)
  })

  test('form-encoded and plain-text bodies work too; no title → the first string value', async () => {
    const form = await post(url, new URLSearchParams({ Email: 'form@example.com', Stage: 'New', note: 'from a form' }).toString(), 'application/x-www-form-urlencoded')
    assert.equal(form.status, 201)
    await waitFor(() => !!rowEntry(meta.doc, form.body.id), 5000, 'form row')
    assert.equal(rowEntry(meta.doc, form.body.id)!.get('title'), 'form@example.com')
    assert.equal(propsOf(meta.doc, form.body.id)['l-stage'], 's-new')
    // One's own automations retry as text/plain (no-cors); a cross-site Origin is fine here
    const text = await post(url, JSON.stringify({ title: 'From text/plain', Stage: 'Won' }), 'text/plain;charset=UTF-8', { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' })
    assert.equal(text.status, 201)
    const raw = await post(url, 'Call back Grace\nShe asked about pricing.', 'text/plain')
    assert.equal(raw.status, 201)
    await waitFor(() => !!rowEntry(meta.doc, raw.body.id), 5000, 'text row')
    assert.equal(rowEntry(meta.doc, raw.body.id)!.get('title'), 'Call back Grace')
    assert.equal((await post(url, '[1,2]')).status, 400)
    assert.equal((await post(url, '{bad', 'application/json')).status, 400)
  })

  test('One’s own webhook envelope maps its row; deliveryId makes repeats a no-op', async () => {
    const one = { event: 'row_created', source: 'simplecms-one', automation: { id: 'a', name: 'x' }, database: { id: 'x', title: 'X' }, row: { id: 'r', title: 'Grace Hopper', url: 'u', properties: { Email: 'grace@example.com', Stage: 'Won' } }, changes: [], timestamp: new Date().toISOString(), deliveryId: 'dlv-123' }
    const a = await post(url, JSON.stringify(one))
    const b = await post(url, JSON.stringify(one), 'text/plain;charset=UTF-8')
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(b.body.id, a.body.id)
    await waitFor(() => !!rowEntry(meta.doc, a.body.id), 5000, 'row')
    assert.equal(rowEntry(meta.doc, a.body.id)!.get('title'), 'Grace Hopper')
    assert.deepEqual(propsOf(meta.doc, a.body.id)['l-stage'], 's-won')
    assert.equal(rowEntry(meta.doc, a.body.id)!.get('plain'), '', 'the envelope is not content')
    const grace = [...meta.doc.getMap('pages').values()].filter((p) => (p as Y.Map<unknown>).get('title') === 'Grace Hopper')
    assert.equal(grace.length, 1)
    // the Idempotency-Key header works the same
    const h1 = await post(url, JSON.stringify({ title: 'Keyed' }), 'application/json', { 'idempotency-key': 'k-1' })
    const h2 = await post(url, JSON.stringify({ title: 'Keyed' }), 'application/json', { 'idempotency-key': 'k-1' })
    assert.equal(h2.body.id, h1.body.id)
  })

  test('deliveries are counted; regenerate kills the old URL; delete kills the hook', async () => {
    const list = (await owner.get(`/api/workspaces/${wsId}/hooks`)).body
    assert.ok(list[0].deliveries >= 5)
    assert.ok(list[0].last_delivery_at)
    const regen = await owner.post(`/api/workspaces/${wsId}/hooks/${hookId}/regenerate`)
    assert.equal(regen.status, 200)
    const fresh = regen.body.url.replace('localhost', '127.0.0.1')
    assert.notEqual(fresh, url)
    assert.equal((await post(url, JSON.stringify({ title: 'old' }))).status, 404)
    assert.equal((await post(fresh, JSON.stringify({ title: 'new' }))).status, 201)
    assert.equal((await member.post(`/api/workspaces/${wsId}/hooks/${hookId}/regenerate`)).status, 403)
    assert.equal((await owner.del(`/api/workspaces/${wsId}/hooks/${hookId}`)).status, 204)
    assert.equal((await post(fresh, JSON.stringify({ title: 'gone' }))).body.error.code, 'hook_not_found')
  })

  test('a deleted workspace takes its tokens and hooks with it', async () => {
    const hook = await owner.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'db-leads' })
    const token = new Bearer(server.url, (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'Gone soon', scope: 'write' })).body.token)
    assert.equal((await token.get('/api/v1/workspace')).status, 200)
    meta.destroy()
    assert.equal((await owner.del(`/api/workspaces/${wsId}`)).status, 204)
    assert.equal((await token.get('/api/v1/workspace')).status, 401)
    assert.equal((await post(hook.body.url.replace('localhost', '127.0.0.1'), JSON.stringify({ title: 'x' }))).status, 404)
  })
})

describe('API limits', () => {
  test('per-token and per-hook rate limits answer 429 with Retry-After', async () => {
    const server = await startServer({ API_RATE_LIMIT: '5' })
    try {
      const owner = await signIn(server, 'limits@api.test')
      const wsId = (await owner.post('/api/workspaces', { name: 'Limits' })).body.id
      const m = openDoc(server, owner, `ws:${wsId}`)
      await m.synced
      addDatabase(m.doc, 'db-x', 'X', [{ id: 'x-title', name: 'Name', type: 'title' }])
      await flushed(m)
      m.destroy()
      const a = new Bearer(server.url, (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'A', scope: 'read' })).body.token)
      const b = new Bearer(server.url, (await owner.post(`/api/workspaces/${wsId}/tokens`, { name: 'B', scope: 'read' })).body.token)
      for (let i = 0; i < 5; i++) assert.equal((await a.get('/api/v1/workspace')).status, 200)
      const limited = await a.get('/api/v1/workspace')
      assert.equal(limited.status, 429)
      assert.equal(limited.body.error.code, 'rate_limited')
      assert.ok(Number(limited.res.headers.get('retry-after')) > 0)
      assert.equal((await b.get('/api/v1/workspace')).status, 200, 'per token')

      const hook = (await owner.post(`/api/workspaces/${wsId}/hooks`, { databaseId: 'db-x' })).body.url.replace('localhost', '127.0.0.1')
      const codes: number[] = []
      for (let i = 0; i < 6; i++) codes.push((await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `n${i}` }) })).status)
      assert.deepEqual(codes, [201, 201, 201, 201, 201, 429])


      // guessing tokens: 401 … then 429 for that address
      const statuses: number[] = []
      for (let i = 0; i < 32; i++) statuses.push((await new Bearer(server.url, `one_${'a'.repeat(42)}${i % 10}`).get('/api/v1/workspace')).status)
      assert.equal(statuses[0], 401)
      assert.equal(statuses.at(-1), 429)

      // body limit: 256 KB like every JSON route (last: the server closes this connection)
      const big = await fetch(hook.replace(/[^/]+$/, 'x'.repeat(43)), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(300 * 1024) }) })
      assert.equal(big.status, 413)
    } finally {
      await server.stop()
    }
  })
})
