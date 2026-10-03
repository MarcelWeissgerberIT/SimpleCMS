import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Client, signIn, startServer, type TestServer } from './helpers.ts'

let server: TestServer
let owner: Client, viewer: Client, outsider: Client
let wsId: string

before(async () => {
  server = await startServer({ MAX_UPLOAD_MB: '1' })
  owner = await signIn(server, 'files-owner@example.com')
  viewer = await signIn(server, 'files-viewer@example.com')
  outsider = await signIn(server, 'files-outsider@example.com')
  wsId = (await owner.post('/api/workspaces', { name: 'Files' })).body.id
  const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role: 'viewer' })
  await viewer.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
})
after(async () => {
  await server.stop()
})

const put = (client: Client, id: string, data: RequestInit["body"], type: string, name?: string) =>
  client.fetch(`/api/workspaces/${wsId}/files/${id}`, {
    method: 'PUT',
    body: data,
    headers: { 'content-type': type, ...(name ? { 'x-file-name': encodeURIComponent(name) } : {}) },
  })

test('upload and download round-trip with safe headers', async () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
  const up = await put(owner, 'img_0001', bytes, 'image/png', 'Grüße "1".png')
  assert.equal(up.status, 201)
  assert.deepEqual(await up.json(), { id: 'img_0001' })
  assert.ok(existsSync(join(server.dataDir, 'files', wsId, 'img_0001')), 'stored under DATA_DIR/files/<ws>/<id>')

  const down = await viewer.fetch(`/api/workspaces/${wsId}/files/img_0001`)
  assert.equal(down.status, 200)
  const got = new Uint8Array(await down.arrayBuffer())
  assert.deepEqual(got, bytes)
  assert.equal(down.headers.get('content-type'), 'image/png')
  assert.equal(down.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  assert.equal(down.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(down.headers.get('etag'), `"${createHash('sha256').update(bytes).digest('hex')}"`)
  assert.equal(down.headers.get('content-disposition'), `inline; filename="Gr__e _1_.png"; filename*=UTF-8''${encodeURIComponent('Grüße "1".png')}`)

  const cached = await viewer.fetch(`/api/workspaces/${wsId}/files/img_0001`, { headers: { 'if-none-match': down.headers.get('etag')! } })
  assert.equal(cached.status, 304)
  const head = await viewer.fetch(`/api/workspaces/${wsId}/files/img_0001`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), '200000')

  // same id again: idempotent, content unchanged
  const again = await put(owner, 'img_0001', new Uint8Array([1, 2, 3]), 'image/png')
  assert.equal(again.status, 200)
  assert.equal((await (await owner.fetch(`/api/workspaces/${wsId}/files/img_0001`)).arrayBuffer()).byteLength, 200_000)
})

test('non-images and SVG download as attachments', async () => {
  await put(owner, 'doc1', 'hello', 'application/pdf', 'report.pdf')
  await put(owner, 'svg1', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml', 'x.svg')
  await put(owner, 'weird1', 'x', 'text/html; charset=utf-8')
  await put(owner, 'bad1', 'x', 'not a mime')
  for (const [id, type] of [
    ['doc1', 'application/pdf'],
    ['svg1', 'image/svg+xml'],
    ['weird1', 'text/html'],
    ['bad1', 'application/octet-stream'],
  ] as const) {
    const res = await owner.fetch(`/api/workspaces/${wsId}/files/${id}`)
    assert.equal(res.headers.get('content-type'), type)
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/, id)
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/)
  }
})

test('size limit (declared and streamed) and nothing left behind', async () => {
  const big = new Uint8Array(1024 * 1024 + 1)
  const declared = await put(owner, 'big1', big, 'application/octet-stream')
  assert.equal(declared.status, 413)
  assert.equal(((await declared.json()) as any).error.code, 'file_too_large')

  // chunked upload without Content-Length: the limit is enforced while streaming, the client still reads the 413
  const chunked = (chunks: number, size: number) => {
    let n = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (n++ >= chunks) return controller.close()
        controller.enqueue(new Uint8Array(size))
      },
    })
  }
  for (let i = 0; i < 5; i++) {
    const streamed = await put(owner, 'big2', chunked(20, 100_000), 'application/octet-stream')
    assert.equal(streamed.status, 413)
  }
  // an endless stream is cut off (connection closed) — the server keeps working
  await put(owner, 'big3', chunked(400, 100_000), 'application/octet-stream').then(
    (res) => assert.equal(res.status, 413),
    (err: Error) => assert.match(String(err.cause ?? err), /closed|reset|terminated|socket/i),
  )
  assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/big3`)).status, 404)
  assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/big1`)).status, 404)
  assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/big2`)).status, 404)
  assert.deepEqual(
    readdirSync(join(server.dataDir, 'files', wsId)).filter((f) => f.startsWith('.upload-')),
    [],
    'temp files are removed',
  )
})

test('access control', async () => {
  const viewerUp = await put(viewer, 'v1', 'x', 'text/plain')
  assert.equal(viewerUp.status, 403)
  const outsiderUp = await put(outsider, 'o1', 'x', 'text/plain')
  assert.equal(outsiderUp.status, 404)
  assert.equal((await outsider.fetch(`/api/workspaces/${wsId}/files/img_0001`)).status, 404)
  const anon = new Client(server.url)
  assert.equal((await anon.fetch(`/api/workspaces/${wsId}/files/img_0001`)).status, 401)
  assert.equal((await put(anon, 'a1', 'x', 'text/plain')).status, 401)
  assert.equal((await put(owner, 'bad id!', 'x', 'text/plain')).status, 400)
  assert.equal((await put(owner, 'x'.repeat(65), 'x', 'text/plain')).status, 400)
  assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/missing`)).status, 404)
  // a cross-site page cannot upload either
  const evil = await owner.fetch(`/api/workspaces/${wsId}/files/e1`, { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' } })
  assert.equal(evil.status, 403)
})

test('deleting the workspace removes its files', async () => {
  const ws2 = (await owner.post('/api/workspaces', { name: 'Temp' })).body.id
  await owner.fetch(`/api/workspaces/${ws2}/files/f1`, { method: 'PUT', body: 'bye', headers: { 'content-type': 'text/plain' } })
  assert.ok(existsSync(join(server.dataDir, 'files', ws2, 'f1')))
  assert.equal((await owner.del(`/api/workspaces/${ws2}`)).status, 204)
  assert.equal(existsSync(join(server.dataDir, 'files', ws2)), false)
})
