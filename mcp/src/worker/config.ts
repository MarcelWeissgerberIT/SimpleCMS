/**
 * one-worker — its config file (default ~/.config/one/worker.json, JSON with // comments).
 *
 * Everything that touches the machine lives here and only here: repo paths, test commands, Claude Code's
 * tools and limits. One learns repo NAMES (and base branches) — never a path or a command. A repo that is
 * not in this file does not exist for the worker; One cannot add one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { PARALLEL_MAX, PERMISSION_MODES, REPO_NAME, WORKER_DEFAULT_PORT, WORKSPACE_ID, type PermissionMode } from '../../../src/app/features/coding/protocol.ts'

export interface ClaudeConfig {
  /** a model name Claude Code accepts (null = its default) */
  model: string | null
  /** most turns per stage (a stage may ask for fewer) */
  maxTurns: number
  /** overrides the stage's mode per kind ("plan" stages always run in plan mode) */
  permissionMode: Partial<Record<'implement', PermissionMode>>
  allowedTools: string[]
  disallowedTools: string[]
  /** only the task tools as MCP servers (--strict-mcp-config; default true) */
  strictMcp: boolean
}

export interface RepoConfig {
  name: string
  /** absolute path of the main checkout */
  path: string
  baseBranch: string
  remote: string
  branchPrefix: string
  /** where task worktrees go (absolute) */
  worktreeDir: string
  /** argv, run in the worktree (null = no test stage on this repo) */
  testCommand: string[] | null
  testTimeoutSec: number
  push: boolean
  pr: 'gh' | 'none'
  claude: ClaudeConfig
  maxUsdPerTask: number | null
  maxUsdPerDay: number | null
}

export interface WorkerConfig {
  file: string
  /** the One workspace this worker serves (null = not bound: every tab is refused) */
  workspace: string | null
  name: string
  port: number
  parallel: number
  /** how often the worker asks One for work while idle (s) */
  pollSec: number
  /** extra allowed page origins (like ONE_ORIGINS) */
  origins: string[]
  repos: RepoConfig[]
}

export interface Loaded {
  config: WorkerConfig
  /** what was wrong (the repo or setting was left out) */
  problems: string[]
}

export function defaultConfigFile(): string {
  return join(homedir(), '.config', 'one', 'worker.json')
}

/* ------------------------------------------------------------------ JSON with comments */

/** Strip // and /* *\/ comments and trailing commas outside strings, then JSON.parse. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else {
      out += c
      i++
    }
  }
  // trailing commas before } or ] (outside strings: strings were copied verbatim above, so re-scan)
  let clean = ''
  for (let k = 0; k < out.length; k++) {
    const c = out[k]!
    if (c === '"') {
      let j = k + 1
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1
      clean += out.slice(k, j + 1)
      k = j
      continue
    }
    if (c === ',') {
      let j = k + 1
      while (j < out.length && /\s/.test(out[j]!)) j++
      if (out[j] === '}' || out[j] === ']') continue
    }
    clean += c
  }
  return JSON.parse(clean)
}

/* ------------------------------------------------------------------ sanitizing */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const REF_PART = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock(\/|$))[A-Za-z0-9._/-]{1,120}(?<![/.])$/
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PREFIX = /^(?!-)[A-Za-z0-9._/-]{0,40}$/

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def)
const usd = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null)
const strings = (v: unknown, max = 100): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, 300)).slice(0, max) : [])

function claudeConfig(raw: unknown, where: string, problems: string[]): ClaudeConfig {
  const c = isObj(raw) ? raw : {}
  const modes: ClaudeConfig['permissionMode'] = {}
  if (isObj(c.permissionMode)) {
    for (const [kind, mode] of Object.entries(c.permissionMode)) {
      if (kind !== 'implement') {
        problems.push(`${where}: claude.permissionMode.${kind} is ignored (only "implement": plan stages always run in plan mode)`)
        continue
      }
      if ((PERMISSION_MODES as readonly string[]).includes(String(mode))) modes[kind] = mode as PermissionMode
      else problems.push(`${where}: claude.permissionMode.${kind} ${JSON.stringify(mode)} is not allowed (${PERMISSION_MODES.join(', ')} — never one that skips permissions)`)
    }
  }
  const model = typeof c.model === 'string' && /^[A-Za-z0-9._:[\]-]{1,100}$/.test(c.model.trim()) ? c.model.trim() : null
  return {
    model,
    maxTurns: Math.floor(num(c.maxTurns, 30, 1, 200)),
    permissionMode: modes,
    allowedTools: strings(c.allowedTools),
    disallowedTools: strings(c.disallowedTools),
    strictMcp: c.strictMcp !== false,
  }
}

