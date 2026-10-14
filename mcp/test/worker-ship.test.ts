/**
 * The ship log (worker 1.10.0): every git stage and git key returns a ShipRecord — the commit, the push, the merge /
 * pull request and the repo's web address (never a path) —, commit messages and request bodies end with
 * "One-Task: <task id>" (built as text), GitLab finds an open merge request first, a rejected push is named
 * (pushRejected) and Update from base merges the remote task branch in first, worker.json "forge" per repo.
 * Hosts are fakes (glab / gh) and fetch URLs that are never contacted (git's ssh is `false`; pushes go to a local
 * bare repository).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { GIT_SHA, WORKER_CAN, branchUrl, cleanWeb, commitUrl, requestNumber, type GitResult, type LogLine, type ShipRecord, type WorkerMessage } from '../../src/app/features/coding/protocol.ts'
import { saveRepos, sanitizeConfig, type RepoConfig } from '../src/worker/config.ts'
import { compareUrl, forgeOfHost, forgetSshNames, openPr, sshHostName, sshHostOf, webBase, webFromRequest } from '../src/worker/git.ts'
import { gitHint } from '../src/worker/gitenv.ts'
import { REQUEST_FOOTER, commitMessage, newShip, requestBody, requestLine, withRequest, withTaskTrailer } from '../src/worker/run.ts'
import { SetupServer } from '../src/worker/setup.ts'
import { FakeTab, WS_LOCAL, cleanupAll, fakeBin, leakIn, makeRepo, pathWith, plainRepo, repoEntry, sh, startWorker, task, tempDir, writeConfig, type StartedWorker, type TempRepo } from './worker-helpers.ts'

const PORT = 47382
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
  const leak = leakIn(tab.raw.join('\n'), [r.path, r.worktrees, r.dir, homedir(), process.execPath], ['fake-claude'])
  assert.equal(leak, null, `the tab received ${leak}`)
}

const logLines = (tab: FakeTab): LogLine[] => tab.messages.flatMap((m) => (m.type === 'event' && m.kind === 'log' ? m.lines : []))
const SHIP_CODES = new Set(['committed', 'nothingToCommit', 'pushed', 'forcePushed', 'pushOff', 'requestOpened', 'requestExisting', 'requestLink', 'requestNone', 'pushRejected', 'remoteMerged', 'reviewPosted', 'requestMerged'])
const shipCodes = (tab: FakeTab) => logLines(tab).filter((l) => l.c && SHIP_CODES.has(l.c)).map((l) => l.c)

/** A repo whose fetch URL looks like a host (never contacted: git's ssh is `false`), its pushes going to the local bare one. */
function forgeRepo(url: string): TempRepo {
  const r = makeRepo()
  sh(r.path, 'remote', 'set-url', 'origin', url)
  sh(r.path, 'remote', 'set-url', '--push', 'origin', r.remote)
  return r
}

const GITLAB = 'git@gitlab.example.test:nordlicht/website.git'
const GITLAB_WEB = { base: 'https://gitlab.example.test/nordlicht/website', forge: 'gitlab' as const }
const MR = 'https://gitlab.example.test/nordlicht/website/-/merge_requests/42'
const GITHUB = 'git@github.example.com:nordlicht/website.git'
const GITHUB_WEB = { base: 'https://github.example.com/nordlicht/website', forge: 'github' as const }
const PR = 'https://github.example.com/nordlicht/website/pull/7'

interface Call {
  tool: 'gh' | 'glab'
  args: string[]
  stdin?: string
}

/**
 * Fake glab / gh (JavaScript, started as this OS starts an installed CLI — fakeBin), set up per test through config.json
 * in their folder: glab `mr view` exits 1 until `mr create` ran (or answers `glab.view`), `mr create` prints the request
 * (or fails without an address: `glab.create: 'fail'`); gh `pr create` prints the pull request (or fails); `pr view` answers
 * JSON. Every call is logged with its arguments (and a `--body-file -` body).
 */
function fakeForges(cfg: Record<string, unknown> = {}): { bin: string; calls: () => Call[]; set: (c: Record<string, unknown>) => void } {
  const bin = tempDir('forges')
  const set = (c: Record<string, unknown>) => writeFileSync(join(bin, 'config.json'), JSON.stringify(c))
  set(cfg)
  const head = (tool: string) => `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const DIR = ${JSON.stringify(bin)}
const cfg = JSON.parse(readFileSync(DIR + '/config.json', 'utf8'))
const a = process.argv.slice(2)
const i = a.indexOf('--body-file')
const stdin = i >= 0 && a[i + 1] === '-' ? readFileSync(0, 'utf8') : undefined
appendFileSync(DIR + '/calls.jsonl', JSON.stringify({ tool: ${JSON.stringify(tool)}, args: a, stdin }) + '\\n')
const say = (s) => {
  process.stdout.write(s + '\\n')
  process.exit(0)
}
const fail = (s) => {
  process.stderr.write(s + '\\n')
  process.exit(1)
}
const two = a[0] + ' ' + (a[1] ?? '')
`
  const glab = `${head('glab')}
// the merge requests created so far, per source branch
const STATE = DIR + '/glab-state.json'
const made = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const url = (cfg.glab && cfg.glab.url) || ${JSON.stringify(MR)}
if (a[0] === '--version') say('glab 1.99')
if (two === 'mr view') {
  if (made[a[2]]) say(JSON.stringify({ iid: 42, state: 'opened', web_url: made[a[2]] }))
  if (cfg.glab && cfg.glab.view) say(JSON.stringify(cfg.glab.view))
  fail('no open merge request available for "' + a[2] + '"')
}
if (two === 'mr create') {
  if (cfg.glab && cfg.glab.create === 'fail') fail('could not create merge request: 403 Forbidden (in ' + process.cwd() + ')')
  made[a[3]] = url
  writeFileSync(STATE, JSON.stringify(made))
  process.stdout.write('Creating merge request for ' + a[3] + ' into ' + a[5] + ' in nordlicht/website\\n')
  say(url)
}
if (two === 'mr note') process.exit(0)
if (two === 'mr merge') say('Merged!')
process.exit(1)
`
  const gh = `${head('gh')}
const url = (cfg.gh && cfg.gh.url) || ${JSON.stringify(PR)}
if (a[0] === '--version') say('gh 9.9')
if (two === 'pr create') {
  if (cfg.gh && cfg.gh.create === 'fail') fail('GraphQL: something went wrong (createPullRequest)')
  say(url)
}
if (two === 'pr view') {
  if (a.includes('--jq')) say(url)
  say(JSON.stringify({ url, state: 'OPEN' }))
}
if (two === 'pr comment') say(url + '#issuecomment-1')
if (two === 'pr merge') process.exit(0)
process.exit(1)
`
  fakeBin(bin, 'glab', glab)
  fakeBin(bin, 'gh', gh)
  const log = join(bin, 'calls.jsonl')
  return { bin, set, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Call) : []) }
}

