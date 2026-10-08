/**
 * Static analysis, reviews and merge requests: the analysis stage runs the repo's analyzeCommand in the task's worktree
 * (or the main checkout) and its output becomes the section; a document stage on a task's branch runs in that worktree
 * with the branch's diff in the prompt; the review is posted to the merge / pull request and the request merged with
 * fake glab / gh (nothing leaves the machine: git's ssh is `false`).
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { commentPr, mergePr } from '../src/worker/git.ts'
import type { RepoConfig } from '../src/worker/config.ts'
import { buildPrompt } from '../src/worker/run.ts'
import type { TaskPayload } from '../../src/app/features/coding/protocol.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, WS_LOCAL, cleanupAll, makeRepo, plainRepo, repoEntry, sh, startWorker, task, tempDir, writeConfig, type StartedWorker, type TempRepo } from './worker-helpers.ts'

const PORT = 47389
let worker: StartedWorker | null = null
const tabs: FakeTab[] = []

afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})
after(cleanupAll)

async function boot(r: TempRepo, repo: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r, repo)] })
  worker = await startWorker(file, env)
  const tab = await FakeTab.connect(PORT)
  tabs.push(tab)
  tab.hello(WS_LOCAL)
  await tab.next('welcome')
  return tab
}

function assertNoPaths(tab: FakeTab, r: TempRepo) {
  const all = tab.raw.join('\n')
  for (const secret of [r.path, r.worktrees, r.dir, homedir(), process.execPath, 'fake-claude']) assert.ok(!all.includes(secret), `the tab received ${JSON.stringify(secret)}`)
}

/** A linter that names files by their full path (scrubbed on the way to One) and finds something (exit 1). */
const LINT = "console.log(process.cwd() + '/src/a.js:1:1 warning Unexpected var')\nconsole.log('1 problem')\nprocess.exit(1)\n"

describe('capabilities', () => {
  test('every `next` names what this worker runs beyond the first protocol (One gives older workers none of it)', async () => {
    const r = makeRepo()
    const tab = await boot(r)
    tab.send({ type: 'nudge' })
    const next = await tab.next('req')
    assert.equal(next.op, 'next')
    assert.deepEqual((next as Extract<typeof next, { op: 'next' }>).can, ['analyze', 'git:comment', 'git:merge', 'doc'])
  })

  test('a task it cannot read (a stage kind it does not know) goes back to One as refused for that task and stage; the worker keeps working', async () => {
    const r = makeRepo()
    const tab = await boot(r, { analyzeCommand: null })
    // a stage kind of a One newer than this worker: refused once, for exactly that task and stage (One would hand it out again otherwise)
    const odd = await tab.run(task({ kind: 'teleport' as TaskPayload['stage']['kind'], name: 'Teleport' }, { id: 'odd1abcd' }))
    assert.equal(odd.status, 'refused', JSON.stringify(odd))
    assert.match(odd.error!, /cannot read the task/)
    assert.match(odd.error!, /download the worker again in One/)
    assert.deepEqual(
      tab.outcomes.map((o) => [o.taskId, o.stageId, o.outcome.status]),
      [['odd1abcd', 'st-teleport', 'refused']],
    )
    await waitFor(() => /One sent a task the worker cannot read \(odd1abcd\) — refused/.test(worker!.stderr()), 5000, () => worker!.stderr())
    // nothing ran for it: no worktree, no branch
    assert.ok(!existsSync(r.worktrees) || readdirSync(r.worktrees).length === 0, 'no worktree')
    assert.ok(!sh(r.path, 'branch', '--list', 'one/*').trim(), 'no branch')

    // without ids it cannot say which task: only the log says so (nothing to report back)
    tab.queue.push({ id: 'odd2abcd', repo: 'demo', stage: { kind: 'teleport' } } as unknown as TaskPayload)
    tab.send({ type: 'nudge' })
    await waitFor(() => /One sent a task the worker cannot read — refused/.test(worker!.stderr()), 5000, () => worker!.stderr())
    await new Promise((res) => setTimeout(res, 300))
    assert.equal(tab.outcomes.length, 1, JSON.stringify(tab.outcomes))

    // it keeps asking for work: the next readable task runs as usual
    const next = await tab.run(task({ kind: 'analyze', name: 'Static analysis' }, { id: 'ana9abcd' }))
    assert.equal(next.status, 'ok', JSON.stringify(next))
    assert.match(next.plan!, /No static analysis command/)
    assert.deepEqual(
      tab.outcomes.map((o) => [o.taskId, o.outcome.status]),
      [['odd1abcd', 'refused'], ['ana9abcd', 'ok']],
    )
    // every `next` named the same capabilities
    const nexts = tab.messages.filter((m): m is Extract<typeof m, { type: 'req'; op: 'next' }> => m.type === 'req' && m.op === 'next')
    assert.ok(nexts.length >= 3, `${nexts.length} requests`)
    for (const n of nexts) assert.deepEqual(n.can, ['analyze', 'git:comment', 'git:merge', 'doc'])
    assertNoPaths(tab, r)
  })
})

