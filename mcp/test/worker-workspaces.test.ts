import { createHmac } from 'node:crypto'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { WorkspaceGrants, workspaceConfig } from '../src/worker/workspaces.ts'
import { WorkerState } from '../src/worker/state.ts'
import { emptyConfig, scratchPath } from '../src/worker/config.ts'
import { saveOllamaCloud, readOllamaCloud } from '../src/worker/ollama-cloud-config.ts'
import { cleanupAll, makeRepo, repoEntry, writeConfig, presetBundle, spawnWorker, FakeTab, task, tempDir, WS_LOCAL } from './worker-helpers.ts'
import { waitFor } from './helpers.ts'

after(cleanupAll)
const owner = 'o'.repeat(43), pair = 'p'.repeat(43)
const proof = (nonce: string, workspace: string, pair: string, key = owner) => ({ nonce, signature: createHmac('sha256', key).update(JSON.stringify([nonce, workspace, pair])).digest('base64url') })
const extra = { ...WS_LOCAL, id: 'local:second-workspace', name: 'Second' }

test('device grants need owner proof, persist privately, cannot replace an existing grant, and rotate with the owner', () => {
  const file = join(tempDir('workspace-grants'), 'worker.json')
  const grants = new WorkspaceGrants(file, owner)
  assert.equal(grants.add(extra, pair, proof(grants.challenge(extra.id), extra.id, pair, pair)), false)
  assert.equal(grants.add(extra, pair, undefined), false)
  assert.equal(grants.add(extra, pair, proof(grants.challenge(extra.id), extra.id, pair)), true)
  assert.equal(grants.add(extra, 'x'.repeat(43), proof(grants.challenge(extra.id), extra.id, pair)), false)
  assert.equal(new WorkspaceGrants(file, owner).get(extra.id)?.pair, pair)
  assert.deepEqual(grants.list(), [{ id: extra.id, name: extra.name }])
  assert.ok(!JSON.stringify(grants.list()).includes(pair))
  assert.ok(!readFileSync(grants.file, 'utf8').includes(owner))
  if (process.platform !== 'win32') assert.equal(statSync(grants.file).mode & 0o777, 0o600)
  assert.equal(new WorkspaceGrants(file, 'n'.repeat(43)).get(extra.id), undefined)
  grants.revoke(extra.id)
  assert.equal(new WorkspaceGrants(file, owner).get(extra.id), undefined)
  const wrongScope = { ...extra, id: 'local:wrong-scope' }
  const scoped = proof(grants.challenge(extra.id), extra.id, pair)
  assert.equal(grants.add(wrongScope, pair, scoped), false)
  assert.equal(grants.add(extra, pair, scoped), false, 'a consumed challenge cannot replay')
  const changedPair = proof(grants.challenge(extra.id), extra.id, pair)
  assert.equal(grants.add(extra, 'x'.repeat(43), changedPair), false)
  const expired = proof(grants.challenge(extra.id), extra.id, pair)
  const now = Date.now
  try { Date.now = () => now() + 121000; assert.equal(grants.add(extra, pair, expired), false) } finally { Date.now = now }
})

test('runtime state and scratch are namespaced; credentials keep the device config path', () => {
  const file = join(tempDir('workspace-runtime'), 'worker.json')
  const base = emptyConfig(file)
  const a = workspaceConfig(base, { workspace: extra, pair })
  const b = workspaceConfig(base, { workspace: { ...extra, id: 'team:other-workspace', kind: 'team' }, pair })
  const first = new WorkerState(a.file, a.runtimeDir, a.workspace!), second = new WorkerState(b.file, b.runtimeDir, b.workspace!)
  first.data.taskSpent.same_id = 1; first.save()
  assert.equal(second.data.taskSpent.same_id, undefined)
  assert.notEqual(first.file, second.file)
  assert.notEqual(scratchPath(a, 'same_id'), scratchPath(b, 'same_id'))
  assert.equal(first.configFile, file)
  assert.equal(second.configFile, file)
  saveOllamaCloud(file, { apiKey: 'private-fixture-ollama-key', contextTokens: 131072, model: 'model-fixture' })
  assert.equal(readOllamaCloud(second.configFile, {}).apiKey, 'private-fixture-ollama-key')
  assert.equal(existsSync(join(b.runtimeDir!, 'ollama-cloud.json')), false)
})

