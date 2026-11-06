import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startServer, signIn, Client } from './helpers.ts'
import { deriveVaultKey, vaultSalt, encryptConnections, decryptConnections } from '../../src/shared/personalVault.ts'

test('vault encryption authenticates owner, ciphertext and passphrase; keys are non-extractable', async () => {
  const salt = vaultSalt(), key = await deriveVaultKey('a long test-only passphrase', salt)
  assert.equal(key.extractable, false)
  const rows = [{ id: 'fixture', name: 'atlas-me', url: 'https://atlas.example.test/mcp', token: 'test-only-private-atlas-token', tools: ['atlas_get'] }]
  const envelope = await encryptConnections(key, salt, 'owner-a', rows)
  assert.ok(!JSON.stringify(envelope).includes(rows[0]!.token))
  assert.deepEqual(await decryptConnections(key, envelope, 'owner-a'), rows)
  await assert.rejects(decryptConnections(key, envelope, 'owner-b'))
  await assert.rejects(decryptConnections(await deriveVaultKey('a different passphrase', salt), envelope, 'owner-a'))
  await assert.rejects(decryptConnections(key, { ...envelope, data: (envelope.data[0] === 'A' ? 'B' : 'A') + envelope.data.slice(1) }, 'owner-a'))
  const again = await encryptConnections(key, salt, 'owner-a', rows)
  assert.notEqual(envelope.iv, again.iv)
})

test('personal vault API isolates users, authenticates, rejects plaintext and stale writes', async () => {
  const server = await startServer({ API_RATE_LIMIT: '1000', ADMIN_EMAILS: 'bob@personal-vault.test' })
  try {
    const alice = await signIn(server, 'alice@personal-vault.test'), bob = await signIn(server, 'bob@personal-vault.test')
    assert.equal((await new Client(server.url).get('/api/me/secrets')).status, 401)
    const salt = vaultSalt(), key = await deriveVaultKey('a long test-only passphrase', salt)
    const envelope = await encryptConnections(key, salt, 'alice', [{ id: 'fixture', name: 'atlas-me', url: 'https://atlas.example.test/mcp', token: 'test-only-private-atlas-token', tools: ['atlas_get'] }])
    const save = (client: Client, version: number, data: unknown = envelope) => client.json('PUT', '/api/me/secrets', { version, envelope: data })
    assert.equal((await save(alice, 0)).status, 200)
    assert.deepEqual((await bob.get('/api/me/secrets')).body, { envelope: null, version: 0 })
    assert.deepEqual((await alice.get('/api/me/secrets')).body, { envelope, version: 1 })
    assert.equal((await save(alice, 0)).status, 409)
    assert.equal((await save(bob, 0, { token: 'PLAINTEXT-NEVER-STORED' })).status, 400)
    const forged = await bob.json('PUT', '/api/me/secrets', { version: 0, envelope, userId: (await alice.get('/api/me')).body.user.id })
    assert.equal(forged.status, 400)
    const csrf = await alice.fetch('/api/me/secrets', { method: 'PUT', json: { version: 1, envelope }, headers: { origin: 'https://foreign.example.test' } })
    assert.equal(csrf.status, 403)
    const concurrent = await Promise.all([save(alice, 1), save(alice, 1)])
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409])
    assert.equal((await alice.get('/api/me/secrets')).body.version, 2)
    assert.ok(!(await alice.get('/api/me/secrets')).res.headers.get('cache-control')?.includes('public'))
    const [own] = (await alice.get('/api/me')).body.workspaces
    const dump = JSON.stringify((await alice.get('/api/workspaces/' + own.id)).body)
    assert.ok(!dump.includes('test-only-private-atlas-token'))
  } finally { await server.stop() }
})
