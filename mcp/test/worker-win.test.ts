/**
 * Worker 1.9.0 on Windows — git, paths and setup, each Windows rule run with an injected platform (and file system
 * where it reads one), so the whole file runs on every OS: git's arguments (long paths) and environment (ssh in
 * BatchMode only while the person set nothing), the hints for git's errors, worktree folder names, synced folders,
 * the scrubber's Windows forms, argument lines, ZIP names Windows refuses, renames that wait out a held file, the clone
 * folder, the usual places. Then a real worker: a missing Claude Code and a missing test command are named by code,
 * and no path of this computer reaches the tab.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs, { chmodSync, copyFileSync, existsSync, lchownSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, posix, win32 } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { pathToFileURL } from 'node:url'
import { after, afterEach, describe, test } from 'node:test'
import type { IntakeState, LogLine } from '../../src/app/features/coding/protocol.ts'
import { editOf, findClaude, mcpLaunchers, nativeNotOnPath, runClaude, toolLine } from '../src/worker/claude.ts'
import { cloneBase, cloneHint, cloneInto, parseCloneUrl, unquote } from '../src/worker/clone.ts'
import { emptyConfig, loadConfig, splitArgs, type RepoConfig } from '../src/worker/config.ts'
import { GitError, checkRepo, ensureWorktree, folderId, git, gitFailure, gitMessage, gitOk, insideWorktrees, nativePath, ownLocks, parseWorktrees, stillOurs, sweepLeftovers, tryFetch, worktreeFolder } from '../src/worker/git.ts'
import { BATCH_SSH, INCLUDE_IF_NOTE, folderBusyCode, forgetGitEnv, gitArgs, gitEnv, gitHint, hintLine, hintTerminal, sshCommandInEnv } from '../src/worker/gitenv.ts'
import { inICloud, inSyncedFolder, renameRetry } from '../src/worker/paths.ts'
import { noteGitHint, plantedError, runStage, syncedWarning } from '../src/worker/run.ts'
import { guessAnalyzeAsync, guessTest, shortPath, usualPlaces } from '../src/worker/scan.ts'
import { Scrubber, repoScrubber } from '../src/worker/scrub.ts'
import { joinArgs, syncedRow } from '../src/worker/setup.ts'
import { SETUP_JS } from '../src/worker/setup-page.ts'
import { WorkerState } from '../src/worker/state.ts'
import { INTAKE_ERROR_MAX, Worker } from '../src/worker/worker.ts'
import { Intake } from '../src/worker/intake.ts'
import { entryPath, gitDirIn, importZip, isUnsafe, zipPath, type GuardDisk } from '../src/worker/zipimport.ts'
import { OutputLines, runTests, safeHead } from '../src/worker/testrun.ts'
import { waitFor } from './helpers.ts'
import { FAKE_CLAUDE, FakeTab, GIT_ENV, IS_WIN, WS_LOCAL, caseFolds, cleanupAll, fakeBin, gitProgram, leakIn, makeRepo, onPath, plainRepo, repoEntry, sh, slashPath, spawnWorker, task, tempDir, writeConfig, WORKER_BUNDLE, type SpawnedWorker } from './worker-helpers.ts'

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

describe('W1 / Fix2: a program a lookup by name could take, at the top of the folder a Claude Code stage runs in (Windows)', () => {
  test('refused before Claude Code starts (plan, implement, doc) — the file\'s name only, the folder in the terminal; the tests and the analysis run (they run the repo\'s own code); elsewhere every stage runs as before', async () => {
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
    const home = tempDir('home')
    const run = async (kind: 'implement' | 'plan' | 'test' | 'analyze' | 'doc', platform: NodeJS.Platform, branch: string | null = null) => {
      const lines: LogLine[] = []
      const terminal: string[] = []
      const outcome = await runStage({ repo, state, task: task({ kind }, { id: 'plant9ab', branch }), team: false, caps, bin: join(tempDir('noclaude'), 'claude'), taskMcp: null, signal: new AbortController().signal, log: (l) => lines.push(l), git: () => {}, question: () => null, terminal: (m) => terminal.push(m), platform, home })
      return { outcome, lines, terminal }
    }
    const impl = await run('implement', 'win32')
    assert.equal(impl.outcome.status, 'refused', JSON.stringify(impl.outcome))
    assert.match(impl.outcome.error!, /holds git\.exe at its top level, a program a lookup by name could take/)
    assert.match(impl.outcome.error!, /in the repository AND on the task's branch \(an existing worktree keeps it/)
    assert.deepEqual(impl.lines.filter((l) => l.c === 'plantedProgram').map((l) => l.v), [{ file: 'git.exe' }])
    assert.ok(!impl.lines.some((l) => l.c === 'starting'), 'Claude Code never started')
    // this computer's terminal names the folder (One never gets it)
    assert.ok(impl.terminal.some((m) => m.includes('git.exe') && m.includes(r.worktrees)), impl.terminal.join('\n'))
    const branch = impl.outcome.branch!
    for (const kind of ['plan', 'doc'] as const) {
      const { outcome, lines } = await run(kind, 'win32', kind === 'plan' ? null : branch)
      assert.equal(outcome.status, 'refused', `${kind}: ${JSON.stringify(outcome)}`)
      assert.ok(lines.some((l) => l.c === 'plantedProgram' && l.v?.file === 'git.exe'), kind)
    }
    // the tests and the analysis run the repo's own code by design: never refused for it (D1)
    const tested = await run('test', 'win32', branch)
    assert.equal(tested.outcome.status, 'ok', JSON.stringify(tested.outcome))
    assert.ok(tested.lines.some((l) => l.c === 'testsRun') && !tested.lines.some((l) => l.c === 'plantedProgram'))
    const analysed = await run('analyze', 'win32', branch)
    assert.equal(analysed.outcome.status, 'ok', JSON.stringify(analysed.outcome))
    assert.ok(analysed.lines.some((l) => l.c === 'analyzeRun') && !analysed.lines.some((l) => l.c === 'plantedProgram'))
    // no path of this computer in what One would get
    const all = JSON.stringify([impl.outcome, impl.lines])
    assert.ok(!all.includes(r.dir), 'a path reached One')
    // macOS / Linux: no such lookup there — every stage runs
    const linux = await run('test', 'linux', branch)
    assert.equal(linux.outcome.status, 'ok', JSON.stringify(linux.outcome))
    assert.ok(!linux.lines.some((l) => l.c === 'plantedProgram'))
  })

  test('the person\'s MCP launchers count: a uvx.cmd (fixed list), a my-kb.cmd that a server of theirs starts (user scope; the repo\'s .mcp.json only with its settings on) — and a program Claude Code wrote during an implement stage ends it refused', async () => {
    const r = makeRepo()
    // the repo's own Claude Code settings off (as for a clone): its .mcp.json names no launcher of the person's
    const cfg = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r, { claude: { maxTurns: 10, mcpServers: ['kb'], projectSettings: false } })] })
    const { config } = loadConfig(cfg)
    const repo = config.repos[0]!
    assert.equal(repo.claude.projectSettings, false)
    const state = new WorkerState(cfg)
    const caps = { found: true, version: '9.9.9', budget: true, modes: [], settingSources: true }
    const home = tempDir('home')
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { kb: { type: 'stdio', command: String.raw`C:\tools\My-KB.exe`, args: [] }, web: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }, projects: {} }))
    const stage = async (kind: 'implement' | 'plan', branch: string | null, text = 'x', bin = join(tempDir('noclaude'), 'claude')) => {
      const lines: LogLine[] = []
      const outcome = await runStage({ repo: config.repos[0]!, state, task: task({ kind }, { id: 'mcpl1abc', branch, text }), team: false, caps, bin, taskMcp: null, signal: new AbortController().signal, log: (l) => lines.push(l), git: () => {}, question: () => null, platform: 'win32', home })
      return { outcome, lines }
    }
    // nothing planted: the stage gets as far as Claude Code (not found here — a fake path)
    const first = await stage('plan', null)
    assert.equal(first.outcome.status, 'failed', JSON.stringify(first.outcome))
    const branch = first.outcome.branch!
    const wt = join(repo.worktreeDir, branch.replace(/\//g, '-'))
    for (const [file, why] of [['uvx.cmd', 'the fixed list'], ['my-kb.cmd', 'a launcher of a user-scope server']] as const) {
      writeFileSync(join(wt, file), '#!/usr/bin/env node\n')
      const { outcome, lines } = await stage('plan', branch)
      assert.equal(outcome.status, 'refused', `${why}: ${JSON.stringify(outcome)}`)
      assert.deepEqual(lines.filter((l) => l.c === 'plantedProgram').map((l) => l.v), [{ file }], why)
      rmSync(join(wt, file))
    }
    // the repo's own .mcp.json names launchers only while its settings load (projectSettings)
    writeFileSync(join(wt, '.mcp.json'), JSON.stringify({ mcpServers: { repo: { command: 'repo-launch' } } }))
    writeFileSync(join(wt, 'repo-launch.cmd'), '')
    const off = await stage('plan', branch)
    assert.equal(off.outcome.status, 'failed', `settings off: not a launcher — ${JSON.stringify(off.lines.filter((l) => l.c === 'plantedProgram'))}`)
    const trusted = loadConfig(writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r, { claude: { maxTurns: 10, projectSettings: true } })] })).config.repos[0]!
    const lines: LogLine[] = []
    const out = await runStage({ repo: trusted, state, task: task({ kind: 'plan' }, { id: 'mcpl1abc', branch }), team: false, caps, bin: 'x', taskMcp: null, signal: new AbortController().signal, log: (l) => lines.push(l), git: () => {}, question: () => null, platform: 'win32', home })
    assert.equal(out.status, 'refused', JSON.stringify(out))
    assert.ok(lines.some((l) => l.c === 'plantedProgram' && l.v?.file === 'repo-launch.cmd'))
    rmSync(join(wt, 'repo-launch.cmd'))
    rmSync(join(wt, '.mcp.json'))
    // an implement stage whose Claude Code writes git.cmd at the top: ended refused right after it (the next stage would be too)
    if (!IS_WIN) {
      chmodSync(FAKE_CLAUDE, 0o755)
      const log = join(tempDir('fakelog'), 'args.jsonl')
      process.env.FAKE_CLAUDE_LOG = log
      try {
        const impl = await stage('implement', branch, 'FAKE:PLANT git.cmd', FAKE_CLAUDE)
        assert.equal(impl.outcome.status, 'refused', JSON.stringify(impl.outcome))
        assert.ok(impl.lines.some((l) => l.c === 'starting'), 'Claude Code ran')
        assert.ok(impl.lines.some((l) => l.c === 'plantedProgram' && l.v?.file === 'git.cmd'), JSON.stringify(impl.lines.map((l) => l.c ?? l.s)))
      } finally {
        delete process.env.FAKE_CLAUDE_LOG
      }
    }
  })

  test('mcpLaunchers: user scope always; the repo\'s local scope and .mcp.json only with its own settings; $CLAUDE_CONFIG_DIR; an unreadable config adds none', () => {
    const home = tempDir('home')
    const dir = tempDir('wt')
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'uvx', args: ['x'] }, b: { type: 'stdio', command: '/opt/bin/Docker' }, c: { type: 'sse', url: 'x', command: 'nope' } }, projects: { [dir]: { mcpServers: { d: { command: 'local-one.cmd' } } } } }))
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { e: { command: 'from-repo' } } }))
    assert.deepEqual(mcpLaunchers({ dirs: [dir], projectSettings: false, home, env: {} }), ['docker', 'uvx'])
    assert.deepEqual(mcpLaunchers({ dirs: [dir], projectSettings: true, home, env: {} }), ['docker', 'from-repo', 'local-one', 'uvx'])
    const other = tempDir('cfg')
    writeFileSync(join(other, '.claude.json'), JSON.stringify({ mcpServers: { z: { command: 'zed' } } }))
    assert.deepEqual(mcpLaunchers({ dirs: [dir], projectSettings: false, home, env: { CLAUDE_CONFIG_DIR: other } }), ['zed'])
    writeFileSync(join(other, '.claude.json'), '{ not json')
    assert.deepEqual(mcpLaunchers({ dirs: [dir], projectSettings: false, home, env: { CLAUDE_CONFIG_DIR: other } }), [])
    assert.deepEqual(mcpLaunchers({ dirs: [dir], projectSettings: false, home: tempDir('none'), env: {} }), [])
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

/* ------------------------------------------------------------------ W2 */

