/**
 * one-worker: new repositories from the local setup page — clone addresses checked (no tokens in https
 * addresses, no ext:: / option-like ones), a clone from a local bare remote (test seam ONE_WORKER_CLONE_LOCAL),
 * the person's GitLab / GitHub projects from fake glab / gh tools, a ZIP of source code unpacked into a fresh
 * repository (its own .git folders in every spelling a file system folds to ".git", __MACOSX and .DS_Store left out;
 * a path outside the folder, ":", a control character or a Windows device name refuses the ZIP; the git steps run
 * with fsmonitor off, no hooks, no filter driver (the person's global ones too) and no automatic gc even when a .git
 * was planted; a ZIP that is a repository itself is refused), the clone folder and own MCP servers written by Save,
 * GitLab merge requests with glab. Nothing leaves the machine.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import type { WorkerMessage, WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { cloneBase, cloneHint, cloneInto, folderName, parseCloneUrl } from '../src/worker/clone.ts'
import { NO_DRIVERS, commitImport, entryPath, finishImport, gitDirIn, importZip, isDotGit, isUnsafe } from '../src/worker/zipimport.ts'
import { branchDiff, commitAll, ensureWorktree, info, isDirty, openPr, updateFromBase } from '../src/worker/git.ts'
import { SOURCE_MARK, loadConfig, sanitizeConfig, type RepoConfig } from '../src/worker/config.ts'
import { repoFacts } from '../src/worker/scan.ts'
import { WorkerState } from '../src/worker/state.ts'
import { buildPrompt } from '../src/worker/run.ts'
import { checkPublish, slugName, suggestName } from '../src/worker/publish.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, GIT_ENV, IS_WIN, cleanupAll, fakeBin, makeRepo, pathWith, plainRepo, presetBundle, sh, slashPath, spawnWorker, task, tempDir, type SpawnedWorker } from './worker-helpers.ts'

/** Is git-lfs installed here? (the LFS test runs only then) */
function hasGitLfs(): boolean {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const PORT = 47387
const SELF = `http://127.0.0.1:${PORT}`
const ORIGIN = 'http://127.0.0.1:5350'
const PAIR = 'pAiRsEcReT_0123456789-abcdefghijklmnopqrstu'
const WS: WorkspaceRef = { id: 'local:clone-ws-1', name: 'Studio', kind: 'local', readOnly: false }
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

/**
 * Fake glab and gh (JavaScript, started as this OS starts an installed CLI — fakeBin): their project lists, a project
 * made by `api -X POST` (its address = FAKE_REMOTE, the call logged to FAKE_LOG), `mr create` printing a merge request
 * address. Anything else: exit 1.
 */
function fakeTools(): string {
  const bin = tempDir('bin')
  const head = `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
const say = (s) => {
  process.stdout.write(s + '\\n')
  process.exit(0)
}
`
  const glab = `${head}
const three = [a[0], a[1], a[2]].map((x) => x ?? '').join(' ')
if (three === 'api -X POST') {
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, a.join(' ') + '\\n')
  say(JSON.stringify({ web_url: 'https://gitlab.example.com/acme/billing-core', ssh_url_to_repo: process.env.FAKE_REMOTE ?? '', http_url_to_repo: process.env.FAKE_REMOTE ?? '', args: a.join(' ') }))
}
if (three === 'api groups/acme ') say('{"id":7}')
if (three === 'config get git_protocol') say('ssh')
if (a[0] === '--version') say('glab 1.99')
if (a[0] === 'api') say('[{"path_with_namespace":"acme/legacy-billing","http_url_to_repo":"https://gitlab.example.com/acme/legacy-billing.git","ssh_url_to_repo":"git@gitlab.example.com:acme/legacy-billing.git","last_activity_at":"2026-10-01T10:00:00Z"},{"path_with_namespace":"acme/bad","http_url_to_repo":"https://user:tok@gitlab.example.com/acme/bad.git","ssh_url_to_repo":"-oProxyCommand=x","last_activity_at":"2026-10-02T10:00:00Z"}]')
if (a[0] === 'mr') {
  process.stdout.write('Creating merge request for ' + (a[2] ?? '') + ' into ' + (a[4] ?? '') + '\\n')
  say('https://gitlab.example.com/acme/demo/-/merge_requests/7')
}
process.exit(1)
`
  const gh = `${head}
if (a[0] === '--version') say('gh 9.9')
if (a[0] === 'repo') say('[{"nameWithOwner":"me/old-shop","url":"https://github.com/me/old-shop","sshUrl":"git@github.com:me/old-shop.git","updatedAt":"2026-09-20T08:00:00Z"}]')
process.exit(1)
`
  fakeBin(bin, 'glab', glab)
  fakeBin(bin, 'gh', gh)
  return bin
}

type Res = { status: number; text: string; json: () => any } // eslint-disable-line @typescript-eslint/no-explicit-any
function call(path: string, opts: { token: string; body?: unknown; raw?: Buffer; type?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const body = opts.raw ?? (opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body)))
    const req = request({ host: '127.0.0.1', port: PORT, path, method: body ? 'POST' : 'GET', headers: { host: `127.0.0.1:${PORT}`, 'x-one-setup': opts.token, ...(body ? { origin: SELF, 'content-type': opts.type ?? 'application/json' } : {}) } }, (res) => {
      let text = ''
      res.on('data', (d: Buffer) => (text += d.toString()))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

/** The page's state once the clone / import job is no longer running. */
async function jobDone(token: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 200; i++) {
    const st = (await call('/setup/api/state', { token })).json()
    if (st.clone && !st.clone.running) return st
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the job did not end')
}

describe('clone addresses', () => {
  test('https, ssh:// and git@host:path are read; tokens, ext::, file, options and ".." are refused', () => {
    const ok = (u: string) => {
      const r = parseCloneUrl(u)
      assert.ok(!('error' in r), `${u}: ${JSON.stringify(r)}`)
      return r as Exclude<ReturnType<typeof parseCloneUrl>, { error: string }>
    }
    assert.deepEqual(ok('https://gitlab.com/acme/platform/legacy-billing.git'), { url: 'https://gitlab.com/acme/platform/legacy-billing.git', host: 'gitlab.com', path: 'acme/platform/legacy-billing', name: 'legacy-billing', kind: 'https' })
    assert.equal(ok('git@gitlab.example.com:acme/billing.git').kind, 'ssh')
    assert.equal(ok('ssh://git@gitlab.example.com:2222/acme/billing.git').name, 'billing')
    assert.equal(ok('https://git.internal.example/team/app').name, 'app')
    for (const bad of ['https://user:glpat-xyz@gitlab.com/a/b.git', 'https://oauth2@gitlab.com/a/b.git', 'ext::sh -c touch% /tmp/x', 'file:///etc/passwd', '/home/me/repo', '-uhttps://x', 'http://gitlab.com/a/b.git', 'git@gitlab.com:../../etc', 'git@gitlab.com:-x/y', 'https://gitlab.com/a/../b', 'https://gitlab.com/a/b?x=1', 'git@evil host:a/b', '', 'https://gitlab.com/a b/c'])
      assert.ok('error' in parseCloneUrl(bad), bad)
    // a local path only with the test seam — on Windows with its drive
    assert.equal((parseCloneUrl('/tmp/remote.git', true) as { kind: string }).kind, 'local')
    assert.deepEqual(parseCloneUrl(String.raw`C:\Users\kim\case1\remote.git`, true, 'win32'), { url: String.raw`C:\Users\kim\case1\remote.git`, host: 'local', path: String.raw`C:\Users\kim\case1\remote.git`, name: 'remote', kind: 'local' })
    assert.ok('error' in parseCloneUrl(String.raw`C:\Users\kim\remote.git`, false, 'win32'))
    assert.ok('error' in parseCloneUrl(String.raw`C:\Users\kim\remote.git`, true, 'linux'))
    assert.ok('error' in parseCloneUrl(String.raw`C:\Users\..\remote.git`, true, 'win32'))
    assert.equal(folderName('acme/my app.git'), 'my-app')
    assert.equal(folderName('acme/.hidden'), 'hidden')
  })

  test('the clone folder: ~ and absolute paths, never iCloud Drive; git\'s refusals become a hint', () => {
    const home = '/Users/kim'
    // POSIX paths: pinned to Linux (worker-win.test.ts has Windows' — ~\, C:\…, quotes, OneDrive)
    assert.equal(cloneBase('~/one-repos', home, 'linux'), '/Users/kim/one-repos')
    assert.equal(cloneBase('/srv/repos', home, 'linux'), '/srv/repos')
    assert.ok(typeof cloneBase('one-repos', home, 'linux') !== 'string')
    assert.match((cloneBase('~/Library/Mobile Documents/com~apple~CloudDocs/repos', home, 'darwin') as { error: string }).error, /iCloud/)
    assert.match(cloneHint('git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'), /SSH key was refused/)
    assert.match(cloneHint("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled"), /credential helper/)
    assert.match(cloneHint('remote: The project you were looking for could not be found'), /does not know this project/)
  })

  test('a checkout of the same address that is already there: added, marked only in the default clone folder — never the person\'s own checkout elsewhere', async () => {
    const t = tempDir('already')
    const remote = makeRepo().remote
    const target = parseCloneUrl(remote, true)
    assert.ok(!('error' in target))
    // the person cloned it by hand into ~/code long ago
    const own = join(t, 'code', 'remote')
    execFileSync('git', ['clone', '--quiet', remote, own], { env: { ...process.env, ...GIT_ENV } })
    const mine = await cloneInto(target, join(t, 'code'), () => {}, { local: true, home: t })
    assert.deepEqual(mine, { dir: own, already: true })
    assert.ok(!existsSync(join(own, '.git', SOURCE_MARK)), 'the person\'s own checkout stays theirs')
    // in ~/one-repos: an older worker's clone without a mark
    const older = join(t, 'one-repos', 'remote')
    execFileSync('git', ['clone', '--quiet', remote, older], { env: { ...process.env, ...GIT_ENV } })
    assert.deepEqual(await cloneInto(target, join(t, 'one-repos'), () => {}, { local: true, home: t }), { dir: older, already: true })
    assert.equal(readFileSync(join(older, '.git', SOURCE_MARK), 'utf8'), 'clone\n')
  })

  test('ZIP entries: inside the folder only; .git, __MACOSX and .DS_Store left out', () => {
    assert.equal(entryPath('app/src/a.ts'), 'app/src/a.ts')
    assert.equal(entryPath('app\\src\\b.ts'), 'app/src/b.ts')
    assert.equal(entryPath('./app/c.ts'), 'app/c.ts')
    assert.equal(entryPath('app/'), null)
    assert.equal(entryPath('app/.git/config'), null)
    assert.equal(entryPath('app/vendor/lib/.git/hooks/pre-commit'), null)
    assert.equal(entryPath('__MACOSX/app/._a.ts'), null)
    assert.equal(entryPath('app/.DS_Store'), null)
    for (const bad of ['../evil.txt', 'app/../../evil', '/etc/passwd', 'C:/Windows/x', 'a\0b']) assert.ok(isUnsafe(entryPath(bad)), bad)
  })
})

describe('ZIP import: no git folder in any spelling or shape, nothing in the ZIP runs', () => {
  /**
   * A script outside every repository that leaves `<name>` in `dir` when something runs it. Its path as git config takes
   * it (slashPath: Git for Windows runs it with its own sh, which reads "\\" as an escape).
   */
  const tripwire = (dir: string, name: string) => {
    const file = join(dir, `${name}.sh`)
    writeFileSync(file, `#!/bin/sh\ntouch '${slashPath(join(dir, name))}'\nexit 0\n`)
    if (!IS_WIN) chmodSync(file, 0o755)
    return slashPath(file)
  }
  const zipFile = (files: Record<string, string>) => {
    const f = join(tempDir('zip'), 'upload.zip')
    writeFileSync(f, Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))))
    return f
  }
  /** What a commit leaves next to the repository: its temporary git folder (with the empty hooks folder) is gone. */
  const leftovers = (dir: string) => readdirSync(dirname(dir)).filter((n) => n.startsWith('.one-import'))
  /** Run with the identity of `global` (a gitconfig) only — the test env's GIT_AUTHOR_* / GIT_COMMITTER_* set aside. */
  const asPerson = async <T>(global: string, fn: () => Promise<T>): Promise<T> => {
    const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_GLOBAL']
    const saved = keys.map((k) => [k, process.env[k]] as const)
    const file = join(tempDir('gitconfig'), 'gitconfig')
    writeFileSync(file, global)
    for (const k of keys) delete process.env[k]
    process.env.GIT_CONFIG_GLOBAL = file
    try {
      return await fn()
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }
  /** Does the disk under `dir` ignore case (macOS APFS, Windows NTFS)? There ".GIT" IS ".git". */
  const foldsCase = () => {
    const probe = tempDir('case')
    mkdirSync(join(probe, 'Probe'))
    return existsSync(join(probe, 'pROBE'))
  }

  test('git\'s is_ntfs_dotgit / is_hfs_dotgit: case, trailing dots and spaces, NTFS streams, GIT~1, HFS+ ignorable code points', () => {
    for (const name of ['.git', '.GIT', '.Git', '.gIT', '.git.', '.git ', '.git. . ', '.git::$INDEX_ALLOCATION', '.git:x', 'git~1', 'GIT~1', 'Git~2', 'git~1.', '.g\u200cit', '.gi\u200dt', '\u200e.git', '.git\u200f', '.g\u202ait', '.\u202bgit', '.gi\u202ct', '.g\u202dit', '.git\u202e', '.g\u206ait', '.\u206bGIT', '.gi\u206ct', '.g\u206dit', '.g\u206eit', '.git\u206f', '\ufeff.git', '.G\u200cI\ufeffT. '])
      assert.ok(isDotGit(name), JSON.stringify(name))
    for (const name of ['.github', '.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', 'git', '.git-hooks', '.gitx', 'x.git', '..git', ' .git', 'git~', 'git~x', '.g\u200bit', '.gıt', 'ｇit'])
      assert.ok(!isDotGit(name), JSON.stringify(name))
  })

  test('entries: left out before any check (every .git variant, __MACOSX, Finder files); a path outside or a control character refuses the ZIP; ":" and device names only on Windows', () => {
    const dropped = ['p/.GIT/config', 'p/.Git/hooks/pre-commit', 'p/.git/config', '.GIT/config', 'p/GIT~1/config', 'p/git~1/hooks/post-checkout', 'p/.git./config', 'p/.git /config', 'p/.git. . /HEAD', 'p/.g\u200cit/config', 'p/\ufeff.git/config', 'p/.gi\u202et/config', 'p/.git\u206f/config', 'p/sub/deep/.GIT/config', 'p/.GIT', 'p/GIT~1', 'p/.git::$INDEX_ALLOCATION/config', 'p/.git:stream',
      // never written, so their names cannot refuse the ZIP: Finder's icon file, its picture, a branch named aux or con
      'p/Icon\r', 'p/sub/Icon\r', '__MACOSX/p/._Icon\r', '__MACOSX/p/img/._logo.png:Zone.Identifier', '__MACOSX/p/aux.c', 'p/.git/refs/heads/aux', 'p/.git/logs/refs/heads/con', 'p/.DS_Store', '__MACOSX/../evil.txt']
    for (const platform of ['linux', 'darwin', 'win32'] as const)
      for (const n of dropped) assert.equal(entryPath(n, platform), null, `${platform} ${JSON.stringify(n)}`)
    const why = (n: string, platform: NodeJS.Platform = 'linux') => {
      const r = entryPath(n, platform)
      assert.ok(isUnsafe(r), `${platform} ${JSON.stringify(n)} → ${JSON.stringify(r)}`)
      return r.unsafe
    }
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      for (const n of ['p/a\nb.txt', 'p/a\rb', 'p/Icon\rx', 'p/Icon\r/x.txt', 'p/\u001b[31mred', 'p/tab\there', 'p/del\u007f', 'a\0b']) assert.match(why(n, platform), /control character/, JSON.stringify(n))
      for (const n of ['p/.. /x', 'p/... /x', 'p/..\u200c/x', 'p/ /x', 'p/. /x', '../evil.txt', '/etc/passwd', 'C:/Windows/x', '\\\\server\\share\\x', '']) assert.match(why(n, platform), /outside its folder/, JSON.stringify(n))
    }
    // Windows: "name:stream" writes into a hidden stream, a device name opens the device
    const colon = ['p/a:b.txt', 'p/x/file.txt:Zone.Identifier', 'p/img/logo.png:Zone.Identifier']
    const devices = ['con', 'p/CON', 'p/nul', 'p/nul.txt', 'p/NUL.tar.gz', 'p/aux.c', 'p/Prn.log', 'p/com1', 'p/COM9.txt', 'p/com0', 'p/lpt1', 'p/LPT9.dat', 'p/com\u00b9', 'p/lpt\u00b3.x', 'p/con .txt', 'p/nul.', 'p/conin$', 'p/CONOUT$.txt', 'p/aux/x.c', 'p/con.go', 'p/aux.py', 'p/com1.ts', 'linux/drivers/gpu/drm/nouveau/nvkm/subdev/i2c/aux.c']
    for (const n of colon) assert.match(why(n, 'win32'), /":"/, n)
    for (const n of devices) assert.match(why(n, 'win32'), /device/, n)
    // macOS and Linux: plain names git keeps — the kernel's aux.c, a stray nul, a WSL Zone.Identifier
    for (const platform of ['linux', 'darwin'] as const) for (const n of [...colon, ...devices]) assert.equal(entryPath(n, platform), n, `${platform} ${n}`)
    const kept = ['p/.github/workflows/ci.yml', 'p/.gitignore', 'p/.gitattributes', 'p/.gitmodules', 'p/git/notes.txt', 'p/.git-blame-ignore-revs', 'p/console.log', 'p/com10.txt', 'p/lpt.txt', 'p/auxiliary.c', 'p/connect/a.ts', 'p/naïve café.md', 'p/a b/c d.txt', 'p/..foo', 'p/\u0084ber.txt', 'p/Icon', 'p/Icon.png']
    for (const platform of ['linux', 'darwin', 'win32'] as const) for (const n of kept) assert.equal(entryPath(n, platform), n, `${platform} ${JSON.stringify(n)}`)
    // a trailing dot: a plain name on macOS / Linux, dropped by Windows (worker 1.9.0 refuses it there — worker-win.test.ts)
    for (const n of ['p/foo..', 'p/x.']) {
      for (const platform of ['linux', 'darwin'] as const) assert.equal(entryPath(n, platform), n, `${platform} ${n}`)
      assert.match(why(n, 'win32'), /dot or a space/, n)
    }
    assert.equal(entryPath('p\\.GIT\\config'), null)
    assert.equal(entryPath('p\\src\\a.ts'), 'p/src/a.ts')
  })

  test('a drive letter is a drive only where it makes a path absolute: "C:/x" and "C:\\x" refuse everywhere, "a:b" is a name on macOS / Linux', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const)
      for (const n of ['C:/x.txt', 'c:\\Windows\\x', 'Z:/p/a.ts', 'C:\\']) {
        const r = entryPath(n, platform)
        assert.ok(isUnsafe(r) && /outside its folder/.test(r.unsafe), `${platform} ${JSON.stringify(n)} → ${JSON.stringify(r)}`)
      }
    // macOS / Linux: a colon is part of a name — at the start too (a:b, C:x, ab:c)
    for (const platform of ['linux', 'darwin'] as const) for (const n of ['a:b', 'C:x', 'ab:c/d.txt', 'ab:/y']) assert.equal(entryPath(n, platform), n, `${platform} ${n}`)
    // Windows: every ":" refuses — "C:x" is relative to drive C there, "a:b" a stream of "a"
    for (const n of ['a:b', 'C:x', 'ab:c/d.txt']) {
      const r = entryPath(n, 'win32')
      assert.ok(isUnsafe(r) && /":"/.test(r.unsafe), `win32 ${n} → ${JSON.stringify(r)}`)
    }
  })

  test('the second guard finds a .git spelling the file system kept, the file system\'s own ".git", and a folder git takes for a repository', () => {
    const clean = tempDir('guard')
    mkdirSync(join(clean, 'src', '.github'), { recursive: true })
    writeFileSync(join(clean, 'src', '.gitignore'), 'x\n')
    // a HEAD file and folders named objects / refs that do not make a repository together
    mkdirSync(join(clean, 'docs', 'objects'), { recursive: true })
    writeFileSync(join(clean, 'docs', 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(join(clean, 'model', 'HEAD'), { recursive: true })
    mkdirSync(join(clean, 'model', 'objects'))
    mkdirSync(join(clean, 'model', 'refs'))
    assert.equal(gitDirIn(clean), null)
    const top = tempDir('guard')
    mkdirSync(join(top, '.GIT'))
    assert.deepEqual(gitDirIn(top), { path: join(top, '.GIT'), kind: 'dotgit' })
    const deep = tempDir('guard')
    mkdirSync(join(deep, 'a', 'b', 'GIT~1'), { recursive: true })
    assert.deepEqual(gitDirIn(deep), { path: join(deep, 'a', 'b', 'GIT~1'), kind: 'dotgit' })
    const file = tempDir('guard')
    mkdirSync(join(file, 'vendor'))
    writeFileSync(join(file, 'vendor', '.git'), 'gitdir: ../../elsewhere\n')
    assert.deepEqual(gitDirIn(file), { path: join(file, 'vendor', '.git'), kind: 'dotgit' })
    // a bare repository under any name: HEAD + objects/ + refs/, or HEAD + commondir — at any depth, the top too
    const bare = tempDir('guard')
    mkdirSync(join(bare, 'test', 'fixtures', 'sub', 'objects'), { recursive: true })
    mkdirSync(join(bare, 'test', 'fixtures', 'sub', 'refs'))
    writeFileSync(join(bare, 'test', 'fixtures', 'sub', 'HEAD'), 'ref: refs/heads/x\n')
    assert.deepEqual(gitDirIn(bare), { path: join(bare, 'test', 'fixtures', 'sub'), kind: 'repo' })
    const common = tempDir('guard')
    mkdirSync(join(common, 'wt'))
    writeFileSync(join(common, 'wt', 'HEAD'), 'ref: refs/heads/x\n')
    writeFileSync(join(common, 'wt', 'commondir'), '../shared\n')
    assert.deepEqual(gitDirIn(common), { path: join(common, 'wt'), kind: 'repo' })
    const atTop = tempDir('guard')
    mkdirSync(join(atTop, 'objects'))
    mkdirSync(join(atTop, 'refs'))
    writeFileSync(join(atTop, 'HEAD'), 'ref: refs/heads/main\n')
    assert.deepEqual(gitDirIn(atTop), { path: atTop, kind: 'repo' })
  })

  test('objects, refs and commondir count whatever they are: Git for Windows takes plain files there for a repository (access X_OK)', () => {
    const files = tempDir('guard')
    mkdirSync(join(files, 'fixture'))
    for (const n of ['HEAD', 'objects', 'refs']) writeFileSync(join(files, 'fixture', n), n === 'HEAD' ? 'ref: refs/heads/main\n' : '')
    assert.deepEqual(gitDirIn(files), { path: join(files, 'fixture'), kind: 'repo' })
    const mixed = tempDir('guard')
    mkdirSync(join(mixed, 'refs'))
    writeFileSync(join(mixed, 'objects'), '')
    writeFileSync(join(mixed, 'HEAD'), 'ref: refs/heads/main\n')
    assert.deepEqual(gitDirIn(mixed), { path: mixed, kind: 'repo' })
    const common = tempDir('guard')
    mkdirSync(join(common, 'wt', 'commondir'), { recursive: true })
    writeFileSync(join(common, 'wt', 'HEAD'), 'ref: refs/heads/x\n')
    assert.deepEqual(gitDirIn(common), { path: join(common, 'wt'), kind: 'repo' })
    // still not a repository: no HEAD, or only one of objects / refs
    const half = tempDir('guard')
    writeFileSync(join(half, 'HEAD'), 'x\n')
    writeFileSync(join(half, 'objects'), '')
    assert.equal(gitDirIn(half), null)
  })

  test('after unpacking, the second guard runs before any git step and the folder goes again (finishImport)', async () => {
    const path = process.env.PATH
    // no git at all: a refusal here can only come from the guard, before git was ever started
    process.env.PATH = tempDir('nobin')
    try {
      for (const [plant, why] of [
        [(d: string) => mkdirSync(join(d, '.GIT')), /another spelling \(\.GIT\)/],
        [(d: string) => writeFileSync(join(d, 'vendor', '.git'), 'gitdir: ../../x\n'), /another spelling \(vendor\/\.git\)/],
        [(d: string) => {
          mkdirSync(join(d, 'sub', 'objects', 'info'), { recursive: true })
          mkdirSync(join(d, 'sub', 'refs', 'heads'), { recursive: true })
          writeFileSync(join(d, 'sub', 'HEAD'), 'ref: refs/heads/x\n')
          writeFileSync(join(d, 'sub', 'config'), '[core]\n\tfsmonitor = touch pwned\n')
        }, /git repository in sub \(HEAD, objects, refs\)/],
      ] as const) {
        const dir = join(tempDir('finish'), 'proj')
        mkdirSync(join(dir, 'vendor'), { recursive: true })
        writeFileSync(join(dir, 'README.md'), '# x\n')
        plant(dir)
        await assert.rejects(finishImport(dir, 'p.zip'), why)
        assert.ok(!existsSync(dir), 'the folder is removed')
      }
      // a clean folder gets past the guard: git is what fails then, and the folder goes too
      const dir = join(tempDir('finish'), 'proj')
      mkdirSync(dir)
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      await assert.rejects(finishImport(dir, 'p.zip'), /git init failed/)
      assert.ok(!existsSync(dir))
    } finally {
      process.env.PATH = path
    }
  })

  test('a crafted ZIP: .GIT/config with core.fsmonitor, .Git/hooks, the exact .git/config and more spellings — imported without any, nothing ran', async () => {
    const trap = tempDir('trap')
    const fsmonitor = tripwire(trap, 'fsmonitor-ran')
    const hook = `#!/bin/sh\ntouch '${slashPath(join(trap, 'hook-ran'))}'\n`
    const config = `[core]\n\tfsmonitor = ${fsmonitor}\n\thooksPath = .Git/hooks\n[filter "x"]\n\tclean = ${fsmonitor}\n`
    const base = tempDir('clones')
    const res = await asPerson('', () => importZip(zipFile({
      'proj/README.md': '# Legacy\n',
      'proj/src/app.js': 'console.log(1)\n',
      'proj/.gitattributes': '* filter=x\n',
      'proj/.GIT/config': config,
      'proj/.GIT/HEAD': 'ref: refs/heads/main\n',
      'proj/.Git/hooks/pre-commit': hook,
      'proj/.Git/hooks/post-index-change': hook,
      'proj/.git/config': config,
      'proj/.git/hooks/post-commit': hook,
      'proj/GIT~1/config': config,
      'proj/.git. /config': config,
      'proj/.g\u200cit/config': config,
      'proj/lib/.GIT/config': config,
    }), base, 'proj', 'proj.zip'))
    assert.equal(res.dir, join(base, 'proj'))
    assert.equal(res.files, 3)
    assert.deepEqual(readdirSync(res.dir).sort(), ['.git', '.gitattributes', 'README.md', 'src'])
    assert.ok(!readFileSync(join(res.dir, '.git', 'config'), 'utf8').includes('fsmonitor'))
    assert.deepEqual(sh(res.dir, 'ls-files').trim().split('\n'), ['.gitattributes', 'README.md', 'src/app.js'])
    assert.equal(sh(res.dir, 'rev-list', '--count', 'HEAD').trim(), '1')
    assert.equal(sh(res.dir, 'log', '-1', '--format=%s %an').trim(), 'Import proj.zip One worker')
    assert.deepEqual(readdirSync(trap).sort(), ['fsmonitor-ran.sh'], 'no hook, fsmonitor or filter ran')
    assert.deepEqual(readdirSync(base), ['proj'], 'no temp folder left')
    // on a disk that ignores case (macOS, Windows) .GIT/config IS .git/config: there the 1.8.0 import ran its fsmonitor
    if (foldsCase()) assert.ok(!existsSync(join(trap, 'fsmonitor-ran')), 'case-insensitive disk: nothing ran')
  })

  test('an embedded bare repository (HEAD, objects/, refs/, config with core.fsmonitor) refuses the ZIP: git would run its fsmonitor in that folder', async () => {
    const trap = tempDir('trap')
    const fsmonitor = tripwire(trap, 'fsmonitor-ran')
    const base = tempDir('clones')
    await assert.rejects(asPerson('', () => importZip(zipFile({
      'proj/README.md': '# x\n',
      'proj/sub/HEAD': 'ref: refs/heads/x\n',
      'proj/sub/objects/info/keep': '',
      'proj/sub/refs/heads/x': '',
      'proj/sub/config': `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = ${fsmonitor}\n`,
    }), base, 'proj', 'proj.zip')), /git repository in sub \(HEAD, objects, refs\).*nothing was imported/)
    assert.deepEqual(readdirSync(base), [], 'nothing left')
    assert.deepEqual(readdirSync(trap), ['fsmonitor-ran.sh'])
    // why: such a folder is a live repository for any git command run inside it
    const live = join(tempDir('bare'), 'sub')
    mkdirSync(join(live, 'objects', 'info'), { recursive: true })
    mkdirSync(join(live, 'refs', 'heads'), { recursive: true })
    writeFileSync(join(live, 'HEAD'), 'ref: refs/heads/x\n')
    writeFileSync(join(live, 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = ${fsmonitor}\n`)
    execFileSync('git', ['status', '--short'], { cwd: live, env: { ...process.env, ...GIT_ENV }, stdio: 'ignore' })
    assert.ok(existsSync(join(trap, 'fsmonitor-ran')), 'plain git status ran the planted fsmonitor')
  })

  test('the commit never reads a git folder in the import (fsmonitor, hooks, filter drivers, gpg.program, include.path) — it is made outside and refused at the end', async () => {
    const trap = tempDir('trap')
    const dir = join(tempDir('planted'), 'proj')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.js'), 'module.exports = 1\n')
    writeFileSync(join(dir, '.gitattributes'), '* filter=x\n')
    // a .GIT a case-insensitive disk made .git, live, as if it had slipped past both guards
    sh(dir, 'init', '-q')
    const evilHooks = join(trap, 'evil-hooks')
    mkdirSync(evilHooks)
    for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-index-change', 'reference-transaction']) {
      for (const at of [evilHooks, join(dir, '.git', 'hooks')]) {
        writeFileSync(join(at, name), `#!/bin/sh\ntouch '${slashPath(join(trap, `${name}-ran`))}'\nexit 0\n`)
        if (!IS_WIN) chmodSync(join(at, name), 0o755)
      }
    }
    sh(dir, 'config', 'core.fsmonitor', tripwire(trap, 'fsmonitor-ran'))
    sh(dir, 'config', 'core.hooksPath', slashPath(evilHooks))
    sh(dir, 'config', 'filter.x.clean', tripwire(trap, 'filter-clean-ran'))
    sh(dir, 'config', 'filter.x.required', 'true')
    sh(dir, 'config', 'gpg.program', tripwire(trap, 'gpg-ran'))
    sh(dir, 'config', 'gpg.format', 'openpgp')
    sh(dir, 'config', 'commit.gpgSign', 'true')
    const included = join(trap, 'included.gitconfig')
    writeFileSync(included, `[core]\n\tsshCommand = ${tripwire(trap, 'ssh-ran')}\n[diff]\n\texternal = ${tripwire(trap, 'diff-ran')}\n`)
    sh(dir, 'config', 'include.path', slashPath(included))
    const before = readFileSync(join(dir, '.git', 'config'), 'utf8')
    await assert.rejects(asPerson('', () => commitImport(dir, 'legacy.zip')), /another spelling \(\.git\)/)
    assert.deepEqual(readdirSync(trap).filter((n) => !n.endsWith('.sh') && !n.endsWith('.gitconfig')).sort(), ['evil-hooks'], 'nothing ran')
    assert.deepEqual(leftovers(dir), [], 'the temporary git folder is gone')
    assert.equal(readFileSync(join(dir, '.git', 'config'), 'utf8'), before, 'the planted folder was not touched')
    // the planted config was live: plain git runs it
    sh(dir, 'add', '-A')
    assert.ok(existsSync(join(trap, 'filter-clean-ran')) && existsSync(join(trap, 'fsmonitor-ran')), 'plain git add ran the planted filter and fsmonitor')
  })

  test('a usual project imports with one commit (the person\'s identity, no core.worktree, marked as an import); a refused or failed import leaves nothing behind', async () => {
    const base = tempDir('clones')
    const files = { 'shop-main/README.md': '# Shop\n', 'shop-main/src/index.ts': 'export {}\n', 'shop-main/.github/workflows/ci.yml': 'on: push\n', 'shop-main/.gitignore': 'dist/\n', 'shop-main/dist/x.js': '1\n', 'shop-main/Icon\r': '', '__MACOSX/shop-main/._Icon\r': 'x', 'shop-main/.git/refs/heads/aux': 'x', '__MACOSX/shop-main/._logo.png:Zone.Identifier': 'x' }
    const ok = await asPerson('[user]\n\tname = Kim Global\n\temail = kim.global@example.invalid\n', () => importZip(zipFile(files), base, 'shop', 'shop-main.zip'))
    assert.equal(ok.dir, join(base, 'shop'))
    assert.deepEqual(sh(ok.dir, 'ls-files').trim().split('\n'), ['.github/workflows/ci.yml', '.gitignore', 'README.md', 'src/index.ts'])
    assert.equal(sh(ok.dir, 'rev-list', '--count', 'HEAD').trim(), '1')
    assert.equal(sh(ok.dir, 'log', '-1', '--format=%s|%an|%ae').trim(), 'Import shop-main.zip|Kim Global|kim.global@example.invalid')
    assert.equal(sh(ok.dir, 'branch', '--show-current').trim(), 'main')
    assert.equal(sh(ok.dir, 'status', '--porcelain').trim(), '')
    assert.ok(!/worktree/.test(readFileSync(join(ok.dir, '.git', 'config'), 'utf8')), 'no core.worktree: the folder can move')
    assert.equal(readFileSync(join(ok.dir, '.git', SOURCE_MARK), 'utf8'), 'zip\n')
    assert.deepEqual(leftovers(ok.dir), [])

    // macOS / Linux: names Windows keeps for devices or streams are plain files there (the kernel's aux.c)
    if (process.platform !== 'win32') {
      const kept = await asPerson('', () => importZip(zipFile({ 'linux/drivers/i2c/aux.c': 'int aux;\n', 'linux/nul': '', 'linux/con.go': 'package con\n', 'linux/img/logo.png:Zone.Identifier': '[ZoneTransfer]\n' }), base, 'linux', 'linux.zip'))
      assert.deepEqual(sh(kept.dir, 'ls-files').trim().split('\n'), ['con.go', 'drivers/i2c/aux.c', 'img/logo.png:Zone.Identifier', 'nul'])
    }

    for (const [files, why] of [
      [{ 'p/a.txt': 'a', 'p/evil\u001b]0;x\u0007.txt': 'x' }, /control character \(p\/evil\?\]0;x\?\.txt\)/],
      [{ 'p/a.txt': 'a', 'p/.. /x.txt': 'x' }, /outside its folder/],
      [{ 'p/.GIT/config': '[core]' }, /no files/],
    ] as const) {
      const empty = tempDir('clones')
      await assert.rejects(importZip(zipFile(files), empty, 'p', 'p.zip'), why)
      assert.deepEqual(readdirSync(empty), [], JSON.stringify(Object.keys(files)))
    }

    // git cannot run: the import fails and its folder goes again
    const path = process.env.PATH
    process.env.PATH = tempDir('nobin')
    const gone = tempDir('clones')
    try {
      await assert.rejects(importZip(zipFile({ 'p/a.txt': 'a' }), gone, 'p', 'p.zip'), /git init failed/)
    } finally {
      process.env.PATH = path
    }
    assert.deepEqual(readdirSync(gone), [])
  })

  test('a ZIP that is a git repository itself (a bare one, or the inside of a .git) is refused with what to do instead', async () => {
    const zips: Array<Record<string, string>> = [
      { 'billing.git/HEAD': 'ref: refs/heads/main\n', 'billing.git/config': '[core]\n\tbare = true\n', 'billing.git/objects/info/packs': '', 'billing.git/refs/heads/main': '0000000000000000000000000000000000000000\n', 'billing.git/description': 'x\n' },
      { HEAD: 'ref: refs/heads/main\n', config: '[core]\n', 'objects/info/packs': '', 'refs/heads/main': 'x\n' },
    ]
    for (const files of zips) {
      const base = tempDir('clones')
      await assert.rejects(asPerson('', () => importZip(zipFile(files), base, 'billing', 'billing.zip')), /is a git repository itself.*clone it and zip the checkout.*nothing was imported/)
      assert.deepEqual(readdirSync(base), [], 'nothing left')
    }
  })

  test('the commit starts no automatic gc: > 7,000 files leave no gc.pid, gc.log or lock in .git and no temporary folder next to it', async () => {
    const dir = join(tempDir('many'), 'proj')
    for (let i = 0; i < 7200; i++) {
      const d = join(dir, `d${i % 60}`)
      if (i < 60) mkdirSync(d, { recursive: true })
      writeFileSync(join(d, `f${i}.txt`), `file ${i}\n`)
    }
    await asPerson('', () => finishImport(dir, 'many.zip'))
    // a detached `git gc --auto` takes a moment: give one the time it would need
    await new Promise((r) => setTimeout(r, 2500))
    assert.deepEqual(readdirSync(join(dir, '.git')).filter((n) => /^gc\.|\.lock$/.test(n)), [], 'no gc.pid, gc.log or lock')
    assert.deepEqual(leftovers(dir), [], 'no .one-import-git-* came back')
    assert.equal(sh(dir, 'rev-list', '--count', 'HEAD').trim(), '1')
    // a later gc of the person's in this repository works
    sh(dir, 'gc', '--quiet')
    assert.ok(readdirSync(join(dir, '.git', 'objects', 'pack')).some((n) => n.endsWith('.pack')), 'a later gc packs the objects')
  })

  test('no filter, diff or merge driver runs in an imported repository — at import, at the first git status, in a task\'s worktree, its diff, commit and update — not even the person\'s own global ones that would run the ZIP\'s script', async () => {
    const trap = tempDir('trap')
    const attributes = join(tempDir('attrs'), 'attributes')
    // an nbstripout-style install (`nbstripout --install --global`): a clean filter and a diff textconv that run in the
    // repository's folder (`python -m nbstripout` imports the ZIP's nbstripout.py first) — here the ZIP's own script; a
    // merge driver the same way (`npx npm-merge-driver` finds the ZIP's node_modules/.bin first); a long-running filter
    // process; and an LFS-like filter of the person's own that turns content into a pointer
    writeFileSync(attributes, '*.ipynb filter=nbstrip diff=nbstrip merge=drv\n*.csv filter=lfsish\n')
    const pointer = join(trap, 'pointer.sh')
    writeFileSync(pointer, `#!/bin/sh\ncat >/dev/null\ntouch '${slashPath(join(trap, 'pointer-ran'))}'\necho 'version https://git-lfs.github.com/spec/v1'\n`)
    if (!IS_WIN) chmodSync(pointer, 0o755)
    const global = [
      '[user]\n\tname = Kim\n\temail = kim@example.invalid',
      '[filter "nbstrip"]\n\tclean = sh nbstripout.sh clean\n\tsmudge = sh nbstripout.sh smudge\n\trequired = true',
      '[diff "nbstrip"]\n\ttextconv = sh nbstripout.sh textconv',
      '[merge "drv"]\n\tname = notebooks\n\tdriver = sh nbstripout.sh merge %O %A %B',
      '[filter "lfsish"]\n\tprocess = sh nbstripout.sh process',
      `[filter "lfs"]\n\tclean = ${slashPath(pointer)}\n\tsmudge = cat\n\trequired = true`,
      `[core]\n\tattributesFile = ${slashPath(attributes)}`,
      // an external diff command of the person's (diff.external): it runs in the repository's folder too
      '[diff]\n\texternal = sh nbstripout.sh external',
    ].join('\n') + '\n'
    const script = `touch '${slashPath(join(trap, 'ran'))}'-"$1"\ncat\n`
    const notebook = '{"cells": [{"outputs": ["secret"]}]}\n'
    const data = 'BINARY\u0000DATA'.repeat(200)
    const base = tempDir('clones')
    const ran = () => readdirSync(trap).filter((n) => !n.endsWith('.sh'))
    await asPerson(global, async () => {
      const res = await importZip(zipFile({
        'nb/analysis.ipynb': notebook,
        'nb/data.csv': 'a,b\n1,2\n',
        'nb/data.bin': data,
        'nb/.gitattributes': '*.ipynb filter=nbstrip\n*.bin filter=lfs diff=lfs merge=lfs -text\n',
        'nb/nbstripout.sh': script,
      }), base, 'nb', 'nb.zip')
      assert.deepEqual(ran(), [], 'nothing ran at import')
      assert.equal(sh(res.dir, 'cat-file', '-p', 'HEAD:analysis.ipynb'), notebook, 'the file went in as it is')
      assert.equal(sh(res.dir, 'cat-file', '-p', 'HEAD:data.bin'), data, 'an LFS-tracked file went in as a plain file, not a pointer')

      // what the setup page (startImport) and the Import stage (adopt) do next: repoFacts runs git status
      const facts = await repoFacts(res.dir, new Set())
      assert.equal(facts.dirty, 0, 'nothing shows as changed — LFS files neither')
      assert.deepEqual(ran(), [], 'the first git status ran nothing')
      assert.ok(readFileSync(join(res.dir, '.git', 'info', 'attributes'), 'utf8').endsWith(`\n${NO_DRIVERS}`), 'no driver, for good: the last line of its info/attributes')

      // a task: worktree, the stage's change, commit, the diff for One, an update from the base with a conflict
      const file = join(tempDir('cfg'), 'worker.json')
      writeFileSync(file, JSON.stringify({ workspace: 'local:nb-ws-1', repos: [{ name: 'nb', path: res.dir, baseBranch: 'main', remote: 'origin', worktreeDir: tempDir('wt'), pr: 'none', push: false }] }))
      const loaded = loadConfig(file, {})
      assert.deepEqual(loaded.problems, [])
      const repo = loaded.config.repos[0]!
      const state = new WorkerState(file)
      const wt = await ensureWorktree(repo, state, { id: 'nbtask01', title: 'Clean the notebook' }, null)
      assert.equal(sh(wt.dir, 'status', '--porcelain'), '', 'the task\'s worktree is clean')
      assert.equal(await isDirty(wt.dir), false)
      writeFileSync(join(wt.dir, 'analysis.ipynb'), '{"cells": []}\n')
      assert.ok(await commitAll(wt.dir, 'Clean the notebook'))
      assert.deepEqual(sh(wt.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), ['analysis.ipynb'], 'the commit holds the task\'s change only')
      const g = await info(repo, state, wt.dir, wt.branch)
      assert.match(g.files.find((f) => f.path === 'analysis.ipynb')?.diff ?? '', /-\{"cells": \[\{"outputs": \["secret"\]\}\]\}/, 'the diff is git\'s own')
      assert.match((await branchDiff(repo, wt.branch, wt.dir))?.text ?? '', /analysis\.ipynb/)
      writeFileSync(join(res.dir, 'analysis.ipynb'), '{"cells": [2]}\n')
      sh(res.dir, 'commit', '-q', '-am', 'their notebook')
      const up = await updateFromBase(repo, wt.dir, wt.branch)
      assert.deepEqual([up.how, up.conflicts], ['conflicts', ['analysis.ipynb']], 'git\'s own merge: a conflict, no merge driver')
      assert.deepEqual(ran(), [], 'nothing ran during the task')

      // the setup was live: plain git diff runs the person's external diff in the repository's folder, and without the
      // line their diff textconv (the ZIP's script both times)
      sh(wt.dir, 'merge', '--abort')
      const plainDiff = (...args: string[]) => execFileSync('git', ['diff', ...args, 'HEAD~1', '--', 'analysis.ipynb'], { cwd: wt.dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore' })
      plainDiff()
      assert.deepEqual(ran(), ['ran-external'], 'plain git diff ran the external diff')
      writeFileSync(join(res.dir, '.git', 'info', 'attributes'), '')
      plainDiff('--no-ext-diff')
      assert.ok(ran().includes('ran-textconv'), `plain git diff ran the textconv: ${ran().join(', ')}`)
    })
  })

  test('Git LFS (when installed): an LFS-tracked ZIP imports as plain files and stays clean — repoFacts, a task\'s worktree, its first commit', { skip: !hasGitLfs() && 'git-lfs is not installed' }, async () => {
    const global = '[user]\n\tname = Kim\n\temail = kim@example.invalid\n[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n\tprocess = git-lfs filter-process\n\trequired = true\n'
    const data = 'BINARYDATA'.repeat(100)
    await asPerson(global, async () => {
      const res = await importZip(zipFile({ 'game/.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text\n', 'game/data.bin': data, 'game/readme.md': 'hi\n' }), tempDir('clones'), 'game', 'game.zip')
      assert.equal((await repoFacts(res.dir, new Set())).dirty, 0)
      assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: res.dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' }), '')
      const file = join(tempDir('cfg'), 'worker.json')
      writeFileSync(file, JSON.stringify({ workspace: 'local:lfs-ws-1', repos: [{ name: 'game', path: res.dir, baseBranch: 'main', remote: 'origin', worktreeDir: tempDir('wt'), pr: 'none', push: false }] }))
      const repo = loadConfig(file, {}).config.repos[0]!
      const wt = await ensureWorktree(repo, new WorkerState(file), { id: 'lfstask1', title: 'Readme' }, null)
      assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt.dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' }), '', 'no "should have been a pointer"')
      writeFileSync(join(wt.dir, 'readme.md'), 'hello\n')
      await commitAll(wt.dir, 'Readme')
      assert.deepEqual(sh(wt.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), ['readme.md'], 'no LFS conversion in the task\'s commit')
      assert.equal(sh(wt.dir, 'cat-file', '-p', 'HEAD:data.bin'), data)
    })
  })
})

describe('a new project for an imported repository', () => {
  test('the name comes from the code (package.json, pom.xml, pyproject, README …), else the ZIP\'s', () => {
    const at = (files: Record<string, string>) => {
      const d = tempDir('suggest')
      for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text)
      return d
    }
    assert.equal(suggestName(at({ 'package.json': '{"name":"@acme/Billing Core"}' }), 'x.zip'), 'billing-core')
    assert.equal(suggestName(at({ 'pom.xml': '<project><parent><artifactId>spring-parent</artifactId></parent><artifactId>invoice-service</artifactId></project>' }), 'x'), 'invoice-service')
    assert.equal(suggestName(at({ 'pyproject.toml': '[project]\nname = "Lager Verwaltung"\n' }), 'x'), 'lager-verwaltung')
    assert.equal(suggestName(at({ 'Legacy.Shop.sln': '' }), 'x'), 'legacy.shop')
    assert.equal(suggestName(at({ 'README.md': 'intro\n# Warenwirtschaft 1999\n' }), 'x'), 'warenwirtschaft-1999')
    assert.equal(suggestName(at({ 'package.json': 'not json' }), 'Old Billing.zip'), 'old-billing.zip')
    assert.equal(slugName('Ünïcödé Shop'), 'unicode-shop')
  })

  test('host, group / owner, name and visibility are checked', () => {
    assert.deepEqual(checkPublish({ host: 'gitlab', owner: 'acme/platform', name: 'billing', visibility: 'internal' }), { host: 'gitlab', owner: 'acme/platform', name: 'billing', visibility: 'internal' })
    assert.deepEqual(checkPublish({ host: 'github', name: 'billing', visibility: 'internal' }), { host: 'github', owner: null, name: 'billing', visibility: 'private' })
    for (const bad of [{ host: 'bitbucket', name: 'a' }, { host: 'gitlab', name: '-x' }, { host: 'gitlab', name: 'a b' }, { host: 'gitlab', name: 'ok', owner: '../x' }, { host: 'github', name: 'ok', owner: 'a/b' }, { host: 'gitlab', name: 'ok', owner: '--help' }])
      assert.ok('error' in checkPublish(bad), JSON.stringify(bad))
  })
})

