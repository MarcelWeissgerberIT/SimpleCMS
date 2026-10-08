/**
 * The coding relay for cloud workers (docs/CLOUD.md § Coding relay): REST for worker tokens, the upgrade gates of
 * /coding/worker and /coding/tab, pairing per (workspace, member), opaque forwarding of end-to-end boxes (a real
 * encrypted exchange through the server with the tab's WebCrypto box and the worker's node:crypto box), the
 * newest-wins rules without close races, budgets, and every revocation hook. The built server, Node's own
 * WebSocket client (headers allowed), no real host.
 */
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { join as joinPath } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { BoxSession as WorkerBox, newNonce as workerNonce, sessionKey as workerKey } from '../../mcp/src/worker/box.ts'
import { BoxSession as TabBox, newNonce as tabNonce, sessionKey as tabKey } from '../../src/app/features/coding/relayBox.ts'
import { openDb } from '../src/db/index.ts'
import { Repo } from '../src/repo.ts'
import { type Client, signIn, startServer, tempDir, type TestServer, waitFor } from './helpers.ts'

const PROTOCOL = 'one-worker.v1'
const PAIR = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

/** A WebSocket that records its frames and its close. */
class Sock {
  ws: WebSocket
  frames: any[] = []
  closed: { code: number; reason: string } | null = null
  opened: Promise<void>

  constructor(url: string, headers: Record<string, string>, protocols: string[] = [PROTOCOL]) {
    this.ws = new WebSocket(url, { protocols, headers } as unknown as string[])
    this.ws.onmessage = (e) => this.frames.push(JSON.parse(String(e.data)))
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('socket error'))
    })
    // a refused upgrade shows as a close; a test awaits `opened` only when it needs it
    this.opened.catch(() => {})
    this.ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason }
    }
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg))
  }

  async next(match: (f: any) => boolean, label = 'frame', ms = 5000): Promise<any> {
    await waitFor(() => this.frames.some(match), ms, label)
    return this.frames.find(match)
  }

  count(match: (f: any) => boolean) {
    return this.frames.filter(match).length
  }

  async closedWith(ms = 5000): Promise<{ code: number; reason: string }> {
    await waitFor(() => this.closed !== null, ms, 'close')
    return this.closed!
  }

  close() {
    if (this.ws.readyState <= 1) this.ws.close()
  }
}

const relay = (f: any, op: string) => f.type === 'relay' && f.op === op
const wsUrl = (server: TestServer, path: string) => `${server.url.replace(/^http/, 'ws')}${path}`

function worker(server: TestServer, token: string, wsId: string, extra: Record<string, string> = {}) {
  return new Sock(wsUrl(server, '/coding/worker'), { authorization: `Bearer ${token}`, 'x-one-workspace': `team:${wsId}`, ...extra })
}
function tab(server: TestServer, client: Client, wsId: string, extra: Record<string, string> = {}) {
  return new Sock(wsUrl(server, `/coding/tab?workspace=${wsId}`), { cookie: client.cookieHeader(), origin: server.url, ...extra })
}

