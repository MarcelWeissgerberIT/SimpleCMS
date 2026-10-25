import { managedCommand, managedChild, profileDir, redirectInstalled, importWorkerPreset } from './managed.ts'
import { compareDemo } from './demo-compare.ts'
/**
 * one-worker — runs coding tasks from One with Claude Code on this computer (git worktrees, branches,
 * tests, pull requests). Bundled to public/mcp/one-worker.mjs (mcp/build.mjs). Docs: docs/CODING.md.
 *
 *   node one-worker.mjs                      run (config: ~/.config/one/worker.json) — no repos yet: the setup page
 *   node one-worker.mjs setup                run and open the setup page (tick the repos One may work in)
 *   node one-worker.mjs init [--workspace <id>] [--force]   write a commented example config
 *   node one-worker.mjs check                check the config, the repos and Claude Code
 *   node one-worker.mjs task-mcp             (internal) the task tools for Claude Code during a run
 *   --config <file>  another config file (or ONE_WORKER_CONFIG) · --no-browser · --help · --version
 *
 * Downloaded from One (Settings → Coding worker), the file carries a preset right after the shebang
 * (preset.ts): the workspace, the One site, the port and a pairing secret — no config needed for the
 * connection. Its first start finds the git repos below the home folder and opens a local page to tick them
 * (setup.ts); --no-browser (or no browser to open) asks in this terminal instead (checklist.ts).
 *
 * A CLOUD download (one-worker-cloud.mjs, team workspaces) carries a worker token too: it dials the team server
 * instead of waiting for a tab on 127.0.0.1 (cloud.ts), keeps its own config folder
 * (~/.config/one/cloud/<workspace>/), and stops with exit code 2 when the server lets it go for good (token
 * revoked or replaced, member removed) — a service manager should not restart it then (RestartPreventExitStatus=2).
 *
 * --model-host: cloud model host only; no repository setup, scanning or coding repositories.
Environment: CLAUDE_BIN (the Claude Code CLI, default "claude"), ONE_WORKER_PORT, ONE_ORIGINS,
 * ONE_WORKER_BROWSER (a program that opens the setup page, "none" = never), ONE_WORKER_QUIET=1. Logs go to
 * stderr.
 */
import { fileURLToPath } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { resolve } from 'node:path'
import { WORKER_DEFAULT_PORT } from '../../../src/app/features/coding/protocol.ts'
import { SOURCE_WORDS, cloudConfigFile, defaultConfigFile, emptyConfig, initConfig, loadConfig, saveRepos, withPreset, type RepoChoice } from './config.ts'
import { claudeInstallHint, detectClaude, findClaude, gitBash, nativeNotOnPath } from './claude.ts'
import { checkRepo, hasRemote } from './git.ts'
import { TRUST } from './run.ts'
import { STOP_HARD_MS, Worker } from './worker.ts'
import { serveTaskMcp } from './taskmcp.ts'
import { filePreset } from './preset.ts'
import { evaluateHarness } from './harness-eval.ts'
import { localBenchmark } from './local-benchmark.ts'
import { SetupServer } from './setup.ts'
import { factsOf, findRepos, shortPath } from './scan.ts'
import { terminalChecklist } from './checklist.ts'
import { pathId, samePath } from './paths.ts'
import { WorkerWorkspaces } from './workspaces.ts'

let workspaceHost: WorkerWorkspaces | null = null

