import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { startServer, tempDir, type TestServer } from './helpers.ts'

let server: TestServer

before(async () => {
  const app = tempDir()
  mkdirSync(join(app, 'app'), { recursive: true })
  mkdirSync(join(app, 'assets', 'icons'), { recursive: true })
  writeFileSync(join(app, 'index.html'), '<!doctype html><title>landing</title>')
  writeFileSync(join(app, 'app', 'index.html'), '<!doctype html><title>workspace</title>')
  writeFileSync(join(app, 'assets', 'app-CLADwuBE.js'), 'console.log(1)')
  writeFileSync(join(app, 'assets', 'icons', 'rocket-launch.webp'), 'x')
  writeFileSync(join(app, 'sw.js'), 'self')
  server = await startServer({ APP_DIR: app })
})
after(async () => {
  await server.stop()
})

const get = async (path: string) => {
  const res = await fetch(server.url + path, { redirect: 'manual' })
  return { status: res.status, text: await res.text(), h: (name: string) => res.headers.get(name) }
}

test('landing, app shell and SPA fallback', async () => {
  const landing = await get('/')
  assert.equal(landing.status, 200)
  assert.match(landing.text, /landing/)
  assert.equal(landing.h('cache-control'), 'no-cache')

  const csp = landing.h('content-security-policy') ?? ''
  for (const part of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", 'connect-src', 'https:', '/localhost:']) {
    assert.ok(csp.includes(part), `CSP has ${part}`)
  }
  assert.match(csp, /connect-src 'self' ws:\/\/localhost:\d+ https:/)
  assert.equal(landing.h('x-frame-options'), 'DENY')
  assert.equal(landing.h('x-content-type-options'), 'nosniff')

  assert.equal((await get('/app')).status, 301)
  for (const path of ['/app/', '/app/some/deep/link']) {
    const res = await get(path)
    assert.equal(res.status, 200, path)
    assert.match(res.text, /workspace/)
    assert.equal(res.h('cache-control'), 'no-cache')
  }
  assert.equal((await get('/app/missing.js')).status, 404)
  assert.equal((await get('/nothing')).status, 404)
})

test('caching: hashed assets immutable, the rest revalidated', async () => {
  assert.equal((await get('/assets/app-CLADwuBE.js')).h('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal((await get('/assets/icons/rocket-launch.webp')).h('cache-control'), 'public, max-age=3600')
  assert.equal((await get('/sw.js')).h('cache-control'), 'no-cache')
  assert.equal((await get('/../package.json')).status, 404)
  assert.equal((await get('/%2e%2e/package.json')).status, 404)
})
