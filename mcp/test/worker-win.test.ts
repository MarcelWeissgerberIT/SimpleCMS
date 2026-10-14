/**
 * Worker 1.9.0 on Windows — git, paths and setup, each Windows rule run with an injected platform (and file system
 * where it reads one), so the whole file runs on every OS: git's arguments (long paths) and environment (ssh in
 * BatchMode only while the person set nothing), the hints for git's errors, worktree folder names, synced folders,
 * the scrubber's Windows forms, argument lines, ZIP names Windows refuses, renames that wait out a held file, the clone
 * folder, the usual places. Then a real worker: a missing Claude Code and a missing test command are named by code,
 * and no path of this computer reaches the tab.
 */
import assert from 'node:assert/strict'
import { chmodSync, lchownSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, afterEach, describe, test } from 'node:test'
import type { LogLine } from '../../src/app/features/coding/protocol.ts'
import { findClaude } from '../src/worker/claude.ts'
import { cloneBase, cloneInto, parseCloneUrl, unquote } from '../src/worker/clone.ts'
import { emptyConfig, loadConfig, splitArgs, type RepoConfig } from '../src/worker/config.ts'
import { GitError, git, gitFailure, gitMessage, gitOk, insideWorktrees, ownLocks, worktreeFolder } from '../src/worker/git.ts'
import { BATCH_SSH, INCLUDE_IF_NOTE, folderBusyCode, forgetGitEnv, gitArgs, gitEnv, gitHint, hintLine, hintTerminal } from '../src/worker/gitenv.ts'
import { inSyncedFolder, renameRetry } from '../src/worker/paths.ts'
import { noteGitHint, runStage } from '../src/worker/run.ts'
import { guessAnalyzeAsync, guessTest, shortPath, usualPlaces } from '../src/worker/scan.ts'
import { Scrubber, repoScrubber } from '../src/worker/scrub.ts'
import { joinArgs } from '../src/worker/setup.ts'
import { WorkerState } from '../src/worker/state.ts'
import { Worker } from '../src/worker/worker.ts'
import { entryPath, isUnsafe } from '../src/worker/zipimport.ts'
import { waitFor } from './helpers.ts'
import { FAKE_CLAUDE, FakeTab, GIT_ENV, WS_LOCAL, cleanupAll, leakIn, makeRepo, plainRepo, repoEntry, sh, slashPath, spawnWorker, task, tempDir, writeConfig, WORKER_BUNDLE, type SpawnedWorker } from './worker-helpers.ts'

after(cleanupAll)

/* ------------------------------------------------------------------ git: arguments, environment, hints */