declare const __VERSION__: string
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const quiet = process.env.ONE_WORKER_QUIET === '1'
/** the last log lines (the setup page shows them) */
const recent: string[] = []
const log = (msg: string) => {
  const line = `${new Date().toTimeString().slice(0, 8)} ${msg}`
  recent.push(line)
  if (recent.length > 200) recent.splice(0, recent.length - 200)
  if (!quiet) process.stderr.write(`[one-worker] ${msg}\n`)
}

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const value = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : null
}
const command = argv.find((a) => !a.startsWith('-') && argv[argv.indexOf(a) - 1] !== '--config' && argv[argv.indexOf(a) - 1] !== '--workspace' && argv[argv.indexOf(a) - 1] !== '--from') ?? 'run'
const fromFile = command === 'install' ? value('--from') : null
const { preset, problem: presetProblem } = fromFile ? { preset: importWorkerPreset(resolve(fromFile)), problem: null } : filePreset()
const cloud = preset?.cloud ? { origin: preset.origin, host: new URL(preset.origin).host } : null
// a cloud worker keeps its own folder: a local worker (and cloud workers of other workspaces) run beside it
const configFile = resolve(value('--config') ?? process.env.ONE_WORKER_CONFIG ?? (preset?.cloud ? cloudConfigFile(preset.workspace) : defaultConfigFile()))
const configOpts = { cloud: !!cloud }
const self = fileURLToPath(import.meta.url)
/** `node <this file> <sub>` as the person types it (quoted when the path has spaces) */
const again = (sub: string) => `node ${/\s/.test(self) ? `"${self}"` : self} ${sub}`
const win = process.platform === 'win32'
/** how to keep a file readable by its owner only (Windows: the account by name — %USERNAME% means nothing to PowerShell) */
const privately = (file: string) => {
  if (!win) return `chmod 600 ${/\s/.test(file) ? `"${file}"` : file}`
  let user = '%USERNAME%'
  try {
    user = userInfo().username || user
  } catch {
    /* no account name: cmd's variable */
  }
  return `icacls "${file}" /inheritance:r /grant:r "${user}:F"`
}
/** Node 20 still runs the worker, untested: its end of life was 30 April 2026 */
const nodeMajor = Number(process.versions.node.split('.')[0])
const NODE_OLD = `Node.js ${process.versions.node} is past its end of life (30 April 2026) and untested with this worker — use Node.js 22 or newer`