/** A raw upgrade: the HTTP status (101 = accepted) and the body of a refusal. */
function upgrade(server: TestServer, path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${server.url}${path}`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
    })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve({ status: res.statusCode ?? 0, text: '' })
    })
    req.on('response', (res) => {
      let text = ''
      res.on('data', (d: Buffer) => (text += d.toString()))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function join(owner: Client, guest: Client, wsId: string, role: string) {
  const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
  const token = invite.body.link.split('#/invite/')[1]
  assert.equal((await guest.post(`/api/invites/${token}/accept`)).status, 200)
}

const userId = async (c: Client) => (await c.get('/api/me')).body.user.id as string

/** A worker and a tab that went through the key exchange: both sides hold the pairing's box. */
async function handshake(w: Sock, t: Sock) {
  const online = await t.next((f) => relay(f, 'worker') && f.online, 'online')
  const open = await w.next((f) => relay(f, 'tab-open'), 'tab-open')
  assert.equal(open.s, online.s)
  const tn = tabNonce()
  const wn = workerNonce()
  t.send({ type: 'key', s: online.s, n: tn })
  w.send({ type: 'key', s: open.s, n: wn })
  await w.next((f) => f.type === 'key' && f.n === tn, 'tab nonce at the worker')
  await t.next((f) => f.type === 'key' && f.n === wn, 'worker nonce at the tab')
  return { s: open.s as number, wBox: new WorkerBox(workerKey(PAIR, tn, wn), open.s), tBox: new TabBox(await tabKey(PAIR, tn, wn), open.s, 'tab') }
}

describe('coding relay', () => {
  let server: TestServer
  let ada: Client, bob: Client, cleo: Client, dan: Client
  let wsId: string
  let adaToken: string, adaWorker: string
  const MARKER = 'relay-plaintext-marker-5d1e'

  before(async () => {
    server = await startServer({ CODING_PING_MS: '400' })
    ada = await signIn(server, 'ada@relay.test')
    bob = await signIn(server, 'bob@relay.test')
    cleo = await signIn(server, 'cleo@relay.test')
    dan = await signIn(server, 'dan@relay.test')
    wsId = (await ada.post('/api/workspaces', { name: 'Relay team' })).body.id
    await join(ada, bob, wsId, 'member')
    await join(ada, cleo, wsId, 'viewer')
  })
  after(async () => {
    await server.stop()
  })

  test('REST: a member creates a pending token; a second download replaces only the pending one; viewers and outsiders cannot', async () => {
    const first = await ada.post(`/api/workspaces/${wsId}/coding/workers`, { label: 'build box' })
    assert.equal(first.status, 201)
    assert.match(first.body.token, /^onew_[A-Za-z0-9_-]{43}$/)
    assert.equal(first.body.state, 'pending')
    assert.equal(first.body.label, 'build box')
    const second = await ada.post(`/api/workspaces/${wsId}/coding/workers`, {})
    assert.equal(second.status, 201)
    const list = (await ada.get(`/api/workspaces/${wsId}/coding/workers`)).body
    assert.deepEqual(list.map((w: { id: string }) => w.id), [second.body.id], 'the first (never started) download was replaced')
    assert.ok(!JSON.stringify(list).includes(second.body.token) && !JSON.stringify(list).includes('token_hash'), 'the list never shows a secret')
    assert.equal((await upgrade(server, '/coding/worker', { authorization: `Bearer ${first.body.token}`, 'x-one-workspace': `team:${wsId}`, 'sec-websocket-protocol': PROTOCOL })).status, 401)
    adaToken = second.body.token
    adaWorker = second.body.id

    const viewer = await cleo.post(`/api/workspaces/${wsId}/coding/workers`, {})
    assert.equal(viewer.status, 403)
    const outsider = await dan.post(`/api/workspaces/${wsId}/coding/workers`, {})
    assert.equal(outsider.status, 404)
    assert.equal(outsider.body.error.code, 'workspace_not_found')
    // a member never sees, nor revokes, someone else's token
    assert.deepEqual((await bob.get(`/api/workspaces/${wsId}/coding/workers`)).body, [])
    const foreign = await bob.del(`/api/workspaces/${wsId}/coding/workers/${adaWorker}`)
    assert.equal(foreign.status, 404)
    assert.equal(foreign.body.error.code, 'worker_not_found')

    // the worker token checks itself; it is no API token and no cookie
    const check = await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer ${adaToken}` } })
    assert.equal(check.status, 200)
    assert.deepEqual(await check.json(), { workspace: { id: `team:${wsId}`, name: 'Relay team' }, member: { email: 'ada@relay.test', name: null }, state: 'pending', online: false })
    assert.equal((await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer onew_${'x'.repeat(43)}` } })).status, 401)
    assert.equal((await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer ${adaToken}`, origin: server.url } })).status, 403)
    assert.equal((await fetch(`${server.url}/api/v1/workspace`, { headers: { authorization: `Bearer ${adaToken}` } })).status, 401, 'not an API token')
    const mcp = await fetch(`${server.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${adaToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    assert.equal(mcp.status, 401, 'not an MCP token either')
  })

  test('upgrade gates: token, origin, subprotocol, workspace, role — and the tab door', async () => {
    const good = { authorization: `Bearer ${adaToken}`, 'x-one-workspace': `team:${wsId}`, 'sec-websocket-protocol': PROTOCOL }
    assert.equal((await upgrade(server, '/coding/worker', { 'sec-websocket-protocol': PROTOCOL, 'x-one-workspace': `team:${wsId}` })).status, 401)
    assert.equal((await upgrade(server, '/coding/worker', { ...good, authorization: `Bearer onew_${'A'.repeat(43)}` })).status, 401)
    assert.equal((await upgrade(server, '/coding/worker', { ...good, origin: server.url })).status, 403)
    assert.equal((await upgrade(server, '/coding/worker', { ...good, 'sec-websocket-protocol': 'other' })).status, 400)
    const wrongWs = await upgrade(server, '/coding/worker', { ...good, 'x-one-workspace': 'team:someotherws' })
    assert.deepEqual(wrongWs, { status: 403, text: 'Forbidden: workspace' })
    assert.equal((await upgrade(server, '/coding/elsewhere', good)).status, 404)

    const cookie = ada.cookieHeader()
    const tabHeaders = { cookie, origin: server.url, 'sec-websocket-protocol': PROTOCOL }
    assert.equal((await upgrade(server, `/coding/tab?workspace=${wsId}`, { origin: server.url, 'sec-websocket-protocol': PROTOCOL })).status, 401)
    assert.equal((await upgrade(server, `/coding/tab?workspace=${wsId}`, { ...tabHeaders, origin: 'https://evil.example' })).status, 403)
    assert.equal((await upgrade(server, `/coding/tab?workspace=${wsId}`, { cookie, 'sec-websocket-protocol': PROTOCOL })).status, 403, 'no Origin: no browser')
    assert.equal((await upgrade(server, '/coding/tab?workspace=../x', tabHeaders)).status, 400)
    assert.equal((await upgrade(server, `/coding/tab?workspace=${wsId}`, { ...tabHeaders, 'sec-websocket-protocol': 'other' })).status, 400)

    // signed in but not allowed: accepted, then closed with the reason (a non-member and a missing workspace look the same)
    for (const [client, reason] of [[dan, 'forbidden'], [cleo, 'viewer']] as const) {
      const t = tab(server, client, wsId)
      assert.deepEqual(await t.closedWith(), { code: 4403, reason })
    }
    const missing = tab(server, ada, 'NoSuchWorkspace1')
    assert.deepEqual(await missing.closedWith(), { code: 4403, reason: 'forbidden' })
  })

  test('pairing and end-to-end boxes: the server forwards what it cannot read; plain protocol frames are refused', async () => {
    const w = worker(server, adaToken, wsId)
    await w.opened
    const ready = await w.next((f) => relay(f, 'ready'))
    assert.deepEqual(ready.workspace, { id: `team:${wsId}`, name: 'Relay team' })
    // the first connection activated the download
    await waitFor(async () => (await ada.get(`/api/workspaces/${wsId}/coding/workers`)).body[0]?.state === 'active', 3000, 'active')
    const t = tab(server, ada, wsId)
    await t.opened
    const online = await t.next((f) => relay(f, 'worker'))
    assert.deepEqual({ ...online, s: 0 }, { type: 'relay', op: 'worker', online: true, registered: true, token: adaWorker, s: 0 })
    const { s, wBox, tBox } = await handshake(w, t)

    // tab → worker: a hello with a marker, sealed; the worker opens it
    t.send(await tBox.seal(JSON.stringify({ type: 'hello', app: 'one', version: 'test', workspace: { id: `team:${wsId}`, name: MARKER, kind: 'team', readOnly: false } })))
    const atWorker = await w.next((f) => f.type === 'box')
    assert.deepEqual(Object.keys(atWorker).sort(), ['data', 'iv', 's', 'seq', 'type'])
    assert.equal(JSON.parse(wBox.open(atWorker)).workspace.name, MARKER)
    // worker → tab, an event the relay may drop (the mark does not reach the tab)
    w.send(wBox.seal(JSON.stringify({ type: 'welcome', name: MARKER }), true))
    const atTab = await t.next((f) => f.type === 'box')
    assert.equal(atTab.k, undefined)
    assert.equal(JSON.parse(await tBox.open(atTab)).name, MARKER)
    // an older pairing's frames are dropped, not forwarded
    w.send({ ...wBox.seal('{"stale":true}'), s: s + 100 })
    t.send({ type: 'key', s: s + 100, n: tabNonce() })
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(t.count((f) => f.type === 'box'), 1)
    assert.equal(w.count((f) => f.type === 'key'), 1)
    // the server never wrote the content anywhere
    assert.ok(!server.logs().includes(MARKER), 'no protocol content in the logs')
    assert.ok(!server.logs().includes(adaToken), 'no token in the logs')

    // a plain protocol frame (a forged tab's "req", an injected welcome) closes the sender
    const t2 = tab(server, ada, wsId)
    await t2.next((f) => relay(f, 'worker'))
    t2.send({ type: 'req', id: 't1', op: 'git', taskId: 'x', verb: 'push', repo: 'r', branch: 'b', title: 'x' })
    assert.equal((await t2.closedWith()).code, 1008)
    assert.equal(w.count((f) => f.type === 'req'), 0)
    w.close()
    t.close()
  })

  test('newest wins without races: a second tab, a second connection of the same token', async () => {
    const w = worker(server, adaToken, wsId)
    await w.next((f) => relay(f, 'ready'))
    const t1 = tab(server, ada, wsId)
    await t1.next((f) => relay(f, 'worker') && f.online)
    await w.next((f) => relay(f, 'tab-open'))
    const opensBefore = w.count((f) => relay(f, 'tab-open'))
    const t2 = tab(server, ada, wsId)
    await t2.next((f) => relay(f, 'worker') && f.online)
    assert.deepEqual(await t1.closedWith(), { code: 4001, reason: 'replaced' })
    await new Promise((r) => setTimeout(r, 300))
    // exactly one tab-gone (replaced) and one more tab-open — the old tab's close changed nothing
    assert.equal(w.count((f) => relay(f, 'tab-gone')), 1)
    assert.equal(w.frames.find((f) => relay(f, 'tab-gone')).reason, 'replaced')
    assert.equal(w.count((f) => relay(f, 'tab-open')), opensBefore + 1)
    assert.equal(t2.closed, null)

    // the same token connects again: the old socket goes, the tab never sees the worker offline
    const w2 = worker(server, adaToken, wsId)
    await w2.next((f) => relay(f, 'tab-open'))
    assert.deepEqual(await w.closedWith(), { code: 4001, reason: 'replaced' })
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(t2.count((f) => relay(f, 'worker') && !f.online), 0, 'no online:false')
    assert.equal(t2.frames.filter((f) => relay(f, 'worker')).at(-1).online, true)

    // close-tab: a stale pairing is ignored, the current one closes the tab with the worker's code
    const s = w2.frames.filter((f) => relay(f, 'tab-open')).at(-1).s
    w2.send({ type: 'relay', op: 'close-tab', s: s - 1, code: 4003, reason: 'pair' })
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(t2.closed, null)
    w2.send({ type: 'relay', op: 'close-tab', s, code: 4003, reason: 'pair' })
    assert.deepEqual(await t2.closedWith(), { code: 4003, reason: 'pair' })
    await w2.next((f) => relay(f, 'tab-gone') && f.s === s)
    w2.close()
  })

  test('another member of the workspace sees nothing of it; binary and oversized frames close the sender', async () => {
    const w = worker(server, adaToken, wsId)
    await w.next((f) => relay(f, 'ready'))
    const b = tab(server, bob, wsId)
    const view = await b.next((f) => relay(f, 'worker'))
    assert.equal(view.online, false)
    assert.equal(view.registered, false)
    assert.equal(view.token, null)
    const t = tab(server, ada, wsId)
    const { wBox } = await handshake(w, t)
    w.send(wBox.seal('{"type":"nudge"}'))
    await t.next((f) => f.type === 'box')
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(b.count((f) => f.type !== 'relay'), 0, 'bob receives none of ada\'s frames')
    assert.equal(w.count((f) => relay(f, 'tab-open')), 1, 'bob\'s tab never paired with ada\'s worker')

    t.ws.send(new Uint8Array([1, 2, 3]))
    assert.equal((await t.closedWith()).code, 1003)
    const t3 = tab(server, ada, wsId)
    await t3.next((f) => relay(f, 'worker'))
    t3.ws.send('x'.repeat(8 * 1024 * 1024 + 65 * 1024))
    assert.equal((await t3.closedWith(10_000)).code, 1009)
    b.close()
    w.close()
  })

  test('load: past the budget the worker\'s events are dropped and the tab is told — the worker stays', async () => {
    const w = worker(server, adaToken, wsId)
    await w.next((f) => relay(f, 'ready'))
    const t = tab(server, ada, wsId)
    const { wBox } = await handshake(w, t)
    for (let i = 0; i < 2600; i++) w.send(wBox.seal(JSON.stringify({ type: 'event', i }), true))
    w.send(wBox.seal('{"type":"status","last":true}'))
    const notice = await t.next((f) => relay(f, 'dropped'), 'dropped notice', 8000)
    assert.ok(notice.n > 0)
    const boxes = t.count((f) => f.type === 'box')
    assert.ok(boxes >= 1990 && boxes < 2600, `forwarded ${boxes}`)
    assert.equal(w.closed, null, 'the healthy worker is not closed')
    assert.equal(t.closed, null)
    w.close()
    t.close()
  })

  test('a new download stays pending until it connects; then the older worker is replaced', async () => {
    const old = worker(server, adaToken, wsId)
    await old.next((f) => relay(f, 'ready'))
    const fresh = (await ada.post(`/api/workspaces/${wsId}/coding/workers`, {})).body
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(old.closed, null, 'the working worker keeps working')
    const states = (await ada.get(`/api/workspaces/${wsId}/coding/workers`)).body.map((x: { id: string; state: string; online: boolean }) => [x.id, x.state, x.online])
    assert.deepEqual(states, [[fresh.id, 'pending', false], [adaWorker, 'active', true]])
    const next = worker(server, fresh.token, wsId)
    await next.next((f) => relay(f, 'ready'))
    assert.deepEqual(await old.closedWith(), { code: 4401, reason: 'replaced' })
    assert.deepEqual((await ada.get(`/api/workspaces/${wsId}/coding/workers`)).body.map((x: { id: string; state: string }) => [x.id, x.state]), [[fresh.id, 'active']])
    assert.equal((await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer ${adaToken}` } })).status, 401)
    adaToken = fresh.token
    adaWorker = fresh.id
    next.close()
  })

  test('revocation: the token, a demotion to viewer, logout, leaving, deleting the workspace', async () => {
    // revoked token (by an admin — ada owns the workspace — here: bob's own)
    const bobs = (await bob.post(`/api/workspaces/${wsId}/coding/workers`, {})).body
    const bw = worker(server, bobs.token, wsId)
    await bw.next((f) => relay(f, 'ready'))
    assert.equal((await ada.del(`/api/workspaces/${wsId}/coding/workers/${bobs.id}`)).status, 204)
    assert.deepEqual(await bw.closedWith(), { code: 4401, reason: 'revoked' })

    // demotion: both sides go; a viewer's token is refused at the door
    const again = (await bob.post(`/api/workspaces/${wsId}/coding/workers`, {})).body
    const bw2 = worker(server, again.token, wsId)
    await bw2.next((f) => relay(f, 'ready'))
    const bt = tab(server, bob, wsId)
    await bt.next((f) => relay(f, 'worker') && f.online)
    const bobId = await userId(bob)
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${bobId}`, { role: 'viewer' })).status, 200)
    assert.deepEqual(await bw2.closedWith(), { code: 4403, reason: 'role-changed' })
    assert.deepEqual(await bt.closedWith(), { code: 4403, reason: 'role-changed' })
    assert.deepEqual(await upgrade(server, '/coding/worker', { authorization: `Bearer ${again.token}`, 'x-one-workspace': `team:${wsId}`, 'sec-websocket-protocol': PROTOCOL }), { status: 403, text: 'Forbidden: viewer' })
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${bobId}`, { role: 'member' })).status, 200)

    // logout: the tab of that session goes, the worker stays
    const w = worker(server, adaToken, wsId)
    await w.next((f) => relay(f, 'ready'))
    const second = await signIn(server, 'ada@relay.test')
    const t = tab(server, second, wsId)
    await t.next((f) => relay(f, 'worker') && f.online)
    assert.equal((await second.post('/api/auth/logout')).status, 204)
    assert.deepEqual(await t.closedWith(), { code: 4401, reason: 'session-ended' })
    await w.next((f) => relay(f, 'tab-gone') && f.reason === 'ended')
    assert.equal(w.closed, null)

    // leaving: bob's sockets close, his tokens are revoked
    const bw3 = worker(server, again.token, wsId)
    await bw3.next((f) => relay(f, 'ready'))
    assert.equal((await bob.del(`/api/workspaces/${wsId}/members/${bobId}`)).status, 204)
    assert.deepEqual(await bw3.closedWith(), { code: 4403, reason: 'membership-revoked' })
    assert.equal((await fetch(`${server.url}/api/coding/worker`, { headers: { authorization: `Bearer ${again.token}` } })).status, 401)

    // the workspace is deleted: everything closes
    const t2 = tab(server, ada, wsId)
    await t2.next((f) => relay(f, 'worker') && f.online)
    assert.equal((await ada.del(`/api/workspaces/${wsId}`)).status, 204)
    assert.deepEqual(await w.closedWith(), { code: 4403, reason: 'workspace-deleted' })
    assert.deepEqual(await t2.closedWith(), { code: 4403, reason: 'workspace-deleted' })
    assert.ok(!server.logs().includes(adaToken) && !server.logs().includes(again.token), 'no token in the logs')
  })
})

