/**
 * one-worker git: against temp repos with a local bare remote (no network, no real host). Branch +
 * worktree per task, reuse of an existing branch, diff, commit, push, update from base (rebase / merge,
 * conflicts), cleanup and discard of the worker's own branches only, dirty checks.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { loadConfig, type RepoConfig } from '../src/worker/config.ts'
import { WorkerState } from '../src/worker/state.ts'
import { branchExists, cleanup, localBranches, commitAll, compareUrl, discard, ensureWorktree, info, push, remoteBranchExists, slug, updateFromBase, webBase } from '../src/worker/git.ts'
import { Scrubber, repoScrubber } from '../src/worker/scrub.ts'
import { cleanupAll, makeRepo, repoEntry, sh, tempDir, writeConfig, type TempRepo } from './worker-helpers.ts'

after(cleanupAll)

function setup(extra: Record<string, unknown> = {}): { r: TempRepo; repo: RepoConfig; state: WorkerState } {
  const r = makeRepo()
  const file = writeConfig(r, { workspace: 'local:test-ws-1', repos: [repoEntry(r, extra)] })
  const { config, problems } = loadConfig(file)
  assert.deepEqual(problems, [])
  return { r, repo: config.repos[0]!, state: new WorkerState(file) }
}

describe('branches and worktrees', () => {
  test('a task gets its own branch from origin/main in its own worktree; the main checkout is untouched', async () => {
    const { r, repo, state } = setup()
    writeFileSync(join(r.path, 'scratch.txt'), 'the person is working here\n')
    const wt = await ensureWorktree(repo, state, { id: 'Task42xyz', title: 'Fix the login form!' }, null)
    assert.equal(wt.branch, 'one/fix-the-login-form-task42')
    assert.equal(wt.created, true)
    assert.ok(wt.dir.startsWith(r.worktrees), wt.dir)
    assert.ok(existsSync(join(wt.dir, 'README.md')))
    // main checkout: same branch, the person's file still there, nothing staged
    assert.equal(sh(r.path, 'branch', '--show-current').trim(), 'main')
    assert.equal(readFileSync(join(r.path, 'scratch.txt'), 'utf8'), 'the person is working here\n')
    assert.equal(sh(r.path, 'status', '--porcelain').trim(), '?? scratch.txt')
    // the same task again: the same worktree
    const again = await ensureWorktree(repo, state, { id: 'Task42xyz', title: 'Fix the login form!' }, null)
    assert.equal(again.dir, wt.dir)
    assert.equal(slug('Ärger mit   Ümläuten & Co.'), 'arger-mit-umlauten-co')
  })

  test('an existing branch the task names is reused (never reset); a missing one or the main checkout is refused', async () => {
    const { r, repo, state } = setup()
    sh(r.path, 'branch', 'feature/existing')
    const tip = sh(r.path, 'rev-parse', 'feature/existing').trim()
    const wt = await ensureWorktree(repo, state, { id: 'reuse1', title: 'Reuse' }, 'feature/existing')
    assert.equal(wt.branch, 'feature/existing')
    assert.equal(wt.created, false)
    assert.equal(sh(wt.dir, 'rev-parse', 'HEAD').trim(), tip)
    await assert.rejects(ensureWorktree(repo, state, { id: 'reuse2', title: 'Missing' }, 'feature/nope'), /does not exist/)
    await assert.rejects(ensureWorktree(repo, state, { id: 'reuse3', title: 'Main' }, 'main'), /main checkout/)
    await assert.rejects(ensureWorktree(repo, state, { id: 'reuse4', title: 'Bad' }, '--force'), /not a valid branch/)
    // a branch only on the remote: tracked, not created by the worker
    const o = r.other()
    sh(o, 'checkout', '--quiet', '-b', 'remote-only')
    writeFileSync(join(o, 'x.txt'), 'x\n')
    sh(o, 'add', '-A')
    sh(o, 'commit', '--quiet', '-m', 'x')
    sh(o, 'push', '--quiet', 'origin', 'remote-only')
    const tracked = await ensureWorktree(repo, state, { id: 'reuse5', title: 'Remote' }, 'remote-only')
    assert.equal(tracked.created, false)
    assert.ok(existsSync(join(tracked.dir, 'x.txt')))
    // the base branch is never a task's branch — also while the main checkout is elsewhere (Ship would push to it)
    sh(r.path, 'checkout', '--quiet', '-b', 'person-work')
    await assert.rejects(ensureWorktree(repo, state, { id: 'reuse6', title: 'Base' }, 'main'), /base branch/)
    assert.equal(sh(r.path, 'worktree', 'list', '--porcelain').includes('branch refs/heads/main'), false)
  })
})

describe('branch list', () => {
  test('local branch names, newest commit first (what One offers in the Branch picker)', async () => {
    const { r, repo } = setup()
    sh(r.path, 'branch', 'feature/older')
    sh(r.path, 'checkout', '--quiet', '-b', 'feature/newer')
    writeFileSync(join(r.path, 'n.txt'), 'n\n')
    sh(r.path, 'add', '-A')
    sh(r.path, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'newer')
    sh(r.path, 'checkout', '--quiet', 'main')
    const list = await localBranches(repo)
    assert.equal(list[0], 'feature/newer')
    assert.deepEqual([...list].sort(), ['feature/newer', 'feature/older', 'main'])
  })
})

describe('diff, commit, push', () => {
  test('info: per-file diff of changed and new files (binary skipped), ahead / behind, pushed', async () => {
    const { r, repo, state } = setup()
    const wt = await ensureWorktree(repo, state, { id: 'diff1', title: 'Diff' }, null)
    writeFileSync(join(wt.dir, 'README.md'), '# Demo\n\nA changed line.\n')
    writeFileSync(join(wt.dir, 'new.ts'), 'export const x = 1\n')
    writeFileSync(join(wt.dir, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
    const g = await info(repo, state, wt.dir, wt.branch)
    assert.equal(g.base, 'origin/main')
    assert.equal(g.dirty, 3)
    const readme = g.files.find((f) => f.path === 'README.md')!
    assert.equal(readme.status, 'M')
    assert.match(readme.diff!, /^-A line\.$/m)
    assert.match(readme.diff!, /^\+A changed line\.$/m)
    const added = g.files.find((f) => f.path === 'new.ts')!
    assert.equal(added.status, '?')
    assert.match(added.diff!, /^\+export const x = 1$/m)
    const bin = g.files.find((f) => f.path === 'logo.bin')!
    assert.equal(bin.binary, true)
    assert.equal(bin.diff, null)
    // an untracked link to a file outside the repo: shown as its target, the file is never read
    const outside = join(tempDir('outside'), 'id_rsa')
    writeFileSync(outside, 'PRIVATE KEY MATERIAL\n')
    symlinkSync(outside, join(wt.dir, 'leak.txt'))
    const linked = (await info(repo, state, wt.dir, wt.branch)).files.find((f) => f.path === 'leak.txt')!
    assert.ok(linked.diff?.includes(`+${outside}`), linked.diff ?? '')
    assert.ok(!linked.diff?.includes('PRIVATE KEY'), linked.diff ?? '')
    rmSync(join(wt.dir, 'leak.txt'))
    assert.equal(g.pushed, false)
    assert.equal(g.created, true)

    const sha = await commitAll(wt.dir, 'Diff task\n\n- changed the readme')
    assert.ok(sha)
    assert.equal(sh(wt.dir, 'log', '-1', '--format=%an|%s').trim(), 'Test Person|Diff task')
    assert.equal(await commitAll(wt.dir, 'again'), null)
    await push(repo, wt.dir, wt.branch)
    assert.equal(await remoteBranchExists(repo, wt.branch), true)
    assert.ok(sh(r.remote, 'branch', '--list', wt.branch).includes(wt.branch))
    const after = await info(repo, state, wt.dir, wt.branch)
    assert.deepEqual([after.ahead, after.behind, after.pushed, after.unpushed, after.dirty], [1, 0, true, 0, 0])
    assert.equal(after.commits[0]!.subject, 'Diff task')
  })

  test('compare links only for GitHub / GitLab remotes, without credentials; local paths give none', () => {
    assert.equal(compareUrl('git@github.com:acme/site.git', 'main', 'one/x-1'), 'https://github.com/acme/site/compare/main...one/x-1?expand=1')
    assert.equal(compareUrl('https://user:secret@github.com/acme/site.git', 'main', 'b'), 'https://github.com/acme/site/compare/main...b?expand=1')
    assert.match(compareUrl('ssh://git@gitlab.com/acme/site.git', 'main', 'b')!, /^https:\/\/gitlab\.com\/acme\/site\/-\/merge_requests\/new\?/)
    assert.equal(compareUrl('/home/me/remote.git', 'main', 'b'), null)
    assert.equal(webBase('file:///tmp/x.git'), null)
  })
})

describe('update from base', () => {
  test('rebases a branch that was never pushed; merges a pushed one and reports conflicts per file', async () => {
    const { r, repo, state } = setup()
    // a colleague changes the base
    const o = r.other()
    writeFileSync(join(o, 'README.md'), '# Demo\n\nTheir line.\n')
    sh(o, 'commit', '--quiet', '-am', 'their change')
    sh(o, 'push', '--quiet', 'origin', 'main')

    // not pushed, no conflict: rebase
    const a = await ensureWorktree(repo, state, { id: 'upd1', title: 'Rebase me' }, null)
    sh(r.path, 'fetch', '--quiet', 'origin')
    const fresh = await ensureWorktree(repo, state, { id: 'upd2', title: 'Old base' }, null)
    writeFileSync(join(a.dir, 'other.txt'), 'mine\n')
    await commitAll(a.dir, 'mine')
    const rb = await updateFromBase(repo, a.dir, a.branch)
    assert.ok(rb.how === 'rebased' || rb.how === 'up-to-date', rb.how)
    assert.equal(fresh.created, true)

    // pushed + conflicting: merge, conflicts left for a stage to resolve
    const b = await ensureWorktree(repo, state, { id: 'upd3', title: 'Conflict' }, null)
    // b was made from the fetched base already; make the base move again
    writeFileSync(join(o, 'README.md'), '# Demo\n\nTheir second line.\n')
    sh(o, 'commit', '--quiet', '-am', 'their second change')
    sh(o, 'push', '--quiet', 'origin', 'main')
    writeFileSync(join(b.dir, 'README.md'), '# Demo\n\nMy line.\n')
    await commitAll(b.dir, 'my readme')
    await push(repo, b.dir, b.branch)
    const mg = await updateFromBase(repo, b.dir, b.branch)
    assert.equal(mg.how, 'conflicts')
    assert.deepEqual(mg.conflicts, ['README.md'])
    const g = await info(repo, state, b.dir, b.branch)
    assert.deepEqual(g.conflicts, ['README.md'])
    // a commit is refused while conflicts are unresolved
    await assert.rejects(commitAll(b.dir, 'nope'), /conflicts/)
    // resolved by hand → the commit concludes the merge
    writeFileSync(join(b.dir, 'README.md'), '# Demo\n\nBoth lines.\n')
    assert.ok(await commitAll(b.dir, 'merge the base'))
    assert.equal(sh(b.dir, 'rev-list', '--count', 'HEAD..origin/main').trim(), '0')
  })

  test('refuses to update a worktree with uncommitted changes (nothing is lost)', async () => {
    const { repo, state } = setup()
    const wt = await ensureWorktree(repo, state, { id: 'dirty1', title: 'Dirty' }, null)
    writeFileSync(join(wt.dir, 'wip.txt'), 'work in progress\n')
    await assert.rejects(updateFromBase(repo, wt.dir, wt.branch), /uncommitted/)
    assert.equal(readFileSync(join(wt.dir, 'wip.txt'), 'utf8'), 'work in progress\n')
  })
})

describe('cleanup', () => {
  test('discard removes only the worker\'s own worktree + branch; cleanup waits for the merge; others are never touched', async () => {
    const { r, repo, state } = setup()
    // the person's branch, reused by a task: never deleted
    sh(r.path, 'branch', 'mine')
    const reused = await ensureWorktree(repo, state, { id: 'cl1', title: 'Mine' }, 'mine')
    await assert.rejects(cleanup(repo, state, 'mine'), /did not create/)
    const d = await discard(repo, state, 'mine')
    assert.deepEqual(d, { worktree: true, branch: false })
    assert.equal(await branchExists(repo, 'mine'), true)
    assert.equal(existsSync(reused.dir), false)
    await assert.rejects(discard(repo, state, 'never-seen'), /did not create/)

    // own branch, not merged: cleanup refuses; discard (double-confirmed in One) removes it
    const own = await ensureWorktree(repo, state, { id: 'cl2', title: 'Own' }, null)
    writeFileSync(join(own.dir, 'f.txt'), 'f\n')
    await commitAll(own.dir, 'f')
    await assert.rejects(cleanup(repo, state, own.branch), /not merged/)
    assert.deepEqual(await discard(repo, state, own.branch), { worktree: true, branch: true })
    assert.equal(await branchExists(repo, own.branch), false)

    // own branch merged into the base: cleanup removes worktree + branch
    const merged = await ensureWorktree(repo, state, { id: 'cl3', title: 'Merged' }, null)
    writeFileSync(join(merged.dir, 'm.txt'), 'm\n')
    await commitAll(merged.dir, 'm')
    await push(repo, merged.dir, merged.branch)
    const o = r.other()
    sh(o, 'merge', '--quiet', '--no-edit', `origin/${merged.branch}`)
    sh(o, 'push', '--quiet', 'origin', 'main')
    sh(r.path, 'fetch', '--quiet', 'origin')
    assert.equal((await info(repo, state, merged.dir, merged.branch)).merged, true)
    assert.deepEqual(await cleanup(repo, state, merged.branch), { worktree: true, branch: true })
    assert.equal(existsSync(merged.dir), false)
  })
})

describe('paths', () => {
  test('the scrubber replaces the worktree, the repo, the worktree folder and the home folder', () => {
    const repo = { path: '/home/me/code/site', worktreeDir: '/home/me/code/.one-worktrees/site' }
    const s = repoScrubber(repo, '/home/me/code/.one-worktrees/site/one-x-1')
    assert.equal(s.text('Edit /home/me/code/.one-worktrees/site/one-x-1/src/a.ts'), 'Edit ./src/a.ts')
    assert.equal(s.text('see /home/me/code/site/README.md'), 'see <repo>/README.md')
    assert.equal(s.text('in /home/me/code/.one-worktrees/site/other'), 'in <worktrees>/other')
    const home = new Scrubber([])
    assert.ok(!home.text(`${process.env.HOME}/x`).includes(String(process.env.HOME)))
  })
})
