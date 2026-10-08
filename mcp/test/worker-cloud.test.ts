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
import { strToU8, zipSync } from 'fflate'
import type { LogLine, WorkerMessage, WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { coalesceOutbox, droppable } from '../src/worker/link.ts'
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

  test('an Import ZIP of 3,000 files through the relay: its progress comes throttled, never marked droppable — and its result arrives', async () => {
    const { home } = await boot()
    await relay!.connected()
    const tab = relay!.openTab(PAIR)
    await tab.hello(WS)
    await tab.next('welcome')
    const files: Record<string, Uint8Array> = { 'ledger/package.json': strToU8(JSON.stringify({ name: 'ledger-core' })) }
    for (let i = 0; i < 3000; i++) files[`ledger/src/m${i}.js`] = strToU8(`export const v${i} = ${i}\n`)
    const zip = Buffer.from(zipSync(files, { level: 0 }))
    const begin = await tab.request({ op: 'intake-begin', taskId: 'zip1abcd', name: 'ledger.zip', size: zip.length })
    assert.equal(begin.ok, true, JSON.stringify(begin))
    const { uploadId, chunk } = (begin as { result: { uploadId: string; chunk: number } }).result
    const boxesBefore = relay!.frames.filter((f) => f.type === 'box').length
    for (let off = 0; off < zip.length; off += chunk) assert.equal((await tab.request({ op: 'intake-chunk', uploadId, data: zip.subarray(off, off + chunk).toString('base64') })).ok, true)
    assert.equal((await tab.request({ op: 'intake-end', uploadId })).ok, true)
    const intakes = () => tab.messages.filter((m): m is Extract<WorkerMessage, { kind: 'intake' }> => m.type === 'event' && m.kind === 'intake')
    await waitFor(() => intakes().some((m) => m.intake.state !== 'running'), 30_000, () => worker!.stderr())
    const last = intakes().at(-1)!
    assert.equal(last.intake.state, 'done', JSON.stringify(last))
    assert.equal(last.intake.repo, 'ledger')
    assert.ok(existsSync(join(home, 'one-repos', 'ledger', 'src', 'm2999.js')))
    assert.ok(intakes().length < 100, `${intakes().length} import events for 3,000 files`)
    // nothing the worker sent during the import is marked droppable: no logs ran, only the import's own events
    const during = relay!.frames.filter((f) => f.type === 'box').slice(boxesBefore)
    assert.ok(during.length > 0)
    assert.deepEqual(during.filter((f) => f.k === 'e'), [], 'import events are never droppable')
  })

  test('a half-sent ZIP is given up when its tab goes away: the next upload is not "another import"', async () => {
    await boot()
    await relay!.connected()
    const tab = relay!.openTab(PAIR)
    await tab.hello(WS)
    await tab.next('welcome')
    const zip = Buffer.from(zipSync({ 'atlas/a.txt': strToU8('a\n') }))
    const begin = await tab.request({ op: 'intake-begin', taskId: 'zip2abcd', name: 'atlas.zip', size: zip.length })
    const { uploadId } = (begin as { result: { uploadId: string } }).result
    // the tab goes while a piece is being written: the worker gives the upload up — and keeps running
    void tab.request({ op: 'intake-chunk', uploadId, data: zip.subarray(0, 8).toString('base64') }).catch(() => {})
    await waitFor(() => /receiving atlas\.zip/.test(worker!.stderr()))
    relay!.tabGone('closed')
    await waitFor(() => /import for task zip2abcd: dropped \(One disconnected\)/.test(worker!.stderr()), 5000, () => worker!.stderr())
    const again = relay!.openTab(PAIR)
    await again.hello(WS)
    await again.next('welcome')
    // the tab hears what became of the old upload, then a new one starts at once
    await waitFor(() => again.messages.some((m) => m.type === 'event' && m.kind === 'intake' && m.taskId === 'zip2abcd' && m.intake.state === 'failed'), 5000)
    const next = await again.request({ op: 'intake-begin', taskId: 'zip3abcd', name: 'atlas.zip', size: zip.length })
    assert.equal(next.ok, true, JSON.stringify(next))
    // the same task beginning again replaces its own unfinished upload (no "failed" for it)
    const same = await again.request({ op: 'intake-begin', taskId: 'zip3abcd', name: 'atlas.zip', size: zip.length })
    assert.equal(same.ok, true, JSON.stringify(same))
    assert.equal(worker!.child.exitCode, null)
    assert.doesNotMatch(worker!.stderr(), /Unhandled|ERR_STREAM/)
  })

  test('a second copy for the same workspace on the same computer: the port is taken — it says to stop the older one or pick a port', async () => {
    await boot()
    await relay!.connected()
    const bundle = presetBundle({ workspace: WS.id, origin: relay!.origin, port: PORT, pair: PAIR, name: WS.name, dev: true, cloud: { token: TOKEN } })
    const second = await spawnWorker({ bundle, home: tempDir('home'), args: ['--no-browser'] })
    await waitFor(() => second.child.exitCode !== null, 8000, () => second.stderr())
    assert.equal(second.child.exitCode, 1)
    assert.match(second.stderr(), /port 47393 is in use — another one-worker runs on this computer \(an older cloud worker of this workspace\? stop it first: this file takes over once it connects\) — or start this one with ONE_WORKER_PORT=<a free port>/)
    assert.doesNotMatch(second.stderr(), /the same port in One/)
    assert.equal(worker!.child.exitCode, null, 'the running one keeps running')
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

describe('cloud worker — what the relay may drop, and the outbox', () => {
  const log = (taskId: string, n: number, from = 0): WorkerMessage => ({ type: 'event', taskId, kind: 'log', lines: Array.from({ length: n }, (_, i): LogLine => ({ t: from + i, k: 'info', s: `line ${from + i}` })) })

  test('only log lines, progress and the live git state are droppable — never a question, a note, an import, a request or an answer', () => {
    assert.equal(droppable(log('a', 1)), true)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'progress', progress: { turns: 1, maxTurns: 10, cost: null, model: null } }), true)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'git', git: { branch: 'b', base: 'main', ahead: 0, behind: 0, dirty: false, files: [] } as never }), true)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'question', text: 'Which?' }), false)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'note', text: 'n' }), false)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'intake', intake: { state: 'running', source: 'zip', label: 'x.zip', line: '', percent: 1 } }), false)
    assert.equal(droppable({ type: 'event', taskId: 'a', kind: 'intake', intake: { state: 'done', source: 'zip', label: 'x.zip', line: '', percent: 100, repo: 'x' } }), false)
    assert.equal(droppable({ type: 'req', id: 'w1', op: 'heartbeat', taskIds: [] }), false)
    assert.equal(droppable({ type: 'res', id: 't1', ok: true, result: {} }), false)
  })

  test('coalesceOutbox: logs merged into frames of ≤ 200 lines (newest LOG_MAX), newest git / progress only, every question and import result kept', () => {
    const events: WorkerMessage[] = []
    for (let i = 0; i < 1500; i++) events.push(log('t1', 2, i * 2))
    events.push({ type: 'event', taskId: 't1', kind: 'question', text: 'First?' })
    for (let i = 0; i < 50; i++) events.push({ type: 'event', taskId: 't1', kind: 'progress', progress: { turns: i, maxTurns: 99, cost: null, model: null } })
    for (let i = 0; i < 20; i++) events.push({ type: 'event', taskId: 't1', kind: 'git', git: { n: i } as never })
    for (let i = 0; i < 400; i++) events.push({ type: 'event', taskId: 'z1', kind: 'intake', intake: { state: 'running', source: 'zip', label: 'z.zip', line: `${i}`, percent: 60 } })
    events.push({ type: 'event', taskId: 'z1', kind: 'intake', intake: { state: 'done', source: 'zip', label: 'z.zip', line: '', percent: 100, repo: 'z' } })
    events.push({ type: 'event', taskId: 't1', kind: 'note', text: 'noted' })
    events.push(log('t2', 3))
    const out = coalesceOutbox(events)
    const logs = out.filter((m): m is Extract<WorkerMessage, { kind: 'log' }> => m.type === 'event' && m.kind === 'log')
    const t1 = logs.filter((m) => m.taskId === 't1').flatMap((m) => m.lines)
    assert.equal(t1.length, 2000, 'the newest LOG_MAX lines of a task')
    assert.equal(t1[0]!.s, 'line 1000')
    assert.equal(t1.at(-1)!.s, 'line 2999')
    assert.ok(logs.every((m) => m.lines.length <= 200))
    assert.deepEqual(logs.filter((m) => m.taskId === 't2').flatMap((m) => m.lines.map((l) => l.s)), ['line 0', 'line 1', 'line 2'])
    const kinds = out.filter((m) => m.type === 'event' && m.kind !== 'log').map((m) => (m as { kind: string }).kind)
    assert.deepEqual(kinds, ['question', 'progress', 'git', 'intake', 'note'])
    const progress = out.find((m) => m.type === 'event' && m.kind === 'progress') as Extract<WorkerMessage, { kind: 'progress' }>
    assert.equal(progress.progress.turns, 49)
    const intake = out.filter((m): m is Extract<WorkerMessage, { kind: 'intake' }> => m.type === 'event' && m.kind === 'intake')
    assert.deepEqual(intake.map((m) => m.intake.state), ['done'], 'an import\'s progress before its result is left out, the result stays')
    assert.ok(out.length < 30, `${out.length} frames instead of ${events.length}`)
    // an import that started again after its result: the result and the newest progress after it
    const again = coalesceOutbox([...events.slice(-4, -2), { type: 'event', taskId: 'z1', kind: 'intake', intake: { state: 'running', source: 'zip', label: 'z.zip', line: 'again', percent: 5 } }])
    assert.deepEqual(again.filter((m) => m.type === 'event' && m.kind === 'intake').map((m) => (m as Extract<WorkerMessage, { kind: 'intake' }>).intake.state), ['done', 'running'])
  })
})