test('a tab that stops saying "alive" is let go; the worker hears "idle"', async () => {
  const server = await startServer({ CODING_PING_MS: '150' })
  try {
    const ada = await signIn(server, 'ada@idle.test')
    const wsId = (await ada.post('/api/workspaces', { name: 'Idle' })).body.id
    const token = (await ada.post(`/api/workspaces/${wsId}/coding/workers`, {})).body.token
    const w = worker(server, token, wsId)
    await w.next((f) => relay(f, 'ready'))
    const alive = tab(server, ada, wsId)
    await alive.next((f) => relay(f, 'worker') && f.online)
    const keep = setInterval(() => alive.send({ type: 'relay', op: 'alive' }), 200)
    await new Promise((r) => setTimeout(r, 1600))
    assert.equal(alive.closed, null, 'a tab that says alive stays')
    clearInterval(keep)
    assert.deepEqual(await alive.closedWith(5000), { code: 4408, reason: 'idle' })
    await w.next((f) => relay(f, 'tab-gone') && f.reason === 'idle')
    w.close()
  } finally {
    await server.stop()
  }
})

test('CODING_RELAY=off: no relay, no worker tokens', async () => {
  const server = await startServer({ CODING_RELAY: 'off' })
  try {
    const ada = await signIn(server, 'ada@off.test')
    const wsId = (await ada.post('/api/workspaces', { name: 'Off' })).body.id
    const res = await ada.post(`/api/workspaces/${wsId}/coding/workers`, {})
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'coding_relay_off')
    assert.equal((await ada.get('/api/config')).body.coding_relay, false)
    assert.equal((await upgrade(server, `/coding/tab?workspace=${wsId}`, { cookie: ada.cookieHeader(), origin: server.url, 'sec-websocket-protocol': PROTOCOL })).status, 404)
  } finally {
    await server.stop()
  }
})

