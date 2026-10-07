/**
 * one-worker: new repositories from the local setup page — clone addresses checked (no tokens in https
 * addresses, no ext:: / option-like ones), a clone from a local bare remote (test seam ONE_WORKER_CLONE_LOCAL),
 * the person's GitLab / GitHub projects from fake glab / gh tools, a ZIP of source code unpacked into a fresh
 * repository (its own .git folders, __MACOSX and .DS_Store left out; a path outside the folder refuses the ZIP),
 * the clone folder and own MCP servers written by Save, GitLab merge requests with glab. Nothing leaves the machine.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { after, afterEach, describe, test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import type { WorkerMessage, WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { cloneBase, cloneHint, folderName, parseCloneUrl } from '../src/worker/clone.ts'
import { entryPath, isUnsafe } from '../src/worker/zipimport.ts'
import { openPr } from '../src/worker/git.ts'
import { sanitizeConfig, type RepoConfig } from '../src/worker/config.ts'
import { buildPrompt } from '../src/worker/run.ts'
import { waitFor } from './helpers.ts'
import { FakeTab, cleanupAll, makeRepo, plainRepo, presetBundle, sh, spawnWorker, task, tempDir, type SpawnedWorker } from './worker-helpers.ts'

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

describe('the setup page: clone, projects, ZIP import, own MCP servers', () => {
  test('clone a repository, pick from glab / gh projects, import a ZIP as a new repository, refuse a ZIP that escapes; Save keeps the clone folder and the MCP servers', async () => {
    const home = tempDir('home')
    const bin = fakeTools()
    const remote = makeRepo().remote
    worker = await spawnWorker({ bundle: presetBundle(PRESET), home, env: { PATH: `${bin}:${process.env.PATH}`, ONE_WORKER_CLONE_LOCAL: '1' } })
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
      'legacy-app/src/billing.js': strToU8('module.exports = (a, b) => a + b\n'),
      'legacy-app/.git/config': strToU8('[core]\n\tfsmonitor = touch pwned\n'),
      'legacy-app/.git/hooks/post-commit': strToU8('#!/bin/sh\ntouch pwned\n'),
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
    assert.deepEqual(readdirSync(app).sort(), ['.git', 'README.md', 'src'])
    assert.ok(!readFileSync(join(app, '.git', 'config'), 'utf8').includes('fsmonitor'))
    assert.ok(!existsSync(join(app, '.git', 'hooks', 'post-commit')))
    assert.equal(sh(app, 'log', '-1', '--format=%s').trim(), 'Import legacy-app.zip')
    assert.equal(sh(app, 'branch', '--show-current').trim(), 'main')
    assert.equal(sh(app, 'status', '--porcelain').trim(), '')
    assert.ok(!existsSync(join(home, 'pwned')) && !existsSync(join(app, 'pwned')))

    // a ZIP that reaches outside its folder: refused as a whole, nothing written, no temp folder left
    const evil = Buffer.from(zipSync({ 'ok.txt': strToU8('fine'), '../evil.txt': strToU8('escaped') }))
    await call('/setup/api/import?name=evil.zip', { token, raw: evil, type: 'application/zip' })
    const refused = await jobDone(token)
    assert.match(refused.clone.error, /outside its folder/)
    assert.ok(!existsSync(join(home, 'work', 'evil.txt')) && !existsSync(join(home, 'work', 'clones', 'evil')))
    assert.deepEqual(readdirSync(join(home, 'work', 'clones')).filter((n) => n.startsWith('.one-import')), [])

    // Save: the clone with an own MCP server, the imported repo; a bad MCP name is refused
    const pick = (mcp: string) => ({ repos: [{ path: dir, name: 'billing', baseBranch: 'main', test: '', push: false, pr: 'none', maxUsdPerTask: null, mcp }, { path: app, name: 'legacy-app', baseBranch: 'main', test: 'node --test', push: false, pr: 'none', maxUsdPerTask: null }] })
    assert.equal((await call('/setup/api/save', { token, body: pick('atlas; rm') })).status, 400)
    const saved = await call('/setup/api/save', { token, body: pick('atlas, docs-kb') })
    assert.equal(saved.status, 200, saved.text)
    const file = join(home, '.config', 'one', 'worker.json')
    const text = readFileSync(file, 'utf8')
    assert.match(text, /"cloneDir": "~\/work\/clones"/)
    const written = sanitizeConfig(JSON.parse(text.replace(/^\/\/.*$/gm, '')), file, {}).config
    assert.deepEqual(written.repos.map((r) => [r.name, r.claude.mcpServers]), [['billing', ['atlas', 'docs-kb']], ['legacy-app', []]])
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
    const { config, problems } = sanitizeConfig({ repos: [{ name: 'a', path: '/tmp/a', claude: { mcpServers: ['atlas', 'bad name', 'one-task'] } }] }, '/tmp/cfg/worker.json')
    assert.deepEqual(config.repos[0]!.claude.mcpServers, ['atlas'])
    assert.equal(problems.filter((p) => /mcpServers/.test(p)).length, 2)
    const p = buildPrompt(task({ kind: 'plan' }), config.repos[0]!, 'one/x', 'c0de42')
    assert.match(p, /their own MCP servers: atlas/)
    const none = buildPrompt(task({ kind: 'plan' }), { ...config.repos[0]!, claude: { ...config.repos[0]!.claude, mcpServers: [] } }, 'one/x', 'c0de42')
    assert.ok(!/own MCP servers/.test(none))
  })
})
