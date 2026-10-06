/**
 * The BUILT worker (public/mcp/one-worker.mjs — what people download) against a temp repo with a local bare
 * remote and the fake Claude Code CLI, driven by a fake One tab: the handshake and its refusals, a task
 * through plan → implement → test → ship, questions, cost limits, Stop, refusals of unknown repos,
 * unconfirmed team tasks and free commands — and no path or command of this machine ever reaching the tab.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { after, afterEach, describe, test } from 'node:test'
import { WORKER_CLOSE_REFUSED, WORKER_CLOSE_REPLACED, type GitInfo, type WorkerMessage } from '../../src/app/features/coding/protocol.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, WS_LOCAL, cleanupAll, makeRepo, repoEntry, sh, startWorker, task, writeConfig, type StartedWorker, type TempRepo } from './worker-helpers.ts'

const PORT = 47381
let worker: StartedWorker | null = null
const tabs: FakeTab[] = []

afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})
after(cleanupAll)

async function boot(r: TempRepo, cfg: Record<string, unknown> = {}, repo: Record<string, unknown> = {}) {
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r, repo)], ...cfg })
  worker = await startWorker(file)
  assert.match(worker.stderr(), /ready on ws:\/\/127\.0\.0\.1:47381/)
  return file
}

async function connect(workspace = WS_LOCAL): Promise<FakeTab> {
  const tab = await FakeTab.connect(PORT)
  tabs.push(tab)
  tab.hello(workspace)
  return tab
}

/** Everything the tab received must be free of this machine's paths and commands. */
function assertNoPaths(tab: FakeTab, r: TempRepo) {
  const all = tab.raw.join('\n')
  for (const secret of [r.path, r.worktrees, r.dir, homedir(), process.execPath, 'check.mjs"', 'fake-claude']) assert.ok(!all.includes(secret), `the tab received ${JSON.stringify(secret)}`)
}

describe('handshake', () => {
  test('welcome: repo names and base branches only; a foreign origin, another workspace and an unbound worker are refused', async () => {
    const r = makeRepo()
    await boot(r)
    await assert.rejects(FakeTab.connect(PORT, { origin: 'https://evil.example' }), /HTTP 403/)
    await assert.rejects(FakeTab.connect(PORT, { origin: null }), /HTTP 403/)
    await assert.rejects(FakeTab.connect(PORT, { protocol: 'one-mcp.v2' }), /HTTP 400/)

    const other = await connect({ ...WS_LOCAL, id: 'local:someone-else' })
    await waitFor(() => other.closed !== null)
    assert.equal(other.closed!.code, WORKER_CLOSE_REFUSED)
    assert.deepEqual(other.messages, [{ type: 'refused', reason: 'workspace' }])

    const tab = await connect()
    const welcome = await tab.next('welcome')
    assert.equal(welcome.name, 'test-box')
    assert.deepEqual(welcome.repos, [{ name: 'demo', baseBranch: 'main' }])
    assert.equal(welcome.claude.found, true)
    assertNoPaths(tab, r)

    // a newer tab of the same workspace takes over
    const newer = await connect()
    await newer.next('welcome')
    await waitFor(() => tab.closed !== null)
    assert.equal(tab.closed!.code, WORKER_CLOSE_REPLACED)
  })

  test('a worker without a workspace refuses every tab and says how to bind it', async () => {
    const r = makeRepo()
    const file = writeConfig(r, { port: PORT, repos: [repoEntry(r)] })
    worker = await startWorker(file)
    const tab = await connect()
    await waitFor(() => tab.closed !== null)
    assert.deepEqual(tab.messages, [{ type: 'refused', reason: 'unbound' }])
    await waitFor(() => /set "workspace": "local:test-ws-1"/.test(worker!.stderr()))
  })
})