describe('W2: ssh on a clone — core.sshCommand handed over in the environment (Windows); macOS / Linux as 1.8.1', () => {
  /** This process's environment without a GIT_SSH* or GIT_CONFIG_* of the test machine (a runner's proxy sets some). */
  const clean = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV }
    for (const k of Object.keys(env)) if (/^(git_ssh(_command)?|git_config_(count|key_\d+|value_\d+|parameters))$/i.test(k)) delete env[k]
    return { ...env, ...extra }
  }
  const viaCount = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x', GIT_CONFIG_KEY_1: 'Core.SSHCommand', GIT_CONFIG_VALUE_1: 'ssh -i ~/.ssh/id_work' }

  test('sshCommandInEnv: GIT_CONFIG_COUNT / KEY_<n> (any case of the key, and of the variable on Windows) and GIT_CONFIG_PARAMETERS (`git -c`)', () => {
    assert.equal(sshCommandInEnv(viaCount, 'linux'), true)
    assert.equal(sshCommandInEnv({ git_config_count: '1', git_config_key_0: 'core.sshcommand' }, 'win32'), true)
    assert.equal(sshCommandInEnv({ git_config_count: '1', git_config_key_0: 'core.sshcommand' }, 'linux'), false, 'POSIX keys keep their case')
    assert.equal(sshCommandInEnv({ GIT_CONFIG_PARAMETERS: "'core.sshCommand'='ssh -i k' 'alias.p'='!x'" }, 'linux'), true)
    assert.equal(sshCommandInEnv({ GIT_CONFIG_PARAMETERS: "'core.sshcommand=ssh'" }, 'linux'), true, 'the older quoting')
    assert.equal(sshCommandInEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommandX' }, 'linux'), false)
    assert.equal(sshCommandInEnv({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_KEY_1: 'url.https://h/.insteadOf' }, 'linux'), false)
    assert.equal(sshCommandInEnv({ GIT_CONFIG_PARAMETERS: "'alias.x'='core.sshCommand=1'" }, 'linux'), false, 'a value that only mentions it')
    assert.equal(sshCommandInEnv({ GIT_CONFIG_PARAMETERS: "'a.b'='it'\\''s' 'core.sshCommand'='ssh'" }, 'linux'), true, 'after a value with a quote in it')
    assert.equal(sshCommandInEnv({ GIT_CONFIG_PARAMETERS: 'not git\'s quoting core.sshCommand=x' }, 'linux'), true, 'a form it cannot read: any mention counts (their ssh stays)')
    assert.equal(sshCommandInEnv({}, 'win32'), false)
  })

  test('a clone with core.sshCommand in the environment: no BatchMode on Windows (the scoped --global read cannot see it); macOS / Linux never add one', async () => {
    forgetGitEnv()
    // the real git: its scoped read misses the environment's config — what a clone would otherwise decide on
    const scoped = gitExit(['config', '--global', '--get', 'core.sshCommand'], clean(viaCount))
    assert.equal(scoped, 1, 'git config --global does not read GIT_CONFIG_COUNT')
    assert.equal((await gitEnv(null, clean(viaCount), { platform: 'win32' })).GIT_SSH_COMMAND, undefined)
    assert.equal((await gitEnv(null, clean({ GIT_CONFIG_PARAMETERS: "'core.sshCommand'='ssh -i k'" }), { platform: 'win32' })).GIT_SSH_COMMAND, undefined)
    assert.equal((await gitEnv(null, clean(), { platform: 'win32' })).GIT_SSH_COMMAND, BATCH_SSH, 'nothing set: BatchMode (Windows)')
    // an existing repository: git's own unscoped read sees the environment's config — no BatchMode either
    const repo = plainRepo(join(tempDir('gitenv'), 'repo'))
    forgetGitEnv()
    assert.equal((await gitEnv(repo, clean(viaCount), { platform: 'win32' })).GIT_SSH_COMMAND, undefined)
    for (const platform of ['linux', 'darwin'] as const) {
      forgetGitEnv()
      assert.equal((await gitEnv(null, clean(), { platform })).GIT_SSH_COMMAND, undefined, `${platform}: as 1.8.1`)
      assert.equal((await gitEnv(null, clean(viaCount), { platform })).GIT_SSH_COMMAND, undefined, platform)
      assert.equal((await gitEnv(repo, clean(), { platform })).GIT_SSH_COMMAND, undefined, platform)
    }
    forgetGitEnv()
  })
})

/** git's exit code for `args` with `env` (the tests' own git, by its file on Windows). */
function gitExit(args: string[], env: NodeJS.ProcessEnv): number {
  try {
    execFileSync(gitProgram(), args, { env, stdio: 'ignore', cwd: tempDir('cwd') })
    return 0
  } catch (e) {
    return (e as { status?: number }).status ?? -1
  }
}

