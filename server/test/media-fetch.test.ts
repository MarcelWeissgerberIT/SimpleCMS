/**
 * "Fetch through the team server" (POST /api/workspaces/:id/files/fetch, routes/mediaFetch.ts): one https
 * address for a member — the SSRF guard (http/ssrf.ts: private / loopback / link-local addresses refused, also
 * after DNS and on redirects), image / video / audio only with matching bytes (http/sniff.ts), the size cap,
 * the rate limit, private files, and storage like an upload. The "remote host" is a local fixture reached
 * through MEDIA_FETCH_HOSTS (DEV_MODE only) — nothing leaves the machine.
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { guardedLookup, isBlockedAddress, urlProblem } from '../src/http/ssrf.ts'
import { sniff } from '../src/http/sniff.ts'
import { loadConfig, ConfigError } from '../src/config.ts'
import { type Client, signIn, startServer, tempDir, type TestServer } from './helpers.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)])
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(400, 1)])
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const HTML = Buffer.from('<!doctype html><html><body>not a picture</body></html>')

let fixture: Server
let port = 0
let server: TestServer
let owner: Client, member: Client, viewer: Client
let wsId: string
const hits: string[] = []

before(async () => {
  fixture = createServer((req, res) => {
    hits.push(req.url ?? '')
    const send = (status: number, type: string, body: Buffer, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, 'content-length': String(body.length), ...extra })
      res.end(body)
    }
    switch (req.url) {
      case '/cat.png':
        return send(200, 'image/png', PNG)
      case '/clip.mp4':
        return send(200, 'video/mp4', MP4)
      case '/drawing.svg':
        return send(200, 'image/svg+xml', SVG)
      case '/fake.png':
        return send(200, 'image/png', HTML)
      case '/page.html':
        return send(200, 'text/html', HTML)
      case '/big.png':
        return send(200, 'image/png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))
      case '/gone.png':
        return send(404, 'text/plain', Buffer.from('no'))
      case '/to-loopback':
        res.writeHead(302, { location: `https://127.0.0.1:${port}/cat.png` })
        return res.end()
      case '/to-metadata':
        res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' })
        return res.end()
      case '/to-http':
        res.writeHead(302, { location: `http://example.com/cat.png` })
        return res.end()
      case '/to-cat':
        res.writeHead(302, { location: '/cat.png' })
        return res.end()
      default:
        return send(404, 'text/plain', Buffer.from('?'))
    }
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  port = (fixture.address() as AddressInfo).port
  server = await startServer({ MAX_UPLOAD_MB: '1', MEDIA_FETCH_HOSTS: `media.test=127.0.0.1:${port}` })
  owner = await signIn(server, 'media-owner@example.com')
  member = await signIn(server, 'media-member@example.com')
  viewer = await signIn(server, 'media-viewer@example.com')
  wsId = (await owner.post('/api/workspaces', { name: 'Media' })).body.id
  for (const [client, role] of [
    [member, 'member'],
    [viewer, 'viewer'],
  ] as const) {
    const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role })
    await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
  }
})

after(async () => {
  await server?.stop()
  await new Promise<void>((resolve) => fixture?.close(() => resolve()))
})

const fetchMedia = (client: Client, url: string, extra: Record<string, unknown> = {}) => client.post(`/api/workspaces/${wsId}/files/fetch`, { url, ...extra })

describe('the SSRF guard (unit)', () => {
  test('private, loopback, link-local, reserved and mapped addresses are blocked; public ones are not', () => {
    for (const ip of ['127.0.0.1', '127.8.9.10', '10.0.0.5', '172.16.3.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:a00:1::', 'ff02::1', 'not-an-ip'])
      assert.equal(isBlockedAddress(ip), true, ip)
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '[2606:4700::1]'])
      assert.equal(isBlockedAddress(ip), false, ip)
  })

  test('URLs: https only, no credentials, no local names, default ports; test hosts only by exact name', () => {
    assert.equal(urlProblem('https://cdn.example.com/a.png'), '')
    assert.equal(urlProblem('https://cdn.example.com:8443/a.png'), '')
    assert.match(urlProblem('http://cdn.example.com/a.png'), /https/)
    assert.match(urlProblem('ftp://cdn.example.com/a.png'), /https/)
    assert.match(urlProblem('https://user:pw@cdn.example.com/a.png'), /credentials/)
    assert.match(urlProblem('https://cdn.example.com:22/a.png'), /port/)
    for (const u of ['https://localhost/a.png', 'https://app.localhost/a.png', 'https://printer.local/a.png', 'https://db.internal/a.png'])
      assert.match(urlProblem(u), /local/, u)
    for (const u of ['https://127.0.0.1/a.png', 'https://10.1.2.3/a.png', 'https://169.254.169.254/latest', 'https://[::1]/a.png', 'https://[::ffff:127.0.0.1]/a.png'])
      assert.match(urlProblem(u), /private/, u)
    assert.equal(urlProblem('http://media.test/a.png', { 'media.test': '127.0.0.1:1' }), '')
    assert.match(urlProblem('http://other.test/a.png', { 'media.test': '127.0.0.1:1' }), /https/)
  })

  test('a name that resolves to a loopback address is refused at lookup (all addresses checked)', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup('localhost', { all: true }, (e) => resolve(e)))
    assert.equal(err?.code, 'EBLOCKED')
    const err2 = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup('localhost', {}, (e) => resolve(e)))
    assert.equal(err2?.code, 'EBLOCKED')
  })

  test('magic numbers', () => {
    assert.deepEqual(sniff(PNG), { mime: 'image/png', kinds: ['image'] })
    assert.deepEqual(sniff(MP4)?.mime, 'video/mp4')
    assert.equal(sniff(SVG)?.svg, true)
    assert.equal(sniff(HTML), null)
  })

  test('MEDIA_FETCH_HOSTS is a DEV_MODE-only seam', () => {
    assert.throws(() => loadConfig({ MEDIA_FETCH_HOSTS: 'media.test=127.0.0.1:1', DATA_DIR: tempDir() }), ConfigError)
  })
})

describe('POST …/files/fetch', () => {
  test('a member fetches an image: stored sealed like an upload, served back byte for byte', async () => {
    const res = await fetchMedia(member, 'https://media.test/cat.png', { kind: 'image' })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.mime, 'image/png')
    assert.equal(res.body.kind, 'image')
    assert.equal(res.body.size, PNG.length)
    assert.equal(res.body.name, 'cat.png')
    assert.match(res.body.id, /^[A-Za-z0-9_-]{1,64}$/)
    const down = await viewer.fetch(`/api/workspaces/${wsId}/files/${res.body.id}`)
    assert.equal(down.status, 200)
    assert.deepEqual(Buffer.from(await down.arrayBuffer()), PNG)
    assert.equal(down.headers.get('content-type'), 'image/png')
  })

  test('video, a redirect on the same host; SVG kept for download only', async () => {
    const clip = await fetchMedia(member, 'https://media.test/clip.mp4')
    assert.equal(clip.status, 201)
    assert.equal(clip.body.kind, 'video')
    assert.equal(clip.body.mime, 'video/mp4')
    const moved = await fetchMedia(member, 'https://media.test/to-cat')
    assert.equal(moved.status, 201)
    assert.equal(moved.body.mime, 'image/png')
    const svg = await fetchMedia(member, 'https://media.test/drawing.svg')
    assert.equal(svg.status, 201)
    assert.equal(svg.body.kind, 'file')
    assert.equal(svg.body.mime, 'application/octet-stream')
    assert.equal(svg.body.name, 'drawing.svg')
    const down = await owner.fetch(`/api/workspaces/${wsId}/files/${svg.body.id}`)
    assert.match(down.headers.get('content-disposition') ?? '', /^attachment/)
  })

  test('wrong type, bytes that disagree, too large, an error answer: refused, nothing stored', async () => {
    const page = await fetchMedia(member, 'https://media.test/page.html')
    assert.equal(page.status, 415)
    assert.equal(page.body.error.code, 'media_type')
    const fake = await fetchMedia(member, 'https://media.test/fake.png')
    assert.equal(fake.status, 415)
    assert.equal(fake.body.error.code, 'media_mismatch')
    const big = await fetchMedia(member, 'https://media.test/big.png')
    assert.equal(big.status, 413)
    assert.equal(big.body.error.code, 'file_too_large')
    const gone = await fetchMedia(member, 'https://media.test/gone.png')
    assert.equal(gone.status, 502)
    assert.equal(gone.body.error.code, 'fetch_failed')
  })

  test('the guard: loopback, 10.x and 169.254 refused — directly and as a redirect target; plain http too', async () => {
    for (const url of ['https://127.0.0.1/cat.png', `https://127.0.0.1:${port}/cat.png`, 'https://10.0.0.8/cat.png', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/cat.png', 'https://[::1]/cat.png', `http://127.0.0.1:${port}/cat.png`, 'http://example.com/cat.png', 'file:///etc/passwd']) {
      // the owner (members have a rate limit of 20 a minute — refused addresses count too)
      const res = await fetchMedia(owner, url)
      assert.equal(res.status, 400, url)
      assert.equal(res.body.error.code, 'url_blocked', url)
    }
    for (const path of ['/to-loopback', '/to-metadata', '/to-http']) {
      const res = await fetchMedia(owner, `https://media.test${path}`)
      assert.equal(res.status, 400, path)
      assert.equal(res.body.error.code, 'url_blocked', path)
    }
    // the fixture was only ever asked by its test name, never through a refused address
    assert.ok(!hits.some((h) => h.includes('meta-data')))
  })

  test('members only; private files stay with their member; the server log never holds the address', async () => {
    const asViewer = await fetchMedia(viewer, 'https://media.test/cat.png')
    assert.equal(asViewer.status, 403)
    const priv = await fetchMedia(member, 'https://media.test/cat.png', { private: true })
    assert.equal(priv.status, 201)
    assert.equal((await member.fetch(`/api/workspaces/${wsId}/files/${priv.body.id}`)).status, 200)
    assert.equal((await owner.fetch(`/api/workspaces/${wsId}/files/${priv.body.id}`)).status, 404)
    assert.ok(!server.logs().includes('/cat.png'), 'no path of a fetched address in the log')
  })

  test('rate limited per member', async () => {
    const someone = await signIn(server, 'media-burst@example.com')
    const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
    await someone.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)
    let limited = 0
    for (let i = 0; i < 24; i++) {
      const res = await fetchMedia(someone, 'https://media.test/gone.png')
      if (res.status === 429) limited++
    }
    assert.ok(limited >= 4, `429 after 20 a minute (got ${limited})`)
  })
})