describe('a task through the pipeline', () => {
  test('plan → implement → test (fails, rework, passes) → ship: pushed to the remote; diffs and logs reach One without paths', async () => {
    const r = makeRepo()
    await boot(r)
    const tab = await connect()
    await tab.next('welcome')

    const plan = await tab.run(task({ kind: 'plan' }, { id: 'flow1abc', text: 'Make it. FAKE:FAILTEST' }))
    assert.equal(plan.status, 'ok', JSON.stringify(plan))
    assert.match(plan.plan!, /## Steps/)
    assert.equal(plan.branch, 'one/add-the-feature-file-flow1a')
    assert.equal(plan.cost, 0.05)
    const branch = plan.branch!
    // the main checkout stays on main
    assert.equal(sh(r.path, 'branch', '--show-current').trim(), 'main')

    const impl = await tab.run(task({ kind: 'implement' }, { id: 'flow1abc', text: 'Make it. FAKE:FAILTEST', branch, spent: 0.05 }))
    assert.equal(impl.status, 'ok', JSON.stringify(impl))
    assert.match(impl.summary!, /Added `feature.txt`/)
    const file = impl.git!.files.find((f) => f.path === 'feature.txt')!
    assert.match(file.diff!, /\+BROKEN/)
    // the progress note came through the task tools (task-mcp → worker → tab), its path scrubbed
    await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'note'))
    const note = tab.messages.find((m) => m.type === 'event' && m.kind === 'note') as Extract<WorkerMessage, { kind: 'note' | 'question' }>
    assert.match(note.text, /Wrote \.\/feature\.txt/)

    const failed = await tab.run(task({ kind: 'test' }, { id: 'flow1abc', branch }))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.test!.ok, false)
    assert.match(failed.test!.output, /FAIL feature.txt is broken/)

    const rework = await tab.run(task({ kind: 'implement' }, { id: 'flow1abc', text: 'Make it. FAKE:FAILTEST', branch, rework: failed.test!.output }))
    assert.equal(rework.status, 'ok')
    const passed = await tab.run(task({ kind: 'test' }, { id: 'flow1abc', branch }))
    assert.equal(passed.status, 'ok', JSON.stringify(passed))
    assert.match(passed.test!.output, /PASS 1 check/)

    const ship = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'flow1abc', branch, summary: '- Added feature.txt' }))
    assert.equal(ship.status, 'ok', JSON.stringify(ship))
    assert.match(ship.summary!, /Committed [0-9a-f]{8}\. Pushed to origin/)
    assert.equal(ship.url, undefined)
    assert.ok(sh(r.remote, 'branch', '--list', branch).includes(branch))
    assert.equal(sh(r.remote, 'log', '-1', '--format=%s', branch).trim(), 'Add the feature file')
    const git = ship.git as GitInfo
    assert.deepEqual([git.pushed, git.unpushed, git.dirty, git.created], [true, 0, 0, true])

    // the log streamed, and nothing of this machine's paths or commands reached One
    assert.ok(tab.messages.filter((m) => m.type === 'event' && m.kind === 'log').length > 10)
    assertNoPaths(tab, r)

    // manual git actions: fixed verbs only
    const refresh = await tab.request({ op: 'git', taskId: 'flow1abc', verb: 'refresh', repo: 'demo', branch, title: 'x' })
    assert.equal(refresh.ok, true)
    const reveal = await tab.request({ op: 'git', taskId: 'flow1abc', verb: 'reveal', repo: 'demo', branch, title: 'Add the feature file' })
    assert.equal(reveal.ok, true)
    await waitFor(() => worker!.stderr().includes('worktree of task "Add the feature file"'))
    const free = await tab.request({ op: 'git', taskId: 'flow1abc', verb: 'push --force origin main', repo: 'demo', branch, title: 'x' })
    assert.equal(free.ok, false)
    assert.match((free as { error: string }).error, /unknown git action/)
    const exec = await tab.request({ op: 'exec', command: 'rm -rf /' })
    assert.equal(exec.ok, false)
    const elsewhere = await tab.request({ op: 'git', taskId: 'flow1abc', verb: 'push', repo: 'secret-repo', branch, title: 'x' })
    assert.equal(elsewhere.ok, false)
    assert.match((elsewhere as { error: string }).error, /not in this worker's config/)
    assertNoPaths(tab, r)

    // discard (One double-confirms): the worker's own branch + worktree go
    const discard = await tab.request({ op: 'git', taskId: 'flow1abc', verb: 'discard', repo: 'demo', branch, title: 'x' })
    assert.equal(discard.ok, true, JSON.stringify(discard))
    assert.equal(sh(r.path, 'branch', '--list', branch).trim(), '')
  })

  test('a question waits for the person; the answer runs the stage again', async () => {
    const r = makeRepo()
    await boot(r)
    const tab = await connect()
    await tab.next('welcome')
    const asked = await tab.run(task({ kind: 'implement' }, { id: 'ask1abcd', text: 'A button. FAKE:ASK' }))
    assert.equal(asked.status, 'question', JSON.stringify(asked))
    assert.equal(asked.question, 'Which colour should the button have?')
    assert.ok(tab.messages.some((m) => m.type === 'event' && m.kind === 'question'))
    const answered = await tab.run(task({ kind: 'implement' }, { id: 'ask1abcd', text: 'A button. FAKE:ASK', branch: asked.branch!, answers: [{ q: asked.question!, a: 'Orange' }] }))
    assert.equal(answered.status, 'ok')
    const wt = join(r.worktrees, asked.branch!.replace(/\//g, '-'))
    assert.match(readFileSync(join(wt, 'feature.txt'), 'utf8'), /colour: Orange/)
  })
})

