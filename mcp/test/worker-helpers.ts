/**
 * Test helpers for one-worker: temp git repos with a local bare remote (never a real host), an isolated
 * git config (no global settings, no signing), the fake Claude Code CLI, and a fake One tab that speaks
 * the worker protocol over a plain WebSocket client. The same on Windows: there a child gets the whole environment,
 * fakes are npm-style .cmd shims (fakeBin), directory links are junctions and the temp folder is its long form.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { WORKER_SUBPROTOCOL, type StageOutcome, type TabMessage, type TaskPayload, type WorkerMessage, type WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { envGet, killTree, pathKey } from '../src/worker/exec.ts'
import { IS_WIN, childEnv, waitFor } from './helpers.ts'

export { IS_WIN, childEnv }

export const WORKER_BUNDLE = fileURLToPath(new URL('../../public/mcp/one-worker.mjs', import.meta.url))
export const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))

// Windows: the long form (C:\Users\RUNNER~1\… → C:\Users\runneradmin\…), as git, realpath.native and the worker see it
const root = (IS_WIN ? realpathSync.native : realpathSync)(mkdtempSync(join(tmpdir(), 'one-worker-test-')))
const emptyConfig = join(root, 'gitconfig')
writeFileSync(emptyConfig, '')
/** git (here and in every child) without the machine's global or system config */
export const GIT_ENV = { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test Person', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test Person', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
Object.assign(process.env, GIT_ENV)

/** Windows may still hold a file a killed child had open for a moment: retried there, and a leftover temp folder is no failure. */
export const cleanupAll = () => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: IS_WIN ? 10 : 0, retryDelay: 200 })
  } catch (e) {
    if (!IS_WIN) throw e
    process.stderr.write(`# temp folder left behind: ${(e as Error).message}\n`)
  }
}

/** HOME for this code, USERPROFILE for Windows' os.homedir() — a child's home folder on every OS. */
export const homeEnv = (home: string) => ({ HOME: home, USERPROFILE: home })

/** A path as sh scripts and git config values read it: Windows keeps the drive and writes "/" (Git for Windows' sh
 * and its config reader take "\" as an escape); unchanged elsewhere. */
export const slashPath = (p: string) => (IS_WIN ? p.replace(/\\/g, '/') : p)

/** A link to a folder: a junction on Windows (no admin rights or Developer Mode needed; Node and the worker see a link). */
export const linkDir = (target: string, link: string) => symlinkSync(target, link, IS_WIN ? 'junction' : undefined)

/** `./name` as the scrubber leaves a file in the worktree: `.\name` on Windows (the path Claude Code wrote, "." for the worktree). */
export const dotPath = (name: string) => (IS_WIN ? `.\\${name.replace(/\//g, '\\')}` : `./${name}`)

/** A shell command (sh, or cmd.exe on Windows — Claude Code's hooks) that creates `file`: node, not touch. */
export const touchCommand = (file: string) => `"${process.execPath}" -e "require('fs').writeFileSync(process.argv[1], '')" "${file}"`

/** The short (8.3) forms of the home folder this computer writes (TEMP = C:\Users\RUNNER~1\AppData\Local\Temp on a runner). */
function shortHomes(): string[] {
  if (!IS_WIN) return []
  const home = homedir().toLowerCase()
  const out = new Set<string>()
  for (const key of ['TEMP', 'TMP', 'LOCALAPPDATA']) {
    const v = envGet(process.env, key) ?? ''
    const parts = v.split(/[\\/]/)
    const i = parts.findIndex((p) => p.includes('~'))
    if (i < 1) continue
    const short = parts.slice(0, i + 1).join('\\')
    try {
      if (realpathSync.native(short).toLowerCase() === home) out.add(short)
    } catch {
      /* not there */
    }
  }
  return [...out]
}

/**
 * Every way `p` can be written in what the worker sends — as is and JSON-escaped; on Windows also with "/", as MSYS
 * /c/…, percent-encoded, under the home folder's 8.3 name, in any case (NTFS ignores it). A check for the raw form only
 * would pass on Windows, where a path in JSON reads C:\\Users\\….
 */
export function pathForms(p: string): string[] {
  const forms = new Set<string>([p, JSON.stringify(p).slice(1, -1)])
  if (!IS_WIN) return [...forms]
  const longs = [p]
  const home = homedir()
  if (p.toLowerCase().startsWith(home.toLowerCase())) for (const s of shortHomes()) longs.push(s + p.slice(home.length))
  for (const l of longs) {
    const fwd = l.replace(/\\/g, '/')
    for (const f of [l, fwd, l.replace(/\\/g, '\\\\'), encodeURI(fwd)]) forms.add(f)
    const drive = /^([A-Za-z]):\//.exec(fwd)
    if (drive) for (const pre of ['/', '/cygdrive/', '/mnt/']) forms.add(`${pre}${drive[1]!.toLowerCase()}${fwd.slice(2)}`)
  }
  return [...forms].map((f) => f.toLowerCase())
}

