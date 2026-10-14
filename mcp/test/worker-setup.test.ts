/**
 * one-worker, made simple: the download's preset (workspace, origin, port, pairing secret), the pairing itself
 * (the built bundle with a preset line, as One's download writes it), the repo scan against a temp home
 * (nested repos found; node_modules, hidden folders and symbolic links skipped; caps), the test-command
 * guesses, the local setup page's API (its key, Host and Origin checks, saving worker.json 0600 with only the
 * ticked repos, rescan, "Add a folder", the per-repo switch for the repo's own Claude Code settings), `open-setup`
 * (and that it opens nothing without a setup page) and the terminal checklist. A fake browser opener and a fake
 * Claude Code CLI — nothing leaves the machine.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { WORKER_CLOSE_REFUSED, WORKER_CLOUD_PORT, WORKER_DEFAULT_PORT, cloudOriginAllowed, cloudWorkerPort, type OpenSetupResult, type WorkerMessage, type WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { readPreset, relayUrl, workerOrigins, sameSecret } from '../src/worker/preset.ts'
import { cloudConfigFile, cloudOf, defaultConfigFile, saveRepos, splitArgs, withPreset, sanitizeConfig } from '../src/worker/config.ts'
import { readdir } from 'node:fs/promises'
import { findRepos, guessAnalyzeAsync, guessTest, remoteHost, repoFacts, factsOf, suggestName, shortPath } from '../src/worker/scan.ts'
import { pickerCommand } from '../src/worker/picker.ts'
import { checklistText } from '../src/worker/checklist.ts'
import { browserCommand } from '../src/worker/opener.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, IS_WIN, cleanupAll, fakeOpener, linkDir, plainRepo, presetBundle, sh, spawnWorker, tempDir, type SpawnedWorker } from './worker-helpers.ts'

const PORT = 47384
const ORIGIN = 'http://127.0.0.1:5350'
const PAIR = 'pAiRsEcReT_0123456789-abcdefghijklmnopqrstu'
const WS: WorkspaceRef = { id: 'local:setup-ws-1', name: 'Studio', kind: 'local', readOnly: false }
const PRESET = { workspace: WS.id, origin: ORIGIN, port: PORT, pair: PAIR, name: 'Studio' }

let worker: SpawnedWorker | null = null
const tabs: FakeTab[] = []

afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})
after(cleanupAll)

/** A temp home with repos in the usual places and in places that must be skipped. */
function makeHome(): { home: string; outside: string } {
  const home = tempDir('home')
  plainRepo(join(home, 'code', 'alpha'), { 'README.md': '# a\n', 'package.json': '{"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': '' }, 'https://user:s3cret-token@github.com/me/alpha.git')
  plainRepo(join(home, 'code', 'group', 'beta'), { 'Cargo.toml': '[package]\n' }, 'git@gitlab.com:me/beta.git')
  plainRepo(join(home, 'projects', 'gamma'), { 'go.mod': 'module x\n' })
  plainRepo(join(home, 'a', 'b', 'c', 'delta'))
  plainRepo(join(home, 'a', 'b', 'c', 'd', 'too-deep'))
  plainRepo(join(home, 'stuff', 'node_modules', 'pkg'))
  plainRepo(join(home, '.hidden', 'secret'))
  plainRepo(join(home, 'dist', 'built'))
  // a linked worktree / submodule: a .git FILE
  mkdirSync(join(home, 'code', 'linked'), { recursive: true })
  writeFileSync(join(home, 'code', 'linked', '.git'), 'gitdir: /elsewhere\n')
  // symbolic links are never followed: neither to a repo inside nor to one outside the home folder (junctions on Windows)
  const outside = plainRepo(join(tempDir('outside'), 'zeta'))
  mkdirSync(join(home, 'links'))
  linkDir(join(home, 'code', 'alpha'), join(home, 'links', 'alias'))
  linkDir(outside, join(home, 'links', 'zeta'))
  return { home, outside }
}

/** The setup page's state once its search is done (it answers at once and reports `scan.running` meanwhile). */
async function doneState(token: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 100; i++) {
    const st = (await call('/setup/api/state', { token })).json()
    if (st.scan && !st.scan.running) return st
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the search did not end')
}