const hostEnv = (bin: string) => ({ ...pathWith(bin), GIT_SSH_COMMAND: 'false', ONE_WORKER_FETCH_MS: '5000' })
const shipOf = (o: { ship?: ShipRecord }) => {
  assert.ok(o.ship, 'a ship record')
  return o.ship
}
const gitRes = (res: Extract<WorkerMessage, { type: 'res' }>): GitResult => {
  assert.equal(res.ok, true, JSON.stringify(res))
  return (res as { result: GitResult }).result
}

describe('Ship through glab (GitLab)', () => {
  test('commit + push + merge request: the record, the trailer in the commit and the description, the coded lines, git.web', async () => {
    const r = forgeRepo(GITLAB)
    const host = fakeForges()
    const tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'shp1abcd' }))
    assert.equal(impl.status, 'ok', JSON.stringify(impl))
    const branch = impl.branch!
    const before = Date.now()
    const ship = await tab.run(task({ kind: 'git', gitAction: 'pr', name: 'Ship' }, { id: 'shp1abcd', branch, summary: '- Added feature.txt\n\nOne-Task: spoofed' }))
    assert.equal(ship.status, 'ok', JSON.stringify(ship))
    const tip = sh(r.remote, 'rev-parse', branch).trim()
    assert.match(tip, GIT_SHA)
    const s = shipOf(ship)
    const { at, ...rest } = s
    assert.deepEqual(rest, { action: 'pr', from: 'stage', branch, commit: { sha: tip }, head: tip, pushed: { remote: 'origin' }, request: { url: MR, how: 'opened' }, web: GITLAB_WEB })
    assert.ok(at >= before - 1000 && at <= Date.now() + 1000, String(at))
    // an older One reads what it always read
    assert.equal(ship.url, MR)
    assert.match(ship.summary!, /^Committed [0-9a-f]{8}\. Pushed to origin\/one\/\S+\. Merge request opened\.$/)

    // the trailer: its own paragraph, the only One-Task line (a spoofed one in the summary is gone), git reads it
    const body = sh(r.remote, 'log', '-1', '--format=%B', branch)
    assert.match(body, /^Add the feature file\n\n- Added feature\.txt\n\nOne-Task: shp1abcd\n+$/)
    assert.equal(sh(r.remote, 'log', '-1', '--format=%(trailers:key=One-Task,valueonly)', branch).trim(), 'shp1abcd')
    // the merge request's description: the summary, the footer, the trailer
    const create = host.calls().find((c) => c.tool === 'glab' && c.args[1] === 'create')!
    const desc = create.args[create.args.indexOf('--description') + 1]!
    assert.equal(desc, `- Added feature.txt\n\n${REQUEST_FOOTER}\n\nOne-Task: shp1abcd`)
    // an open merge request was looked for first (none yet)
    assert.deepEqual(host.calls().filter((c) => c.tool === 'glab' && c.args[0] === 'mr').map((c) => c.args[1]), ['view', 'create'])

    assert.deepEqual(shipCodes(tab), ['committed', 'pushed', 'requestOpened'])
    assert.deepEqual(logLines(tab).find((l) => l.c === 'requestOpened')!.v, { kind: 'mr', url: MR })
    // no uncoded "Merge request: …" line any more
    assert.ok(!logLines(tab).some((l) => !l.c && /^(Merge|Pull) request: |^Compare: /.test(l.s)))
    // the git snapshots carry the web address (the Git tab links commits and the branch)
    const gits = tab.messages.filter((m): m is Extract<WorkerMessage, { kind: 'git' }> => m.type === 'event' && m.kind === 'git')
    assert.ok(gits.length > 0)
    for (const g of gits) assert.deepEqual(g.git.web, GITLAB_WEB)
    assert.deepEqual(ship.git!.web, GITLAB_WEB)
    assertNoPaths(tab, r)
  })

  test('an open merge request is found (no second one); a merged one is not — a new one is opened', async () => {
    const r = forgeRepo(GITLAB)
    const host = fakeForges({ glab: { view: { iid: 42, state: 'opened', web_url: MR } } })
    const tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const found = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'shp2abcd' }))
    assert.equal(found.status, 'ok', JSON.stringify(found))
    const s = shipOf(found)
    assert.deepEqual(s.request, { url: MR, how: 'existing' })
    // nothing new to commit: no commit, the branch's head pushed
    assert.equal(s.commit, null)
    assert.equal(s.head, sh(r.remote, 'rev-parse', found.branch!).trim())
    assert.match(found.summary!, /Merge request already open\./)
    assert.ok(!host.calls().some((c) => c.tool === 'glab' && c.args[1] === 'create'), 'no mr create')
    assert.deepEqual(shipCodes(tab), ['nothingToCommit', 'pushed', 'requestExisting'])

    const merged = 'https://gitlab.example.test/nordlicht/website/-/merge_requests/41'
    host.set({ glab: { view: { iid: 41, state: 'merged', web_url: merged } } })
    const fresh = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'shp3abcd' }))
    assert.equal(fresh.status, 'ok', JSON.stringify(fresh))
    assert.deepEqual(shipOf(fresh).request, { url: MR, how: 'opened' })
    assert.ok(host.calls().some((c) => c.tool === 'glab' && c.args[1] === 'create'), 'mr create')
    assertNoPaths(tab, r)
  })

  test('glab create fails without an address: the new-merge-request link, glab\'s words as a warning (scrubbed) — the stage is ok', async () => {
    const r = forgeRepo(GITLAB)
    const host = fakeForges({ glab: { create: 'fail' } })
    const tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const out = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'shp4abcd' }))
    assert.equal(out.status, 'ok', JSON.stringify(out))
    const s = shipOf(out)
    assert.equal(s.request!.how, 'link')
    assert.match(s.request!.url, /^https:\/\/gitlab\.example\.test\/nordlicht\/website\/-\/merge_requests\/new\?merge_request%5Bsource_branch%5D=one%2F/)
    assert.deepEqual(s.web, GITLAB_WEB)
    assert.deepEqual(s.pushed, { remote: 'origin' })
    assert.equal(s.failed, undefined)
    assert.equal(requestNumber(s.request!.url), null)
    const lines = logLines(tab)
    const warn = lines.find((l) => l.k === 'warn' && /^glab mr create failed: /.test(l.s))
    assert.ok(warn, JSON.stringify(lines.map((l) => l.s)))
    assert.match(warn.s, /403 Forbidden/)
    assert.equal(warn.c, undefined, 'the tool\'s own words: no code')
    assert.deepEqual(lines.find((l) => l.c === 'requestLink')!.v, { kind: 'mr', url: s.request!.url })
    // looked once more after the failed create
    assert.deepEqual(host.calls().filter((c) => c.tool === 'glab' && c.args[0] === 'mr').map((c) => c.args[1]), ['view', 'create', 'view'])
    assertNoPaths(tab, r)
  })
})