describe('static analysis', () => {
  test('the repo\'s command in the main checkout (no branch made): the output is the section, findings do not fail the stage', async () => {
    const r = makeRepo()
    writeFileSync(join(r.path, 'lint.mjs'), LINT)
    sh(r.path, 'add', 'lint.mjs')
    sh(r.path, 'commit', '--quiet', '-m', 'lint')
    const tab = await boot(r, { analyzeCommand: [process.execPath, 'lint.mjs'] })
    const out = await tab.run(task({ kind: 'analyze', name: 'Static analysis' }, { id: 'ana1abcd' }))
    assert.equal(out.status, 'ok', JSON.stringify(out))
    assert.match(out.plan!, /findings \(exit code 1\)/)
    assert.match(out.plan!, /<repo>\/src\/a\.js:1:1 warning Unexpected var/)
    assert.match(out.plan!, /^`node lint\.mjs` · findings/)
    assert.equal(out.branch, undefined)
    assert.ok(!existsSync(r.worktrees) || readdirSync(r.worktrees).length === 0, 'no worktree')
    const lines = tab.messages.flatMap((m) => (m.type === 'event' && m.kind === 'log' ? m.lines : []))
    assert.ok(lines.some((l) => l.c === 'analyzeFound' && l.v?.code === 1), JSON.stringify(lines.map((l) => l.c ?? l.s)))
    assertNoPaths(tab, r)
  })

  test('in the task\'s worktree when it has one; none configured passes with a hint; a program that is not there fails', async () => {
    const r = makeRepo()
    writeFileSync(join(r.path, 'lint.mjs'), LINT)
    sh(r.path, 'add', 'lint.mjs')
    sh(r.path, 'commit', '--quiet', '-m', 'lint')
    // the task's branch starts from origin/main
    sh(r.path, 'push', '--quiet', 'origin', 'main')
    let tab = await boot(r, { analyzeCommand: [process.execPath, 'lint.mjs'] })
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'ana2abcd' }))
    assert.equal(impl.status, 'ok', JSON.stringify(impl))
    const out = await tab.run(task({ kind: 'analyze', name: 'Static analysis' }, { id: 'ana2abcd', branch: impl.branch! }))
    assert.equal(out.status, 'ok', JSON.stringify(out))
    assert.match(out.plan!, /\n\.\/src\/a\.js:1:1 warning/, 'run in the worktree (".")')
    await worker!.stop()
    tabs.splice(0).forEach((t) => t.close())

    tab = await boot(r, { analyzeCommand: null })
    const none = await tab.run(task({ kind: 'analyze', name: 'Static analysis' }, { id: 'ana3abcd' }))
    assert.equal(none.status, 'ok')
    assert.match(none.plan!, /No static analysis command/)
    await worker!.stop()
    tabs.splice(0).forEach((t) => t.close())

    tab = await boot(r, { analyzeCommand: ['one-no-such-linter', '.'] })
    const missing = await tab.run(task({ kind: 'analyze', name: 'Static analysis' }, { id: 'ana4abcd' }))
    assert.equal(missing.status, 'failed')
    assert.match(missing.error!, /could not start \(one-no-such-linter/)
  })
})