function call(path: string, opts: { method?: string; host?: string; origin?: string; token?: string; body?: unknown; type?: string; port?: number } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; json: () => any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const port = opts.port ?? PORT
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? null : JSON.stringify(opts.body)
    const req = request({ host: '127.0.0.1', port, path, method: opts.method ?? (body ? 'POST' : 'GET'), headers: { host: opts.host ?? `127.0.0.1:${port}`, ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.token ? { 'x-one-setup': opts.token } : {}), ...(body ? { 'content-type': opts.type ?? 'application/json' } : {}) } }, (res) => {
      let text = ''
      res.on('data', (d: Buffer) => (text += d.toString()))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const tokenOf = (url: string) => /#k=([A-Za-z0-9_-]{43})$/.exec(url)?.[1] ?? ''
const SELF = `http://127.0.0.1:${PORT}`

async function connect(pair: string | null = PAIR, workspace = WS, origin = ORIGIN): Promise<FakeTab> {
  const tab = await FakeTab.connect(PORT, { origin })
  tabs.push(tab)
  tab.hello(workspace, pair ?? undefined)
  return tab
}

describe('the preset of a download', () => {
  test('a valid preset is read; anything off makes it ignored as a whole', () => {
    const ok = readPreset({ ...PRESET, name: 'My\u0007 Studio', dev: true })
    assert.deepEqual(ok.preset, { ...PRESET, name: 'My Studio', dev: true })
    assert.equal(readPreset(undefined).preset, null)
    assert.equal(readPreset(undefined).problem, null)
    for (const bad of [{ workspace: 'nope' }, { origin: 'javascript:alert(1)' }, { origin: 'https://one.example/path' }, { origin: 'http://localhost:*' }, { port: 80 }, { port: '47322' }, { pair: 'short' }, { pair: undefined }]) {
      const r = readPreset({ ...PRESET, ...bad })
      assert.equal(r.preset, null, JSON.stringify(bad))
      assert.ok(r.problem)
    }
    assert.equal(readPreset('x').preset, null)
  })

  test('origins: only the preset site (+ loopback with dev) and what the person added — not the defaults', () => {
    const p = readPreset(PRESET).preset!
    assert.deepEqual(workerOrigins(p, []), [ORIGIN])
    assert.deepEqual(workerOrigins({ ...p, dev: true }, []), [ORIGIN, 'http://localhost:*', 'http://127.0.0.1:*'])
    assert.deepEqual(workerOrigins(p, ['https://one.example.com']), [ORIGIN, 'https://one.example.com'])
    assert.ok(workerOrigins(null, []).includes('https://getonecms.com'))
  })

  test('the preset fixes workspace and port; ONE_WORKER_PORT still wins; the secret compares in constant time', () => {
    const base = sanitizeConfig({ workspace: 'local:other', port: 50000, repos: [] }, '/tmp/x/worker.json', {}).config
    const p = readPreset(PRESET).preset!
    const c = withPreset(base, p, {})
    assert.equal(c.workspace, WS.id)
    assert.equal(c.port, PORT)
    assert.equal(withPreset(base, p, { ONE_WORKER_PORT: '47389' }).port, 47389)
    assert.equal(withPreset(base, null, {}).workspace, 'local:other')
    assert.equal(sameSecret(PAIR, PAIR), true)
    assert.equal(sameSecret(PAIR, PAIR.slice(0, -1) + 'v'), false)
    assert.equal(sameSecret(PAIR, undefined), false)
    assert.equal(sameSecret(PAIR, 42), false)
  })

  test('a cloud preset: a worker token, a team workspace, TLS (plain http only on this computer), the pairing secret kept', () => {
    const TOKEN = `onew_${'A'.repeat(43)}`
    const CLOUD = { workspace: 'team:Ab12cd34', origin: 'https://one.example.com', port: 47323, pair: PAIR, name: 'Team', cloud: { token: TOKEN } }
    assert.deepEqual(readPreset(CLOUD).preset, CLOUD)
    assert.deepEqual(readPreset({ ...CLOUD, origin: 'http://127.0.0.1:4500', dev: true }).preset?.cloud, { token: TOKEN })
    assert.equal(readPreset({ ...CLOUD, origin: 'http://localhost:4500' }).preset?.origin, 'http://localhost:4500')
    for (const [bad, why] of [
      [{ cloud: { token: 'one_' + 'A'.repeat(43) } }, /not a worker token/],
      [{ cloud: {} }, /not a worker token/],
      [{ cloud: 'onew_x' }, /not a worker token/],
      [{ workspace: 'local:abc' }, /team workspace/],
      [{ origin: 'http://one.example.com' }, /https origin/],
      [{ pair: undefined }, /pairing secret/],
    ] as const) {
      const r = readPreset({ ...CLOUD, ...bad })
      assert.equal(r.preset, null, JSON.stringify(bad))
      assert.match(r.problem ?? '', why)
    }
    assert.equal(relayUrl('https://one.example.com'), 'wss://one.example.com/coding/worker')
    assert.equal(relayUrl('http://127.0.0.1:4500'), 'ws://127.0.0.1:4500/coding/worker')
    // the preset's port (One writes 47323 for cloud downloads) — ONE_WORKER_PORT still wins
    const base = sanitizeConfig({ repos: [] }, '/tmp/x/worker.json', {}).config
    const c = withPreset(base, readPreset(CLOUD).preset, {})
    assert.equal(c.port, 47323)
    assert.deepEqual(cloudOf(c), { origin: 'https://one.example.com', token: TOKEN })
    assert.equal(cloudOf(withPreset(base, readPreset(PRESET).preset, {})), null)
  })

  test('one rule for the tab and the worker: a cloud link needs https (plain http only on this computer); each workspace its own cloud port', () => {
    for (const ok of ['https://one.example.com', 'https://one.example.com:8443', 'http://127.0.0.1:4500', 'http://localhost:5173', 'http://[::1]:4500']) assert.equal(cloudOriginAllowed(ok), true, ok)
    for (const no of ['http://one.lan:8080', 'http://192.168.1.20:4500', 'http://localhost.example.com', 'ftp://one.example.com', 'not a url']) assert.equal(cloudOriginAllowed(no), false, no)
    // the port a cloud download carries: stable per workspace, apart for two workspaces, never the local default
    assert.equal(cloudWorkerPort('team:Ab12cd34'), cloudWorkerPort('team:Ab12cd34'))
    assert.notEqual(cloudWorkerPort('team:Ab12cd34'), cloudWorkerPort('team:Zz98yx76'))
    for (const id of ['team:Ab12cd34', 'team:Zz98yx76', 'team:x', 'team:' + 'q'.repeat(64)]) {
      const port = cloudWorkerPort(id)
      assert.ok(port >= WORKER_CLOUD_PORT && port < WORKER_CLOUD_PORT + 500 && port !== WORKER_DEFAULT_PORT, `${id} → ${port}`)
    }
  })

  test('a cloud worker keeps its own folder: config, state and worktrees never meet a local worker\'s', () => {
    const home = homedir()
    assert.ok(cloudConfigFile('team:Ab12cd34').startsWith(join(home, '.config', 'one', 'cloud', 'team-Ab12cd34')))
    assert.notEqual(cloudConfigFile('team:Ab12cd34'), defaultConfigFile())
    assert.notEqual(cloudConfigFile('team:Ab12cd34'), cloudConfigFile('team:Other999'))
    // default worktrees: next to the repo (local) · in the cloud worker's own folder (cloud)
    const dir = tempDir('cloudcfg')
    const repo = plainRepo(join(dir, 'code', 'site'))
    const local = sanitizeConfig({ repos: [{ name: 'site', path: repo }] }, join(dir, 'local', 'worker.json'), {}).config
    const cloud = sanitizeConfig({ repos: [{ name: 'site', path: repo }] }, join(dir, 'cloud', 'worker.json'), {}, { cloud: true }).config
    assert.equal(local.repos[0]!.worktreeDir, join(dir, 'code', '.one-worktrees', 'site'))
    assert.equal(cloud.repos[0]!.worktreeDir, join(dir, 'cloud', 'worktrees', 'site'))
    // saving one worker's repos leaves the other's file alone
    const localFile = join(dir, 'local', 'worker.json')
    const cloudFile = join(dir, 'cloud', 'worker.json')
    const choice = { path: repo, name: 'site', baseBranch: 'main', remote: null, testCommand: null, push: false, pr: 'none' as const, maxUsdPerTask: null }
    assert.deepEqual(saveRepos(localFile, [choice], 'local:abc', {}), [])
    const before = readFileSync(localFile, 'utf8')
    assert.deepEqual(saveRepos(cloudFile, [{ ...choice, name: 'site-cloud' }], 'team:Ab12cd34', {}), [])
    assert.equal(readFileSync(localFile, 'utf8'), before)
    assert.match(readFileSync(cloudFile, 'utf8'), /"team:Ab12cd34"/)
  })
})

describe('pairing (the built bundle with a preset line)', () => {
  test('the right secret connects; none, a wrong one or another workspace is refused; other origins never get in', async () => {
    const home = tempDir('home')
    // a worker.json that names another workspace and port: the preset wins
    const repo = plainRepo(join(home, 'code', 'site'))
    mkdirSync(join(home, '.config', 'one'), { recursive: true })
    writeFileSync(join(home, '.config', 'one', 'worker.json'), JSON.stringify({ workspace: 'local:someone-else', port: 47389, repos: [{ name: 'site', path: repo }] }))
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home })
    assert.match(worker.stderr(), /ready on ws:\/\/127\.0\.0\.1:47384 .*workspace local:setup-ws-1 \("Studio", paired download\)/)

    const missing = await connect(null)
    await waitFor(() => missing.closed !== null)
    assert.equal(missing.closed!.code, WORKER_CLOSE_REFUSED)
    assert.deepEqual(missing.messages, [{ type: 'refused', reason: 'pair', paired: true }])

    const wrong = await connect(PAIR.replace('p', 'q'))
    await waitFor(() => wrong.closed !== null)
    assert.deepEqual(wrong.messages, [{ type: 'refused', reason: 'pair', paired: true }])

    const other = await connect(PAIR, { ...WS, id: 'local:another-one' })
    await waitFor(() => other.closed !== null)
    assert.deepEqual(other.messages, [{ type: 'refused', reason: 'workspace', paired: true }])

    // the general defaults are not accepted: only the site the download came from
    await assert.rejects(FakeTab.connect(PORT, { origin: 'https://getonecms.com' }), /HTTP 403/)
    await assert.rejects(FakeTab.connect(PORT, { origin: 'http://localhost:5350' }), /HTTP 403/)

    const tab = await connect()
    const welcome = await tab.next('welcome')
    // push / pr: worker.json's flags (defaults: on, gh) — One's pipeline editor warns about a git stage they turn off
    assert.deepEqual(welcome.repos, [{ name: 'site', baseBranch: 'main', branches: ['main'], mcp: [], push: true, pr: 'gh' }])
    assert.equal(welcome.paired, true)
    assert.equal(welcome.setup, true)
    assert.match(worker.stderr(), /did not bring this download's pairing key/)
    assert.ok(!worker.stderr().includes(PAIR), 'the secret is never logged')
  })

  test('a dev preset accepts any loopback port of this machine', async () => {
    const home = tempDir('home')
    plainRepo(join(home, 'code', 'site'))
    worker = await spawnWorker({ bundle: presetBundle({ ...PRESET, dev: true }), home, args: ['--no-browser'] })
    const tab = await connect(PAIR, WS, 'http://localhost:5999')
    await tab.next('welcome')
  })
})

describe('finding the repos', () => {
  test('nested repos in the usual places and the home folder; node_modules, hidden, build outputs, .git files and links skipped', async () => {
    const { home } = makeHome()
    plainRepo(home) // a dotfiles repo in the home folder itself is not offered — and does not hide the rest
    const r = await findRepos({ home })
    const found = r.paths.map((p) => shortPath(p, home)).sort()
    assert.deepEqual(found, ['~/a/b/c/delta', '~/code/alpha', '~/code/group/beta', '~/projects/gamma'])
    assert.equal(r.capped, null)
  })

  test('caps: count, folders, time', async () => {
    const { home } = makeHome()
    const count = await findRepos({ home, maxRepos: 2 })
    assert.equal(count.paths.length, 2)
    assert.equal(count.capped, 'count')
    const dirs = await findRepos({ home, maxDirs: 2 })
    assert.equal(dirs.capped, 'dirs')
    const time = await findRepos({ home, timeMs: -1 })
    assert.equal(time.capped, 'time')
    assert.equal(time.paths.length, 0)
  })

  test('a folder that never answers (a macOS permission dialog) is skipped and reported; the search still ends', async () => {
    const { home } = makeHome()
    const stuck = join(home, 'projects')
    const t0 = Date.now()
    const r = await findRepos({
      home,
      folderMs: 200,
      readdir: (p) => (p === stuck ? new Promise<never>(() => {}) : readdir(p, { withFileTypes: true })),
    })
    assert.ok(Date.now() - t0 < 4000, 'the search ended')
    assert.deepEqual(r.blocked, ['~/projects'])
    const found = r.paths.map((p) => shortPath(p, home)).sort()
    assert.ok(found.includes('~/code/alpha') && !found.includes('~/projects/gamma'))
  })

  test('facts: branch, base, the remote HOST only (never the URL), dirty, last commit, test guess', async () => {
    const { home } = makeHome()
    const alpha = join(home, 'code', 'alpha')
    sh(alpha, 'checkout', '--quiet', '-b', 'feature/x')
    writeFileSync(join(alpha, 'new.txt'), 'x\n')
    writeFileSync(join(alpha, 'README.md'), '# changed\n')
    const taken = new Set<string>()
    const facts = await repoFacts(alpha, taken, home)
    assert.equal(facts.name, 'alpha')
    assert.equal(facts.short, '~/code/alpha')
    assert.equal(facts.branch, 'feature/x')
    assert.equal(facts.base, 'main')
    assert.equal(facts.remote, 'origin')
    assert.equal(facts.host, 'github.com')
    assert.equal(facts.dirty, 2)
    assert.ok(facts.lastCommit && Date.now() - facts.lastCommit < 120_000)
    assert.deepEqual(facts.test, ['pnpm', 'test'])
    assert.ok(!JSON.stringify(facts).includes('s3cret'), 'no credentials of the remote URL')
    const beta = await repoFacts(join(home, 'code', 'group', 'beta'), taken, home)
    assert.equal(beta.host, 'gitlab.com')
    assert.deepEqual(beta.test, ['cargo', 'test'])
    // origin/HEAD names the base
    sh(beta.path, 'update-ref', 'refs/remotes/origin/develop', 'HEAD')
    sh(beta.path, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    assert.equal((await repoFacts(beta.path, new Set(), home)).base, 'develop')
    // same folder names: unique names in order
    const twice = await factsOf([alpha, join(home, 'code', 'alpha')], new Set(), home)
    assert.deepEqual(twice.map((f) => f.name), ['alpha', 'alpha-2'])
  })

  test('names and hosts', () => {
    const taken = new Set(['site'])
    assert.equal(suggestName('/x/Site', taken), 'Site-2')
    assert.equal(suggestName('/x/Mein Projekt (alt)', taken), 'Mein-Projekt-alt')
    assert.equal(suggestName('/x/...', taken), 'repo')
    assert.equal(remoteHost('https://u:p@GitHub.com:443/a/b.git'), 'github.com')
    assert.equal(remoteHost('git@github.com:a/b.git'), 'github.com')
    assert.equal(remoteHost('ssh://git@host.example:22/x.git'), 'host.example')
    assert.equal(remoteHost('/srv/git/x.git'), 'local')
    assert.equal(remoteHost('C:\\repos\\x'), 'local')
    assert.equal(remoteHost('file:///srv/x.git'), 'local')
  })
})

describe('test command guesses', () => {
  const dir = (files: Record<string, string>) => {
    const d = tempDir('guess')
    for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t)
    return d
  }
  test('package.json by lockfile, Cargo, Go, pytest, make — always argv; placeholders and links give nothing', () => {
    const pkg = '{"scripts":{"test":"node --test"}}'
    assert.deepEqual(guessTest(dir({ 'package.json': pkg })), ['npm', 'test'])
    assert.deepEqual(guessTest(dir({ 'package.json': pkg, 'pnpm-lock.yaml': '' })), ['pnpm', 'test'])
    assert.deepEqual(guessTest(dir({ 'package.json': pkg, 'yarn.lock': '' })), ['yarn', 'test'])
    assert.equal(guessTest(dir({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), null)
    assert.equal(guessTest(dir({ 'package.json': '{"scripts":{"build":"vite"}}' })), null)
    assert.equal(guessTest(dir({ 'package.json': 'not json' })), null)
    assert.deepEqual(guessTest(dir({ 'Cargo.toml': '' })), ['cargo', 'test'])
    assert.deepEqual(guessTest(dir({ 'go.mod': '' })), ['go', 'test', './...'])
    assert.deepEqual(guessTest(dir({ 'pyproject.toml': '' })), ['pytest'])
    assert.deepEqual(guessTest(dir({ 'pytest.ini': '' })), ['pytest'])
    assert.deepEqual(guessTest(dir({ Makefile: 'build:\n\tcc x.c\n\ntest: build\n\t./run\n' })), ['make', 'test'])
    assert.equal(guessTest(dir({ Makefile: 'build:\n\tcc x.c\nTEST := 1\n' })), null)
    const linked = dir({})
    symlinkSync(join(dir({ 'package.json': pkg }), 'package.json'), join(linked, 'package.json'))
    assert.equal(guessTest(linked), null)
  })

  test('static analysis guesses: the lint script by lockfile, ESLint, dotnet, go vet, clippy, ruff, flake8 — argv; nothing known gives nothing', async () => {
    const lint = '{"scripts":{"lint":"eslint src"}}'
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'package.json': lint })), ['npm', 'run', 'lint'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'package.json': lint, 'pnpm-lock.yaml': '' })), ['pnpm', 'run', 'lint'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'package.json': '{"scripts":{}}', 'eslint.config.js': '' })), ['npx', 'eslint', '.'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'Billing.sln': '' })), ['dotnet', 'build', '-nologo', '-clp:Summary'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'go.mod': '' })), ['go', 'vet', './...'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'Cargo.toml': '' })), ['cargo', 'clippy'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ 'pyproject.toml': '[tool.ruff]\nline-length = 100\n' })), ['ruff', 'check', '.'])
    assert.deepEqual(await guessAnalyzeAsync(dir({ '.flake8': '' })), ['flake8'])
    assert.equal(await guessAnalyzeAsync(dir({ 'README.md': '' })), null)
  })

  test('a command line becomes argv without a shell', () => {
    // macOS / Linux rules (a backslash escapes) — Windows keeps it: worker-win.test.ts
    assert.deepEqual(splitArgs('npm run test -- --ci', 'linux'), ['npm', 'run', 'test', '--', '--ci'])
    assert.deepEqual(splitArgs(`pytest -k "slow and not db" 'a b' c\\ d`, 'linux'), ['pytest', '-k', 'slow and not db', 'a b', 'c d'])
    assert.deepEqual(splitArgs('make test && rm -rf /', 'linux'), ['make', 'test', '&&', 'rm', '-rf', '/'])
    assert.deepEqual(splitArgs('  ', 'linux'), [])
    assert.deepEqual(splitArgs('a ""', 'linux'), ['a', ''])
  })

  test('the opener: argv only, none when switched off or headless', () => {
    const url = `${SELF}/setup#k=${'k'.repeat(43)}`
    assert.equal(browserCommand(url, { ONE_WORKER_BROWSER: 'none', DISPLAY: ':0' }, 'linux'), null)
    assert.equal(browserCommand(url, {}, 'linux'), null)
    assert.deepEqual(browserCommand(url, { DISPLAY: ':0' }, 'linux')!.args, [url])
    assert.equal(browserCommand(url, {}, 'darwin')!.cmd, 'open')
    // Windows: cmd.exe by its path in System32, no AutoRun (exec.test.ts has the details)
    assert.deepEqual(browserCommand(url, {}, 'win32')!.args, ['/d', '/c', 'start', '""', url])
  })
})