describe('git on Windows: long paths, ssh that never asks, hints', () => {
  test('gitArgs: -c core.longpaths=true first on Windows only', () => {
    assert.deepEqual(gitArgs(['status', '--porcelain'], 'win32'), ['-c', 'core.longpaths=true', 'status', '--porcelain'])
    assert.deepEqual(gitArgs(['status', '--porcelain'], 'linux'), ['status', '--porcelain'])
    assert.deepEqual(gitArgs(['status'], 'darwin'), ['status'])
  })

  /** This process's environment without a GIT_SSH* of the test machine, an empty global config, no system config. */
  const base = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV, ...extra }
    for (const k of Object.keys(env)) if (/^git_ssh(_command)?$/i.test(k) && !(k in extra)) delete env[k]
    return env
  }

  test('gitEnv: Windows only — ssh in BatchMode while nothing of the person\'s is set (variables in any case, GIT_SSH, core.sshCommand); macOS / Linux as before 1.9.0', async () => {
    const repo = plainRepo(join(tempDir('gitenv'), 'repo'))
    const win = { platform: 'win32' as const }
    forgetGitEnv()
    const plain = await gitEnv(repo, base(), win)
    assert.equal(plain.GIT_SSH_COMMAND, BATCH_SSH)
    assert.equal(plain.GIT_TERMINAL_PROMPT, '0')
    assert.equal(plain.GCM_INTERACTIVE, 'never')
    // macOS / Linux: never — an askpass dialog keeps asking there, as in 1.8.1 (and nothing is read)
    for (const platform of ['linux', 'darwin'] as const) {
      forgetGitEnv()
      const posix = await gitEnv(repo, base(), { platform })
      assert.equal(posix.GIT_SSH_COMMAND, undefined, platform)
      assert.equal(posix.GIT_TERMINAL_PROMPT, '0')
      forgetGitEnv()
      assert.equal((await gitEnv(null, base(), { platform })).GIT_SSH_COMMAND, undefined, `${platform} clone`)
    }
    // the specs' `false` (nothing leaves the machine) wins
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base({ GIT_SSH_COMMAND: 'false' }), win)).GIT_SSH_COMMAND, 'false')
    forgetGitEnv()
    const viaSsh = await gitEnv(repo, base({ GIT_SSH: 'C:\\tools\\plink.exe' }), win)
    assert.equal(viaSsh.GIT_SSH_COMMAND, undefined)
    // Windows keys have no case: "git_ssh_command" is the person's GIT_SSH_COMMAND
    forgetGitEnv()
    const lower = await gitEnv(repo, base({ git_ssh_command: 'ssh -i key' }), win)
    assert.equal(lower.GIT_SSH_COMMAND, undefined)
    assert.equal(lower.git_ssh_command, 'ssh -i key')
    // a real core.sshCommand in the global config (a plain `ssh` opts out too)
    const global = join(tempDir('gitcfg'), 'config')
    writeFileSync(global, '[core]\n\tsshCommand = ssh\n')
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base({ GIT_CONFIG_GLOBAL: global }), win)).GIT_SSH_COMMAND, undefined)
    // … and in the repository's own config
    const local = plainRepo(join(tempDir('gitenv'), 'repo2'))
    sh(local, 'config', 'core.sshCommand', 'ssh -o IdentitiesOnly=yes')
    forgetGitEnv()
    assert.equal((await gitEnv(local, base(), win)).GIT_SSH_COMMAND, undefined)
    // a clone (no repository yet): the global config decides — also through a plain [include]
    forgetGitEnv()
    assert.equal((await gitEnv(null, base({ GIT_CONFIG_GLOBAL: global }), win)).GIT_SSH_COMMAND, undefined)
    const included = join(tempDir('gitcfg'), 'config')
    writeFileSync(included, `[include]\n\tpath = ${slashPath(global)}\n`)
    forgetGitEnv()
    assert.equal((await gitEnv(null, base({ GIT_CONFIG_GLOBAL: included }), win)).GIT_SSH_COMMAND, undefined, 'an [include] of theirs counts')
    forgetGitEnv()
    assert.equal((await gitEnv(null, base(), win)).GIT_SSH_COMMAND, BATCH_SSH)
    // a folder git cannot read: nothing added, the person's setup stays
    forgetGitEnv()
    assert.equal((await gitEnv(join(tempDir('gone'), 'no-such-folder'), base(), win)).GIT_SSH_COMMAND, undefined)
    forgetGitEnv()
  })

  test('a clone and an includeIf in the global config (a second account\'s key for some remotes): no BatchMode, and the terminal says why', async () => {
    const dir = tempDir('gitcfg')
    const work = join(dir, 'work.gitconfig')
    writeFileSync(work, '[core]\n\tsshCommand = ssh -i ~/.ssh/id_work\n')
    const global = join(dir, 'config')
    writeFileSync(global, `[includeIf "hasconfig:remote.*.url:git@work.example.invalid:*/**"]\n\tpath = ${slashPath(work)}\n`)
    const notes: string[] = []
    forgetGitEnv()
    const env = await gitEnv(null, base({ GIT_CONFIG_GLOBAL: global }), { platform: 'win32', note: (m) => notes.push(m) })
    assert.equal(env.GIT_SSH_COMMAND, undefined, 'the includeIf may set core.sshCommand for the new repository: their setup stays')
    assert.deepEqual(notes, [INCLUDE_IF_NOTE])
    // not remembered: the next clone reads again (after the person removed it, BatchMode is back)
    writeFileSync(global, '[user]\n\tname = x\n')
    assert.equal((await gitEnv(null, base({ GIT_CONFIG_GLOBAL: global }), { platform: 'win32', note: (m) => notes.push(m) })).GIT_SSH_COMMAND, BATCH_SSH)
    assert.equal(notes.length, 1)
    // an existing repository: git evaluates the condition itself — its answer decides
    const repo = plainRepo(join(tempDir('gitenv'), 'repo'), { 'README.md': '# x\n' }, 'git@work.example.invalid:acme/shop.git')
    writeFileSync(global, `[includeIf "hasconfig:remote.*.url:git@work.example.invalid:*/**"]\n\tpath = ${slashPath(work)}\n`)
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base({ GIT_CONFIG_GLOBAL: global }), { platform: 'win32' })).GIT_SSH_COMMAND, undefined)
    const other = plainRepo(join(tempDir('gitenv'), 'repo'), { 'README.md': '# x\n' }, 'git@other.example.invalid:acme/shop.git')
    forgetGitEnv()
    assert.equal((await gitEnv(other, base({ GIT_CONFIG_GLOBAL: global }), { platform: 'win32' })).GIT_SSH_COMMAND, BATCH_SSH)
    forgetGitEnv()
  })

  test('a core.sshCommand set after a hint applies on Retry: every stage (and git action) reads the config again', async () => {
    const repo = plainRepo(join(tempDir('gitenv'), 'repo'))
    const win = { platform: 'win32' as const }
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base(), win)).GIT_SSH_COMMAND, BATCH_SSH)
    // the person follows the sshKey hint: their own ssh from now on
    sh(repo, 'config', 'core.sshCommand', 'C:/Windows/System32/OpenSSH/ssh.exe')
    assert.equal((await gitEnv(repo, base(), win)).GIT_SSH_COMMAND, BATCH_SSH, 'remembered until something reads again')
    // Retry: a stage starts (here one the worker refuses at once) — the config is read again
    const refused = await runStage({ repo: { name: 'site', path: repo } as RepoConfig, state: new WorkerState(join(tempDir('state'), 'worker.json')), task: task({ kind: 'queue' }), team: false, caps: { found: false, version: null, budget: false, modes: [], settingSources: false }, bin: 'claude', taskMcp: null, signal: new AbortController().signal, log: () => {}, git: () => {}, question: () => null })
    assert.equal(refused.status, 'refused')
    assert.equal((await gitEnv(repo, base(), win)).GIT_SSH_COMMAND, undefined)
    forgetGitEnv()
  })

  test('git() runs with them: Windows — ssh in BatchMode and long paths (passed on to the git it starts); macOS / Linux — neither', async () => {
    const repo = plainRepo(join(tempDir('gitrun'), 'repo'))
    const saved = { ...process.env }
    for (const k of Object.keys(process.env)) if (/^git_ssh(_command)?$/i.test(k)) delete process.env[k]
    Object.assign(process.env, GIT_ENV)
    try {
      forgetGitEnv()
      const r = await git(repo, ['-c', 'alias.probe=!echo "ssh=$GIT_SSH_COMMAND"; git config --get core.longpaths || echo none', 'probe'])
      assert.equal(r.code, 0, r.stderr)
      assert.match(r.stdout, process.platform === 'win32' ? /ssh=ssh -o BatchMode=yes/ : /^ssh=$/m)
      assert.match(r.stdout, process.platform === 'win32' ? /^true$/m : /^none$/m)
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
      forgetGitEnv()
    }
  })

  test('gitHint: what git\'s message means — each code; "Filename too long" only on Windows; anything else none', () => {
    const cases: Array<[string, ReturnType<typeof gitHint>]> = [
      ["fatal: detected dubious ownership in repository at 'C:/Users/Max/repo'", 'dubiousOwnership'],
      ["fatal: Unable to create 'C:/Users/Max/repo/.git/index.lock': File exists.", 'gitLock'],
      ['Host key verification failed.\r\nfatal: Could not read from remote repository.', 'sshHostKey'],
      ['@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@', 'sshHostKey'],
      ['git@github.com: Permission denied (publickey).', 'sshKey'],
      ['Load key "/c/Users/Max/.ssh/id_ed25519": incorrect passphrase supplied to decrypt private key', 'sshKey'],
      ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'gitSignIn'],
      ['remote: HTTP Basic: Access denied\nfatal: Authentication failed for https://gitlab.example.com/a/b.git', 'gitSignIn'],
      ['error: unable to create file src/deep/x.ts: Filename too long', 'longpaths'],
      ['fatal: not a git repository (or any of the parent directories): .git', null],
    ]
    for (const [text, code] of cases) assert.equal(gitHint(text, 'win32'), code, text)
    assert.equal(gitHint('error: unable to create file x: Filename too long', 'linux'), null)
    assert.equal(gitHint('Permission denied (publickey).', 'darwin'), 'sshKey')
  })

  test('a hint carries names only; this computer\'s terminal gets git\'s safe.directory line and the lock file', () => {
    for (const code of ['longpaths', 'sshHostKey', 'sshKey', 'gitSignIn', 'dubiousOwnership', 'gitLock'] as const) {
      const h = hintLine(code, { repo: 'site', remote: 'origin' })
      assert.equal(h.c, code)
      assert.ok(h.s.length > 40)
      for (const v of Object.values(h.v)) assert.ok(v === 'site' || v === 'origin', `${code}: ${v}`)
    }
    assert.deepEqual(hintLine('sshKey', { repo: 'site', remote: 'upstream' }).v, { remote: 'upstream' })
    assert.deepEqual(hintLine('gitLock', { repo: 'site', remote: 'origin' }).v, { repo: 'site' })
    const dubious = "fatal: detected dubious ownership in repository at 'C:/Users/Max/code/site'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory C:/Users/Max/code/site\n"
    assert.match(hintTerminal('dubiousOwnership', dubious)!, /safe\.directory C:\/Users\/Max\/code\/site$/)
    assert.match(hintTerminal('gitLock', "fatal: Unable to create 'C:/w/site/.git/worktrees/x/index.lock': File exists.")!, /C:\/w\/site\/\.git\/worktrees\/x\/index\.lock/)
    assert.equal(hintTerminal('sshKey', 'Permission denied (publickey)'), null)
  })
})

/* ------------------------------------------------------------------ worktree folders */

