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
 * Environment: CLAUDE_BIN (the Claude Code CLI, default "claude"), ONE_WORKER_PORT, ONE_ORIGINS,
 * ONE_WORKER_BROWSER (a program that opens the setup page, "none" = never), ONE_WORKER_QUIET=1. Logs go to
 * stderr.
 */
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { WORKER_DEFAULT_PORT } from '../../../src/app/features/coding/protocol.ts'
import { defaultConfigFile, emptyConfig, initConfig, loadConfig, saveRepos, withPreset, type RepoChoice } from './config.ts'
import { claudeBin, detectClaude } from './claude.ts'
import { checkRepo, hasRemote } from './git.ts'
import { Worker } from './worker.ts'
import { serveTaskMcp } from './taskmcp.ts'
import { filePreset } from './preset.ts'
import { SetupServer } from './setup.ts'
import { factsOf, findRepos, shortPath } from './scan.ts'
import { terminalChecklist } from './checklist.ts'

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
const command = argv.find((a) => !a.startsWith('-') && argv[argv.indexOf(a) - 1] !== '--config' && argv[argv.indexOf(a) - 1] !== '--workspace') ?? 'run'
const configFile = resolve(value('--config') ?? process.env.ONE_WORKER_CONFIG ?? defaultConfigFile())
const { preset, problem: presetProblem } = filePreset()

if (flag('--version') || flag('-v')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

if (flag('--help') || flag('-h')) {
  process.stdout.write(`one-worker ${VERSION} — coding tasks from One, run by Claude Code on this computer
${preset ? `\nThis file was downloaded for the workspace "${preset.name}" (${preset.workspace}) and is paired with that browser.\n` : ''}
  node one-worker.mjs                         run — keep it running while One should hand out work. The first
                                              start finds your git repos and opens a page to tick them.
  node one-worker.mjs setup                   run and open that page again (change the repos)
  node one-worker.mjs check                   check the config, the repos and Claude Code
  node one-worker.mjs init --workspace <id>   (by hand) write ${defaultConfigFile()}

Options: --config <file> (or ONE_WORKER_CONFIG), --no-browser (no setup page: pick the repos in this
terminal), --force (init: replace the file), --help, --version
Environment: CLAUDE_BIN (default "claude"), ONE_WORKER_PORT (default ${preset?.port ?? WORKER_DEFAULT_PORT}), ONE_ORIGINS, ONE_WORKER_BROWSER, ONE_WORKER_QUIET=1
Needs: Node.js 20+, git, the Claude Code CLI (signed in). Docs: docs/CODING.md
`)
  process.exit(0)
}

const self = fileURLToPath(import.meta.url)

async function main() {
  if (command === 'task-mcp') return serveTaskMcp(VERSION)

  if (command === 'init') {
    try {
      const file = initConfig(configFile, value('--workspace'), flag('--force'))
      process.stdout.write(`Wrote ${file}\nNext: add your repositories to "repos", then run: node ${self} check\n`)
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
    loaded = existsSync(configFile) || !preset ? loadConfig(configFile) : { config: emptyConfig(configFile), problems: [] }
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\nOr download the worker from One (Settings → Coding worker): that file comes ready-paired and asks for your repos itself.\n`)
    process.exit(1)
  }
  const config = withPreset(loaded.config, preset)
  for (const p of loaded.problems) log(`config: ${p}`)

  if (command === 'check') {
    const bin = claudeBin()
    const caps = await detectClaude(bin)
    const lines = [
      `config     ${configFile}${existsSync(configFile) ? '' : ' (not written yet)'}`,
      ...(preset ? [`download   paired with a browser for "${preset.name}" · accepts ${preset.origin}${preset.dev ? ' (+ localhost)' : ''}`] : []),
      `workspace  ${config.workspace ?? 'not set — every One tab is refused'}`,
      `port       ${config.port}`,
      `claude     ${caps.found ? `${caps.version ?? 'found'}${caps.budget ? '' : ' (no --max-budget-usd: limits are checked between stages)'}` : `NOT FOUND ("${bin}")`}`,
    ]
    let ok = caps.found && !!config.workspace && config.repos.length > 0
    for (const repo of config.repos) {
      try {
        await checkRepo(repo)
        const remote = await hasRemote(repo)
        lines.push(`repo       ${repo.name}: ok · base ${repo.baseBranch} · ${remote ? `remote ${repo.remote}` : `no remote "${repo.remote}" (push off)`} · tests ${repo.testCommand ? 'yes' : 'none'}`)
      } catch (e) {
        ok = false
        lines.push(`repo       ${repo.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (!config.repos.length) lines.push(preset ? 'repos      none yet — run the worker: it opens a page to tick them (node one-worker.mjs setup)' : 'repos      none — add at least one to "repos" (or run: node one-worker.mjs setup)')
    if (loaded.problems.length) ok = false
    process.stdout.write(`${lines.join('\n')}\n${ok ? 'All good.' : 'Fix the lines above.'}\n`)
    process.exit(ok ? 0 : 1)
  }

  if (command !== 'run' && command !== 'setup') {
    process.stderr.write(`Unknown command "${command}". Run with --help.\n`)
    process.exit(1)
  }

  // the setup page lives on the worker's own port; --no-browser: none (the terminal asks instead)
  let worker: Worker | null = null
  const setup = flag('--no-browser')
    ? null
    : new SetupServer({
        configFile,
        port: config.port,
        preset,
        version: VERSION,
        log,
        config: () => worker!.config,
        reload: () => reload(worker!),
        live: () => worker!.live(),
      })
  worker = new Worker({ config, version: VERSION, bin: claudeBin(), self, log, setup, recent: () => recent, intake: { configFile, reload: () => reload(worker!) } })
  const up = await worker.start()
  if (up !== 'listening') {
    if (command === 'setup') process.stderr.write(`Another one-worker seems to run on port ${config.port}. Use "Change repositories" in One (Settings → Coding worker) to open its setup page — or stop it first.\n`)
    process.exit(1)
  }

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('stopping — ending running tasks')
    setTimeout(() => process.exit(0), 6000).unref()
    await worker!.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGHUP', () => void shutdown())

  if (command === 'setup' || !config.repos.length) await pickRepos(worker, setup)
}

/** Read worker.json again and hand it to the running worker. */
async function reload(worker: Worker): Promise<void> {
  const next = loadConfig(configFile)
  for (const p of next.problems) log(`config: ${p}`)
  await worker.reload(withPreset(next.config, preset))
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
  const paths = [...new Set([...configured.map((r) => r.path), ...found.paths])]
  const facts = (await factsOf(paths, taken, home)).map((f) => {
    const c = configured.find((r) => r.path === f.path)
    return c ? { ...f, name: c.name, base: c.baseBranch, test: c.testCommand } : f
  })
  const picked = await terminalChecklist({ input: process.stdin, output: process.stdout, title: preset?.name ?? worker.config.name, repos: facts, ticked: new Set(configured.map((r) => r.path)) })
  if (!picked) {
    process.stdout.write(`Nothing saved. ${configured.length ? '' : 'One hands this worker no tasks until repos are ticked — '}run "node ${self} setup" to pick them.\n`)
    return
  }
  const choices: RepoChoice[] = facts
    .filter((f) => picked.has(f.path))
    .map((f) => {
      const c = configured.find((r) => r.path === f.path)
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

void main()