describe('a rejected push', () => {
  test('named (pushRejected), the commit recorded; Update from base merges the remote branch in; Ship again pushes — never a force', async () => {
    const r = makeRepo()
    const tab = await boot(r)
    const id = 'rej1abcd'
    const impl = await tab.run(task({ kind: 'implement' }, { id }))
    const branch = impl.branch!
    const first = await tab.run(task({ kind: 'git', gitAction: 'push' }, { id, branch }))
    assert.equal(first.status, 'ok', JSON.stringify(first))
    // a plain local remote: no web address, no links
    assert.equal(shipOf(first).web, null)
    assert.deepEqual(shipOf(first).pushed, { remote: 'origin' })

    // a colleague pushes to the task's branch — dated later than the commit Ship makes below: the log (by date) then
    // lists it among the commits that are only here
    const o = r.other()
    sh(o, 'checkout', '--quiet', branch)
    writeFileSync(join(o, 'colleague.txt'), 'theirs\n')
    sh(o, 'add', 'colleague.txt')
    process.env.GIT_COMMITTER_DATE = new Date(Date.now() + 3_600_000).toISOString()
    try {
      sh(o, 'commit', '--quiet', '-m', 'their change')
    } finally {
      delete process.env.GIT_COMMITTER_DATE
    }
    sh(o, 'push', '--quiet', 'origin', branch)
    const theirs = sh(o, 'rev-parse', 'HEAD').trim()

    const again = await tab.run(task({ kind: 'implement' }, { id, branch, title: 'Change the feature file' }))
    assert.equal(again.status, 'ok', JSON.stringify(again))
    const rejected = await tab.run(task({ kind: 'git', gitAction: 'push' }, { id, branch }))
    assert.equal(rejected.status, 'failed', JSON.stringify(rejected))
    const s = shipOf(rejected)
    assert.match(s.commit!.sha, GIT_SHA)
    assert.equal(s.head, s.commit!.sha)
    assert.equal(s.pushed, null)
    assert.deepEqual(s.failed, { step: 'push', code: 'pushRejected' })
    assert.equal(s.web, null)
    assert.equal(s.request, null)
    assert.ok(rejected.git, 'the snapshot comes along')
    assert.equal(rejected.branch, branch)
    const hint = logLines(tab).find((l) => l.c === 'pushRejected')!
    assert.deepEqual(hint.v, { remote: 'origin' })
    assert.match(hint.s, /Update from base/)
    // the colleague's commit is still the remote's tip
    assert.equal(sh(r.remote, 'rev-parse', branch).trim(), theirs)

    // Update from base: the remote branch merged in first (no ship record)
    const up = gitRes(await tab.request({ op: 'git', taskId: id, verb: 'update-base', repo: 'demo', branch, title: 'x' }))
    assert.equal(up.ship, undefined)
    assert.match(up.message, /^Merged origin\/one\/\S+ in\. Already up to date\.$/)
    assert.deepEqual(logLines(tab).find((l) => l.c === 'remoteMerged')!.v, { remote: 'origin', branch })
    assert.equal(sh(r.path, 'show', `${branch}:colleague.txt`), 'theirs\n')
    // the Git tab links per commit, never by position: the log lists the merge, then the colleague's commit (newer by
    // date) before the one the rejected push left — the colleague's is on the remote, the merge and ours only here
    const commits = up.git!.commits
    assert.equal(up.git!.unpushed, 2)
    assert.equal(commits[1]!.sha, theirs)
    const on = new Map(commits.map((c) => [c.sha, c.remote]))
    assert.equal(on.get(theirs), true)
    assert.equal(on.get(s.commit!.sha), false)
    assert.equal(commits.filter((c) => c.remote === false).length, 2)
    assert.ok(commits.some((c) => c.remote === true && c.sha !== theirs), 'the first push is on the remote')

    // Ship again: nothing new to commit, the merge pushed
    const shipped = await tab.run(task({ kind: 'git', gitAction: 'push' }, { id, branch }))
    assert.equal(shipped.status, 'ok', JSON.stringify(shipped))
    const s2 = shipOf(shipped)
    assert.equal(s2.commit, null)
    assert.deepEqual(s2.pushed, { remote: 'origin' })
    assert.equal(s2.head, sh(r.remote, 'rev-parse', branch).trim())
    assert.ok(shipped.git!.commits.length >= 4 && shipped.git!.commits.every((c) => c.remote === true), 'every commit on the remote now')
    // the remote's history was never rewritten: both commits are in it
    sh(r.remote, 'merge-base', '--is-ancestor', theirs, branch)
    sh(r.remote, 'merge-base', '--is-ancestor', s.commit!.sha, branch)
    assertNoPaths(tab, r)
  })
})

