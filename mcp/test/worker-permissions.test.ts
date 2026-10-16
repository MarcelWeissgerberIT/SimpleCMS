/**
 * worker 1.11.0 — the BUILT worker with the fake Claude Code CLI, driven by a fake One tab:
 *  - a stage ends when Claude Code ends: a program it left running (holding its output open) neither keeps the stage
 *    open nor survives it; no "still working" line after the result
 *  - permissions: Claude Code asks through the task tools (--permission-prompt-tool → one_task_permission); the repo's
 *    own lists decide first, else the person answers in One with a verb (once · always · deny) — "always" is stored by
 *    the worker in worker.json; a request nobody answers is refused at the time limit; an older CLI cannot ask (its own
 *    refusal gets a line of its own); the counts go into the outcome
 *  - the task's scratch folder (--add-dir, named in the prompt, never sent to One, removed with the branch)
 *  - the step limit: the outcome says so; a run with `resume` goes on from the worktree
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { cleanAsk, type LogLine, type PermissionAsk, type WorkerMessage } from '../../src/app/features/coding/protocol.ts'
import { parseJsonc } from '../src/worker/config.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, WS_LOCAL, cleanupAll, leakIn, makeRepo, repoEntry, startWorker, task, tempDir, writeConfig, type StartedWorker, type TempRepo } from './worker-helpers.ts'

const PORT = 47395
let worker: StartedWorker | null = null
const tabs: FakeTab[] = []

afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})
after(cleanupAll)

async function boot(r: TempRepo, repo: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<string> {
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r, repo)] })
  worker = await startWorker(file, env)
  assert.match(worker.stderr(), /ready on ws:\/\/127\.0\.0\.1:47395/)
  return file
}

async function connect(): Promise<FakeTab> {
  const tab = await FakeTab.connect(PORT)
  tabs.push(tab)
  tab.hello(WS_LOCAL)
  await tab.next('welcome')
  return tab
}

const events = (tab: FakeTab, taskId: string) => tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'event' }> => m.type === 'event' && m.taskId === taskId)
const logOf = (tab: FakeTab, taskId: string): LogLine[] => events(tab, taskId).flatMap((m) => (m.kind === 'log' ? m.lines : []))
const asksOf = (tab: FakeTab, taskId: string): PermissionAsk[] => events(tab, taskId).flatMap((m) => (m.kind === 'permission' && m.ask ? [m.ask] : []))

/** Nothing of this computer's paths (the repo, its worktrees, the config's folder with the scratch folders, home). */
function assertNoPaths(tab: FakeTab, r: TempRepo, file: string) {
  const leak = leakIn(tab.raw.join('\n'), [r.path, r.worktrees, r.dir, dirname(file), homedir(), process.execPath], ['fake-claude'])
  assert.equal(leak, null, `the tab received ${leak}`)
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('a stage ends when Claude Code ends', () => {
  test('a dev server Claude Code left running holds its output open: the stage still ends within seconds, the server is ended and named, no "still working" after the result', async () => {
    const r = makeRepo()
    const pids = join(r.dir, 'leftover.pids')
    await boot(r, {}, { FAKE_CLAUDE_PIDS: pids, ONE_WORKER_QUIET_MS: '200' })
    const tab = await connect()
    const t0 = Date.now()
    const done = await tab.run(task({ kind: 'implement' }, { id: 'left1abc', text: 'FAKE:LEFTOVER' }), 30_000)
    assert.equal(done.status, 'ok', JSON.stringify(done))
    assert.ok(Date.now() - t0 < 15_000, `ended after ${Date.now() - t0} ms`)
    const pid = Number(readFileSync(pids, 'utf8').trim())
    await waitFor(() => !alive(pid), 8000, () => `the program ${pid} still runs`)
    const lines = logOf(tab, 'left1abc')
    const result = lines.findIndex((l) => l.c === 'claudeDone')
    assert.ok(result >= 0, JSON.stringify(lines.map((l) => l.c)))
    assert.ok(!lines.slice(result).some((l) => l.c === 'stillWorking'), 'no sign of life after the result')
    const left = lines.find((l) => l.c === 'claudeLeftovers')
    assert.ok(left, JSON.stringify(lines.map((l) => l.c)))
    assert.equal(left!.v?.n, 1)
    assert.match(String(left!.v?.names), /^node$/)
    // One's busy list is empty again (the status that follows One's answer to `finish`): the JETZT bar has nothing to show
    const last = () => [...tab.messages].reverse().find((m) => m.type === 'status') as Extract<WorkerMessage, { type: 'status' }> | undefined
    await waitFor(() => last()?.busy.length === 0, 5000, () => `busy: ${JSON.stringify(last()?.busy)}`)
  })

  test('a program that outlives Claude Code at once (an orphan in its own session): ended all the same (Linux / Windows; macOS by its environment mark)', async () => {
    const r = makeRepo()
    const pids = join(r.dir, 'orphan.pids')
    await boot(r, {}, { FAKE_CLAUDE_PIDS: pids })
    const tab = await connect()
    const t0 = Date.now()
    const done = await tab.run(task({ kind: 'implement' }, { id: 'left2abc', text: 'FAKE:LEFTOVER FAKE:LEFTOVERNOW' }), 30_000)
    assert.equal(done.status, 'ok', JSON.stringify(done))
    assert.ok(Date.now() - t0 < 15_000, `ended after ${Date.now() - t0} ms`)
    const pid = Number(readFileSync(pids, 'utf8').trim())
    await waitFor(() => !alive(pid), 8000, () => `the program ${pid} still runs`)
  })
})

/** The person's answer in One: the request's id and a verb — what the worker answers (its `result`, or its error). */
async function answer(tab: FakeTab, taskId: string, ask: string, verb: string): Promise<unknown> {
  const res = await tab.request({ op: 'permission', taskId, ask, verb })
  return res.ok ? res.result : { error: res.error }
}

const repoJson = (file: string) => (parseJsonc(readFileSync(file, 'utf8')) as { repos: Array<{ claude?: { allowedTools?: string[] } }> }).repos[0]!

describe('permissions: the repo\'s rules, else the person in One', () => {
  test('"Always for this repo": the worker holds the call, One gets the request (event + busy), answers with a verb; the rule lands in worker.json and decides the next run without asking', async () => {
    const r = makeRepo()
    const file = await boot(r)
    const tab = await connect()
    const run = tab.run(task({ kind: 'implement' }, { id: 'perm1abc', text: 'FAKE:PERMIT[npm run lint]' }), 30_000)
    await waitFor(() => asksOf(tab, 'perm1abc').length > 0, 15_000, () => JSON.stringify(tab.messages.slice(-4)))
    const ask = asksOf(tab, 'perm1abc')[0]!
    assert.deepEqual(cleanAsk(ask), ask, 'the request passes the shared rule')
    assert.deepEqual([ask.tool, ask.kind, ask.what, ask.rule, ask.repo], ['Bash', 'bash', 'npm run lint', 'Bash(npm run lint:*)', 'demo'])
    assert.ok(ask.until > ask.at)
    // a tab that connects now sees it too: the busy list carries it
    const status = [...tab.messages].reverse().find((m) => m.type === 'status') as Extract<WorkerMessage, { type: 'status' }>
    assert.equal(status.busy[0]?.ask?.id, ask.id)
    // a wrong id is no answer; a verb outside the three is refused
    assert.deepEqual(await answer(tab, 'perm1abc', 'f'.repeat(24), 'once'), { ok: false, gone: true })
    assert.match(String((await answer(tab, 'perm1abc', ask.id, 'yes please') as { error?: string }).error), /unknown answer/)
    assert.deepEqual(await answer(tab, 'perm1abc', ask.id, 'always'), { ok: true })
    const done = await run
    assert.equal(done.status, 'ok', JSON.stringify(done))
    assert.equal(done.summary, 'Permission: allowed')
    assert.deepEqual(done.permissions, { asked: 1, allowed: 1, refused: 0 })
    assert.ok(done.git?.files.some((f) => f.path === 'permitted.txt'), 'the command ran')
    // the worker wrote the rule it showed — One sent only the verb
    assert.deepEqual(repoJson(file).claude?.allowedTools, ['Bash(npm run lint:*)'])
    const lines = logOf(tab, 'perm1abc')
    assert.deepEqual(lines.find((l) => l.c === 'permissionAsked')?.v, { tool: 'Bash', what: 'npm run lint', min: 15 })
    assert.equal(lines.find((l) => l.c === 'permissionAllowed')?.v?.how, 'always')
    assert.deepEqual(lines.find((l) => l.c === 'permissionAlways')?.v, { rule: 'Bash(npm run lint:*)', repo: 'demo' })
    assert.deepEqual(lines.find((l) => l.c === 'permissionSummary')?.v, { asked: 1, allowed: 1, refused: 0 })
    // the request is gone: One hears "none any more" and how it ended
    const last = events(tab, 'perm1abc').filter((m) => m.kind === 'permission').at(-1) as Extract<WorkerMessage, { kind: 'permission' }>
    assert.deepEqual([last.ask, last.settled], [null, { id: ask.id, how: 'always' }])
    // an answer after the end: gone
    assert.deepEqual(await answer(tab, 'perm1abc', ask.id, 'once'), { ok: false, gone: true })

    // the next run: the repo's rule decides, nobody is asked
    const again = await tab.run(task({ kind: 'implement' }, { id: 'perm2abc', text: 'FAKE:PERMIT[npm run lint]' }), 30_000)
    assert.equal(again.summary, 'Permission: allowed')
    assert.equal(asksOf(tab, 'perm2abc').length, 0)
    assert.deepEqual(again.permissions, { asked: 0, allowed: 1, refused: 0 })
    assert.equal(logOf(tab, 'perm2abc').find((l) => l.c === 'permissionAllowed')?.v?.how, 'rule')
    assertNoPaths(tab, r, file)
  })

  test('refused by the person: Claude Code hears "Not allowed", the count says so; a command that would open too much gets no "Always" — only once', async () => {
    const r = makeRepo()
    const file = await boot(r)
    const tab = await connect()
    const run = tab.run(task({ kind: 'implement' }, { id: 'perm3abc', text: "FAKE:PERMIT[sed -i s/a/b/ README.md]" }), 30_000)
    await waitFor(() => asksOf(tab, 'perm3abc').length > 0, 15_000)
    const ask = asksOf(tab, 'perm3abc')[0]!
    assert.equal(ask.rule, null, 'sed rewrites files: never "always"')
    assert.deepEqual(await answer(tab, 'perm3abc', ask.id, 'deny'), { ok: true })
    const done = await run
    assert.equal(done.summary, 'Permission: denied')
    assert.deepEqual(done.permissions, { asked: 1, allowed: 0, refused: 1 })
    assert.equal(logOf(tab, 'perm3abc').find((l) => l.c === 'permissionDenied')?.v?.how, 'you')
    // the denial is the worker's own line — Claude Code's tool error ("Not allowed: …") is not logged twice
    assert.ok(!logOf(tab, 'perm3abc').some((l) => /tool error: Not allowed/.test(l.s)))
    assert.equal(repoJson(file).claude?.allowedTools, undefined)

    // "Always" for a request without a rule: allowed once, nothing stored
    const run2 = tab.run(task({ kind: 'implement' }, { id: 'perm4abc', text: 'FAKE:PERMIT[rm -rf build]' }), 30_000)
    await waitFor(() => asksOf(tab, 'perm4abc').length > 0, 15_000)
    const ask2 = asksOf(tab, 'perm4abc')[0]!
    assert.equal(ask2.rule, null)
    assert.deepEqual(await answer(tab, 'perm4abc', ask2.id, 'always'), { ok: true })
    const done2 = await run2
    assert.equal(done2.summary, 'Permission: allowed')
    assert.equal(logOf(tab, 'perm4abc').find((l) => l.c === 'permissionAllowed')?.v?.how, 'once')
    assert.equal(repoJson(file).claude?.allowedTools, undefined, 'nothing stored for a request without a rule')
  })

  test('the repo\'s disallowedTools refuse without asking; a read outside the repo waits — nobody answers: refused at the time limit', async () => {
    const r = makeRepo()
    const outside = join(tempDir('outside'), 'out.txt')
    await boot(r, { claude: { maxTurns: 10, disallowedTools: ['Bash(rm:*)'] } }, { ONE_WORKER_PERMISSION_MS: '1500' })
    const tab = await connect()
    const rm = await tab.run(task({ kind: 'implement' }, { id: 'perm5abc', text: 'FAKE:PERMIT[npm test && rm -rf build]' }), 30_000)
    assert.equal(rm.summary, 'Permission: denied')
    assert.equal(asksOf(tab, 'perm5abc').length, 0, 'nobody was asked')
    assert.equal(logOf(tab, 'perm5abc').find((l) => l.c === 'permissionDenied')?.v?.how, 'rule')
    assert.deepEqual(rm.permissions, { asked: 0, allowed: 0, refused: 1 })

    const read = await tab.run(task({ kind: 'implement' }, { id: 'perm6abc', text: `FAKE:PERMITREAD[${outside}]` }), 30_000)
    assert.equal(read.summary, 'Permission: denied')
    const ask = asksOf(tab, 'perm6abc')[0]!
    assert.deepEqual([ask.kind, ask.outside, ask.rule], ['read', true, null])
    assert.ok(!ask.what.includes(dirname(outside)), 'the path is scrubbed')
    assert.equal(logOf(tab, 'perm6abc').find((l) => l.c === 'permissionDenied')?.v?.how, 'timeout')
    const settled = events(tab, 'perm6abc').filter((m) => m.kind === 'permission').at(-1) as Extract<WorkerMessage, { kind: 'permission' }>
    assert.deepEqual(settled.settled, { id: ask.id, how: 'timeout' })
  })

  test('Stop while a request waits: refused at once, the stage stops', async () => {
    const r = makeRepo()
    await boot(r)
    const tab = await connect()
    const run = tab.run(task({ kind: 'implement' }, { id: 'perm7abc', text: 'FAKE:PERMIT[npm run build]' }), 30_000)
    await waitFor(() => asksOf(tab, 'perm7abc').length > 0, 15_000)
    await tab.request({ op: 'stop', taskId: 'perm7abc' })
    const done = await run
    assert.equal(done.status, 'stopped')
    assert.equal(logOf(tab, 'perm7abc').find((l) => l.c === 'permissionDenied')?.v?.how, 'stopped')
  })

  test('an older Claude Code cannot ask (no --permission-prompt-tool, no --add-dir): one line each, its own refusal gets the permissionNeeded line and counts', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    await boot(r, {}, { FAKE_CLAUDE_OLD: '1', FAKE_CLAUDE_LOG: log })
    const tab = await connect()
    const done = await tab.run(task({ kind: 'implement' }, { id: 'perm8abc', text: 'FAKE:PERMIT[npm run lint]' }), 30_000)
    assert.equal(done.summary, 'Permission: unavailable')
    const args = (JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { args: string[] }).args
    assert.ok(!args.includes('--permission-prompt-tool') && !args.includes('--add-dir'), args.join(' '))
    const lines = logOf(tab, 'perm8abc')
    assert.equal(lines.filter((l) => l.c === 'permissionOff').length, 1)
    assert.equal(lines.filter((l) => l.c === 'addDirOff').length, 1)
    assert.deepEqual(lines.find((l) => l.c === 'permissionNeeded')?.v, { tool: 'Bash' })
    assert.ok(!lines.some((l) => /requires approval/.test(l.s) && !l.c), 'no raw tool error line')
    assert.deepEqual(done.permissions, { asked: 0, allowed: 0, refused: 1 })
  })
})

