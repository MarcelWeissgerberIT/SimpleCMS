/**
 * Test helpers for one-worker: temp git repos with a local bare remote (never a real host), an isolated
 * git config (no global settings, no signing), the fake Claude Code CLI, and a fake One tab that speaks
 * the worker protocol over a plain WebSocket client.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { WORKER_SUBPROTOCOL, type StageOutcome, type TabMessage, type TaskPayload, type WorkerMessage, type WorkspaceRef } from '../../src/app/features/coding/protocol.ts'
import { waitFor } from './helpers.ts'

export const WORKER_BUNDLE = fileURLToPath(new URL('../../public/mcp/one-worker.mjs', import.meta.url))
export const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))

const root = realpathSync(mkdtempSync(join(tmpdir(), 'one-worker-test-')))
const emptyConfig = join(root, 'gitconfig')
writeFileSync(emptyConfig, '')
/** git (here and in every child) without the machine's global or system config */
export const GIT_ENV = { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test Person', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test Person', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
Object.assign(process.env, GIT_ENV)

export const cleanupAll = () => rmSync(root, { recursive: true, force: true })

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
  chmodSync(FAKE_CLAUDE, 0o755)
  const child = spawn(process.execPath, [WORKER_BUNDLE, '--config', configFile], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...GIT_ENV, CLAUDE_BIN: FAKE_CLAUDE, ONE_WORKER_HEARTBEAT_MS: '400', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let err = ''
  child.stderr?.on('data', (d: Buffer) => {
    err += d.toString()
  })
  await waitFor(() => /ready on ws:|in use|cannot listen/.test(err) || child.exitCode !== null, 8000, () => err)
  return {
    child,
    stderr: () => err,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
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

  hello(workspace: WorkspaceRef = WS_LOCAL) {
    this.send({ type: 'hello', app: 'one', version: 'test', workspace })
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
    stage: { id: `st-${stage.kind}`, name: stage.kind[0]!.toUpperCase() + stage.kind.slice(1), instructions: '', permissionMode: stage.kind === 'plan' ? 'plan' : 'acceptEdits', maxTurns: 10, gitAction: null, ...stage },
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