describe('the setup page: clone, projects, ZIP import, own MCP servers', () => {
  test('clone a repository, pick from glab / gh projects, import a ZIP as a new repository, refuse a ZIP that escapes; Save keeps the clone folder and the MCP servers', async () => {
    const home = tempDir('home')
    const bin = fakeTools()
    const remote = makeRepo().remote
    // the "GitLab" project a publish creates: a local bare repository the fake glab hands out as its address
    const created = join(tempDir('gitlab'), 'billing-core.git')
    mkdirSync(created, { recursive: true })
    execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', created], { env: { ...process.env, ...GIT_ENV } })
    const glabLog = join(tempDir('glablog'), 'calls.txt')
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { ...pathWith(bin), ONE_WORKER_CLONE_LOCAL: '1', FAKE_REMOTE: created, FAKE_LOG: glabLog } })
    await waitFor(() => /setup#k=([A-Za-z0-9_-]{43})/.test(worker!.stdout()), 8000, () => worker!.stderr())
    const token = /setup#k=([A-Za-z0-9_-]{43})/.exec(worker.stdout())![1]!
    const tab = await FakeTab.connect(PORT, { origin: ORIGIN })
    tabs.push(tab)
    tab.hello(WS, PAIR)
    await tab.next('welcome')

    const first = (await call('/setup/api/state', { token })).json()
    assert.equal(first.cloneDir, '~/one-repos')
    assert.equal(first.glab, true)

    // the person's projects: GitLab + GitHub, newest first; an entry with a token or an option-like address is dropped
    const projects = (await call('/setup/api/projects', { token })).json()
    assert.deepEqual(projects.tools, { glab: true, gh: true })
    assert.deepEqual(projects.projects.map((p: { path: string; source: string }) => [p.source, p.path]), [['gitlab', 'acme/legacy-billing'], ['github', 'me/old-shop']])
    assert.equal(projects.projects[0].ssh, 'git@gitlab.example.com:acme/legacy-billing.git')

    // refusals: a token in the address, an ext:: address, a relative clone folder
    assert.equal((await call('/setup/api/clone', { token, body: { url: 'https://me:glpat-1@gitlab.example.com/a/b.git' } })).status, 400)
    assert.equal((await call('/setup/api/clone', { token, body: { url: 'ext::sh -c id' } })).status, 400)
    assert.equal((await call('/setup/api/clone', { token, body: { url: remote, dir: 'clones' } })).status, 400)

    // a clone into another folder (kept with the next Save)
    const started = await call('/setup/api/clone', { token, body: { url: remote, dir: '~/work/clones' } })
    assert.equal(started.status, 200, started.text)
    const cloned = await jobDone(token)
    assert.equal(cloned.clone.error, null)
    const dir = join(home, 'work', 'clones', 'remote')
    assert.equal(cloned.clone.done, dir)
    assert.ok(existsSync(join(dir, 'README.md')))
    assert.equal(readFileSync(join(dir, '.git', SOURCE_MARK), 'utf8'), 'clone\n', 'a clone is marked: its own Claude Code settings stay out')
    assert.ok(cloned.repos.some((r: { path: string; ticked: boolean }) => r.path === dir && !r.ticked))
    assert.equal(cloned.cloneDir, '~/work/clones')
    // the same address again: already there, added. Outside the default clone folder it may be the person's own
    // checkout: no mark is written (the clone folder rule covers it while it lies in the clone folder) …
    rmSync(join(dir, '.git', SOURCE_MARK))
    await call('/setup/api/clone', { token, body: { url: remote, dir: '~/work/clones' } })
    const readded = await jobDone(token)
    assert.equal(readded.clone.done, dir)
    assert.ok(!existsSync(join(dir, '.git', SOURCE_MARK)), 'a checkout outside ~/one-repos is not marked')
    assert.deepEqual(readded.repos.filter((r: { path: string }) => r.path === dir).map((r: { ownSettings: boolean; source: string | null }) => [r.ownSettings, r.source]), [[false, 'cloneDir']])
    // … in ~/one-repos it is an older worker's clone without a mark: marked
    const inDefault = join(home, 'one-repos', 'remote')
    execFileSync('git', ['clone', '--quiet', remote, inDefault], { env: { ...process.env, ...GIT_ENV } })
    await call('/setup/api/clone', { token, body: { url: remote, dir: '~/one-repos' } })
    assert.equal((await jobDone(token)).clone.done, inDefault)
    assert.equal(readFileSync(join(inDefault, '.git', SOURCE_MARK), 'utf8'), 'clone\n', 'an existing clone in the default clone folder is marked when it is added')

    // a ZIP of legacy code: one folder at the top, its own .git and Mac leftovers left out
    const zip = Buffer.from(zipSync({
      'legacy-app/README.md': strToU8('# Billing 1998\n'),
      'legacy-app/package.json': strToU8('{"name":"@acme/billing-core","version":"0.9.0"}'),
      'legacy-app/src/billing.js': strToU8('module.exports = (a, b) => a + b\n'),
      'legacy-app/.git/config': strToU8('[core]\n\tfsmonitor = touch pwned\n'),
      'legacy-app/.git/hooks/post-commit': strToU8('#!/bin/sh\ntouch pwned\n'),
      'legacy-app/.GIT/config': strToU8('[core]\n\tfsmonitor = touch pwned\n'),
      'legacy-app/GIT~1/config': strToU8('[core]\n\tfsmonitor = touch pwned\n'),
      'legacy-app/.DS_Store': strToU8('x'),
      'legacy-app/Icon\r': strToU8(''),
      '__MACOSX/legacy-app/._README.md': strToU8('x'),
      '__MACOSX/legacy-app/._Icon\r': strToU8('x'),
    }))
    assert.equal((await call('/setup/api/import?name=legacy-app.zip', { token, raw: zip, type: 'text/plain' })).status, 415)
    const imp = await call('/setup/api/import?name=legacy-app.zip', { token, raw: zip, type: 'application/zip' })
    assert.equal(imp.status, 200, imp.text)
    const imported = await jobDone(token)
    assert.equal(imported.clone.error, null)
    const app = join(home, 'work', 'clones', 'legacy-app')
    assert.equal(imported.clone.done, app)
    assert.deepEqual(readdirSync(app).sort(), ['.git', 'README.md', 'package.json', 'src'])
    assert.equal(imported.clone.suggest, 'billing-core')
    assert.ok(!readFileSync(join(app, '.git', 'config'), 'utf8').includes('fsmonitor'))
    assert.ok(!existsSync(join(app, '.git', 'hooks', 'post-commit')))
    assert.equal(sh(app, 'log', '-1', '--format=%s').trim(), 'Import legacy-app.zip')
    assert.equal(sh(app, 'branch', '--show-current').trim(), 'main')
    assert.equal(sh(app, 'status', '--porcelain').trim(), '')
    assert.ok(!existsSync(join(home, 'pwned')) && !existsSync(join(app, 'pwned')))
    assert.equal(readFileSync(join(app, '.git', SOURCE_MARK), 'utf8'), 'zip\n')

    // Create it on GitLab: the person's glab makes the project (in the group acme), origin added, main pushed
    assert.equal((await call('/setup/api/publish', { token, body: { path: app, host: 'gitlab', name: 'bad name' } })).status, 400)
    assert.equal((await call('/setup/api/publish', { token, body: { path: '/etc', host: 'gitlab', name: 'x' } })).status, 400)
    const pub = await call('/setup/api/publish', { token, body: { path: app, host: 'gitlab', owner: 'acme', name: 'billing-core', visibility: 'private' } })
    assert.equal(pub.status, 200, pub.text)
    const published = await jobDone(token)
    assert.equal(published.clone.error, null)
    assert.equal(published.clone.web, 'https://gitlab.example.com/acme/billing-core')
    assert.equal(sh(created, 'log', '-1', '--format=%s', 'main').trim(), 'Import legacy-app.zip')
    assert.equal(sh(app, 'remote', 'get-url', 'origin').trim(), created)
    assert.match(readFileSync(glabLog, 'utf8'), /api -X POST projects -f name=billing-core -f path=billing-core -f visibility=private -F namespace_id=7/)
    assert.ok(published.repos.some((r: { path: string; remote: string | null }) => r.path === app && r.remote === 'origin'))
    // a repository with a remote is not published again
    assert.equal((await call('/setup/api/publish', { token, body: { path: app, host: 'gitlab', name: 'again' } })).status, 400)

    // a ZIP that reaches outside its folder: refused as a whole, nothing written, no temp folder left
    const evil = Buffer.from(zipSync({ 'ok.txt': strToU8('fine'), '../evil.txt': strToU8('escaped') }))
    await call('/setup/api/import?name=evil.zip', { token, raw: evil, type: 'application/zip' })
    const refused = await jobDone(token)
    assert.match(refused.clone.error, /outside its folder/)
    assert.ok(!existsSync(join(home, 'work', 'evil.txt')) && !existsSync(join(home, 'work', 'clones', 'evil')))
    assert.deepEqual(readdirSync(join(home, 'work', 'clones')).filter((n) => n.startsWith('.one-import')), [])

    // Save: the clone with an own MCP server, the imported repo; a bad MCP name is refused
    const pick = (mcp: string) => ({ repos: [{ path: dir, name: 'billing', baseBranch: 'main', test: '', push: false, pr: 'none', maxUsdPerTask: null, mcp }, { path: app, name: 'legacy-app', baseBranch: 'main', test: 'node --test', push: false, pr: 'none', maxUsdPerTask: null }] })
    assert.equal((await call('/setup/api/save', { token, body: pick('kb; rm') })).status, 400)
    const saved = await call('/setup/api/save', { token, body: pick('kb, docs-kb') })
    assert.equal(saved.status, 200, saved.text)
    const file = join(home, '.config', 'one', 'worker.json')
    const text = readFileSync(file, 'utf8')
    assert.match(text, /"cloneDir": "~\/work\/clones"/)
    const written = sanitizeConfig(JSON.parse(text.replace(/^\/\/.*$/gm, '')), file, {}).config
    assert.deepEqual(written.repos.map((r) => [r.name, r.claude.mcpServers]), [['billing', ['kb', 'docs-kb']], ['legacy-app', []]])
    assert.ok(written.cloneDir.endsWith(join('work', 'clones')), written.cloneDir)
    // One learns the names only
    await waitFor(() => tab.messages.filter((m) => m.type === 'welcome').length === 2)
    const welcome = tab.messages.filter((m): m is Extract<WorkerMessage, { type: 'welcome' }> => m.type === 'welcome')[1]!
    assert.deepEqual(welcome.repos.map((r) => r.name), ['billing', 'legacy-app'])
    assert.ok(!tab.raw.join('\n').includes(home), 'no path reaches One')
  })
})