describe('worktree folder names', () => {
  test('insideWorktrees: as written, without case on Windows — never the folder itself, a neighbour or a way out', () => {
    const repo = { path: 'C:\\code\\site', worktreeDir: 'C:\\code\\.one-worktrees\\site' } as RepoConfig
    assert.equal(insideWorktrees(repo, 'c:/CODE/.one-worktrees/site/one-x', 'win32'), true)
    assert.equal(insideWorktrees(repo, 'C:\\code\\.one-worktrees\\site', 'win32'), false)
    assert.equal(insideWorktrees(repo, 'C:\\code\\.one-worktrees\\site-other\\x', 'win32'), false)
    assert.equal(insideWorktrees(repo, 'C:\\code\\.one-worktrees\\site\\..\\..\\site', 'win32'), false)
    const posix = { path: '/srv/site', worktreeDir: '/srv/.one-worktrees/site' } as RepoConfig
    assert.equal(insideWorktrees(posix, '/srv/.one-worktrees/site/one-x', 'linux'), true)
    assert.equal(insideWorktrees(posix, '/SRV/.one-worktrees/site/one-x', 'linux'), false)
  })

  const RESERVED = /[<>:"|?*\u0000-\u001f]/
  const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
  const valid = (name: string) => !RESERVED.test(name) && !/[. ]$/.test(name) && !DEVICE.test(name.split('.')[0]!) && name.length <= 39 && !/[\\/]/.test(name)

  test('Windows: no reserved character, no trailing dot or space, no device name, ≤ 39 characters — distinct per branch', () => {
    const long = `one/${'a'.repeat(196)}`
    const branches = ['feature/con', 'con', 'a<b', 'a_b', 'x.', 'y ', 'q?', 'nul.txt', long, `${long}b`, 'one/fix-the-login-form-abc123', 'one/a-very-long-branch-name-for-a-task-title-abc123']
    const names = branches.map((b) => worktreeFolder(b, 'win32'))
    names.forEach((n, i) => assert.ok(valid(n), `${branches[i]} → ${n}`))
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, names.join(' · '))
    // a short, plain branch keeps the folder it always had
    assert.equal(worktreeFolder('one/fix-the-login-form-abc123', 'win32'), 'one-fix-the-login-form-abc123')
    assert.equal(worktreeFolder('feature/con', 'win32'), 'feature-con')
    assert.match(worktreeFolder('con', 'win32'), /^_con-[0-9a-f]{6}$/)
    assert.match(worktreeFolder(long, 'win32'), /^one-a{28}-[0-9a-f]{6}$/)
  })

  test('macOS / Linux: the branch with "/" as "-", as before', () => {
    assert.equal(worktreeFolder('one/fix-a', 'linux'), 'one-fix-a')
    assert.equal(worktreeFolder('a<b', 'darwin'), 'a<b')
    const long = `one/${'a'.repeat(196)}`
    assert.equal(worktreeFolder(long, 'linux'), `one-${'a'.repeat(196)}`)
  })
})

/* ------------------------------------------------------------------ synced folders */

describe('synced folders', () => {
  test('Windows: inside OneDrive (personal or work, the variable in any case, any case of the path); elsewhere none', () => {
    const env = { onedrive: 'C:\\Users\\Max\\OneDrive' }
    assert.equal(inSyncedFolder('C:\\Users\\Max\\OneDrive\\Documents\\site', { platform: 'win32', env }), 'onedrive')
    assert.equal(inSyncedFolder('c:/users/max/onedrive/site', { platform: 'win32', env }), 'onedrive')
    assert.equal(inSyncedFolder('C:\\Users\\Max\\OneDrive - Acme\\x', { platform: 'win32', env: { OneDriveCommercial: 'C:\\Users\\Max\\OneDrive - Acme' } }), 'onedrive')
    assert.equal(inSyncedFolder('C:\\Users\\Max\\code\\site', { platform: 'win32', env }), null)
    assert.equal(inSyncedFolder('C:\\Users\\Max\\OneDriveOld\\x', { platform: 'win32', env }), null)
    assert.equal(inSyncedFolder('C:\\code\\site', { platform: 'win32', env: {} }), null)
    assert.equal(inSyncedFolder('/home/max/OneDrive/x', { platform: 'linux', env: { OneDrive: '/home/max/OneDrive' } }), null)
  })

  test('macOS: iCloud Drive as before, ~/Library/CloudStorage (OneDrive, Google Drive, Dropbox …)', () => {
    const home = tempDir('home')
    assert.equal(inSyncedFolder(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'repo'), { platform: 'darwin', home }), 'icloud')
    assert.equal(inSyncedFolder(join(home, 'Library', 'CloudStorage', 'OneDrive-Acme', 'repo'), { platform: 'darwin', home }), 'cloudStorage')
    assert.equal(inSyncedFolder(join(home, 'Developer', 'repo'), { platform: 'darwin', home }), null)
    assert.equal(inSyncedFolder(join(home, 'Library', 'CloudStorage', 'x'), { platform: 'linux', home }), null)
  })
})

/* ------------------------------------------------------------------ the scrubber */

