import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { ollamaInference, withModelProfile } from '../src/worker/local-inference.ts'

test('owner profiles are loaded for the selected model, validated and never treated as additional permissions', async () => {
  const requests: any[] = []
  let profile: unknown = 'Prefer German. Follow pm → qa → dev → qa.'
  let status = 200
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ url: req.url, body: JSON.parse(body) })
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ system: profile }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const adapter = ollamaInference(new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}`))
    const signal = new AbortController().signal
    const loaded = await adapter.profile!('owner-model', signal)
    assert.equal(loaded, profile)
    assert.deepEqual(requests[0], { url: '/api/show', body: { model: 'owner-model' } })
    assert.match(withModelProfile('Read-only stage.', loaded), /Read-only stage\.[\s\S]*Prefer German/)
    assert.match(withModelProfile('Read-only stage.', loaded), /does not grant additional access/)
    profile = undefined
    assert.equal(await adapter.profile!('unmodified-base-model', signal), '')
    assert.equal(withModelProfile('Read-only stage.', ''), 'Read-only stage.')
    profile = { unexpected: true }
    await assert.rejects(adapter.profile!('invalid', signal), /invalid/)
    profile = 'x'.repeat(50001)
    await assert.rejects(adapter.profile!('oversized', signal), /50,000/)
    status = 404
    await assert.rejects(adapter.profile!('missing', signal), /installed/)
    assert.ok(requests.every(r => r.url === '/api/show'))
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
