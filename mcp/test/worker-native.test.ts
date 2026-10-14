/**
 * one-worker against this computer's own programs, not stand-ins: CLIs installed by npm itself (its real shims — the
 * .cmd npm writes on Windows, read as a Node script, never run through cmd.exe), Node's own npm / npx, a program named
 * git or claude planted at the root of a repository and of a task's worktree (it never starts — on Windows a bare name
 * is looked up in PATH only, never in the working folder, every child is told the same, and a stage does not start while
 * such a file lies at the top of its folder), and a checkout deeper than Windows' 260 characters. Every
 * test runs on every OS; what only Windows can show is said where it differs. Nothing leaves the machine (npm --offline).
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, afterEach, describe, test } from 'node:test'
import { execFileSafe, pathKey, resolveCommand } from '../src/worker/exec.ts'
import { ensureWorktree, info } from '../src/worker/git.ts'
import { loadConfig } from '../src/worker/config.ts'
import { WorkerState } from '../src/worker/state.ts'
import { FAKE_CLAUDE, FakeTab, GIT_ENV, IS_WIN, WORKER_BUNDLE, WS_LOCAL, cleanupAll, childEnv, fakeBin, leakIn, makeRepo, pathWith, repoEntry, sh, slashPath, spawnWorker, task, tempDir, writeConfig, type SpawnedWorker } from './worker-helpers.ts'

/** not the port of another worker test */
const PORT = 47386
let worker: SpawnedWorker | null = null
const tabs: FakeTab[] = []
afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})
after(cleanupAll)

/** npm's own CLI script: the npm running this suite (npm test sets npm_execpath), else the one next to node. */
function npmCli(): string | null {
  const own = process.env.npm_execpath
  const near = IS_WIN ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  for (const p of [own, near]) if (p && /npm-cli\.js$/.test(p) && existsSync(p)) return p
  return null
}
const NPM = npmCli()
const NO_NPM = !NPM && 'npm\'s npm-cli.js is not next to this node (and npm_execpath is not set)'

/**
 * A package with one bin, installed the way people install Claude Code with npm: `npm pack`, then `npm i -g --prefix`
 * from the tarball — offline (no dependencies), its own cache. Returns the folder npm put the command into (Windows:
 * the prefix itself, holding `<bin>.cmd`; elsewhere `<prefix>/bin`, a link).
 */