/** The first of `paths` (in any of its forms) or `literals` found in `text` — null when none. */
export function leakIn(text: string, paths: string[], literals: string[] = []): string | null {
  const t = IS_WIN ? text.toLowerCase() : text
  for (const p of paths) for (const f of pathForms(p)) if (t.includes(f)) return `${p} (as ${f})`
  for (const l of literals) if (text.includes(l)) return l
  return null
}

/** Where `name` lives on this computer's PATH (Windows: with PATHEXT's .exe / .cmd …) — the git the runner has, not /usr/bin's. */
export function onPath(name: string): string {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', '.com'] : ['']
  for (const dir of (envGet(process.env, 'PATH') ?? '').split(delimiter).filter(Boolean))
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return join(dir, name + ext)
  throw new Error(`${name} is not on PATH`)
}

/** A fresh empty folder inside this run's temp root (removed by cleanupAll). */
export const tempDir = (prefix = 'tmp') => mkdtempSync(join(root, `${prefix}-`))

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export interface TempRepo {
  dir: string
  path: string
  remote: string
  worktrees: string
  /** another clone, to push changes to the base like a colleague */
  other: () => string
}

let n = 0
/** A repo with README.md, check.mjs (fails when feature.txt says BROKEN) and a bare remote "origin". */
export function makeRepo(): TempRepo {
  const dir = join(root, `case${++n}`)
  mkdirSync(dir, { recursive: true })
  const remote = join(dir, 'remote.git')
  const path = join(dir, 'repo')
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote], { env: { ...process.env, ...GIT_ENV } })
  execFileSync('git', ['init', '--quiet', '-b', 'main', path], { env: { ...process.env, ...GIT_ENV } })
  writeFileSync(join(path, 'README.md'), '# Demo\n\nA line.\n')
  writeFileSync(join(path, 'check.mjs'), "import { existsSync, readFileSync } from 'node:fs'\nconst f = existsSync('feature.txt') ? readFileSync('feature.txt', 'utf8') : ''\nif (f.includes('BROKEN')) { console.log('FAIL feature.txt is broken'); process.exit(1) }\nconsole.log('PASS 1 check')\n")
  sh(path, 'add', '-A')
  sh(path, 'commit', '--quiet', '-m', 'initial')
  sh(path, 'remote', 'add', 'origin', remote)
  sh(path, 'push', '--quiet', '-u', 'origin', 'main')
  const worktrees = join(dir, 'wt')
  return {
    dir,
    path,
    remote,
    worktrees,
    other: () => {
      const o = join(dir, `other${Date.now()}`)
      execFileSync('git', ['clone', '--quiet', remote, o], { env: { ...process.env, ...GIT_ENV } })
      return o
    },
  }
}

export function repoEntry(r: TempRepo, extra: Record<string, unknown> = {}) {
  return { name: 'demo', path: r.path, baseBranch: 'main', remote: 'origin', branchPrefix: 'one/', worktreeDir: r.worktrees, testCommand: [process.execPath, 'check.mjs'], pr: 'none', push: true, claude: { maxTurns: 10 }, ...extra }
}