describe('Ship on GitHub, push off, the host type', () => {
  test('GitHub: the request fails after the push — status failed, the commit and the push recorded', async () => {
    const r = forgeRepo(GITHUB)
    const host = fakeForges({ gh: { create: 'fail' } })
    const tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'ghf1abcd' }))
    const out = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'ghf1abcd', branch: impl.branch! }))
    assert.equal(out.status, 'failed', JSON.stringify(out))
    assert.match(out.error!, /gh pr create failed: GraphQL: something went wrong/)
    const s = shipOf(out)
    assert.match(s.commit!.sha, GIT_SHA)
    assert.deepEqual(s.pushed, { remote: 'origin' })
    assert.equal(s.request, null)
    assert.deepEqual(s.failed, { step: 'request' })
    assert.deepEqual(s.web, GITHUB_WEB)
    assert.equal(sh(r.remote, 'rev-parse', impl.branch!).trim(), s.commit!.sha)
    // the body went in on stdin with the footer and the trailer
    const create = host.calls().find((c) => c.tool === 'gh' && c.args[1] === 'create')!
    assert.ok(create.stdin!.endsWith(`${REQUEST_FOOTER}\n\nOne-Task: ghf1abcd`), create.stdin)
    assertNoPaths(tab, r)
  })

  test('push off: committed only — pushOff in the record and the coded line', async () => {
    const r = makeRepo()
    const tab = await boot(r, { push: false })
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'off1abcd' }))
    const out = await tab.run(task({ kind: 'git', gitAction: 'push' }, { id: 'off1abcd', branch: impl.branch! }))
    assert.equal(out.status, 'ok', JSON.stringify(out))
    const s = shipOf(out)
    assert.equal(s.pushOff, true)
    assert.equal(s.pushed, null)
    assert.match(s.commit!.sha, GIT_SHA)
    assert.match(out.summary!, /Pushing is off for this repo in worker\.json\./)
    assert.deepEqual(logLines(tab).find((l) => l.c === 'pushOff')!.v, { repo: 'demo' })
    assert.equal(sh(r.remote, 'branch', '--list', impl.branch!).trim(), '')
  })

  test('a host whose name says nothing: "auto" gives no links and no request (requestNone); "gitlab" links and opens one — the web address follows the request\'s own', async () => {
    const url = 'git@git.nordlicht.example.test:team/website.git'
    const r = forgeRepo(url)
    let host = fakeForges()
    let tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const plain = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'frg1abcd' }))
    assert.equal(plain.status, 'ok', JSON.stringify(plain))
    assert.equal(shipOf(plain).web, null)
    assert.equal(shipOf(plain).request, null)
    assert.equal(plain.url, undefined)
    assert.deepEqual(logLines(tab).find((l) => l.c === 'requestNone')!.v, { remote: 'origin' })
    assert.deepEqual(host.calls().filter((c) => c.args[0] !== '--version'), [], 'neither glab nor gh')
    await worker!.stop()
    tabs.splice(0).forEach((t) => t.close())

    const own = 'https://git.nordlicht.example.test/team/website/-/merge_requests/42'
    host = fakeForges({ glab: { url: own } })
    tab = await boot(r, { pr: 'gh', forge: 'gitlab' }, hostEnv(host.bin))
    const lab = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'frg2abcd' }))
    assert.equal(lab.status, 'ok', JSON.stringify(lab))
    assert.deepEqual(shipOf(lab).web, { base: 'https://git.nordlicht.example.test/team/website', forge: 'gitlab' })
    assert.deepEqual(shipOf(lab).request, { url: own, how: 'opened' })
    assert.ok(logLines(tab).some((l) => l.c === 'requestOpened'))

    // the request lives under another web host (an SSH alias, a separate web name): the links follow it
    const other = 'https://code.nordlicht.example.test/team/website/-/merge_requests/9'
    host.set({ glab: { url: other } })
    const moved = await tab.run(task({ kind: 'git', gitAction: 'pr' }, { id: 'frg3abcd' }))
    assert.equal(moved.status, 'ok', JSON.stringify(moved))
    assert.deepEqual(shipOf(moved).web, { base: 'https://code.nordlicht.example.test/team/website', forge: 'gitlab' })
    assert.deepEqual(shipOf(moved).request, { url: other, how: 'opened' })
    assertNoPaths(tab, r)
  })

  test('"github" on a host whose name says nothing: gh opens the pull request', async () => {
    const dir = plainRepo(join(tempDir('ghe'), 'website'), { 'README.md': '# w\n' }, 'git@code.nordlicht.example.test:team/website.git')
    const host = fakeForges({ gh: { url: 'https://code.nordlicht.example.test/team/website/pull/3' } })
    const repo = { path: dir, remote: 'origin', baseBranch: 'main', pr: 'gh', forge: 'github' } as RepoConfig
    const path = process.env.PATH
    Object.assign(process.env, pathWith(host.bin))
    try {
      const pr = await openPr(repo, dir, 'one/x-1', 'Launch plan', requestBody('Launch plan', 'tsk9'))
      assert.deepEqual(pr, { url: 'https://code.nordlicht.example.test/team/website/pull/3', via: 'gh' })
      const rec = newShip('pr', 'stage', 'one/x-1', webBase('git@code.nordlicht.example.test:team/website.git', 'github'))
      assert.deepEqual(requestLine(pr, rec, repo).line, { k: 'git', s: 'Pull request opened: https://code.nordlicht.example.test/team/website/pull/3', c: 'requestOpened', v: { kind: 'pr', url: 'https://code.nordlicht.example.test/team/website/pull/3' } })
      // "auto": neither tool, no link
      assert.deepEqual(await openPr({ ...repo, forge: 'auto' }, dir, 'one/x-1', 'Launch plan', 'b'), { url: null, via: 'none' })
    } finally {
      process.env.PATH = path
    }
    assert.ok(host.calls().some((c) => c.tool === 'gh' && c.args[1] === 'create'))
  })
})