describe('W2: paths git prints, in this computer\'s form', () => {
  test('nativePath / parseWorktrees: Git for Windows\' C:/Users/… becomes C:\\Users\\… (and UNC \\\\server\\share); elsewhere as git wrote it', () => {
    assert.equal(nativePath('C:/Users/runneradmin/AppData/Local/Temp/wt/one-x', 'win32'), 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\wt\\one-x')
    assert.equal(nativePath('//server/share/repo/', 'win32'), '\\\\server\\share\\repo')
    assert.equal(nativePath('/home/me/wt/one-x/', 'linux'), '/home/me/wt/one-x')
    const out = 'worktree C:/code/site\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\nworktree C:/code/.one-worktrees/site/one-fix-1\r\nHEAD def\r\nbranch refs/heads/one/fix-1\r\n\r\nworktree D:/bare.git\r\nbare\r\n'
    assert.deepEqual(parseWorktrees(out, 'win32'), [
      { path: 'C:\\code\\site', branch: 'main', head: 'abc', bare: false },
      { path: 'C:\\code\\.one-worktrees\\site\\one-fix-1', branch: 'one/fix-1', head: 'def', bare: false },
      { path: 'D:\\bare.git', branch: null, head: null, bare: true },
    ])
    assert.deepEqual(parseWorktrees('worktree /srv/a b/x\nHEAD 1\ndetached\n', 'linux'), [{ path: '/srv/a b/x', branch: null, head: '1', bare: false }])
  })

  test('a task\'s worktree from an earlier stage comes back as the worker made it (the same string), from git\'s own list', async () => {
    const r = makeRepo()
    const file = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const repo = loadConfig(file).config.repos[0]!
    const state = new WorkerState(file)
    const first = await ensureWorktree(repo, state, { id: 'same1abc', title: 'Same path' }, null)
    const again = await ensureWorktree(repo, state, { id: 'same1abc', title: 'Same path' }, null)
    assert.equal(again.dir, first.dir)
    assert.ok(again.dir.startsWith(r.worktrees), again.dir)
    assert.equal(await checkRepo(repo), nativePath(sh(r.path, 'rev-parse', '--show-toplevel').trim()))
  })

  test('inICloud resolves the home folder as it resolves the path (a home written another way)', () => {
    const rel = join('kim-home', 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'repo')
    assert.equal(inICloud(join(process.cwd(), rel), 'kim-home', 'darwin'), true)
    assert.equal(inICloud('/Users/kim/Library/Mobile Documents/x', '/Users/kim/', 'darwin'), true)
    assert.equal(inICloud('/Users/kim/code/x', '/Users/kim', 'darwin'), false)
  })
})

describe('W2: the ZIP guard names a git folder as it is stored — also on a disk that folds names', () => {
  /** A disk that answers for any spelling of a name (case-insensitive, as APFS and NTFS usually are). */
  const folding: GuardDisk = {
    lstat: (p) => {
      const dir = dirname(p)
      const hit = existsSync(dir) ? readdirSync(dir).find((n) => n.toLowerCase() === basename(p).toLowerCase()) : undefined
      return hit === undefined ? undefined : lstatSync(join(dir, hit))
    },
    list: (dir) => readdirSync(dir, { withFileTypes: true }),
  }

  test('".GIT" on a folding disk: refused as ".GIT" (the name the person finds in their ZIP), not ".git"', () => {
    const top = tempDir('guard')
    mkdirSync(join(top, '.GIT'))
    assert.deepEqual(gitDirIn(top, folding), { path: join(top, '.GIT'), kind: 'dotgit' })
    assert.deepEqual(gitDirIn(top), { path: join(top, '.GIT'), kind: 'dotgit' })
    const deep = tempDir('guard')
    mkdirSync(join(deep, 'a', '.Git'), { recursive: true })
    assert.deepEqual(gitDirIn(deep, folding), { path: join(deep, 'a', '.Git'), kind: 'dotgit' })
  })

  test('a folding nobody foresaw (the disk answers ".git" for another name): named by the entry it answers with', () => {
    const top = tempDir('guard')
    mkdirSync(join(top, 'odd-name'))
    writeFileSync(join(top, 'README.md'), 'x\n')
    const odd: GuardDisk = { ...folding, lstat: (p) => (basename(p) === '.git' ? lstatSync(join(dirname(p), 'odd-name')) : folding.lstat(p)) }
    assert.deepEqual(gitDirIn(top, odd), { path: join(top, 'odd-name'), kind: 'dotgit' })
    const clean = tempDir('guard')
    mkdirSync(join(clean, 'src'))
    assert.equal(gitDirIn(clean, folding), null)
  })

  test('caseFolds asks the disk itself (the macOS / Windows runners: true; Linux: false) — never the OS', () => {
    const dir = tempDir('fold')
    writeFileSync(join(dir, 'Probe-A.txt'), '')
    assert.equal(caseFolds(dir), existsSync(join(dir, 'probe-a.TXT')))
  })
})

describe('W2: a failed checkout\'s folder Windows still held — remembered in worker-state.json, removed next time', () => {
  /** Make `dir` impossible to remove for this account (root: an immutable file; else a folder without write access). */
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const holdScript = asRoot ? 'mkdir -p locked && echo x > locked/f && chattr +i locked/f' : 'mkdir -p locked && echo x > locked/f && chmod 555 locked'
  const release = (dir: string) => {
    if (!existsSync(join(dir, 'locked'))) return
    if (asRoot) execFileSync('chattr', ['-i', join(dir, 'locked', 'f')])
    else chmodSync(join(dir, 'locked'), 0o755)
  }
  /** Can a folder be held here at all (chattr needs an ext4-like disk; Windows has no sh hook)? */
  const canHold = (() => {
    if (IS_WIN) return false
    const probe = tempDir('hold')
    try {
      execFileSync('sh', ['-c', holdScript], { cwd: probe, stdio: 'ignore' })
      try {
        rmSync(probe, { recursive: true, force: true })
        return false
      } catch {
        return true
      } finally {
        release(probe)
      }
    } catch {
      return false
    }
  })()

  test('the folder and the branch are in the state file; after a restart the same task gets the same branch and folder back', { skip: !canHold && 'cannot hold a folder here (Windows: no sh hook; a disk without chattr)' }, async () => {
    const r = makeRepo()
    const file = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const repo = loadConfig(file).config.repos[0]!
    // the checkout fails (its hook exits 1) and leaves a folder nobody can remove
    const hook = join(r.path, '.git', 'hooks', 'post-checkout')
    writeFileSync(hook, `#!/bin/sh\n${holdScript}\nexit 1\n`, { mode: 0o755 })
    const notes: Array<[string, string, string | undefined]> = []
    await assert.rejects(ensureWorktree(repo, new WorkerState(file), { id: 'held1abc', title: 'Held' }, null, (k, s, c) => notes.push([k, s, c])))
    const dir = join(r.worktrees, 'one-held-held1a')
    assert.ok(existsSync(dir), 'the folder is still there')
    // a restart: what the worker knows comes from worker-state.json alone
    const left = new WorkerState(file).leftovers('demo')
    assert.deepEqual(left.map((l) => [l.dir, l.branch]), [[dir, 'one/held-held1a']])
    assert.ok(!notes.some(([, , c]) => c === 'folderBusy'), 'folderBusy only on Windows')
    // the person closes what held it; the next try (after the restart) removes it and takes the same name
    release(dir)
    rmSync(hook)
    const state = new WorkerState(file)
    const wt = await ensureWorktree(repo, state, { id: 'held1abc', title: 'Held' }, null)
    assert.deepEqual([wt.dir, wt.branch], [dir, 'one/held-held1a'])
    assert.ok(existsSync(join(dir, 'README.md')))
    assert.deepEqual(new WorkerState(file).leftovers('demo'), [])
  })

  test('sweepLeftovers removes only what a failed checkout left: never a task\'s worktree, never outside the worktree folder, a branch only while untouched', async () => {
    const r = makeRepo()
    const file = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const repo = loadConfig(file).config.repos[0]!
    const state = new WorkerState(file)
    const live = await ensureWorktree(repo, state, { id: 'live1abc', title: 'Live' }, null)
    const outside = join(tempDir('outside'), 'keep')
    mkdirSync(outside)
    const gone = join(r.worktrees, 'one-gone-x1')
    mkdirSync(join(gone, 'sub'), { recursive: true })
    // a branch the failed checkout made, untouched since — and one that got a commit since (kept)
    sh(r.path, 'branch', 'one/gone-x1', 'main')
    const tip = sh(r.path, 'rev-parse', 'one/gone-x1').trim()
    sh(r.path, 'branch', 'one/moved-x2', 'main')
    const moved = join(r.worktrees, 'one-moved-x2')
    mkdirSync(moved)
    state.addLeftover('demo', { dir: live.dir, branch: live.branch, tip: null, at: 1 })
    state.addLeftover('demo', { dir: outside, branch: 'x', tip: null, at: 1 })
    state.addLeftover('demo', { dir: gone, branch: 'one/gone-x1', tip, at: 1 })
    state.addLeftover('demo', { dir: moved, branch: 'one/moved-x2', tip: '0'.repeat(40), at: 1 })
    const removed = await sweepLeftovers(repo, state)
    assert.deepEqual(removed.sort(), [gone, moved].sort())
    assert.ok(existsSync(join(live.dir, 'README.md')), 'a task\'s worktree stays')
    assert.ok(existsSync(outside), 'outside the worktree folder: never removed')
    assert.equal(existsSync(gone), false)
    assert.equal(sh(r.path, 'branch', '--list', 'one/gone-x1').trim(), '', 'the untouched branch went with it')
    assert.match(sh(r.path, 'branch', '--list', 'one/moved-x2'), /one\/moved-x2/, 'a branch that is not where the checkout left it stays')
    assert.deepEqual(new WorkerState(file).leftovers('demo'), [])
  })
})

describe('W2: where the task worktrees are, as the synced-folder lines say it', () => {
  const home = '/Users/kim'
  const cloud = `${home}/Library/CloudStorage/OneDrive-Personal/site`
  const repoAt = (worktreeDir: string) => ({ name: 'site', path: cloud, worktreeDir }) as RepoConfig
  const mac = { platform: 'darwin' as const, home }

  test('syncedWarning: ~/.one-worktrees named only when they are there; an own folder, or one in a synced folder too, said as it is', () => {
    const atHome = syncedWarning('cloudStorage', repoAt(`${home}/.one-worktrees/site`), mac)
    assert.deepEqual(atHome.v, { repo: 'site', worktrees: 'home' })
    assert.match(atHome.s, /stay out of it, in ~\/\.one-worktrees\./)
    const own = syncedWarning('cloudStorage', repoAt('/Volumes/fast/wt/site'), mac)
    assert.deepEqual(own.v, { repo: 'site', worktrees: 'own' })
    assert.ok(!own.s.includes('.one-worktrees'), own.s)
    assert.match(own.s, /stay out of it\./)
    const synced = syncedWarning('cloudStorage', repoAt(`${home}/Library/CloudStorage/Dropbox/wt/site`), mac)
    assert.deepEqual(synced.v, { repo: 'site', worktrees: 'synced' })
    assert.match(synced.s, /in a synced folder too \(worktreeDir in worker\.json\)/)
    // Windows: OneDrive, the worktrees in .one-worktrees in the user folder — or a cloud worker's own folder
    const win = { platform: 'win32' as const, home: 'C:\\Users\\Kim', env: { OneDrive: 'C:\\Users\\Kim\\OneDrive' } }
    const od = (worktreeDir: string) => syncedWarning('onedrive', { name: 'site', path: 'C:\\Users\\Kim\\OneDrive\\code\\site', worktreeDir } as RepoConfig, win)
    assert.equal(od('C:\\Users\\Kim\\.one-worktrees\\site').v.worktrees, 'home')
    assert.match(od('C:\\Users\\Kim\\.one-worktrees\\site').s, /in \.one-worktrees in your user folder\./)
    assert.equal(od('C:\\Users\\Kim\\.config\\one-cloud\\worktrees\\site').v.worktrees, 'own')
    assert.equal(od('c:\\users\\kim\\onedrive\\wt\\site').v.worktrees, 'synced')
    // iCloud's line says nothing of them (as before) — the value is there all the same
    assert.equal(syncedWarning('icloud', repoAt(`${home}/.one-worktrees/site`), mac).v.worktrees, 'home')
  })

  test('the setup page\'s rows: a ticked repo by its worktreeDir, one not ticked yet by the default it would get (a cloud worker: its own folder)', () => {
    const opts = { home, platform: 'darwin' as const, cloud: false }
    assert.deepEqual(syncedRow(cloud, null, opts), { synced: 'cloudStorage', worktrees: 'home' })
    assert.deepEqual(syncedRow(cloud, null, { ...opts, cloud: true }), { synced: 'cloudStorage', worktrees: 'own' })
    assert.deepEqual(syncedRow(cloud, '/Volumes/fast/wt/site', opts), { synced: 'cloudStorage', worktrees: 'own' })
    assert.deepEqual(syncedRow(cloud, `${home}/Library/CloudStorage/Dropbox/wt`, opts), { synced: 'cloudStorage', worktrees: 'synced' })
    assert.deepEqual(syncedRow(`${home}/code/site`, null, opts), { synced: null, worktrees: null })
    // the page has the words for each, in English and German
    for (const key of ['wthome', 'wtown', 'wtsynced', 'syncedcloudStorage', 'syncedonedrive']) assert.equal(SETUP_JS.split(`${key}: '`).length - 1, 2, key)
    assert.ok(!/Unless worktreeDir|Sofern worktreeDir/.test(SETUP_JS), 'no line claims a folder the worktrees may not be in')
  })
})

describe('W2: Claude Code installed after the start — by its native installer, off the worker\'s PATH', () => {
  test('findClaude: macOS / Linux take ~/.local/bin/claude while PATH has none (as Windows takes its claude.exe); on PATH: by its name', () => {
    const exists = (files: string[]) => (p: string) => files.includes(p)
    const native = '/home/max/.local/bin/claude'
    assert.deepEqual(findClaude({ PATH: '/usr/bin:/bin' }, { platform: 'linux', home: '/home/max', exists: exists([native]) }), { bin: native, from: 'native' })
    assert.deepEqual(findClaude({ PATH: '/usr/bin:/opt/n/bin' }, { platform: 'darwin', home: '/home/max', exists: exists([native, '/opt/n/bin/claude']) }), { bin: 'claude', from: 'path' })
    assert.deepEqual(findClaude({ PATH: '/usr/bin' }, { platform: 'linux', home: '/home/max', exists: exists([]) }), { bin: 'claude', from: 'path' })
    // a relative PATH entry is the working folder: never counts as "on PATH"
    assert.deepEqual(findClaude({ PATH: '.:bin' }, { platform: 'linux', home: '/home/max', exists: (p) => p === native || !p.startsWith('/') }), { bin: native, from: 'native' })
    assert.match(nativeNotOnPath('linux'), /~\/\.local\/bin/)
    assert.match(nativeNotOnPath('win32'), /%USERPROFILE%/)
  })

  const FAKE_NATIVE_SKIP = IS_WIN && 'a fake Claude Code cannot be claude.exe — the native file on Windows is covered by findClaude above'

  test('a stage\'s Retry finds it, and the setup page within seconds: the worker looks again with findClaude, not only at the file it started with', { skip: FAKE_NATIVE_SKIP }, async () => {
    const r = makeRepo()
    const home = tempDir('home')
    // PATH: git and node only — no claude anywhere
    const bin = tempDir('bin')
    symlinkSync(onPath('git'), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const file = writeConfig(r, { workspace: WS_LOCAL.id, port: PORT, pollSec: 2, name: 'test-box', repos: [repoEntry(r)] })
    worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', file], home, env: { CLAUDE_BIN: '', PATH: bin } })
    const tab = await FakeTab.connect(PORT)
    tabs.push(tab)
    tab.hello(WS_LOCAL)
    assert.equal((await tab.next('welcome')).claude.found, false)
    const first = await tab.run(task({ kind: 'implement' }, { id: 'native1a' }))
    assert.equal(first.status, 'failed')
    // the native installer puts it in ~/.local/bin and only tells the person to add that to PATH
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${FAKE_CLAUDE}' "$@"\n`, { mode: 0o755 })
    const again = await tab.run(task({ kind: 'implement' }, { id: 'native1a', branch: first.branch! }))
    assert.equal(again.status, 'ok', JSON.stringify(again))
    await waitFor(() => tab.messages.some((m) => m.type === 'welcome' && m.claude.found), 5000)
    assert.match(worker.stderr(), /claude is in ~\/\.local\/bin, which is not on the PATH the worker started with/)
  })

  test('in-process: while not found, the setup page\'s polls look again (at most every few seconds) — and see a later install', async () => {
    const home = tempDir('home')
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH, look: process.env.ONE_WORKER_LOOK_MS }
    const bin = tempDir('bin')
    Object.assign(process.env, { HOME: home, USERPROFILE: home, PATH: bin, ONE_WORKER_LOOK_MS: '50' })
    try {
      const w = new Worker({ config: { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), port: 0 }, version: 'test', bin: 'claude', claudeFrom: 'path', self: 'x', log: () => {} })
      assert.equal(w.live().claude.found, false)
      const native = join(home, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude')
      mkdirSync(dirname(native), { recursive: true })
      if (IS_WIN) copyFileSync(process.execPath, native)
      else writeFileSync(native, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_CLAUDE}' "$@"\n`, { mode: 0o755 })
      await waitFor(() => w.live().claude.found, 10_000)
      assert.equal(w.info().claude.found, true)
    } finally {
      for (const [k, v] of Object.entries({ HOME: saved.HOME, USERPROFILE: saved.USERPROFILE, PATH: saved.PATH, ONE_WORKER_LOOK_MS: saved.look })) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

/* ------------------------------------------------------------------ Fix2 */

describe('Fix2: output is scrubbed before it is cut (D3) — live lines, the tail, Claude Code\'s tool lines', () => {
  const HOME = '/home/maximilian.mustermann'
  const sc = new Scrubber([], { platform: 'linux', home: HOME, tmp: '/tmp', realpath: () => null })
  const scrub = (s: string) => sc.text(s)
  const leak = (texts: string[]) => texts.find((t) => /maximilian|mustermann|ilian\.|\.musterm|stermann/.test(t))
  const repoOf = (script: string) => ({ testCommand: [process.execPath, '-e', script], testTimeoutSec: 60 }) as unknown as RepoConfig

  test('a path at the 500th character of a live line: the line is scrubbed first, then cut — never "/home/maximilian" in halves', async () => {
    const script = `process.stdout.write('E'.repeat(480) + ' at ${HOME}/shop/src/login.test.js\\nnext\\n')`
    const lines: string[] = []
    const r = await runTests(repoOf(script), tempDir('cut'), new AbortController().signal, (l) => lines.push(l), scrub)
    assert.equal(lines.length, 2, JSON.stringify(lines))
    assert.equal(leak([...lines, r.output]), undefined, JSON.stringify(lines))
    assert.ok(lines[0]!.length <= 500 && lines[0]!.includes(' at ~/shop/'), lines[0])
    assert.match(r.output, / at ~\/shop\/src\/login\.test\.js\nnext$/)
  })

  test('one line far over 4,000 characters (a JSON reporter) in pieces: its head once, the rest up to the next break dropped — no live line starts inside it, no path in halves', async () => {
    // 60,000 characters of paths without a break, written in small pieces (each piece boundary a possible cut)
    const script = `const p = '${HOME}/shop/test'; let s = '{"files":['; for (let i = 0; s.length < 60000; i++) s += JSON.stringify(p + i + '.spec.js') + ','; s += ']}';
      const w = (t) => new Promise((r) => process.stdout.write(t, () => setTimeout(r, 2)));
      (async () => { for (let i = 0; i < s.length; i += 777) await w(s.slice(i, i + 777)); await w('\\nafter the long line\\n') })()`
    const lines: string[] = []
    const r = await runTests(repoOf(script), tempDir('long'), new AbortController().signal, (l) => lines.push(l), scrub)
    assert.equal(r.ok, true, r.output.slice(0, 300))
    assert.equal(lines.length, 2, JSON.stringify(lines.map((l) => l.slice(0, 60))))
    assert.ok(lines[0]!.startsWith('{"files":["~/shop/test0.spec.js"'), lines[0]!.slice(0, 80))
    assert.ok(lines[0]!.length <= 502)
    assert.equal(lines[1], 'after the long line')
    assert.equal(leak([...lines, r.output]), undefined, leak([...lines, r.output])?.slice(0, 200))
    assert.match(r.output, /more characters of that line left out\nafter the long line$/)
  })

  test('a progress bar\'s bare "\\r": each step a line; "\\r\\n" split across two pieces is one break', async () => {
    const script = `const w = (t) => new Promise((r) => process.stdout.write(t, () => setTimeout(r, 30)));
      (async () => { await w('10%\\r20%\\r30%\\r'); await w('\\ndone\\r'); await w('\\nend') })()`
    const lines: string[] = []
    const r = await runTests(repoOf(script), tempDir('cr'), new AbortController().signal, (l) => lines.push(l), scrub)
    assert.deepEqual(lines, ['10%', '20%', '30%', 'done', 'end'])
    assert.equal(r.output, '10%\n20%\n30%\ndone\nend')
  })

  test('the tail One gets starts at a line (scrubbed before anything is cut)', () => {
    const lines: string[] = []
    const out = new OutputLines(scrub, (l) => lines.push(l), 1000)
    for (let i = 0; i < 200; i++) out.add('out', `line ${i} ${HOME}/shop/f${i}.js\n`)
    out.flush()
    const tail = out.output()
    assert.ok(tail.startsWith('…\nline '), tail.slice(0, 40))
    assert.match(tail.split('\n')[1]!, /^line \d+ ~\/shop\/f\d+\.js$/)
    assert.equal(leak([tail, ...lines]), undefined)
    // a head cut at 4,000 characters keeps clear of the cut: a path the cut split is never in what goes out
    const head = `${'x'.repeat(3990)}${HOME}/shop`.slice(0, 4000)
    assert.equal(safeHead(head, scrub, 500), 'x'.repeat(500))
    const dense = `${`${HOME}/a `.repeat(140)}`.slice(0, 4000)
    assert.equal(leak([safeHead(dense, scrub, 500)]), undefined)
  })

  test('Claude Code\'s tool lines and edits: scrubbed, then clipped', () => {
    const command = `${'x'.repeat(270)} ${HOME}/shop/run.sh`
    assert.equal(leak([toolLine('Bash', { command }, scrub)]), undefined)
    assert.match(toolLine('Bash', { command }, scrub), /x ~\/shop\/run\.sh$/)
    // without a scrubber (as before): the cut leaves a half the scrubber no longer matches
    assert.ok(leak([toolLine('Bash', { command })]))
    const e = editOf('Write', { file_path: `${HOME}/shop/a.txt`, content: `${'y\n'.repeat(5)}${HOME}/x\n` }, scrub)!
    assert.equal(e.path, '~/shop/a.txt')
    assert.equal(leak([JSON.stringify(e)]), undefined)
  })
})

describe('Fix2: git does not know who commits — no account or computer name to One, the hint gitIdentity', () => {
  const WIN_TEXT = `Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\n  git config --global user.name "Your Name"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: unable to auto-detect email address (got 'Max Muster@DESKTOP-4F2K9QL.(none)')`

  test('gitMessage drops the identity git guessed; gitHint names it; the hint carries the repo name only', () => {
    const msg = gitMessage(WIN_TEXT)
    assert.ok(!/Max|DESKTOP|4F2K9QL/.test(msg), msg)
    assert.match(msg, /fatal: unable to auto-detect email address \(got '…'\)$/)
    assert.equal(gitMessage("fatal: empty ident name (for <max@desktop-4f2k9ql>) not allowed"), 'fatal: empty ident name (for <…>) not allowed')
    assert.equal(gitHint(WIN_TEXT, 'win32'), 'gitIdentity')
    assert.equal(gitHint('fatal: empty ident name (for <x@y>) not allowed', 'linux'), 'gitIdentity')
    assert.equal(gitHint('fatal: no email was given and auto-detection is disabled', 'darwin'), 'gitIdentity')
    const h = hintLine('gitIdentity', { repo: 'shop', remote: 'origin' })
    assert.deepEqual([h.c, h.v], ['gitIdentity', { repo: 'shop' }])
    assert.match(h.s, /git config --global user\.name/)
    assert.equal(hintTerminal('gitIdentity', WIN_TEXT), null)
  })

  test('a real Commit stage without an identity: the stage error says what git said without who, the log carries gitIdentity', async () => {
    const r = makeRepo()
    const cfg = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const repo = loadConfig(cfg).config.repos[0]!
    const state = new WorkerState(cfg)
    const wt = await ensureWorktree(repo, state, { id: 'who1abcd', title: 'Who' }, null)
    writeFileSync(join(wt.dir, 'change.txt'), 'x\n')
    // no identity anywhere, and git may not guess one
    const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'GIT_CONFIG_GLOBAL']
    const had = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    const global = join(tempDir('noident'), 'gitconfig')
    writeFileSync(global, '[user]\n\tuseConfigOnly = true\n')
    for (const k of keys) delete process.env[k]
    process.env.GIT_CONFIG_GLOBAL = global
    try {
      const lines: LogLine[] = []
      const out = await runStage({ repo, state, task: task({ kind: 'git', gitAction: 'commit' }, { id: 'who1abcd', branch: wt.branch }), team: false, caps: { found: true, version: '1', budget: true, modes: [], settingSources: true }, bin: 'x', taskMcp: null, signal: new AbortController().signal, log: (l) => lines.push(l), git: () => {}, question: () => null })
      assert.equal(out.status, 'failed', JSON.stringify(out))
      assert.ok(lines.some((l) => l.c === 'gitIdentity' && l.v?.repo === 'demo'), JSON.stringify(lines.map((l) => l.c ?? l.s)))
      assert.ok(!/@|\(got '[^…]/.test(out.error!.replace('you@example.com', '')), out.error)
    } finally {
      for (const [k, v] of Object.entries(had)) if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
})

describe('Fix2: a leftover is removed only while it is still this repo\'s failed checkout (shared worktreeDir)', () => {
  test('repo B\'s worktree where repo A once left a folder: never swept, never freed — A\'s entry is forgotten, B\'s work stays', async () => {
    const a = makeRepo()
    const b = makeRepo()
    const shared = tempDir('w')
    const cfg = writeConfig(a, { workspace: WS_LOCAL.id, repos: [repoEntry(a, { name: 'a', worktreeDir: shared }), repoEntry(b, { name: 'b', worktreeDir: shared })] })
    const { config } = loadConfig(cfg)
    const [ra, rb] = config.repos as [RepoConfig, RepoConfig]
    sh(a.path, 'branch', 'develop', 'main')
    sh(b.path, 'branch', 'develop', 'main')
    sh(b.path, 'push', '--quiet', 'origin', 'develop')
    const state = new WorkerState(cfg)
    // (1) A's checkout of develop failed and left C:\w\develop (here: <shared>/develop), held
    const dir = join(shared, 'develop')
    mkdirSync(dir)
    const id = folderId(dir)!
    state.addLeftover('a', { dir, branch: 'develop', tip: null, at: 1, id })
    // (2) the person deletes it; B's task takes the folder for its own develop and works there
    rmSync(dir, { recursive: true })
    const wt = await ensureWorktree(rb, state, { id: 'bdev1abc', title: 'B on develop' }, 'develop')
    assert.equal(wt.dir, dir)
    writeFileSync(join(dir, 'WORK.txt'), 'uncommitted\n')
    // recording B's worktree forgot A's leftover there
    assert.deepEqual(state.leftovers('a'), [])
    // an older state file still holding A's entry (no folder id) — and no record of B's task: the .git link says B's
    const old = new WorkerState(join(tempDir('cfg2'), 'worker.json'))
    old.addLeftover('a', { dir, branch: 'develop', tip: null, at: 1 })
    assert.equal(await stillOurs(ra, old, { dir }), false)
    assert.deepEqual(await sweepLeftovers(ra, old), [])
    assert.ok(existsSync(join(dir, 'WORK.txt')), 'B\'s uncommitted work stays')
    assert.deepEqual(old.leftovers('a'), [], 'the entry is forgotten')
    // freeFolder too: A needs that folder for its own develop — refused, the folder stays
    old.addLeftover('a', { dir, branch: 'develop', tip: null, at: 1 })
    await assert.rejects(ensureWorktree(ra, old, { id: 'adev1abc', title: 'A on develop' }, 'develop'), /already exists and is not a worktree of this repo/)
    assert.ok(existsSync(join(dir, 'WORK.txt')))
    // a folder made anew where the leftover was (another folder id): not the leftover either
    const other = join(shared, 'gone-1')
    mkdirSync(other)
    const firstId = folderId(other)!
    rmSync(other, { recursive: true })
    mkdirSync(other)
    writeFileSync(join(other, 'mine.txt'), 'x\n')
    if (folderId(other) !== firstId) {
      old.addLeftover('a', { dir: other, branch: 'gone-1', tip: null, at: 1, id: firstId })
      assert.deepEqual(await sweepLeftovers(ra, old), [])
      assert.ok(existsSync(join(other, 'mine.txt')))
    }
    // A's own failed checkout (its .git links into A's worktrees, or no .git at all): still removed
    const own = join(shared, 'own-1')
    mkdirSync(own)
    writeFileSync(join(own, '.git'), `gitdir: ${join(a.path, '.git', 'worktrees', 'own-1')}\n`)
    old.addLeftover('a', { dir: own, branch: 'own-1', tip: null, at: 1, id: folderId(own)! })
    assert.deepEqual(await sweepLeftovers(ra, old), [own])
    assert.equal(existsSync(own), false)
  })
})

describe('Fix2: the scrubber — encoded POSIX roots only for two names and more, whole names; Windows-1252 / OEM forms; every base also as the disk resolves it', () => {
  test('POSIX: "%2Ftmp" / "\\/tmp" inside another name stay (me%2Ftmp, feature%2Ftmp); two-name paths in every form; Max%20Muster is not Max', () => {
    const sc = new Scrubber([], { platform: 'linux', home: '/home/max', tmp: '/tmp', realpath: () => null })
    for (const [text, want] of [
      ['https://gitlab.com/api/v4/projects/me%2Ftmp/merge_requests', 'https://gitlab.com/api/v4/projects/me%2Ftmp/merge_requests'],
      ['feature%2Ftmp', 'feature%2Ftmp'],
      ['a regex /^\\/tmp\\// in a diff', 'a regex /^\\<tmp>\\// in a diff'],
      ['/tmp/x', '<tmp>/x'],
      ['file:///home/max/a', 'file://~/a'],
      ['file%3A%2F%2F%2Fhome%2Fmax%2Fa', 'file%3A%2F%2F~%2Fa'],
      ['me%2Fhome%2Fmax', 'me%2Fhome%2Fmax'],
      ['{"p":"\\/home\\/max\\/x","q":"\\n\\/home\\/max"}', '{"p":"~\\/x","q":"\\n~"}'],
      ['/home/max%20Muster/x', '/home/max%20Muster/x'],
      ['/home/max%C3%A9/x', '/home/max%C3%A9/x'],
      ['/home/max/x and /home/max', '~/x and ~'],
      // a root starts where no name goes on before it: /var/tmp is not /tmp, ./tmp and ~/tmp are other folders
      ['/var/tmp/x', '/var/tmp/x'],
      ['./tmp/x and ~/tmp/x', './tmp/x and ~/tmp/x'],
      ['"\n/home/max/x" (/home/max) file:///tmp/a', '"\n~/x" (~) file://<tmp>/a'],
    ] as const)
      assert.equal(sc.text(text), want, text)
  })

  test('Windows: a home with letters outside ASCII as Windows-1252 and the console\'s code pages 437 / 850 wrote it', () => {
    const at = (home: string) => new Scrubber([], { platform: 'win32', home, tmp: 'C:\\T', env: {}, realpath: () => null })
    const weiss = at('C:\\Users\\Jörg Weiß')
    for (const t of ['C:\\Users\\Jörg Weiß\\shop', 'C:\\Users\\JÃ¶rg WeiÃŸ\\shop', 'C:\\Users\\J├╢rg Wei├ƒ\\shop', 'C:\\Users\\JÃ¶rg WeiÃ\u009f\\shop', 'C:\\Users\\J\u00c3\u00b6rg Wei\u00c3\u009f\\shop']) assert.equal(weiss.text(t), '~\\shop', t)
    const oezil = at('C:\\Users\\Özil')
    for (const t of ['C:\\Users\\Ã–zil\\x', 'C:\\Users\\├ûzil\\x', 'C:\\Users\\Ã\u0096zil\\x']) assert.equal(oezil.text(t), '~\\x', t)
    const uenal = at('C:\\Users\\Ünal')
    assert.equal(uenal.text('C:\\Users\\Ãœnal\\x'), '~\\x')
    // another user's folder stays
    assert.equal(weiss.text('C:\\Users\\Jörg Weißer\\x'), 'C:\\Users\\Jörg Weißer\\x')
  })

  test('every base also as the disk resolves it — a temp folder and a home behind a link (macOS /var → /private/var)', () => {
    const real = tempDir('realtmp')
    const linkTo = (target: string, name: string) => {
      const l = join(tempDir('links'), name)
      symlinkSync(target, l, IS_WIN ? 'junction' : undefined)
      return l
    }
    const tmp = linkTo(real, 'T')
    const realHome = tempDir('realhome')
    const home = linkTo(realHome, 'me')
    const sc = new Scrubber([], { tmp, home })
    assert.equal(sc.text(join(real, 'one-x', 'a.zip')), join('<tmp>', 'one-x', 'a.zip'))
    assert.equal(sc.text(join(tmp, 'one-x', 'a.zip')), join('<tmp>', 'one-x', 'a.zip'))
    assert.equal(sc.text(join(realHome, 'code', 'shop')), join('~', 'code', 'shop'))
  })
})

describe('Fix2: CI — a ZIP\'s own paths with "/", the import\'s progress and scrubber, Claude Code\'s path kept absolute', () => {
  test('zipPath: what the refusal names is the ZIP\'s own path — "/" on every OS', () => {
    assert.equal(zipPath('C:\\x\\shop', 'C:\\x\\shop\\vendor\\.git', win32), 'vendor/.git')
    assert.equal(zipPath('/x/shop', '/x/shop/vendor/.GIT', posix), 'vendor/.GIT')
    assert.equal(zipPath('/x/shop', '/x/shop', posix), '.')
  })

  test('an import of 3,000 small files: progress at most every 200 ms (not once per file), one scrubber for every event', async () => {
    const files: Record<string, Uint8Array> = { 'ledger/package.json': strToU8('{}') }
    for (let i = 0; i < 3000; i++) files[`ledger/src/m${i}.js`] = strToU8(`export const v${i} = ${i}\n`)
    const zip = join(tempDir('zip'), 'ledger.zip')
    writeFileSync(zip, Buffer.from(zipSync(files, { level: 0 })))
    let events = 0
    const started = Date.now()
    const r = await importZip(zip, tempDir('repos'), 'ledger', 'ledger.zip', () => events++)
    const ms = Date.now() - started
    assert.equal(r.files, 3001)
    assert.ok(events <= Math.ceil(ms / 200) + 2, `${events} progress events in ${ms} ms`)
    assert.ok(r.times.unpack >= 0 && r.times.guard >= 0 && r.times.commit >= 0)
    const w = new Worker({ config: { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), cloneDir: tempDir('clones') }, version: 'test', bin: 'claude', self: 'x', log: () => {} })
    const st = { state: 'running' as const, source: 'zip' as const, label: 'ledger.zip', line: '1 files · 0.0 MB', percent: 60 }
    w.intakeScrub(st)
    const first = (w as unknown as { intakeScrubber: unknown }).intakeScrubber
    assert.ok(first, 'the scrubber is kept')
    w.intakeScrub(st)
    assert.equal((w as unknown as { intakeScrubber: unknown }).intakeScrubber, first, 'built once, not per event')
  })
})

/* ------------------------------------------------------------------ Fix3 */

describe('Fix3: the scrubber after a letter, cut lines, the planted-program text, nothing read on macOS / Linux, MCP servers of plugins and the organisation', () => {
  const HOME = '/home/maximilian.mustermann'
  const fragment = (t: string) => /maximilian|mustermann|ilian\.|\.musterm|stermann/.exec(t)?.[0] ?? null

  test('N1 — macOS / Linux: a two-name path right after a letter is replaced again (-I, -L, -isystem, -F, vscode://file, file://host); one-name and encoded / JSON-escaped roots still only where no name goes on', () => {
    const sc = new Scrubber([], { platform: 'linux', home: '/home/max', tmp: '/tmp', realpath: () => null })
    for (const [text, want] of [
      ['g++ -I/home/max/inc -L/home/max/lib -isystem/home/max/sdk -o a.o', 'g++ -I~/inc -L~/lib -isystem~/sdk -o a.o'],
      ['vscode://file/home/max/a.ts:3', 'vscode://file~/a.ts:3'],
      ['file://devbox/home/max/a.ts', 'file://devbox~/a.ts'],
      ['cc -I/tmp/build/include', 'cc -I/tmp/build/include'],
      // unchanged from round 2
      ['/var/tmp/x', '/var/tmp/x'],
      ['./tmp/x and ~/tmp/x', './tmp/x and ~/tmp/x'],
      ['me%2Fhome%2Fmax', 'me%2Fhome%2Fmax'],
      ['https://gitlab.com/api/v4/projects/me%2Ftmp/merge_requests', 'https://gitlab.com/api/v4/projects/me%2Ftmp/merge_requests'],
      ['file%3A%2F%2F%2Fhome%2Fmax%2Fa', 'file%3A%2F%2F~%2Fa'],
      ['{"p":"\\/home\\/max\\/x","q":"\\n\\/home\\/max"}', '{"p":"~\\/x","q":"\\n~"}'],
      ['/home/max2/x and /home/max%20Muster/x', '/home/max2/x and /home/max%20Muster/x'],
    ] as const)
      assert.equal(sc.text(text), want, text)
    const mac = new Scrubber([], { platform: 'darwin', home: '/Users/max', tmp: '/var/folders/zz/abc/T', realpath: (p) => (p.startsWith('/var/') ? `/private${p}` : null) })
    assert.equal(mac.text('cc -I/Users/max/include -F/Users/max/Frameworks'), 'cc -I~/include -F~/Frameworks')
    assert.equal(mac.text('at /private/var/folders/zz/abc/T/case19/x.js and /var/folders/zz/abc/T/case19'), 'at <tmp>/case19/x.js and <tmp>/case19')
    const long = new Scrubber([], { platform: 'linux', home: HOME, tmp: '/tmp', realpath: () => null })
    assert.equal(fragment(long.text(`g++ -I${HOME}/.cache/node-gyp/22.12.0/include/node -L${HOME}/lib`)), null)
  })

  test('N3 — Claude Code\'s stderr tail: the line its cut went through is dropped, all of it when no line break follows (a path is never sent in halves)', async () => {
    const run = async (text: string) => {
      const dir = tempDir('fakecli')
      fakeBin(dir, 'fakecli', `process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write(${JSON.stringify(text)}); process.exit(3) })`)
      const res = await runClaude({
        bin: join(dir, IS_WIN ? 'fakecli.cmd' : 'fakecli'), cwd: dir, prompt: 'x', mode: 'plan', maxTurns: 1, model: null, allowedTools: [], disallowedTools: [], mcpConfig: null, strictMcp: true, projectSettings: false, budgetUsd: null,
        caps: { found: true, version: '9.9.9', budget: true, modes: [], settingSources: true }, env: process.env, signal: new AbortController().signal, onLog: () => {},
        scrub: (s) => s.replaceAll(HOME, '~'),
      })
      return res.error ?? ''
    }
    // one line, past the 8,000 characters kept, its cut inside the home folder's name
    const head = `Error: cannot read ${HOME}/shop/config.json `
    const at = head.indexOf(HOME) + 10
    const oneLine = `${head}${'x'.repeat(8000 + at - head.length - 4)} end`
    assert.equal(oneLine.length - 8000, at)
    const a = await run(oneLine)
    assert.equal(fragment(a), null, a)
    assert.equal(a, 'Claude Code exited with code 3')
    // a break after the cut line: the tail starts after it
    const b = await run(`${oneLine}\nsecond line at ${HOME}/shop/x.js`)
    assert.equal(fragment(b), null, b)
    assert.match(b, /^Claude Code exited with code 3: second line at ~\/shop\/x\.js$/)
  })

  test('N4 — a line far over 4,000 characters ending in a bare "\\r" at a piece\'s end: the next line is kept (live and in the tail)', () => {
    for (const pieces of [
      ['A'.repeat(5000) + '\r', 'FAILED test/login.test.js\n'],
      ['A'.repeat(5000), 'AAA\r', 'FAILED test/login.test.js\n'],
      ['A'.repeat(5000), 'AAA\r', '\nFAILED test/login.test.js\n'],
      ['A'.repeat(5000) + '\r', '\nFAILED test/login.test.js\n'],
    ]) {
      const live: string[] = []
      const o = new OutputLines((s) => s, (l) => live.push(l))
      for (const p of pieces) o.add('out', p)
      o.flush()
      assert.equal(live.at(-1), 'FAILED test/login.test.js', JSON.stringify(live.map((l) => l.slice(0, 30))))
      assert.equal(live.filter((l) => !l.startsWith('A')).length, 1, 'no empty line, no second FAILED')
      assert.match(o.output(), /\nFAILED test\/login\.test\.js$/)
    }
  })

  test('N6 — the planted-program error says what the app says: commit and push on the base branch, then Update from base — no Discard', () => {
    const e = plantedError('git.exe')
    assert.match(e, /an existing worktree keeps it: delete it there, or commit and push the change on the base branch and press Update from base\), then press Retry\.$/)
    assert.doesNotMatch(e, /Discard/)
  })

  test('N7 — macOS / Linux: a Claude Code stage reads nothing for the planted-program check (no ~/.claude.json, no plugin or organisation file)', async () => {
    const r = makeRepo()
    const cfg = writeConfig(r, { workspace: WS_LOCAL.id, repos: [repoEntry(r)] })
    const repo = loadConfig(cfg).config.repos[0]!
    const state = new WorkerState(cfg)
    const home = tempDir('home')
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { kb: { command: 'kb' } } }))
    const caps = { found: true, version: '9.9.9', budget: true, modes: [], settingSources: true }
    const read = async (platform: NodeJS.Platform) => {
      const paths: string[] = []
      const orig = fs.readFileSync
      const had = process.env.CLAUDE_CONFIG_DIR
      delete process.env.CLAUDE_CONFIG_DIR
      fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        paths.push(String(p))
        return (orig as (...a: unknown[]) => unknown)(p, ...rest)
      }) as typeof fs.readFileSync
      syncBuiltinESMExports()
      try {
        await runStage({ repo, state, task: task({ kind: 'plan' }, { id: `noread${platform.slice(0, 3)}` }), team: false, caps, bin: join(tempDir('noclaude'), 'claude'), taskMcp: null, signal: new AbortController().signal, log: () => {}, git: () => {}, question: () => null, platform, home })
      } finally {
        fs.readFileSync = orig
        syncBuiltinESMExports()
        if (had !== undefined) process.env.CLAUDE_CONFIG_DIR = had
      }
      return paths.filter((p) => /\.claude\.json$|installed_plugins\.json$|managed-mcp\.json$|managed-settings\.json$/.test(p))
    }
    // Windows' rules: the person's config is read (the check can see this way)
    assert.ok((await read('win32')).some((p) => p.endsWith('.claude.json')))
    assert.deepEqual(await read('linux'), [])
    assert.deepEqual(await read('darwin'), [])
  })

  // a home folder (never made: git only names it) whose name starts `col` characters into git's line, so the old cut
  // (200 for a progress line, 300 for a fetch's reason) went through it — padding folders of ≤ 200 characters
  const homeAt = (root: string, col: number, lead: number) => {
    const parts: string[] = []
    let left = col - lead - root.length - 1
    while (left > 201) {
      parts.push('p'.repeat(200))
      left -= 201
    }
    assert.ok(left >= 2, `${left}`)
    parts.push('p'.repeat(left - 1))
    const home = join(root, ...parts, 'maximilian.mustermann')
    assert.equal(lead + home.indexOf('maximilian'), col)
    return home
  }
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

  test('N8 — a clone\'s progress line: whole from clone.ts, scrubbed before the worker cuts it for One (never a path in halves)', async () => {
    const root = tempDir('n8')
    // git names the missing local repository in its last line
    const cloneHome = homeAt(root, 187, "fatal: repository '".length)
    const target = parseCloneUrl(join(cloneHome, 'nope.git'), true)
    assert.ok(!('error' in target), JSON.stringify(target))
    const lines: string[] = []
    await assert.rejects(cloneInto(target, tempDir('clones'), (p) => lines.push(p.line), { local: true }))
    const last = lines.at(-1) ?? ''
    // what One gets: the worker's intake scrubber, then the cut (worker.ts intakeScrub)
    const shown = clip(new Scrubber([], { home: cloneHome }).text(last), 200)
    assert.equal(fragment(shown), null, shown)
    assert.match(last, /nope\.git/, JSON.stringify(lines))
    const w = new Worker({ config: { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), cloneDir: tempDir('clones2') }, version: 'test', bin: 'claude', self: 'x', log: () => {} })
    const st = w.intakeScrub({ state: 'running', source: 'clone', label: 'x', line: `${'y'.repeat(190)} ${join(homedir(), 'one-repos', 'shop')} and more`, percent: null })
    assert.ok(st.line.length <= 200, `${st.line.length}`)
    assert.equal(st.line.includes(homedir()), false)
  })

  test('N8 — a failed fetch\'s reason: scrubbed before tryFetch cuts it (never a path in halves)', async () => {
    const root = tempDir('n8f')
    // a remote that is a missing folder — git's reason names it
    const fetchHome = homeAt(root, 290, "fatal: '".length)
    const dir = plainRepo(join(root, 'repo'), { 'README.md': 'x\n' }, join(fetchHome, 'gone.git'))
    const notes: Array<Record<string, string | number> | undefined> = []
    const scrub = new Scrubber([], { home: fetchHome })
    await tryFetch({ path: dir, remote: 'origin' } as unknown as RepoConfig, (_k, _s, c, v) => c === 'fetchFailed' && notes.push(v), (s) => scrub.text(s))
    const why = String(notes[0]?.why ?? '')
    // run.ts's log scrubs every value once more: nothing of the name may be left in halves
    assert.equal(fragment(scrub.text(why)), null, why)
    assert.match(why, /gone\.git|repository/, why)
    assert.ok(why.length <= 300)
  })

  test('N9 — mcpLaunchers: the organisation\'s (managed-mcp.json, managedMcpServers, managed-settings.d) and every installed plugin\'s servers — a plugin\'s by name only', () => {
    const home = tempDir('home')
    const cfgDir = join(home, '.claude')
    const managed = tempDir('managed')
    writeFileSync(join(managed, 'managed-mcp.json'), JSON.stringify({ mcpServers: { org: { command: 'org-tool', args: [] }, remote: { type: 'http', url: 'https://x.invalid/mcp' } } }))
    writeFileSync(join(managed, 'managed-settings.json'), JSON.stringify({ managedMcpServers: { pinned: { type: 'stdio', command: 'C:\\tools\\pinned.exe' } } }))
    mkdirSync(join(managed, 'managed-settings.d'))
    writeFileSync(join(managed, 'managed-settings.d', '10-team.json'), JSON.stringify({ managedMcpServers: { drop: { command: 'drop-in' } } }))
    // two installed plugins: one with .mcp.json (bare map), one declaring its servers in plugin.json (object + a file)
    const p1 = join(cfgDir, 'plugins', 'cache', 'mk', 'kb', '1.0.0')
    const p2 = join(cfgDir, 'plugins', 'cache', 'mk', 'db', '2.0.0')
    mkdirSync(join(p1), { recursive: true })
    mkdirSync(join(p2, '.claude-plugin'), { recursive: true })
    writeFileSync(join(p1, '.mcp.json'), JSON.stringify({ kb: { command: 'plugin-kb', args: ['serve'] }, own: { command: '${CLAUDE_PLUGIN_ROOT}/server.js' }, rel: { command: './bin/main' } }))
    writeFileSync(join(p2, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'db', mcpServers: ['./servers.json'] }))
    writeFileSync(join(p2, 'servers.json'), JSON.stringify({ mcpServers: { db: { command: 'plugin-db' }, win: { command: '%APPDATA%\\x\\index.cmd' } } }))
    writeFileSync(join(cfgDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kb@mk': [{ scope: 'user', installPath: p1, version: '1.0.0' }], 'db@mk': [{ scope: 'project', projectPath: home, installPath: p2 }], 'bad@mk': [{ installPath: 'relative/path' }] } }))
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'uvx' } } }))
    const names = mcpLaunchers({ dirs: [tempDir('wt')], projectSettings: false, home, env: {}, managed: [managed] })
    assert.deepEqual(names, ['drop-in', 'org-tool', 'pinned', 'plugin-db', 'plugin-kb', 'uvx'])
    // $CLAUDE_CODE_PLUGIN_CACHE_DIR: the plugins folder named by the person
    const cache = tempDir('cache')
    const p3 = join(cache, 'p3')
    mkdirSync(p3)
    writeFileSync(join(p3, '.mcp.json'), JSON.stringify({ mcpServers: { c: { command: 'cached-tool' } } }))
    writeFileSync(join(cache, 'installed_plugins.json'), JSON.stringify({ plugins: { 'c@m': { installPath: p3 } } }))
    assert.deepEqual(mcpLaunchers({ dirs: [], projectSettings: false, home, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache }, managed: [] }), ['cached-tool', 'uvx'])
    // a plugin folder named in $CLAUDE_CODE_PLUGIN_DIRS (Claude Code loads it like --plugin-dir)
    const inline = tempDir('inline')
    writeFileSync(join(inline, '.mcp.json'), JSON.stringify({ mcpServers: { i: { command: 'inline-tool' } } }))
    assert.deepEqual(mcpLaunchers({ dirs: [], projectSettings: false, home, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache, CLAUDE_CODE_PLUGIN_DIRS: inline }, managed: [] }), ['cached-tool', 'inline-tool', 'uvx'])
    // nothing there: none (and a broken file adds none)
    writeFileSync(join(managed, 'managed-mcp.json'), '{ broken')
    assert.deepEqual(mcpLaunchers({ dirs: [], projectSettings: false, home: tempDir('none'), env: {}, managed: [managed, tempDir('empty')] }), ['drop-in', 'pinned'])
  })
})