describe('an imported repository with the person\'s global git filters (nbstripout-style)', () => {
  test('the setup page\'s import and an Import stage\'s ZIP read the new repository (git status) without running the ZIP\'s script', async () => {
    const home = tempDir('home')
    const trap = tempDir('trap')
    const attributes = join(tempDir('attrs'), 'attributes')
    writeFileSync(attributes, '*.ipynb filter=nbstripout diff=ipynb\n')
    // what `nbstripout --install --global` writes, with the ZIP's own script in the place of `python -m nbstripout`
    const global = join(tempDir('gitconfig'), 'gitconfig')
    writeFileSync(global, `[filter "nbstripout"]\n\tclean = sh nbstripout.sh\n\tsmudge = cat\n[diff "ipynb"]\n\ttextconv = sh nbstripout.sh\n[core]\n\tattributesFile = ${slashPath(attributes)}\n`)
    const zip = (top: string) => Buffer.from(zipSync({
      [`${top}/analysis.ipynb`]: strToU8('{"cells": []}\n'),
      [`${top}/nbstripout.sh`]: strToU8(`touch '${slashPath(join(trap, top))}'\ncat\n`),
    }))
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { GIT_CONFIG_GLOBAL: global } })
    await waitFor(() => /setup#k=([A-Za-z0-9_-]{43})/.test(worker!.stdout()), 8000, () => worker!.stderr())
    const token = /setup#k=([A-Za-z0-9_-]{43})/.exec(worker.stdout())![1]!
    const tab = await FakeTab.connect(PORT, { origin: ORIGIN })
    tabs.push(tab)
    tab.hello(WS, PAIR)
    await tab.next('welcome')

    // the setup page: import, then the repository's facts (git status) for the list
    assert.equal((await call('/setup/api/import?name=page-nb.zip', { token, raw: zip('page-nb'), type: 'application/zip' })).status, 200)
    const done = await jobDone(token)
    assert.equal(done.clone.error, null)
    const row = done.repos.find((r: { path: string }) => r.path === done.clone.done)
    assert.equal(row?.dirty, 0, JSON.stringify(row))
    assert.deepEqual(readdirSync(trap), [], 'the setup page ran nothing of the ZIP')

    // an Import stage from One: the same ZIP through the tab, adopted into worker.json
    const body = zip('stage-nb')
    const begin = await tab.request({ op: 'intake-begin', taskId: 'nbzip001', name: 'stage-nb.zip', size: body.length })
    assert.equal(begin.ok, true, JSON.stringify(begin))
    const { uploadId, chunk } = (begin as { result: { uploadId: string; chunk: number } }).result
    for (let off = 0; off < body.length; off += chunk) assert.equal((await tab.request({ op: 'intake-chunk', uploadId, data: body.subarray(off, off + chunk).toString('base64') })).ok, true)
    assert.equal((await tab.request({ op: 'intake-end', uploadId })).ok, true)
    const intakes = () => tab.messages.filter((m): m is Extract<WorkerMessage, { kind: 'intake' }> => m.type === 'event' && m.kind === 'intake')
    await waitFor(() => intakes().some((m) => m.intake.state !== 'running'), 30_000, () => worker!.stderr())
    assert.equal(intakes().at(-1)!.intake.state, 'done', JSON.stringify(intakes().at(-1)))
    assert.deepEqual(readdirSync(trap), [], 'the Import stage ran nothing of the ZIP')
    assert.match(worker.stdout() + worker.stderr(), /no git filter, diff or merge driver runs in it/)
  })
})

