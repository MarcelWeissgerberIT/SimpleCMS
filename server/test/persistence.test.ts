import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client, flushed, openDoc, signIn, startServer } from './helpers.ts'

test('Yjs documents and sessions survive a server restart', async () => {
  const first = await startServer()
  const owner = await signIn(first, 'persist@example.com')
  const wsId = (await owner.post('/api/workspaces', { name: 'Durable' })).body.id
  const meta = `ws:${wsId}`
  const page = `ws:${wsId}:p:page1`

  const m = openDoc(first, owner, meta)
  const p = openDoc(first, owner, page)
  await Promise.all([m.synced, p.synced])
  m.doc.getMap('workspace').set('name', 'Durable')
  p.doc.getText('t').insert(0, 'written before the restart')
  await Promise.all([flushed(m), flushed(p)])
  // the socket stays open: SIGTERM must flush the debounced store itself
  assert.equal(await first.stop(), 0, 'clean exit on SIGTERM')
  m.destroy()
  p.destroy()
  assert.ok(existsSync(join(first.dataDir, 'one.sqlite')))

  const second = await startServer({}, first.dataDir)
  try {
    const client = new Client(second.url)
    for (const [k, v] of owner.cookies) client.cookies.set(k, v)
    assert.equal((await client.get('/api/me')).body.user.email, 'persist@example.com', 'the session cookie still works')
    const m2 = openDoc(second, client, meta)
    const p2 = openDoc(second, client, page)
    await Promise.all([m2.synced, p2.synced])
    assert.equal(m2.doc.getMap('workspace').get('name'), 'Durable')
    assert.equal(p2.doc.getText('t').toString(), 'written before the restart')
    m2.destroy()
    p2.destroy()
  } finally {
    await second.stop()
  }
})
