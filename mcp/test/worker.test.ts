/**
 * The BUILT worker (public/mcp/one-worker.mjs — what people download) against a temp repo with a local bare
 * remote and the fake Claude Code CLI, driven by a fake One tab: the handshake and its refusals, a task
 * through plan → implement → test → ship, questions, cost limits, Stop, refusals of unknown repos,
 * unconfirmed team tasks and free commands — and no path or command of this machine ever reaching the tab.
 */
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, readdirSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { execFileSync } from 'node:child_process'
import { git } from '../src/worker/git.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { after, afterEach, describe, test } from 'node:test'
import { WORKER_CLOSE_REFUSED, WORKER_CLOSE_REPLACED, type GitInfo, type WorkerMessage } from '../../src/app/features/coding/protocol.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, WS_LOCAL, cleanupAll, makeRepo, repoEntry, sh, startWorker, task, tempDir, writeConfig, type StartedWorker, type TempRepo } from './worker-helpers.ts'

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

async function boot(r: TempRepo, cfg: Record<string, unknown> = {}, repo: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r, repo)], ...cfg })
  worker = await startWorker(file, env)
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
    assert.deepEqual(welcome.repos, [{ name: 'demo', baseBranch: 'main', branches: ['main'] }])
    assert.equal(welcome.claude.found, true)
    assertNoPaths(tab, r)

    // a newer tab of the same workspace takes over — and hears about a branch made since (names only)
    sh(r.path, 'branch', 'feature/picker')
    const newer = await connect()
    await newer.next('welcome')
    await waitFor(() => tab.closed !== null)
    assert.equal(tab.closed!.code, WORKER_CLOSE_REPLACED)
    await waitFor(() => newer.messages.some((m) => m.type === 'welcome' && m.repos[0]?.branches?.includes('feature/picker')))
    assertNoPaths(newer, r)
  })

  test('a repo whose git hangs (iCloud Drive) does not hold the start back: ready at once, the slow repo named', async () => {
    const r = makeRepo()
    const bin = tempDir('slowgit')
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then sleep 30; fi\nexec ${real} "$@"\n`)
    chmodSync(join(bin, 'git'), 0o755)
    const started = Date.now()
    await boot(r, {}, {}, { PATH: `${bin}:${process.env.PATH}` })
    assert.ok(Date.now() - started < 6000, `ready after ${Date.now() - started} ms`)
    const tab = await connect()
    const welcome = await tab.next('welcome')
    assert.deepEqual(welcome.repos.map((x) => x.name), ['demo'])
    await waitFor(() => /repo "demo": git is slow here/.test(worker!.stderr()), 12_000, () => worker!.stderr())
  })

  test('git gives up at its time limit even when the process does not end', async () => {
    const bin = tempDir('stuckgit')
    // a git that ignores the kill of its group: it keeps running, the worker must not wait for it
    writeFileSync(join(bin, 'git'), '#!/bin/sh\ntrap "" TERM HUP INT\nsleep 5\n')
    chmodSync(join(bin, 'git'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      const t0 = Date.now()
      const res = await git(tempDir('cwd'), ['rev-parse', '--show-toplevel'], 300)
      assert.ok(Date.now() - t0 < 2000, `waited ${Date.now() - t0} ms`)
      assert.equal(res.code, 1)
      assert.match(res.stderr, /did not finish within 0 s|did not finish within/)
    } finally {
      process.env.PATH = path
    }
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

  test('while Claude Code works: progress per turn (steps, limit, estimate) and the diff as files change; lines carry codes', async () => {
    const r = makeRepo()
    await boot(r, {}, {}, { ONE_WORKER_LIVE_GIT_MS: '150' })
    const tab = await connect()
    await tab.next('welcome')
    const done = await tab.run(task({ kind: 'implement' }, { id: 'live1abc', text: 'FAKE:LIVE' }))
    assert.equal(done.status, 'ok', JSON.stringify(done))
    const events = tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'event' }> => m.type === 'event' && m.taskId === 'live1abc')
    const progress = events.flatMap((m) => (m.kind === 'progress' ? [m.progress] : []))
    assert.ok(progress.length >= 10, JSON.stringify(progress.slice(0, 3)))
    assert.equal(progress.at(-1)!.maxTurns, 10)
    assert.equal(progress.at(-1)!.cost, 0.03)
    assert.ok(progress.some((p) => p.turns > 5 && p.turns <= 21 && p.cost !== null && p.cost > 0))
    // the live diff: live.txt reached One before Claude Code finished
    const finished = events.findIndex((m) => m.kind === 'log' && m.lines.some((l) => l.c === 'claudeDone'))
    const live = events.findIndex((m) => m.kind === 'git' && m.git.files.some((f) => f.path === 'live.txt'))
    assert.ok(live >= 0 && live < finished, `live ${live} · finished ${finished}`)
    // the worker's own lines carry a code + values (One shows them in the person's language); paths stay out
    const lines = events.flatMap((m) => (m.kind === 'log' ? m.lines : []))
    assert.deepEqual(lines.find((l) => l.c === 'stage')?.v, { stage: 'Implement', kind: 'implement', repo: 'demo' })
    assert.ok(lines.some((l) => l.c === 'branch' && l.v?.branch === done.branch))
    assert.ok(lines.some((l) => l.c === 'starting'))
    assertNoPaths(tab, r)
  })

  test('own MCP servers of a repo: their tools allowed, the strict flag left out — other repos stay strict', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    await boot(r, {}, { claude: { maxTurns: 10, mcpServers: ['atlas'] } }, { FAKE_CLAUDE_LOG: log })
    const tab = await connect()
    await tab.next('welcome')
    const plan = await tab.run(task({ kind: 'plan' }, { id: 'mcp1abcd' }))
    assert.equal(plan.status, 'ok', JSON.stringify(plan))
    const args = (JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { args: string[] }).args
    const allowed = args[args.indexOf('--allowedTools') + 1]!.split(',')
    assert.ok(allowed.includes('mcp__atlas'), allowed.join(','))
    assert.ok(allowed.some((a) => a.startsWith('mcp__one-task')), allowed.join(','))
    assert.ok(!args.includes('--strict-mcp-config'))
    assert.ok(args.includes('--mcp-config'))
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

describe('documents, tasks without a repository, imports', () => {
  const lastArgs = (log: string) => JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { args: string[]; cwd: string }
  const listOf = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1]!.split(',') : [])

  test('a document stage reads only: no worktree, no branch, Edit / Write / Bash denied — the last message is the document', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    await boot(r, {}, {}, { FAKE_CLAUDE_LOG: log })
    const tab = await connect()
    await tab.next('welcome')
    const doc = await tab.run(task({ kind: 'doc', name: 'Analysis', permissionMode: 'default' }, { id: 'doc1abcd' }))
    assert.equal(doc.status, 'ok', JSON.stringify(doc))
    assert.match(doc.plan!, /^## Analysis/)
    assert.equal(doc.branch, undefined)
    const { args, cwd } = lastArgs(log)
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'default')
    for (const t of ['Read', 'Grep', 'Glob']) assert.ok(listOf(args, '--allowedTools').includes(t), t)
    for (const t of ['Edit', 'Write', 'Bash', 'MultiEdit']) assert.ok(listOf(args, '--disallowedTools').includes(t), t)
    assert.equal(realpathSync(cwd), realpathSync(r.path), 'in the main checkout, read only')
    assert.ok(!existsSync(r.worktrees) || readdirSync(r.worktrees).length === 0, 'no worktree')
    assertNoPaths(tab, r)
  })

  test('a task without a repository: document stages run in the scratch folder with the worker\'s own MCP servers; other stages are refused', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    await boot(r, { mcpServers: ['atlas'] }, {}, { FAKE_CLAUDE_LOG: log })
    const tab = await connect()
    await tab.next('welcome')
    const doc = await tab.run(task({ kind: 'doc', name: 'Analysis', permissionMode: 'default' }, { id: 'scr1abcd', repo: '' }))
    assert.equal(doc.status, 'ok', JSON.stringify(doc))
    assert.match(doc.plan!, /Working folder: scr1abcd/)
    const { args, cwd } = lastArgs(log)
    assert.match(cwd, /[\\/]scratch[\\/]scr1abcd$/)
    assert.ok(listOf(args, '--allowedTools').includes('mcp__atlas'))
    const code = await tab.run(task({ kind: 'implement' }, { id: 'scr2abcd', repo: '' }))
    assert.equal(code.status, 'refused')
    assert.match(code.error!, /needs a repository/)
  })

  test('plan mode: the task tools are read-only for Claude Code (it may ask there); without ExitPlanMode the plan file is the plan', async () => {
    const r = makeRepo()
    const home = tempDir('home')
    await boot(r, {}, {}, { HOME: home })
    const tab = await connect()
    await tab.next('welcome')
    const plan = await tab.run(task({ kind: 'plan' }, { id: 'pf1abcde', text: 'Goal. FAKE:PLANFILE FAKE:TOOLS' }))
    assert.equal(plan.status, 'ok', JSON.stringify(plan))
    assert.match(plan.plan!, /^## Plan from the file/)
    assert.match(plan.plan!, /one_task_ask:ro/)
    assert.match(plan.plan!, /one_task_note:ro/)
    assert.match(plan.plan!, /one_task_read:ro/)
  })

  test('import: a ZIP from the task panel becomes a new repo in the clone folder, joins worker.json and is announced', async () => {
    const r = makeRepo()
    const clones = tempDir('clones')
    const file = await boot(r, { cloneDir: clones })
    const tab = await connect()
    await tab.next('welcome')
    const zip = Buffer.from(zipSync({ 'legacy/package.json': strToU8(JSON.stringify({ name: 'billing-core' })), 'legacy/src/app.js': strToU8('console.log(1)\n'), 'legacy/.git/config': strToU8('[core]\n') }))
    // refused: not a zip, more bytes than announced
    assert.equal((await tab.request({ op: 'intake-begin', taskId: 'imp1abcd', name: 'legacy.txt', size: 10 })).ok, false)
    const bad = await tab.request({ op: 'intake-begin', taskId: 'imp1abcd', name: 'legacy.zip', size: 4 })
    assert.equal(bad.ok, true)
    const over = await tab.request({ op: 'intake-chunk', uploadId: (bad as { result: { uploadId: string } }).result.uploadId, data: zip.subarray(0, 64).toString('base64') })
    assert.equal(over.ok, false)
    await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'intake' && m.intake.state === 'failed'))

    const begin = await tab.request({ op: 'intake-begin', taskId: 'imp1abcd', name: 'legacy.zip', size: zip.length })
    assert.equal(begin.ok, true, JSON.stringify(begin))
    const { uploadId, chunk } = (begin as { result: { uploadId: string; chunk: number } }).result
    assert.ok(chunk > 0)
    for (let off = 0; off < zip.length; off += 100) assert.equal((await tab.request({ op: 'intake-chunk', uploadId, data: zip.subarray(off, off + 100).toString('base64') })).ok, true)
    assert.equal((await tab.request({ op: 'intake-end', uploadId })).ok, true)
    await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'intake' && m.intake.state === 'done'), 15_000, () => worker!.stderr())
    const done = tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'event'; kind: 'intake' }> => m.type === 'event' && m.kind === 'intake').at(-1)!
    assert.equal(done.taskId, 'imp1abcd')
    assert.equal(done.intake.repo, 'legacy')
    assert.equal(done.intake.suggest, 'billing-core')
    assert.ok(existsSync(join(clones, 'legacy', 'src', 'app.js')))
    assert.ok(!existsSync(join(clones, 'legacy', '.git', 'config')) || !readFileSync(join(clones, 'legacy', '.git', 'config'), 'utf8').startsWith('[core]\n\n'), 'the ZIP\'s own .git stays out')
    assert.match(readFileSync(file, 'utf8'), /"name": "legacy"/)
    await waitFor(() => tab.messages.some((m) => m.type === 'welcome' && m.repos.some((x) => x.name === 'legacy')), 10_000)
    assertNoPaths(tab, r)
    assert.ok(!tab.raw.join('\n').includes(clones), 'the clone folder never reaches the tab')
  })

  test('import: a clone address; "intake": false refuses imports from One', async () => {
    const r = makeRepo()
    const clones = tempDir('clones')
    await boot(r, { cloneDir: clones }, {}, { ONE_WORKER_CLONE_LOCAL: '1' })
    const tab = await connect()
    await tab.next('welcome')
    const res = await tab.request({ op: 'intake-clone', taskId: 'cln1abcd', url: r.remote })
    assert.equal(res.ok, true, JSON.stringify(res))
    await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'intake' && m.intake.state !== 'running'), 20_000, () => worker!.stderr())
    const ev = tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'event'; kind: 'intake' }> => m.type === 'event' && m.kind === 'intake').at(-1)!
    assert.equal(ev.intake.state, 'done', JSON.stringify(ev))
    assert.ok(ev.intake.repo)
    await worker!.stop()
    worker = null
    const r2 = makeRepo()
    await boot(r2, { cloneDir: clones, intake: false })
    const tab2 = await connect()
    await tab2.next('welcome')
    const off = await tab2.request({ op: 'intake-clone', taskId: 'cln2abcd', url: r2.remote })
    assert.equal(off.ok, false)
    assert.match((off as { error: string }).error, /does not take imports/)
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