test('repo: pending tokens lapse after a day, revoked ones are kept 90 days, one active and one pending per member', () => {
  const db = openDb(joinPath(tempDir(), 'one.sqlite'))
  try {
    const repo = new Repo(db, Buffer.alloc(32))
    const now = Date.now()
    db.run('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', 'u1', 'u1@x.test', now)
    db.run('INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)', 'w1', 'W', 'u1', now)
    db.run("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES ('w1', 'u1', 'owner', ?)", now)
    const a = repo.createCodingWorker({ workspaceId: 'w1', userId: 'u1', label: '', userAgent: 'Mozilla/5.0\u0000x' })
    assert.equal(a.row.created_ua, 'Mozilla/5.0 x')
    assert.ok(repo.codingWorkerBySecret(a.token))
    assert.deepEqual(repo.activateCodingWorker(a.row.id), { activated: true, replaced: [] })
    const b = repo.createCodingWorker({ workspaceId: 'w1', userId: 'u1', label: '', userAgent: null })
    assert.deepEqual(b.replaced, [], 'the active token stays while the new one is pending')
    // the database itself refuses a second active or a second pending token
    assert.throws(() => db.run("INSERT INTO coding_workers (id, workspace_id, user_id, token_hash, created_at, activated_at) VALUES ('x1', 'w1', 'u1', 'h1', ?, ?)", now, now))
    assert.throws(() => db.run("INSERT INTO coding_workers (id, workspace_id, user_id, token_hash, created_at) VALUES ('x2', 'w1', 'u1', 'h2', ?)", now))
    // a pending token older than a day is not accepted and is purged
    db.run('UPDATE coding_workers SET created_at = ? WHERE id = ?', now - 25 * 3_600_000, b.row.id)
    assert.equal(repo.codingWorkerBySecret(b.token), undefined)
    const purgedPending = repo.purgeExpired(now)
    assert.equal(purgedPending.codingWorkers, 1, 'the lapsed download')
    assert.equal(db.get('SELECT id FROM coding_workers WHERE id = ?', b.row.id), undefined)
    // revoked: kept for 90 days, then purged; a newer download replaces a pending one at once
    const c = repo.createCodingWorker({ workspaceId: 'w1', userId: 'u1', label: '', userAgent: null })
    const d = repo.createCodingWorker({ workspaceId: 'w1', userId: 'u1', label: '', userAgent: null })
    assert.deepEqual(d.replaced, [c.row.id])
    db.run('UPDATE coding_workers SET revoked_at = ? WHERE id = ?', now - 91 * 86_400_000, a.row.id)
    const purged = repo.purgeExpired(now)
    assert.equal(purged.codingWorkers, 1)
    assert.deepEqual(db.all<{ id: string }>('SELECT id FROM coding_workers ORDER BY created_at').map((r) => r.id).sort(), [c.row.id, d.row.id].sort())
    // leaving the workspace revokes the rest
    repo.removeMember('w1', 'u1')
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM coding_workers WHERE revoked_at IS NULL')?.n, 0)
  } finally {
    db.close()
  }
})