describe('GitLab and own MCP servers', () => {
  test('a GitLab remote gets a merge request with glab; without it (or switched off) the new-merge-request link', async () => {
    const dir = plainRepo(join(tempDir('mr'), 'demo'), { 'README.md': '# d\n' }, 'git@gitlab.example.com:acme/demo.git')
    const repo = { path: dir, remote: 'origin', baseBranch: 'main', pr: 'gh' } as RepoConfig
    const path = process.env.PATH
    // the fake tools' folder first (process.env takes "Path" as PATH on Windows)
    Object.assign(process.env, pathWith(fakeTools()))
    try {
      assert.deepEqual(await openPr(repo, dir, 'one/fix-1', 'Fix it', 'Body'), { url: 'https://gitlab.example.com/acme/demo/-/merge_requests/7', via: 'glab' })
      const link = await openPr({ ...repo, pr: 'none' }, dir, 'one/fix-1', 'Fix it', 'Body')
      assert.equal(link.via, 'link')
      assert.match(link.url!, /^https:\/\/gitlab\.example\.com\/acme\/demo\/-\/merge_requests\/new\?merge_request%5Bsource_branch%5D=one%2Ffix-1/)
    } finally {
      process.env.PATH = path
    }
  })

  test('own MCP servers: read from worker.json (bad names left out), told to Claude in the prompt', () => {
    const { config, problems } = sanitizeConfig({ repos: [{ name: 'a', path: '/tmp/a', claude: { mcpServers: ['kb', 'bad name', 'one-task'] } }] }, '/tmp/cfg/worker.json')
    assert.deepEqual(config.repos[0]!.claude.mcpServers, ['kb'])
    assert.equal(problems.filter((p) => /mcpServers/.test(p)).length, 2)
    const p = buildPrompt(task({ kind: 'plan' }), config.repos[0]!, 'one/x', 'c0de42')
    assert.match(p, /their own MCP servers: kb/)
    const none = buildPrompt(task({ kind: 'plan' }), { ...config.repos[0]!, claude: { ...config.repos[0]!.claude, mcpServers: [] } }, 'one/x', 'c0de42')
    assert.ok(!/own MCP servers/.test(none))
  })
})