describe('the setup page', () => {
  test('Choose a folder…: the computer\'s own dialog (fixed arguments) — a picked repo is added, a plain folder refused, cancel and no dialog said so', async () => {
    assert.equal(pickerCommand({}, 'darwin')!.cmd, 'osascript')
    assert.ok(pickerCommand({}, 'darwin')!.args.join(' ').includes('choose folder'))
    assert.match(pickerCommand({}, 'win32')!.cmd, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/)
    assert.equal(pickerCommand({}, 'linux'), null)
    assert.equal(pickerCommand({ DISPLAY: ':0' }, 'linux')!.cmd, 'zenity')
    assert.equal(pickerCommand({ ONE_WORKER_PICKER: 'none' }, 'darwin'), null)

    const { home, outside } = makeHome()
    const plain = join(home, 'Documents', 'zip-download-main')
    mkdirSync(plain, { recursive: true })
    // a fake dialog: prints whatever the test put into its answer file (empty = cancelled)
    const dir = tempDir('picker')
    const answer = join(dir, 'answer.txt')
    const program = join(dir, 'pick.mjs')
    // started by its path: a Node script on Windows (exec.ts), an executable with this line elsewhere
    writeFileSync(program, `#!${process.execPath}\nimport { readFileSync } from 'node:fs'\nconst a = readFileSync(${JSON.stringify(answer)}, 'utf8')\nif (!a) process.exit(1)\nprocess.stdout.write(a + '/\\n')\n`)
    if (!IS_WIN) chmodSync(program, 0o755)
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { ONE_WORKER_BROWSER: opener.program, ONE_WORKER_PICKER: program } })
    await waitFor(() => opener.urls().length === 1, 8000, () => worker!.stderr())
    const token = tokenOf(opener.urls()[0]!)
    const pick = () => call('/setup/api/pick', { token, origin: SELF, body: {} })
    assert.equal((await call('/setup/api/pick', { token, body: {} })).status, 403, 'POST needs the page origin')

    writeFileSync(answer, outside)
    const added = await pick()
    assert.equal(added.status, 200, added.text)
    assert.equal(added.json().added, outside)
    assert.ok(added.json().state.repos.some((r: { path: string }) => r.path === outside))

    writeFileSync(answer, plain)
    const refused = await pick()
    assert.equal(refused.status, 400)
    assert.match(refused.json().error, /zip-download-main — .*no \.git folder/)

    writeFileSync(answer, '')
    assert.deepEqual((await pick()).json(), { cancelled: true })
  })

  test('key, Host and Origin checks; it lists the repos; Add a folder; Rescan; Save writes worker.json 0600 with only the ticked repos and One sees them', async () => {
    const { home, outside } = makeHome()
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { ONE_WORKER_BROWSER: opener.program } })
    // first start without repos: the page opens by itself
    await waitFor(() => opener.urls().length === 1, 8000, () => worker!.stderr())
    const url = opener.urls()[0]!
    assert.match(url, /^http:\/\/127\.0\.0\.1:47384\/setup#k=[A-Za-z0-9_-]{43}$/)
    await waitFor(() => /Tick your repositories: http:\/\/127\.0\.0\.1:47384\/setup#k=/.test(worker!.stdout()))
    const token = tokenOf(url)
    const tab = await connect()
    const welcome = await tab.next('welcome')
    assert.deepEqual(welcome.repos, [])

    // the static page: its own CSP, never under another Host
    const page = await call('/setup')
    assert.equal(page.status, 200)
    assert.match(page.text, /<script src="\/setup\/app.js" defer>/)
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'; script-src 'self'/)
    assert.equal(page.headers['access-control-allow-origin'], undefined)
    assert.equal((await call('/setup', { host: `localhost:${PORT}` })).status, 403)
    assert.equal((await call('/setup', { host: `evil.example:${PORT}` })).status, 403)
    assert.equal((await call('/setup/app.js')).status, 200)

    // the API: key required, compared exactly
    assert.equal((await call('/setup/api/state')).status, 401)
    assert.equal((await call('/setup/api/state', { token: token.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) })).status, 403)
    assert.equal((await call('/setup/api/state', { token, host: `localhost:${PORT}` })).status, 403)
    const first = (await call('/setup/api/state', { token })).json()
    assert.equal(first.workspace.name, 'Studio')
    const state = await doneState(token)
    assert.equal(state.workspace.name, 'Studio')
    assert.equal(state.workspace.paired, true)
    assert.deepEqual(state.repos.map((r: { short: string }) => r.short).sort(), ['~/a/b/c/delta', '~/code/alpha', '~/code/group/beta', '~/projects/gamma'])
    const alpha = state.repos.find((r: { name: string }) => r.name === 'alpha')
    assert.equal(alpha.ticked, false)
    assert.equal(alpha.testLine, 'pnpm test')
    assert.equal(alpha.analyzeLine, '')
    assert.equal(alpha.host, 'github.com')

    // POSTs: same Origin, JSON, key
    const save = (body: unknown, extra: Parameters<typeof call>[1] = {}) => call('/setup/api/save', { token, origin: SELF, body, ...extra })
    const pick = { repos: [{ path: alpha.path, name: 'alpha', baseBranch: 'main', test: 'npm run test -- --ci', analyze: 'npx eslint src --max-warnings 0', push: true, pr: 'gh', maxUsdPerTask: 4 }] }
    assert.equal((await save(pick, { origin: undefined })).status, 403)
    assert.equal((await save(pick, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await save(pick, { origin: `http://localhost:${PORT}` })).status, 403)
    assert.equal((await save(pick, { token: undefined })).status, 401)
    assert.equal((await save(pick, { type: 'text/plain' })).status, 415)
    assert.equal((await save({ repos: [{ ...pick.repos[0], path: '/etc' }] })).status, 400)
    assert.equal((await save({ repos: [{ ...pick.repos[0], name: 'bad name!' }] })).status, 400)
    assert.ok(!existsSync(join(home, '.config', 'one', 'worker.json')), 'nothing written for a refused save')

    // Add a folder: a main checkout only; relative paths stay in the home folder; a typed absolute path may be anywhere
    const add = (path: string) => call('/setup/api/add', { token, origin: SELF, body: { path } })
    assert.equal((await add('nowhere/at/all')).status, 400)
    assert.equal((await add('../../etc')).status, 400)
    assert.equal((await add(join(home, 'a'))).status, 400)
    assert.equal((await add('~/code/linked')).status, 400)
    const added = await add(outside)
    assert.equal(added.status, 200, added.text)
    assert.ok(added.json().state.repos.some((r: { path: string }) => r.path === outside))
    // rescan keeps the added folder
    const rescanned = (await call('/setup/api/scan', { token, origin: SELF, body: {} })).json()
    assert.ok(rescanned.repos.some((r: { path: string }) => r.path === outside))

    // Save: only the ticked repo, argv test command, 0600; One gets a fresh welcome with it
    const saved = await save(pick)
    assert.equal(saved.status, 200, saved.text)
    const file = join(home, '.config', 'one', 'worker.json')
    // Windows keeps no mode bits (the private file there is its ACL — docs/CODING.md § Windows)
    if (!IS_WIN) assert.equal(statSync(file).mode & 0o777, 0o600)
    const written = sanitizeConfig(JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, '')), file, {})
    assert.deepEqual(written.problems, [])
    assert.equal(written.config.workspace, WS.id)
    assert.deepEqual(written.config.repos.map((r) => [r.name, r.testCommand, r.maxUsdPerTask, r.pr]), [['alpha', ['npm', 'run', 'test', '--', '--ci'], 4, 'gh']])
    assert.deepEqual(written.config.repos[0]!.analyzeCommand, ['npx', 'eslint', 'src', '--max-warnings', '0'])
    assert.match(readFileSync(file, 'utf8'), /"path": "~\/code\/alpha"/)
    await waitFor(() => tab.messages.filter((m) => m.type === 'welcome').length === 2)
    const again = tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'welcome' }> => m.type === 'welcome')[1]!
    assert.deepEqual(again.repos, [{ name: 'alpha', baseBranch: 'main', branches: ['main'], mcp: [], push: true, pr: 'gh' }])
    const after = saved.json()
    assert.equal(after.repos[0].ticked, true)
    assert.equal(after.live.connected.name, 'Studio')

    // "Change repositories" in One: the worker opens the page itself; One learns nothing of its address
    const res = await tab.request({ op: 'open-setup' })
    assert.equal(res.ok, true)
    assert.deepEqual((res as { result: OpenSetupResult }).result, { opened: true })
    assert.ok(!JSON.stringify(tab.raw).includes(token), 'One never sees the key')
    await waitFor(() => opener.urls().length === 2)
    assert.equal(opener.urls()[1], url)

    // untick: no repos left — One is told at once
    assert.equal((await save({ repos: [] })).status, 200)
    await waitFor(() => tab.messages.filter((m) => m.type === 'welcome').length === 3)
  })

  test('without a setup page (--no-browser): open-setup opens nothing and /setup is not served', async () => {
    const home = tempDir('home')
    const repo = plainRepo(join(home, 'code', 'site'))
    mkdirSync(join(home, '.config', 'one'), { recursive: true })
    writeFileSync(join(home, '.config', 'one', 'worker.json'), JSON.stringify({ repos: [{ name: 'site', path: repo }] }))
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, args: ['--no-browser'], env: { ONE_WORKER_BROWSER: opener.program } })
    const tab = await connect()
    const welcome = await tab.next('welcome')
    assert.equal(welcome.setup, false)
    const res = await tab.request({ op: 'open-setup' })
    assert.deepEqual((res as { result: OpenSetupResult }).result, { opened: false, reason: 'off' })
    assert.equal((await call('/setup')).status, 426)
    await new Promise((r) => setTimeout(r, 300))
    assert.deepEqual(opener.urls(), [])
  })

  test('per repo, "Use this repo\'s own Claude Code settings": off with the reason for code from elsewhere, on for the person\'s own; Save writes it only with the page\'s key and origin', async () => {
    const home = tempDir('home')
    const shop = plainRepo(join(home, 'code', 'shop'))
    const billing = plainRepo(join(home, 'one-repos', 'billing'))
    writeFileSync(join(billing, '.git', 'one-worker-source'), 'clone\n')
    const legacy = plainRepo(join(home, 'one-repos', 'legacy'))
    writeFileSync(join(legacy, '.git', 'one-worker-source'), 'zip\n')
    const byHand = plainRepo(join(home, 'one-repos', 'by-hand'))
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { ONE_WORKER_BROWSER: opener.program } })
    await waitFor(() => opener.urls().length === 1, 8000, () => worker!.stderr())
    const token = tokenOf(opener.urls()[0]!)
    const own = (st: { repos: Array<{ name: string; ownSettings: boolean; source: string | null }> }) => Object.fromEntries(st.repos.map((r) => [r.name, [r.ownSettings, r.source]]))
    const before = await doneState(token)
    assert.deepEqual(own(before), { shop: [true, null], billing: [false, 'cloned'], legacy: [false, 'imported'], 'by-hand': [false, 'cloneDir'] })

    // the page: the switch, the reasons and the warning in English and German
    const js = (await call('/setup/app.js')).text
    for (const s of ['Use this repo’s own Claude Code settings (.claude/, .mcp.json, CLAUDE.md, local MCP servers)', 'Eigene Claude-Code-Einstellungen dieses Repos nutzen (.claude/, .mcp.json, CLAUDE.md, lokale MCP-Server)', 'cloned by the worker', 'vom Worker geklont', 'in the clone folder', 'im Klon-Ordner', 'will run on this computer when a task starts', 'laufen auf diesem Rechner, wenn eine Aufgabe startet', 'claude mcp add -s user'])
      assert.ok(js.includes(s), s)

    const file = join(home, '.config', 'one', 'worker.json')
    const plain = (path: string, name: string) => ({ path, name, baseBranch: 'main', test: '', push: false, pr: 'none', maxUsdPerTask: null })
    const entry = (path: string, name: string, projectSettings: boolean) => ({ ...plain(path, name), projectSettings })
    const body = { repos: [entry(shop, 'shop', false), entry(billing, 'billing', true), entry(legacy, 'legacy', false), entry(byHand, 'by-hand', false)] }
    const save = (extra: Parameters<typeof call>[1] = {}) => call('/setup/api/save', { token, origin: SELF, body, ...extra })
    // the save path: its key, exactly, and the page's own origin
    assert.equal((await save({ token: undefined })).status, 401)
    assert.equal((await save({ token: token.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) })).status, 403)
    assert.equal((await save({ origin: undefined })).status, 403)
    assert.equal((await save({ origin: 'https://evil.example' })).status, 403)
    assert.equal((await save({ host: `localhost:${PORT}` })).status, 403)
    assert.ok(!existsSync(file), 'nothing written without the page\'s key and origin')

    const saved = await save()
    assert.equal(saved.status, 200, saved.text)
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, ''))
    const claudeOf = (name: string) => raw.repos.find((r: { name: string }) => r.name === name).claude
    // written where it decides something: against the default, and an "off" that rests on the clone folder alone (it
    // would turn on once cloneDir moves); an "off" by the worker's mark needs no key
    assert.deepEqual(claudeOf('shop'), { projectSettings: false })
    assert.deepEqual(claudeOf('billing'), { projectSettings: true })
    assert.equal(claudeOf('legacy'), undefined)
    assert.deepEqual(claudeOf('by-hand'), { projectSettings: false })
    // the worker reads it back so (the page shows the reloaded config)
    assert.deepEqual(own(saved.json()), { shop: [false, null], billing: [true, 'cloned'], legacy: [false, 'imported'], 'by-hand': [false, 'cloneDir'] })

    // a body without the switch (an older page, the terminal checklist) leaves worker.json's keys as they are
    const again = await call('/setup/api/save', { token, origin: SELF, body: { repos: [plain(shop, 'shop'), plain(billing, 'billing'), plain(legacy, 'legacy'), plain(byHand, 'by-hand')] } })
    assert.equal(again.status, 200, again.text)
    assert.deepEqual(own(again.json()), { shop: [false, null], billing: [true, 'cloned'], legacy: [false, 'imported'], 'by-hand': [false, 'cloneDir'] })
    // switched back: the explicit key follows
    const back = await call('/setup/api/save', { token, origin: SELF, body: { repos: [entry(shop, 'shop', true), entry(billing, 'billing', false)] } })
    assert.equal(back.status, 200, back.text)
    const raw2 = JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, ''))
    assert.deepEqual(raw2.repos.map((r: { name: string; claude?: unknown }) => [r.name, r.claude]), [['shop', { projectSettings: true }], ['billing', { projectSettings: false }]])
  })

  test('the one-time marking of an older worker\'s clones is named on the setup page until the person takes note', async () => {
    const home = tempDir('home')
    const billing = plainRepo(join(home, 'one-repos', 'billing'), { 'README.md': '# x\n' }, 'git@gitlab.example.com:acme/billing.git')
    const shop = plainRepo(join(home, 'code', 'shop'), { 'README.md': '# x\n' }, 'git@github.com:me/shop.git')
    mkdirSync(join(home, '.config', 'one'), { recursive: true })
    const file = join(home, '.config', 'one', 'worker.json')
    writeFileSync(file, JSON.stringify({ workspace: WS.id, repos: [{ name: 'billing', path: billing }, { name: 'shop', path: shop }] }))
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, args: ['setup'], env: { ONE_WORKER_BROWSER: opener.program } })
    await waitFor(() => opener.urls().length === 1, 8000, () => worker!.stderr())
    assert.match(worker.stdout() + worker.stderr(), /marked 1 repo\(s\) an older worker cloned or imported as code from elsewhere \(billing\)/)
    const token = tokenOf(opener.urls()[0]!)
    const st = await doneState(token)
    assert.deepEqual(st.marked, ['billing'])
    assert.deepEqual(st.repos.filter((r: { name: string }) => r.name === 'billing' || r.name === 'shop').map((r: { name: string; ownSettings: boolean; source: string | null }) => [r.name, r.ownSettings, r.source]), [['billing', false, 'marked'], ['shop', true, null]])
    const js = (await call('/setup/app.js')).text
    for (const s of ['This worker version marked {list} as code from elsewhere', 'Diese Worker-Version hat {list} als fremden Code markiert', 'Got it', 'Verstanden'])
      assert.ok(js.includes(s), s)
    // only the page itself takes note
    assert.equal((await call('/setup/api/marks-seen', { token, body: {} })).status, 403)
    const seen = await call('/setup/api/marks-seen', { token, origin: SELF, body: {} })
    assert.equal(seen.status, 200, seen.text)
    assert.deepEqual(seen.json().marked, [])
    assert.ok(JSON.parse(readFileSync(join(home, '.config', 'one', 'worker-marks.json'), 'utf8')).seen)
  })

  test('a hand-written worker.json keeps its other settings and gets a .bak copy once', async () => {
    const home = tempDir('home')
    const site = plainRepo(join(home, 'code', 'site'))
    plainRepo(join(home, 'code', 'docs'))
    mkdirSync(join(home, '.config', 'one'), { recursive: true })
    const file = join(home, '.config', 'one', 'worker.json')
    const original = `// mine\n{ "name": "studio-mac", "parallel": 1, "repos": [ { "name": "site", "path": ${JSON.stringify(site)}, "branchPrefix": "me/", "claude": { "maxTurns": 12 } } ] }\n`
    writeFileSync(file, original)
    const opener = fakeOpener()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, args: ['setup'], env: { ONE_WORKER_BROWSER: opener.program } })
    await waitFor(() => opener.urls().length === 1, 8000, () => worker!.stderr())
    const token = tokenOf(opener.urls()[0]!)
    const state = await doneState(token)
    const names = state.repos.map((r: { name: string; ticked: boolean }) => `${r.name}:${r.ticked}`)
    assert.deepEqual(names, ['site:true', 'docs:false'])
    const docs = state.repos[1]
    const saved = await call('/setup/api/save', { token, origin: SELF, body: { repos: [{ path: site, name: 'site', baseBranch: 'main', test: '', push: false, pr: 'none', maxUsdPerTask: null }, { path: docs.path, name: 'docs', baseBranch: 'main', test: 'make test', push: true, pr: 'gh', maxUsdPerTask: null }] } })
    assert.equal(saved.status, 200, saved.text)
    assert.equal(readFileSync(`${file}.bak`, 'utf8'), original)
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, ''))
    assert.equal(raw.name, 'studio-mac')
    assert.equal(raw.parallel, 1)
    assert.equal(raw.workspace, WS.id)
    assert.equal(raw.repos[0].branchPrefix, 'me/')
    assert.deepEqual(raw.repos[0].claude, { maxTurns: 12 })
    assert.equal(raw.repos[0].push, false)
    assert.equal(raw.repos[0].testCommand, undefined)
    assert.deepEqual(raw.repos[1].testCommand, ['make', 'test'])
  })
})

