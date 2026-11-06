import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { signIn, startServer, type Client, type TestServer } from './helpers.ts'

let fixture: Server, server: TestServer, owner: Client, outsider: Client, viewer: Client, ws: string
const html = '<!doctype html><title>EARS reference</title><article><h1>EARS</h1><p>When a condition occurs…</p></article>'
const requests: Array<{ path: string; cookie?: string; auth?: string }> = []
before(async () => {
  fixture = createServer((req, res) => {
    requests.push({ path: req.url!, cookie: req.headers.cookie, auth: req.headers.authorization })
    if (req.url === '/redirect') { res.writeHead(302, { location: '/ears' }); return res.end() }
    if (req.url === '/private') { res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data' }); return res.end() }
    if (req.url === '/large') { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('x'.repeat(1024 * 1024)); return res.end('y'.repeat(1024 * 1024 + 1)) }
    if (req.url === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.0') }
    if (req.url === '/login') { res.writeHead(401); return res.end('secret') }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const port = (fixture.address() as AddressInfo).port
  server = await startServer({ MEDIA_FETCH_HOSTS: `source.test=127.0.0.1:${port}` })
  owner = await signIn(server, 'source-owner@example.com'); outsider = await signIn(server, 'source-other@example.com'); viewer = await signIn(server, 'source-viewer@example.com')
  ws = (await owner.post('/api/workspaces', { name: 'Sources' })).body.id
  const invite = await owner.post(`/api/workspaces/${ws}/invites`, { role: 'viewer' })
  await viewer.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
})
after(async () => { await server?.stop(); await new Promise<void>(resolve => fixture?.close(() => resolve())) })
const preview = (path: string, who = owner) => who.post(`/api/workspaces/${ws}/sources/preview`, { url: path.startsWith('https:') ? path : `https://source.test${path}` })

test('original snapshot, final address, time and hash; no forwarded session credentials', async () => {
  const result = await preview('/redirect')
  assert.equal(result.status, 200); assert.equal(result.body.text, html); assert.equal(result.body.url, 'https://source.test/ears')
  assert.equal(result.body.sha256, createHash('sha256').update(html).digest('hex')); assert.ok(Number.isFinite(Date.parse(result.body.fetchedAt)))
  assert.equal(result.body.size, Buffer.byteLength(html))
  for (const request of requests) { assert.equal(request.cookie, undefined); assert.equal(request.auth, undefined) }
})
test('membership is checked before outbound access', async () => {
  const count = requests.length
  assert.equal((await preview('/ears', outsider)).status, 404)
  assert.equal((await preview('/ears', viewer)).status, 403)
  assert.equal(requests.length, count)
})
test('private initial addresses and redirects to cloud metadata are refused', async () => {
  assert.equal((await preview('https://127.0.0.1/secret')).body.error.code, 'url_blocked')
  assert.equal((await preview('/private')).body.error.code, 'url_blocked')
})
test('oversized streams, binary documents and login failures are rejected', async () => {
  assert.equal((await preview('/large')).status, 413)
  assert.equal((await preview('/pdf')).status, 415)
  assert.equal((await preview('/login')).status, 502)
})
test('user-supplied credential headers are not accepted', async () => {
  const result = await owner.post(`/api/workspaces/${ws}/sources/preview`, { url: 'https://source.test/ears', headers: { Authorization: 'do-not-send' } })
  assert.equal(result.status, 400)
})
