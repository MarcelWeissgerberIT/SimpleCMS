import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startServer, signIn } from './helpers.ts'
import { modelShareKey, sharedRequestBox, sharedWorkerKey, openShared, sealShared, type SharedText } from '../../src/shared/ai/shared-model.ts'
import { snapshotTable, parseCellAnswer, planCellPatches, resolveCellPatch, cellText, type TableNode } from '../../src/shared/ai/tableCells.ts'

test('shared local queue carries text-only cell proposals; decryption and review yield the same bounded patches', async () => {
  const server = await startServer()
  try {
    const owner = await signIn(server, 'host@cells.test'), member = await signIn(server, 'member@cells.test')
    const workspace = (await owner.post('/api/workspaces', { name: 'Synthetic table test' })).body.id
    const link = (await owner.post(`/api/workspaces/${workspace}/invites`, { email: 'member@cells.test', role: 'member' })).body.link
    assert.equal((await member.post('/api/invites/' + link.split('#/invite/')[1] + '/accept')).status, 200)
    const worker = (await owner.post(`/api/workspaces/${workspace}/coding/workers`, { label: 'Synthetic local host' })).body
    const host = async (path: string, value: unknown, method = 'POST') => {
      const r = await fetch(server.url + '/api/coding/shared-model/' + path, { method, headers: { authorization: 'Bearer ' + worker.token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
      assert.equal(r.status, 200)
      return await r.json() as any
    }
    const model = 'synthetic-local:latest'
    await host('config', { model, label: 'Synthetic model', enabled: true }, 'PUT')
    const keys = await modelShareKey(), publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
    const poll = (extra: Record<string, unknown> = {}) => host('poll', { publicKey, busy: false, available: true, active: null, dataFlow: true, ...extra })
    await poll()
    const cell = (id: string, text: string): TableNode => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }] })
    const document: TableNode = { type: 'doc', content: [{ type: 'table', attrs: { id: 'table' }, content: [{ type: 'tableRow', content: [cell('source', 'Supplied team note'), cell('target', 'Existing result')] }] }] }
    const before = structuredClone(document), snapshot = snapshotTable(document, 'table')
    const request: SharedText = { model, maxTokens: 512, messages: [{ role: 'system', content: 'Propose cell values only.' }, { role: 'user', content: JSON.stringify({ table: snapshot.cells.map(c => ({ cellId: c.id, text: c.text })), allowedCellIds: ['target'] }) }] }
    const jobId = crypto.randomUUID(), shareId = worker.id
    const sealed = await sharedRequestBox(request, publicKey, shareId, jobId)
    const path = `/api/workspaces/${workspace}`
    assert.equal((await member.post(`${path}/model-shares/${shareId}/jobs`, { id: jobId, box: sealed.box, keyId: publicKey.n })).status, 201)
    const claimed = (await poll()).job
    assert.equal(claimed.id, jobId)
    assert.ok(!JSON.stringify(claimed).includes('Supplied team note'))
    const key = await sharedWorkerKey(claimed.box, keys.privateKey)
    const received = await openShared<SharedText>(claimed.box, key, shareId, jobId)
    assert.deepEqual(received, request)
    assert.deepEqual(Object.keys(received).sort(), ['maxTokens', 'messages', 'model']) // no tools, schema or credentials
    const proposal = JSON.stringify({ cells: [{ cellId: 'target', value: 'Proposal based on supplied team note' }] })
    const box = await sealShared({ ok: true, result: { model, text: proposal, calls: [], inputTokens: 20, outputTokens: 12, usd: 0 } }, key, shareId, jobId)
    await poll({ outcome: { id: jobId, box } })
    const done = (await member.get(`${path}/model-jobs/${jobId}`)).body
    assert.equal(done.state, 'done')
    assert.ok(!JSON.stringify(done).includes('Proposal based on supplied team note'))
    const result = await openShared<{ result: { text: string } }>(done.box, sealed.key, shareId, jobId)
    const changes = planCellPatches(snapshot, parseCellAnswer(result.result.text, ['target']), ['target'])
    assert.deepEqual(document, before) // receiving a model response never writes a document
    assert.equal(changes.length, 1)
    const resolved = resolveCellPatch(document, changes[0])
    assert.equal(cellText(resolved.after), 'Proposal based on supplied team note')
    assert.deepEqual(document.content![0].content![0].content![0], before.content![0].content![0].content![0])
    assert.throws(() => planCellPatches(snapshot, parseCellAnswer('{"cells":[{"cellId":"source","value":"overwrite"}]}', ['target']), ['target']))
  } finally { await server.stop() }
})