function repoConfig(raw: unknown, index: number, configDir: string, problems: string[]): RepoConfig | null {
  const where = `repos[${index}]`
  if (!isObj(raw)) {
    problems.push(`${where} is not an object`)
    return null
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!REPO_NAME.test(name)) {
    problems.push(`${where}: "name" must be 1–64 letters, digits, ".", "_" or "-" (it is what One shows)`)
    return null
  }
  const at = `${where} (${name})`
  const rawPath = typeof raw.path === 'string' ? expandHome(raw.path.trim()) : ''
  if (!rawPath) {
    problems.push(`${at}: "path" is missing`)
    return null
  }
  const path = resolve(configDir, rawPath)
  const baseBranch = typeof raw.baseBranch === 'string' && raw.baseBranch.trim() ? raw.baseBranch.trim() : 'main'
  if (!REF_PART.test(baseBranch)) {
    problems.push(`${at}: "baseBranch" ${JSON.stringify(baseBranch)} is not a branch name`)
    return null
  }
  const remote = typeof raw.remote === 'string' && raw.remote.trim() ? raw.remote.trim() : 'origin'
  if (!REMOTE.test(remote)) {
    problems.push(`${at}: "remote" ${JSON.stringify(remote)} is not a remote name`)
    return null
  }
  const branchPrefix = typeof raw.branchPrefix === 'string' ? raw.branchPrefix.trim() : 'one/'
  if (!PREFIX.test(branchPrefix)) {
    problems.push(`${at}: "branchPrefix" ${JSON.stringify(branchPrefix)} is not allowed`)
    return null
  }
  const worktreeDir = typeof raw.worktreeDir === 'string' && raw.worktreeDir.trim() ? resolve(configDir, expandHome(raw.worktreeDir.trim())) : join(dirname(path), '.one-worktrees', name)
  let testCommand: string[] | null = null
  if (raw.testCommand !== undefined && raw.testCommand !== null) {
    if (typeof raw.testCommand === 'string') problems.push(`${at}: "testCommand" must be a list (argv), e.g. ["npm", "test"] — a command line is never run through a shell`)
    else {
      const argv = strings(raw.testCommand, 50)
      if (argv.length) testCommand = argv
      else problems.push(`${at}: "testCommand" is empty`)
    }
  }
  const pr = raw.pr === 'none' ? 'none' : 'gh'
  return {
    name,
    path,
    baseBranch,
    remote,
    branchPrefix,
    worktreeDir,
    testCommand,
    testTimeoutSec: Math.floor(num(raw.testTimeoutSec, 600, 5, 7200)),
    push: raw.push !== false,
    pr,
    claude: claudeConfig(raw.claude, at, problems),
    maxUsdPerTask: usd(raw.maxUsdPerTask),
    maxUsdPerDay: usd(raw.maxUsdPerDay),
  }
}