describe('scrubber on Windows', () => {
  const home = 'C:\\Users\\Max Muster'
  const real: Record<string, string> = { 'c:\\users\\maxmus~1\\appdata\\local\\temp': 'C:\\Users\\Max Muster\\AppData\\Local\\Temp' }
  const opts = {
    platform: 'win32' as const,
    home,
    tmp: 'C:\\Users\\MAXMUS~1\\AppData\\Local\\Temp',
    env: { TEMP: 'C:\\Users\\MAXMUS~1\\AppData\\Local\\Temp' },
    realpath: (p: string) => real[p.replace(/\//g, '\\').toLowerCase()] ?? null,
  }
  const scrub = repoScrubber({ path: `${home}\\code\\site`, worktreeDir: `${home}\\code\\.one-worktrees\\site` }, `${home}\\code\\.one-worktrees\\site\\one-x`, opts)

  test('every way Windows writes a path: case, slashes, MSYS, JSON-escaped, percent-encoded, the 8.3 short name', () => {
    const cases: Array<[string, string]> = [
      ['C:\\Users\\Max Muster\\code\\site\\a.ts', '<repo>\\a.ts'],
      ['c:/users/max muster/code/site/b.ts', '<repo>/b.ts'],
      ['C:/Users/Max Muster/notes.md', '~/notes.md'],
      ['/c/Users/Max Muster/code/site', '<repo>'],
      ['/cygdrive/c/Users/Max Muster/x', '~/x'],
      ['/mnt/c/Users/Max Muster/x', '~/x'],
      ['"C:\\\\Users\\\\Max Muster\\\\code\\\\site\\\\c.ts"', '"<repo>\\\\c.ts"'],
      ['file:///C:/Users/Max%20Muster/notes.md', 'file:///~/notes.md'],
      ['C:\\Users\\MAXMUS~1\\AppData\\Local\\Temp\\x', '<tmp>\\x'],
      ['C:\\Users\\Max Muster\\AppData\\Local\\Temp\\y', '<tmp>\\y'],
      ['C:\\Users\\MAXMUS~1\\code\\site\\z', '<repo>\\z'],
      ['C:\\Users\\MAXMUS~2\\Desktop', '~\\Desktop'],
      ['C:\\Users\\Max Muster\\code\\.one-worktrees\\site\\one-x\\src\\a.ts', '.\\src\\a.ts'],
      ['C:\\Users\\Max Muster\\code\\.one-worktrees\\site\\other', '<worktrees>\\other'],
    ]
    for (const [text, want] of cases) {
      const once = scrub.text(text)
      assert.equal(once, want, text)
      assert.equal(scrub.text(once), once, `scrubbing twice changes ${once}`)
    }
  })

  test('the user name alone is never replaced; another user\'s folder stays', () => {
    const s = new Scrubber([], { ...opts, home: 'C:\\Users\\test', tmp: 'C:\\Users\\test\\AppData\\Local\\Temp', env: {} })
    assert.equal(s.text('npm test -- --grep test'), 'npm test -- --grep test')
    assert.equal(s.text('C:\\Users\\test\\x and C:\\Users\\other\\y'), '~\\x and C:\\Users\\other\\y')
  })

  test('macOS / Linux as before: case kept, no Windows forms', () => {
    const s = repoScrubber({ path: '/home/me/code/site', worktreeDir: '/home/me/code/.one-worktrees/site' }, '/home/me/code/.one-worktrees/site/one-x-1', { platform: 'linux', home: '/home/me', tmp: '/tmp', realpath: () => null })
    assert.equal(s.text('Edit /home/me/code/.one-worktrees/site/one-x-1/src/a.ts'), 'Edit ./src/a.ts')
    assert.equal(s.text('see /home/me/code/site/README.md'), 'see <repo>/README.md')
    assert.equal(s.text('in /home/me/code/.one-worktrees/site/other'), 'in <worktrees>/other')
    assert.equal(s.text('/HOME/ME/x'), '/HOME/ME/x')
    assert.equal(s.text('/home/me/x'), '~/x')
  })
})

/* ------------------------------------------------------------------ argument lines */

describe('argument lines (the setup page ⇄ worker.json)', () => {
  test('Windows: a backslash is a plain character; quoted paths with spaces; every line round-trips', () => {
    assert.deepEqual(splitArgs('.\\gradlew.bat test', 'win32'), ['.\\gradlew.bat', 'test'])
    assert.deepEqual(splitArgs('"C:\\Program Files\\x\\y.exe" -a', 'win32'), ['C:\\Program Files\\x\\y.exe', '-a'])
    assert.deepEqual(splitArgs('node "a \\"b\\""', 'win32'), ['node', 'a "b"'])
    for (const argv of [['.\\gradlew.bat', 'test'], ['C:\\Program Files\\x\\y.exe', '-a'], ['say', 'a "b"'], ['C:\\my dir\\'], ['x', ''], ["it's", 'C:\\a b\\c'], ['a\\\\b']]) {
      const line = joinArgs(argv, 'win32')
      assert.deepEqual(splitArgs(line, 'win32'), argv, line)
    }
    assert.equal(joinArgs(['.\\gradlew.bat', 'test'], 'win32'), '.\\gradlew.bat test')
    assert.equal(joinArgs(['C:\\Program Files\\x\\y.exe', '-a'], 'win32'), '"C:\\Program Files\\x\\y.exe" -a')
  })

  test('macOS / Linux as before: a backslash escapes', () => {
    assert.deepEqual(splitArgs('c\\ d', 'linux'), ['c d'])
    assert.deepEqual(splitArgs('"a\\\\b"', 'linux'), ['a\\b'])
    for (const argv of [['c d'], ['a\\b'], ['say', 'a "b"'], ['x', '']]) assert.deepEqual(splitArgs(joinArgs(argv, 'linux'), 'linux'), argv)
  })

  test('a typed folder loses one pair of quotes (Explorer\'s "Copy as path")', () => {
    assert.equal(unquote('  "C:\\Users\\Max\\code\\site"  '), 'C:\\Users\\Max\\code\\site')
    assert.equal(unquote("'/srv/x y'"), '/srv/x y')
    assert.equal(unquote('"\'x\'"'), "'x'")
    assert.equal(unquote('C:\\plain'), 'C:\\plain')
  })
})

/* ------------------------------------------------------------------ guessed commands */

describe('guessed commands', () => {
  test('every guessed test / analysis command is a bare program name — never a path, nothing read from the repo', async () => {
    const files: Array<Record<string, string>> = [
      { 'package.json': '{"scripts":{"test":"vitest","lint":"eslint ."}}' },
      { 'package.json': '{"scripts":{"test":"vitest","lint":"eslint ."}}', 'pnpm-lock.yaml': '' },
      { 'package.json': '{"scripts":{"test":"vitest","lint":"eslint ."}}', 'yarn.lock': '' },
      { 'eslint.config.js': '' },
      { 'App.sln': '' },
      { 'go.mod': 'module x' },
      { 'Cargo.toml': '' },
      { 'pyproject.toml': '[tool.ruff]\n' },
      { 'setup.cfg': '' },
      { Makefile: 'test:\n\techo ok\n' },
      { 'pytest.ini': '' },
    ]
    let n = 0
    for (const f of files) {
      const dir = tempDir('guess')
      for (const [name, text] of Object.entries(f)) writeFileSync(join(dir, name), text)
      for (const argv of [guessTest(dir), await guessAnalyzeAsync(dir)]) {
        if (!argv) continue
        n++
        assert.ok(!/[\\/:]/.test(argv[0]!), `${JSON.stringify(f)} → ${argv[0]}`)
      }
    }
    assert.ok(n >= 11, `only ${n} guesses`)
  })
})

/* ------------------------------------------------------------------ ZIP names, renames, the clone folder, places */

describe('ZIP names Windows refuses', () => {
  test('< > " | ? * and a trailing dot or space refuse the ZIP on Windows; elsewhere they are plain names', () => {
    for (const name of ['a<b', 'src/x>y.ts', 'say"hi', 'p|q', 'q?', 'star*.txt', 'x.', 'dir./a.ts', 'y ', 'trail /b']) {
      const r = entryPath(name, 'win32')
      assert.ok(isUnsafe(r), `${name} → ${JSON.stringify(r)}`)
    }
    assert.match((entryPath('a<b', 'win32') as { unsafe: string }).unsafe, /Windows does not allow/)
    assert.match((entryPath('x.', 'win32') as { unsafe: string }).unsafe, /dot or a space/)
    for (const name of ['a<b', 'x.', 'y ', 'q?']) assert.equal(entryPath(name, 'linux'), name)
    assert.equal(entryPath('src/ok.ts', 'win32'), 'src/ok.ts')
  })
})

describe('renames that wait out a held file (Windows)', () => {
  const held = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code })

  test('EPERM twice, then it works', () => {
    let calls = 0
    const waits: number[] = []
    const rename = () => {
      if (++calls < 3) throw held('EPERM')
    }
    renameRetry('a', 'b', { platform: 'win32', rename, wait: (ms) => waits.push(ms) })
    assert.equal(calls, 3)
    assert.deepEqual(waits, [100, 100])
  })

  test('held for good: the first error after 10 more tries; another error at once; macOS / Linux one try', () => {
    let calls = 0
    const first = held('EBUSY')
    const failing = (code: string) => () => {
      throw ++calls === 1 && code === 'EBUSY' ? first : held(code === 'EBUSY' ? 'EACCES' : code)
    }
    assert.throws(() => renameRetry('a', 'b', { platform: 'win32', rename: failing('EBUSY'), wait: () => {} }), (e) => e === first)
    assert.equal(calls, 11)
    calls = 0
    assert.throws(() => renameRetry('a', 'b', { platform: 'win32', rename: failing('ENOENT'), wait: () => {} }), /ENOENT/)
    assert.equal(calls, 1)
    calls = 0
    assert.throws(() => renameRetry('a', 'b', { platform: 'linux', rename: failing('EPERM'), wait: () => {} }), /EPERM/)
    assert.equal(calls, 1)
  })
})

