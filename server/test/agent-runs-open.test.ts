/**
 * GET /api/workspaces/:id/agent-runs/open?agentIds=… — the lean read the app's Preflight proposals lamp polls (only
 * while a tab is visible): the runs of the listed agents whose proposals wait (status staged), newest first, without
 * summary / steps, plus each listed agent's newest run head (plain columns). Viewers may read it like agent-runs.
 * Runs come from the real runner against the fake Messages API (fake-anthropic.ts — never the real one). Every name is
 * fictional.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as Y from 'yjs'
import { type FakeAnthropic, fakeAnthropic, say, tools } from './fake-anthropic.ts'
import { type Client, type DocClient, flushed, openDoc, signIn, startServer, type TestServer, waitFor } from './helpers.ts'

const KEY = 'sk-ant-api03-TESTKEY-not-real-0123456789abcdefWXYZ'

function pageEntry(fields: Record<string, unknown>): Y.Map<unknown> {
  const yp = new Y.Map<unknown>()
  const at = Date.now()
  const all = { kind: 'page', title: '', icon: null, cover: null, parentId: null, databaseId: null, order: 1, trashed: false, trashedAt: null, createdAt: at, updatedAt: at, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false }, plain: '', createdBy: 'seed', updatedBy: 'seed', ...fields }
  for (const [k, v] of Object.entries(all)) yp.set(k, v)
  yp.set('properties', new Y.Map<unknown>())
  yp.set('comments', new Y.Map<unknown>())
  return yp
}

function agentDef(id: string, name: string, extra: Record<string, unknown>) {
  const at = Date.now()
  return { id, name, instructions: `Instructions of ${name}.`, trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'server', model: null, effort: null, maxRunUsd: 1, enabled: true, createdBy: null, createdAt: at, updatedAt: at, ...extra }
}

describe('agent-runs/open (the Preflight proposals lamp)', () => {
  let fake: FakeAnthropic
  let server: TestServer
  let owner: Client, viewer: Client, outsider: Client
  let wsId: string
  const open: DocClient[] = []

  const all = async (agentId: string) => (await owner.get(`/api/workspaces/${wsId}/agent-runs?agentId=${agentId}&limit=200`)).body as any[]
  const openRuns = (client: Client, ids: string) => client.get(`/api/workspaces/${wsId}/agent-runs/open?agentIds=${ids}`)

  /** Start a run of the agent and wait until it ended; returns it. */
  async function runOnce(agentId: string): Promise<any> {
    const started = await owner.post(`/api/workspaces/${wsId}/agents/${agentId}/run`)
    assert.equal(started.status, 202, JSON.stringify(started.body))
    let run: any
    await waitFor(async () => {
      run = (await all(agentId)).find((r) => r.id === started.body.runId)
      return !!run && run.status !== 'running'
    }, 20_000, `run of ${agentId}`)
    return run
  }

  before(async () => {
    fake = await fakeAnthropic()
    server = await startServer({ ANTHROPIC_BASE_URL: fake.url, API_RATE_LIMIT: '1000' })
    owner = await signIn(server, 'owner@lamps.test')
    viewer = await signIn(server, 'viewer@lamps.test')
    outsider = await signIn(server, 'outsider@lamps.test')
    wsId = (await owner.post('/api/workspaces', { name: 'Nordlicht Werk' })).body.id
    const invite = await owner.post(`/api/workspaces/${wsId}/invites`, { role: 'viewer' })
    assert.equal((await viewer.post(`/api/invites/${invite.body.link.split('#/invite/')[1]}/accept`)).status, 200)

    const meta = openDoc(server, owner, `ws:${wsId}`)
    open.push(meta)
    await meta.synced
    meta.doc.transact(() => {
      meta.doc.getMap('pages').set('doc-1', pageEntry({ title: 'Übergabe' }))
      const agents = meta.doc.getMap('agents')
      agents.set('ag-a', agentDef('ag-a', 'Spiegel A', { write: 'stage' }))
      agents.set('ag-b', agentDef('ag-b', 'Spiegel B', { write: 'stage' }))
      agents.set('ag-c', agentDef('ag-c', 'Leser', {}))
      agents.set('ag-d', agentDef('ag-d', 'Wochenbericht', {}))
    })
    await flushed(meta)
    assert.equal((await owner.json('PUT', `/api/workspaces/${wsId}/agent-runtime`, { claudeKey: KEY, enabled: true })).status, 200)

    // the first turn of every run stages a page, the next one ends it
    const first = (req: { body: any }) => req.body.messages.length === 1
    let a = 0
    fake.script('Spiegel A', (req) => (first(req) ? tools(['create_page', { title: `Notiz ${++a}`, markdown: 'Text', parent_id: 'doc-1' }]) : say('Staged a note.')))
    fake.script('Spiegel B', (req) => (first(req) ? tools(['create_page', { title: 'Andere Notiz', markdown: 'Text', parent_id: 'doc-1' }]) : say('Staged a note.')))
    fake.script('Leser', () => say('Nothing to do.'))
    fake.script('Wochenbericht', () => ({ status: 400, error: { type: 'invalid_request_error', message: 'bad request' } }))
  })

  after(async () => {
    for (const d of open) d.destroy()
    await server.stop()
    await fake.close()
  })

  test('only the listed agents, only staged runs, newest first, without summary / steps; heads of every listed agent', async () => {
    const a1 = await runOnce('ag-a')
    const a2 = await runOnce('ag-a')
    const b1 = await runOnce('ag-b')
    const c1 = await runOnce('ag-c')
    const d1 = await runOnce('ag-d')
    assert.deepEqual([a1.status, a2.status, b1.status, c1.status, d1.status], ['staged', 'staged', 'staged', 'ok', 'error'])

    const res = await openRuns(owner, 'ag-a,ag-c,ag-d')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.runs.map((r: any) => r.id), [a2.id, a1.id])
    for (const r of res.body.runs) {
      assert.equal(r.agentId, 'ag-a')
      assert.equal(r.status, 'staged')
      assert.equal('summary' in r, false)
      assert.equal('steps' in r, false)
      assert.equal(r.staged.length, 1)
      assert.equal(r.staged[0].kind, 'create_page')
      assert.equal(r.staged[0].status, 'pending')
    }
    // the agent nobody asked for is not there
    assert.equal(JSON.stringify(res.body).includes(b1.id), false)
    const heads = Object.fromEntries(res.body.latest.map((h: any) => [h.agentId, h]))
    assert.deepEqual(Object.keys(heads).sort(), ['ag-a', 'ag-c', 'ag-d'])
    assert.deepEqual(heads['ag-a'], { id: a2.id, agentId: 'ag-a', status: 'staged', startedAt: a2.startedAt, endedAt: a2.endedAt })
    assert.equal(heads['ag-c'].status, 'ok')
    assert.equal(heads['ag-d'].status, 'error')
    assert.equal(heads['ag-d'].id, d1.id)
    // an unknown agent id: nothing, no error
    assert.deepEqual((await openRuns(owner, 'ag-none')).body, { runs: [], latest: [] })
  })

  test('a run whose proposals are resolved leaves the answer', async () => {
    const before = (await openRuns(owner, 'ag-a')).body.runs as any[]
    assert.equal(before.length, 2)
    const [newest] = before
    const resolved = await owner.post(`/api/workspaces/${wsId}/agent-runs/${newest.id}/resolve`, { applied: [], discarded: newest.staged.map((c: any) => c.id) })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.status, 'ok')
    const after = (await openRuns(owner, 'ag-a')).body.runs as any[]
    assert.deepEqual(after.map((r) => r.id), [before[1].id])
  })

  test('access and input: viewers read, outsiders do not; 1–50 valid ids', async () => {
    const asViewer = await openRuns(viewer, 'ag-a,ag-b')
    assert.equal(asViewer.status, 200)
    assert.equal(asViewer.body.runs.length, 2)
    assert.equal((await openRuns(outsider, 'ag-a')).status, 404)
    assert.equal((await owner.get(`/api/workspaces/${wsId}/agent-runs/open`)).status, 400)
    assert.equal((await openRuns(owner, '')).status, 400)
    assert.equal((await openRuns(owner, 'ag-a,bad%20id')).status, 400)
    const many = Array.from({ length: 51 }, (_, i) => `ag-${i}`).join(',')
    assert.equal((await openRuns(owner, many)).status, 400)
    const fifty = Array.from({ length: 50 }, (_, i) => `ag-${i}`).join(',')
    assert.equal((await openRuns(owner, fifty)).status, 200)
    // repeated ids count once
    assert.equal((await openRuns(owner, 'ag-a,ag-a')).body.latest.length, 1)
  })
})