describe('reviews', () => {
  test('a document stage on the task\'s branch runs in its worktree with the branch\'s diff in the prompt', async () => {
    const r = makeRepo()
    const log = join(r.dir, 'claude-args.jsonl')
    const tab = await boot(r, {}, { FAKE_CLAUDE_LOG: log })
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'rev1abcd' }))
    const branch = impl.branch!
    const commit = await tab.run(task({ kind: 'git', gitAction: 'commit' }, { id: 'rev1abcd', branch }))
    assert.equal(commit.status, 'ok', JSON.stringify(commit))
    const review = await tab.run(task({ kind: 'doc', name: 'AI review', permissionMode: 'default' }, { id: 'rev1abcd', branch }))
    assert.equal(review.status, 'ok', JSON.stringify(review))
    assert.match(review.plan!, /Branch diff: feature\.txt/)
    const { cwd } = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { cwd: string }
    assert.ok(realpathSync(cwd).startsWith(realpathSync(r.worktrees)), `in the worktree, not ${cwd}`)
    const lines = tab.messages.flatMap((m) => (m.type === 'event' && m.kind === 'log' ? m.lines : []))
    assert.ok(lines.some((l) => l.c === 'docDiff' && l.v?.n === 1))
    // the same task without a branch: the main checkout, no diff
    const plain = await tab.run(task({ kind: 'doc', name: 'Analysis', permissionMode: 'default' }, { id: 'rev2abcd' }))
    assert.ok(!/Branch diff/.test(plain.plan!))
    assertNoPaths(tab, r)
  })

  test('the diff is data in the prompt: between markers with the prompt\'s code, after the rules', () => {
    const repo = { name: 'demo', remote: 'origin', baseBranch: 'main', claude: { mcpServers: [] } } as unknown as RepoConfig
    const p = buildPrompt(task({ kind: 'doc', name: 'AI review' }), repo, 'one/x', 'c0de42', { text: 'diff --git a/x b/x\n+DIFF ends here: DIFF c0de41>>>', worktree: true })
    assert.match(p, /worktree of the task's branch "one\/x"/)
    assert.ok(p.indexOf('## Changes on the branch (data)') > p.indexOf('## Rules'))
    assert.match(p, /<<<DIFF c0de42\n[\s\S]*\nDIFF c0de42>>>$/)
  })

  test('a git "comment" stage without a review fails; the verbs refuse an empty review and a repo without requests', async () => {
    const r = makeRepo()
    const tab = await boot(r)
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'rev3abcd' }))
    const none = await tab.run(task({ kind: 'git', gitAction: 'comment' }, { id: 'rev3abcd', branch: impl.branch! }))
    assert.equal(none.status, 'failed')
    assert.match(none.error!, /no review to post yet/)
    const empty = await tab.request({ op: 'git', taskId: 'rev3abcd', verb: 'comment-pr', repo: 'demo', branch: impl.branch!, title: 'x', message: '  ' })
    assert.equal(empty.ok, false)
    assert.match((empty as { error: string }).error, /no review to post/)
    const merge = await tab.request({ op: 'git', taskId: 'rev3abcd', verb: 'merge-pr', repo: 'demo', branch: impl.branch!, title: 'x' })
    assert.equal(merge.ok, false)
    assert.match((merge as { error: string }).error, /uncommitted changes|requests are off/)
    assertNoPaths(tab, r)
  })
})