/** A config file for the worker (in its own folder: worker-state.json goes next to it). */
export function writeConfig(r: TempRepo, config: Record<string, unknown>): string {
  const dir = join(r.dir, `cfg${Date.now()}${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'worker.json')
  writeFileSync(file, `// test config\n${JSON.stringify(config, null, 2)}\n`)
  return file
}

export interface StartedWorker {
  child: ChildProcess
  stderr: () => string
  stop: () => Promise<void>
}

export async function startWorker(configFile: string, env: Record<string, string> = {}): Promise<StartedWorker> {
  return spawnWorker({ bundle: WORKER_BUNDLE, args: ['--config', configFile], env })
}

export interface SpawnedWorker extends StartedWorker {
  stdout: () => string
  write: (text: string) => void
}

/** A child's base environment: Windows the whole one (node.exe cannot open a socket without SystemRoot; ComSpec, PATHEXT,
 * TEMP …), elsewhere PATH and HOME as before. */
export const baseEnv = (): Record<string, string | undefined> => (IS_WIN ? { ...process.env } : { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' })

/** Start a worker file (the bundle, or a download with a preset) — never opens a real browser. */
export async function spawnWorker(opts: { bundle: string; args?: string[]; env?: Record<string, string>; home?: string; stdin?: boolean; cwd?: string }): Promise<SpawnedWorker> {
  if (!IS_WIN) chmodSync(FAKE_CLAUDE, 0o755)
  const child = spawn(process.execPath, [opts.bundle, ...(opts.args ?? [])], {
    env: childEnv(baseEnv(), opts.home ? homeEnv(opts.home) : {}, GIT_ENV, { CLAUDE_BIN: FAKE_CLAUDE, ONE_WORKER_HEARTBEAT_MS: '400', ONE_WORKER_BROWSER: 'none' }, opts.env ?? {}),
    stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  })
  let err = ''
  let out = ''
  child.stderr?.on('data', (d: Buffer) => {
    err += d.toString()
  })
  child.stdout?.on('data', (d: Buffer) => {
    out += d.toString()
  })
  await waitFor(() => /ready on ws:|ready \(cloud\)|in use|cannot listen/.test(err) || child.exitCode !== null, 8000, () => err)
  return {
    child,
    stderr: () => err,
    stdout: () => out,
    write: (text) => void child.stdin?.write(text),
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        // Windows has no SIGTERM to catch: the whole tree goes (taskkill /T), so no git or fake CLI keeps a file or the port
        if (IS_WIN) void killTree(child, 'win32')
        else child.kill('SIGTERM')
      }),
  }
}

/** A copy of the bundle as One's download makes it: the preset line right after the shebang. */
export function presetBundle(preset: Record<string, unknown>): string {
  const src = readFileSync(WORKER_BUNDLE, 'utf8')
  const nl = src.indexOf('\n')
  const file = join(tempDir('download'), 'one-worker.mjs')
  writeFileSync(file, `${src.slice(0, nl + 1)}globalThis.ONE_WORKER_PRESET = ${JSON.stringify(preset)}\n${src.slice(nl + 1)}`)
  return file
}

/** A program that "opens" the setup page: it appends the address to a file (ONE_WORKER_BROWSER). */
export function fakeOpener(): { program: string; urls: () => string[] } {
  const dir = tempDir('opener')
  const log = join(dir, 'opened.txt')
  const program = join(dir, 'open.mjs')
  // started by its path: Windows reads the .mjs as a Node script (exec.ts), elsewhere the line above makes it one
  writeFileSync(program, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n')\n`)
  if (!IS_WIN) chmodSync(program, 0o755)
  return { program, urls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) }
}

/** npm's cmd-shim (v6 / v7) for `target` (relative to the shim's folder, backslashes) — the shape npm writes on Windows. */
export const cmdShimV7 = (target: string) =>
  ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '', `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`, ''].join('\r\n')

/**
 * A fake program `name` in `dir` written in JavaScript, started the way this OS starts an installed CLI: Windows —
 * `<name>.mjs` + npm's `<name>.cmd` shim (the worker reads it); else `<name>.mjs` + an executable `<name>` (sh). Returns dir.
 */
export function fakeBin(dir: string, name: string, js: string): string {
  mkdirSync(dir, { recursive: true })
  const script = join(dir, `${name}.mjs`)
  writeFileSync(script, js)
  if (process.platform === 'win32') writeFileSync(join(dir, `${name}.cmd`), cmdShimV7(`${name}.mjs`))
  else {
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    writeFileSync(join(dir, name), `#!/bin/sh\nexec ${q(process.execPath)} ${q(script)} "$@"\n`)
    chmodSync(join(dir, name), 0o755)
  }
  return dir
}

/** `dir` FIRST in PATH (under the key this environment uses: "Path" on Windows) — for a child's env. */
export function pathWith(dir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const rest = envGet(env, 'PATH') ?? ''
  return { [pathKey(env)]: rest ? `${dir}${delimiter}${rest}` : dir }
}

/** A git repo at `dir` with one commit (and optionally a remote URL — never contacted). */
export function plainRepo(dir: string, files: Record<string, string> = { 'README.md': '# x\n' }, remoteUrl?: string): string {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { env: { ...process.env, ...GIT_ENV } })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '--quiet', '-m', 'initial')
  if (remoteUrl) sh(dir, 'remote', 'add', 'origin', remoteUrl)
  return dir
}

export const WS_LOCAL: WorkspaceRef = { id: 'local:test-ws-1', name: 'Test', kind: 'local', readOnly: false }

type Req = Extract<WorkerMessage, { type: 'req' }>