describe('the clone folder and the usual places on Windows', () => {
  test('cloneBase: ~\\ and a quoted paste taken; OneDrive refused with its own reason; a relative folder refused', () => {
    const home = 'C:\\Users\\Max'
    const env = { OneDrive: 'C:\\Users\\Max\\OneDrive' }
    assert.equal(cloneBase('~\\one-repos', home, 'win32', env), 'C:\\Users\\Max\\one-repos')
    assert.equal(cloneBase('~/one-repos', home, 'win32', env), 'C:\\Users\\Max\\one-repos')
    assert.equal(cloneBase('"D:\\Code Base\\repos"', home, 'win32', env), 'D:\\Code Base\\repos')
    assert.match((cloneBase('C:\\Users\\Max\\OneDrive\\repos', home, 'win32', env) as { error: string }).error, /OneDrive/)
    assert.match((cloneBase('repos', home, 'win32', env) as { error: string }).error, /C:\\/)
    assert.match((cloneBase('\\repos', home, 'win32', env) as { error: string }).error, /full folder path/)
    assert.equal(cloneBase("'/srv/one repos'", '/home/max', 'linux'), '/srv/one repos')
  })

  test('the search starts at Visual Studio\'s source\\repos and OneDrive\'s Documents / Desktop too (Windows only)', () => {
    const home = join(tempDir('places'), 'Max')
    const win = usualPlaces(home, 'win32', { OneDrive: join(home, 'OneDrive') }).map((p) => `${p.path}@${p.depth}`)
    assert.ok(win.includes(`${join(home, 'source', 'repos')}@2`), win.join('\n'))
    assert.ok(win.includes(`${join(home, 'OneDrive', 'Documents')}@2`), win.join('\n'))
    assert.ok(win.includes(`${join(home, 'OneDrive', 'Desktop')}@2`), win.join('\n'))
    const posix = usualPlaces(home, 'linux', { OneDrive: join(home, 'OneDrive') }).map((p) => p.path)
    assert.ok(!posix.some((p) => p.includes('OneDrive') || p.endsWith(join('source', 'repos'))))
  })

  test('the setup page\'s short paths: ~ for the home folder in any case on Windows', () => {
    assert.equal(shortPath('c:\\users\\max\\code\\site', 'C:\\Users\\Max', 'win32'), '~/code/site')
    assert.equal(shortPath('C:\\Users\\Max', 'C:\\Users\\Max\\', 'win32'), '~')
    assert.equal(shortPath('D:\\code\\site', 'C:\\Users\\Max', 'win32'), 'D:/code/site')
    assert.equal(shortPath('/Home/max/x', '/home/max', 'linux'), '/Home/max/x')
  })
})

describe('lock files a stopped git left', () => {
  test('ownLocks names an index.lock in the worker\'s own worktrees — none elsewhere, nothing removed', () => {
    const r = makeRepo()
    const wt = join(r.worktrees, 'one-x')
    mkdirSync(r.worktrees, { recursive: true })
    sh(r.path, 'worktree', 'add', '--quiet', '-b', 'one/x', wt)
    const cfg = join(tempDir('state'), 'worker.json')
    const state = new WorkerState(cfg)
    const repo = { name: 'demo', path: r.path, worktreeDir: r.worktrees } as Parameters<typeof ownLocks>[0]
    assert.deepEqual(ownLocks(repo, state), [])
    state.remember('demo', 'one/x', { task: 't1', worktree: wt, branchCreated: true, fork: null, at: Date.now() })
    assert.deepEqual(ownLocks(repo, state), [])
    const gitdir = sh(wt, 'rev-parse', '--git-dir').trim()
    const lock = join(gitdir.match(/^([A-Za-z]:)?[\\/]/) ? gitdir : join(wt, gitdir), 'index.lock')
    writeFileSync(lock, '')
    assert.deepEqual(ownLocks(repo, state).map((p) => p.replace(/\\/g, '/').toLowerCase()), [lock.replace(/\\/g, '/').toLowerCase()])
    // the main checkout's own lock is the person's: not named
    writeFileSync(join(r.path, '.git', 'index.lock'), '')
    assert.equal(ownLocks(repo, state).length, 1)
  })
})

/* ------------------------------------------------------------------ W1: git's whole message, never its accounts */

describe('git\'s message: the hints read all of it; One gets no account, SID or folder line', () => {
  // Git for Windows' refusal of a folder of another account (setup.c + compat/mingw.c's report), 8 lines
  const DUBIOUS = [
    "fatal: detected dubious ownership in repository at 'C:/Users/Max Muster/code/shop'",
    "'C:/Users/Max Muster/code/shop' is owned by:",
    "\t'DESKTOP-K3J9QX/Max Muster' (S-1-5-21-1004336348-1177238915-682003330-1001)",
    'but the current user is:',
    "\t'BUILTIN/Administrators' (S-1-5-32-544)",
    'To add an exception for this directory, call:',
    '',
    "\tgit config --global --add safe.directory 'C:/Users/Max Muster/code/shop'",
  ].join('\r\n')

  test('a dubious-ownership refusal: One gets its first line only (no account, SID or safe.directory line) — the hint and the terminal read the whole', () => {
    const e = gitFailure({ stderr: DUBIOUS, stdout: '' }, 'git rev-parse failed')
    assert.equal(e.message, "fatal: detected dubious ownership in repository at 'C:/Users/Max Muster/code/shop'")
    assert.equal(e.detail, DUBIOUS)
    // the last 6 lines (what One got before) hold neither the first line nor the code's trigger
    assert.equal(gitHint(DUBIOUS.split('\r\n').slice(-6).join('\n'), 'win32'), null)
    assert.equal(gitHint(e.detail!, 'win32'), 'dubiousOwnership')
    assert.match(hintTerminal('dubiousOwnership', e.detail!)!, /safe\.directory 'C:\/Users\/Max Muster\/code\/shop'$/)
    const scrubbed = repoScrubber({ path: 'C:\\Users\\Max Muster\\code\\shop', worktreeDir: 'C:\\Users\\Max Muster\\code\\.one-worktrees\\shop' }, null, { platform: 'win32', home: 'C:\\Users\\Max Muster', tmp: 'C:\\Temp', env: {}, realpath: () => null }).text(`git: ${e.message}`)
    assert.equal(scrubbed, "git: fatal: detected dubious ownership in repository at '<repo>'")
    // any other message: account / SID lines never reach One either
    assert.equal(gitMessage("error: x\n'a/b' is owned by:\n\t'PC/Max' (S-1-5-21-1-2-3-1001)\nbut the current user is:\n\tPC/Other (S-1-5-21-1-2-3-1002)\nfatal: y"), 'error: x\nfatal: y')
    assert.equal(gitMessage('1\n2\n3\n4\n5\n6\n7\n8', 6), '3\n4\n5\n6\n7\n8')
  })

  test('a lock file a stopped git left: real git through gitOk — the hint (gitLock) and the terminal line come from git\'s whole message', async () => {
    const repo = plainRepo(join(tempDir('lock'), 'repo'))
    writeFileSync(join(repo, 'new.txt'), 'x\n')
    writeFileSync(join(repo, '.git', 'index.lock'), '')
    const err = await gitOk(repo, ['add', '-A']).then(
      () => null,
      (e: unknown) => e,
    )
    assert.ok(err instanceof GitError, String(err))
    const lines: Array<{ s: string; c?: string; v?: Record<string, string | number> }> = []
    const terminal: string[] = []
    const r = { name: 'site', remote: 'origin' } as RepoConfig
    noteGitHint(err.detail ?? err.message, r, (_k, s, c, v) => lines.push({ s, c, v }), (m) => terminal.push(m), 'linux')
    assert.deepEqual(lines.map((l) => [l.c, l.v]), [['gitLock', { repo: 'site' }]])
    assert.equal(terminal.length, 1)
    assert.match(terminal[0]!, /index\.lock/)
  })

  test('folderBusy ("Windows still holds files …") only on Windows — elsewhere git\'s own error says why', () => {
    assert.equal(folderBusyCode('win32'), 'folderBusy')
    assert.equal(folderBusyCode('linux'), undefined)
    assert.equal(folderBusyCode('darwin'), undefined)
  })
})