describe('limits and refusals', () => {
  test('cost limits: a task over its limit is not started; the day limit counts every task', async () => {
    const r = makeRepo()
    await boot(r, {}, { maxUsdPerTask: 1, maxUsdPerDay: 4.5 })
    const tab = await connect()
    await tab.next('welcome')
    const over = await tab.run(task({ kind: 'implement' }, { id: 'lim1abcd', spent: 1 }))
    assert.equal(over.status, 'limit')
    assert.match(over.error!, /cost limit \(\$1\.00/)
    const pricey = await tab.run(task({ kind: 'implement' }, { id: 'lim2abcd', text: 'FAKE:EXPENSIVE' }))
    assert.equal(pricey.status, 'ok')
    assert.equal(pricey.cost, 4)
    const again = await tab.run(task({ kind: 'implement' }, { id: 'lim2abcd', branch: pricey.branch! }))
    assert.equal(again.status, 'limit')
    const other = await tab.run(task({ kind: 'implement' }, { id: 'lim3abcd' }))
    assert.equal(other.status, 'ok', 'one more cheap task fits under the day limit')
    const status = tab.messages.filter((m) => m.type === 'status').at(-1) as Extract<WorkerMessage, { type: 'status' }>
    assert.ok(status.spentToday >= 4.12)
  })

  test('Stop ends a running stage; unknown repos, unconfirmed team tasks and gates are refused', async () => {
    const r = makeRepo()
    await boot(r, { workspace: 'team:team-ws-1' })
    const tab = await connect({ id: 'team:team-ws-1', name: 'Team', kind: 'team', readOnly: false })
    await tab.next('welcome')

    const untrusted = await tab.run(task({ kind: 'implement' }, { id: 'tr1abcde', trusted: false }))
    assert.equal(untrusted.status, 'refused')
    assert.match(untrusted.error!, /not confirmed on this device/)
    const unknown = await tab.run(task({ kind: 'implement' }, { id: 'un1abcde', repo: 'not-configured' }))
    assert.equal(unknown.status, 'refused')
    assert.match(unknown.error!, /not in this worker's config/)
    const gate = await tab.run(task({ kind: 'gate' }, { id: 'gt1abcde' }))
    assert.equal(gate.status, 'refused')

    const slow = tab.run(task({ kind: 'implement' }, { id: 'slow1abc', text: 'FAKE:SLOW' }))
    await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'log' && m.lines.some((l) => /Working… step 3/.test(l.s))), 10_000)
    const stop = await tab.request({ op: 'stop', taskId: 'slow1abc' })
    assert.deepEqual((stop as { result: unknown }).result, { stopped: true })
    const stopped = await slow
    assert.equal(stopped.status, 'stopped')
    // the heartbeat confirmed the claim while it ran
    assert.ok(tab.heartbeats >= 1)
  })

  test('the task tools refuse browsers and unknown tokens', async () => {
    const r = makeRepo()
    await boot(r)
    const post = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: PORT, path: '/task', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
        req.end(JSON.stringify({ tool: 'one_task_read', args: {} }))
      })
    assert.equal(await post({ origin: 'http://127.0.0.1:5350', authorization: `Bearer ${'a'.repeat(48)}` }), 403)
    assert.equal(await post({ authorization: `Bearer ${'a'.repeat(48)}` }), 403)
    assert.equal(await post({}), 401)
  })
})

describe('init', () => {
  test('init writes a commented example bound to the workspace and refuses to overwrite', async () => {
    const r = makeRepo()
    const file = join(r.dir, 'init', 'worker.json')
    const { execFileSync } = await import('node:child_process')
    const { WORKER_BUNDLE } = await import('./worker-helpers.ts')
    execFileSync(process.execPath, [WORKER_BUNDLE, 'init', '--workspace', 'local:abc123', '--config', file])
    const text = readFileSync(file, 'utf8')
    assert.match(text, /"workspace": "local:abc123"/)
    assert.match(text, /\/\/ The Test stage runs this/)
    assert.throws(() => execFileSync(process.execPath, [WORKER_BUNDLE, 'init', '--config', file], { stdio: 'pipe' }), /already exists/)
    assert.ok(existsSync(file))
    writeFileSync(file, text)
  })
})