describe('the git keys', () => {
  test('commit · push · force-push · pr (request fails after the push: answered, not thrown) · comment-pr · merge-pr carry records; refresh none', async () => {
    const r = forgeRepo(GITHUB)
    const host = fakeForges({ gh: { create: 'fail' } })
    const tab = await boot(r, { pr: 'gh' }, hostEnv(host.bin))
    const id = 'key1abcd'
    const impl = await tab.run(task({ kind: 'implement' }, { id }))
    const branch = impl.branch!
    const key = (verb: string, message?: string) => tab.request({ op: 'git', taskId: id, verb, repo: 'demo', branch, title: 'Add the feature file', ...(message !== undefined ? { message } : {}) })

    const commit = gitRes(await key('commit', 'Add it\n\nOne-Task: someone-else'))
    const c = shipOf(commit)
    assert.equal(c.action, 'commit')
    assert.equal(c.from, 'key')
    assert.match(c.commit!.sha, GIT_SHA)
    assert.equal(c.head, c.commit!.sha)
    assert.equal(c.pushed, null)
    assert.deepEqual(c.web, GITHUB_WEB)
    assert.match(commit.message, /^Committed [0-9a-f]{8}\.$/)
    assert.equal(sh(r.path, 'log', '-1', '--format=%B', branch).trim(), `Add it\n\nOne-Task: ${id}`)
    assert.deepEqual(logLines(tab).filter((l) => l.c === 'committed').at(-1)!.v, { sha: c.commit!.sha.slice(0, 8) })

    const push = gitRes(await key('push'))
    assert.deepEqual(shipOf(push).pushed, { remote: 'origin' })
    assert.equal(shipOf(push).action, 'push')
    assert.equal(shipOf(push).head, sh(r.remote, 'rev-parse', branch).trim())
    assert.deepEqual(logLines(tab).filter((l) => l.c === 'pushed').at(-1)!.v, { branch, remote: 'origin' })

    const force = gitRes(await key('force-push'))
    assert.deepEqual(shipOf(force).pushed, { remote: 'origin', force: true })
    assert.equal(shipOf(force).action, 'force-push')
    assert.deepEqual(logLines(tab).filter((l) => l.c === 'forcePushed').at(-1)!.v, { branch, remote: 'origin' })

    const pr = await key('pr')
    const res = gitRes(pr)
    assert.match(res.error!, /gh pr create failed: GraphQL: something went wrong/)
    assert.match(res.message, /^Pushed one\/\S+\. The pull request could not be opened: git: gh pr create failed/)
    assert.deepEqual(shipOf(res).failed, { step: 'request' })
    assert.deepEqual(shipOf(res).pushed, { remote: 'origin' })
    assert.equal(shipOf(res).request, null)

    host.set({})
    const comment = gitRes(await key('comment-pr', '## Review\n\nLooks good.'))
    assert.deepEqual(shipOf(comment).request, { url: PR, how: 'commented' })
    assert.equal(shipOf(comment).action, 'comment')
    assert.deepEqual(logLines(tab).filter((l) => l.c === 'reviewPosted').at(-1)!.v, { url: PR })
    const merge = gitRes(await key('merge-pr'))
    assert.deepEqual(shipOf(merge).request, { url: PR, how: 'merged' })
    assert.equal(shipOf(merge).action, 'merge')
    assert.deepEqual(logLines(tab).filter((l) => l.c === 'requestMerged').at(-1)!.v, { url: PR })

    const refresh = gitRes(await key('refresh'))
    assert.equal(refresh.ship, undefined)
    assert.deepEqual(refresh.git!.web, GITHUB_WEB)
    // the record's time is the answer's
    for (const x of [commit, push, force, res, comment, merge]) assert.ok(Math.abs(shipOf(x).at - Date.now()) < 60_000)
    assertNoPaths(tab, r)
  })
})