/** The One tab, played by a test: answers `next` from a queue, records everything the worker sends. */
export class FakeTab {
  ws: WebSocket
  messages: WorkerMessage[] = []
  raw: string[] = []
  closed: { code: number } | null = null
  queue: TaskPayload[] = []
  outcomes: Array<{ taskId: string; stageId: string; outcome: StageOutcome }> = []
  heartbeats = 0
  private seq = 0
  private pending = new Map<string, (m: Extract<WorkerMessage, { type: 'res' }>) => void>()

  constructor(ws: WebSocket) {
    this.ws = ws
    ws.on('message', (d) => {
      const text = d.toString()
      this.raw.push(text)
      const msg = JSON.parse(text) as WorkerMessage
      this.messages.push(msg)
      if (msg.type === 'req') this.answer(msg)
      if (msg.type === 'res') this.pending.get(msg.id)?.(msg)
    })
    ws.on('close', (code) => {
      this.closed = { code }
    })
  }

  static connect(port: number, opts: { origin?: string | null; protocol?: string } = {}): Promise<FakeTab> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, [opts.protocol ?? WORKER_SUBPROTOCOL], opts.origin === null ? {} : { origin: opts.origin ?? 'http://127.0.0.1:5350' })
    const tab = new FakeTab(ws)
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(tab))
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
      ws.once('error', reject)
    })
  }

  send(msg: TabMessage) {
    this.ws.send(JSON.stringify(msg))
  }

  hello(workspace: WorkspaceRef = WS_LOCAL, pair?: string) {
    this.send({ type: 'hello', app: 'one', version: 'test', workspace, ...(pair !== undefined ? { pair } : {}) })
  }

  private answer(msg: Req) {
    const reply = (result: unknown) => this.send({ type: 'res', id: msg.id, ok: true, result })
    if (msg.op === 'next') {
      // a task of a repo the worker asked for; else the first one (a tab that hands out the wrong repo)
      const match = this.queue.findIndex((t) => msg.repos.includes(t.repo))
      const i = match >= 0 ? match : this.queue.length ? 0 : -1
      const task = i >= 0 ? this.queue.splice(i, 1)[0]! : null
      return reply({ task })
    }
    if (msg.op === 'heartbeat') {
      this.heartbeats++
      return reply({ ok: true })
    }
    if (msg.op === 'finish') {
      this.outcomes.push({ taskId: msg.taskId, stageId: msg.stageId, outcome: msg.outcome })
      return reply({ ok: true })
    }
  }

  /** Hand out a task and wait for its outcome. */
  async run(task: TaskPayload, ms = 20_000): Promise<StageOutcome> {
    const before = this.outcomes.length
    this.queue.push(task)
    this.send({ type: 'nudge' })
    await waitFor(() => this.outcomes.length > before, ms, () => JSON.stringify(this.messages.slice(-5)))
    return this.outcomes[this.outcomes.length - 1]!.outcome
  }

  /** A request to the worker (stop / git verbs). */
  request(body: Record<string, unknown>, ms = 20_000): Promise<Extract<WorkerMessage, { type: 'res' }>> {
    const id = `t${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer')), ms)
      this.pending.set(id, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      this.ws.send(JSON.stringify({ type: 'req', id, ...body }))
    })
  }

  next<T extends WorkerMessage['type']>(type: T, ms = 5000): Promise<Extract<WorkerMessage, { type: T }>> {
    return waitFor(() => this.messages.some((m) => m.type === type), ms, () => JSON.stringify(this.messages)).then(() => this.messages.find((m) => m.type === type) as Extract<WorkerMessage, { type: T }>)
  }

  close() {
    this.ws.close()
  }
}

let taskSeq = 0
export function task(stage: Partial<TaskPayload['stage']> & Pick<TaskPayload['stage'], 'kind'>, extra: Partial<TaskPayload> = {}): TaskPayload {
  const id = extra.id ?? `tsk${++taskSeq}abcdef`
  return {
    id,
    title: 'Add the feature file',
    repo: 'demo',
    stage: { id: `st-${stage.kind}`, name: stage.kind[0]!.toUpperCase() + stage.kind.slice(1), instructions: '', permissionMode: stage.kind === 'plan' ? 'plan' : 'acceptEdits', maxTurns: 10, gitAction: null, ...stage, model: stage.model ?? null },
    text: 'Goal: a feature file.\n\n## Acceptance criteria\n- [ ] feature.txt exists',
    rework: null,
    answers: [],
    branch: null,
    spent: 0,
    summary: null,
    trusted: true,
    ...extra,
  }
}