/** Read and check worker.json. Throws (with a readable message) only when the file is missing or not JSON. */
export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): Loaded {
  if (!existsSync(file)) throw new Error(`No config file at ${file}. Create one with: node one-worker.mjs init${file === defaultConfigFile() ? '' : ` --config ${file}`}`)
  let raw: unknown
  try {
    raw = parseJsonc(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return sanitizeConfig(raw, file, env)
}

export function sanitizeConfig(raw: unknown, file: string, env: NodeJS.ProcessEnv = process.env): Loaded {
  const problems: string[] = []
  const r = isObj(raw) ? raw : {}
  const configDir = dirname(file)
  let workspace: string | null = null
  if (typeof r.workspace === 'string' && r.workspace.trim()) {
    if (WORKSPACE_ID.test(r.workspace.trim())) workspace = r.workspace.trim()
    else problems.push(`"workspace" ${JSON.stringify(r.workspace)} is not a workspace id (One shows it in Settings → Coding worker, e.g. "local:abc123")`)
  }
  const repos: RepoConfig[] = []
  const list = Array.isArray(r.repos) ? r.repos : []
  if (!Array.isArray(r.repos)) problems.push('"repos" is missing: list the repositories this worker may work in')
  list.forEach((entry, i) => {
    const repo = repoConfig(entry, i, configDir, problems)
    if (!repo) return
    if (repos.some((x) => x.name === repo.name)) problems.push(`repos[${i}]: the name "${repo.name}" is used twice — the second one is ignored`)
    else repos.push(repo)
  })
  const envPort = Number(env.ONE_WORKER_PORT)
  const port = Number.isInteger(envPort) && envPort >= 1024 && envPort <= 65535 ? envPort : Math.floor(num(r.port, WORKER_DEFAULT_PORT, 1024, 65535))
  const name = (typeof r.name === 'string' && r.name.trim() ? r.name : hostname()).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || 'worker'
  return {
    config: {
      file,
      workspace,
      name,
      port,
      parallel: Math.floor(num(r.parallel, PARALLEL_MAX, 1, PARALLEL_MAX)),
      pollSec: Math.floor(num(r.pollSec, 15, 2, 600)),
      origins: strings(r.origins, 20),
      repos,
    },
    problems,
  }
}

/* ------------------------------------------------------------------ init */

/** The commented example `init` writes. */
export function exampleConfig(workspace: string | null): string {
  const home = homedir().replace(/\\/g, '/')
  return `// one-worker — runs coding tasks from One with Claude Code on this computer.
// Docs: https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/CODING.md
// Paths and commands in this file never leave this computer: One only learns repo names.
{
  // The One workspace this worker serves — One shows its id in Settings → Coding worker.
  // The worker refuses tabs of every other workspace.
  "workspace": ${workspace ? JSON.stringify(workspace) : 'null'},

  // How One shows this worker (default: this computer's name).
  // "name": "laptop",

  // WebSocket port on 127.0.0.1 (set the same port in One; ONE_WORKER_PORT overrides it).
  "port": ${WORKER_DEFAULT_PORT},

  // Tasks at once across repos (1–${PARALLEL_MAX}; always one per repo).
  "parallel": ${PARALLEL_MAX},

  "repos": [
    {
      // The name One shows (letters, digits, . _ -).
      "name": "website",
      // The main checkout. The worker never changes its working tree: every task gets its own worktree.
      "path": "${home}/code/website",
      "baseBranch": "main",
      "remote": "origin",
      // New task branches: <prefix><title>-<id>
      "branchPrefix": "one/",
      // Where task worktrees go (default: next to the repo, in .one-worktrees/<name>).
      // "worktreeDir": "${home}/code/.one-worktrees/website",

      // The Test stage runs this in the worktree — an argv list, never a shell line. Leave it out: no tests.
      "testCommand": ["npm", "test"],
      "testTimeoutSec": 600,

      // Push task branches to the remote (Ship stage, Push key in One).
      "push": true,
      // "gh": open pull requests with the GitHub CLI (when installed and signed in) · "none": only a compare link.
      "pr": "gh",

      "claude": {
        // A model name Claude Code accepts; null = Claude Code's default.
        "model": null,
        // Most turns per stage.
        "maxTurns": 30,
        // Claude Code's permission mode for implement stages: "acceptEdits" (default) or "default".
        // Plan stages always run in "plan" mode. A mode that skips permissions is never used.
        // "permissionMode": { "implement": "acceptEdits" },
        // Tools Claude Code may use without asking (headless runs cannot ask) — Claude Code's own syntax.
        "allowedTools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test:*)", "Bash(npm run lint:*)"],
        "disallowedTools": ["Bash(git push:*)", "Bash(rm -rf:*)"]
      },

      // Cost limits in US dollars (Claude Code's own accounting). A stage stops at the limit.
      "maxUsdPerTask": 5,
      "maxUsdPerDay": 25
    }
  ]
}
`
}

/** Write the example config. Refuses to overwrite unless `force`. Returns the file. */
export function initConfig(file: string, workspace: string | null, force = false): string {
  if (workspace !== null && !WORKSPACE_ID.test(workspace)) throw new Error(`${JSON.stringify(workspace)} is not a workspace id (e.g. "local:abc123" — One shows it in Settings → Coding worker)`)
  if (existsSync(file) && !force) throw new Error(`${file} already exists. Edit it, or run init with --force to replace it.`)
  if (!isAbsolute(file)) file = resolve(file)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, exampleConfig(workspace), { mode: 0o600 })
  return file
}