describe('the trailer, the web address, the hint (pure)', () => {
  test('withTaskTrailer: a paragraph of its own, or joined to a trailer block; a spoofed line goes; cut first, the trailer whole', () => {
    assert.equal(withTaskTrailer('Add it', 't1'), 'Add it\n\nOne-Task: t1')
    assert.equal(withTaskTrailer('Add it\n\n- did it', 't1'), 'Add it\n\n- did it\n\nOne-Task: t1')
    assert.equal(withTaskTrailer('Add it\n\nBody.\n\nSigned-off-by: Ada Lovelace <ada@example.com>', 't1'), 'Add it\n\nBody.\n\nSigned-off-by: Ada Lovelace <ada@example.com>\nOne-Task: t1')
    const spoofed = withTaskTrailer('Add it\n\none-task : other\n\nOne-Task: x\nmore', 'TSK_1-a')
    assert.equal(spoofed.match(/one-task/gi)!.length, 1, spoofed)
    assert.ok(spoofed.endsWith('\n\nOne-Task: TSK_1-a'), spoofed)
    assert.ok(!spoofed.includes('other'))
    assert.equal(withTaskTrailer('Add it\n\nOne-Task: other', 'bad id!'), 'Add it')
    assert.equal(withTaskTrailer('', 't1'), 'One task\n\nOne-Task: t1')
    const long = withTaskTrailer('x'.repeat(10_000), 't1')
    assert.ok(long.length <= 4000, String(long.length))
    assert.ok(long.endsWith('\n\nOne-Task: t1'))
    assert.equal(commitMessage(task({ kind: 'git' }, { id: 'abc123', title: 'Launch plan', summary: '- did it' })), 'Launch plan\n\n- did it\n\nOne-Task: abc123')
  })

  test('requestBody: the footer and the trailer always whole within the limit (glab on Windows: 15,000)', () => {
    assert.equal(requestBody('Launch plan', 't1'), `Launch plan\n\n${REQUEST_FOOTER}\n\nOne-Task: t1`)
    const cut = requestBody('y'.repeat(20_000), 't1', 15_000)
    assert.ok(cut.length <= 15_000, String(cut.length))
    assert.ok(cut.endsWith(`${REQUEST_FOOTER}\n\nOne-Task: t1`))
    assert.equal(requestBody('a\nOne-Task: x', 'no good'), `a\n\n${REQUEST_FOOTER}`)
  })

  test('webBase: scheme, host (+ an http(s) port) and project path — never credentials, an ssh port or a local path; the forge by name or by worker.json', () => {
    assert.deepEqual(webBase('https://user:tok@GitLab.Example.test:8443/a/b/c.git'), { base: 'https://gitlab.example.test:8443/a/b/c', forge: 'gitlab' })
    assert.deepEqual(webBase('ssh://git@gitlab.example.test:2222/a/b.git'), { base: 'https://gitlab.example.test/a/b', forge: 'gitlab' })
    assert.deepEqual(webBase('git@github.com:me/x.git'), { base: 'https://github.com/me/x', forge: 'github' })
    assert.deepEqual(webBase('http://gitlab.example.test/nordlicht/website'), { base: 'http://gitlab.example.test/nordlicht/website', forge: 'gitlab' })
    assert.equal(webBase('/home/me/remote.git'), null)
    assert.equal(webBase('file:///tmp/x.git'), null)
    assert.equal(webBase('file:///tmp/x.git', 'gitlab'), null)
    assert.equal(webBase('C:\\code\\remote.git', 'github'), null)
    assert.equal(webBase('git@git.nordlicht.example.test:team/website.git'), null)
    assert.deepEqual(webBase('git@git.nordlicht.example.test:team/website.git', 'gitlab'), { base: 'https://git.nordlicht.example.test/team/website', forge: 'gitlab' })
    assert.deepEqual(webBase('git@gitlab.example.test:team/website.git', 'github'), { base: 'https://gitlab.example.test/team/website', forge: 'github' })
    assert.equal(webBase('git@gitlab.example.test:website.git'), null, 'a project path has two parts at least')
    assert.equal(webBase('git@gitlab.example.test:a/../b.git'), null)
    assert.equal(forgeOfHost('code.gitlab.example.test'), 'gitlab')
    assert.equal(forgeOfHost(null), null)
    // the compare link builds on the same address (the old forms unchanged)
    assert.equal(compareUrl('https://user:secret@github.com/acme/site.git', 'main', 'one/x-1'), 'https://github.com/acme/site/compare/main...one/x-1?expand=1')
    assert.equal(compareUrl('https://gitlab.example.test:8443/a/b.git', 'main', 'one/x'), 'https://gitlab.example.test:8443/a/b/-/merge_requests/new?merge_request%5Bsource_branch%5D=one%2Fx&merge_request%5Btarget_branch%5D=main')
    assert.match(compareUrl('git@git.nordlicht.example.test:team/website.git', 'main', 'b', 'gitlab')!, /^https:\/\/git\.nordlicht\.example\.test\/team\/website\/-\/merge_requests\/new\?/)
  })

  test('an ssh host alias: the web address names the host ssh connects to (ssh -G), the forge read from it first', async () => {
    const real = 'gitlab.example.test'
    assert.deepEqual(webBase('git@gitlab.com-work:nordlicht/website.git', 'auto', real), GITLAB_WEB)
    assert.deepEqual(webBase('git@work:nordlicht/website.git', 'auto', real), GITLAB_WEB, 'the alias says nothing; the real host does')
    assert.deepEqual(webBase('ssh://git@work:2222/nordlicht/website.git', 'auto', 'github.example.com'), GITHUB_WEB)
    assert.deepEqual(webBase('https://gitlab.example.test/nordlicht/website.git', 'auto', 'elsewhere.example.com'), GITLAB_WEB, 'never for an http(s) remote')
    assert.deepEqual(webBase('git@gitlab.example.test:nordlicht/website.git', 'auto', '-oProxyCommand=x'), GITLAB_WEB, 'an answer that is no host name is ignored')
    assert.equal(sshHostOf('git@gitlab.com-work:nordlicht/website.git'), 'gitlab.com-work')
    assert.equal(sshHostOf('ssh://git@Code.Example.test:2222/a/b.git'), 'code.example.test')
    for (const no of ['https://gitlab.example.test/a/b.git', 'git://gitlab.example.test/a/b.git', 'file:///tmp/x.git', '/home/me/x.git', 'C:\\code\\x.git', 'c:/code/x.git', 'git@-oProxyCommand=x:a/b.git'])
      assert.equal(sshHostOf(no), null, no)

    // ssh -G through the person's ssh (here a fake on PATH): its "hostname" line; asked once per host for a while
    const bin = tempDir('ssh')
    fakeBin(
      bin,
      'ssh',
      `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(join(bin, 'calls.txt'))}, a.join(' ') + '\\n')
if (a[0] !== '-G') process.exit(255)
if (a[1] === 'gitlab.com-work') process.stdout.write('user git\\nhostname gitlab.example.test\\nport 22\\n')
else if (a[1] === 'odd') process.stdout.write('hostname two words\\n')
else process.stdout.write('hostname ' + a[1] + '\\n')
`,
    )
    const key = Object.keys(pathWith(bin))[0]!
    const before = process.env[key]
    const restore = () => {
      if (before === undefined) delete process.env[key]
      else process.env[key] = before
      forgetSshNames()
    }
    process.env[key] = pathWith(bin)[key]
    forgetSshNames()
    try {
      assert.equal(await sshHostName('gitlab.com-work'), real)
      assert.equal(await sshHostName('gitlab.com-work'), real)
      assert.equal(await sshHostName('odd'), 'odd', 'no usable name: the host itself')
      assert.equal(await sshHostName('-oProxyCommand=x'), '-oProxyCommand=x')
      const calls = readFileSync(join(bin, 'calls.txt'), 'utf8').trim().split(/\r?\n/)
      assert.deepEqual(calls, ['-G gitlab.com-work', '-G odd'], 'once per host; never for something that is no host name')
    } finally {
      restore()
    }
    // no ssh at all: the host as written
    process.env[key] = tempDir('no-ssh')
    try {
      assert.equal(await sshHostName('gitlab.com-work'), 'gitlab.com-work')
    } finally {
      restore()
    }
  })

  test('webFromRequest: the web address before the request\'s own path (the host lower-cased); credentials or another form give none', () => {
    assert.deepEqual(webFromRequest('https://Code.Nordlicht.example.test/team/sub/website/-/merge_requests/9#note_1', 'gitlab'), { base: 'https://code.nordlicht.example.test/team/sub/website', forge: 'gitlab' })
    assert.deepEqual(webFromRequest('https://github.example.com/nordlicht/website/pull/7', 'github'), GITHUB_WEB)
    assert.equal(webFromRequest('https://user:pw@gitlab.example.test/a/b/-/merge_requests/1', 'gitlab'), null)
    assert.equal(webFromRequest('https://github.example.com/nordlicht/website/pull/7', 'gitlab'), null)
    assert.equal(webFromRequest('https://gitlab.example.test/a/b/-/merge_requests/new?x=1', 'gitlab'), null)
    // a default port is no part of the address (as a URL writes it)
    assert.deepEqual(webFromRequest('https://Gitlab.Example.test:443/nordlicht/website/-/merge_requests/5', 'gitlab'), GITLAB_WEB)
  })

  test('withRequest: the request\'s address as a URL writes it — it starts with the web address taken from it (One checks that)', () => {
    for (const raw of ['https://Git.Nordlicht.example.test/team/web/-/merge_requests/5', 'https://git.nordlicht.example.test:443/team/web/-/merge_requests/5']) {
      const rec = newShip('pr', 'stage', 'one/x', { base: 'https://git.nordlicht.example.test/team/web', forge: 'gitlab' })
      withRequest(rec, raw, 'opened')
      assert.equal(rec.request!.url, 'https://git.nordlicht.example.test/team/web/-/merge_requests/5', raw)
      assert.ok(rec.request!.url.startsWith(`${rec.web!.base}/`), raw)
    }
  })

  test('the shared rules: cleanWeb, commit / branch links, request numbers', () => {
    assert.deepEqual(cleanWeb(GITLAB_WEB), GITLAB_WEB)
    for (const bad of [{ base: 'javascript:alert(1)//a/b', forge: 'gitlab' }, { base: 'https://u:p@h.example.test/a/b', forge: 'gitlab' }, { base: 'https://h.example.test/a', forge: 'gitlab' }, { base: 'https://h.example.test/a/..', forge: 'gitlab' }, { base: 'https://h.example.test/a/b', forge: 'bitbucket' }, { base: 'https://h.example.test/a/b?x', forge: 'github' }, null, 'https://h.example.test/a/b'])
      assert.equal(cleanWeb(bad), null, JSON.stringify(bad))
    const sha = 'a'.repeat(40)
    assert.equal(commitUrl(GITLAB_WEB, sha), `${GITLAB_WEB.base}/-/commit/${sha}`)
    assert.equal(commitUrl(GITHUB_WEB, sha), `${GITHUB_WEB.base}/commit/${sha}`)
    assert.equal(branchUrl(GITLAB_WEB, 'one/launch plan'), `${GITLAB_WEB.base}/-/tree/one/launch%20plan`)
    assert.deepEqual(requestNumber(MR), { kind: 'mr', n: 42 })
    assert.deepEqual(requestNumber(PR), { kind: 'pr', n: 7 })
    assert.match('b'.repeat(64), GIT_SHA)
    assert.doesNotMatch('c'.repeat(39), GIT_SHA)
    assert.ok((WORKER_CAN as readonly string[]).includes('ship'))
  })

  test('gitHint: a push refused as not a fast-forward is pushRejected — a hook or a protected branch ([remote rejected]) is not', () => {
    const nonFf = 'To /srv/remote.git\n ! [rejected]        one/x -> one/x (non-fast-forward)\nerror: failed to push some refs to \'/srv/remote.git\'\nhint: Updates were rejected because the tip of your current branch is behind'
    const fetchFirst = 'To gitlab.example.test:nordlicht/website.git\n ! [rejected]        one/x -> one/x (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally.'
    for (const p of ['linux', 'darwin', 'win32'] as const) {
      assert.equal(gitHint(nonFf, p), 'pushRejected')
      assert.equal(gitHint(fetchFirst, p), 'pushRejected')
    }
    assert.equal(gitHint(' ! [remote rejected] one/x -> one/x (pre-receive hook declined)\nerror: failed to push some refs', 'linux'), null)
    assert.equal(gitHint(' ! [remote rejected] main -> main (protected branch hook declined)', 'linux'), null)
  })
})