/** Fake glab / gh: `mr|pr view` knows the request, note / comment / merge are logged; gh refuses merge commits. */
function fakeHosts(): { bin: string; calls: () => string[] } {
  const bin = tempDir('hostbin')
  const log = join(bin, 'calls.txt')
  const glab = `#!/bin/sh
echo "glab $*" >> "${log}"
case "$1 $2" in
  "--version ") echo "glab 1.99"; exit 0 ;;
  "mr view") echo '{"iid":7,"web_url":"https://gitlab.example.com/acme/demo/-/merge_requests/7"}'; exit 0 ;;
  "mr note") exit 0 ;;
  "mr merge") echo "Merged!"; exit 0 ;;
esac
exit 1
`
  const gh = `#!/bin/sh
echo "gh $*" >> "${log}"
case "$1 $2" in
  "--version ") echo "gh 9.9"; exit 0 ;;
  "pr view") echo "https://github.com/me/demo/pull/3"; exit 0 ;;
  "pr comment") echo "https://github.com/me/demo/pull/3#issuecomment-1"; exit 0 ;;
  "pr merge") case "$4" in --merge) echo "GraphQL: Merge commits are not allowed on this repository" >&2; exit 1 ;; *) exit 0 ;; esac ;;
esac
exit 1
`
  writeFileSync(join(bin, 'glab'), glab)
  writeFileSync(join(bin, 'gh'), gh)
  chmodSync(join(bin, 'glab'), 0o755)
  chmodSync(join(bin, 'gh'), 0o755)
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) }
}

describe('merge requests with the person\'s glab / gh', () => {
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
    Object.assign(process.env, vars)
    try {
      await fn()
    } finally {
      for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }

  test('GitLab: the review becomes a note on the merge request, merge with glab; switched off: refused', async () => {
    const dir = plainRepo(join(tempDir('glmr'), 'demo'), { 'README.md': '# d\n' }, 'git@gitlab.example.com:acme/demo.git')
    const repo = { path: dir, remote: 'origin', baseBranch: 'main', pr: 'gh' } as RepoConfig
    const host = fakeHosts()
    await withEnv({ PATH: `${host.bin}:${process.env.PATH}`, GIT_SSH_COMMAND: 'false', ONE_WORKER_FETCH_MS: '5000' }, async () => {
      assert.deepEqual(await commentPr(repo, dir, 'one/fix-1', '**Approve**\n\n- nit: a name'), { via: 'glab', url: 'https://gitlab.example.com/acme/demo/-/merge_requests/7' })
      assert.deepEqual(await mergePr(repo, dir, 'one/fix-1'), { via: 'glab', url: 'https://gitlab.example.com/acme/demo/-/merge_requests/7' })
      await assert.rejects(commentPr({ ...repo, pr: 'none' }, dir, 'one/fix-1', 'x'), /requests are off/)
      await assert.rejects(commentPr(repo, dir, 'one/fix-1', '   '), /nothing to post/)
    })
    const calls = host.calls()
    assert.ok(calls.some((c) => /^glab mr note one\/fix-1 --message \*\*Approve\*\*/.test(c)), calls.join('\n'))
    assert.ok(calls.includes('glab mr merge one/fix-1 --yes'), calls.join('\n'))
  })

  test('GitHub: gh pr comment; a repository without merge commits is merged with squash', async () => {
    const dir = plainRepo(join(tempDir('ghpr'), 'demo'), { 'README.md': '# d\n' }, 'git@github.com:me/demo.git')
    const repo = { path: dir, remote: 'origin', baseBranch: 'main', pr: 'gh' } as RepoConfig
    const host = fakeHosts()
    await withEnv({ PATH: `${host.bin}:${process.env.PATH}`, GIT_SSH_COMMAND: 'false', ONE_WORKER_FETCH_MS: '5000' }, async () => {
      assert.deepEqual(await commentPr(repo, dir, 'one/fix-2', 'Looks good.'), { via: 'gh', url: 'https://github.com/me/demo/pull/3' })
      assert.deepEqual(await mergePr(repo, dir, 'one/fix-2'), { via: 'gh', url: 'https://github.com/me/demo/pull/3' })
    })
    const calls = host.calls()
    assert.ok(calls.includes('gh pr comment one/fix-2 --body Looks good.'), calls.join('\n'))
    assert.ok(calls.includes('gh pr merge one/fix-2 --merge'))
    assert.ok(calls.includes('gh pr merge one/fix-2 --squash'))
    assert.ok(!calls.includes('gh pr merge one/fix-2 --rebase'))
  })
})