test('the downloaded device worker grants a second workspace; identical task IDs have isolated branches, task tools and outcomes across reconnects and restart', { timeout: 120000 }, async () => {
  const r = makeRepo()
  const port = 47864
  const config = writeConfig(r, { workspace: WS_LOCAL.id, parallel: 2, pollSec: 2, repos: [repoEntry(r)] })
  const bundle = presetBundle({ workspace: WS_LOCAL.id, name: 'Original', origin: 'http://127.0.0.1:5350', port, pair: owner })
  let worker = await spawnWorker({ bundle, args: ['--config', config] })
  const tabs: FakeTab[] = []
  const connect = async () => { const tab = await FakeTab.connect(port); tabs.push(tab); return tab }
  try {
    const a = await connect(); a.hello(WS_LOCAL, owner); await a.next('welcome')
    const unknown = await connect(); unknown.hello(extra, owner)
    assert.equal((await unknown.next('refused')).reason, 'workspace')
    const challenge = await unknown.next('refused')
    assert.equal(challenge.workspaceGrant, true)
    assert.equal(challenge.workspaceOwner, WS_LOCAL.id)
    const denied = await connect()
    denied.send({ type: 'hello', app: 'one', version: 'test', workspace: extra, pair, authorizeWorkspace: proof(challenge.workspaceNonce!, extra.id, pair, pair) })
    const freshChallenge = await denied.next('refused')
    assert.equal(freshChallenge.reason, 'workspace')
    const b = await connect()
    b.send({ type: 'hello', app: 'one', version: 'test', workspace: extra, pair, authorizeWorkspace: proof(freshChallenge.workspaceNonce!, extra.id, pair), can: ['permission'] })
    assert.equal((await b.next('welcome', 20000)).multiWorkspace, true)
    assert.equal(a.closed, null, 'another workspace never replaces the original tab')
    a.strictRepos = true; b.strictRepos = true
    const [alpha, beta] = await Promise.all([
      a.run(task({ kind: 'implement' }, { id: 'same_task_id', title: 'Alpha workspace task' }), 45000),
      b.run(task({ kind: 'implement' }, { id: 'same_task_id', title: 'Beta workspace task' }), 45000),
    ])
    assert.equal(alpha.status, 'ok', JSON.stringify(alpha)); assert.equal(beta.status, 'ok', JSON.stringify(beta))
    assert.notEqual(alpha.branch, beta.branch)
    assert.ok(a.messages.some(m => m.type === 'event' && m.kind === 'note'))
    assert.ok(b.messages.some(m => m.type === 'event' && m.kind === 'note'), 'child task MCP uses the shared HTTP port with its own token')
    const grants = new WorkspaceGrants(config, owner)
    const scoped = workspaceConfig({ ...emptyConfig(config), repos: [] }, grants.get(extra.id)!)
    assert.equal(JSON.parse(readFileSync(join(dirname(config), 'worker-state.json'), 'utf8')).tasks.same_task_id.branch, alpha.branch)
    assert.equal(JSON.parse(readFileSync(join(scoped.runtimeDir!, 'worker-state.json'), 'utf8')).tasks.same_task_id.branch, beta.branch)

    // The original run continues while its tab is away. Its buffered outcome cannot reach the other workspace.
    a.queue.push(task({ kind: 'implement' }, { id: 'away_task_id', text: 'FAKE:LIVE' })); a.send({ type: 'nudge' })
    await waitFor(() => a.messages.some(m => m.type === 'event' && m.taskId === 'away_task_id'), 20000)
    const crossStop = await b.request({ op: 'stop', taskId: 'away_task_id' })
    assert.equal(crossStop.ok && (crossStop.result as { stopped: boolean }).stopped, false)
    a.close()
    await waitFor(() => worker.stderr().includes('task away_task_id: ok'), 30000, worker.stderr)
    assert.ok(!b.messages.some(m => 'taskId' in m && m.taskId === 'away_task_id'))
    const returned = await connect(); returned.hello(WS_LOCAL, owner); await returned.next('welcome')
    await waitFor(() => returned.outcomes.some(o => o.taskId === 'away_task_id'), 10000)
    assert.equal(returned.outcomes.find(o => o.taskId === 'away_task_id')?.outcome.status, 'ok')

    for (const tab of tabs) tab.close()
    await worker.stop()
    worker = await spawnWorker({ bundle, args: ['--config', config] })
    const resumed = await connect(); resumed.hello(extra, pair); await resumed.next('welcome', 20000)
    const result = await resumed.run(task({ kind: 'plan' }, { id: 'same_task_id', title: 'Beta workspace task', branch: beta.branch }), 45000)
    assert.equal(result.status, 'ok', JSON.stringify(result))
    assert.equal(result.branch, beta.branch)
    assert.ok(!worker.stderr().includes(owner)); assert.ok(!worker.stderr().includes(pair))
    assert.ok(existsSync(grants.file))
    await resumed.request({ op: 'open-setup' })
    const address = new URL(worker.stderr().match(/http:\/\/127\.0\.0\.1:\d+\/setup#k=[A-Za-z0-9_-]+/)![0])
    const key = new URLSearchParams(address.hash.slice(1)).get('k')!
    const revoked = await fetch(new URL('/setup/api/workspace-revoke', address), { method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'application/json', 'X-One-Setup': key }, body: JSON.stringify({ id: extra.id }) })
    assert.equal(revoked.status, 200)
    await waitFor(() => resumed.closed !== null)
    const removed = await connect(); removed.hello(extra, pair)
    assert.equal((await removed.next('refused')).reason, 'workspace')
    const original = await connect(); original.hello(WS_LOCAL, owner); await original.next('welcome')
    assert.ok(existsSync(join(scoped.runtimeDir!, 'worker-state.json')), 'revocation stops execution without deleting saved work')
  } finally { for (const tab of tabs) tab.close(); await worker.stop() }
})
