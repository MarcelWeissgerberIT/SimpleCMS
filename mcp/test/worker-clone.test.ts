/**
 * one-worker: new repositories from the local setup page — clone addresses checked (no tokens in https
 * addresses, no ext:: / option-like ones), a clone from a local bare remote (test seam ONE_WORKER_CLONE_LOCAL),
 * the person's GitLab / GitHub projects from fake glab / gh tools, a ZIP of source code unpacked into a fresh
 * repository (its own .git folders in every spelling a file system folds to ".git", __MACOSX and .DS_Store left out;
 * a path outside the folder, ":", a control character or a Windows device name refuses the ZIP; the git steps run
 * with fsmonitor off and no hooks even when a .git was planted), the clone folder and own MCP servers written by
 * Save, GitLab merge requests with glab. Nothing leaves the machine.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import type { WorkerMessage, WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { cloneBase, cloneHint, folderName, parseCloneUrl } from '../src/worker/clone.ts'
import { commitImport, dotGitIn, entryPath, importZip, isDotGit, isUnsafe } from '../src/worker/zipimport.ts'
import { openPr } from '../src/worker/git.ts'
import { sanitizeConfig, type RepoConfig } from '../src/worker/config.ts'
import { buildPrompt } from '../src/worker/run.ts'
import { checkPublish, slugName, suggestName } from '../src/worker/publish.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, GIT_ENV, cleanupAll, makeRepo, plainRepo, presetBundle, sh, spawnWorker, task, tempDir, type SpawnedWorker } from './worker-helpers.ts'

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

/** Fake glab and gh: their project lists, `mr create` printing a merge request address. */
function fakeTools(): string {
  const bin = tempDir('bin')
  const glab = `#!/bin/sh
case "$1 $2 $3" in
  "api -X POST") echo "{\\"web_url\\":\\"https://gitlab.example.com/acme/billing-core\\",\\"ssh_url_to_repo\\":\\"$FAKE_REMOTE\\",\\"http_url_to_repo\\":\\"$FAKE_REMOTE\\",\\"args\\":\\"$*\\"}"; echo "$*" >> "$FAKE_LOG"; exit 0 ;;
  "api groups/acme ") echo '{"id":7}'; exit 0 ;;
  "config get git_protocol") echo ssh; exit 0 ;;
esac
case "$1" in
  --version) echo "glab 1.99"; exit 0 ;;
  api) echo '[{"path_with_namespace":"acme/legacy-billing","http_url_to_repo":"https://gitlab.example.com/acme/legacy-billing.git","ssh_url_to_repo":"git@gitlab.example.com:acme/legacy-billing.git","last_activity_at":"2026-10-01T10:00:00Z"},{"path_with_namespace":"acme/bad","http_url_to_repo":"https://user:tok@gitlab.example.com/acme/bad.git","ssh_url_to_repo":"-oProxyCommand=x","last_activity_at":"2026-10-02T10:00:00Z"}]'; exit 0 ;;
  mr) echo "Creating merge request for $3 into $5"; echo "https://gitlab.example.com/acme/demo/-/merge_requests/7"; exit 0 ;;
esac
exit 1
`
  const gh = `#!/bin/sh
case "$1" in
  --version) echo "gh 9.9"; exit 0 ;;
  repo) echo '[{"nameWithOwner":"me/old-shop","url":"https://github.com/me/old-shop","sshUrl":"git@github.com:me/old-shop.git","updatedAt":"2026-09-20T08:00:00Z"}]'; exit 0 ;;
esac
exit 1
`
  writeFileSync(join(bin, 'glab'), glab)
  writeFileSync(join(bin, 'gh'), gh)
  chmodSync(join(bin, 'glab'), 0o755)
  chmodSync(join(bin, 'gh'), 0o755)
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
    // a local path only with the test seam
    assert.equal((parseCloneUrl('/tmp/remote.git', true) as { kind: string }).kind, 'local')
    assert.equal(folderName('acme/my app.git'), 'my-app')
    assert.equal(folderName('acme/.hidden'), 'hidden')
  })

  test('the clone folder: ~ and absolute paths, never iCloud Drive; git\'s refusals become a hint', () => {
    const home = '/Users/kim'
    assert.equal(cloneBase('~/one-repos', home), '/Users/kim/one-repos')
    assert.equal(cloneBase('/srv/repos', home), '/srv/repos')
    assert.ok(typeof cloneBase('one-repos', home) !== 'string')
    assert.match((cloneBase('~/Library/Mobile Documents/com~apple~CloudDocs/repos', home, 'darwin') as { error: string }).error, /iCloud/)
    assert.match(cloneHint('git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'), /SSH key was refused/)
    assert.match(cloneHint("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled"), /credential helper/)
    assert.match(cloneHint('remote: The project you were looking for could not be found'), /does not know this project/)
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

describe('ZIP import: no .git in any spelling, nothing in the ZIP runs', () => {
  /** A script outside every repository that leaves `<name>` in `dir` when something runs it. */
  const tripwire = (dir: string, name: string) => {
    const file = join(dir, `${name}.sh`)
    writeFileSync(file, `#!/bin/sh\ntouch '${join(dir, name)}'\nexit 0\n`)
    chmodSync(file, 0o755)
    return file
  }
  const zipFile = (files: Record<string, string>) => {
    const f = join(tempDir('zip'), 'upload.zip')
    writeFileSync(f, Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))))
    return f
  }
  const hookDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('one-import-hooks-')).length
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

  test('git\'s is_ntfs_dotgit / is_hfs_dotgit: case, trailing dots and spaces, NTFS streams, GIT~1, HFS+ ignorable code points', () => {
    for (const name of ['.git', '.GIT', '.Git', '.gIT', '.git.', '.git ', '.git. . ', '.git::$INDEX_ALLOCATION', '.git:x', 'git~1', 'GIT~1', 'Git~2', 'git~1.', '.g\u200cit', '.gi\u200dt', '\u200e.git', '.git\u200f', '.g\u202ait', '.\u202bgit', '.gi\u202ct', '.g\u202dit', '.git\u202e', '.g\u206ait', '.\u206bGIT', '.gi\u206ct', '.g\u206dit', '.g\u206eit', '.git\u206f', '\ufeff.git', '.G\u200cI\ufeffT. '])
      assert.ok(isDotGit(name), JSON.stringify(name))
    for (const name of ['.github', '.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', 'git', '.git-hooks', '.gitx', 'x.git', '..git', ' .git', 'git~', 'git~x', '.g\u200bit', '.gıt', 'ｇit'])
      assert.ok(!isDotGit(name), JSON.stringify(name))
  })

  test('entries: every .git variant left out; ":", control characters, device names and dot-only names refuse the ZIP; usual names kept', () => {
    const dropped = ['p/.GIT/config', 'p/.Git/hooks/pre-commit', 'p/.git/config', '.GIT/config', 'p/GIT~1/config', 'p/git~1/hooks/post-checkout', 'p/.git./config', 'p/.git /config', 'p/.git. . /HEAD', 'p/.g\u200cit/config', 'p/\ufeff.git/config', 'p/.gi\u202et/config', 'p/.git\u206f/config', 'p/sub/deep/.GIT/config', 'p/.GIT', 'p/GIT~1']
    for (const n of dropped) assert.equal(entryPath(n), null, JSON.stringify(n))
    const why = (n: string) => {
      const r = entryPath(n)
      assert.ok(isUnsafe(r), JSON.stringify(n))
      return r.unsafe
    }
    for (const n of ['p/.git::$INDEX_ALLOCATION/config', 'p/.git:stream', 'p/a:b.txt', 'p/x/file.txt:Zone.Identifier']) assert.match(why(n), /":"/, n)
    for (const n of ['p/a\nb.txt', 'p/a\rb', 'p/\u001b[31mred', 'p/tab\there', 'p/del\u007f', 'a\0b']) assert.match(why(n), /control character/, JSON.stringify(n))
    for (const n of ['con', 'p/CON', 'p/nul.txt', 'p/NUL.tar.gz', 'p/aux.c', 'p/Prn.log', 'p/com1', 'p/COM9.txt', 'p/com0', 'p/lpt1', 'p/LPT9.dat', 'p/com\u00b9', 'p/lpt\u00b3.x', 'p/con .txt', 'p/nul.', 'p/conin$', 'p/CONOUT$.txt', 'p/aux/x.c']) assert.match(why(n), /device/, n)
    for (const n of ['p/.. /x', 'p/... /x', 'p/..\u200c/x', 'p/ /x', 'p/. /x', '../evil.txt', '/etc/passwd', 'C:/Windows/x', '\\\\server\\share\\x', '']) assert.match(why(n), /outside its folder/, JSON.stringify(n))
    const kept = ['p/.github/workflows/ci.yml', 'p/.gitignore', 'p/.gitattributes', 'p/.gitmodules', 'p/git/notes.txt', 'p/.git-blame-ignore-revs', 'p/console.log', 'p/com10.txt', 'p/lpt.txt', 'p/auxiliary.c', 'p/connect/a.ts', 'p/naïve café.md', 'p/a b/c d.txt', 'p/..foo', 'p/foo..', 'p/x.', 'p/\u0084ber.txt']
    for (const n of kept) assert.equal(entryPath(n), n, JSON.stringify(n))
    assert.equal(entryPath('p\\.GIT\\config'), null)
    assert.equal(entryPath('p\\src\\a.ts'), 'p/src/a.ts')
  })

  test('the second guard finds a .git spelling the file system kept — at any depth — and the file system\'s own ".git"', () => {
    const clean = tempDir('guard')
    mkdirSync(join(clean, 'src', '.github'), { recursive: true })
    writeFileSync(join(clean, 'src', '.gitignore'), 'x\n')
    assert.equal(dotGitIn(clean), null)
    const top = tempDir('guard')
    mkdirSync(join(top, '.GIT'))
    assert.equal(dotGitIn(top), join(top, '.GIT'))
    const deep = tempDir('guard')
    mkdirSync(join(deep, 'a', 'b', 'GIT~1'), { recursive: true })
    assert.equal(dotGitIn(deep), join(deep, 'a', 'b', 'GIT~1'))
    const file = tempDir('guard')
    mkdirSync(join(file, 'vendor'))
    writeFileSync(join(file, 'vendor', '.git'), 'gitdir: ../../elsewhere\n')
    assert.equal(dotGitIn(file), join(file, 'vendor', '.git'))
  })

  test('a crafted ZIP: .GIT/config with core.fsmonitor, .Git/hooks, the exact .git/config and more spellings — imported without any, nothing ran', async () => {
    const trap = tempDir('trap')
    const fsmonitor = tripwire(trap, 'fsmonitor-ran')
    const hook = `#!/bin/sh\ntouch '${join(trap, 'hook-ran')}'\n`
    const config = `[core]\n\tfsmonitor = ${fsmonitor}\n\thooksPath = .Git/hooks\n[filter "x"]\n\tclean = ${fsmonitor}\n`
    const base = tempDir('clones')
    const before = hookDirs()
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
    assert.equal(hookDirs(), before, 'the empty hooks folder is removed')
  })

  test('the git steps never run a planted .git\'s fsmonitor or hooks (a .GIT a case-insensitive disk made .git); the identity still comes from git config', async () => {
    const trap = tempDir('trap')
    const dir = join(tempDir('planted'), 'proj')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.js'), 'module.exports = 1\n')
    sh(dir, 'init', '-q')
    const evilHooks = join(trap, 'evil-hooks')
    mkdirSync(evilHooks)
    for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-index-change', 'reference-transaction']) {
      for (const at of [evilHooks, join(dir, '.git', 'hooks')]) {
        writeFileSync(join(at, name), `#!/bin/sh\ntouch '${join(trap, `${name}-ran`)}'\nexit 0\n`)
        chmodSync(join(at, name), 0o755)
      }
    }
    const fsmonitor = tripwire(trap, 'fsmonitor-ran')
    sh(dir, 'config', 'core.fsmonitor', fsmonitor)
    sh(dir, 'config', 'core.hooksPath', evilHooks)
    sh(dir, 'config', 'user.email', 'kim@example.invalid')
    sh(dir, 'config', 'user.name', 'Kim Person')
    const before = hookDirs()
    await asPerson('', () => commitImport(dir, 'legacy.zip'))
    assert.equal(sh(dir, 'log', '-1', '--format=%s|%an|%ae').trim(), 'Import legacy.zip|Kim Person|kim@example.invalid')
    assert.equal(sh(dir, 'branch', '--show-current').trim(), 'main')
    assert.deepEqual(readdirSync(trap).sort(), ['evil-hooks', 'fsmonitor-ran.sh'], 'nothing ran')
    assert.equal(hookDirs(), before)
    // the planted config was live: plain git runs it
    sh(dir, 'commit', '-q', '--allow-empty', '-m', 'probe')
    assert.ok(existsSync(join(trap, 'pre-commit-ran')) && existsSync(join(trap, 'post-commit-ran')), 'the probe commit ran the planted hooks')
  })

  test('a usual project imports with one commit; a refused or failed import leaves nothing behind', async () => {
    const base = tempDir('clones')
    const files = { 'shop-main/README.md': '# Shop\n', 'shop-main/src/index.ts': 'export {}\n', 'shop-main/.github/workflows/ci.yml': 'on: push\n', 'shop-main/.gitignore': 'dist/\n', 'shop-main/dist/x.js': '1\n' }
    // the person's own identity from their global git config
    const ok = await asPerson('[user]\n\tname = Kim Global\n\temail = kim.global@example.invalid\n', () => importZip(zipFile(files), base, 'shop', 'shop-main.zip'))
    assert.equal(ok.dir, join(base, 'shop'))
    assert.deepEqual(sh(ok.dir, 'ls-files').trim().split('\n'), ['.github/workflows/ci.yml', '.gitignore', 'README.md', 'src/index.ts'])
    assert.equal(sh(ok.dir, 'rev-list', '--count', 'HEAD').trim(), '1')
    assert.equal(sh(ok.dir, 'log', '-1', '--format=%s|%an|%ae').trim(), 'Import shop-main.zip|Kim Global|kim.global@example.invalid')
    assert.equal(sh(ok.dir, 'status', '--porcelain').trim(), '')

    for (const [files, why] of [
      [{ 'p/a.txt': 'a', 'p/aux.c': 'int x;' }, /device.*\(p\/aux\.c\)/],
      [{ 'p/a.txt': 'a', 'p/.git::$INDEX_ALLOCATION/config': '[core]' }, /":"/],
      [{ 'p/a.txt': 'a', 'p/evil\u001b]0;x\u0007.txt': 'x' }, /control character \(p\/evil\?\]0;x\?\.txt\)/],
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
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { PATH: `${bin}:${process.env.PATH}`, ONE_WORKER_CLONE_LOCAL: '1', FAKE_REMOTE: created, FAKE_LOG: glabLog } })
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
    assert.ok(cloned.repos.some((r: { path: string; ticked: boolean }) => r.path === dir && !r.ticked))
    assert.equal(cloned.cloneDir, '~/work/clones')
    // the same address again: already there, added
    await call('/setup/api/clone', { token, body: { url: remote, dir: '~/work/clones' } })
    assert.equal((await jobDone(token)).clone.done, dir)

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
      '__MACOSX/legacy-app/._README.md': strToU8('x'),
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

describe('GitLab and own MCP servers', () => {
  test('a GitLab remote gets a merge request with glab; without it (or switched off) the new-merge-request link', async () => {
    const dir = plainRepo(join(tempDir('mr'), 'demo'), { 'README.md': '# d\n' }, 'git@gitlab.example.com:acme/demo.git')
    const repo = { path: dir, remote: 'origin', baseBranch: 'main', pr: 'gh' } as RepoConfig
    const path = process.env.PATH
    process.env.PATH = `${fakeTools()}:${path}`
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