if (flag('--version') || flag('-v')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

if (flag('--help') || flag('-h')) {
  process.stdout.write(`one-worker ${VERSION} — compare-demo --repo /path/to/demo --output /path/to/report.json
one-worker ${VERSION} — evaluate --limit 3 --repeats 1 --cases module-integration,resume-package
Coding tasks from One, run by Claude Code on this computer
${
  cloud
    ? `\nThis CLOUD worker was downloaded for the workspace "${preset!.name}" (${preset!.workspace}). It connects out to
${cloud.host} (no port to open) and works for the browser that downloaded it, end-to-end encrypted.
Tasks run while One is open in that browser. The file holds your worker token: keep it private
(${privately(self)}).
Its config, state and worktrees: ${configFile.replace(/[/\\]worker\.json$/, '')}
Exit code 2: the server let this file go for good (token revoked or replaced, membership ended) — download it again.\n`
    : preset
      ? `\nThis file was downloaded for the workspace "${preset.name}" (${preset.workspace}) and is paired with that browser.\n`
      : ''
}
  node one-worker.mjs                         run — keep it running while One should hand out work. The first
                                              start finds your git repos and opens a page to tick them.
  node one-worker.mjs install --from <old>    preserve the JSON pairing of an existing download (never executes it)
  node one-worker.mjs install                 install a fixed, workspace-named starter (Desktop when writable)
  node <installation>/start.cjs update        update code without replacing pairing; waits for running work
  node <installation>/start.cjs rollback      return to the preceding release after current work
  node one-worker.mjs setup                   run and open that page again (change the repos)
  node one-worker.mjs check                   check the config, the repos and Claude Code
  node one-worker.mjs benchmark --agent minimax --limit 3 --budget 1
                                              opt-in synthetic model test; cloud API costs up to the USD budget
  node one-worker.mjs init --workspace <id>   (by hand) write ${defaultConfigFile()}

Options: --config <file> (or ONE_WORKER_CONFIG), --no-browser (no setup page: pick the repos in this
terminal), --force (init: replace the file), --help, --version
--model-host: cloud model host only; no repository setup, scanning or coding repositories.
Environment: CLAUDE_BIN (default "claude"), ONE_WORKER_PORT (default ${preset?.port ?? WORKER_DEFAULT_PORT}), ONE_ORIGINS, ONE_WORKER_BROWSER, ONE_WORKER_QUIET=1
Needs: Node.js 22 or newer, git${win ? ' (Git for Windows — Claude Code needs its Git Bash)' : ''}, the Claude Code CLI (signed in). Docs: docs/CODING.md
`)
  process.exit(0)
}

async function main() {
  const managed = { dir: profileDir(configFile), file: self, config: configFile, preset, version: VERSION, args: ['--no-browser', '--model-host'].filter(flag) }
  if (command === 'install' || ['managed-start','managed-setup','managed-status','managed-update','managed-rollback','managed-cancel'].includes(command)) return managedCommand(managed, command)
  if ((command === 'run' || command === 'setup') && await redirectInstalled(managed, command === 'setup')) return

  if (command === 'compare-demo') {
    const repo = value('--repo'), output = value('--output')
    if (!repo || !output) throw new Error('Use compare-demo --repo /path/to/synthetic-demo --output /path/to/report.json [--model atlas-flow:latest] [--copilot-model auto]')
    const report = await compareDemo({repo,output,model:value('--model')??undefined,copilotModel:value('--copilot-model')??undefined,config:configFile,progress:line=>process.stderr.write(line+'\n')})
    process.stdout.write(JSON.stringify(report,null,2)+'\n')
    process.exitCode = report.results.every((r:{passed:boolean})=>r.passed) ? 0 : 1
    return
  }
  if (command === 'evaluate') {
    const report = await evaluateHarness({ limit: Number(value('--limit') ?? 3), repeats: Number(value('--repeats') ?? 1), ...(value('--cases') ? { cases: value('--cases')!.split(',') } : {}), onCase: (id, ok) => process.stderr.write(`${id}: ${ok ? 'PASS' : 'FAIL'}\n`) })
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exitCode = report.passed === report.total ? 0 : 1
    return
  }
  if (command === 'task-mcp') return serveTaskMcp(VERSION)
  if (command === 'benchmark') {
    const agent = value('--agent') ?? 'local'
    const limit = Number(value('--limit') ?? 3)
    const budgetUsd = Number(value('--budget') ?? 1)
    if (!['local', 'minimax'].includes(agent) || !Number.isInteger(limit) || limit < 1 || limit > 10 || !Number.isFinite(budgetUsd) || budgetUsd < 0.01 || budgetUsd > 25) throw new Error('Use --agent local|minimax, --limit 1…10 and --budget 0.01…25 (USD).')
    const report = await localBenchmark(limit, { agent: agent as 'local' | 'minimax', configFile, budgetUsd })
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exitCode = report.passed === report.total ? 0 : 1
    return
  }

  if (command === 'init') {
    try {
      const file = initConfig(configFile, value('--workspace'), flag('--force'))
      process.stdout.write(`Wrote ${file}\nNext: add your repositories to "repos", then run: ${again('check')}\n`)
      process.exit(0)
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  }

  if (presetProblem) log(`the preset in this file is ignored (${presetProblem}) — download the worker from One again`)
  let loaded
  try {
    // a download from One needs no config file to start: the setup page writes it
    loaded = existsSync(configFile) || !preset ? loadConfig(configFile, process.env, configOpts) : { config: emptyConfig(configFile), problems: [] }
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\nOr download the worker from One (Settings → Coding worker): that file comes ready-paired and asks for your repos itself.\n`)
    process.exit(1)
  }
  const configured = withPreset(loaded.config, preset)
  if (flag('--model-host') && !cloud) throw new Error('--model-host requires a cloud worker downloaded for the target workspace.')
  const config = flag('--model-host') ? { ...configured, repos: [] } : configured
  for (const p of loaded.problems) log(`config: ${p}`)
  for (const n of loaded.notes ?? []) log(`config: ${n}`)

  if (command === 'check') {
    const claude = findClaude()
    const bin = claude.bin
    const caps = await detectClaude(bin)
    const bash = win ? gitBash() : null
    const relay = cloud ? await checkCloud(preset!.origin, preset!.cloud!.token) : null
    const lines = [
      `config     ${configFile}${existsSync(configFile) ? '' : ' (not written yet)'}`,
      ...(cloud
        ? [`download   cloud worker for "${preset!.name}" · paired (end-to-end) with the browser that downloaded it`, `cloud      ${relay!.line}`]
        : preset
          ? [`download   paired with a browser for "${preset.name}" · accepts ${preset.origin}${preset.dev ? ' (+ localhost)' : ''}`]
          : []),
      `workspace  ${config.workspace ?? 'not set — every One tab is refused'}`,
      `port       ${config.port}${cloud ? ' (task tools and the setup page only — One reaches this worker through the team server)' : ''}`,
      `claude     ${caps.found ? `${caps.version ?? 'found'}${caps.via ? ` · ${caps.via === 'node-shim' ? 'npm shim →' : caps.via} ${caps.path}` : ''}${caps.budget ? '' : ' (no --max-budget-usd: limits are checked between stages)'}${claude.from === 'native' ? `\n           ${nativeNotOnPath()}` : ''}` : caps.missing === 'cmd-refused' ? `REFUSED ("${bin}") — a .cmd / .bat the worker cannot read, and it never starts Claude Code through cmd.exe: install it with its native installer, or set CLAUDE_BIN to claude.exe or its cli.js` : `NOT FOUND ("${bin}") — ${claudeInstallHint()}`}`,
      ...(bash ? [`git bash   ${bash.path ? `${bash.path}${bash.from === 'env' ? ' (CLAUDE_CODE_GIT_BASH_PATH)' : ''}` : 'NOT FOUND — Claude Code on Windows needs Git for Windows (its Git Bash): install it, or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe'}`] : []),
      `node       ${process.versions.node}${nodeMajor < 22 ? ` — past its end of life (30 April 2026) and untested: use Node.js 22 or newer` : ''}`,
    ]
    let ok = caps.found && !!config.workspace && config.repos.length > 0 && (relay?.ok ?? true) && (!bash || bash.path !== null)
    let untrusted = 0
    for (const repo of config.repos) {
      try {
        await checkRepo(repo)
        const remote = await hasRemote(repo)
        // the reason first (also when worker.json holds the "false" the setup page wrote for a row it showed off)
        const own = repo.claude.projectSettings ? 'on' : `off (${repo.source ? SOURCE_WORDS[repo.source] : repo.claude.projectSettingsSet ? 'worker.json' : 'default'})`
        if (!repo.claude.projectSettings && repo.source) untrusted++
        lines.push(`repo       ${repo.name}: ok · base ${repo.baseBranch} · ${remote ? `remote ${repo.remote}` : `no remote "${repo.remote}" (push off)`} · tests ${repo.testCommand ? 'yes' : 'none'} · host type ${repo.forge === 'auto' ? 'auto' : repo.forge} · its own Claude Code settings ${own}`)
      } catch (e) {
        ok = false
        lines.push(`repo       ${repo.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (untrusted) lines.push(`           code from elsewhere: Claude Code runs without its own settings. ${TRUST}`)
    if (!config.repos.length) lines.push(preset ? `repos      none yet — run the worker: it opens a page to tick them (${again('setup')})` : `repos      none — add at least one to "repos" (or run: ${again('setup')})`)
    if (loaded.problems.length) ok = false
    process.stdout.write(`${lines.join('\n')}\n${ok ? 'All good.' : 'Fix the lines above.'}\n`)
    process.exit(ok ? 0 : 1)
  }

  if (command !== 'run' && command !== 'setup') {
    process.stderr.write(`Unknown command "${command}". Run with --help.\n`)
    process.exit(1)
  }

  if (nodeMajor < 22) log(NODE_OLD)
  // the file holds a worker token: it should be readable by its owner only
  if (cloud && !win) {
    try {
      if ((statSync(self).mode & 0o077) !== 0) log(`this file holds your worker token — make it private: ${privately(self)}`)
    } catch {
      /* not readable as a file: nothing to say */
    }
  }

  // the setup page lives on the worker's own port; --no-browser: none (the terminal asks instead)
  let worker: Worker | null = null
  const setup = flag('--no-browser') || flag('--model-host')
    ? null
    : new SetupServer({
        draining: () => worker?.isDraining() ?? false,
        configFile,
        port: config.port,
        preset,
        version: VERSION,
        log,
        config: () => worker!.config,
        reload: () => reload(worker!),
        live: () => workspaceHost?.live() ?? worker!.live(),
        workspaces: {
          list: () => workspaceHost?.grants.list() ?? [],
          revoke: async id => { if (!workspaceHost) throw new Error('Workspace hosting is unavailable.'); await workspaceHost.revoke(id) },
        },
      })
  let stopping = false
  /** code 2: a cloud worker the team server let go for good (a service manager must not restart it) */
  const shutdown = async (code = 0) => {
    if (stopping) return
    stopping = true
    log('stopping — ending running tasks')
    // whatever happens: the runs' leftovers and outcomes get STOP_WAIT_MS (worker.ts), then the process ends
    setTimeout(() => process.exit(code), STOP_HARD_MS).unref()
    await workspaceHost?.stop()
    await worker?.stop().catch(() => {})
    process.exit(code)
  }
  const onFatal = (_reason: string, message: string) => {
    log(message)
    void shutdown(2)
  }
  const claude = findClaude()
  if (claude.from === 'native') log(nativeNotOnPath())
  const options = { config, version: VERSION, bin: claude.bin, claudeFrom: claude.from, self, log, setup, recent: () => recent, intake: { configFile, reload: () => reload(worker!) }, onFatal,
    ...(preset && !cloud ? {
      canGrantWorkspace: true,
      workspaceChallenge: (id: string) => ({ workspaceOwner: config.workspace!, workspaceNonce: workspaceHost!.grants.challenge(id) }),
      routeLocal: (socket: import('ws').WebSocket, hello: Extract<import('../../../src/app/features/coding/protocol.ts').TabMessage, { type: 'hello' }>) => workspaceHost!.route(socket, hello),
      routeTask: (token: string, tool: string, args: Record<string, unknown>) => workspaceHost!.task(token, tool, args),
      reserveWork: (repos: string[]) => workspaceHost!.reserve(repos),
      busyRepos: () => workspaceHost!.busyRepos(),
      capacityChanged: () => workspaceHost?.changed(),
    } : {}),
  }
  worker = new Worker(options)
  if (preset && !cloud) workspaceHost = new WorkerWorkspaces(worker, options)
  const up = await worker.start()
  if (up !== 'listening') {
    // 'refused': the line above says why (a port Windows keeps for itself …)
    if (command === 'setup' && up === 'in-use')
      process.stderr.write(
        cloud
          ? `Another one-worker seems to run on port ${config.port}. Stop it first (a new download takes over once it connects), or start this one with ONE_WORKER_PORT=<a free port>.\n`
          : `Another one-worker seems to run on port ${config.port}. Use "Change repositories" in One (Settings → Coding worker) to open its setup page — or stop it first.\n`,
      )
    process.exit(1)
  }

  managedChild({ ready: () => true, drain: () => { worker!.drain(); workspaceHost?.drain() },
    resume: () => { worker!.resume(); workspaceHost?.resume() },
    idle: () => (workspaceHost?.idle() ?? worker!.idle()) && !(setup?.busy ?? false),
    open: async () => setup?.open() ?? { opened: false, reason: 'off' }, shutdown: () => shutdown() })

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGHUP', () => void shutdown())
  // Windows: Ctrl+Break (Ctrl+C arrives as SIGINT)
  if (win) process.on('SIGBREAK', () => void shutdown())

  if (!flag('--model-host') && (command === 'setup' || !config.repos.length)) await pickRepos(worker, setup)
}

/** `check` of a cloud worker: does the team server take this file's token (GET /api/coding/worker)? */
async function checkCloud(origin: string, token: string): Promise<{ ok: boolean; line: string }> {
  const host = new URL(origin).host
  try {
    const res = await fetch(new URL('/api/coding/worker', origin), { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (res.status === 401) return { ok: false, line: `${host} · token refused (revoked, replaced by a newer download, or never started within a day) — download the cloud worker again` }
    if (res.status === 403) return { ok: false, line: `${host} · not allowed: the person this worker belongs to is a viewer or no longer a member` }
    if (res.status === 404) return { ok: false, line: `${host} · this One server has no worker relay (older, or CODING_RELAY=off)` }
    if (!res.ok) return { ok: false, line: `${host} · HTTP ${res.status}` }
    const body = (await res.json()) as { workspace?: { name?: string }; member?: { email?: string }; state?: string; online?: boolean }
    const name = String(body.workspace?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
    return { ok: true, line: `${host} · "${name}" as ${body.member?.email ?? '?'} · ${body.state === 'pending' ? 'new token (its first start activates it)' : 'token active'} · ${body.online ? 'a worker with this token is connected now' : 'not connected now'}` }
  } catch (e) {
    return { ok: false, line: `${host} · cannot reach it: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Read worker.json again and hand it to the running worker. */
async function reload(worker: Worker): Promise<void> {
  const next = loadConfig(configFile, process.env, configOpts)
  for (const p of next.problems) log(`config: ${p}`)
  for (const n of next.notes ?? []) log(`config: ${n}`)
  await worker.reload(withPreset(next.config, preset))
  await workspaceHost?.reload()
}

/** First start (or `setup`): the page in the browser — or, without one, the checklist in this terminal. */
async function pickRepos(worker: Worker, setup: SetupServer | null): Promise<void> {
  if (setup) {
    void setup.scan().catch((e: unknown) => log(`could not look for repositories: ${e instanceof Error ? e.message : String(e)}`))
    const r = await setup.open()
    process.stdout.write(`\nTick your repositories: ${setup.url()}\n${r.opened ? '(opened in your browser)' : '(open it in a browser on this computer)'}\n`)
    // no browser could be opened: ask here too (when someone can answer)
    if (r.opened || !process.stdin.isTTY) return
  }
  const home = homedir()
  process.stdout.write(`\nLooking for git repositories below ${home} …\n`)
  const found = await findRepos({ home })
  const configured = worker.config.repos
  const taken = new Set(configured.map((r) => r.name.toLowerCase()))
  // one row per folder — C:\Code\Shop and c:\code\shop\ are the same on Windows (the configured spelling wins)
  const byId = new Map<string, string>()
  for (const p of [...configured.map((r) => r.path), ...found.paths]) if (!byId.has(pathId(p))) byId.set(pathId(p), p)
  const paths = [...byId.values()]
  const own = (path: string) => configured.find((r) => samePath(r.path, path))
  const facts = (await factsOf(paths, taken, home)).map((f) => {
    const c = own(f.path)
    return c ? { ...f, name: c.name, base: c.baseBranch, test: c.testCommand } : f
  })
  const picked = await terminalChecklist({ input: process.stdin, output: process.stdout, title: preset?.name ?? worker.config.name, repos: facts, ticked: new Set(facts.filter((f) => own(f.path)).map((f) => f.path)) })
  if (!picked) {
    process.stdout.write(`Nothing saved. ${configured.length ? '' : 'One hands this worker no tasks until repos are ticked — '}run ${again('setup')} to pick them.\n`)
    return
  }
  const choices: RepoChoice[] = facts
    .filter((f) => picked.has(f.path))
    .map((f) => {
      const c = own(f.path)
      return c
        ? { path: f.path, name: c.name, baseBranch: c.baseBranch, remote: c.remote, testCommand: c.testCommand, push: c.push, pr: c.pr, maxUsdPerTask: c.maxUsdPerTask }
        : { path: f.path, name: f.name, baseBranch: f.base, remote: f.remote, testCommand: f.test, push: !!f.remote, pr: 'gh', maxUsdPerTask: null }
    })
  const problems = saveRepos(configFile, choices, preset?.workspace ?? worker.config.workspace)
  if (problems.length) {
    process.stdout.write(`Not saved:\n${problems.map((p) => `  ${p}`).join('\n')}\n`)
    return
  }
  process.stdout.write(`Saved ${choices.length} repo(s) to ${shortPath(configFile, home)}: ${choices.map((c) => c.name).join(', ') || 'none'}\n`)
  await reload(worker)
}

// nothing may end the worker with a stack trace: what failed, then exit code 1
main().catch((e: unknown) => {
  process.stderr.write(`[one-worker] stopped: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