/* ------------------------------------------------------------------ W1: worktree folders, the scrubber, Claude Code's file */

describe('W1: nothing of a branch name that cmd.exe reads; every way a path is written', () => {
  test('a worktree folder on Windows: letters, digits, "." "_" "-" only — whatever the branch from One or a remote holds', () => {
    const hostile = ['fix=1', 'a,b;c', 'x^y%z!w', 'ü/ö', 'a b', '&calc', '(x)', "it's", 'a`b', 'feature/über-straße', 'x~1', '+plus', '@{u}']
    const names = hostile.map((b) => worktreeFolder(b, 'win32'))
    names.forEach((n, i) => assert.match(n, /^[A-Za-z0-9._-]+$/, `${hostile[i]} → ${n}`))
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, names.join(' · '))
    // a plain branch keeps the folder it always had; macOS / Linux as before
    assert.equal(worktreeFolder('one/fix-the-login-form-abc123', 'win32'), 'one-fix-the-login-form-abc123')
    assert.equal(worktreeFolder('fix=1', 'linux'), 'fix=1')
  })

  test('the scrubber on Windows: an encoded colon (VS Code\'s file URIs), mixed separators, %5C, a shell\'s "\\ ", a short worktree folder as a whole name only', () => {
    const scrub = repoScrubber({ path: 'C:\\Users\\Max Muster\\code\\site', worktreeDir: 'C:\\w' }, null, { platform: 'win32', home: 'C:\\Users\\Max Muster', tmp: 'C:\\Users\\Max Muster\\AppData\\Local\\Temp', env: {}, realpath: () => null })
    const ascii = repoScrubber({ path: 'C:\\Users\\maxmu\\code\\shop', worktreeDir: 'C:\\Users\\maxmu\\code\\.one-worktrees\\shop' }, null, { platform: 'win32', home: 'C:\\Users\\maxmu', tmp: 'C:\\Temp', env: {}, realpath: () => null })
    const cases: Array<[Scrubber, string, string]> = [
      [ascii, 'file:///c%3A/Users/maxmu/code/shop/src/a.ts', 'file:///<repo>/src/a.ts'],
      [ascii, 'file:///C%3a/users/MAXMU/x', 'file:///~/x'],
      [scrub, '/c/Users/Max\\ Muster/x', '~/x'],
      [scrub, 'C:/Users\\Max Muster/x', '~/x'],
      [scrub, 'C:\\Users/Max Muster\\x', '~\\x'],
      [scrub, 'C:%5CUsers%5CMax%20Muster%5Cx', '~%5Cx'],
      [scrub, 'C%3A%5CUsers%5CMax%20Muster%5Ccode%5Csite', '<repo>'],
      [scrub, 'in C:\\Users\\Max Muster.', 'in ~.'],
      // a whole name only: C:\w is not C:\Windows, and another user is not this one
      [scrub, 'C:\\Windows\\System32 and https://example.com/c/watch and c:/web/app', 'C:\\Windows\\System32 and https://example.com/c/watch and c:/web/app'],
      [scrub, 'C:\\w\\one-x\\a.ts', '<worktrees>\\one-x\\a.ts'],
      [scrub, 'C:\\Users\\Max Mustermann\\x', 'C:\\Users\\Max Mustermann\\x'],
    ]
    for (const [s, text, want] of cases) {
      const once = s.text(text)
      assert.equal(once, want, text)
      assert.equal(s.text(once), once, `scrubbing twice changes ${once}`)
    }
  })

  test('the scrubber: a name a program in another code page wrote (U+FFFD per lost byte, "?", UTF-8 read as Latin-1) — and pytest\'s rootdir line', () => {
    const home = 'C:\\Users\\Jürgen'
    const wt = `${home}\\source\\repos\\.one-worktrees\\shop\\one-fix-abc123`
    const s = repoScrubber({ path: `${home}\\source\\repos\\shop`, worktreeDir: `${home}\\source\\repos\\.one-worktrees\\shop` }, wt, { platform: 'win32', home, tmp: `${home}\\AppData\\Local\\Temp`, env: {}, realpath: () => null })
    const cases: Array<[string, string]> = [
      ['rootdir: C:\\Users\\J\uFFFDrgen\\source\\repos\\.one-worktrees\\shop\\one-fix-abc123', 'rootdir: .'],
      ['C:\\Users\\J\uFFFD\uFFFDrgen\\x', '~\\x'],
      ['C:\\Users\\J?rgen\\x', '~\\x'],
      ['C:\\Users\\JÃ¼rgen\\x', '~\\x'],
      ['file:///C:/Users/J%C3%BCrgen/x', 'file:///~/x'],
      ['file:///c%3a/users/j%c3%bcrgen/x', 'file:///~/x'],
      ['C:\\USERS\\JÜRGEN\\x', '~\\x'],
    ]
    for (const [text, want] of cases) {
      const once = s.text(text)
      assert.equal(once, want, text)
      assert.equal(s.text(once), once)
    }
  })

  test('the scrubber on macOS / Linux: percent-encoded paths, NFD names, JSON\'s "\\/", a whole name only — case kept', () => {
    const s = repoScrubber({ path: '/home/max/Mes Projets/shop', worktreeDir: '/w' }, null, { platform: 'linux', home: '/home/max', tmp: '/tmp', realpath: () => null })
    const j = new Scrubber([], { platform: 'darwin', home: '/Users/Jürgen Müller', tmp: '/private/tmp', realpath: () => null })
    const cases: Array<[Scrubber, string, string]> = [
      [s, 'file:///home/max/Mes%20Projets/shop/a.ts', 'file://<repo>/a.ts'],
      [s, 'see /home/max/Mes Projets/shop/README.md', 'see <repo>/README.md'],
      [s, '"\\/home\\/max\\/x"', '"~\\/x"'],
      [s, '/home/max2/x /HOME/MAX/x /web/app', '/home/max2/x /HOME/MAX/x /web/app'],
      [s, '/w/one-x/a.ts', '<worktrees>/one-x/a.ts'],
      [j, 'file:///Users/J%C3%BCrgen%20M%C3%BCller/x', 'file://~/x'],
      [j, '/Users/Ju\u0308rgen Mu\u0308ller/x', '~/x'],
      [j, '/Users/J\uFFFD\uFFFDrgen M\uFFFDller/x', '~/x'],
    ]
    for (const [sc, text, want] of cases) {
      const once = sc.text(text)
      assert.equal(once, want, text)
      assert.equal(sc.text(once), once)
    }
  })

  test('Claude Code\'s file: CLAUDE_BIN without its quotes, a relative one resolved once against the worker\'s folder; Windows\' native install found off PATH', () => {
    const exists = (files: string[]) => (p: string) => files.some((f) => f.toLowerCase() === p.toLowerCase())
    const win = { platform: 'win32' as const, cwd: 'C:\\Users\\Max\\tools', home: 'C:\\Users\\Max', exists: exists([]) }
    assert.deepEqual(findClaude({ CLAUDE_BIN: '"C:\\Users\\Max Muster\\.local\\bin\\claude.exe"' }, win), { bin: 'C:\\Users\\Max Muster\\.local\\bin\\claude.exe', from: 'env' })
    assert.deepEqual(findClaude({ CLAUDE_BIN: 'tools\\claude.exe' }, win), { bin: 'C:\\Users\\Max\\tools\\tools\\claude.exe', from: 'env' })
    assert.deepEqual(findClaude({ claude_bin: '.\\claude.exe' }, win), { bin: 'C:\\Users\\Max\\tools\\claude.exe', from: 'env' })
    assert.deepEqual(findClaude({ CLAUDE_BIN: 'claude.exe' }, win), { bin: 'claude.exe', from: 'env' }, 'a bare name stays a PATH lookup')
    assert.deepEqual(findClaude({ CLAUDE_BIN: './claude' }, { platform: 'linux', cwd: '/srv/w', home: '/home/max' }), { bin: '/srv/w/claude', from: 'env' })
    assert.deepEqual(findClaude({ CLAUDE_BIN: "'~/bin/claude'" }, { platform: 'linux', cwd: '/srv/w', home: '/home/max' }), { bin: '/home/max/bin/claude', from: 'env' })
    // the native installer's folder, not on PATH
    const native = 'C:\\Users\\Max\\.local\\bin\\claude.exe'
    assert.deepEqual(findClaude({ PATH: 'C:\\Windows' }, { ...win, exists: exists([native]) }), { bin: native, from: 'native' })
    // on PATH: by its name; nothing there: by its name (then not found)
    assert.deepEqual(findClaude({ PATH: 'C:\\npm' }, { ...win, exists: exists([native, 'C:\\npm\\claude.exe']) }), { bin: 'claude', from: 'path' })
    assert.deepEqual(findClaude({ PATH: 'C:\\Windows' }, win), { bin: 'claude', from: 'path' })
    assert.deepEqual(findClaude({ PATH: '/usr/bin' }, { platform: 'linux', home: '/home/max', exists: () => true }), { bin: 'claude', from: 'path' })
  })
})

