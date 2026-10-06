/**
 * one-worker — runs coding tasks from One with Claude Code on this computer (git worktrees, branches,
 * tests, pull requests). Bundled to public/mcp/one-worker.mjs (mcp/build.mjs). Docs: docs/CODING.md.
 *
 *   node one-worker.mjs                      run (config: ~/.config/one/worker.json)
 *   node one-worker.mjs init [--workspace <id>] [--force]   write a commented example config
 *   node one-worker.mjs check                check the config, the repos and Claude Code
 *   node one-worker.mjs task-mcp             (internal) the task tools for Claude Code during a run
 *   --config <file>  another config file (or ONE_WORKER_CONFIG) · --help · --version
 *
 * Environment: CLAUDE_BIN (the Claude Code CLI, default "claude"), ONE_WORKER_PORT, ONE_ORIGINS,
 * ONE_WORKER_QUIET=1. Logs go to stderr.
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { WORKER_DEFAULT_PORT } from '../../../src/app/features/coding/protocol.ts'
import { defaultConfigFile, initConfig, loadConfig } from './config.ts'
import { claudeBin, detectClaude } from './claude.ts'
import { checkRepo, hasRemote } from './git.ts'
import { Worker } from './worker.ts'
import { serveTaskMcp } from './taskmcp.ts'

declare const __VERSION__: string
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const quiet = process.env.ONE_WORKER_QUIET === '1'
const log = (msg: string) => {
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

if (flag('--version') || flag('-v')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

if (flag('--help') || flag('-h')) {
  process.stdout.write(`one-worker ${VERSION} — coding tasks from One, run by Claude Code on this computer

  node one-worker.mjs init --workspace <id>   write ${defaultConfigFile()} (One shows the id in
                                              Settings → Coding worker), then add your repos to it
  node one-worker.mjs check                   check the config, the repos and Claude Code
  node one-worker.mjs                         run — keep it running while One should hand out work

Options: --config <file> (or ONE_WORKER_CONFIG), --force (init: replace the file), --help, --version
Environment: CLAUDE_BIN (default "claude"), ONE_WORKER_PORT (default ${WORKER_DEFAULT_PORT}), ONE_ORIGINS, ONE_WORKER_QUIET=1
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

  let loaded
  try {
    loaded = loadConfig(configFile)
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  }
  const { config, problems } = loaded
  for (const p of problems) log(`config: ${p}`)

  if (command === 'check') {
    const bin = claudeBin()
    const caps = await detectClaude(bin)
    const lines = [`config     ${configFile}`, `workspace  ${config.workspace ?? 'not set — every One tab is refused'}`, `port       ${config.port}`, `claude     ${caps.found ? `${caps.version ?? 'found'}${caps.budget ? '' : ' (no --max-budget-usd: limits are checked between stages)'}` : `NOT FOUND ("${bin}")`}`]
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
    if (!config.repos.length) lines.push('repos      none — add at least one to "repos"')
    if (problems.length) ok = false
    process.stdout.write(`${lines.join('\n')}\n${ok ? 'All good.' : 'Fix the lines above.'}\n`)
    process.exit(ok ? 0 : 1)
  }

  if (command !== 'run') {
    process.stderr.write(`Unknown command "${command}". Run with --help.\n`)
    process.exit(1)
  }

  const worker = new Worker({ config, version: VERSION, bin: claudeBin(), self, log })
  const up = await worker.start()
  if (up !== 'listening') process.exit(1)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('stopping — ending running tasks')
    setTimeout(() => process.exit(0), 6000).unref()
    await worker.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGHUP', () => void shutdown())
}

void main()