function npmInstall(bin: string, js: string): string {
  const root = tempDir('npm')
  const pkg = join(root, 'pkg')
  mkdirSync(pkg)
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: `one-test-${bin}`, version: '1.0.0', bin: { [bin]: 'cli.js' } }))
  writeFileSync(join(pkg, 'cli.js'), `#!/usr/bin/env node\n${js}`)
  const npm = (args: string[], cwd: string) => execFileSync(process.execPath, [NPM!, ...args, '--cache', join(root, 'cache'), '--offline', '--no-audit', '--no-fund', '--loglevel=error'], { cwd, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' } })
  npm(['pack', '--pack-destination', root], pkg)
  const prefix = join(root, 'global')
  npm(['install', '--global', '--prefix', prefix, '--ignore-scripts', join(root, `one-test-${bin}-1.0.0.tgz`)], root)
  return IS_WIN ? prefix : join(prefix, 'bin')
}

describe('CLIs as npm installs them', () => {
  test('a command npm installed globally runs through the exec layer — on Windows the .cmd npm wrote is read as a Node script (no cmd.exe: % ! & reach it as typed)', { skip: NO_NPM }, async () => {
    const dir = npmInstall('one-fake-cli', 'console.log("fake-cli:" + process.argv.slice(2).join("|"))\n')
    const env = { ...process.env, ...pathWith(dir) }
    if (IS_WIN) {
      // what npm wrote: its cmd-shim (the reader's F1), next to a .ps1 and an sh script the worker never starts
      assert.ok(existsSync(join(dir, 'one-fake-cli.cmd')), 'npm wrote a .cmd')
      const r = resolveCommand('one-fake-cli', ['x'], { env }, 'shim')
      assert.ok(r.ok, JSON.stringify(r))
      assert.equal(r.via, 'node-shim')
      assert.equal(r.args[0], join(dir, 'node_modules', 'one-test-one-fake-cli', 'cli.js'))
      // git takes .exe files only: an npm shim of that name would be refused
      assert.equal(resolveCommand('one-fake-cli', [], { env }, 'exe').ok, false)
    }
    const args = ['a b', 'c&d', '"q"', '%PATH%', '!x!', 'ü € 😀']
    const out = await execFileSafe('one-fake-cli', args, { env, timeoutMs: 20_000, allow: 'shim' })
    assert.deepEqual([out.code, out.stdout.trim()], [0, `fake-cli:${args.join('|')}`], out.stderr)
  })

  test('Node\'s own npm and npx (npm.cmd / npx.cmd on Windows) start through the exec layer', { skip: NO_NPM }, async () => {
    for (const cmd of ['npm', 'npx']) {
      if (IS_WIN) {
        const r = resolveCommand(cmd, ['--version'], {}, 'shim')
        assert.ok(r.ok && r.via === 'node-shim' && /npm-cli\.js$|npx-cli\.js$/.test(r.args[0]!), `${cmd}: ${JSON.stringify(r)}`)
      }
      const v = await execFileSafe(cmd, ['--version'], { timeoutMs: 60_000, allow: 'shim', env: { ...process.env, npm_config_update_notifier: 'false' } })
      assert.equal(v.code, 0, `${cmd}: ${v.error ?? v.stderr}`)
      assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+/)
    }
  })
})