describe('the terminal checklist (--no-browser)', () => {
  test('numbers tick, Enter saves only those; the worker announces them', async () => {
    const { home } = makeHome()
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, args: ['--no-browser'], stdin: true })
    await waitFor(() => /Enter = save/.test(worker!.stdout()), 10_000, () => worker!.stdout() + worker!.stderr())
    const out = worker.stdout()
    assert.match(out, /§ ONE WORKER — Studio/)
    const line = (name: string) => new RegExp(`^\\s*(\\d+) \\[ \\] ${name}\\b`, 'm').exec(out)?.[1]
    const beta = line('beta')
    const gamma = line('gamma')
    assert.ok(beta && gamma, out)
    assert.ok(!/node_modules|secret|too-deep|zeta/.test(out), out)
    const tab = await connect()
    await tab.next('welcome')
    worker.write(`${beta} ${gamma}\n`)
    await waitFor(() => /\[x\] gamma/.test(worker!.stdout()))
    worker.write(`${gamma}\n`)
    await waitFor(() => /\[ \] gamma/.test(worker!.stdout().split('Enter = save').slice(-2)[0]!))
    worker.write('\n')
    await waitFor(() => /Saved 1 repo\(s\)/.test(worker!.stdout()), 8000, () => worker!.stdout())
    const file = join(home, '.config', 'one', 'worker.json')
    if (!IS_WIN) assert.equal(statSync(file).mode & 0o777, 0o600)
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\/\/.*$/gm, ''))
    assert.deepEqual(raw.repos.map((r: { name: string; testCommand: string[] }) => [r.name, r.testCommand]), [['beta', ['cargo', 'test']]])
    await waitFor(() => tab.messages.filter((m) => m.type === 'welcome').length === 2)
  })

  test('the list text', () => {
    const repo = { path: '/h/code/x', short: '~/code/x', name: 'x', branch: 'main', base: 'main', branches: ['main'], remote: null, host: null, dirty: 0, lastCommit: null, test: null }
    assert.equal(checklistText([repo], new Set(['/h/code/x'])), '  1 [x] x  ~/code/x  main · no remote · clean · no tests\n')
  })
})
