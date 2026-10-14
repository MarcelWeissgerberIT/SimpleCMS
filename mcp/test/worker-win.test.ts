/**
 * Worker 1.9.0 on Windows — git, paths and setup, each Windows rule run with an injected platform (and file system
 * where it reads one), so the whole file runs on every OS: git's arguments (long paths) and environment (ssh in
 * BatchMode only while the person set nothing), the hints for git's errors, worktree folder names, synced folders,
 * the scrubber's Windows forms, argument lines, ZIP names Windows refuses, renames that wait out a held file, the clone
 * folder, the usual places. Then a real worker: a missing Claude Code and a missing test command are named by code,
 * and no path of this computer reaches the tab.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { cloneBase, unquote } from '../src/worker/clone.ts'
import { splitArgs } from '../src/worker/config.ts'
import { ownLocks, worktreeFolder } from '../src/worker/git.ts'
import { BATCH_SSH, forgetGitEnv, gitArgs, gitEnv, gitHint, hintLine, hintTerminal } from '../src/worker/gitenv.ts'
import { inSyncedFolder, renameRetry } from '../src/worker/paths.ts'
import { guessAnalyzeAsync, guessTest, shortPath, usualPlaces } from '../src/worker/scan.ts'
import { Scrubber, repoScrubber } from '../src/worker/scrub.ts'
import { joinArgs } from '../src/worker/setup.ts'
import { WorkerState } from '../src/worker/state.ts'
import { entryPath, isUnsafe } from '../src/worker/zipimport.ts'
import { FakeTab, GIT_ENV, WS_LOCAL, cleanupAll, makeRepo, plainRepo, repoEntry, sh, spawnWorker, task, tempDir, writeConfig, WORKER_BUNDLE, type SpawnedWorker } from './worker-helpers.ts'

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

  test('gitEnv: ssh in BatchMode only while nothing of the person\'s is set (variables in any case, GIT_SSH, core.sshCommand)', async () => {
    const repo = plainRepo(join(tempDir('gitenv'), 'repo'))
    forgetGitEnv()
    const plain = await gitEnv(repo, base())
    assert.equal(plain.GIT_SSH_COMMAND, BATCH_SSH)
    assert.equal(plain.GIT_TERMINAL_PROMPT, '0')
    assert.equal(plain.GCM_INTERACTIVE, 'never')
    // the specs' `false` (nothing leaves the machine) wins
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base({ GIT_SSH_COMMAND: 'false' }))).GIT_SSH_COMMAND, 'false')
    forgetGitEnv()
    const viaSsh = await gitEnv(repo, base({ GIT_SSH: 'C:\\tools\\plink.exe' }))
    assert.equal(viaSsh.GIT_SSH_COMMAND, undefined)
    // Windows keys have no case: "git_ssh_command" is the person's GIT_SSH_COMMAND
    forgetGitEnv()
    const lower = await gitEnv(repo, base({ git_ssh_command: 'ssh -i key' }), { platform: 'win32' })
    assert.equal(lower.GIT_SSH_COMMAND, undefined)
    assert.equal(lower.git_ssh_command, 'ssh -i key')
    // a real core.sshCommand in the global config (a plain `ssh` opts out too)
    const global = join(tempDir('gitcfg'), 'config')
    writeFileSync(global, '[core]\n\tsshCommand = ssh\n')
    forgetGitEnv()
    assert.equal((await gitEnv(repo, base({ GIT_CONFIG_GLOBAL: global }))).GIT_SSH_COMMAND, undefined)
    // … and in the repository's own config
    const local = plainRepo(join(tempDir('gitenv'), 'repo2'))
    sh(local, 'config', 'core.sshCommand', 'ssh -o IdentitiesOnly=yes')
    forgetGitEnv()
    assert.equal((await gitEnv(local, base())).GIT_SSH_COMMAND, undefined)
    // a clone (no repository yet): the global config decides
    forgetGitEnv()
    assert.equal((await gitEnv(null, base({ GIT_CONFIG_GLOBAL: global }))).GIT_SSH_COMMAND, undefined)
    forgetGitEnv()
    assert.equal((await gitEnv(null, base())).GIT_SSH_COMMAND, BATCH_SSH)
    // a folder git cannot read: nothing added, the person's setup stays
    forgetGitEnv()
    assert.equal((await gitEnv(join(tempDir('gone'), 'no-such-folder'), base())).GIT_SSH_COMMAND, undefined)
    forgetGitEnv()
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