describe('a program planted in the repository never runs', () => {
  /**
   * Plants named git / claude: Windows — copies of node.exe as git.exe / claude.exe (NODE_OPTIONS loads a probe into
   * every node, and only a plant's probe writes the marker file); elsewhere sh scripts that write it themselves.
   */
  function planter() {
    const box = tempDir('plant')
    const markers = join(box, 'ran.txt')
    const probe = join(box, 'probe.cjs')
    writeFileSync(probe, `const n = require('node:path').basename(process.execPath).toLowerCase()\nif (n === 'git.exe' || n === 'claude.exe') require('node:fs').appendFileSync(${JSON.stringify(markers)}, n + ' in ' + process.cwd() + '\\n')\n`)
    // NODE_OPTIONS splits at spaces and reads "\" inside quotes as an escape: the path quoted, with "/"
    const env: Record<string, string> = IS_WIN ? { NODE_OPTIONS: `--require "${slashPath(probe)}"` } : {}
    const names = IS_WIN ? ['git.exe', 'claude.exe'] : ['git', 'claude']
    const plant = (dir: string) => {
      for (const n of names) {
        if (IS_WIN) copyFileSync(process.execPath, join(dir, n))
        else {
          writeFileSync(join(dir, n), `#!/bin/sh\necho "${n} in $PWD" >> '${markers}'\nexit 1\n`)
          chmodSync(join(dir, n), 0o755)
        }
      }
      return dir
    }
    const ran = () => (existsSync(markers) ? readFileSync(markers, 'utf8').trim() : '')
    return { box, env, names, plant, ran, markers }
  }

  test('a git and a claude in the working folder: what a plain spawn by name does here, and what the worker\'s exec layer does', async (t) => {
    const p = planter()
    const dir = p.plant(tempDir('cwd'))
    // the probe works: a plant started by its path writes the marker (else "never ran" below would prove nothing)
    if (IS_WIN) spawnSync(join(dir, 'git.exe'), ['-e', '0'], { env: childEnv({ ...process.env }, p.env), stdio: 'ignore' })
    else spawnSync(join(dir, 'git'), [], { stdio: 'ignore' })
    assert.match(p.ran(), /^git(\.exe)? in /, 'the plant reports when it runs')
    writeFileSync(p.markers, '')
    // plain Node, a bare name with that working folder: Windows (libuv) looks in the working folder first — recorded only.
    // `-e 0`: what makes the plant (a node.exe copy) load its probe; the real git just refuses the option
    spawnSync('git', ['-e', '0'], { cwd: dir, env: childEnv({ ...process.env }, p.env), stdio: 'ignore' })
    t.diagnostic(`plain spawn('git') in a folder holding a planted git: ${p.ran() ? `the PLANT ran (${p.ran()})` : 'the real git ran'}`)
    writeFileSync(p.markers, '')
    if (IS_WIN) {
      // what the exec layer gives every child (exec.ts noCwdLookup): a Node program — Claude Code — that starts `git` by its
      // name skips its working folder (libuv asks NeedCurrentDirectoryForExePathW, which reads the starting process's own
      // environment: set here in this one)
      process.env.NoDefaultCurrentDirectoryInExePath = '1'
      try {
        spawnSync('git', ['-e', '0'], { cwd: dir, env: childEnv({ ...process.env }, p.env), stdio: 'ignore' })
      } finally {
        delete process.env.NoDefaultCurrentDirectoryInExePath
      }
      assert.equal(p.ran(), '', 'with NoDefaultCurrentDirectoryInExePath a plain spawn by name never takes the folder\'s git.exe')
    }
    // the exec layer: PATH only, never the working folder
    const git = await execFileSafe('git', ['--version'], { cwd: dir, env: childEnv({ ...process.env }, p.env), timeoutMs: 20_000, allow: 'exe' })
    assert.equal(git.code, 0, git.error ?? git.stderr)
    assert.match(git.stdout, /^git version /)
    const noPath = childEnv({ ...process.env }, p.env, { [pathKey(process.env)]: tempDir('nobin') })
    const claude = await execFileSafe('claude', ['--version'], { cwd: dir, env: noPath, timeoutMs: 20_000, allow: 'shim' })
    assert.deepEqual([claude.code, claude.why], [127, 'missing'], 'no claude on PATH: missing — never the one in the folder')
    assert.equal(p.ran(), '', 'no plant ran')
  })

  test('a whole task — plan, implement, test, commit — in a repository and a worktree holding a planted git and claude: the real git and the installed Claude Code (by name, from PATH) run, the plants never', async () => {
    const p = planter()
    const r = makeRepo()
    // the plants stay out of the task's commit
    writeFileSync(join(r.path, '.git', 'info', 'exclude'), `${p.names.join('\n')}\n`)
    p.plant(r.path)
    // Claude Code by its name, as an install puts it on PATH: the fake CLI behind a fakeBin "claude" (npm's shim on Windows)
    const bin = fakeBin(tempDir('claudebin'), 'claude', `await import(${JSON.stringify(pathToFileURL(FAKE_CLAUDE).href)})\n`)
    const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r)] })
    worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', file], cwd: r.path, env: { ...pathWith(bin), CLAUDE_BIN: '', ...p.env } })
    assert.match(worker.stderr(), /ready on ws:\/\/127\.0\.0\.1:47386/)
    const tab = await FakeTab.connect(PORT)
    tabs.push(tab)
    tab.hello(WS_LOCAL)
    const welcome = await tab.next('welcome')
    assert.equal(welcome.claude.found, true, 'Claude Code found by its name on PATH')

    const plan = await tab.run(task({ kind: 'plan' }, { id: 'plant1ab' }))
    assert.equal(plan.status, 'ok', JSON.stringify(plan))
    const branch = plan.branch!
    // the task's worktree gets its own plants before Claude Code, the tests and git run there
    const wt = join(r.worktrees, branch.replace(/\//g, '-'))
    assert.ok(existsSync(wt), wt)
    p.plant(wt)
    if (IS_WIN) {
      // Windows: lookups the worker cannot steer (Claude Code's own git through cross-spawn) would take them — the stage
      // is refused, by the file's name
      const refused = await tab.run(task({ kind: 'implement' }, { id: 'plant1ab', branch }))
      assert.equal(refused.status, 'refused', JSON.stringify(refused))
      assert.match(refused.error!, /a program named claude\.exe at its top level/)
      const lines = tab.messages.flatMap((m) => (m.type === 'event' && m.kind === 'log' ? m.lines : []))
      assert.ok(lines.some((l) => l.c === 'plantedProgram' && l.v?.file === 'claude.exe'), JSON.stringify(lines.map((l) => l.c ?? l.s)))
      // moved into a subfolder (as the error says): the task goes on — the worker's own git and Claude Code never take them
      mkdirSync(join(wt, 'plants'))
      for (const n of p.names) renameSync(join(wt, n), join(wt, 'plants', n))
    }
    const impl = await tab.run(task({ kind: 'implement' }, { id: 'plant1ab', branch }))
    assert.equal(impl.status, 'ok', JSON.stringify(impl))
    const tested = await tab.run(task({ kind: 'test' }, { id: 'plant1ab', branch }))
    assert.equal(tested.status, 'ok', JSON.stringify(tested))
    const commit = await tab.run(task({ kind: 'git', gitAction: 'commit' }, { id: 'plant1ab', branch, summary: '- feature.txt' }))
    assert.equal(commit.status, 'ok', JSON.stringify(commit))
    assert.equal(sh(r.path, 'log', '-1', '--format=%s', branch).trim(), 'Add the feature file')
    assert.deepEqual(sh(r.path, 'show', '--name-only', '--format=', branch).trim().split(/\r?\n/), ['feature.txt'], 'the plants stayed out of the commit')
    assert.equal(p.ran(), '', `a plant ran: ${p.ran()}`)
    const leak = leakIn(tab.raw.join('\n'), [r.path, r.worktrees, r.dir, bin])
    assert.equal(leak, null, `the tab received ${leak}`)
  })
})