/* ------------------------------------------------------------------ Fix4 */

describe('Fix4: an import\'s failure is scrubbed before it is cut; plugins of a seed folder', () => {
  const fragment = (t: string) => /maximilian|mustermann|ilian\.|\.musterm|stermann/.exec(t)?.[0] ?? null
  const worker = (cloneDir: string) => new Worker({ config: { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), cloneDir }, version: 'test', bin: 'claude', self: 'x', log: () => {} })

  test('cloneHint keeps git\'s last lines whole; the worker scrubs a failure, then cuts it for One (INTAKE_ERROR_MAX)', () => {
    const home = '/home/maximilian.mustermann'
    const sc = new Scrubber([], { platform: 'linux', home, tmp: '/tmp', realpath: () => null })
    // a failure no hint knows; its last line names a folder under the home across column 300 (the old cut)
    const at = `${home}/one-repos/shop/.git/index.lock`
    const err = cloneHint(`remote: ${'warning: '.repeat(25)}\nfatal: unable to write new index file in '${at}'\n`)
    assert.ok(err.indexOf('maximilian') < 300 && err.indexOf('maximilian') + 'maximilian.mustermann'.length > 300, err)
    assert.ok(err.endsWith(`'${at}'`), err)
    assert.equal(fragment(sc.text(err)), null, sc.text(err))
    // the worker: scrubbed first, then cut
    const raw = `${'y'.repeat(INTAKE_ERROR_MAX - 30)} ${join(homedir(), 'one-repos', 'shop')} ${'z'.repeat(100)}`
    const st = worker(tempDir('clones')).intakeScrub({ state: 'failed', source: 'clone', label: 'x', line: '', percent: null, error: raw })
    assert.ok(st.error!.length <= INTAKE_ERROR_MAX && st.error!.endsWith('…'), `${st.error!.length}`)
    assert.match(st.error!, /~[\\/]one-repos[\\/]shop z/)
  })

  test('an import\'s failure leaves intake.ts whole — the clone folder\'s path never cut before the scrubber (a home-like name across column 600)', async () => {
    const root = tempDir('fix4')
    // the clone folder lies below a FILE: mkdir fails at once and Node's message names the whole folder
    const file = join(root, 'f')
    writeFileSync(file, 'x\n')
    let lead = -1
    try {
      mkdirSync(join(file, 'probe'), { recursive: true })
    } catch (e) {
      lead = (e as Error).message.indexOf(join(file, 'probe'))
    }
    assert.ok(lead > 0, `${lead}`)
    // padding folders of ≤ 200 characters put the name at column 595
    const parts: string[] = []
    let left = 595 - lead - file.length - 1
    while (left > 201) {
      parts.push('p'.repeat(200))
      left -= 201
    }
    assert.ok(left >= 2, `${left}`)
    parts.push('p'.repeat(left - 1))
    const clones = join(file, ...parts, 'maximilian.mustermann', 'one-repos')
    const config = { ...emptyConfig(join(tempDir('cfg'), 'worker.json')), cloneDir: clones }
    const events: IntakeState[] = []
    const intake = new Intake({ config: () => config, configFile: config.file, reload: async () => {}, log: () => {}, event: (_t, st) => events.push(st) })
    // no git starts: the folder is refused first (an address nobody can reach anyway)
    intake.clone('fix4', 'https://git.example.invalid/acme/shop.git')
    await waitFor(() => events.some((e) => e.state === 'failed'), 5000, () => JSON.stringify(events))
    const failed = events.find((e) => e.state === 'failed')!
    assert.equal(failed.error!.indexOf('maximilian'), 595, failed.error)
    assert.ok(failed.error!.includes(clones), 'whole, as Node wrote it')
    const sent = worker(clones).intakeScrub(failed)
    assert.equal(fragment(sent.error!), null, sent.error)
    assert.match(sent.error!, /<clones>/, sent.error)
  })

  test('mcpLaunchers reads the installed plugins of each $CLAUDE_CODE_PLUGIN_SEED_DIR folder', () => {
    const seed = tempDir('seed')
    const p = join(seed, 'cache', 'mk', 'seeded', '1.0.0')
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'seeded-tool' } } }))
    writeFileSync(join(seed, 'installed_plugins.json'), JSON.stringify({ plugins: { 'seeded@mk': [{ installPath: p }] } }))
    assert.deepEqual(mcpLaunchers({ dirs: [], projectSettings: false, home: tempDir('none'), env: { CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, managed: [] }), ['seeded-tool'])
  })
})