/* ------------------------------------------------------------------ W1: a program planted in the stage's folder */

describe('W1: a program a lookup by name would take, at the top of the folder a stage runs in (Windows)', () => {
  test('refused before Claude Code, the tests or the analysis start — the file\'s name only; elsewhere the stage runs as before', async () => {
    const r = makeRepo()
    // a cloned repository that ships a git.exe at its root
    writeFileSync(join(r.path, 'git.exe'), 'MZ')
    sh(r.path, 'add', 'git.exe')
    sh(r.path, 'commit', '--quiet', '-m', 'ship a program')
    sh(r.path, 'push', '--quiet', 'origin', 'main')
    const cfg = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r, { analyzeCommand: [process.execPath, '-e', '0'] })] })
    const { config, problems } = loadConfig(cfg)
    assert.deepEqual(problems, [])
    const repo = config.repos[0]!
    const state = new WorkerState(cfg)
    const caps = { found: true, version: '9.9.9', budget: true, modes: [], settingSources: true }
    const run = async (kind: 'implement' | 'plan' | 'test' | 'analyze' | 'doc', platform: NodeJS.Platform, branch: string | null = null) => {
      const lines: LogLine[] = []
      const outcome = await runStage({ repo, state, task: task({ kind }, { id: 'plant9ab', branch }), team: false, caps, bin: join(tempDir('noclaude'), 'claude'), taskMcp: null, signal: new AbortController().signal, log: (l) => lines.push(l), git: () => {}, question: () => null, platform })
      return { outcome, lines }
    }
    const impl = await run('implement', 'win32')
    assert.equal(impl.outcome.status, 'refused', JSON.stringify(impl.outcome))
    assert.match(impl.outcome.error!, /a program named git\.exe at its top level/)
    assert.deepEqual(impl.lines.filter((l) => l.c === 'plantedProgram').map((l) => l.v), [{ file: 'git.exe' }])
    assert.ok(!impl.lines.some((l) => l.c === 'starting'), 'Claude Code never started')
    const branch = impl.outcome.branch!
    for (const kind of ['plan', 'test', 'analyze', 'doc'] as const) {
      const { outcome, lines } = await run(kind, 'win32', kind === 'plan' ? null : branch)
      assert.equal(outcome.status, 'refused', `${kind}: ${JSON.stringify(outcome)}`)
      assert.ok(lines.some((l) => l.c === 'plantedProgram' && l.v?.file === 'git.exe'), kind)
      assert.ok(!lines.some((l) => l.c === 'testsRun' || l.c === 'analyzeRun'), `${kind}: nothing ran`)
    }
    // no path of this computer in what One would get
    const all = JSON.stringify([impl.outcome, impl.lines])
    assert.ok(!all.includes(r.dir), 'a path reached One')
    // macOS / Linux: no such lookup there — the stage runs (the tests pass)
    const tested = await run('test', 'linux', branch)
    assert.equal(tested.outcome.status, 'ok', JSON.stringify(tested.outcome))
    assert.ok(!tested.lines.some((l) => l.c === 'plantedProgram'))
  })
})

/* ------------------------------------------------------------------ a real worker */

const PORT = 47397
let worker: SpawnedWorker | null = null
const tabs: FakeTab[] = []

afterEach(async () => {
  for (const t of tabs.splice(0)) t.close()
  await worker?.stop()
  worker = null
  await new Promise((r) => setTimeout(r, 80))
})

