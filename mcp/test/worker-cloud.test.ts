/**
 * one-worker in cloud mode (docs/CODING.md § Cloud worker) — the built bundle with a cloud preset (as One's
 * "Download the cloud worker" writes it) against a fake team-server relay (relay-helpers.ts) whose tab side uses
 * One's own WebCrypto box. The worker dials out with its token and no Origin, refuses every local tab, proves
 * itself with its sealed welcome, refuses a tab without this download's pairing key, batches log lines, keeps
 * its own config folder, reconnects after a drop and re-sends an unconfirmed outcome (same finishId), and stops
 * for good (exit 2) when the server lets the file go. Nothing leaves this machine.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import type { WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { waitFor } from './helpers.ts'
import { FakeRelay } from './relay-helpers.ts'
import { FakeTab, cleanupAll, makeRepo, presetBundle, spawnWorker, task, tempDir, type SpawnedWorker } from './worker-helpers.ts'

const PORT = 47393
const PAIR = 'cLoUdPaIr_0123456789-abcdefghijklmnopqrstuv'
const TOKEN = `onew_${'T'.repeat(43)}`
const WS: WorkspaceRef = { id: 'team:CloudWs1', name: 'Cloud team', kind: 'team', readOnly: false }

let relay: FakeRelay | null = null
let worker: SpawnedWorker | null = null

afterEach(async () => {
  await worker?.stop()
  worker = null
  await relay?.stop()
  relay = null
})
after(() => cleanupAll())

/** A cloud download for the fake relay, started like a person would (a temp home, no config file). */
async function boot(opts: { env?: Record<string, string>; args?: string[]; home?: string; ready?: boolean } = {}) {
  relay = await FakeRelay.start({ id: WS.id, name: WS.name })
  if (opts.ready === false) relay.autoReady = false
  const bundle = presetBundle({ workspace: WS.id, origin: relay.origin, port: PORT, pair: PAIR, name: WS.name, dev: true, cloud: { token: TOKEN } })
  const home = opts.home ?? tempDir('home')
  worker = await spawnWorker({ bundle, home, args: opts.args ?? ['--no-browser'], env: opts.env })
  return { bundle, home }
}

const exited = (w: SpawnedWorker, ms = 8000) => waitFor(() => w.child.exitCode !== null, ms, () => w.stderr()).then(() => w.child.exitCode)

