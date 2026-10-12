/**
 * The workspace's AI rules (docs/CLOUD.md § Meta document schema → workspace.ai), against a real server: owners and
 * admins change them (the server stamps updatedBy with the real writer); a member writing the meta document's
 * `workspace` map directly (raw Yjs, no app) cannot set, change or remove them — the server puts the value back.
 * /api/config says the server guards them (`supports` lists 'ai'). The shared contracts compile and run here too.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sanitizeWorkspaceAI } from '../../src/shared/ai/policy.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, sleep, startServer, type TestServer, waitFor } from './helpers.ts'

type Rules = Record<string, unknown>

const rules = (model: string, by: string | null = null): Rules => ({
  gen: 1,
  routes: { '*': [{ p: 'anthropic', m: model }] },
  policy: { providers: { openrouter: { allow: ['public', 'structure'] } }, restricted: [] },
  updatedAt: Date.now(),
  updatedBy: by,
})

describe('workspace AI rules: owners and admins only, enforced by the server', () => {
  let server: TestServer
  let ada: Client, bob: Client, cyd: Client
  let adaId: string, bobId: string, cydId: string
  let wsId: string
  let A: DocClient, B: DocClient, C: DocClient
  const open: DocClient[] = []

  const meta = async (client: Client) => {
    const d = openDoc(server, client, `ws:${wsId}`)
    open.push(d)
    await d.synced
    return d
  }
  const aiIn = (d: DocClient) => d.doc.getMap('workspace').get('ai') as Rules | undefined
  const model = (d: DocClient) => ((aiIn(d)?.routes as Record<string, Array<{ m: string }>> | undefined)?.['*']?.[0]?.m ?? null)
  const write = async (d: DocClient, value: Rules | null) => {
    const m = d.doc.getMap('workspace')
    if (value === null) m.delete('ai')
    else m.set('ai', value)
    await flushed(d)
  }
  const stored = async () => {
    const d = await meta(ada)
    const v = aiIn(d)
    d.destroy()
    return v
  }

  before(async () => {
    server = await startServer()
    ada = await signIn(server, 'ada@ai-rules.test')
    bob = await signIn(server, 'bob@ai-rules.test')
    cyd = await signIn(server, 'cyd@ai-rules.test')
    adaId = (await ada.get('/api/me')).body.user.id
    bobId = (await bob.get('/api/me')).body.user.id
    cydId = (await cyd.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Nordlicht AI' })).body.id
    for (const client of [bob, cyd]) {
      const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
      assert.equal((await client.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    }
    assert.equal((await ada.patch(`/api/workspaces/${wsId}/members/${cydId}`, { role: 'admin' })).status, 200)
    ;[A, B, C] = await Promise.all([meta(ada), meta(bob), meta(cyd)])
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('/api/config: the server guards workspace.ai', async () => {
    const res = await ada.get('/api/config')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.supports) && res.body.supports.includes('ai'), JSON.stringify(res.body))
  })

  test('a member cannot set the rules: the key is taken away again', async () => {
    await write(B, rules('claude-haiku-4-5', bobId))
    await waitFor(() => aiIn(B) === undefined, 5000, 'put back on the writer')
    await sleep(400)
    assert.equal(aiIn(A), undefined)
    assert.equal(await stored(), undefined)
    assert.match(server.logs(), /workspace AI rules change put back/)
  })

  test('the owner sets them; the server stamps the real writer; the shared sanitizer keeps them', async () => {
    await write(A, rules('claude-sonnet-5-5', bobId))
    await waitFor(() => aiIn(B)?.updatedBy === adaId, 5000, 'stamped for everyone')
    const s = await stored()
    assert.deepEqual([model(A), s?.updatedBy], ['claude-sonnet-5-5', adaId])
    assert.deepEqual(sanitizeWorkspaceAI(s), { ...s })
  })

  test('a member can neither change nor remove the owner’s rules; an admin can', async () => {
    await write(B, rules('claude-haiku-4-5', bobId))
    await waitFor(() => model(B) === 'claude-sonnet-5-5', 5000, 'the owner’s rules come back')
    await write(B, null)
    await waitFor(() => model(B) === 'claude-sonnet-5-5', 5000, 'a removal is undone')
    assert.equal(model(await meta(ada)), 'claude-sonnet-5-5')

    await write(C, rules('claude-opus-5-5', null))
    await waitFor(() => aiIn(A)?.updatedBy === cydId && model(A) === 'claude-opus-5-5', 5000, 'the admin’s rules reach the owner')
    await write(C, null)
    await waitFor(() => aiIn(A) === undefined && aiIn(B) === undefined, 5000, 'an admin may remove them')
  })

  test('the look and the name stay as they were guarded (the AI guard watches its own key only)', async () => {
    B.doc.getMap('workspace').set('name', 'Nordlicht AI (renamed)')
    await flushed(B)
    await waitFor(() => A.doc.getMap('workspace').get('name') === 'Nordlicht AI (renamed)', 5000, 'name reaches the owner')
  })
})