describe('the task\'s scratch folder and the step limit', () => {
  test('scratch: --add-dir with the task\'s folder, named in the prompt (never to One); Discard removes it with the worktree', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    const file = await boot(r, {}, { FAKE_CLAUDE_LOG: log })
    const tab = await connect()
    const done = await tab.run(task({ kind: 'implement' }, { id: 'scr1abcd', text: 'FAKE:SCRATCH' }), 30_000)
    assert.equal(done.summary, 'Scratch: given · named in the prompt: yes')
    const scratch = join(dirname(file), 'scratch', 'scr1abcd')
    assert.ok(existsSync(join(scratch, 'note.txt')))
    const args = (JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { args: string[] }).args
    assert.equal(args[args.indexOf('--add-dir') + 1], scratch)
    assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'mcp__one-task__one_task_permission')
    assert.ok(!args.some((a) => /dangerously|bypass/i.test(a)))
    assertNoPaths(tab, r, file)
    const res = await tab.request({ op: 'git', taskId: 'scr1abcd', verb: 'discard', repo: 'demo', branch: done.branch, title: 'x' })
    assert.equal(res.ok, true, JSON.stringify(res))
    await waitFor(() => !existsSync(scratch), 10_000)
  })

  test('the step limit: the outcome says where it stopped; a run with `resume` tells Claude Code to go on from the worktree', async () => {
    const r = makeRepo()
    await boot(r, { claude: { maxTurns: 3 } })
    const tab = await connect()
    const first = await tab.run(task({ kind: 'implement', maxTurns: 3 }, { id: 'max1abcd', text: 'FAKE:MAXTURNS' }), 30_000)
    assert.equal(first.status, 'failed')
    assert.deepEqual(first.stepLimit, { turns: 3, max: 3 })
    assert.deepEqual(logOf(tab, 'max1abcd').find((l) => l.c === 'stepLimit')?.v, { turns: 3, max: 3 })
    const next = await tab.run(task({ kind: 'implement', maxTurns: 3 }, { id: 'max1abcd', text: 'FAKE:MAXTURNS', branch: first.branch!, resume: { turns: 3, max: 3 } }), 30_000)
    assert.equal(next.status, 'ok', JSON.stringify(next))
    assert.equal(next.stepLimit, undefined)
    assert.match(next.summary!, /Continued from the worktree/)
    assert.deepEqual(logOf(tab, 'max1abcd').find((l) => l.c === 'continueRun')?.v, { turns: 3, max: 3 })
  })
})