describe('long paths', () => {
  test('a checkout deeper than 260 characters: the worktree gets every file, git status reads it (Windows: core.longpaths on every git call)', async (t) => {
    const r = makeRepo()
    const rel = ['deep', ...Array.from({ length: 9 }, (_, i) => `segment-${i}-${'x'.repeat(18)}`), 'file.txt']
    const file = join(r.path, ...rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'deep\n')
    // the test's own git needs the setting too on Windows
    sh(r.path, '-c', 'core.longpaths=true', 'add', '-A')
    sh(r.path, '-c', 'core.longpaths=true', 'commit', '--quiet', '-m', 'deep file')
    sh(r.path, 'push', '--quiet', 'origin', 'main')
    const cfg = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const { config, problems } = loadConfig(cfg)
    assert.deepEqual(problems, [])
    const repo = config.repos[0]!
    const state = new WorkerState(cfg)
    const wt = await ensureWorktree(repo, state, { id: 'long1abc', title: 'Long paths' }, null)
    const deep = join(wt.dir, ...rel)
    assert.ok(deep.length > 260, `${deep.length} characters`)
    assert.equal(readFileSync(deep, 'utf8'), 'deep\n')
    writeFileSync(deep, 'deeper\n')
    const g = await info(repo, state, wt.dir, wt.branch)
    assert.ok(g.files.some((f) => f.path === rel.join('/') && f.status === 'M'), JSON.stringify(g.files.map((f) => f.path)))
    if (IS_WIN) {
      // why the worker sets it: plain git without core.longpaths (recorded, not asserted — a runner may set it system-wide)
      const plain = spawnSync('git', ['worktree', 'add', '-q', '-b', 'plain-long', join(tempDir('plainwt'), 'w'), 'origin/main'], { cwd: r.path, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' })
      t.diagnostic(`git worktree add without core.longpaths: exit ${plain.status} ${(plain.stderr ?? '').trim().split('\n')[0] ?? ''}`)
    }
  })
})
