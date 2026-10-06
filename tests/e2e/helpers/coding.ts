/**
 * Coding pipeline e2e helpers: a temp git repo with a local bare remote (never a real host), an isolated git
 * config, the BUILT worker (public/mcp/one-worker.mjs) started with the fake Claude Code CLI
 * (mcp/test/fixtures/fake-claude.mjs — no API is ever called).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKER = fileURLToPath(new URL('../../../public/mcp/one-worker.mjs', import.meta.url))
export const FAKE_CLAUDE = fileURLToPath(new URL('../../../mcp/test/fixtures/fake-claude.mjs', import.meta.url))

export interface CodingRepo {
  root: string
  path: string
  remote: string
  env: NodeJS.ProcessEnv
  git: (cwd: string, ...args: string[]) => string
  cleanup: () => void
}

/** A repo "website" (README, a check script that fails while feature.txt says BROKEN) with a bare remote. */
export function makeCodingRepo(): CodingRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'one-coding-e2e-')))
  const gitcfg = join(root, 'gitconfig')
  writeFileSync(gitcfg, '')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@example.invalid', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@example.invalid' }
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })
  const remote = join(root, 'remote.git')
  const path = join(root, 'website')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'init', '-q', '-b', 'main', path)
  writeFileSync(join(path, 'README.md'), '# Website\n')
  writeFileSync(join(path, 'check.mjs'), "import { existsSync, readFileSync } from 'node:fs'\nconst f = existsSync('feature.txt') ? readFileSync('feature.txt', 'utf8') : ''\nif (f.includes('BROKEN')) { console.log('FAIL feature.txt is broken'); process.exit(1) }\nconsole.log('PASS all checks')\n")
  git(path, 'add', '-A')
  git(path, 'commit', '-qm', 'initial')
  git(path, 'remote', 'add', 'origin', remote)
  git(path, 'push', '-q', '-u', 'origin', 'main')
  return { root, path, remote, env, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** A temp home folder with git repos below it (what the downloaded worker's first start scans). */
export function makeCodingHome(repo: CodingRepo, names: string[]): string {
  const home = join(repo.root, `home-${Date.now()}`)
  for (const name of names) {
    const dir = join(home, 'code', name)
    mkdirSync(dir, { recursive: true })
    repo.git(dir, 'init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"node --test"}}')
    repo.git(dir, 'add', '-A')
    repo.git(dir, 'commit', '-qm', 'initial')
  }
  return home
}

/** A "browser" for the worker's setup page: it writes the address into a file (ONE_WORKER_BROWSER). */
export function fakeOpener(repo: CodingRepo): { program: string; urls: () => string[] } {
  const dir = join(repo.root, `opener-${Date.now()}`)
  mkdirSync(dir)
  const log = join(dir, 'opened.txt')
  const program = join(dir, 'open.mjs')
  writeFileSync(program, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n')\n`)
  chmodSync(program, 0o755)
  return { program, urls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) }
}

/** Start a worker file downloaded from One, as a person would: no config, no flags — a temp home. */
export async function startDownloadedWorker(file: string, home: string, repo: CodingRepo, opener: string): Promise<RunningWorker> {
  chmodSync(FAKE_CLAUDE, 0o755)
  const child = spawn(process.execPath, [file], { env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_GLOBAL: repo.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@example.invalid', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@example.invalid', CLAUDE_BIN: FAKE_CLAUDE, ONE_WORKER_BROWSER: opener }, stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  child.stderr?.on('data', (d: Buffer) => {
    log += d.toString()
  })
  const end = Date.now() + 10_000
  while (!/ready on ws:|in use/.test(log) && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  if (!/ready on ws:/.test(log)) throw new Error(`worker did not start: ${log}`)
  return {
    child,
    log: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
}

export interface RunningWorker {
  child: ChildProcess
  log: () => string
  stop: () => Promise<void>
}

/** Start the built worker bound to `workspace`, serving the repo as "website". */
export async function startCodingWorker(repo: CodingRepo, workspace: string, port: number, extra: Record<string, unknown> = {}): Promise<RunningWorker> {
  chmodSync(FAKE_CLAUDE, 0o755)
  const dir = join(repo.root, `cfg-${Date.now()}`)
  mkdirSync(dir)
  const file = join(dir, 'worker.json')
  writeFileSync(file, JSON.stringify({ workspace, name: 'e2e-box', port, pollSec: 2, repos: [{ name: 'website', path: repo.path, baseBranch: 'main', testCommand: [process.execPath, 'check.mjs'], pr: 'none', maxUsdPerTask: 5 }], ...extra }))
  const child = spawn(process.execPath, [WORKER, '--config', file], { env: { ...repo.env, CLAUDE_BIN: FAKE_CLAUDE }, stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  child.stderr?.on('data', (d: Buffer) => {
    log += d.toString()
  })
  const end = Date.now() + 10_000
  while (!/ready on ws:|in use/.test(log) && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  if (!/ready on ws:/.test(log)) throw new Error(`worker did not start: ${log}`)
  return {
    child,
    log: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
}