describe('a worker without Claude Code or a test program', () => {
  test('codes, never paths: Claude Code missing (CLAUDE_BIN in the home folder) and a test command not in PATH', async () => {
    const r = makeRepo()
    const home = tempDir('home Jürgen')
    const bin = join(home, 'nope', 'claude')
    const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r, { testCommand: ['one-no-such-test-tool', '--ci'] })] })
    worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', file], home, env: { CLAUDE_BIN: bin, USERPROFILE: home } })
    // the terminal names what it looked for (this computer only)
    assert.match(worker.stderr(), /Claude Code was not found \(".*nope.*claude"\)/)
    const tab = await FakeTab.connect(PORT)
    tabs.push(tab)
    tab.hello(WS_LOCAL)
    const welcome = await tab.next('welcome')
    assert.deepEqual(welcome.claude, { found: false, version: null })

    const impl = await tab.run(task({ kind: 'implement' }, { id: 'win1abcd' }))
    assert.equal(impl.status, 'failed')
    assert.equal(impl.error, 'Claude Code was not found on this computer. Install it and sign in, or set CLAUDE_BIN.')
    const test1 = await tab.run(task({ kind: 'test' }, { id: 'win1abcd', branch: impl.branch! }))
    assert.equal(test1.status, 'failed')
    assert.equal(test1.error, 'The test command could not start (one-no-such-test-tool — see the log).')
    assert.ok(test1.test && !('notStarted' in test1.test), JSON.stringify(test1.test))
    const lines = tab.messages.flatMap((m) => (m.type === 'event' && m.kind === 'log' ? m.lines : []))
    assert.ok(lines.some((l) => l.c === 'claudeMissing' && l.k === 'error'), JSON.stringify(lines.map((l) => l.c ?? l.s)))
    assert.ok(lines.some((l) => l.c === 'commandMissing' && l.v?.cmd === 'one-no-such-test-tool'), JSON.stringify(lines.map((l) => l.c ?? l.s)))
    // nothing of this computer: the home folder (any spelling), CLAUDE_BIN, the repo
    const all = tab.raw.join('\n')
    for (const secret of [home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\'), bin, r.path, r.dir, homedir()]) assert.ok(!all.includes(secret), `the tab received ${JSON.stringify(secret)}`)
    assert.ok(!all.toLowerCase().includes('jürgen'), 'the home folder\'s name')
  })
})

/* ------------------------------------------------------------------ W1: imports send no path */

describe('W1: an import names no path of this computer', () => {
  test('a clone runs in the clone folder with the folder\'s NAME: git\'s lines say "Cloning into \'remote\'" — never where', async () => {
    const r = makeRepo()
    const base = tempDir('clones')
    const target = parseCloneUrl(r.remote, true)
    assert.ok(!('error' in target), JSON.stringify(target))
    const lines: string[] = []
    const res = await cloneInto(target, base, (p) => lines.push(p.line), { local: true })
    assert.equal(res.dir, join(base, 'remote'))
    assert.ok(lines.some((l) => /^Cloning into 'remote'/.test(l)), lines.join('\n'))
    for (const l of lines) assert.ok(!l.includes(base) && !l.includes(r.dir), l)
  })

  test('every text of an import event passes the scrubber: the clone folder is <clones>, the temp folder <tmp>, the home folder ~', () => {
    const clones = tempDir('clones')
    const w = new Worker({ config: { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), cloneDir: clones }, version: 'test', bin: 'claude', self: 'x', log: () => {} })
    const tmpFile = join(tmpdir(), 'one-intake-0123456789abcdef.zip')
    const st = w.intakeScrub({
      state: 'failed',
      source: 'clone',
      label: join(clones, 'local-remote.git'),
      line: `Cloning into '${join(clones, 'shop')}'...`,
      percent: null,
      error: `EPERM: operation not permitted, rename '${tmpFile}' -> '${join(clones, 'shop')}' (${join(homedir(), 'x')})`,
    })
    const all = JSON.stringify(st)
    for (const p of [clones, tmpdir(), homedir()]) assert.ok(!all.includes(JSON.stringify(p).slice(1, -1)), `${p} in ${all}`)
    assert.equal(st.line, `Cloning into '${join('<clones>', 'shop')}'...`)
    assert.match(st.error!, /<tmp>/)
  })
})

/* ------------------------------------------------------------------ W1: real workers */

describe('W1: a real worker — git actions, request errors, Claude Code installed later', () => {
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  test('a git action on a folder of another account: One gets git\'s first line with <repo> (no path, account or safe.directory line) and the hint by its code; a request error never names the home folder', { skip: !asRoot && 'needs root to hand the repository to another account (git\'s dubious-ownership check)' }, async () => {
    const r = makeRepo()
    const home = tempDir('home')
    const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r)] })
    worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', file], home })
    const tab = await FakeTab.connect(PORT)
    tabs.push(tab)
    tab.hello(WS_LOCAL)
    await tab.next('welcome')
    // the repository now belongs to another account: git refuses it
    const chown = (uid: number) => {
      const walk = (p: string) => {
        lchownSync(p, uid, uid)
        if (lstatSync(p).isDirectory()) for (const n of readdirSync(p)) walk(join(p, n))
      }
      walk(r.path)
    }
    chown(4242)
    try {
      const res = await tab.request({ op: 'git', verb: 'refresh', repo: 'demo', taskId: 'dub1abcd', branch: 'one/x', title: 'x' })
      assert.equal(res.ok, false)
      assert.equal((res as { error: string }).error, "git: fatal: detected dubious ownership in repository at '<repo>'")
      await waitFor(() => tab.messages.some((m) => m.type === 'event' && m.kind === 'log' && m.taskId === 'dub1abcd' && m.lines.some((l) => l.c === 'dubiousOwnership')), 5000, () => JSON.stringify(tab.messages.slice(-3)))
      // the exact line is for this computer's terminal only
      await waitFor(() => /safe\.directory/.test(worker!.stderr()), 5000, () => worker!.stderr())
      // the backstop: an error that names this computer's home folder (a repo name One sent) never reaches One with it
      const odd = await tab.request({ op: 'git', verb: 'refresh', repo: join(home, 'shop'), taskId: 'dub2abcd', branch: 'one/x', title: 'x' })
      assert.equal(odd.ok, false)
      assert.match((odd as { error: string }).error, /the repo "~[\\/]shop" is not in this worker's config/)
      const leak = leakIn(tab.raw.join('\n'), [r.path, r.dir, home])
      assert.equal(leak, null, `the tab received ${leak}`)
    } finally {
      chown(0)
    }
  })

  test('Claude Code installed while the worker runs: the next stage finds it (Retry works without a restart), and One hears of it', async () => {
    const r = makeRepo()
    const later = join(tempDir('later'), 'claude.mjs')
    const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r)] })
    worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', file], env: { CLAUDE_BIN: later } })
    const tab = await FakeTab.connect(PORT)
    tabs.push(tab)
    tab.hello(WS_LOCAL)
    assert.equal((await tab.next('welcome')).claude.found, false)
    const first = await tab.run(task({ kind: 'implement' }, { id: 'late1abc' }))
    assert.equal(first.status, 'failed')
    assert.equal(first.error, 'Claude Code was not found on this computer. Install it and sign in, or set CLAUDE_BIN.')
    // installed now (the fake CLI behind the file CLAUDE_BIN names)
    writeFileSync(later, `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(FAKE_CLAUDE).href)})\n`)
    if (process.platform !== 'win32') chmodSync(later, 0o755)
    const again = await tab.run(task({ kind: 'implement' }, { id: 'late1abc', branch: first.branch! }))
    assert.equal(again.status, 'ok', JSON.stringify(again))
    await waitFor(() => tab.messages.some((m) => m.type === 'welcome' && m.claude.found), 5000)
  })
})