describe('the host type in worker.json and on the setup page', () => {
  test('sanitizeConfig: "auto" by default; an unknown value is a problem and "auto" (the repo stays); saveRepos writes it, "auto" removes it', () => {
    const { config, problems } = sanitizeConfig({ repos: [{ name: 'a', path: '/tmp/a' }, { name: 'b', path: '/tmp/b', forge: 'bitbucket' }, { name: 'c', path: '/tmp/c', forge: 'gitlab' }] }, '/tmp/cfg/worker.json')
    assert.deepEqual(config.repos.map((r) => [r.name, r.forge]), [['a', 'auto'], ['b', 'auto'], ['c', 'gitlab']])
    assert.deepEqual(problems, ['repos[1] (b): "forge" must be "auto", "github" or "gitlab" — "auto" is used'])

    const dir = tempDir('forgecfg')
    const repo = plainRepo(join(dir, 'website'))
    const file = join(dir, 'worker.json')
    const choice = { path: repo, name: 'website', baseBranch: 'main', remote: 'origin', testCommand: null, push: true, pr: 'gh' as const, maxUsdPerTask: null }
    const read = () => JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, '')).repos[0]
    assert.deepEqual(saveRepos(file, [{ ...choice, forge: 'gitlab' }], 'local:abc', {}), [])
    assert.equal(read().forge, 'gitlab')
    // a choice without one leaves it as it is
    assert.deepEqual(saveRepos(file, [choice], 'local:abc', {}), [])
    assert.equal(read().forge, 'gitlab')
    assert.deepEqual(saveRepos(file, [{ ...choice, forge: 'auto' }], 'local:abc', {}), [])
    assert.equal(read().forge, undefined)
    // one the worker does not know (written by hand) is saved as "auto", never a refusal
    writeFileSync(file, JSON.stringify({ repos: [{ name: 'website', path: repo, forge: 'bitbucket' }] }))
    assert.deepEqual(saveRepos(file, [choice], 'local:abc', {}), [])
    assert.equal(read().forge, undefined)
  })

  test('the setup page: each row\'s host type and what "Automatic" reads from the host\'s name; Save writes it', async () => {
    const home = tempDir('home')
    const lab = plainRepo(join(home, 'code', 'website'), { 'README.md': '# w\n' }, GITLAB)
    const own = plainRepo(join(home, 'code', 'tessera'), { 'README.md': '# t\n' }, 'git@git.nordlicht.example.test:team/tessera.git')
    const file = join(home, '.config', 'one', 'worker.json')
    let config = sanitizeConfig({ repos: [{ name: 'tessera', path: own, forge: 'gitlab' }] }, file).config
    const server = new SetupServer({
      configFile: file,
      port: PORT,
      preset: null,
      version: 'test',
      log: () => {},
      config: () => config,
      reload: async () => {
        config = sanitizeConfig(JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, '')), file).config
      },
      live: () => ({ workspace: null, connected: null, busy: [], log: [], claude: { found: false, version: null } }),
      home,
    })
    assert.equal((await server.add(lab)).ok, true)
    assert.equal((await server.add(own)).ok, true)
    const rows = () => Object.fromEntries(server.repos().map((r) => [r.name, [r.forge, r.forgeAuto]]))
    assert.deepEqual(rows(), { tessera: ['gitlab', null], website: ['auto', 'gitlab'] })
    const body = (name: string, path: string, forge?: string) => ({ path, name, baseBranch: 'main', test: '', push: true, pr: 'gh', ...(forge ? { forge } : {}) })
    assert.deepEqual(await server.save({ repos: [body('tessera', own, 'github'), body('website', lab, 'auto')] }), [])
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, ''))
    assert.deepEqual(raw.repos.map((r: { name: string; forge?: string }) => [r.name, r.forge]), [['tessera', 'github'], ['website', undefined]])
    assert.deepEqual(rows(), { tessera: ['github', null], website: ['auto', 'gitlab'] })
    // a value the page does not know: left as it is
    assert.deepEqual(await server.save({ repos: [body('tessera', own, 'bitbucket'), body('website', lab)] }), [])
    assert.deepEqual(rows(), { tessera: ['github', null], website: ['auto', 'gitlab'] })
  })
})