describe('cloud worker', () => {
  test('dials out with its token (no Origin, no cookie), refuses local tabs, keeps the task tools local', async () => {
    const { home } = await boot()
    assert.match(worker!.stderr(), /ready \(cloud\) · task tools and setup page on 127\.0\.0\.1:47393/)
    await relay!.connected()
    const h = relay!.upgrades[0]!
    assert.equal(h.authorization, `Bearer ${TOKEN}`)
    assert.equal(h['x-one-workspace'], WS.id)
    assert.equal(h['sec-websocket-protocol'], 'one-worker.v1')
    assert.match(String(h['user-agent']), /^one-worker\//)
    assert.equal(h.origin, undefined)
    assert.equal(h.cookie, undefined)
    await waitFor(() => /connected to 127\.0\.0\.1:\d+ for "Cloud team" — waiting for a One tab/.test(worker!.stderr()), 5000, () => worker!.stderr())
    // a web page on this machine cannot reach it
    await assert.rejects(FakeTab.connect(PORT, { origin: relay!.origin }), /HTTP 403/)
    await assert.rejects(FakeTab.connect(PORT, { origin: null }), /HTTP 403/)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: PORT, path: '/task', method: 'POST' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end('{}')
    })
    assert.equal(status, 401)
    // its own folder (a local worker's ~/.config/one/worker.json stays untouched)
    assert.ok(!existsSync(join(home, '.config', 'one', 'worker.json')))
  })

  test('through the relay: sealed hello → sealed welcome (names only, via cloud); a document stage runs; logs come batched; finish carries an id', async () => {
    const { home } = await boot()
    await relay!.connected()
    const tab = relay!.openTab(PAIR)
    await tab.hello(WS)
    const welcome = await tab.next('welcome')
    assert.equal(welcome.via, 'cloud')
    assert.equal(welcome.paired, true)
    assert.deepEqual(welcome.repos, [])
    // nothing the relay saw is readable: every frame of the worker after its nonce is a box
    const plain = relay!.frames.filter((f) => f.type !== 'box' && f.type !== 'key')
    assert.deepEqual(plain, [])
    assert.ok(!JSON.stringify(relay!.frames).includes('Cloud team'), 'no plaintext of the protocol on the wire')
    const out = await tab.run(task({ kind: 'doc', name: 'Analysis', permissionMode: 'default' }, { id: 'cld1abcd', repo: '' }))
    assert.equal(out.status, 'ok', JSON.stringify(out))
    assert.match(tab.outcomes[0]!.finishId ?? '', /^f[0-9a-z]+$/)
    const logs = tab.messages.filter((m) => m.type === 'event' && m.kind === 'log') as Array<{ lines: unknown[] }>
    assert.ok(logs.length > 0)
    assert.ok(logs.some((l) => l.lines.length > 1), `log lines are batched in cloud mode: ${logs.map((l) => l.lines.length).join(',')}`)
    // the scratch folder lives in the cloud worker's own folder
    assert.ok(existsSync(join(home, '.config', 'one', 'cloud', 'team-CloudWs1', 'scratch', 'cld1abcd')))
    // the events the relay may drop are marked as such; requests are not
    assert.ok(relay!.frames.some((f) => f.type === 'box' && f.k === 'e'))
    // team workspaces: a task not confirmed on that device is refused (the tab decides, the worker checks)
    const refused = await tab.run(task({ kind: 'doc', name: 'Analysis' }, { id: 'cld2abcd', repo: '', trusted: false }))
    assert.equal(refused.status, 'refused')
  })

  test('a tab without this download\'s pairing key gets nothing: its first box does not open → refused "pair"', async () => {
    await boot()
    await relay!.connected()
    const stranger = relay!.openTab('sTrAnGeRr_0123456789-abcdefghijklmnopqrstuv')
    await stranger.hello(WS)
    await waitFor(() => stranger.closed !== null, 5000, () => worker!.stderr())
    assert.deepEqual(stranger.closed, { code: 4003, reason: 'pair' })
    assert.equal(stranger.messages.length, 0)
    assert.match(worker!.stderr(), /not paired with this file/)
    // the right device still gets in afterwards
    const tab = relay!.openTab(PAIR)
    await tab.hello(WS)
    await tab.next('welcome')
    // a tab of another workspace (with the right key) is refused by the worker too
    const other = relay!.openTab(PAIR)
    await other.hello({ ...WS, id: 'team:SomeoneElse' })
    const no = await other.next('refused')
    assert.equal(no.reason, 'workspace')
    await waitFor(() => other.closed !== null)
    assert.equal(other.closed!.code, 4003)
  })

  test('a dropped connection: the worker dials again and sends the unconfirmed outcome once more, with the same finishId', async () => {
    await boot()
    await relay!.connected()
    const tab = relay!.openTab(PAIR)
    tab.answerFinish = false
    await tab.hello(WS)
    await tab.next('welcome')
    await tab.run(task({ kind: 'doc', name: 'Analysis', permissionMode: 'default' }, { id: 'cld3abcd', repo: '' }))
    const first = tab.outcomes[0]!.finishId
    relay!.drop()
    await waitFor(() => relay!.worker !== null, 8000, () => worker!.stderr())
    await relay!.connected()
    const again = relay!.openTab(PAIR)
    await again.hello(WS)
    await waitFor(() => again.outcomes.length > 0, 8000, () => JSON.stringify(again.messages.slice(-3)))
    assert.equal(again.outcomes[0]!.taskId, 'cld3abcd')
    assert.equal(again.outcomes[0]!.finishId, first)
    assert.equal(worker!.child.exitCode, null)
  })

  test('let go for good — exit 2 and no second attempt: token refused (401), replaced (4401), another copy took over (4001), another workspace', async () => {
    await boot()
    relay!.refuse = { status: 401, text: 'Unauthorized' }
    relay!.drop()
    assert.equal(await exited(worker!), 2)
    assert.match(worker!.stderr(), /refused this file's worker token/)
    const attempts = relay!.attempts
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(relay!.attempts, attempts, 'no second attempt')
    await relay!.stop()

    await boot()
    await relay!.connected()
    relay!.closeWorker(4401, 'replaced')
    assert.equal(await exited(worker!), 2)
    assert.match(worker!.stderr(), /a newer download replaced this file's token/)
    await relay!.stop()

    await boot()
    await relay!.connected()
    relay!.closeWorker(4001, 'replaced')
    assert.equal(await exited(worker!), 2)
    assert.match(worker!.stderr(), /run one copy only/)
    await relay!.stop()

    await boot({ ready: false })
    await relay!.connected()
    relay!.send({ type: 'relay', op: 'ready', workspace: { id: 'team:Elsewhere', name: 'X' } })
    assert.equal(await exited(worker!), 2)
    assert.match(worker!.stderr(), /another workspace/)
  })

  test('a viewer waits (no exit); a server restart (1001) is only a reconnect', async () => {
    await boot()
    await relay!.connected()
    relay!.closeWorker(1001, 'server stopping')
    await waitFor(() => relay!.attempts >= 2, 8000, () => worker!.stderr())
    await relay!.connected()
    relay!.refuse = { status: 403, text: 'Forbidden: viewer' }
    relay!.drop()
    await waitFor(() => /viewers run no coding tasks; trying again every 5 minutes/.test(worker!.stderr()), 8000, () => worker!.stderr())
    assert.equal(worker!.child.exitCode, null)
  })

  test('check: asks the team server about its token and names the workspace and member', async () => {
    relay = await FakeRelay.start({ id: WS.id, name: WS.name })
    relay.check = { status: 200, body: { workspace: { id: WS.id, name: 'Cloud team' }, member: { email: 'ada@example.com', name: 'Ada' }, state: 'pending', online: false } }
    const bundle = presetBundle({ workspace: WS.id, origin: relay.origin, port: PORT, pair: PAIR, name: WS.name, dev: true, cloud: { token: TOKEN } })
    const home = tempDir('home')
    const run = await spawnWorker({ bundle, home, args: ['check'] })
    await waitFor(() => run.child.exitCode !== null, 15_000, () => run.stderr())
    assert.match(run.stdout(), /cloud {6}127\.0\.0\.1:\d+ · "Cloud team" as ada@example\.com · new token \(its first start activates it\)/)
    assert.match(run.stdout(), new RegExp(`config {5}${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.config/one/cloud/team-CloudWs1/worker\\.json`))
    assert.equal(relay.upgrades.at(-1)!.authorization, `Bearer ${TOKEN}`)
    relay.check = { status: 401, body: {} }
    const refused = await spawnWorker({ bundle, home, args: ['check'] })
    await waitFor(() => refused.child.exitCode !== null, 15_000, () => refused.stderr())
    assert.match(refused.stdout(), /token refused/)
    assert.equal(refused.child.exitCode, 1)
  })

  test('the same machine runs a local and a cloud worker side by side (ports and folders apart)', async () => {
    const r = makeRepo()
    const { home } = await boot()
    await relay!.connected()
    const localBundle = presetBundle({ workspace: 'local:side-by-side', origin: 'http://127.0.0.1:5350', port: 47392, pair: PAIR, name: 'Local' })
    const local = await spawnWorker({ bundle: localBundle, home, args: ['--no-browser'] })
    try {
      assert.match(local.stderr(), /ready on ws:\/\/127\.0\.0\.1:47392/)
      const tab = await FakeTab.connect(47392)
      tab.hello({ id: 'local:side-by-side', name: 'Local', kind: 'local', readOnly: false }, PAIR)
      const welcome = await tab.next('welcome')
      assert.equal(welcome.via, 'local')
      tab.close()
      assert.ok(r.path)
    } finally {
      await local.stop()
    }
  })
})
